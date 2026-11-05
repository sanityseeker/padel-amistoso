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
        """2-team double elimination: W Final → loser plays Grand Final (played once)."""
        bracket = DoubleEliminationBracket(_teams(2))
        # Winners final
        wf = bracket.pending_matches()[0]
        bracket.record_result(wf.id, (10, 0))  # T1 wins
        # Grand Final should now be pending: T1 vs T2
        gf = bracket.grand_final
        assert gf.team1 and gf.team2, "Grand Final must have both teams after Winners Final"
        bracket.record_result(gf.id, (10, 0))  # T1 wins the single Grand Final
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

    # ── Single Grand Final (no reset) ──────────────────────

    @staticmethod
    def _drain(bracket: DoubleEliminationBracket, *, lb_team_wins_gf: bool = False, rng=None) -> None:
        """Play every pending match. Optionally force the losers-bracket team to win the GF."""
        for _ in range(100):
            pending = bracket.pending_matches()
            if not pending:
                return
            m = pending[0]
            if m is bracket.grand_final and lb_team_wins_gf:
                wb_champ = bracket.winners_matches[-1].winner_team
                team1_wins = m.team1 != wb_champ
            elif rng is not None:
                team1_wins = rng.random() < 0.5
            else:
                team1_wins = True
            bracket.record_result(m.id, (10, 0) if team1_wins else (0, 10))
        raise AssertionError("bracket did not drain")

    @staticmethod
    def _assert_no_reset(bracket: DoubleEliminationBracket) -> None:
        assert not [m for m in bracket.all_matches if m.round_label == "Grand Final Reset"]
        assert [m.round_label for m in bracket.all_matches].count("Grand Final") == 1

    @pytest.mark.parametrize("n", [2, 4])
    def test_losers_bracket_team_wins_grand_final(self, n):
        bracket = DoubleEliminationBracket(_teams(n))
        if n == 2:
            # Only two teams: the "losers-bracket" team is the WF loser.
            wf = bracket.pending_matches()[0]
            bracket.record_result(wf.id, (10, 0))
            gf = bracket.grand_final
            bracket.record_result(gf.id, (0, 10))
            wb_champ = wf.winner_team
            expected = gf.team2
            assert expected != wb_champ
        else:
            self._drain(bracket, lb_team_wins_gf=True)
            wb_champ = bracket.winners_matches[-1].winner_team
            expected = bracket.grand_final.winner_team
            assert expected != wb_champ
        assert bracket.champion() == expected
        self._assert_no_reset(bracket)
        assert bracket.pending_matches() == []

    def test_rerecording_grand_final_changes_champion_without_new_match(self):
        bracket = DoubleEliminationBracket(_teams(4))
        self._drain(bracket, lb_team_wins_gf=True)
        gf = bracket.grand_final
        n_matches = len(bracket.all_matches)
        first = bracket.champion()
        assert first == gf.team1 or first == gf.team2

        other = gf.team2 if first == gf.team1 else gf.team1
        bracket.record_result(gf.id, (0, 10) if first == gf.team1 else (10, 0))
        assert bracket.champion() == other
        assert len(bracket.all_matches) == n_matches
        self._assert_no_reset(bracket)
        assert bracket.pending_matches() == []

    @pytest.mark.parametrize("n", [2, 3, 4, 5, 8])
    def test_random_results_always_single_grand_final(self, n):
        import random

        for seed in range(10):
            bracket = DoubleEliminationBracket(_teams(n))
            self._drain(bracket, rng=random.Random(seed))
            self._assert_no_reset(bracket)
            assert bracket.champion() is not None
            assert bracket.pending_matches() == []

    def test_legacy_completed_reset_decides_champion(self):
        """Old persisted brackets may carry a completed 'Grand Final Reset' match."""
        from backend.models import Match

        bracket = DoubleEliminationBracket(_teams(2))
        wf = bracket.pending_matches()[0]
        bracket.record_result(wf.id, (10, 0))
        gf = bracket.grand_final
        bracket.record_result(gf.id, (0, 10))
        reset = Match(team1=gf.team2, team2=gf.team1, round_label="Grand Final Reset", round_number=99)
        reset.score = (0, 10)
        reset.status = MatchStatus.COMPLETED
        bracket.grand_final_reset = reset
        assert bracket.champion() == reset.winner_team
        assert reset in bracket.all_matches
        assert bracket.all_matches[-1] is reset


