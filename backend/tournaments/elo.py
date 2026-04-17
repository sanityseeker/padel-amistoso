"""Pure ELO rating computation engine.

Provides margin-aware ELO calculations for both 1v1 (tennis singles)
and 2v2 (padel / tennis doubles) match formats.  No database or I/O
dependencies — all functions are pure.
"""

from __future__ import annotations

from pydantic import BaseModel

from backend.models import Match, MatchStatus

# ---------------------------------------------------------------------------
# Constants (tunable)
# ---------------------------------------------------------------------------

DEFAULT_RATING: float = 1000.0
"""Starting ELO for new players."""

OUTCOME_BLEND_WEIGHT: float = 0.5
"""Weight *α* blending binary win/loss with score margin.

``S = α·W + (1-α)·R`` where *W* ∈ {1, 0.5, 0} and *R* is the continuous
score ratio.  Higher values make the outcome more binary.
"""

PARTNER_CONTRIBUTION_WEIGHT: float = 0.50
"""How much a partner's relative strength adjusts individual ELO deltas.

A value of 0 means no partner adjustment; higher values increase the
compensation for having a weaker (or stronger) partner.
"""

PARTNER_ADJUSTMENT_MIN: float = 0.5
PARTNER_ADJUSTMENT_MAX: float = 1.5

K_FACTOR_TIERS: list[tuple[int, int]] = [
    (20, 40),
    (40, 20),
]
"""(threshold, K) pairs evaluated in order.  If ``matches_played <= threshold``
the corresponding K is returned.  Falls through to ``K_FACTOR_DEFAULT``.
"""

K_FACTOR_DEFAULT: int = 10

MIN_DELTA_WIN: float = 1.0
"""Minimum ELO gain for a winner / minimum ELO loss for a loser.

Ensures that winning is always rewarded and losing always costs something,
even when the margin-based outcome is close to the expected score.
"""

RELIABILITY_BASELINE: float = 0.3
"""Minimum reliability factor for a player with zero matches.

When an opponent has few matches, their rating is unreliable.  The
reliability dampener scales the delta applied *to established players*
so that they are shielded from large swings caused by provisional
opponents.  Provisional players themselves always receive the full
delta so their ratings converge quickly.  Ramps linearly from
``RELIABILITY_BASELINE`` at 0 matches to 1.0 at
``RELIABILITY_THRESHOLD`` matches.
"""

RELIABILITY_THRESHOLD: int = 20
"""Number of matches at which a player's rating is fully reliable."""

# ---------------------------------------------------------------------------
# Pydantic model
# ---------------------------------------------------------------------------


class EloUpdate(BaseModel):
    """Result of an ELO update for a single player after one match."""

    player_id: str
    elo_before: float
    elo_after: float
    matches_before: int
    matches_after: int


# ---------------------------------------------------------------------------
# Core helpers
# ---------------------------------------------------------------------------


def get_k_factor(matches_played: int) -> int:
    """Return the K-factor for a player based on their match count."""
    for threshold, k in K_FACTOR_TIERS:
        if matches_played <= threshold:
            return k
    return K_FACTOR_DEFAULT


def reliability(matches_played: int) -> float:
    """Return a reliability factor in [RELIABILITY_BASELINE, 1.0].

    Ramps linearly from ``RELIABILITY_BASELINE`` at 0 matches to 1.0 at
    ``RELIABILITY_THRESHOLD`` matches.  Used to dampen the ELO delta
    applied to an opponent when the *other* player's rating is still
    provisional.

    Args:
        matches_played: Number of completed matches.

    Returns:
        Reliability factor between ``RELIABILITY_BASELINE`` and 1.0.
    """
    if matches_played >= RELIABILITY_THRESHOLD:
        return 1.0
    return RELIABILITY_BASELINE + (1.0 - RELIABILITY_BASELINE) * matches_played / RELIABILITY_THRESHOLD


def compute_expected_score(rating_a: float, rating_b: float) -> float:
    """Classic ELO expected score for player A vs player B."""
    return 1.0 / (1.0 + 10.0 ** ((rating_b - rating_a) / 400.0))


def compute_blended_outcome(score_a: int, score_b: int, alpha: float = OUTCOME_BLEND_WEIGHT) -> float:
    """Compute the blended outcome S for the player who scored *score_a*.

    Blends binary win/loss/draw with a continuous score ratio so that
    close defeats are penalised less and blowout wins are rewarded more.

    ``S = α·W + (1 - α)·R``

    where ``W`` ∈ {1, 0.5, 0} and ``R = 0.5 + (a - b) / (2·(a + b))``.

    Args:
        score_a: Points scored by the player (or their team).
        score_b: Points scored by the opponent (or opposing team).
        alpha: Blend weight.  0 → pure ratio, 1 → pure binary.

    Returns:
        Blended outcome in [0, 1].
    """
    total = score_a + score_b
    if total == 0:
        return 0.5

    # Binary component
    if score_a > score_b:
        w = 1.0
    elif score_a < score_b:
        w = 0.0
    else:
        w = 0.5

    # Continuous ratio component
    r = 0.5 + (score_a - score_b) / (2.0 * total)

    return alpha * w + (1.0 - alpha) * r


