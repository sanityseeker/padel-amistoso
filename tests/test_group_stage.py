"""Tests for group_stage module."""

from __future__ import annotations

from collections import defaultdict

import pytest

from backend.models import Court, MatchStatus, Player
from backend.tournaments import Group, assign_courts, distribute_players_to_groups

# ── Helpers ────────────────────────────────────────────────


def _make_players(n: int) -> list[Player]:
    return [Player(name=f"P{i + 1}") for i in range(n)]


# ── distribute_players_to_groups ───────────────────────────


class TestDistributePlayers:
    @pytest.mark.parametrize(
        "n_players, n_groups, expected_sizes",
        [
            (8, 2, [4, 4]),
            (7, 2, [3, 4]),
            (9, 3, [3, 3, 3]),
            (10, 3, [3, 3, 4]),
        ],
    )
    def test_group_sizes(self, n_players, n_groups, expected_sizes):
        groups = distribute_players_to_groups(_make_players(n_players), n_groups, shuffle=False)
        assert len(groups) == n_groups
        sizes = sorted(len(g.players) for g in groups)
        assert sizes == expected_sizes

    def test_group_names_are_letters(self):
        groups = distribute_players_to_groups(_make_players(12), 3, shuffle=False)
        assert [g.name for g in groups] == ["A", "B", "C"]

    @pytest.mark.parametrize("n_players, n_groups", [(10, 3), (8, 2), (9, 3)])
    def test_all_players_assigned(self, n_players, n_groups):
        players = _make_players(n_players)
        groups = distribute_players_to_groups(players, n_groups, shuffle=False)
        assigned = [p for g in groups for p in g.players]
        assert set(p.id for p in assigned) == set(p.id for p in players)


# ── Group round robin ─────────────────────────────────────


class TestGroupRoundRobin:
    def test_generates_matches(self):
        group = Group("A", _make_players(4))
        matches = group.generate_round_robin()
        assert len(matches) > 0

    def test_no_player_plays_both_sides(self):
        group = Group("A", _make_players(4))
        matches = group.generate_round_robin()
        for m in matches:
            ids_t1 = {p.id for p in m.team1}
            ids_t2 = {p.id for p in m.team2}
            assert ids_t1.isdisjoint(ids_t2), "Same player on both teams"

    def test_each_team_has_two_players(self):
        group = Group("A", _make_players(4))
        matches = group.generate_round_robin()
        for m in matches:
            assert len(m.team1) == 2
            assert len(m.team2) == 2

    def test_five_players_group(self):
        group = Group("B", _make_players(5))
        matches = group.generate_round_robin()
        assert len(matches) > 0
        # Every match is 2v2, no overlap
        for m in matches:
            assert len(m.team1) == 2
            assert len(m.team2) == 2

    def test_team_mode_generates_team_vs_team_matches(self):
        teams = [Player(name=n) for n in ["A & B", "C & D", "E & F", "G & H"]]
        group = Group("A", teams, team_mode=True)
        matches = group.generate_round_robin()
        assert len(matches) == 6  # C(4,2)
        for m in matches:
            assert len(m.team1) == 1
            assert len(m.team2) == 1


# ── Round-by-round generation ─────────────────────────────