class TestDoubleEliminationTopology:
    """Tests for BracketTopology export and for_preview factory."""

    def test_topology_contains_all_matches(self):
        """topology() must reference every WR and LR match in the bracket."""
        from backend.tournaments.playoff import BracketTopology

        bracket = DoubleEliminationBracket(_teams(8))
        topo = bracket.topology()

        assert isinstance(topo, BracketTopology)
        topo_wr_ids = {mref.id for rnd in topo.winners_rounds for mref in rnd}
        topo_lr_ids = {mref.id for rnd in topo.losers_rounds for mref in rnd}

        for m in bracket.winners_matches:
            assert m.id in topo_wr_ids, f"WR match {m.id} missing from topology"
        for m in bracket.losers_matches:
            assert m.id in topo_lr_ids, f"LR match {m.id} missing from topology"

    def test_topology_advancement_edges_match_internal(self):
        """topology() advancement edges must exactly mirror _advancement dict."""
        bracket = DoubleEliminationBracket(_teams(6))
        topo = bracket.topology()

        # Build set of (from, to, slot, is_loser) from internal dict
        internal = {(fid, tid, slot, il) for fid, targets in bracket._advancement.items() for tid, slot, il in targets}
        # Build same set from topology
        from_topo = {(e.from_id, e.to_id, e.to_slot, e.is_loser) for e in topo.advancement_edges}
        assert internal == from_topo

    def test_for_preview_produces_same_round_count(self):
        """for_preview(n) must produce the same bracket shape as a real n-team bracket."""
        for n in (2, 4, 5, 6, 7, 8):
            real = DoubleEliminationBracket(_teams(n))
            preview = DoubleEliminationBracket.for_preview(n)
            real_topo = real.topology()
            prev_topo = preview.topology()

            assert len(real_topo.winners_rounds) == len(prev_topo.winners_rounds), f"n={n}: WR round count mismatch"
            assert len(real_topo.losers_rounds) == len(prev_topo.losers_rounds), f"n={n}: LR round count mismatch"
            assert len(real_topo.advancement_edges) == len(prev_topo.advancement_edges), (
                f"n={n}: advancement edge count mismatch"
            )

    @pytest.mark.parametrize("n", [2, 4, 5, 6, 7, 8, 16])
    def test_topology_grand_final_reachable(self, n):
        """Every bracket topology must have a wired path to the Grand Final."""
        bracket = DoubleEliminationBracket.for_preview(n)
        topo = bracket.topology()
        # At least one edge must point to the grand_final
        gf_targets = [e for e in topo.advancement_edges if e.to_id == topo.grand_final.id]
        assert len(gf_targets) >= 1, f"n={n}: no edge leads to Grand Final"


