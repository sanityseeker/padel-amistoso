"""
Shared helpers for route modules.
"""

from __future__ import annotations

import time
from collections import defaultdict
from typing import Any, Literal

from fastapi import HTTPException
from fastapi.responses import Response

from ..auth.deps import PlayerIdentity
from ..auth.models import User, UserRole
from ..models import Match, MatchStatus
from .db import get_co_editors
from .state import _tournaments, _save_tournament

# MIME types for the three supported image/document formats.
_SCHEMA_MEDIA_TYPES: dict[str, str] = {
    "png": "image/png",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
}


def _schema_image_response(img: bytes, fmt: Literal["png", "svg", "pdf"]) -> Response:
    """Wrap rendered image bytes in the correct FastAPI Response."""
    return Response(content=img, media_type=_SCHEMA_MEDIA_TYPES[fmt])


def _store_tournament(
    tid: str,
    *,
    name: str,
    tournament_type: str,
    tournament: object,
    owner: str,
    public: bool,
    sport: str,
    assign_courts: bool,
) -> None:
    """Insert a tournament into the in-memory store and persist to DB."""
    _tournaments[tid] = {
        "name": name,
        "type": tournament_type,
        "tournament": tournament,
        "owner": owner,
        "public": public,
        "sport": sport,
        "assign_courts": assign_courts,
    }
    _save_tournament(tid)


def _is_bye_match(m: Match) -> bool:
    """Return True if *m* is a bye (auto-resolved without play)."""
    return m.status == MatchStatus.COMPLETED and m.score is None


def _serialize_match(m: Match) -> dict:
    """Convert a Match dataclass to a JSON-friendly dict."""
    return {
        "id": m.id,
        "team1": [p.name for p in m.team1],
        "team2": [p.name for p in m.team2],
        "team1_ids": [p.id for p in m.team1],
        "team2_ids": [p.id for p in m.team2],
        "court": m.court.name if m.court else None,
        "status": m.status.value,
        "score": list(m.score) if m.score else None,
        "sets": [list(s) for s in m.sets] if m.sets else None,
        "third_set_loss": m.third_set_loss,
        "slot_number": m.slot_number,
        "round_number": m.round_number,
        "round_label": m.round_label,
        "comment": m.comment or "",
        # Score lifecycle fields
        "scored_by": getattr(m, "scored_by", None),
        "scored_at": getattr(m, "scored_at", None),
        "score_confirmed": getattr(m, "score_confirmed", False),
        "disputed": getattr(m, "disputed", False),
        "dispute_score": list(m.dispute_score) if getattr(m, "dispute_score", None) else None,
        "dispute_sets": [list(s) for s in m.dispute_sets] if getattr(m, "dispute_sets", None) else None,
        "dispute_by": getattr(m, "dispute_by", None),
        "dispute_at": getattr(m, "dispute_at", None),
        "dispute_escalated": getattr(m, "dispute_escalated", False),
    }


def _get_tournament(tid: str, expected_type: str) -> dict:
    """Look up a tournament by ID and verify its type, or raise 404."""
    data = _tournaments.get(tid)
    if not data or data["type"] != expected_type:
        raise HTTPException(404, "Not found")
    return data


def _require_owner_or_admin(tid: str, user: User) -> None:
    """Raise 403 if *user* neither owns the tournament nor is an admin.

    Use this only for destructive or share-management operations that should
    be restricted to the original owner.  For general editing, prefer
    ``_require_editor_access``.
    """
    data = _tournaments.get(tid)
    if data is None:
        raise HTTPException(404, "Tournament not found")
    if user.role == UserRole.ADMIN:
        return
    if data.get("owner") != user.username:
        raise HTTPException(403, "You do not have permission to modify this tournament")


def _require_editor_access(tid: str, user: User) -> None:
    """Raise 403 if *user* may not edit the tournament.

    Allowed callers:
    - Admin users (bypass all ownership checks)
    - The tournament owner
    - Users that have been granted co-editor access via ``tournament_shares``
    """
    data = _tournaments.get(tid)
    if data is None:
        raise HTTPException(404, "Tournament not found")
    if user.role == UserRole.ADMIN:
        return
    if data.get("owner") == user.username:
        return
    if user.username in get_co_editors(tid):
        return
    raise HTTPException(403, "You do not have permission to modify this tournament")


