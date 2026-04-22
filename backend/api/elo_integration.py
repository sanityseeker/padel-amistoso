"""ELO integration helpers for tournament routes.

Bridges the pure ELO engine with the DB persistence layer.  Provides
high-level functions that route handlers call after score recording,
tournament creation, and tournament finish.
"""

from __future__ import annotations

import logging
from typing import Any

from backend.models import Match, MatchStatus, TournamentType
from backend.tournaments.elo import compute_match_elo_updates, get_k_factor

from .elo_store import (
    bulk_transfer_elos_to_profiles,
    get_k_factor_overrides,
    get_tournament_elo_snapshots,
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

_MEX_ELO_POINTS_BASELINE = 32


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
        mex_k_multiplier = _mexicano_k_multiplier(data)

        # If this player already has a match counted, it's a re-recording -> recalculate
        all_player_ids = [p.id for p in match.team1 + match.team2]
        if any(counts.get(pid, 0) > 0 for pid in all_player_ids):
            # Check if this match was already processed (re-recording scenario)
            # by seeing if any player's count increased already for this match
            elo_recalculate_tournament(tid)
            return

        effective_k_overrides = _build_effective_k_overrides(match, counts, k_overrides, mex_k_multiplier)
        updates = compute_match_elo_updates(match, ratings, counts, team_mode, effective_k_overrides)
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
    mex_k_multiplier = _mexicano_k_multiplier(data)

    all_matches = _extract_completed_matches(tournament, ttype)
    if not all_matches:
        return

    team_mode = _is_team_mode(tournament, ttype)
    player_ids = _extract_player_ids(tournament, ttype)

    try:
        # Snapshot original starting state before wiping rows
        snapshots = get_tournament_elo_snapshots(tournament_id, sport)
        saved_elos = {pid: elo for pid, (elo, _cnt) in snapshots.items()}
        saved_counts = {pid: cnt for pid, (_elo, cnt) in snapshots.items()}

        # Reset and re-seed with the saved pre-tournament values
        reset_tournament_elos(tournament_id, sport)
        reset_tournament_elo_logs(tournament_id, sport)
        initialize_tournament_elos(
            tournament_id,
            player_ids,
            sport,
            elo_overrides=saved_elos,
            match_count_overrides=saved_counts,
        )

        k_overrides = get_k_factor_overrides(tournament_id)

        # Replay all matches in order
        for idx, match in enumerate(all_matches, start=1):
            ratings = get_tournament_elos(tournament_id, sport)
            counts = get_tournament_match_counts(tournament_id, sport)
            effective_k_overrides = _build_effective_k_overrides(match, counts, k_overrides, mex_k_multiplier)
            updates = compute_match_elo_updates(match, ratings, counts, team_mode, effective_k_overrides)
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
    """Get all player IDs from a tournament.

    Merges multiple sources so that no participant is missed:

    * ``tournament.players`` — the current active roster
    * ``tournament._removed_players`` — players removed mid-tournament
      whose completed matches are still part of the record
    * ``tournament.original_teams`` — Playoff team rosters
    * Match participants — fallback that catches any edge case
    """
    seen: dict[str, None] = {}

    if hasattr(tournament, "players"):
        for p in tournament.players:  # type: ignore[attr-defined]
            seen.setdefault(p.id, None)

    # Include removed players (Mexicano supports mid-tournament removal)
    if hasattr(tournament, "_removed_players"):
        for p in tournament._removed_players:  # type: ignore[attr-defined]
            seen.setdefault(p.id, None)

    # Playoff: teams stored as list[list[Player]]
    if hasattr(tournament, "original_teams"):
        for team in tournament.original_teams:  # type: ignore[attr-defined]
            for p in team:
                seen.setdefault(p.id, None)

    # Always scan matches too — catches players added/moved in unexpected ways
    for m in _extract_completed_matches(tournament, ttype):
        for p in m.team1 + m.team2:
            seen.setdefault(p.id, None)

    return list(seen)


def _mexicano_k_multiplier(data: dict[str, Any]) -> float:
    """Return a Mexicano-only K multiplier based on match length.

    Smaller Mexicano matches (fewer total points) should move ELO less.
    Uses ``total_points_per_match / 32`` capped to ``[0, 1]``.
    """
    if data.get("type") != TournamentType.MEXICANO:
        return 1.0

    tournament = data.get("tournament")
    total_points = getattr(tournament, "total_points_per_match", _MEX_ELO_POINTS_BASELINE)
    if not isinstance(total_points, int) or total_points <= 0:
        return 1.0

    return min(1.0, max(0.0, total_points / _MEX_ELO_POINTS_BASELINE))


def _build_effective_k_overrides(
    match: Match,
    match_counts: dict[str, int],
    k_overrides: dict[str, int],
    multiplier: float,
) -> dict[str, int]:
    """Build per-player K overrides with optional multiplier scaling."""
    if multiplier >= 1.0:
        return k_overrides

    effective: dict[str, int] = {}
    for player in match.team1 + match.team2:
        count = match_counts.get(player.id, 0)
        base_k = k_overrides.get(player.id, get_k_factor(count))
        effective[player.id] = max(1, int(round(base_k * multiplier)))
    return effective
