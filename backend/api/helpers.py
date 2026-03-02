"""
Shared helpers for route modules.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from fastapi.responses import Response

from ..models import Match
from .state import _tournaments

# MIME types for the three supported image/document formats.
_SCHEMA_MEDIA_TYPES: dict[str, str] = {
    "png": "image/png",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
}


def _schema_image_response(img: bytes, fmt: Literal["png", "svg", "pdf"]) -> Response:
    """Wrap rendered image bytes in the correct FastAPI Response."""
    return Response(content=img, media_type=_SCHEMA_MEDIA_TYPES[fmt])


def _serialize_match(m: Match) -> dict:
    """Convert a Match dataclass to a JSON-friendly dict."""
    return {
        "id": m.id,
        "team1": [p.name for p in m.team1],
        "team2": [p.name for p in m.team2],
        "court": m.court.name if m.court else None,
        "status": m.status.value,
        "score": list(m.score) if m.score else None,
        "sets": [list(s) for s in m.sets] if m.sets else None,
        "third_set_loss": m.third_set_loss,
        "slot_number": m.slot_number,
        "round_number": m.round_number,
        "round_label": m.round_label,
    }


def _get_tournament(tid: str, expected_type: str):
    """Look up a tournament by ID and verify its type, or raise 404."""
    data = _tournaments.get(tid)
    if not data or data["type"] != expected_type:
        raise HTTPException(404, "Not found")
    return data


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
    # When total games are equal, bump the set-winner by 1 to avoid a draw in standings.
    if total1 == total2 and sets1_won != sets2_won:
        if sets1_won > sets2_won:
            total1 += 1
        else:
            total2 += 1
    return total1, total2, sets_tuples, decided_by_third_set


def _build_match_labels(bracket: object) -> dict[str, dict]:
    """Build a match_labels dict keyed by viz graph node ID.

    Keys match the node IDs created by bracket builders in bracket_schema.py:
    - Single-elim matches: ``"match_r{r}_p{p}"`` (r and p are 0-based)
    - Double-elim winners matches: ``"w_r{r}_p{p}"``
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
        by_round: dict[int, list] = {}
        for m in match_list:
            by_round.setdefault(m.round_number, []).append(m)
        for round_num, rmatches in sorted(by_round.items()):
            r = round_num - 1
            for p_idx, m in enumerate(rmatches):
                labels[f"{prefix}_r{r}_p{p_idx}"] = {
                    "team1": _fmt_team(m.team1),
                    "team2": _fmt_team(m.team2),
                    "score": _fmt_score(m),
                    "round": m.round_label,
                }

    labels: dict[str, dict] = {}

    if hasattr(bracket, "winners_matches"):
        _label_round_matches(bracket.winners_matches, "w")
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