class TestGenerateNextRound:
    def test_four_players_three_rounds(self):
        """With 4 players, exactly 3 rounds exhaust all partnerships."""
        group = Group("A", _make_players(4))
        all_matches = []
        for _ in range(3):
            matches = group.generate_next_round()
            assert len(matches) == 1
            m = matches[0]
            assert len(m.team1) == 2 and len(m.team2) == 2
            all_matches.extend(matches)
            # Record dummy score so standings update.
            m.score = (6, 3)
            m.status = MatchStatus.COMPLETED
        assert len(all_matches) == 3
        # Fourth round should return empty — all partnerships used.
        assert group.generate_next_round() == []
        assert not group.has_more_rounds

    def test_every_player_partners_with_every_other_exactly_once(self):
        """Each unique pair of players should partner exactly once."""
        players = _make_players(4)
        group = Group("A", players)
        partnerships: list[frozenset] = []
        for _ in range(3):
            matches = group.generate_next_round()
            for m in matches:
                partnerships.append(frozenset(p.id for p in m.team1))
                partnerships.append(frozenset(p.id for p in m.team2))
                m.score = (6, 3)
                m.status = MatchStatus.COMPLETED
        # 4 choose 2 = 6 unique partnerships
        assert len(partnerships) == 6
        assert len(set(partnerships)) == 6

    def test_has_more_rounds_tracks_correctly(self):
        group = Group("A", _make_players(4))
        assert group.has_more_rounds
        for _ in range(3):
            for m in group.generate_next_round():
                m.score = (6, 3)
                m.status = MatchStatus.COMPLETED
        assert not group.has_more_rounds

    def test_opponents_selected_by_score_proximity(self):
        """After round 1, teams should be balanced by cumulative score."""
        players = _make_players(4)
        group = Group("A", players)

        # Round 1: random (all scores 0).
        r1 = group.generate_next_round()
        m = r1[0]
        # Give one team a big win.
        m.score = (10, 2)
        m.status = MatchStatus.COMPLETED

        # Round 2: should pair the high-scorers on opposite teams to balance.
        r2 = group.generate_next_round()
        m2 = r2[0]
        scores = {p.id: 0 for p in players}
        for p in m.team1:
            scores[p.id] += 10
        for p in m.team2:
            scores[p.id] += 2
        t1_score = sum(scores[p.id] for p in m2.team1)
        t2_score = sum(scores[p.id] for p in m2.team2)
        # Both teams should have similar total scores (12 total → ideally 6 vs 6).
        assert abs(t1_score - t2_score) <= 8  # allows some slack

    def test_team_mode_raises_on_generate_next_round(self):
        """generate_next_round is only for individual mode."""
        teams = [Player(name=n) for n in ["A & B", "C & D", "E & F"]]
        group = Group("A", teams, team_mode=True)
        import pytest

        with pytest.raises(RuntimeError, match="team mode"):
            group.generate_next_round()

    def test_matches_accumulate_across_rounds(self):
        group = Group("A", _make_players(4))
        for i in range(3):
            matches = group.generate_next_round()
            for m in matches:
                m.score = (6, 3)
                m.status = MatchStatus.COMPLETED
        assert len(group.matches) == 3

    def test_five_players_round_by_round(self):
        """With 5 players some sit out each round, but partnerships still rotate."""
        group = Group("A", _make_players(5))
        all_partnerships: set[frozenset[str]] = set()
        rounds = 0
        while group.has_more_rounds:
            matches = group.generate_next_round()
            for m in matches:
                assert len(m.team1) == 2 and len(m.team2) == 2
                all_partnerships.add(frozenset(p.id for p in m.team1))
                all_partnerships.add(frozenset(p.id for p in m.team2))
                m.score = (6, 3)
                m.status = MatchStatus.COMPLETED
            rounds += 1
        # All 10 partnerships (5 choose 2) should be used.
        assert len(all_partnerships) == 10
        assert rounds > 0


# ── Standings ──────────────────────────────────────────────


class TestGroupStandings:
    def test_initial_standings_all_zero(self):
        group = Group("A", _make_players(4))
        group.generate_round_robin()
        standings = group.standings()
        assert len(standings) == 4
        for s in standings:
            assert s.played == 0
            assert s.match_points == 0

    def test_standings_after_one_result(self):
        players = _make_players(4)
        group = Group("A", players)
        group.generate_round_robin()
        m = group.matches[0]
        m.score = (6, 3)
        m.status = MatchStatus.COMPLETED

        standings = group.standings()
        # At least some players should have played 1 match
        played_counts = [s.played for s in standings]
        assert max(played_counts) == 1

    def test_win_gives_three_points(self):
        players = _make_players(4)
        group = Group("A", players)
        group.generate_round_robin()
        m = group.matches[0]
        m.score = (6, 3)
        m.status = MatchStatus.COMPLETED

        standings = group.standings()
        by_id = {s.player.id: s for s in standings}
        for p in m.team1:
            assert by_id[p.id].match_points == 3  # win
        for p in m.team2:
            assert by_id[p.id].match_points == 0  # loss

    def test_draw_gives_one_point(self):
        players = _make_players(4)
        group = Group("A", players)
        group.generate_round_robin()
        m = group.matches[0]
        m.score = (5, 5)
        m.status = MatchStatus.COMPLETED

        standings = group.standings()
        by_id = {s.player.id: s for s in standings}
        for p in m.team1 + m.team2:
            assert by_id[p.id].match_points == 1

    def test_top_players(self):
        players = _make_players(4)
        group = Group("A", players)
        group.generate_round_robin()
        # Complete all matches so standings are meaningful
        for m in group.matches:
            m.score = (6, 2)
            m.status = MatchStatus.COMPLETED
        top = group.top_players(2)
        assert len(top) == 2
        assert all(isinstance(p, Player) for p in top)


# ── Court assignment ───────────────────────────────────────


