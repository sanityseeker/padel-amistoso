"""ELO recalculation after a participation changes Player Hub profile.

A participant starts each tournament from their linked profile's rating, so
linking, unlinking, re-linking, ghost creation and profile merges all change
ratings — not only the profile's own, but every opponent's in that tournament
and every later tournament seeded from them.  This module is the single place
that brings ratings back in line after such a change.

Usage: code that changes which profile a participation belongs to calls
:func:`mark_elo_dirty` (plain sync, safe from any thread or transaction).  The
HTTP middleware in ``api/__init__.py`` awaits :func:`flush_elo_recalculation`
after every request, before the response goes out, so callers never have to
remember to recalculate.  Code that needs the new ratings mid-request (e.g. to
seed club roster rows) may await the flush itself.

The flush replays only what can change: a tournament is replayed when its
starting ratings would differ from the stored ones, and the change propagates
to later tournaments only through profiles whose results actually moved.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Collection

from backend.tournaments.elo import DEFAULT_RATING

from .db import get_db
from .elo_integration import elo_recalculate_tournament
from .elo_store import (
    _get_linked_profiles,
    get_pretournament_seed,
    get_tournament_elo_snapshots,
    get_tournament_elos,
    get_tournament_match_counts,
    refresh_profile_elo,
    tournaments_in_chronological_order,
)
from .player_merge import profile_tournament_ids
from .state import _tournaments, get_tournament_lock

logger = logging.getLogger(__name__)

_pending_lock = threading.Lock()
_pending_profiles: set[str] = set()  # profiles whose participations changed
_pending_whole_profiles: set[str] = set()  # ...and every tournament they own counts as changed
_pending_tournaments: set[str] = set()  # tournaments whose links changed
_pending_reseed: set[str] = set()  # player_ids whose stored starting rating is stale

# One flush at a time: two interleaved replays could each read the other's
# half-written chain.
_flush_lock = asyncio.Lock()


def mark_elo_dirty(
    profile_ids: Collection[str | None],
    tournament_ids: Collection[str] | None = None,
    reseed_player_ids: Collection[str] = (),
) -> None:
    """Record that participations of *profile_ids* changed; recalculated on the next flush.

    Args:
        profile_ids: Every profile that gained or lost a participation
            (``None`` entries, e.g. "was unlinked", are ignored).
        tournament_ids: The tournaments whose links changed.  ``None`` means
            all tournaments the profiles own at flush time — for merges and
            sweeping claims where many participations move at once.
        reseed_player_ids: Participants whose stored starting rating came from
            a profile they no longer belong to.  They restart from their new
            profile's earlier tournaments, or ``DEFAULT_RATING``.
    """
    profiles = {pid for pid in profile_ids if pid}
    with _pending_lock:
        _pending_profiles.update(profiles)
        if tournament_ids is None:
            _pending_whole_profiles.update(profiles)
        else:
            _pending_tournaments.update(tournament_ids)
        _pending_reseed.update(reseed_player_ids)


async def flush_elo_recalculation() -> None:
    """Apply every pending :func:`mark_elo_dirty` change (no-op when nothing is pending)."""
    if not (_pending_profiles or _pending_tournaments):
        return
    async with _flush_lock:
        with _pending_lock:
            profiles = set(_pending_profiles)
            whole = set(_pending_whole_profiles)
            tournaments = set(_pending_tournaments)
            reseed = set(_pending_reseed)
            for pending in (_pending_profiles, _pending_whole_profiles, _pending_tournaments, _pending_reseed):
                pending.clear()
        if not profiles and not tournaments:
            return
        try:
            await _recalculate(profiles, whole, tournaments, reseed)
        except Exception:
            logger.exception("ELO recalculation after a link change failed")


async def _recalculate(profiles: set[str], whole: set[str], tournaments: set[str], reseed: set[str]) -> None:
    with get_db() as conn:
        existing = {
            r["id"]
            for r in conn.execute(
                f"SELECT id FROM player_profiles WHERE id IN ({','.join('?' for _ in profiles)})",
                list(profiles),
            ).fetchall()
        }
        owners: set[str] = set()
        for profile_id in whole & existing:
            owned = profile_tournament_ids(conn, profile_id)
            tournaments.update(owned)
            if owned:
                owners.add(profile_id)

    ordered = await asyncio.to_thread(tournaments_in_chronological_order)
    start = next((i for i, tid in enumerate(ordered) if tid in tournaments), None)
    if start is not None:
        dirty = set(existing)
        for tid in ordered[start:]:
            if tid in _tournaments:
                async with get_tournament_lock(tid):
                    if tid in _tournaments:
                        await asyncio.to_thread(_replay_if_needed, tid, tournaments, reseed, dirty)

    # Profiles that lost a participation are no longer linked to that
    # tournament, so its replay does not refresh them.  Deleted profiles
    # (merged away in the same request) are skipped.
    for profile_id in existing:
        if profile_id in whole and profile_id not in owners:
            continue  # e.g. a brand-new profile that linked nothing: leave its rows alone
        await asyncio.to_thread(refresh_profile_elo, profile_id)


def _replay_if_needed(tid: str, changed: set[str], reseed: set[str], dirty: set[str]) -> None:
    """Replay *tid* if its starting ratings changed; grow *dirty* with profiles whose results moved."""
    sport = _tournaments[tid].get("sport", "padel")
    linked = {r["player_id"]: r["profile_id"] for r in _get_linked_profiles(tid) if r["profile_id"]}
    if tid not in changed and not dirty & set(linked.values()):
        return

    snapshot = get_tournament_elo_snapshots(tid, sport)
    reseed_here = reseed & set(snapshot)
    expected = dict(snapshot)
    for player_id in reseed_here:
        expected[player_id] = (DEFAULT_RATING, 0)
    expected.update(get_pretournament_seed(tid, sport))
    if expected == snapshot:
        return  # same starting ratings, same matches: same results

    before_elos = get_tournament_elos(tid, sport)
    before_counts = get_tournament_match_counts(tid, sport)
    elo_recalculate_tournament(tid, reseed_here)
    after_elos = get_tournament_elos(tid, sport)
    after_counts = get_tournament_match_counts(tid, sport)
    for player_id, profile_id in linked.items():
        moved = (before_elos.get(player_id), before_counts.get(player_id)) != (
            after_elos.get(player_id),
            after_counts.get(player_id),
        )
        if moved:
            dirty.add(profile_id)
