"""Process-local caches for public leaderboard / mini-card payloads.

Extracted from ``routes_clubs`` so the cache primitives (and their version
keys, max-age guards, and the small TTL cache for player mini-cards) can be
unit-tested and reused by other endpoints without pulling in routing code.

Three caches live here:

* ``_LEADERBOARD_CACHE`` — per-club leaderboard rows, keyed by club_id.
  Memoised against a cheap version key derived from match-log activity and
  the snapshot table; additionally protected by ``LEADERBOARD_MAX_AGE_S`` so
  stale entries can't survive a missed invalidation.
* ``_SYNC_VERSION_CACHE`` — per-club sync short-circuit, keyed by club_id.
* ``_MINI_CARD_CACHE`` — short-TTL absorber for repeat mini-card clicks.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from typing import Any, Callable

# Endpoints using these caches run both on the event loop and in the request
# threadpool (sync ``def`` endpoints), so compound OrderedDict operations
# (get → move_to_end, eviction loops) must be serialized. Builders run
# outside the lock — a duplicate recompute is acceptable, a KeyError from a
# concurrently evicted key is not.
_CACHE_LOCK = threading.Lock()

# ---------------------------------------------------------------------------
# Leaderboard cache
# ---------------------------------------------------------------------------

# Hard ceiling so a missed explicit invalidation can't keep stale rows alive.
LEADERBOARD_MAX_AGE_S: int = 300

# (version, rows, expires_at)
_LEADERBOARD_CACHE: dict[str, tuple[str, list[dict], float]] = {}
_SYNC_VERSION_CACHE: dict[str, str] = {}


def club_leaderboard_version(conn, club_id: str) -> str:
    """Cheap version key — changes when leaderboard inputs change.

    Combines the latest match-log timestamp / count for this club's
    tournaments with a checksum-ish summary of ``profile_club_elo`` rows
    (tier assignments, hidden toggles, ELO snapshots). Both queries hit
    existing indexes.
    """
    log_row = conn.execute(
        """
        SELECT COALESCE(MAX(l.updated_at), '') AS m_log,
               COUNT(*) AS c_log
          FROM player_elo_log l
          JOIN tournaments t ON t.id = l.tournament_id
         WHERE t.club_id = ?
        """,
        (club_id,),
    ).fetchone()
    snap_row = conn.execute(
        """
        SELECT COUNT(*)                                     AS c,
               COALESCE(SUM(LENGTH(COALESCE(tier_id, ''))), 0) AS t,
               COALESCE(SUM(hidden), 0)                     AS h,
               COALESCE(CAST(SUM(elo * 100) AS INTEGER), 0) AS s
          FROM profile_club_elo
         WHERE club_id = ?
        """,
        (club_id,),
    ).fetchone()
    return f"{log_row['m_log']}|{log_row['c_log']}|{snap_row['c']}|{snap_row['t']}|{snap_row['h']}|{snap_row['s']}"


def club_sync_version(conn, club_id: str) -> str:
    """Version key for ``_sync_club_players_from_community`` short-circuit."""
    counts = conn.execute(
        """
        SELECT
          (SELECT COUNT(*) FROM player_secrets ps
             JOIN tournaments t ON t.id = ps.tournament_id
            WHERE t.club_id = ?) AS ps_count,
          (SELECT COUNT(*) FROM player_history ph
             JOIN tournaments t ON t.id = ph.entity_id
            WHERE t.club_id = ? AND ph.entity_type = 'tournament') AS ph_count,
          (SELECT COUNT(*) FROM profile_club_elo WHERE club_id = ?) AS roster_count
        """,
        (club_id, club_id, club_id),
    ).fetchone()
    return f"{counts['ps_count']}|{counts['ph_count']}|{counts['roster_count']}"


def get_cached_leaderboard_rows(
    conn,
    club_id: str,
    builder: Callable[[Any, str], list[dict]],
) -> list[dict]:
    """Return cached rows or compute via ``builder``.

    Cache hit requires both the version key to match AND the entry to be
    within ``LEADERBOARD_MAX_AGE_S``. ``builder`` is a callable that takes
    ``(conn, club_id)`` and returns the freshly computed rows list.
    """
    version = club_leaderboard_version(conn, club_id)
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _LEADERBOARD_CACHE.get(club_id)
        if cached is not None and cached[0] == version and cached[2] > now:
            return cached[1]
    rows = builder(conn, club_id)
    with _CACHE_LOCK:
        _LEADERBOARD_CACHE[club_id] = (version, rows, now + LEADERBOARD_MAX_AGE_S)
    return rows


def invalidate_leaderboard_cache(club_id: str | None = None) -> None:
    """Drop the cached leaderboard for ``club_id`` (or all clubs when None).

    Also flushes mini-card cache entries for the affected club so a stale
    snapshot can't outlive its underlying leaderboard rows.
    """
    with _CACHE_LOCK:
        if club_id is None:
            _LEADERBOARD_CACHE.clear()
            _SYNC_VERSION_CACHE.clear()
        else:
            _LEADERBOARD_CACHE.pop(club_id, None)
            _SYNC_VERSION_CACHE.pop(club_id, None)
    if club_id is None:
        invalidate_mini_card_cache()
    else:
        invalidate_mini_card_cache(("club", club_id))


# ---------------------------------------------------------------------------
# Mini-card TTL cache
# ---------------------------------------------------------------------------

MINI_CARD_TTL_S: float = 30.0
MINI_CARD_CACHE_MAX_ENTRIES: int = 1024

# key -> (expires_at, payload). LRU-ordered so we can evict the oldest entry
# once we exceed ``MINI_CARD_CACHE_MAX_ENTRIES``.
_MINI_CARD_CACHE: "OrderedDict[tuple, tuple[float, Any]]" = OrderedDict()


def get_mini_card_cached(key: tuple, builder: Callable[[], Any], ttl: float = MINI_CARD_TTL_S) -> Any:
    """Return a cached payload for ``key`` or compute + store via ``builder``.

    Used by the public mini-card endpoints to absorb repeat clicks (e.g.
    leaderboard rows opened multiple times in succession). Bounded by
    ``MINI_CARD_CACHE_MAX_ENTRIES`` with LRU eviction.
    """
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _MINI_CARD_CACHE.get(key)
        if cached is not None and cached[0] > now:
            _MINI_CARD_CACHE.move_to_end(key)
            return cached[1]
    payload = builder()
    with _CACHE_LOCK:
        _MINI_CARD_CACHE[key] = (now + ttl, payload)
        _MINI_CARD_CACHE.move_to_end(key)
        while len(_MINI_CARD_CACHE) > MINI_CARD_CACHE_MAX_ENTRIES:
            _MINI_CARD_CACHE.popitem(last=False)
    return payload


def invalidate_mini_card_cache(prefix: tuple | None = None) -> None:
    """Drop mini-card cache entries (all, or those starting with ``prefix``)."""
    with _CACHE_LOCK:
        if prefix is None:
            _MINI_CARD_CACHE.clear()
            return
        for k in list(_MINI_CARD_CACHE.keys()):
            if k[: len(prefix)] == prefix:
                _MINI_CARD_CACHE.pop(k, None)


# ---------------------------------------------------------------------------
# ETag helper
# ---------------------------------------------------------------------------


def etag_for(payload: Any) -> str:
    """Return a short, deterministic weak-style ETag for ``payload``.

    Uses MD5 (non-cryptographic, fast) over the JSON-serialised payload.
    The returned value is already wrapped in double quotes per RFC 7232.
    """
    raw = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":")).encode("utf-8")
    digest = hashlib.md5(raw, usedforsecurity=False).hexdigest()
    return f'"{digest[:16]}"'
