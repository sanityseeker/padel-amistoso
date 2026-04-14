"""Tests for the pure ELO computation engine."""

from __future__ import annotations

import pytest

from backend.models import Match, MatchStatus, Player
from backend.tournaments.elo import (
    DEFAULT_RATING,
    MIN_DELTA_WIN,
    compute_1v1_update,
    compute_2v2_update,
    compute_blended_outcome,
    compute_expected_score,
    compute_match_elo_updates,
    get_k_factor,
    tennis_sets_to_score,
)


# ---------------------------------------------------------------------------
# get_k_factor
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("matches", "expected_k"),
    [
        (0, 40),
        (10, 40),
        (20, 40),
        (21, 20),
        (30, 20),
        (40, 20),
        (41, 10),
        (200, 10),
    ],
)
def test_k_factor_tiers(matches: int, expected_k: int) -> None:
    assert get_k_factor(matches) == expected_k


# ---------------------------------------------------------------------------
# compute_expected_score
# ---------------------------------------------------------------------------


def test_expected_score_equal_ratings() -> None:
    assert compute_expected_score(1000, 1000) == pytest.approx(0.5)


def test_expected_score_symmetry() -> None:
    e_a = compute_expected_score(1200, 1000)
    e_b = compute_expected_score(1000, 1200)
    assert e_a + e_b == pytest.approx(1.0)


def test_expected_score_higher_rating_favoured() -> None:
    assert compute_expected_score(1400, 1000) > 0.5
    assert compute_expected_score(1000, 1400) < 0.5


# ---------------------------------------------------------------------------
# compute_blended_outcome
# ---------------------------------------------------------------------------


class TestBlendedOutcome:
    """Tests for the blended win/ratio outcome score."""

    def test_symmetry(self) -> None:
        """S(a, b) + S(b, a) == 1 for any valid scores."""
        for a, b in [(13, 12), (24, 1), (18, 7), (5, 5), (0, 10)]:
            s1 = compute_blended_outcome(a, b)
            s2 = compute_blended_outcome(b, a)
            assert s1 + s2 == pytest.approx(1.0), f"Failed for ({a}, {b})"

    def test_draw_gives_half(self) -> None:
        assert compute_blended_outcome(12, 12) == pytest.approx(0.5)

    def test_zero_zero_gives_half(self) -> None:
        assert compute_blended_outcome(0, 0) == pytest.approx(0.5)

    @pytest.mark.parametrize(
        ("a", "b", "expected"),
        [
            (13, 12, 0.76),
            (18, 7, 0.86),
            (24, 1, 0.98),
            (12, 13, 0.24),
            (7, 18, 0.14),
            (1, 24, 0.02),
        ],
    )
    def test_known_values(self, a: int, b: int, expected: float) -> None:
        assert compute_blended_outcome(a, b) == pytest.approx(expected, abs=0.01)

    def test_close_win_above_half(self) -> None:
        s = compute_blended_outcome(13, 12)
        assert s > 0.5

    def test_blowout_win_near_one(self) -> None:
        s = compute_blended_outcome(24, 1)
        assert s > 0.9

    def test_close_loss_above_zero(self) -> None:
        s = compute_blended_outcome(12, 13)
        assert s > 0.0

    def test_alpha_zero_pure_ratio(self) -> None:
        """With alpha=0, outcome is purely the score ratio."""
        s = compute_blended_outcome(13, 12, alpha=0.0)
        expected_r = 0.5 + (13 - 12) / (2 * 25)
        assert s == pytest.approx(expected_r)

    def test_alpha_one_pure_binary(self) -> None:
        """With alpha=1, outcome is purely binary."""
        assert compute_blended_outcome(13, 12, alpha=1.0) == pytest.approx(1.0)
        assert compute_blended_outcome(12, 13, alpha=1.0) == pytest.approx(0.0)
        assert compute_blended_outcome(12, 12, alpha=1.0) == pytest.approx(0.5)


# ---------------------------------------------------------------------------
# tennis_sets_to_score
# ---------------------------------------------------------------------------


class TestTennisSetsToScore:
    def test_straight_sets(self) -> None:
        assert tennis_sets_to_score([(6, 4), (6, 3)]) == (12, 7)

    def test_three_sets(self) -> None:
        assert tennis_sets_to_score([(6, 4), (3, 6), (7, 5)]) == (16, 15)

    def test_bagel(self) -> None:
        assert tennis_sets_to_score([(6, 0), (6, 0)]) == (12, 0)

    def test_tight_match(self) -> None:
        assert tennis_sets_to_score([(7, 6), (7, 6)]) == (14, 12)

    def test_empty(self) -> None:
        assert tennis_sets_to_score([]) == (0, 0)