def _require_score_permission(
    tid: str,
    match: Match,
    user: User | None,
    player: PlayerIdentity | None,
) -> None:
    """Raise 403 unless the caller may record a score for *match*.

    Allowed callers:
    - Admin users
    - The tournament owner
    - An authenticated player who is a participant in the match
      (only when ``allow_player_scoring`` is enabled in TV settings)
    """
    # Admin, owner, or co-editor
    if user is not None:
        data = _tournaments.get(tid)
        if data is None:
            raise HTTPException(404, "Tournament not found")
        if user.role == UserRole.ADMIN:
            return
        if data.get("owner") == user.username:
            return
        if user.username in get_co_editors(tid):
            return

    # Player in the match — only allowed when player scoring is enabled
    if player is not None and player.tournament_id == tid:
        tv_settings = _tournaments.get(tid, {}).get("tv_settings") or {}
        if not tv_settings.get("allow_player_scoring", True):
            raise HTTPException(403, "Player score submission is disabled for this tournament")
        match_player_ids = {p.id for p in match.team1} | {p.id for p in match.team2}
        if player.player_id in match_player_ids:
            return
        # Check composite team roster — the player may be a member of a
        # synthetic team entry that appears in the match.
        tournament = _tournaments.get(tid, {}).get("tournament")
        team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
        if team_roster:
            for team_pid in match_player_ids:
                if player.player_id in team_roster.get(team_pid, []):
                    return

    raise HTTPException(403, "You do not have permission to record this score")


def _find_match(tournament: object, match_id: str) -> Match | None:
    """Look up a ``Match`` by ID across all match sources in a tournament.

    Works for Mexicano, Group+Playoff, and standalone Playoff tournaments
    by inspecting whichever accessors exist on *tournament*.
    """
    for accessor in ("all_matches", "current_round_matches", "playoff_matches"):
        fn = getattr(tournament, accessor, None)
        if fn is None:
            continue
        for m in fn():
            if m.id == match_id:
                return m
    # Group+Playoff: iterate group matches directly.
    for group in getattr(tournament, "groups", []):
        for m in getattr(group, "matches", []):
            if m.id == match_id:
                return m
    # Playoff bracket matches.
    bracket = getattr(tournament, "bracket", None) or getattr(tournament, "playoff_bracket", None)
    if bracket is not None:
        for accessor in ("pending_matches",):
            fn = getattr(bracket, accessor, None)
            if fn:
                for m in fn():
                    if m.id == match_id:
                        return m
    return None


def _check_read_access(tid: str, user: User | None) -> None:
    """Raise 403 if a guest or regular user should not read this tournament.

    - Admins always have access.
    - Authenticated owners always have access.
    - Everyone else (guests or non-owners) can only access public tournaments.
      Non-public tournaments are still accessible by direct link (ID), so no
      restriction is applied here for read endpoints — private means only
      hidden from the listing, not fully locked behind auth.
    """
    # This helper intentionally does nothing: private tournaments are
    # accessible by direct link to anyone (requirement: "access should only
    # be provided with a link"). Filtering only happens in the list endpoint.
    return


def _tennis_sets_to_scores(
    sets: list[list[int]],
) -> tuple[int, int, list[tuple[int, int]], bool]:
    """Convert raw set scores to total game counts and typed tuples.

    When both teams have accumulated equal game totals the winner is
    determined by sets won and their count is incremented by 1 so that
    no draw is recorded.  The fourth return value is True whenever exactly
    three sets were played (i.e. the match went to a deciding 3rd set),
    regardless of whether the total-game adjustment was needed.

    Returns:
        Tuple of (total_games_team1, total_games_team2, sets_as_tuples,
        decided_by_third_set).
    """
    sets_tuples = [tuple(s) for s in sets]
    total1 = sum(s[0] for s in sets_tuples)
    total2 = sum(s[1] for s in sets_tuples)
    sets1_won = sum(1 for s in sets_tuples if s[0] > s[1])
    sets2_won = sum(1 for s in sets_tuples if s[1] > s[0])
    decided_by_third_set = len(sets_tuples) == 3
    # Ensure the set-winner always has a higher game total so that
    # Match.winner_team (which compares score[0] vs score[1]) returns
    # the correct team.  The winner is whoever won more *sets*, not
    # whoever accumulated more games.
    if sets1_won > sets2_won and total1 <= total2:
        total1 = total2 + 1
    elif sets2_won > sets1_won and total2 <= total1:
        total2 = total1 + 1
    return total1, total2, sets_tuples, decided_by_third_set