def tennis_sets_to_score(sets: list[tuple[int, int]]) -> tuple[int, int]:
    """Sum games across tennis sets to produce a single score pair.

    Args:
        sets: List of ``(games_a, games_b)`` per set.

    Returns:
        ``(total_games_a, total_games_b)``.
    """
    games_a = sum(s[0] for s in sets)
    games_b = sum(s[1] for s in sets)
    return games_a, games_b


# ---------------------------------------------------------------------------
# Delta clamping
# ---------------------------------------------------------------------------


def _clamp_delta(delta: float, score: tuple[int, int]) -> float:
    """Ensure winners always gain and losers always lose ELO.

    Draws are left unclamped.
    """
    if score[0] > score[1]:
        # Winner: delta must be at least +MIN_DELTA_WIN
        return max(delta, MIN_DELTA_WIN)
    if score[0] < score[1]:
        # Loser: delta must be at most -MIN_DELTA_WIN
        return min(delta, -MIN_DELTA_WIN)
    return delta


# ---------------------------------------------------------------------------
# 1v1 update
# ---------------------------------------------------------------------------


def compute_1v1_update(
    player_rating: float,
    opponent_rating: float,
    score: tuple[int, int],
    matches_played: int,
    k_factor_override: int | None = None,
    opponent_matches_played: int | None = None,
) -> float:
    """Compute the new ELO rating for a 1v1 match.

    Args:
        player_rating: Current rating of the player.
        opponent_rating: Current rating of the opponent.
        score: ``(player_score, opponent_score)``.
        matches_played: Number of matches the player has completed so far
            (before this match).
        k_factor_override: If set, use this K value instead of the
            tier-based default.
        opponent_matches_played: Opponent's completed match count.  When
            the opponent is provisional (few matches) **and** the player
            is already established (≥ ``RELIABILITY_THRESHOLD`` matches),
            the delta is dampened via the reliability factor.  Provisional
            players always receive the full delta for fast calibration.

    Returns:
        Updated rating.
    """
    expected = compute_expected_score(player_rating, opponent_rating)
    actual = compute_blended_outcome(score[0], score[1])
    k = k_factor_override if k_factor_override is not None else get_k_factor(matches_played)
    delta = k * (actual - expected)
    # Dampen delta only for established players facing provisional opponents.
    # Provisional players always get the full delta so their ratings converge
    # quickly during calibration.
    if opponent_matches_played is not None and matches_played >= RELIABILITY_THRESHOLD:
        delta *= reliability(opponent_matches_played)
    return player_rating + _clamp_delta(delta, score)


# ---------------------------------------------------------------------------
# 2v2 partner-adjusted update
# ---------------------------------------------------------------------------


def _partner_adjustment(player_rating: float, partner_rating: float) -> float:
    """Compute the partner-strength adjustment multiplier.

    When the partner is weaker than the player the multiplier is > 1,
    softening losses and amplifying wins.  When the partner is stronger
    the multiplier is < 1.
    """
    partner_delta = (partner_rating - player_rating) / 400.0
    raw = 1.0 - PARTNER_CONTRIBUTION_WEIGHT * partner_delta
    return max(PARTNER_ADJUSTMENT_MIN, min(PARTNER_ADJUSTMENT_MAX, raw))


def compute_2v2_update(
    player_rating: float,
    partner_rating: float,
    opp1_rating: float,
    opp2_rating: float,
    score: tuple[int, int],
    matches_played: int,
    k_factor_override: int | None = None,
    opponent_matches: tuple[int, int] | None = None,
) -> float:
    """Compute the new ELO rating for one player in a 2v2 match.

    Uses team-average expected score with an individual partner-strength
    adjustment so that a strong player paired with a weak partner is not
    unfairly penalised for close losses.

    Args:
        player_rating: Player's current ELO.
        partner_rating: Partner's current ELO.
        opp1_rating: First opponent's current ELO.
        opp2_rating: Second opponent's current ELO.
        score: ``(team_score, opponent_team_score)``.
        matches_played: Player's completed matches before this one.
        k_factor_override: If set, use this K value instead of the
            tier-based default.
        opponent_matches: ``(opp1_matches, opp2_matches)`` — completed
            match counts for each opponent.  Dampening is only applied
            when the player is established (≥ ``RELIABILITY_THRESHOLD``
            matches).  The *minimum* reliability of the two opponents is
            used, shielding the player when *either* opponent is
            provisional.

    Returns:
        Updated rating.
    """
    team_avg = (player_rating + partner_rating) / 2.0
    opp_avg = (opp1_rating + opp2_rating) / 2.0
    expected = compute_expected_score(team_avg, opp_avg)
    actual = compute_blended_outcome(score[0], score[1])
    k = k_factor_override if k_factor_override is not None else get_k_factor(matches_played)
    adj = _partner_adjustment(player_rating, partner_rating)
    delta = k * adj * (actual - expected)
    # Dampen delta only for established players facing provisional opponents
    if opponent_matches is not None and matches_played >= RELIABILITY_THRESHOLD:
        opp_rel = min(reliability(opponent_matches[0]), reliability(opponent_matches[1]))
        delta *= opp_rel
    return player_rating + _clamp_delta(delta, score)


