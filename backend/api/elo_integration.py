"""ELO integration helpers for tournament routes.

Bridges the pure ELO engine with the DB persistence layer.  Provides
high-level functions that route handlers call after score recording,
tournament creation, and tournament finish.
"""

from __future__ import annotations

import copy
import logging
from typing import Any

from backend.models import Match, MatchStatus, Player, TournamentType
from backend.tournaments.elo import (
    SCORE_FORMAT_WEIGHTS,
    EloScoreFormat,
    classify_score_format,
)

from .elo_store import (
    initialize_tournament_elos,
    has_match_elo_log,
)
from .leaderboard_cache import invalidate_mini_card_cache
from .state import _tournaments

logger = logging.getLogger(__name__)

_MEX_ELO_POINTS_BASELINE = 32


def _elo_after_score(tid: str, data: dict[str, Any], match: Match) -> None:
    """Update ELO after a match score is finalized.

    Safe to call even if the match is not yet completed (no-ops).  A new result
    is rated from its players' latest community ratings; a corrected score, or a
    result older than a player's latest rated match, replays the community
    (:mod:`.community_elo`).
    """
    if match.status != MatchStatus.COMPLETED or match.score is None:
        return
    if getattr(match, "walkover", False):
        return  # walkovers are never rated

    from .club_elo import rate_new_club_match  # noqa: PLC0415 — club_elo imports this module
    from .community_elo import rate_new_match  # noqa: PLC0415 — community_elo imports this module

    sport = data.get("sport", "padel")
    match = expand_composite_sides(data["tournament"], match)
    try:
        # A match that already has log rows is being re-recorded (score
        # correction): later matches of its players must pick up the change.
        if not has_match_elo_log(tid, match.id, sport) and rate_new_match(tid, data, match, sport):
            rate_new_club_match(tid, match, sport)
            return
    except Exception:
        logger.exception("Failed to update ELO for match %s in tournament %s", match.id, tid)
        return
    _elo_recalculate_tournament(tid)


def _elo_recalculate_tournament(tournament_id: str) -> None:
    """Replay the rating chain of the tournament's community (and its clubs).

    Used after score corrections and cleared results.  Every tournament of the
    community is re-rated in play order, see :func:`.community_elo.replay_community`.
    """
    from .community_elo import community_of, replay_community  # noqa: PLC0415

    if tournament_id not in _tournaments:
        return
    replay_community(community_of(tournament_id))


def elo_init_tournament(tournament_id: str, player_ids: list[str], sport: str) -> None:
    """Seed ELO rows when a tournament is created."""
    try:
        initialize_tournament_elos(tournament_id, player_ids, sport)
    except Exception:
        logger.exception("Failed to initialize ELO for tournament %s", tournament_id)


def _elo_finish_tournament(tournament_id: str) -> None:
    """Write each linked player's span in the finished tournament to their history line."""
    data = _tournaments.get(tournament_id)
    if data is None:
        return
    sport = data.get("sport", "padel")
    from .db import get_db  # noqa: PLC0415

    try:
        with get_db() as conn:
            conn.execute(
                """UPDATE player_history
                      SET elo_before = (SELECT pe.elo_before FROM player_elo pe
                                         WHERE pe.tournament_id = player_history.entity_id
                                           AND pe.player_id = player_history.player_id AND pe.sport = ?),
                          elo_after = (SELECT pe.elo_after FROM player_elo pe
                                        WHERE pe.tournament_id = player_history.entity_id
                                          AND pe.player_id = player_history.player_id AND pe.sport = ?)
                    WHERE entity_type = 'tournament' AND entity_id = ? AND profile_id IS NOT NULL
                      AND EXISTS (SELECT 1 FROM player_elo pe WHERE pe.tournament_id = player_history.entity_id
                                    AND pe.player_id = player_history.player_id AND pe.sport = ?)""",
                (sport, sport, tournament_id, sport),
            )
    except Exception:
        logger.exception("Failed to write ELO history for tournament %s", tournament_id)


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

    # Walkovers (a side withdrew) are results for standings, never for ratings.
    return [
        expand_composite_sides(tournament, m)
        for m in matches
        if m.status == MatchStatus.COMPLETED and m.score is not None and not getattr(m, "walkover", False)
    ]


