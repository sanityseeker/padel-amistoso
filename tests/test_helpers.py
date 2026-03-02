"""Unit tests for backend.api.helpers."""

from __future__ import annotations

import pytest

from backend.api.helpers import _tennis_sets_to_scores


class TestTennisSetsToScores:
    def test_normal_two_set_win_no_flag(self):
        total1, total2, sets, decided = _tennis_sets_to_scores([[6, 4], [6, 3]])
        assert total1 == 12
        assert total2 == 7
        assert decided is False

    def test_three_sets_clear_game_winner_no_flag(self):
        # 6-4 2-6 7-5 → team1 total 15, team2 total 15 — equal, decided=True
        total1, total2, sets, decided = _tennis_sets_to_scores([[6, 4], [2, 6], [7, 5]])
        assert total1 == 16  # bumped +1 for tie-break
        assert total2 == 15
        assert decided is True

    def test_three_sets_already_unequal_has_flag(self):
        # 6-1 2-6 7-6 → team1 total 15, team2 total 13 — 3 sets always decided
        total1, total2, sets, decided = _tennis_sets_to_scores([[6, 1], [2, 6], [7, 6]])
        assert total1 == 15
        assert total2 == 13
        assert decided is True

    def test_three_sets_team2_wins_tiebreak_bumped(self):
        # 4-6 6-2 5-7 → team1 total 15, team2 total 15 — team2 wins 2 sets
        total1, total2, sets, decided = _tennis_sets_to_scores([[4, 6], [6, 2], [5, 7]])
        assert total1 == 15
        assert total2 == 16  # bumped +1 for tie-break
        assert decided is True

    def test_sets_tuples_preserved(self):
        _, _, sets, _ = _tennis_sets_to_scores([[6, 4], [2, 6], [10, 8]])
        assert sets == [(6, 4), (2, 6), (10, 8)]

    @pytest.mark.parametrize(
        "raw, expected_total1, expected_total2, expected_decided",
        [
            ([[6, 0], [6, 0]], 12, 0, False),            # 2-set clean win
            ([[6, 4], [4, 6], [6, 4]], 16, 14, True),    # 3-set, totals differ → decided
            ([[6, 3], [3, 6], [6, 3]], 15, 12, True),    # 3-set, totals differ → decided
            ([[6, 4], [2, 6], [7, 5]], 16, 15, True),    # 3-set equal → adjusted + decided
        ],
    )
    def test_parametrized_cases(
        self,
        raw: list[list[int]],
        expected_total1: int,
        expected_total2: int,
        expected_decided: bool,
    ):
        total1, total2, _, decided = _tennis_sets_to_scores(raw)
        assert total1 == expected_total1
        assert total2 == expected_total2
        assert decided is expected_decided