class TestCourtAssignment:
    def test_assigns_all_matches_to_existing_courts(self):
        group = Group("A", _make_players(4))
        matches = group.generate_round_robin()
        courts = [Court(name="C1"), Court(name="C2")]
        assign_courts(matches, courts)
        valid = {c.name for c in courts}
        for m in matches:
            assert m.court is not None
            assert m.court.name in valid

    def test_balances_court_load_globally(self):
        group = Group("A", _make_players(6))
        matches = group.generate_round_robin()
        courts = [Court(name="C1"), Court(name="C2"), Court(name="C3")]
        assign_courts(matches, courts)
        counts = {c.name: 0 for c in courts}
        for m in matches:
            assert m.court is not None
            counts[m.court.name] += 1
        # Greedy balanced assignment may differ by up to 2 when respecting
        # participant exposure fairness across courts.
        assert max(counts.values()) - min(counts.values()) <= 2

    def test_no_participant_plays_two_courts_simultaneously(self):
        """No player may appear in two matches with the same slot_number."""
        players = _make_players(8)
        group = Group("A", players)
        matches = group.generate_round_robin()
        courts = [Court(name="C1"), Court(name="C2"), Court(name="C3")]
        assign_courts(matches, courts)

        by_slot: defaultdict[int, list] = defaultdict(list)
        for m in matches:
            assert m.court is not None
            by_slot[m.slot_number].append(m)

        for slot_idx, slot_matches in by_slot.items():
            slot_participants: set[str] = set()
            for m in slot_matches:
                for p in m.team1 + m.team2:
                    assert p.id not in slot_participants, (
                        f"Player {p.name} plays two matches simultaneously in slot {slot_idx + 1}"
                    )
                    slot_participants.add(p.id)

    def test_no_conflict_across_multiple_groups(self):
        """Conflict constraint holds even when matches from multiple groups are mixed."""
        from backend.tournaments import distribute_players_to_groups

        players = _make_players(8)
        groups = distribute_players_to_groups(players, num_groups=2, shuffle=False)
        all_matches = [m for g in groups for m in g.generate_round_robin()]
        courts = [Court(name="C1"), Court(name="C2")]
        assign_courts(all_matches, courts)

        by_slot: defaultdict[int, list] = defaultdict(list)
        for m in all_matches:
            assert m.court is not None
            by_slot[m.slot_number].append(m)

        for slot_idx, slot_matches in by_slot.items():
            slot_participants: set[str] = set()
            for m in slot_matches:
                for p in m.team1 + m.team2:
                    assert p.id not in slot_participants, (
                        f"Player {p.name} plays two matches simultaneously in slot {slot_idx + 1}"
                    )
                    slot_participants.add(p.id)

    def test_slots_sorted_by_court_count_descending(self):
        """Slots with more courts come before slots with fewer courts."""
        # 7 players → 15 matches; 2 courts means some slots will have 1 match
        # and others 2, so the ordering is non-trivial.
        players = _make_players(7)
        group = Group("A", players)
        matches = group.generate_round_robin()
        courts = [Court(name="C1"), Court(name="C2")]
        assign_courts(matches, courts)

        by_slot: defaultdict[int, list] = defaultdict(list)
        for m in matches:
            by_slot[m.slot_number].append(m)

        counts_by_slot = [len(by_slot[s]) for s in sorted(by_slot)]
        # Counts must be non-increasing (denser slots first).
        assert counts_by_slot == sorted(counts_by_slot, reverse=True)

    def test_single_court_all_matches_on_court_1(self):
        """With exactly one court every match lands on it, one match per slot."""
        group = Group("A", _make_players(4))
        matches = group.generate_round_robin()
        court = Court(name="Court 1")
        assign_courts(matches, [court])

        assert all(m.court is not None for m in matches)
        assert all(m.court.name == "Court 1" for m in matches)
        # One match per slot — no two matches share the same slot.
        slots = [m.slot_number for m in matches]
        assert len(slots) == len(set(slots)), "Multiple matches share a slot with only 1 court"

    def test_two_courts_parallel_matches_in_same_slot(self):
        """With 2 courts and enough players, at least one slot has 2 parallel matches."""
        # 8 players, team round-robin in one group → many non-conflicting pairs available.
        group = Group("A", _make_players(8))
        matches = group.generate_round_robin()
        courts = [Court(name="Court 1"), Court(name="Court 2")]
        assign_courts(matches, courts)

        by_slot: defaultdict[int, list] = defaultdict(list)
        for m in matches:
            by_slot[m.slot_number].append(m)

        max_parallel = max(len(ms) for ms in by_slot.values())
        assert max_parallel == 2, f"Expected at least one slot with 2 parallel matches but max was {max_parallel}"

    def test_maximises_court_utilisation_across_groups(self):
        """With 2 groups on 2 courts, both courts should be used whenever possible.

        Regression: the old greedy algorithm could produce 3:6 court splits
        by consuming complementary pairs across groups, leaving orphaned
        matches that each occupied a slot alone.
        """
        courts = [Court(name="C1"), Court(name="C2")]
        # Run many trials to catch randomness-dependent failures.
        for _ in range(50):
            ga = Group("A", _make_players(3), team_mode=True)
            gb = Group("B", _make_players(4), team_mode=True)
            ga.generate_round_robin()
            gb.generate_round_robin()
            all_matches = ga.matches + gb.matches
            assert len(all_matches) == 9  # C(3,2) + C(4,2)
            assign_courts(all_matches, courts)

            counts = {c.name: 0 for c in courts}
            for m in all_matches:
                counts[m.court.name] += 1

            diff = abs(counts["C1"] - counts["C2"])
            assert diff <= 1, f"Court imbalance too high: {counts} (diff={diff})"

            # At least 4 of 5 slots should use both courts.
            by_slot: defaultdict[int, list] = defaultdict(list)
            for m in all_matches:
                by_slot[m.slot_number].append(m)
            full_slots = sum(1 for ms in by_slot.values() if len(ms) == 2)
            assert full_slots >= 4, f"Expected ≥4 full slots from 9 matches on 2 courts, got {full_slots}"


