"""ELO integration helpers for tournament routes.

Bridges the pure ELO engine with the DB persistence layer.  Provides
high-level functions that route handlers call after score recording,
tournament creation, and tournament finish.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.models import Match, MatchStatus, TournamentType
from backend.tournaments.elo import compute_match_elo_updates

from .elo_store import (
    bulk_transfer_elos_to_profiles,
    get_k_factor_overrides,
    upsert_tournament_elo_log,
    get_tournament_elos,
    get_tournament_match_counts,
    initialize_tournament_elos,
    reset_tournament_elos,
    reset_tournament_elo_logs,
    sync_live_elos_to_profiles,
    upsert_tournament_elo,
)
from .state import _tournaments

logger = logging.getLogger(__name__)


def elo_after_score(tid: str, data: dict[str, Any], match: Match) -> None:
    """Update ELO after a match score is finalized.

    Safe to call even if the match is not yet completed (no-ops).
    On score corrections (re-recording), triggers a full recalculation.
    """
    if match.status != MatchStatus.COMPLETED or match.score is None:
        return

    sport = data.get("sport", "padel")
    ttype = data.get("type", "")
    team_mode = _is_team_mode(data["tournament"], ttype)

    try:
        ratings = get_tournament_elos(tid, sport)
        counts = get_tournament_match_counts(tid, sport)
        k_overrides = get_k_factor_overrides(tid)

        # If this player already has a match counted, it's a re-recording -> recalculate
        all_player_ids = [p.id for p in match.team1 + match.team2]
        if any(counts.get(pid, 0) > 0 for pid in all_player_ids):
            # Check if this match was already processed (re-recording scenario)
            # by seeing if any player's count increased already for this match
            elo_recalculate_tournament(tid)
            return

        updates = compute_match_elo_updates(match, ratings, counts, team_mode, k_overrides)
        upsert_tournament_elo(tid, updates, sport)
        upsert_tournament_elo_log(
            tid,
            match,
            updates,
            sport,
            match_order=max((u.matches_after for u in updates), default=0),
        )
        sync_live_elos_to_profiles(tid, sport)
    except Exception:
        logger.exception("Failed to update ELO for match %s in tournament %s", match.id, tid)


def elo_recalculate_tournament(tournament_id: str) -> None:
    """Full ELO recalculation from all completed matches in a tournament.

    Used after score corrections to ensure consistency.
    """
    data = _tournaments.get(tournament_id)
    if data is None:
        return

    tournament = data["tournament"]
    sport = data.get("sport", "padel")
    ttype = data.get("type", "")

    all_matches = _extract_completed_matches(tournament, ttype)
    if not all_matches:
        return

    team_mode = _is_team_mode(tournament, ttype)
    player_ids = _extract_player_ids(tournament, ttype)

    try:
        # Reset and re-seed
        reset_tournament_elos(tournament_id, sport)
        reset_tournament_elo_logs(tournament_id, sport)
        initialize_tournament_elos(tournament_id, player_ids, sport)

        k_overrides = get_k_factor_overrides(tournament_id)

        # Replay all matches in order
        for idx, match in enumerate(all_matches, start=1):
            ratings = get_tournament_elos(tournament_id, sport)
            counts = get_tournament_match_counts(tournament_id, sport)
            updates = compute_match_elo_updates(match, ratings, counts, team_mode, k_overrides)
            upsert_tournament_elo(tournament_id, updates, sport)
            upsert_tournament_elo_log(tournament_id, match, updates, sport, match_order=idx)
        sync_live_elos_to_profiles(tournament_id, sport)
    except Exception:
        logger.exception("Failed to recalculate ELO for tournament %s", tournament_id)


def elo_init_tournament(tournament_id: str, player_ids: list[str], sport: str) -> None:
    """Seed ELO rows when a tournament is created."""
    try:
        initialize_tournament_elos(tournament_id, player_ids, sport)
    except Exception:
        logger.exception("Failed to initialize ELO for tournament %s", tournament_id)


def elo_finish_tournament(tournament_id: str) -> None:
    """Transfer final ELO ratings to player profiles when a tournament finishes."""
    data = _tournaments.get(tournament_id)
    if data is None:
        return
    sport = data.get("sport", "padel")
    try:
        bulk_transfer_elos_to_profiles(tournament_id, sport)
    except Exception:
        logger.exception("Failed to transfer ELO to profiles for tournament %s", tournament_id)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _extract_completed_matches(tournament: object, ttype: str) -> list[Match]:
    """Return all completed matches from any tournament type, in play order."""
    matches: list[Match] = []

    if ttype == TournamentType.MEXICANO:
        for round_matches in tournament.rounds:  # type: ignore[attr-defined]
            matches.extend(round_matches)
        if hasattr(tournament, "playoff_bracket") and tournament.playoff_bracket:  # type: ignore[attr-defined]
            bracket = tournament.playoff_bracket  # type: ignore[attr-defined]
            if hasattr(bracket, "all_matches"):
                matches.extend(bracket.all_matches)
            else:
                matches.extend(bracket.matches)

    elif ttype == TournamentType.GROUP_PLAYOFF:
        for group in tournament.groups:  # type: ignore[attr-defined]
            matches.extend(group.matches)
        if hasattr(tournament, "playoff_bracket") and tournament.playoff_bracket:  # type: ignore[attr-defined]
            bracket = tournament.playoff_bracket  # type: ignore[attr-defined]
            if hasattr(bracket, "all_matches"):
                matches.extend(bracket.all_matches)
            else:
                matches.extend(bracket.matches)

    elif ttype == TournamentType.PLAYOFF:
        bracket = tournament.bracket  # type: ignore[attr-defined]
        if hasattr(bracket, "all_matches"):
            matches.extend(bracket.all_matches)
        else:
            matches.extend(bracket.matches)

    return [m for m in matches if m.status == MatchStatus.COMPLETED and m.score is not None]


def _is_team_mode(tournament: object, ttype: str) -> bool:
    """Determine if the tournament uses team mode (2v2 fixed pairs)."""
    if hasattr(tournament, "team_mode"):
        return tournament.team_mode  # type: ignore[attr-defined]
    return False


def _extract_player_ids(tournament: object, ttype: str) -> list[str]:
    """Get all player IDs from a tournament."""
    if hasattr(tournament, "players"):
        return [p.id for p in tournament.players]  # type: ignore[attr-defined]
    return []
