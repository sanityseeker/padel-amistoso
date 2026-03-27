"""
In-memory tournament store with SQLite persistence.

Every route module imports from here to access the shared state.

The database path is controlled by the ``AMISTOSO_DATA_DIR`` (or legacy
``PADEL_DATA_DIR``) environment variable (see ``backend.config``).

    AMISTOSO_DATA_DIR=data/instance_a uv run uvicorn backend.api:app --port 8000
    AMISTOSO_DATA_DIR=data/instance_b uv run uvicorn backend.api:app --port 8001

Safety guarantees
-----------------
- Each tournament is an independent SQLite row; saving one never rewrites any
  other tournament's data.
- SQLite WAL mode allows concurrent reads while a write is in progress.
- An ``asyncio.Lock`` serialises concurrent write requests within the same
  process so no two coroutines can interleave a read-modify-save sequence.
- SQLite's own file locking prevents data corruption if two processes
  somehow target the same database (second writer will block, not corrupt).
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import pickle

from .db import get_db
from .player_secret_store import delete_secrets_for_tournament

# ---------------------------------------------------------------------------
# Restricted unpickler — stdlib and all project (backend.*) modules are allowed;
# everything else is blocked.
# ---------------------------------------------------------------------------

# Modules whose every name is allowed (standard-library and trusted third-party).
_ALLOWED_PICKLE_MODULES: set[str] = {
    "builtins",
    "collections",
    "datetime",
    "enum",
    "uuid",
    "decimal",
    "fractions",
    "pathlib",
    "re",
    "copy_reg",
    "_collections",  # CPython internal alias used by pickle for defaultdict
    "pydantic.main",  # BaseModel base class used by project models
}


class _RestrictedUnpickler(pickle.Unpickler):
    """Unpickler that allows stdlib, pydantic.main, and all project (backend.*) modules."""

    def find_class(self, module: str, name: str) -> type:
        if module in _ALLOWED_PICKLE_MODULES or module == "backend" or module.startswith("backend."):
            return super().find_class(module, name)
        raise pickle.UnpicklingError(f"Blocked attempt to unpickle {module}.{name}")


def _safe_loads(data: bytes) -> object:
    """Deserialise a pickle blob using the restricted unpickler."""
    return _RestrictedUnpickler(io.BytesIO(data)).load()


logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# Store
# ────────────────────────────────────────────────────────────────────────────

_tournaments: dict[str, dict] = {}
_counter: int = 0

# Per-tournament version counters — bumped on every _save_tournament() call.
# The TV display polls /{tid}/version cheaply and reloads only on change.
_tournament_versions: dict[str, int] = {}

# Global version — incremented by any mutation.  Used by /api/version so the
# TV tournament picker can detect new/deleted tournaments without fetching the
# full list every tick.
_state_version: int = 0

# Per-tournament asyncio locks so concurrent writes to different tournaments
# don't block each other.  ID allocation uses a dedicated lightweight lock.
# The legacy global lock is kept as a backward-compatible alias.
_tournament_locks: dict[str, asyncio.Lock] = {}
_id_allocation_lock: asyncio.Lock = asyncio.Lock()
_global_lock: asyncio.Lock = asyncio.Lock()

# Backwards-compatible alias kept for any remaining import sites.
state_lock = _global_lock


def get_tournament_lock(tid: str) -> asyncio.Lock:
    """Return the per-tournament lock, creating it lazily if needed."""
    lock = _tournament_locks.get(tid)
    if lock is None:
        lock = asyncio.Lock()
        _tournament_locks[tid] = lock
    return lock


def _next_id() -> str:
    """Return the next sequential tournament ID (e.g. ``t3``)."""
    global _counter
    _counter += 1
    return f"t{_counter}"


async def allocate_tournament_id() -> str:
    """Allocate and return the next tournament ID with minimal lock scope."""
    async with _id_allocation_lock:
        return _next_id()


# ────────────────────────────────────────────────────────────────────────────
# Persistence — per-tournament granularity
# ────────────────────────────────────────────────────────────────────────────


def _save_tournament(tid: str) -> None:
    """Persist a single tournament row to SQLite (upsert).

    Only the named tournament is written; all other rows are untouched.
    Errors are logged but never raised — a failed save should not abort the
    HTTP response that triggered it.
    """
    global _state_version
    _state_version += 1

    version = _tournament_versions.get(tid, 0) + 1
    _tournament_versions[tid] = version

    data = _tournaments[tid]
    try:
        blob = pickle.dumps(data["tournament"], protocol=pickle.HIGHEST_PROTOCOL)
        tv_raw = json.dumps(data["tv_settings"]) if data.get("tv_settings") else None
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO tournaments
                    (id, name, type, owner, public, alias, tv_settings, tournament_blob, version, sport, assign_courts)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name            = excluded.name,
                    public          = excluded.public,
                    alias           = excluded.alias,
                    tv_settings     = excluded.tv_settings,
                    tournament_blob = excluded.tournament_blob,
                    version         = excluded.version,
                    sport           = excluded.sport,
                    assign_courts   = excluded.assign_courts
                """,
                (
                    tid,
                    data["name"],
                    data["type"],
                    data.get("owner", ""),
                    int(data.get("public", True)),
                    data.get("alias"),
                    tv_raw,
                    blob,
                    version,
                    data.get("sport", "padel"),
                    int(data.get("assign_courts", True)),
                ),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not save tournament %s: %s", tid, exc)

    # Purge player secrets once the tournament enters the finished phase so
    # that old passphrases / QR tokens cannot be confused with new ones.
    tournament = data.get("tournament")
    if tournament is not None and str(getattr(tournament, "phase", "")) == "finished":
        delete_secrets_for_tournament(tid)


def _delete_tournament(tid: str) -> None:
    """Remove a tournament row from SQLite.

    Errors are logged but never raised.
    """
    global _state_version
    _state_version += 1
    _tournament_versions.pop(tid, None)
    _tournament_locks.pop(tid, None)
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM tournaments WHERE id = ?", (tid,))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not delete tournament %s: %s", tid, exc)


def _load_state() -> None:
    """Restore all tournaments from SQLite on startup.

    Rows whose BLOB cannot be deserialised (e.g. after a schema-breaking code
    change) are skipped with a warning rather than crashing the server.
    """
    global _counter

    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT id, name, type, owner, public, alias, tv_settings, tournament_blob, version, sport FROM tournaments"
            ).fetchall()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not load state (starting fresh): %s", exc)
        return

    for row in rows:
        tid = row["id"]
        try:
            tournament = _safe_loads(row["tournament_blob"])
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not deserialise tournament %s, skipping: %s", tid, exc)
            continue

        _tournaments[tid] = {
            "name": row["name"],
            "type": row["type"],
            "owner": row["owner"],
            "public": bool(row["public"]),
            "alias": row["alias"],
            "tv_settings": json.loads(row["tv_settings"]) if row["tv_settings"] else None,
            "tournament": tournament,
            "sport": row["sport"] if "sport" in row.keys() else "padel",
            "assign_courts": bool(row["assign_courts"]) if "assign_courts" in row.keys() else True,
        }
        _tournament_versions[tid] = row["version"]

        # Keep the in-memory counter ahead of the highest persisted ID.
        if tid.startswith("t") and tid[1:].isdigit():
            _counter = max(_counter, int(tid[1:]))

    logger.info("Loaded %d tournament(s) from SQLite", len(_tournaments))
