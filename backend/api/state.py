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
import contextvars
import io
import json
import logging
import pickle
import sqlite3
from dataclasses import fields as dataclass_fields

from .db import get_db
from .player_secret_store import (
    delete_secrets_for_tournament,
    extract_history_stats,
    extract_partner_rival_stats,
    invalidate_secrets_cache,
    purge_expired_secrets,
)
from .sse import notify_global, notify_tournament

# ContextVar set to True when a _save_tournament() call fails to persist.
# The CSRF/persist-warning middleware reads this to add an X-Persist-Warning
# header on the HTTP response, alerting the frontend without breaking the
# request/response flow.
persist_failed: contextvars.ContextVar[bool] = contextvars.ContextVar("persist_failed", default=False)

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
    """Return the next sequential tournament ID (e.g. ``t3``) and persist it."""
    global _counter
    _counter += 1
    try:
        with get_db() as conn:
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('tournament_counter', ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (_counter,),
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist tournament counter: %s", exc)
    return f"t{_counter}"


async def allocate_tournament_id() -> str:
    """Allocate and return the next tournament ID with minimal lock scope."""
    async with _id_allocation_lock:
        return _next_id()


# ────────────────────────────────────────────────────────────────────────────
# Persistence — per-tournament granularity
# ────────────────────────────────────────────────────────────────────────────


def _save_tournament(tid: str) -> bool:
    """Persist a single tournament row to SQLite (upsert).

    Only the named tournament is written; all other rows are untouched.
    Returns ``True`` on success.  On failure the error is logged, the
    ``persist_failed`` context-var is set to ``True`` (surfaced as an
    ``X-Persist-Warning`` response header by middleware), and ``False`` is
    returned.
    """
    global _state_version
    _state_version += 1

    version = _tournament_versions.get(tid, 0) + 1
    _tournament_versions[tid] = version

    data = _tournaments[tid]
    persisted = True
    try:
        blob = pickle.dumps(data["tournament"], protocol=pickle.HIGHEST_PROTOCOL)
        tv_raw = json.dumps(data["tv_settings"]) if data.get("tv_settings") else None
        email_raw = json.dumps(data["email_settings"]) if data.get("email_settings") else None
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO tournaments
                    (id, name, type, owner, public, alias, tv_settings, tournament_blob, version, sport, assign_courts, email_settings)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name            = excluded.name,
                    public          = excluded.public,
                    alias           = excluded.alias,
                    tv_settings     = excluded.tv_settings,
                    tournament_blob = excluded.tournament_blob,
                    version         = excluded.version,
                    sport           = excluded.sport,
                    assign_courts   = excluded.assign_courts,
                    email_settings  = excluded.email_settings
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
                    email_raw,
                ),
            )
    except (sqlite3.Error, pickle.PicklingError, OSError) as exc:
        logger.warning("Could not save tournament %s: %s", tid, exc)
        persist_failed.set(True)
        persisted = False

    # Purge player secrets once the tournament enters the finished phase so
    # that old passphrases / QR tokens cannot be confused with new ones.
    tournament = data.get("tournament")
    if tournament is not None and str(getattr(tournament, "phase", "")) == "finished":
        delete_secrets_for_tournament(
            tid,
            entity_name=data.get("name", ""),
            player_stats=extract_history_stats(data),
            sport=data.get("sport", "padel"),
            partner_rival_stats=extract_partner_rival_stats(data),
        )

    # Push SSE notifications so connected clients learn about the change
    # immediately instead of waiting for their next poll cycle.
    notify_tournament(tid)
    notify_global()
    return persisted


def get_tournament_data(tid: str) -> dict | None:
    """Return the full data dict for a tournament, loading from DB if not in memory.

    Used for history backfills when a player creates a profile after a tournament
    has already finished (and its player_secrets have been purged).

    Args:
        tid: Tournament ID, e.g. ``"t5"``.

    Returns:
        The same dict structure as ``_tournaments[tid]``, or ``None`` if the
        tournament does not exist or its blob cannot be deserialised.
    """
    if tid in _tournaments:
        return _tournaments[tid]
    try:
        with get_db() as conn:
            row = conn.execute(
                """SELECT id, name, type, owner, public, alias, tv_settings,
                          tournament_blob, version, sport
                   FROM tournaments WHERE id = ?""",
                (tid,),
            ).fetchone()
        if row is None:
            return None
        tournament = _safe_loads(row["tournament_blob"])
        return {
            "name": row["name"],
            "type": row["type"],
            "owner": row["owner"],
            "public": bool(row["public"]),
            "alias": row["alias"],
            "tv_settings": json.loads(row["tv_settings"]) if row["tv_settings"] else None,
            "tournament": tournament,
            "sport": row["sport"] or "padel",
        }
    except (sqlite3.Error, pickle.UnpicklingError) as exc:
        logger.warning("Could not load tournament %s for backfill: %s", tid, exc)
        return None


