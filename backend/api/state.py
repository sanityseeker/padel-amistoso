"""
In-memory tournament store and pickle-based persistence.

Every route module imports from here to access the shared state.

The data directory can be overridden with the ``PADEL_DATA_DIR`` environment
variable, which lets you run multiple independent instances on different ports
without them sharing or overwriting each other's state:

    PADEL_DATA_DIR=data/instance_a uv run uvicorn backend.api:app --port 8000
    PADEL_DATA_DIR=data/instance_b uv run uvicorn backend.api:app --port 8001

Safety guarantees:
  - Writes use atomic tmp → rename so a crash mid-save never corrupts the file.
  - A file lock (``padel.lock``) prevents two processes from using the same
    data directory simultaneously.
"""

from __future__ import annotations

import fcntl
import os
import pickle
from pathlib import Path

# ────────────────────────────────────────────────────────────────────────────
# Store
# ────────────────────────────────────────────────────────────────────────────

_tournaments: dict[str, dict] = {}
_counter: int = 0
_state_version: int = 0  # bumped on every _save_state() call; used by TV "on-update" mode

_default_data_dir = Path(__file__).resolve().parent.parent.parent / "data"
DATA_DIR = Path(os.environ.get("PADEL_DATA_DIR", _default_data_dir))
STATE_FILE = DATA_DIR / "tournaments.pkl"
_LOCK_FILE = DATA_DIR / "padel.lock"
_lock_fd = None  # held for the lifetime of the process


def _next_id() -> str:
    global _counter
    _counter += 1
    return f"t{_counter}"


# ────────────────────────────────────────────────────────────────────────────
# Directory lock
# ────────────────────────────────────────────────────────────────────────────


def _acquire_lock() -> None:
    """Acquire an exclusive file lock on the data directory.

    Prevents two server processes from accidentally using the same
    ``PADEL_DATA_DIR``, which would cause them to silently overwrite
    each other's state.

    The lock is held until the process exits (or ``_release_lock`` is
    called explicitly).
    """
    global _lock_fd
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _lock_fd = _LOCK_FILE.open("w")
    try:
        fcntl.flock(_lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        _lock_fd.write(f"pid={os.getpid()}\n")
        _lock_fd.flush()
    except OSError:
        _lock_fd.close()
        _lock_fd = None
        raise RuntimeError(
            f"Another process is already using data directory: {DATA_DIR}\n"
            f"Set PADEL_DATA_DIR to a different path for each instance."
        )


def _release_lock() -> None:
    """Release the directory lock (called on shutdown)."""
    global _lock_fd
    if _lock_fd is not None:
        try:
            fcntl.flock(_lock_fd, fcntl.LOCK_UN)
            _lock_fd.close()
        except OSError:
            pass
        _lock_fd = None


# ────────────────────────────────────────────────────────────────────────────
# Persistence
# ────────────────────────────────────────────────────────────────────────────


def _save_state() -> None:
    """Persist the full tournament store to disk (best-effort, atomic write)."""
    global _state_version
    _state_version += 1
    try:
        DATA_DIR.mkdir(exist_ok=True)
        tmp = STATE_FILE.with_suffix(".tmp")
        with tmp.open("wb") as f:
            pickle.dump(
                {"tournaments": _tournaments, "counter": _counter},
                f,
                protocol=pickle.HIGHEST_PROTOCOL,
            )
        tmp.replace(STATE_FILE)  # atomic on POSIX
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] Could not save state: {exc}")


def _load_state() -> None:
    """Restore tournament store from disk on startup, silently skip if missing.

    Also acquires the directory lock — will raise ``RuntimeError`` if another
    process already owns the same data directory.
    """
    global _tournaments, _counter

    _acquire_lock()

    if not STATE_FILE.exists():
        return
    try:
        with STATE_FILE.open("rb") as f:
            saved = pickle.load(f)  # noqa: S301
        _tournaments.update(saved["tournaments"])
        _counter = saved["counter"]
        print(f"[info] Loaded {len(_tournaments)} tournament(s) from {STATE_FILE}")
    except Exception as exc:  # noqa: BLE001
        print(f"[warn] Could not load saved state (starting fresh): {exc}")
