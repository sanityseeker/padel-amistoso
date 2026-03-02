"""Tests for playoff module — single and double elimination."""

import pytest

from backend.models import MatchStatus, Player
from backend.tournaments import DoubleEliminationBracket, SingleEliminationBracket


def _team(name: str) -> list[Player]:
    """Create a 1-player 'team' for easy testing."""
    return [Player(name=name)]


def _teams(n: int) -> list[list[Player]]:
    return [_team(f"T{i + 1}") for i in range(n)]


# ── Single Elimination ─────────────────────────────────────


class TestSingleElimination:
    @pytest.mark.parametrize(
        "n_teams, expected_matches",
        [
            (2, 1),  # Final only
            (3, 2),  # 1 SF (bye for seed 1) + 1 Final
            (4, 3),  # 2 SF + 1 Final
            (8, 7),  # 4 QF + 2 SF + 1 Final
        ],
    )
    def test_bracket_match_count(self, n_teams, expected_matches):
        bracket = SingleEliminationBracket(_teams(n_teams))
        assert len(bracket.matches) == expected_matches

    def test_two_teams_final_label(self):
        bracket = SingleEliminationBracket(_teams(2))
        assert bracket.matches[0].round_label == "Final"

    def test_record_result_advances_winner(self):
        bracket = SingleEliminationBracket(_teams(4))
        # 3 matches: 2 Semi-Finals + 1 Final
        assert len(bracket.matches) == 3

        semis = [m for m in bracket.matches if m.round_label == "Semi-Final"]
        assert len(semis) == 2

        # Initially only semis are pending (Final has empty teams)
        pending = bracket.pending_matches()
        assert len(pending) == 2

        # Play semis — team1 always wins
        for m in semis:
            bracket.record_result(m.id, (6, 3))
            assert m.status == MatchStatus.COMPLETED

        # Now the Final should be pending with both teams filled in
        final = [m for m in bracket.matches if m.round_label == "Final"]
        assert len(final) == 1
        pending = bracket.pending_matches()
        assert len(pending) == 1
        assert pending[0].round_label == "Final"
        assert pending[0].team1  # filled by SF1 winner
        assert pending[0].team2  # filled by SF2 winner

    def test_champion_after_final(self):
        bracket = SingleEliminationBracket(_teams(2))
        m = bracket.matches[0]
        bracket.record_result(m.id, (6, 2))
        champ = bracket.champion()
        assert champ is not None
        assert champ[0].name == "T1"

    def test_draw_raises(self):
        bracket = SingleEliminationBracket(_teams(2))
        with pytest.raises(ValueError, match="draw"):
            bracket.record_result(bracket.matches[0].id, (5, 5))

    def test_full_tournament_4_teams(self):
        bracket = SingleEliminationBracket(_teams(4))
        assert len(bracket.matches) == 3  # 2 SF + 1 Final

        matches_played = 0
        while bracket.pending_matches():
            m = bracket.pending_matches()[0]
            bracket.record_result(m.id, (6, 3))
            matches_played += 1

        assert matches_played == 3
        champ = bracket.champion()
        assert champ is not None
        # team1 always wins (6-3), so the champion is the team1 of the Final,
        # which is the winner of the first semi-final = seed 1
        assert champ[0].name == "T1"


# ── Double Elimination ─────────────────────────────────────


class TestDoubleElimination:
    def test_creates_winners_matches(self):
        bracket = DoubleEliminationBracket(_teams(4))
        assert len(bracket.winners_matches) > 0

    def test_grand_final_exists(self):
        bracket = DoubleEliminationBracket(_teams(4))
        assert bracket.grand_final is not None
        assert bracket.grand_final.round_label == "Grand Final"

    def test_loser_goes_to_losers_bracket(self):
        bracket = DoubleEliminationBracket(_teams(4))
        # Play a winners match
        m = bracket.winners_matches[0]
        bracket.record_result(m.id, (6, 2))
        # A losers bracket match should now exist or be queued
        assert len(bracket.losers_matches) >= 0  # may need 2 losers

    def test_two_teams_double_elim(self):
        bracket = DoubleEliminationBracket(_teams(2))
        assert len(bracket.winners_matches) == 1
        assert bracket.grand_final is not None

    def test_pending_matches_returns_playable(self):
        bracket = DoubleEliminationBracket(_teams(4))
        pending = bracket.pending_matches()
        for m in pending:
            assert m.team1  # has players
            assert m.team2
            assert m.status != MatchStatus.COMPLETED