def rename_player_in_tournament(tid: str, player_id: str, new_name: str) -> bool:
    """Update the ``name`` of every ``Player`` instance with *player_id* in a tournament.

    Walks the tournament object graph recursively (containers, dataclass
    fields, ``__dict__`` attributes) and mutates the ``name`` attribute on
    every matching :class:`backend.models.Player` object found.  Because
    Python stores objects by reference, a single mutation propagates to all
    ``Match.team1`` / ``team2`` / ``Group.players`` / bracket slots that
    share the same instance.

    The tournament is saved to SQLite only when at least one rename occurred.

    Args:
        tid: Tournament ID.
        player_id: The player whose name should change.
        new_name: New display name.

    Returns:
        ``True`` if the rename was applied and the tournament saved; ``False``
        if the tournament does not exist or the player was not found.
    """
    # Import here to avoid a circular import at module load time.
    from ..models import Player  # noqa: PLC0415

    if tid not in _tournaments:
        return False

    tournament = _tournaments[tid].get("tournament")
    if tournament is None:
        return False

    visited: set[int] = set()
    renamed: int = 0

    def _walk(obj: object) -> None:
        nonlocal renamed
        oid = id(obj)
        if oid in visited:
            return
        visited.add(oid)

        if isinstance(obj, Player):
            if obj.id == player_id and obj.name != new_name:
                obj.name = new_name
                renamed += 1
            return

        if isinstance(obj, dict):
            for v in obj.values():
                _walk(v)
            return

        if isinstance(obj, (list, tuple, set, frozenset)):
            for item in obj:
                _walk(item)
            return

        # Dataclass or regular object — inspect known fields first, then __dict__.
        try:
            for f in dataclass_fields(obj):  # type: ignore[arg-type]
                _walk(getattr(obj, f.name, None))
        except TypeError:
            pass
        obj_dict = getattr(obj, "__dict__", None)
        if isinstance(obj_dict, dict):
            for v in obj_dict.values():
                _walk(v)

    _walk(tournament)

    if renamed:
        _save_tournament(tid)
        logger.debug("Renamed player %s → %r in %d object(s) for tournament %s", player_id, new_name, renamed, tid)
        return True
    return False


def _delete_tournament(tid: str) -> None:
    """Remove a tournament row from SQLite.

    Errors are logged but never raised.  Also clears the co-editor cache
    and player-secrets cache so stale entries don't accumulate.
    """
    global _state_version
    _state_version += 1
    _tournament_versions.pop(tid, None)
    _tournament_locks.pop(tid, None)

    from .db import invalidate_co_editor_cache  # noqa: PLC0415

    invalidate_co_editor_cache(tid)
    invalidate_secrets_cache(tid)

    try:
        with get_db() as conn:
            conn.execute("DELETE FROM tournament_shares WHERE tournament_id = ?", (tid,))
            conn.execute("DELETE FROM player_secrets WHERE tournament_id = ?", (tid,))
            conn.execute("DELETE FROM tournaments WHERE id = ?", (tid,))
    except sqlite3.Error as exc:
        logger.warning("Could not delete tournament %s: %s", tid, exc)

    # Push SSE notification so the picker / admin panel learns immediately.
    notify_global()


def _load_state() -> None:
    """Restore all tournaments from SQLite on startup.

    Rows whose BLOB cannot be deserialised (e.g. after a schema-breaking code
    change) are skipped with a warning rather than crashing the server.
    """
    global _counter

    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT id, name, type, owner, public, alias, tv_settings, tournament_blob, version, sport, assign_courts, email_settings FROM tournaments"
            ).fetchall()
    except sqlite3.Error as exc:  # noqa: BLE001
        logger.warning("Could not load state (starting fresh): %s", exc)
        return

    for row in rows:
        tid = row["id"]
        try:
            tournament = _safe_loads(row["tournament_blob"])
        except (pickle.UnpicklingError, ImportError, AttributeError, ModuleNotFoundError) as exc:
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
            "email_settings": json.loads(row["email_settings"])
            if "email_settings" in row.keys() and row["email_settings"]
            else None,
        }
        _tournament_versions[tid] = row["version"]

        # Keep the in-memory counter ahead of the highest persisted ID.
        if tid.startswith("t") and tid[1:].isdigit():
            _counter = max(_counter, int(tid[1:]))

    # Also seed from the persisted counter so deleted IDs are never reused.
    try:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM meta WHERE key = 'tournament_counter'").fetchone()
            if row:
                _counter = max(_counter, row["value"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not read tournament counter from meta: %s", exc)

    logger.info("Loaded %d tournament(s) from SQLite", len(_tournaments))
    purge_expired_secrets()