def expand_composite_sides(tournament: object, match: Match) -> Match:
    """Return *match* with composite team entries replaced by their members.

    In GP / Mexicano team mode with admin-composed teams, each match side holds
    one synthetic team ``Player`` whose id maps to the real members in
    ``tournament.team_roster``.  Ratings belong to the individuals (who hold the
    passphrases and Hub links), so they are rated as a 2v2 between the members.
    Returns *match* itself when it has no composite entry; otherwise a shallow
    copy, so the tournament's own match objects are never modified.
    """
    roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
    if not roster or not any(p.id in roster for p in match.team1 + match.team2):
        return match
    member_names: dict[str, list[str]] = getattr(tournament, "team_member_names", None) or {}

    def expand(side: list[Player]) -> list[Player]:
        out: list[Player] = []
        for p in side:
            members = roster.get(p.id)
            if not members:
                out.append(p)
                continue
            names = member_names.get(p.id) or []
            out.extend(Player(name=names[i] if i < len(names) else mid, id=mid) for i, mid in enumerate(members))
        return out

    expanded = copy.copy(match)
    expanded.team1 = expand(match.team1)
    expanded.team2 = expand(match.team2)
    return expanded


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

    # Withdrawn entries (a G1-annulled entry is no longer in ``players``) keep
    # their tournament row at the seed.
    for record in (getattr(tournament, "withdrawals", None) or {}).values():
        for p in record.entry:
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

    # Composite team entries are rated through their members, never as a unit.
    roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
    ids: dict[str, None] = {}
    for pid in seen:
        for member in roster.get(pid) or [pid]:
            ids.setdefault(member, None)
    return list(ids)


def _mexicano_length_factor(data: dict[str, Any], match: Match | None = None) -> float:
    """Return the Mexicano match-length factor ``min(1, points target / 32)``.

    ``points target`` is the match's organiser-set ``format_override.points_target``
    when present, otherwise the tournament's ``total_points_per_match``.  It is the
    configured target, not the points actually played.  Non-Mexicano data gives 1.0.
    """
    if data.get("type") != TournamentType.MEXICANO:
        return 1.0

    tournament = data.get("tournament")
    total_points = getattr(tournament, "total_points_per_match", _MEX_ELO_POINTS_BASELINE)
    override = getattr(match, "format_override", None) if match is not None else None
    if override is not None and override.points_target:
        total_points = override.points_target
    if not isinstance(total_points, int) or total_points <= 0:
        return 1.0

    return min(1.0, max(0.0, total_points / _MEX_ELO_POINTS_BASELINE))


def elo_match_weight(data: dict[str, Any], match: Match) -> float:
    """Return the ELO delta weight of *match*: score-format weight, then length factor.

    Used by the community/global chain and the club chain so both give the same
    delta for the same match.  The Mexicano length factor only scales matches
    scored in points; a Mexicano match scored in sets is not length-scaled.
    """
    score_format = classify_score_format(match)
    weight = SCORE_FORMAT_WEIGHTS[score_format]
    if score_format == EloScoreFormat.POINTS:
        weight *= _mexicano_length_factor(data, match)
    return weight


def _invalidate_cards(tid: str) -> None:
    """Drop cached cards a rating change can affect: the event's cards and every profile card."""
    invalidate_mini_card_cache(("tournament", tid))
    invalidate_mini_card_cache(("profile",))


def elo_after_score(tid: str, data: dict[str, Any], match: Match) -> None:
    """Update ELO after a match score is finalized (see :func:`_elo_after_score`)."""
    try:
        _elo_after_score(tid, data, match)
    finally:
        _invalidate_cards(tid)


def elo_recalculate_tournament(tournament_id: str) -> None:
    """Full ELO recalculation of a tournament's community (see :func:`_elo_recalculate_tournament`)."""
    try:
        _elo_recalculate_tournament(tournament_id)
    finally:
        _invalidate_cards(tournament_id)


def elo_finish_tournament(tournament_id: str) -> None:
    """Transfer final ratings to profiles (see :func:`_elo_finish_tournament`)."""
    try:
        _elo_finish_tournament(tournament_id)
    finally:
        _invalidate_cards(tournament_id)