# ---------------------------------------------------------------------------
# Match-level batch computation
# ---------------------------------------------------------------------------


def compute_match_elo_updates(
    match: Match,
    ratings: dict[str, float],
    match_counts: dict[str, int],
    team_mode: bool,
    k_factor_overrides: dict[str, int] | None = None,
) -> list[EloUpdate]:
    """Process a completed match and return ELO updates for every participant.

    Args:
        match: A ``Match`` with ``status == COMPLETED`` and a non-null score.
        ratings: Mapping of ``player_id -> current ELO``.
        match_counts: Mapping of ``player_id -> matches played so far``.
        team_mode: Whether teams are fixed pairs (2v2) or individuals (1v1).
        k_factor_overrides: Optional mapping of ``player_id -> K-factor``
            for players with a custom K-factor override.

    Returns:
        List of ``EloUpdate`` -- one per player in the match.

    Raises:
        ValueError: If the match is not completed or has no score.
    """
    if match.status != MatchStatus.COMPLETED or match.score is None:
        raise ValueError(f"Match {match.id} is not completed or has no score")

    overrides = k_factor_overrides or {}

    score = match.score
    # For tennis matches with sets, use total games as the score proxy
    if match.sets:
        score = tennis_sets_to_score(match.sets)

    updates: list[EloUpdate] = []

    if len(match.team1) > 1 and len(match.team2) > 1:
        # 2v2 mode
        for player in match.team1:
            partner = next(p for p in match.team1 if p.id != player.id)
            elo_before = ratings.get(player.id, DEFAULT_RATING)
            count = match_counts.get(player.id, 0)
            opp_counts = (
                match_counts.get(match.team2[0].id, 0),
                match_counts.get(match.team2[1].id, 0),
            )
            elo_after = compute_2v2_update(
                elo_before,
                ratings.get(partner.id, DEFAULT_RATING),
                ratings.get(match.team2[0].id, DEFAULT_RATING),
                ratings.get(match.team2[1].id, DEFAULT_RATING),
                score,
                count,
                k_factor_override=overrides.get(player.id),
                opponent_matches=opp_counts,
            )
            updates.append(
                EloUpdate(
                    player_id=player.id,
                    elo_before=elo_before,
                    elo_after=elo_after,
                    matches_before=count,
                    matches_after=count + 1,
                )
            )

        for player in match.team2:
            partner = next(p for p in match.team2 if p.id != player.id)
            elo_before = ratings.get(player.id, DEFAULT_RATING)
            count = match_counts.get(player.id, 0)
            reversed_score = (score[1], score[0])
            opp_counts = (
                match_counts.get(match.team1[0].id, 0),
                match_counts.get(match.team1[1].id, 0),
            )
            elo_after = compute_2v2_update(
                elo_before,
                ratings.get(partner.id, DEFAULT_RATING),
                ratings.get(match.team1[0].id, DEFAULT_RATING),
                ratings.get(match.team1[1].id, DEFAULT_RATING),
                reversed_score,
                count,
                k_factor_override=overrides.get(player.id),
                opponent_matches=opp_counts,
            )
            updates.append(
                EloUpdate(
                    player_id=player.id,
                    elo_before=elo_before,
                    elo_after=elo_after,
                    matches_before=count,
                    matches_after=count + 1,
                )
            )
    else:
        # 1v1 mode
        p1 = match.team1[0]
        p2 = match.team2[0]
        elo1 = ratings.get(p1.id, DEFAULT_RATING)
        elo2 = ratings.get(p2.id, DEFAULT_RATING)
        count1 = match_counts.get(p1.id, 0)
        count2 = match_counts.get(p2.id, 0)

        new_elo1 = compute_1v1_update(
            elo1, elo2, score, count1, k_factor_override=overrides.get(p1.id), opponent_matches_played=count2
        )
        new_elo2 = compute_1v1_update(
            elo2,
            elo1,
            (score[1], score[0]),
            count2,
            k_factor_override=overrides.get(p2.id),
            opponent_matches_played=count1,
        )

        updates.append(
            EloUpdate(
                player_id=p1.id,
                elo_before=elo1,
                elo_after=new_elo1,
                matches_before=count1,
                matches_after=count1 + 1,
            )
        )
        updates.append(
            EloUpdate(
                player_id=p2.id,
                elo_before=elo2,
                elo_after=new_elo2,
                matches_before=count2,
                matches_after=count2 + 1,
            )
        )

    return updates