def _build_match_labels(bracket: object) -> dict[str, dict]:
    """Build a match_labels dict keyed by viz graph node ID.

    Keys match the node IDs created by bracket builders in bracket_schema.py:
    - Single-elim matches: ``"match_r{r}_p{p}"`` (r and p are 0-based)
    - Double-elim winners matches: ``"w_r{r}_p{p}"``
    - Double-elim losers matches: ``"l_{i}"`` (sequential index across all losers matches)
    - Double-elim grand final: ``"grand_final"``

    Args:
        bracket: A ``SingleEliminationBracket`` or ``DoubleEliminationBracket`` instance.

    Returns:
        Dict mapping node IDs to ``{team1, team2, score, round}`` dicts.
    """

    def _fmt_team(team: list) -> str:
        return " & ".join(p.name for p in team) if team else "TBD"

    def _fmt_score(m: object) -> str | None:
        if m.sets:
            return "  ".join(f"{s[0]}-{s[1]}" for s in m.sets)
        return f"{m.score[0]}–{m.score[1]}" if m.score else None

    def _label_round_matches(match_list: list, prefix: str) -> None:
        """Group *match_list* by round, then write labels keyed ``{prefix}_r{r}_p{p}``."""
        by_round: defaultdict[int, list] = defaultdict(list)
        for m in match_list:
            by_round[m.round_number].append(m)
        for round_num, rmatches in sorted(by_round.items()):
            r = round_num - 1
            for p_idx, m in enumerate(rmatches):
                # Use the stored bracket pair_index when available so the key
                # matches the viz node ID (which uses the actual slot position
                # including bye slots, not a sequential non-bye count).
                key_p = m.pair_index if m.pair_index >= 0 else p_idx
                entry: dict = {
                    "team1": _fmt_team(m.team1),
                    "team2": _fmt_team(m.team2),
                    "score": _fmt_score(m),
                    "round": m.round_label,
                }
                # Include loser info so the viz can draw data-driven loss edges.
                loser = m.loser_team
                if loser:
                    entry["loser"] = _fmt_team(loser)
                labels[f"{prefix}_r{r}_p{key_p}"] = entry

    labels: dict[str, dict] = {}

    if hasattr(bracket, "winners_matches"):
        _label_round_matches(bracket.winners_matches, "w")
        idx = 0
        for m in bracket.losers_matches:
            # Skip bye matches (auto-completed without both teams) so the
            # sequential index stays aligned with the viz graph nodes which
            # also skip byes.
            if not m.team1 or not m.team2:
                continue
            entry: dict = {
                "team1": _fmt_team(m.team1),
                "team2": _fmt_team(m.team2),
                "score": _fmt_score(m),
                "round": m.round_label,
            }
            loser = m.loser_team
            if loser:
                entry["loser"] = _fmt_team(loser)
            labels[f"l_{idx}"] = entry
            idx += 1
        if bracket.grand_final:
            gf = bracket.grand_final
            labels["grand_final"] = {
                "team1": _fmt_team(gf.team1),
                "team2": _fmt_team(gf.team2),
                "score": _fmt_score(gf),
                "round": "Grand Final",
            }
    else:
        _label_round_matches(bracket.matches, "match")

    return labels


# ---------------------------------------------------------------------------
# Score lifecycle helpers
# ---------------------------------------------------------------------------


def _get_tv_settings(tid: str) -> dict[str, Any]:
    """Return the TV settings dict for a tournament (defaults to empty dict)."""
    return _tournaments.get(tid, {}).get("tv_settings") or {}