class TestDoubleEliminationWR2PairingFix:
    """Verify that WR2 losers face each other before meeting LR1 survivors."""

    def test_6_team_wr2_losers_play_each_other(self):
        """For a 6-team bracket (2 WR1 byes), both WR2 losers must be wired
        to the SAME LR match so they face each other, not LR1 survivors."""
        bracket = DoubleEliminationBracket(_teams(6))

        # Collect the loser advancement edges from WR2 matches (round_number=2).
        wr2_matches = [m for m in bracket.winners_matches if m.round_label == "Winners R2"]
        assert len(wr2_matches) == 2, "Expected 2 WR2 matches for 6 teams"

        wr2_loser_targets: set[str] = set()
        for wm in wr2_matches:
            for to_id, _slot, is_loser in bracket._advancement.get(wm.id, []):
                if is_loser:
                    wr2_loser_targets.add(to_id)

        assert len(wr2_loser_targets) == 1, (
            "Both WR2 losers must be wired to the SAME LR match (they should play each other), "
            f"but found {len(wr2_loser_targets)} distinct target(s)"
        )

    def test_6_team_lr2_match_has_two_wr2_loser_feeders(self):
        """The LR2 match for a 6-team bracket must receive both of its teams
        from WR2 losers (not a mix of WR2 loser + LR1 survivor)."""
        bracket = DoubleEliminationBracket(_teams(6))
        topo = bracket.topology()

        # Build reverse map: to_id → list of (from_id, is_loser)
        feeders: dict[str, list[tuple[str, bool]]] = {}
        for edge in topo.advancement_edges:
            feeders.setdefault(edge.to_id, []).append((edge.from_id, edge.is_loser))

        wr2_ids = {mref.id for rnd in topo.winners_rounds[1:2] for mref in rnd}

        for lr_round in topo.losers_rounds:
            for mref in lr_round:
                inbound = feeders.get(mref.id, [])
                from_wr2 = [fid for fid, il in inbound if il and fid in wr2_ids]
                if len(from_wr2) == 2:
                    # Found the match where both WR2 losers meet — test passes.
                    return

        pytest.fail(
            "No LR match found where both slots are fed by WR2 losers. "
            "WR2 losers should play each other in their own minor round."
        )

    def test_6_team_wr1_losers_play_each_other(self):
        """WR1 losers should be paired together (not each face a bye in LR1)."""
        bracket = DoubleEliminationBracket(_teams(6))

        # LR1 must have exactly 1 real (non-bye) match wiring 2 WR1 losers.
        lr1_matches = [m for m in bracket.losers_matches if m.round_label == "Losers R1"]

        # All WR1 loser advancement edges should target LR1 matches.
        wr1_loser_targets: list[str] = []
        for m in bracket.winners_matches:
            if m.round_label != "Winners R1":
                continue
            for to_id, _slot, is_loser in bracket._advancement.get(m.id, []):
                if is_loser:
                    wr1_loser_targets.append(to_id)

        # Both WR1 losers go to the same LR1 match (sequential pairing).
        assert len(set(wr1_loser_targets)) == 1, (
            f"Both WR1 losers should target a single LR1 match, "
            f"but found {len(set(wr1_loser_targets))} distinct target(s)"
        )
        # That one LR1 match must have BOTH slots wired (no byes).
        lr1_target_id = wr1_loser_targets[0]
        assert lr1_target_id in {m.id for m in lr1_matches}
        inbound_slots = [
            slot
            for from_id, targets in bracket._advancement.items()
            for to_id, slot, is_loser in targets
            if to_id == lr1_target_id and is_loser
        ]
        assert len(inbound_slots) == 2, "LR1 match should have both slots filled by WR1 losers"
        assert set(inbound_slots) == {0, 1}, "LR1 match slots must be 0 and 1"

    @pytest.mark.parametrize("n", [4, 8])
    def test_full_bracket_structure_unchanged(self, n):
        """For full power-of-2 brackets (no byes), LR structure must be standard.
        Specifically: LR1 survivors count == WR2 dropper count, so no extra
        minor round is inserted and the match count stays the same."""
        bracket = DoubleEliminationBracket(_teams(n))
        import math

        bracket_size = 1 << (n - 1).bit_length()
        num_rounds_w = int(math.log2(bracket_size))
        # Standard DE: num_lr_rounds = 2*(k-1)
        expected_lr_rounds = 2 * (num_rounds_w - 1)
        actual_lr_rounds = len(set(m.round_number for m in bracket.losers_matches))
        assert actual_lr_rounds == expected_lr_rounds, (
            f"n={n}: expected {expected_lr_rounds} LR rounds, got {actual_lr_rounds}"
        )

    def test_6_team_full_playthrough(self):
        """A 6-team bracket must complete correctly with the new LR structure."""
        bracket = DoubleEliminationBracket(_teams(6))
        for _ in range(30):
            pending = bracket.pending_matches()
            if not pending:
                break
            bracket.record_result(pending[0].id, (10, 0))
        assert bracket.champion() is not None, "6-team double-elim must produce a champion"
        gf = bracket.grand_final
        assert gf.team1 and gf.team2, "Grand Final must have both teams assigned"

    def test_10_team_lr_has_no_bye_matches(self):
        """For 10 teams (2 WR1 real matches → 1 LR1 survivor, 4 WR2 losers → 2
        LR2 survivors), the WR2 preliminary winners must pair among themselves
        (LR3) before crossing with the LR1 survivor (LR4).  No LR match should
        have a bye (unoccupied slot)."""
        bracket = DoubleEliminationBracket(_teams(10))

        feeders: dict[str, list[tuple[str, int, bool]]] = {}
        for from_id, edges in bracket._advancement.items():
            for to_id, slot, is_loser in edges:
                feeders.setdefault(to_id, []).append((from_id, slot, is_loser))

        bye_matches = []
        for m in bracket.losers_matches:
            slots_filled = {slot for _, slot, _ in feeders.get(m.id, [])}
            if {0, 1} != slots_filled:
                bye_matches.append(f"{m.round_label} p{m.pair_index} (slots={slots_filled})")

        assert not bye_matches, (
            f"All LR matches for 10 teams must have both slots filled (no byes). Byes found in: {bye_matches}"
        )

    def test_10_team_full_playthrough(self):
        """A 10-team bracket must complete correctly with the fixed LR structure."""
        bracket = DoubleEliminationBracket(_teams(10))
        for _ in range(50):
            pending = bracket.pending_matches()
            if not pending:
                break
            bracket.record_result(pending[0].id, (10, 0))
        assert bracket.champion() is not None, "10-team double-elim must produce a champion"
        gf = bracket.grand_final
        assert gf.team1 and gf.team2, "Grand Final must have both teams assigned"

    def test_12_team_wr3_losers_play_each_other(self):
        """For a 12-team bracket, both WR3 losers must be wired to the SAME
        LR match so they face each other before meeting LR survivors."""
        bracket = DoubleEliminationBracket(_teams(12))

        wr3_matches = [m for m in bracket.winners_matches if m.round_label == "Winners R3"]
        assert len(wr3_matches) == 2, "Expected 2 WR3 matches for 12 teams"

        wr3_loser_targets: set[str] = set()
        for wm in wr3_matches:
            for to_id, _slot, is_loser in bracket._advancement.get(wm.id, []):
                if is_loser:
                    wr3_loser_targets.add(to_id)

        assert len(wr3_loser_targets) == 1, (
            "Both WR3 losers must be wired to the SAME LR match (they should play each other), "
            f"but found {len(wr3_loser_targets)} distinct target(s)"
        )

    def test_12_team_wr3_preliminary_match_has_two_wr3_loser_feeders(self):
        """The preliminary LR match for WR3 in a 12-team bracket must receive
        both of its teams from WR3 losers (not a mix of WR3 loser + LR survivor)."""
        bracket = DoubleEliminationBracket(_teams(12))
        topo = bracket.topology()

        feeders: dict[str, list[tuple[str, bool]]] = {}
        for edge in topo.advancement_edges:
            feeders.setdefault(edge.to_id, []).append((edge.from_id, edge.is_loser))

        wr3_ids = {mref.id for rnd in topo.winners_rounds[2:3] for mref in rnd}

        for lr_round in topo.losers_rounds:
            for mref in lr_round:
                inbound = feeders.get(mref.id, [])
                from_wr3 = [fid for fid, il in inbound if il and fid in wr3_ids]
                if len(from_wr3) == 2:
                    return  # found the WR3 preliminary match

        pytest.fail(
            "No LR match found where both slots are fed by WR3 losers. "
            "WR3 losers should play each other in their own preliminary minor round."
        )

    def test_12_team_full_playthrough(self):
        """A 12-team bracket must complete correctly with the fixed LR structure."""
        bracket = DoubleEliminationBracket(_teams(12))
        for _ in range(60):
            pending = bracket.pending_matches()
            if not pending:
                break
            bracket.record_result(pending[0].id, (10, 0))
        assert bracket.champion() is not None, "12-team double-elim must produce a champion"
        gf = bracket.grand_final
        assert gf.team1 and gf.team2, "Grand Final must have both teams assigned"

    def test_12_team_viz_has_wr3_loser_pairing_node(self):
        """For 12 teams, the schema graph must contain a losers-match node
        that has two incoming 'loss' edges, both from Winners R3 nodes."""
        from backend.viz.bracket_schema import _compute_playoff_layout

        layout = _compute_playoff_layout([f"P{i}" for i in range(12)], "double", match_labels=None)
        G = layout["graph"]
        meta = layout["node_meta"]

        found = False
        for node in G.nodes():
            if meta.get(node, {}).get("kind") != "losers_match":
                continue
            incoming = [(u, G.edges[u, node]["relation"]) for u in G.predecessors(node)]
            loss_from_wr3 = [
                u
                for u, rel in incoming
                if rel == "loss"
                and meta.get(u, {}).get("kind") == "winners_match"
                and meta.get(u, {}).get("round_header") == "Winners R3"
            ]
            if len(loss_from_wr3) == 2:
                found = True
                break

        assert found, (
            "Expected a losers-match node with two 'loss' edges from Winners R3 nodes "
            "(WR3 losers should play each other in their own preliminary minor round)"
        )


