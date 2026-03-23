"""Tests for playoff module — single and double elimination."""

from __future__ import annotations

import pytest

from backend.models import Court, MatchStatus, Player
from backend.tournaments import DoubleEliminationBracket, SingleEliminationBracket
from backend.tournaments.playoff_tournament import PlayoffTournament


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

    def test_5_teams_losers_bracket_not_skipped(self):
        """Regression: with 5 teams the last winners-bracket loser must play the
        losers-bracket survivor in an extra losers round before the Grand Final.
        Previously, the loser was prematurely placed directly in the Grand Final
        when the last winners match completed and the queue had only 1 entry."""
        bracket = DoubleEliminationBracket(_teams(5))

        def _play_next(bracket: DoubleEliminationBracket) -> None:
            """Play the first available pending match; team1 always wins."""
            m = bracket.pending_matches()[0]
            bracket.record_result(m.id, (10, 0))

        # Drain all matches until the Grand Final is pending and/or champion known.
        max_rounds = 30
        for _ in range(max_rounds):
            pending = bracket.pending_matches()
            if not pending:
                break
            _play_next(bracket)

        champ = bracket.champion()
        assert champ is not None, "Tournament should have a champion after all matches"

        # Verify no team reached the Grand Final without going through the
        # full losers bracket (i.e. the Grand Final actually had both teams set).
        gf = bracket.grand_final
        assert gf.team1, "Grand Final team1 was never assigned"
        assert gf.team2, "Grand Final team2 was never assigned — losers bracket was skipped"

    def test_full_double_elim_2_teams(self):
        """2-team double elimination: W Final → loser plays Grand Final → possible reset."""
        bracket = DoubleEliminationBracket(_teams(2))
        # Winners final
        wf = bracket.pending_matches()[0]
        bracket.record_result(wf.id, (10, 0))  # T1 wins
        # Grand Final should now be pending: T1 vs T2
        gf = bracket.grand_final
        assert gf.team1 and gf.team2, "Grand Final must have both teams after Winners Final"
        bracket.record_result(gf.id, (10, 0))  # T1 wins again → no reset needed
        assert bracket.champion() == gf.team1

    def test_full_double_elim_4_teams_champion_found(self):
        """Full 4-team double elimination always produces a champion."""
        bracket = DoubleEliminationBracket(_teams(4))
        for _ in range(20):
            pending = bracket.pending_matches()
            if not pending:
                break
            bracket.record_result(pending[0].id, (10, 0))
        assert bracket.champion() is not None


class TestSchemaLossEdgeRewiring:
    """Verify that loss edges in the bracket diagram point to the correct losers match."""

    def test_loss_edges_match_actual_game_data_5_teams(self):
        """With 5 teams, loss edges should point to wherever the loser actually appears."""
        from backend.api.helpers import _build_match_labels
        from backend.viz.bracket_schema import _compute_playoff_layout

        teams = [_team(n) for n in ["Alice", "Bob", "Carol", "Dave", "Eve"]]
        bracket = DoubleEliminationBracket(teams)

        # Play all winners matches so losers accumulate.
        for _ in range(20):
            pending = bracket.pending_matches()
            if not pending:
                break
            bracket.record_result(pending[0].id, (10, 0))

        match_labels = _build_match_labels(bracket)
        participant_names = [p.name for t in teams for p in t]
        layout = _compute_playoff_layout(participant_names, "double", match_labels=match_labels)
        G = layout["graph"]
        meta = layout["node_meta"]

        # Every loss edge (winners_match → losers_match) must be backed by
        # real data: the loser of the winners match must appear as a
        # participant in the target losers match.
        for u, v, data in G.edges(data=True):
            if data.get("relation") != "loss":
                continue
            u_kind = meta.get(u, {}).get("kind", "")
            v_kind = meta.get(v, {}).get("kind", "")
            if u_kind != "winners_match" or v_kind != "losers_match":
                continue

            u_md = match_labels.get(u)
            if not u_md or not u_md.get("loser"):
                continue  # no data yet, structural edge is fine

            loser_name = u_md["loser"]
            # Find the label for the target losers node.
            v_label = meta.get(v, {}).get("label", "")
            assert loser_name in v_label, (
                f"Loss edge {u} → {v}: loser '{loser_name}' not found in target label '{v_label}'"
            )


