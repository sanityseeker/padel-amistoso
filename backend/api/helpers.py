"""
Shared helpers for route modules.
"""

from __future__ import annotations

from fastapi import HTTPException

from ..models import Match
from .state import _tournaments


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
) -> tuple[int, int, list[tuple[int, int]]]:
    """Convert raw set scores to total game counts and typed tuples.

    Returns:
        Tuple of (total_games_team1, total_games_team2, sets_as_tuples).
    """
    sets_tuples = [tuple(s) for s in sets]
    total1 = sum(s[0] for s in sets_tuples)
    total2 = sum(s[1] for s in sets_tuples)
    return total1, total2, sets_tuples