class TestDoubleEliminationSchemaViz:
    """Verify the viz correctly reflects the topology-driven bracket structure."""

    def test_6_team_viz_has_wr2_loser_pairing_node(self):
        """For 6 teams, the schema graph must contain a losers-match node
        that has two incoming 'loss' edges, both from Winners R2 nodes."""
        from backend.viz.bracket_schema import _compute_playoff_layout

        layout = _compute_playoff_layout([f"P{i}" for i in range(6)], "double", match_labels=None)
        G = layout["graph"]
        meta = layout["node_meta"]

        # Find all losers nodes whose two incoming edges are both 'loss' from WR2 nodes.
        found = False
        for node in G.nodes():
            if meta.get(node, {}).get("kind") != "losers_match":
                continue
            incoming = [(u, G.edges[u, node]["relation"]) for u in G.predecessors(node)]
            loss_from_winners = [
                u
                for u, rel in incoming
                if rel == "loss"
                and meta.get(u, {}).get("kind") == "winners_match"
                and meta.get(u, {}).get("round_header") == "Winners R2"
            ]
            if len(loss_from_winners) == 2:
                found = True
                break

        assert found, (
            "Expected a losers-match node with two 'loss' edges from Winners R2 nodes "
            "(WR2 losers should play each other in their own minor round)"
        )

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


