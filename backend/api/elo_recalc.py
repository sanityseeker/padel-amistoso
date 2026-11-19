"""ELO recalculation after a participation changes Player Hub profile.

A linked participant rates on their profile's community chain; an unlinked one
on a chain of its own.  Linking, unlinking, re-linking, ghost creation and
profile merges therefore change ratings -- not only the profile's own, but
every opponent's later in the same community.  This module is the single place
that brings ratings back in line after such a change.

Usage: code that changes which profile a participation belongs to calls
:func:`mark_elo_dirty` (plain sync, safe from any thread or transaction).  The
HTTP middleware in ``api/__init__.py`` awaits :func:`flush_elo_recalculation`
after every request, before the response goes out, so callers never have to
remember to recalculate.  Code that needs the new ratings mid-request (e.g. to
seed club roster rows) may await the flush itself.

The flush replays each community the changed participations rate in, once
(:func:`.community_elo.replay_community`, which also replays their clubs), then
rebuilds the stored ratings of every profile involved.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Collection

from .club_elo import deferred_club_elo, recompute_club_elo_for_tournaments
from .community_elo import communities_of, replay_communities
from .db import get_db
from .elo_store import refresh_profile_elo
from .leaderboard_cache import invalidate_mini_card_cache
from .player_merge import profile_tournament_ids

logger = logging.getLogger(__name__)

_pending_lock = threading.Lock()
_pending_profiles: set[str] = set()  # profiles whose participations changed
_pending_whole_profiles: set[str] = set()  # ...and every tournament they own counts as changed
_pending_tournaments: set[str] = set()  # tournaments whose links changed

# One flush at a time: two interleaved replays could each read the other's
# half-written chain.
_flush_lock = asyncio.Lock()


def mark_elo_dirty(
    profile_ids: Collection[str | None],
    tournament_ids: Collection[str] | None = None,
) -> None:
    """Record that participations of *profile_ids* changed; recalculated on the next flush.

    Args:
        profile_ids: Every profile that gained or lost a participation
            (``None`` entries, e.g. "was unlinked", are ignored).
        tournament_ids: The tournaments whose links changed.  ``None`` means
            all tournaments the profiles own at flush time — for merges and
            sweeping claims where many participations move at once.
    """
    profiles = {pid for pid in profile_ids if pid}
    with _pending_lock:
        _pending_profiles.update(profiles)
        if tournament_ids is None:
            _pending_whole_profiles.update(profiles)
        else:
            _pending_tournaments.update(tournament_ids)


async def flush_elo_recalculation() -> None:
    """Apply every pending :func:`mark_elo_dirty` change (no-op when nothing is pending)."""
    if not (_pending_profiles or _pending_tournaments):
        return
    async with _flush_lock:
        with _pending_lock:
            profiles = set(_pending_profiles)
            whole = set(_pending_whole_profiles)
            tournaments = set(_pending_tournaments)
            for pending in (_pending_profiles, _pending_whole_profiles, _pending_tournaments):
                pending.clear()
        if not profiles and not tournaments:
            return
        try:
            # Each replayed community would replay its clubs; do every club once.
            with deferred_club_elo():
                await _recalculate(profiles, whole, tournaments)
                # A link change moves the club chain even when the community chain stays the same.
                recompute_club_elo_for_tournaments(tournaments)
        except Exception:
            logger.exception("ELO recalculation after a link change failed")
        finally:
            # A link change moves ratings and decides whether a participant has a profile card.
            invalidate_mini_card_cache(("tournament",))
            invalidate_mini_card_cache(("profile",))


async def _recalculate(profiles: set[str], whole: set[str], tournaments: set[str]) -> None:
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

    communities = communities_of(tournaments)
    if communities:
        await asyncio.to_thread(replay_communities, communities)

    # Profiles that lost a participation are no longer linked to that
    # tournament, so no replay refreshes them.  Deleted profiles (merged away
    # in the same request) are skipped.
    for profile_id in existing:
        if profile_id in whole and profile_id not in owners:
            continue  # e.g. a brand-new profile that linked nothing: leave its rows alone
        await asyncio.to_thread(refresh_profile_elo, profile_id)