# ---------------------------------------------------------------------------
# compute_1v1_update
# ---------------------------------------------------------------------------


class TestCompute1v1:
    def test_winner_gains_loser_loses(self) -> None:
        new1 = compute_1v1_update(1000, 1000, (18, 7), 0)
        new2 = compute_1v1_update(1000, 1000, (7, 18), 0)
        assert new1 > 1000
        assert new2 < 1000

    def test_draw_no_change_at_equal_rating(self) -> None:
        new = compute_1v1_update(1000, 1000, (12, 12), 0)
        assert new == pytest.approx(1000, abs=0.01)

    def test_close_loss_small_penalty(self) -> None:
        close = compute_1v1_update(1000, 1000, (12, 13), 0)
        blowout = compute_1v1_update(1000, 1000, (1, 24), 0)
        # Close loss should lose less rating than blowout loss
        assert close > blowout

    def test_upset_win_big_reward(self) -> None:
        """Weaker player winning gets a larger boost."""
        normal = compute_1v1_update(1000, 1000, (18, 7), 0)
        upset = compute_1v1_update(800, 1200, (18, 7), 0)
        assert (upset - 800) > (normal - 1000)

    def test_expected_win_modest_change(self) -> None:
        """Strongly favoured player winning always gains at least MIN_DELTA_WIN."""
        moderate_win = compute_1v1_update(1400, 1000, (18, 7), 0)
        blowout_win = compute_1v1_update(1400, 1000, (24, 1), 0)
        assert moderate_win > 1400  # clamped: always gains
        assert blowout_win > 1400
        assert (moderate_win - 1400) >= MIN_DELTA_WIN

    def test_winner_always_gains(self) -> None:
        """No matter the rating gap, a winner never loses ELO."""
        new = compute_1v1_update(2000, 500, (13, 12), 100)
        assert new > 2000
        assert (new - 2000) >= MIN_DELTA_WIN

    def test_loser_always_loses(self) -> None:
        """No matter the rating gap, a loser never gains ELO."""
        new = compute_1v1_update(500, 2000, (12, 13), 100)
        assert new < 500
        assert (500 - new) >= MIN_DELTA_WIN

    def test_k_factor_affects_magnitude(self) -> None:
        """Newer players (higher K) have bigger rating swings."""
        new_player = compute_1v1_update(1000, 1000, (18, 7), 5)
        veteran = compute_1v1_update(1000, 1000, (18, 7), 100)
        assert abs(new_player - 1000) > abs(veteran - 1000)

    def test_k_factor_override(self) -> None:
        """Custom K-factor override takes precedence over tier-based K."""
        # With override K=100, the delta should be much larger than default
        with_override = compute_1v1_update(1000, 1000, (18, 7), 100, k_factor_override=100)
        without_override = compute_1v1_update(1000, 1000, (18, 7), 100)
        assert abs(with_override - 1000) > abs(without_override - 1000)


# ---------------------------------------------------------------------------
# compute_2v2_update
# ---------------------------------------------------------------------------


class TestCompute2v2:
    def test_winner_gains(self) -> None:
        new = compute_2v2_update(1000, 1000, 1000, 1000, (18, 7), 0)
        assert new > 1000

    def test_loser_loses(self) -> None:
        new = compute_2v2_update(1000, 1000, 1000, 1000, (7, 18), 0)
        assert new < 1000

    def test_no_partner_adjustment_when_equal(self) -> None:
        """When partner has same rating, adjustment factor is 1.0."""
        result_2v2 = compute_2v2_update(1000, 1000, 1000, 1000, (18, 7), 0)
        # Should behave like 1v1 at team level
        result_1v1 = compute_1v1_update(1000, 1000, (18, 7), 0)
        assert result_2v2 == pytest.approx(result_1v1)

    def test_weak_partner_loss_smaller_penalty(self) -> None:
        """Strong player with weak partner loses less on defeat."""
        # Strong player (1200) with weak partner (800) vs two 1000s
        strong_with_weak = compute_2v2_update(1200, 800, 1000, 1000, (7, 18), 0)
        # Same player with equal partner
        strong_with_equal = compute_2v2_update(1200, 1200, 1000, 1000, (7, 18), 0)
        # Loss penalty should be smaller with the weak partner
        penalty_weak = 1200 - strong_with_weak
        penalty_equal = 1200 - strong_with_equal
        assert penalty_weak < penalty_equal

    def test_strong_partner_loss_bigger_penalty(self) -> None:
        """Weak player with strong partner loses more on defeat."""
        weak_with_strong = compute_2v2_update(800, 1200, 1000, 1000, (7, 18), 0)
        weak_with_equal = compute_2v2_update(800, 800, 1000, 1000, (7, 18), 0)
        penalty_strong = 800 - weak_with_strong
        penalty_equal = 800 - weak_with_equal
        assert penalty_strong > penalty_equal

    def test_close_loss_small_penalty(self) -> None:
        close = compute_2v2_update(1000, 1000, 1000, 1000, (12, 13), 0)
        blowout = compute_2v2_update(1000, 1000, 1000, 1000, (1, 24), 0)
        assert close > blowout