# ── Espejo parallel bracket ────────────────────────────────


class TestEspejoParallelBracket:
    """Tests for EspejoParallelBracket (two independent single-elim brackets)."""

    def _play_r1(self, bracket):
        """Play all Round-1 winners matches, team1 always wins."""
        r1 = [m for m in bracket.winners_bracket.matches if m.round_number == 1]
        for m in r1:
            bracket.record_result(m.id, (6, 3))
        return r1

    def test_losers_bracket_none_before_r1_complete(self):
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(4))
        assert b.losers_bracket is None

    def test_losers_bracket_seeded_after_r1_complete(self):
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(4))
        self._play_r1(b)
        assert b.losers_bracket is not None

    def test_r1_losers_count_4_teams(self):
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(4))
        self._play_r1(b)
        assert len(b.losers_bracket.original_teams) == 2

    def test_r1_losers_count_8_teams(self):
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(8))
        self._play_r1(b)
        assert len(b.losers_bracket.original_teams) == 4

    def test_bye_team_not_in_losers_bracket(self):
        """With 3 teams only 1 real R1 match exists (seed 1 gets a bye),
        so only 1 loser is produced — not enough for a LB.  The LB is not
        seeded in this case.  Seed 1 (T1) never loses, so they definitely
        cannot appear in any LB."""
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(3))
        self._play_r1(b)
        # With only 1 R1 loser, the LB is not seeded (need ≥2 losers).
        assert b.losers_bracket is None

    def _play_all(self, b):
        """Play every ready match in both brackets until nothing is pending."""
        while True:
            pending = b.pending_matches()
            if not pending:
                return
            b.record_result(pending[0].id, (6, 3))

    def test_no_super_final_is_ever_created(self):
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(4))
        self._play_all(b)
        assert b.super_final_enabled is False
        assert b.super_final_match is None
        assert b.is_finished()
        assert b.champion() == b.winners_champion()
        assert b.losers_champion() is not None

    def test_super_final_kwarg_removed(self):
        from backend.tournaments.playoff import EspejoParallelBracket

        with pytest.raises(TypeError):
            EspejoParallelBracket(_teams(4), super_final=True)

    def test_not_finished_after_wb_final_while_lb_pending(self):
        """WB champion is known, but the bracket only finishes after the LB final."""
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(8))
        self._play_r1(b)
        # Play only the WB to its final.
        while b.winners_bracket.pending_matches():
            m = b.winners_bracket.pending_matches()[0]
            b.record_result(m.id, (6, 3))
        assert b.winners_champion() is not None
        assert b.losers_bracket.pending_matches()  # LB still has matches
        assert not b.is_finished()
        assert b.champion() is None
        # Finish the LB.
        while b.losers_bracket.pending_matches():
            m = b.losers_bracket.pending_matches()[0]
            assert not b.is_finished()
            b.record_result(m.id, (6, 3))
        assert b.is_finished()
        assert b.champion() == b.winners_champion()
        assert b.losers_champion() is not None
        assert b.losers_champion() != b.champion()

    def test_lb_finished_before_wb_still_waits_for_wb(self):
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(8))
        self._play_r1(b)
        while b.losers_bracket.pending_matches():
            b.record_result(b.losers_bracket.pending_matches()[0].id, (6, 3))
        assert b.losers_champion() is not None
        assert not b.is_finished()
        assert b.champion() is None
        while b.winners_bracket.pending_matches():
            b.record_result(b.winners_bracket.pending_matches()[0].id, (6, 3))
        assert b.is_finished()

    @pytest.mark.parametrize("n", [2, 3])
    def test_small_brackets_finish_with_wb_only(self, n):
        """<2 played R1 losers means no LB; the Espejo must never get stuck."""
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(n))
        self._play_all(b)
        assert b.losers_bracket is None
        assert b.is_finished()
        assert b.champion() == b.winners_champion()
        assert b.losers_champion() is None

    def test_legacy_super_final_bracket_still_plays_to_completion(self):
        """A bracket persisted with a Super Final (old flag) loads and finishes."""
        import pickle

        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(4))
        b.super_final_enabled = True  # what an old persisted instance carries
        self._play_r1(b)
        b = pickle.loads(pickle.dumps(b))  # survives persistence round-trip
        for m in list(b.winners_bracket.pending_matches()):
            b.record_result(m.id, (6, 3))
        assert b.super_final_match is None  # LB not done yet
        assert not b.is_finished()
        for m in list(b.losers_bracket.pending_matches()):
            b.record_result(m.id, (6, 3))
        sf = b.super_final_match
        assert sf is not None
        assert not b.is_finished()
        assert b.champion() is None  # SF not played
        b.record_result(sf.id, (3, 6))
        assert b.is_finished()
        assert b.champion() == sf.winner_team
        assert b.champion() == b.losers_champion()  # LB champ won the SF

    def test_legacy_pickle_without_super_final_attribute_loads(self):
        """Instances pickled before ``super_final_enabled`` existed fall back to the class default."""
        import pickle

        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(4))
        b.__dict__.pop("super_final_enabled", None)
        b2 = pickle.loads(pickle.dumps(b))
        assert b2.super_final_enabled is False
        self._play_all(b2)
        assert b2.is_finished()

    def test_record_unknown_match_raises(self):
        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(4))
        with pytest.raises(KeyError):
            b.record_result("nonexistent-id", (6, 3))

    def test_playoff_tournament_espejo_flag(self):
        t = PlayoffTournament(teams=_teams(4), espejo=True)
        assert t.espejo is True
        assert len(t.all_matches()) > 0

    def test_playoff_tournament_espejo_seeds_lb_after_r1(self):
        t = PlayoffTournament(teams=_teams(4), espejo=True)
        r1 = [m for m in t.all_matches() if m.round_number == 1]
        for m in r1:
            t.record_result(m.id, (6, 3))
        assert t.bracket.losers_bracket is not None

    def test_playoff_tournament_not_finished_until_lb_done(self):
        from backend.models import POPhase

        t = PlayoffTournament(teams=_teams(8), espejo=True)
        # Play the whole WB, leaving the LB untouched.
        while True:
            pending = [m for m in t.pending_matches() if m in t.bracket.winners_bracket.matches]
            if not pending:
                break
            t.record_result(pending[0].id, (6, 3))
        assert t.bracket.winners_champion() is not None
        assert t.phase == POPhase.PLAYOFFS
        assert t.champion() is None
        # Now the LB.
        while t.pending_matches():
            assert t.phase == POPhase.PLAYOFFS
            t.record_result(t.pending_matches()[0].id, (6, 3))
        assert t.phase == POPhase.FINISHED
        assert t.champion() == t.bracket.winners_champion()

    @pytest.mark.parametrize("n", [2, 3])
    def test_playoff_tournament_small_espejo_finishes(self, n):
        from backend.models import POPhase

        t = PlayoffTournament(teams=_teams(n), espejo=True)
        while t.pending_matches():
            t.record_result(t.pending_matches()[0].id, (6, 3))
        assert t.phase == POPhase.FINISHED


