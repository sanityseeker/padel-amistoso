"""Shared pairing utilities for 2v2 padel tournament formats.

Provides common logic for forming balanced 2v2 matches, tracking
partner/opponent histories, and evaluating pairing quality.
Used by both group-stage and Mexicano tournaments.
"""

from __future__ import annotations

import random
from collections import defaultdict

from ..models import Player

# All three ways to split a group of 4 into two teams of 2.
PAIRING_SCHEMES_4: list[tuple[tuple[int, int], tuple[int, int]]] = [
    ((0, 3), (1, 2)),
    ((0, 2), (1, 3)),
    ((0, 1), (2, 3)),
]


def make_history(players: list[Player]) -> dict[str, dict[str, int]]:
    """Create an empty defaultdict-of-int history dict for a list of players."""
    return {p.id: defaultdict(int) for p in players}


def update_history(
    team1: list[Player],
    team2: list[Player],
    partner_history: dict[str, dict[str, int]],
    opponent_history: dict[str, dict[str, int]],
) -> None:
    """Record a played match in partner and opponent history dicts.

    Args:
        team1: First team of players.
        team2: Second team of players.
        partner_history: Mutable dict tracking partner counts per player.
        opponent_history: Mutable dict tracking opponent counts per player.
    """
    for team in [team1, team2]:
        for i, p1 in enumerate(team):
            for p2 in team[i + 1 :]:
                partner_history[p1.id][p2.id] += 1
                partner_history[p2.id][p1.id] += 1
    for p1 in team1:
        for p2 in team2:
            opponent_history[p1.id][p2.id] += 1
            opponent_history[p2.id][p1.id] += 1


def _half_repeat_count(
    team: list[Player],
    opponents: list[Player],
    partner_history: dict[str, dict[str, int]],
    opponent_history: dict[str, dict[str, int]],
) -> int:
    """Repeat penalty contribution from one side of a match.

    Sums partner and opponent repeat counts, plus a full-match bonus
    when a player has seen both the same partner AND same opponents.
    """
    count = 0
    for p in team:
        partner = [x for x in team if x.id != p.id]
        partner_count = 0
        if partner:
            partner_count = partner_history[p.id].get(partner[0].id, 0)
            count += partner_count
        opp_counts = [opponent_history[p.id].get(o.id, 0) for o in opponents]
        count += sum(opp_counts)
        if partner_count > 0 and opp_counts and min(opp_counts) > 0:
            count += min(partner_count, min(opp_counts))
    return count


def pairing_repeat_count(
    team1: list[Player],
    team2: list[Player],
    partner_history: dict[str, dict[str, int]],
    opponent_history: dict[str, dict[str, int]],
) -> int:
    """Total repeat penalty for a match, including full-match bonus.

    Args:
        team1: First team of players.
        team2: Second team of players.
        partner_history: Dict tracking partner counts per player.
        opponent_history: Dict tracking opponent counts per player.

    Returns:
        Combined repeat penalty for both sides of the match.
    """
    return _half_repeat_count(team1, team2, partner_history, opponent_history) + _half_repeat_count(
        team2, team1, partner_history, opponent_history
    )


def best_2v2_split(
    group: list[Player],
    scores: dict[str, float],
    partner_history: dict[str, dict[str, int]],
    opponent_history: dict[str, dict[str, int]],
) -> tuple[list[Player], list[Player]]:
    """Pick the best 2v2 split for a group of 4 players.

    Priority:
      1. Minimise score imbalance (competitive matches).
      2. Minimise partner/opponent repeat count (novelty).
    Ties broken randomly.

    Args:
        group: Exactly 4 players to split.
        scores: Score map ``{player_id: accumulated_score}``.
        partner_history: Dict tracking partner counts.
        opponent_history: Dict tracking opponent counts.

    Returns:
        Tuple of ``(team1, team2)`` lists of players.
    """
    candidates: list[tuple[float, int, list[Player], list[Player]]] = []
    for (a, b), (c, d) in PAIRING_SCHEMES_4:
        t1 = [group[a], group[b]]
        t2 = [group[c], group[d]]
        imbalance = abs(sum(scores.get(p.id, 0.0) for p in t1) - sum(scores.get(p.id, 0.0) for p in t2))
        repeats = pairing_repeat_count(t1, t2, partner_history, opponent_history)
        candidates.append((imbalance, repeats, t1, t2))

    min_imbalance = min(c[0] for c in candidates)
    filtered = [(rep, t1, t2) for imb, rep, t1, t2 in candidates if imb == min_imbalance]
    min_repeats = min(c[0] for c in filtered)
    best = [(t1, t2) for rep, t1, t2 in filtered if rep == min_repeats]
    return random.choice(best)


# ------------------------------------------------------------------ #
# Sit-out selection
# ------------------------------------------------------------------ #


def choose_sit_outs(
    ranked: list[Player],
    sit_out_counts: dict[str, int],
    n: int,
) -> list[Player]:
    """Pick *n* players to sit out, favouring those who sat out less.

    Primary criterion: fewest previous sit-outs (fairness).
    Tie-breaker: middle-ranked players sit out, keeping the top
    and bottom scorers active so pairings stay meaningful.

    Args:
        ranked: Players sorted by score descending.
        sit_out_counts: Mutable dict ``{player_id: sit_out_count}``.
        n: How many players need to sit out.

    Returns:
        List of *n* players to sit out this round.
    """
    if n <= 0:
        return []

    min_sit = min(sit_out_counts[p.id] for p in ranked)
    eligible = [p for p in ranked if sit_out_counts[p.id] <= min_sit]

    if len(eligible) <= n:
        chosen = list(eligible[:n])
        if len(chosen) < n:
            remaining = [p for p in ranked if p not in chosen]
            remaining.sort(key=lambda p: sit_out_counts[p.id])
            chosen.extend(remaining[: n - len(chosen)])
        return chosen

    # Among eligible, prefer middle-ranked players to sit out.
    mid = len(eligible) // 2
    start = max(0, mid - n // 2)
    return eligible[start : start + n]


# ------------------------------------------------------------------ #
# Playoff team formation
# ------------------------------------------------------------------ #


def form_playoff_teams(
    players: list[Player],
    scores: dict[str, float],
) -> list[list[Player]]:
    """Pair advancing players into balanced teams of 2 (fold method).

    Sorts players by score descending, then pairs the strongest with
    the weakest, the second-strongest with the second-weakest, etc.
    This produces teams of roughly equal combined strength.

    Args:
        players: Individual players to pair up.  Must have even length.
        scores: ``{player_id: cumulative_score}``.

    Returns:
        List of teams, each a list of 2 ``Player`` objects.

    Raises:
        ValueError: If the number of players is odd.
    """
    if len(players) % 2 != 0:
        raise ValueError("Need an even number of players to form teams")

    ranked = sorted(players, key=lambda p: -scores.get(p.id, 0.0))
    n = len(ranked)
    return [[ranked[i], ranked[n - 1 - i]] for i in range(n // 2)]