def _apply_player_score_metadata(
    match: Match,
    player_id: str,
    score: list[int] | None = None,
    sets: list[list[int]] | None = None,
    confirmed: bool = False,
) -> None:
    """Stamp a player-submitted score with metadata for the lifecycle flow.

    Appends a ``"submit"`` entry to the match's score_history and sets
    ``scored_by`` / ``scored_at`` / ``score_confirmed``.
    Pass ``confirmed=True`` when the tournament is in immediate confirmation
    mode so the score is visible as confirmed straight away.
    Admin-submitted scores bypass this entirely via ``_mark_admin_score``.
    """
    now = time.time()
    match.scored_by = player_id
    match.scored_at = now
    match.score_confirmed = confirmed
    match.score_history.append(
        {
            "player_id": player_id,
            "action": "submit",
            "score": score,
            "sets": sets,
            "timestamp": now,
        }
    )


def _mark_admin_score(match: Match, actor_id: str | None = None) -> None:
    """Mark a match score as immediately confirmed (admin / organiser record)."""
    match.scored_by = None
    match.scored_at = None
    match.score_confirmed = True
    # Clear any previous dispute state when an admin re-records.
    match.disputed = False
    match.dispute_score = None
    match.dispute_sets = None
    match.dispute_by = None
    match.dispute_at = None
    match.score_history.append(
        {
            "player_id": actor_id,
            "action": "admin_record",
            "score": list(match.score) if match.score else None,
            "sets": [list(s) for s in match.sets] if match.sets else None,
            "timestamp": time.time(),
        }
    )


def _is_player_in_opposing_team(match: Match, player_id: str, tournament: object) -> bool:
    """Return True if *player_id* is in the team that did NOT submit the score.

    Works with direct player IDs and composite team rosters.
    """
    team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}

    def _ids_for(players: list) -> set[str]:
        direct = {p.id for p in players}
        expanded: set[str] = set()
        for pid in direct:
            expanded.update(team_roster.get(pid, [pid]))
        expanded.update(direct)
        return expanded

    team1_ids = _ids_for(match.team1)
    team2_ids = _ids_for(match.team2)

    if not match.scored_by:
        return False

    if match.scored_by in team1_ids:
        return player_id in team2_ids
    if match.scored_by in team2_ids:
        return player_id in team1_ids
    return False


def _is_player_in_submitter_team(match: Match, player_id: str, tournament: object) -> bool:
    """Return True if *player_id* is on the same team as the player who submitted the score.

    Works with direct player IDs and composite team rosters.
    """
    team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}

    def _ids_for(players: list) -> set[str]:
        direct = {p.id for p in players}
        expanded: set[str] = set()
        for pid in direct:
            expanded.update(team_roster.get(pid, [pid]))
        expanded.update(direct)
        return expanded

    if not match.scored_by:
        return False

    team1_ids = _ids_for(match.team1)
    team2_ids = _ids_for(match.team2)

    if match.scored_by in team1_ids:
        return player_id in team1_ids
    if match.scored_by in team2_ids:
        return player_id in team2_ids
    return False


def _is_player_in_match(match: Match, player_id: str, tournament: object) -> bool:
    """Return True if *player_id* participates in *match* (direct or via roster)."""
    team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
    all_ids: set[str] = set()
    for player in match.team1 + match.team2:
        all_ids.add(player.id)
        all_ids.update(team_roster.get(player.id, []))
    return player_id in all_ids


def _find_match_full(tournament: object, match_id: str) -> Match | None:
    """Extended match finder that also searches completed bracket matches."""
    # First try the standard finder (covers Mexicano, group stage, pending bracket).
    m = _find_match(tournament, match_id)
    if m is not None:
        return m
    # Fallback: iterate all matches in the bracket including completed ones.
    for bracket_attr in ("bracket", "playoff_bracket"):
        bracket = getattr(tournament, bracket_attr, None)
        if bracket is None:
            continue
        # Try winners/losers/all match lists on the bracket.
        for accessor in ("winners_matches", "losers_matches", "matches"):
            for bm in getattr(bracket, accessor, []):
                if bm.id == match_id:
                    return bm
        if getattr(bracket, "grand_final", None) and bracket.grand_final.id == match_id:
            return bracket.grand_final
    return None