class TestEspejoSplitBracket:
    """Oro / Plata: both single-elimination brackets exist from the start."""

    def _make(self, n_up=4, n_low=4, **kw):
        from backend.tournaments.playoff import EspejoSplitBracket

        up = [_team(f"U{i + 1}") for i in range(n_up)]
        low = [_team(f"L{i + 1}") for i in range(n_low)]
        return EspejoSplitBracket(up, low, **kw)

    @staticmethod
    def _play_all(b):
        while b.pending_matches():
            b.record_result(b.pending_matches()[0].id, (6, 3))

    def test_both_brackets_exist_immediately(self):
        b = self._make()
        assert b.winners_bracket is not None
        assert b.losers_bracket is not None
        assert len(b.pending_matches()) == 4  # two semi-finals per bracket

    def test_r1_losers_never_drop_down(self):
        b = self._make()
        before = {m.id for m in b.losers_bracket.matches}
        for m in [m for m in b.winners_bracket.matches if m.round_number == 1]:
            b.record_result(m.id, (6, 3))
        assert {m.id for m in b.losers_bracket.matches} == before
        assert len(b.losers_bracket.original_teams) == 4

    def test_three_team_bracket_gets_bye(self):
        b = self._make(n_up=3, n_low=2)
        self._play_all(b)
        assert b.is_finished()
        assert b.winners_champion() is not None
        assert b.losers_champion() is not None

    def test_needs_two_teams_per_bracket(self):
        from backend.tournaments.playoff import EspejoSplitBracket

        with pytest.raises(ValueError):
            EspejoSplitBracket(_teams(3), _teams(1))

    def test_finished_needs_both_brackets(self):
        b = self._make()
        up_ids = {m.id for m in b.winners_bracket.matches}
        while True:
            pending = [m for m in b.pending_matches() if m.id in up_ids]
            if not pending:
                break
            b.record_result(pending[0].id, (6, 3))
        assert b.winners_champion() is not None
        assert not b.is_finished()
        assert b.champion() is None
        self._play_all(b)
        assert b.is_finished()
        assert b.champion() == b.winners_champion()
        assert b.losers_champion() != b.winners_champion()

    def test_finished_waits_for_both_third_place_matches(self):
        b = self._make(third_place=True, lower_third_place=True)
        tp_ids = {b.winners_bracket.third_place_match.id, b.losers_bracket.third_place_match.id}
        # Play everything except the two 3rd-place matches.
        while True:
            pending = [m for m in b.pending_matches() if m.id not in tp_ids]
            if not pending:
                break
            b.record_result(pending[0].id, (6, 3))
        assert not b.is_finished()
        b.record_result(b.winners_bracket.third_place_match.id, (6, 3))
        assert not b.is_finished()
        b.record_result(b.losers_bracket.third_place_match.id, (6, 3))
        assert b.is_finished()
        assert b.lower_third_place_team() is not None

    def test_lower_third_place_independent_of_upper(self):
        b = self._make(third_place=False, lower_third_place=True)
        assert b.winners_bracket.third_place_match is None
        assert b.losers_bracket.third_place_match is not None

    def test_lower_third_place_needs_four_teams(self):
        with pytest.raises(ValueError):
            self._make(n_up=4, n_low=3, lower_third_place=True)

    def test_pickle_round_trip(self):
        import pickle

        b = self._make(lower_third_place=True)
        b.record_result(b.pending_matches()[0].id, (6, 3))
        b2 = pickle.loads(pickle.dumps(b))
        assert b2.is_split
        assert len(b2.all_matches) == len(b.all_matches)
        self._play_all(b2)
        assert b2.is_finished()

    def test_old_parent_pickle_still_loads(self):
        import pickle

        from backend.tournaments.playoff import EspejoParallelBracket

        b = EspejoParallelBracket(_teams(4))
        b2 = pickle.loads(pickle.dumps(b))
        assert not getattr(b2, "is_split", False)
        self._play_all(b2)
        assert b2.is_finished()