# ── Sets-format standings ─────────────────────────────────


class TestSetsFormatStandings:
    """Winner in SETS format must be determined by sets won (2 out of 3),
    not by total games.  ``points_for`` / ``points_against`` should still
    track actual game counts for tiebreaking."""

    def test_set_winner_with_fewer_total_games_gets_win(self):
        """Team 1 wins 2-1 in sets but has fewer total games.

        Sets: 1-6  7-5  7-5  → team1 wins 2 sets, total games 15 vs 16.
        Team1 players should be credited a *win*, not a loss.
        """
        players = _make_players(4)
        group = Group("A", players)
        matches = group.generate_round_robin()
        # Pick the first match and record sets where the set-winner
        # has fewer total games.
        m = matches[0]
        m.sets = [(1, 6), (7, 5), (7, 5)]
        m.score = (17, 16)  # adjusted by _tennis_sets_to_scores
        m.third_set_loss = True
        m.status = MatchStatus.COMPLETED

        standings = group.standings()
        t1_ids = {p.id for p in m.team1}
        t2_ids = {p.id for p in m.team2}

        for row in standings:
            if row.player.id in t1_ids:
                assert row.wins == 1, f"Team1 player {row.player.name} should have 1 win"
                assert row.losses == 0
                assert row.third_set_losses == 0
                # Actual game total, not adjusted score
                assert row.points_for == 15
                assert row.points_against == 16
            elif row.player.id in t2_ids:
                assert row.wins == 0, f"Team2 player {row.player.name} should have 0 wins"
                # Lost in 3rd set → third_set_losses
                assert row.third_set_losses == 1
                assert row.points_for == 16
                assert row.points_against == 15

    def test_set_winner_with_equal_total_games_gets_win(self):
        """Sets: 6-4  2-6  7-5 → both teams have 15 total games, team1 wins 2-1."""
        players = _make_players(4)
        group = Group("A", players)
        matches = group.generate_round_robin()
        m = matches[0]
        m.sets = [(6, 4), (2, 6), (7, 5)]
        m.score = (16, 15)  # adjusted
        m.third_set_loss = True
        m.status = MatchStatus.COMPLETED

        standings = group.standings()
        t1_ids = {p.id for p in m.team1}
        for row in standings:
            if row.player.id in t1_ids:
                assert row.wins == 1
                # Actual games: 15 each
                assert row.points_for == 15
                assert row.points_against == 15

    def test_simple_score_format_unaffected(self):
        """Non-sets matches should still determine winner by scored > conceded."""
        players = _make_players(4)
        group = Group("A", players)
        matches = group.generate_round_robin()
        m = matches[0]
        m.score = (6, 10)
        m.status = MatchStatus.COMPLETED

        standings = group.standings()
        t1_ids = {p.id for p in m.team1}
        for row in standings:
            if row.player.id in t1_ids:
                assert row.losses == 1
                assert row.points_for == 6
                assert row.points_against == 10