# ---------------------------------------------------------------------------
# compute_match_elo_updates
# ---------------------------------------------------------------------------


def _make_match(
    team1: list[Player],
    team2: list[Player],
    score: tuple[int, int],
    *,
    sets: list[tuple[int, int]] | None = None,
) -> Match:
    m = Match(team1=team1, team2=team2, score=score, sets=sets)
    m.status = MatchStatus.COMPLETED
    return m


class TestComputeMatchEloUpdates:
    def test_1v1_returns_two_updates(self) -> None:
        p1, p2 = Player(name="A"), Player(name="B")
        m = _make_match([p1], [p2], (18, 7))
        ratings = {p1.id: 1000.0, p2.id: 1000.0}
        counts = {p1.id: 0, p2.id: 0}
        updates = compute_match_elo_updates(m, ratings, counts, team_mode=False)
        assert len(updates) == 2
        by_id = {u.player_id: u for u in updates}
        assert by_id[p1.id].elo_after > 1000
        assert by_id[p2.id].elo_after < 1000

    def test_2v2_returns_four_updates(self) -> None:
        players = [Player(name=n) for n in "ABCD"]
        m = _make_match(players[:2], players[2:], (18, 7))
        ratings = {p.id: 1000.0 for p in players}
        counts = {p.id: 0 for p in players}
        updates = compute_match_elo_updates(m, ratings, counts, team_mode=True)
        assert len(updates) == 4
        for u in updates:
            assert u.matches_after == 1

    def test_match_counts_increment(self) -> None:
        p1, p2 = Player(name="A"), Player(name="B")
        m = _make_match([p1], [p2], (18, 7))
        ratings = {p1.id: 1100.0, p2.id: 900.0}
        counts = {p1.id: 10, p2.id: 5}
        updates = compute_match_elo_updates(m, ratings, counts, team_mode=False)
        by_id = {u.player_id: u for u in updates}
        assert by_id[p1.id].matches_before == 10
        assert by_id[p1.id].matches_after == 11
        assert by_id[p2.id].matches_before == 5
        assert by_id[p2.id].matches_after == 6

    def test_uses_sets_for_tennis(self) -> None:
        """When sets are provided, games are used as the score proxy."""
        p1, p2 = Player(name="A"), Player(name="B")
        # 7-6, 7-6 → tight match (14, 12) vs score (2, 0)
        m_sets = _make_match([p1], [p2], (2, 0), sets=[(7, 6), (7, 6)])
        m_plain = _make_match([p1], [p2], (14, 12))
        ratings = {p1.id: 1000.0, p2.id: 1000.0}
        counts = {p1.id: 0, p2.id: 0}
        u_sets = compute_match_elo_updates(m_sets, ratings, counts, team_mode=False)
        u_plain = compute_match_elo_updates(m_plain, ratings, counts, team_mode=False)
        # Both should produce very similar results since sets → (14,12)
        w_sets = next(u for u in u_sets if u.player_id == p1.id)
        w_plain = next(u for u in u_plain if u.player_id == p1.id)
        assert w_sets.elo_after == pytest.approx(w_plain.elo_after)

    def test_raises_on_incomplete_match(self) -> None:
        p1, p2 = Player(name="A"), Player(name="B")
        m = Match(team1=[p1], team2=[p2])
        with pytest.raises(ValueError, match="not completed"):
            compute_match_elo_updates(m, {}, {}, team_mode=False)

    def test_default_rating_for_missing_players(self) -> None:
        """Players not in the ratings dict default to DEFAULT_RATING."""
        p1, p2 = Player(name="A"), Player(name="B")
        m = _make_match([p1], [p2], (18, 7))
        updates = compute_match_elo_updates(m, {}, {}, team_mode=False)
        assert len(updates) == 2
        for u in updates:
            assert u.elo_before == DEFAULT_RATING

    def test_2v2_auto_detected_without_team_mode(self) -> None:
        """Even with team_mode=False, 2-player teams trigger 2v2 logic."""
        players = [Player(name=n) for n in "ABCD"]
        m = _make_match(players[:2], players[2:], (18, 7))
        ratings = {p.id: 1000.0 for p in players}
        counts = {p.id: 0 for p in players}
        updates = compute_match_elo_updates(m, ratings, counts, team_mode=False)
        assert len(updates) == 4