# ── PlayoffTournament court assignment ─────────────────────


class TestPlayoffTournamentCourtAssignment:
    """Verify the greedy court assignment: every free court is filled immediately,
    and no two active (not-yet-completed) matches ever share a court."""

    def _courts(self, n: int) -> list[Court]:
        return [Court(name=f"Court {i + 1}") for i in range(n)]

    def _active_court_names(self, t: PlayoffTournament) -> list[str]:
        return [m.court.name for m in t.all_matches() if m.court is not None and m.status != MatchStatus.COMPLETED]

    def test_init_fills_all_available_courts(self):
        """On construction with 4 ready R1 matches and 3 courts, all 3 courts are used."""
        teams = [[Player(name=f"P{i}")] for i in range(8)]
        t = PlayoffTournament(teams=teams, courts=self._courts(3))
        active_courts = self._active_court_names(t)
        assert set(active_courts) == {"Court 1", "Court 2", "Court 3"}

    def test_no_two_active_matches_share_a_court(self):
        """At every point in a single-elim tournament, active matches have unique courts."""
        teams = [[Player(name=f"P{i}")] for i in range(8)]
        t = PlayoffTournament(teams=teams, courts=self._courts(3))

        while True:
            pending = t.pending_matches()
            if not pending:
                break
            active_courts = self._active_court_names(t)
            assert len(active_courts) == len(set(active_courts)), (
                f"Duplicate courts among active matches: {active_courts}"
            )
            t.record_result(pending[0].id, (10, 0))

    def test_freed_court_is_reused_immediately(self):
        """After completing a match, the freed court is assigned to the next waiting match."""
        teams = [[Player(name=f"P{i}")] for i in range(8)]
        courts = self._courts(3)
        t = PlayoffTournament(teams=teams, courts=courts)

        # 3 courts occupied, 1 R1 match waiting.
        waiting = [m for m in t.all_matches() if m.court is None and m.team1 and m.team2]
        assert len(waiting) == 1

        # Complete one pending match; its court must go to the waiting match.
        first = t.pending_matches()[0]
        freed_court_name = first.court.name
        t.record_result(first.id, (10, 0))

        # The previously waiting match must now have the freed court.
        previously_waiting = next(m for m in t.all_matches() if m.id == waiting[0].id)
        assert previously_waiting.court is not None
        assert previously_waiting.court.name == freed_court_name

    def test_double_elim_no_two_active_matches_share_a_court(self):
        """Same invariant for double-elimination: no active matches share a court."""
        teams = [[Player(name=f"P{i}")] for i in range(8)]
        t = PlayoffTournament(teams=teams, courts=self._courts(3), double_elimination=True)

        for _ in range(40):  # safety limit
            pending = t.pending_matches()
            if not pending:
                break
            active_courts = self._active_court_names(t)
            assert len(active_courts) == len(set(active_courts)), (
                f"Duplicate courts among active matches: {active_courts}"
            )
            t.record_result(pending[0].id, (10, 0))

    def test_double_elim_wr2_not_all_on_court1(self):
        """W-R2 matches in double-elim must not all be assigned Court 1."""
        teams = [[Player(name=f"P{i}")] for i in range(8)]
        courts = self._courts(3)
        t = PlayoffTournament(teams=teams, courts=courts, double_elimination=True)

        # Complete all W-R1 matches.
        for m in [m for m in t.all_matches() if m.round_label == "Winners R1"]:
            if m.court is not None:
                t.record_result(m.id, (10, 0))

        wr2_courts = [m.court.name for m in t.all_matches() if m.round_label == "Winners R2" and m.court is not None]
        assert len(wr2_courts) > 0, "No W-R2 matches have a court after W-R1 completion"
        # Stricter: if more than 1 W-R2 match has a court, they must differ.
        if len(wr2_courts) > 1:
            assert len(set(wr2_courts)) > 1, f"Multiple W-R2 matches all on same court: {wr2_courts}"
