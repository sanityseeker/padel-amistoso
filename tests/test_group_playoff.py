"""Tests for the GroupPlayoffTournament orchestrator."""

from __future__ import annotations

import pytest

from backend.models import Court, GPPhase, MatchStatus, Player
from backend.tournaments import GroupPlayoffTournament


def _make_players(n: int) -> list[Player]:
    return [Player(name=f"P{i + 1}") for i in range(n)]


def _make_courts(n: int) -> list[Court]:
    return [Court(name=f"C{i + 1}") for i in range(n)]


class TestGroupPlayoffCreation:
    def test_starts_in_setup(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2)
        assert t.phase == GPPhase.SETUP

    def test_generate_moves_to_groups(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2))
        t.generate()
        assert t.phase == GPPhase.GROUPS
        assert len(t.groups) == 2

    def test_group_matches_created(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2))
        t.generate()
        matches = t.all_group_matches()
        assert len(matches) > 0

    def test_team_mode_group_matches_use_single_entry_teams(self):
        teams = [Player(name=n) for n in ["A & B", "C & D", "E & F", "G & H"]]
        t = GroupPlayoffTournament(
            teams,
            num_groups=2,
            courts=_make_courts(2),
            top_per_group=1,
            team_mode=True,
        )
        t.generate()
        matches = t.all_group_matches()
        assert len(matches) > 0
        for m in matches:
            assert len(m.team1) == 1
            assert len(m.team2) == 1

    def test_group_courts_all_used_and_no_conflict(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(4))
        t.generate()
        assert len(t.groups) == 2

        # Complete all group rounds (round-by-round in individual mode).
        while t.has_more_group_rounds or t.pending_group_matches():
            for m in t.pending_group_matches():
                t.record_group_result(m.id, (6, 3))
            if t.has_more_group_rounds:
                t.generate_next_group_round()

        all_matches = t.all_group_matches()
        # Every match must have a court assigned.
        for m in all_matches:
            assert m.court is not None

        # No participant plays two matches in the same slot.
        from collections import defaultdict

        by_slot: dict[int, list] = defaultdict(list)
        for m in all_matches:
            by_slot[m.slot_number].append(m)
        for slot_idx, slot_matches in by_slot.items():
            seen: set[str] = set()
            for m in slot_matches:
                for p in m.team1 + m.team2:
                    assert p.id not in seen, f"Player {p.name} plays two matches in slot {slot_idx}"
                    seen.add(p.id)

        # With 8 players, 2 groups of 4, 3 rounds × 2 matches = 6 total matches
        assert len(all_matches) == 6
        # All 4 courts should be used at least once across all rounds.
        used_courts = {m.court.name for m in all_matches}
        assert used_courts == {"C1", "C2", "C3", "C4"}

    def test_odd_court_count_fills_all_courts(self):
        """In team mode (2 participants/match), 3 courts should all fill."""
        t = GroupPlayoffTournament(
            _make_players(8),
            num_groups=2,
            courts=_make_courts(3),
            team_mode=True,
        )
        t.generate()
        assert len(t.groups) == 2

        all_matches = t.all_group_matches()
        for m in all_matches:
            assert m.court is not None

        # No participant plays two matches in the same slot.
        from collections import defaultdict

        by_slot: dict[int, list] = defaultdict(list)
        for m in all_matches:
            by_slot[m.slot_number].append(m)

        # With 8 teams (2 groups of 4, team_mode) and 3 courts, some slots
        # should fill all 3 courts simultaneously (each match is only 2
        # participants, so 3 non-conflicting matches easily fit).
        max_courts_in_slot = max(len(ms) for ms in by_slot.values())
        assert max_courts_in_slot == 3, (
            f"Expected at least one slot filling all 3 courts, but max was {max_courts_in_slot}"
        )

        for slot_idx, slot_matches in by_slot.items():
            seen: set[str] = set()
            for m in slot_matches:
                for p in m.team1 + m.team2:
                    assert p.id not in seen, f"Player {p.name} plays two matches in slot {slot_idx}"
                    seen.add(p.id)


class TestGroupPhase:
    def _make_tournament(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2), top_per_group=2)
        t.generate()
        return t

    @staticmethod
    def _complete_all_group_rounds(t):
        """Complete all group rounds recording dummy scores."""
        while True:
            for m in t.pending_group_matches():
                t.record_group_result(m.id, (6, 3))
            if not t.has_more_group_rounds:
                break
            t.generate_next_group_round()

    def test_record_group_result(self):
        t = self._make_tournament()
        m = t.all_group_matches()[0]
        t.record_group_result(m.id, (6, 3))
        assert m.status == MatchStatus.COMPLETED
        assert m.score == (6, 3)

    def test_record_unknown_match_raises(self):
        t = self._make_tournament()
        with pytest.raises(KeyError):
            t.record_group_result("fake-id", (6, 3))

    def test_group_standings_structure(self):
        t = self._make_tournament()
        # Complete one match
        m = t.all_group_matches()[0]
        t.record_group_result(m.id, (6, 3))

        standings = t.group_standings()
        assert len(standings) == 2  # 2 groups
        for group_name, rows in standings.items():
            assert len(rows) > 0
            for row in rows:
                assert "player" in row
                assert "match_points" in row
                assert "point_diff" in row

    def test_cannot_start_playoffs_with_pending(self):
        t = self._make_tournament()
        # Don't complete any matches
        with pytest.raises(RuntimeError, match="completed"):
            t.start_playoffs()


class TestPlayoffPhase:
    def _advance_to_playoffs(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2), top_per_group=2)
        t.generate()
        # Complete all group rounds
        TestGroupPhase._complete_all_group_rounds(t)
        t.start_playoffs()
        return t

    def test_start_playoffs_changes_phase(self):
        t = self._advance_to_playoffs()
        assert t.phase == GPPhase.PLAYOFFS

    def test_playoff_matches_created(self):
        t = self._advance_to_playoffs()
        matches = t.playoff_matches()
        assert len(matches) > 0

    def test_record_playoff_result(self):
        t = self._advance_to_playoffs()
        pending = t.pending_playoff_matches()
        if pending:
            m = pending[0]
            t.record_playoff_result(m.id, (6, 2))
            assert m.status == MatchStatus.COMPLETED

    def test_cannot_start_playoffs_twice(self):
        t = self._advance_to_playoffs()
        with pytest.raises(RuntimeError):
            t.start_playoffs()

    def test_single_court_all_playoff_matches_on_court_1(self):
        """With 1 court, every playoff match is assigned to it, one per slot."""
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=[Court(name="Court 1")], top_per_group=2)
        t.generate()
        TestGroupPhase._complete_all_group_rounds(t)
        t.start_playoffs()

        # Drain all pending playoff matches.
        while True:
            pending = t.pending_playoff_matches()
            if not pending:
                break
            for m in pending:
                t.record_playoff_result(m.id, (6, 2))

        all_playoff = t.playoff_matches()
        assert all(m.court is not None for m in all_playoff)
        assert all(m.court.name == "Court 1" for m in all_playoff)

        # No two matches share the same slot (sequential scheduling).
        slots = [m.slot_number for m in all_playoff if m.slot_number is not None]
        assert len(slots) == len(set(slots)), "Multiple playoff matches share a slot with only 1 court"

    def test_two_courts_parallel_playoff_matches(self):
        """With 2 courts and a double-elimination bracket of 4+ teams, at least one round runs in parallel."""
        from collections import defaultdict

        # team_mode=True with 8 entries (2 groups of 4), top 2 per group
        # → 4 teams reach the playoffs, enabling parallel W-semis on both courts.
        teams = [Player(name=f"T{i + 1}") for i in range(8)]
        t = GroupPlayoffTournament(
            teams,
            num_groups=2,
            courts=_make_courts(2),
            top_per_group=2,
            double_elimination=True,
            team_mode=True,
        )
        t.generate()
        TestGroupPhase._complete_all_group_rounds(t)
        t.start_playoffs()

        # Drain all pending playoff matches, collecting every assigned match.
        while True:
            pending = t.pending_playoff_matches()
            if not pending:
                break
            for m in pending:
                t.record_playoff_result(m.id, (6, 2))

        all_playoff = t.playoff_matches()
        assert all(m.court is not None for m in all_playoff)

        by_slot: dict[int, list] = defaultdict(list)
        for m in all_playoff:
            if m.slot_number is not None:
                by_slot[m.slot_number].append(m)

        # With 4 teams in double-elimination, the two W-semifinal matches are
        # ready at the same time and must be scheduled on the 2 courts in parallel.
        max_parallel = max(len(ms) for ms in by_slot.values())
        assert max_parallel == 2, (
            f"Expected at least one slot with 2 parallel playoff matches but max was {max_parallel}"
        )

        # No player appears twice in the same slot.
        for slot_idx, slot_matches in by_slot.items():
            seen: set[str] = set()
            for m in slot_matches:
                for p in m.team1 + m.team2:
                    assert p.id not in seen, f"Player {p.name} plays two playoff matches in slot {slot_idx}"
                    seen.add(p.id)


class TestTennisThirdSetConsolation:
    """Group stage standings give the 3rd-set loser 1 consolation match point."""

    def _make_simple_tournament(self):
        t = GroupPlayoffTournament(_make_players(4), num_groups=1, top_per_group=2)
        t.generate()
        return t

    def test_third_set_loss_flag_set_on_match(self):
        t = self._make_simple_tournament()
        m = t.all_group_matches()[0]
        # 6-4 2-6 7-5 → games 15-15, team1 wins 2 sets
        t.record_group_result(m.id, (16, 15), sets=[(6, 4), (2, 6), (7, 5)], third_set_loss=True)
        assert m.third_set_loss is True

    def test_winner_gets_win_loser_gets_consolation_point(self):
        t = self._make_simple_tournament()
        m = t.all_group_matches()[0]
        t.record_group_result(m.id, (16, 15), sets=[(6, 4), (2, 6), (7, 5)], third_set_loss=True)

        standings = t.group_standings()
        rows = standings["A"]
        winner_row = next(r for r in rows if r["player"] in [p.name for p in m.team1])
        loser_row = next(r for r in rows if r["player"] in [p.name for p in m.team2])

        assert winner_row["wins"] == 1
        assert winner_row["match_points"] == 3
        assert loser_row["third_set_losses"] == 1
        assert loser_row["draws"] == 0
        assert loser_row["losses"] == 0
        assert loser_row["match_points"] == 1

    def test_normal_loss_gives_zero_points(self):
        t = self._make_simple_tournament()
        m = t.all_group_matches()[0]
        # Regular 2-set match, no consolation
        t.record_group_result(m.id, (12, 7), sets=[(6, 4), (6, 3)], third_set_loss=False)

        standings = t.group_standings()
        rows = standings["A"]
        loser_row = next(r for r in rows if r["player"] in [p.name for p in m.team2])

        assert loser_row["losses"] == 1
        assert loser_row["draws"] == 0
        assert loser_row["match_points"] == 0


class TestDoubleElimination:
    def test_double_elim_creates_bracket(self):
        t = GroupPlayoffTournament(
            _make_players(8),
            num_groups=2,
            courts=_make_courts(2),
            top_per_group=2,
            double_elimination=True,
        )
        t.generate()
        TestGroupPhase._complete_all_group_rounds(t)
        t.start_playoffs()
        assert t.phase == GPPhase.PLAYOFFS
        assert t.playoff_bracket is not None


class TestRoundByRound:
    """Tests for the new round-by-round group generation (individual mode)."""

    def test_generate_creates_first_round_only(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2))
        t.generate()
        # Each group of 4 → 1 match in first round.
        assert len(t.all_group_matches()) == 2
        assert t.has_more_group_rounds

    def test_full_round_by_round_flow(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2), top_per_group=2)
        t.generate()

        rounds_played = 1
        while t.has_more_group_rounds or t.pending_group_matches():
            for m in t.pending_group_matches():
                t.record_group_result(m.id, (6, 3))
            if t.has_more_group_rounds:
                t.generate_next_group_round()
                rounds_played += 1

        # 4 players per group → 3 rounds, 1 match/round/group.
        assert rounds_played == 3
        assert len(t.all_group_matches()) == 6
        assert not t.has_more_group_rounds

    def test_generate_next_round_requires_completed_matches(self):
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2))
        t.generate()
        with pytest.raises(RuntimeError, match="Complete current"):
            t.generate_next_group_round()

    def test_team_mode_has_no_more_group_rounds(self):
        teams = [Player(name=n) for n in ["A & B", "C & D", "E & F", "G & H"]]
        t = GroupPlayoffTournament(teams, num_groups=2, team_mode=True)
        t.generate()
        assert not t.has_more_group_rounds

    def test_standings_update_between_rounds(self):
        t = GroupPlayoffTournament(_make_players(4), num_groups=1, top_per_group=2)
        t.generate()
        # Round 1
        m = t.all_group_matches()[0]
        t.record_group_result(m.id, (10, 2))
        standings_r1 = t.group_standings()["A"]
        scored = {r["player"]: r["points_for"] for r in standings_r1}
        assert max(scored.values()) == 10

        # Round 2
        t.generate_next_group_round()
        m2 = [m for m in t.pending_group_matches()][0]
        t.record_group_result(m2.id, (7, 5))

        standings_r2 = t.group_standings()["A"]
        scored_r2 = {r["player"]: r["points_for"] for r in standings_r2}
        # Total points should have increased.
        assert sum(scored_r2.values()) > sum(scored.values())

    def test_groups_endpoint_includes_has_more_rounds(self):
        """The group standings dict should include has_more_rounds info."""
        t = GroupPlayoffTournament(_make_players(8), num_groups=2)
        t.generate()
        # has_more_group_rounds is exposed at tournament level
        assert t.has_more_group_rounds is True

    def test_can_start_playoffs_after_partial_rounds(self):
        """User can start playoffs before exhausting all group rounds."""
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2), top_per_group=2)
        t.generate()
        # Only complete first round.
        for m in t.pending_group_matches():
            t.record_group_result(m.id, (6, 3))
        # Should be able to start playoffs even with more rounds available.
        t.start_playoffs()
        assert t.phase == GPPhase.PLAYOFFS


class TestManualPlayoffParticipants:
    """Tests for manually selecting playoff participants and adding external players."""

    def _ready_tournament(self):
        """Create a GP tournament with all group matches completed."""
        t = GroupPlayoffTournament(_make_players(8), num_groups=2, courts=_make_courts(2), top_per_group=2)
        t.generate()
        for m in t.all_group_matches():
            t.record_group_result(m.id, (6, 3))
        return t

    def test_recommend_playoff_participants_returns_all_players(self):
        t = self._ready_tournament()
        rec = t.recommend_playoff_participants()
        assert len(rec) == 8
        for entry in rec:
            assert "player_id" in entry
            assert "group" in entry
            assert "match_points" in entry

    def test_recommend_playoff_participants_sorted_by_standings(self):
        t = self._ready_tournament()
        rec = t.recommend_playoff_participants()
        keys = [(r["match_points"], r["point_diff"], r["points_for"]) for r in rec]
        sorted_keys = sorted(keys, key=lambda k: (-k[0], -k[1], -k[2]))
        assert keys == sorted_keys

    def test_start_playoffs_with_manual_selection(self):
        t = self._ready_tournament()
        # Pick 4 players (must be even for team formation)
        all_ids = [p.id for p in t.players]
        chosen = all_ids[:4]
        t.start_playoffs(advancing_player_ids=chosen)
        assert t.phase == GPPhase.PLAYOFFS
        bracket_teams = t.playoff_bracket.original_teams
        # 4 players → 2 teams of 2
        assert len(bracket_teams) == 2
        bracket_ids = {p.id for team in bracket_teams for p in team}
        assert bracket_ids == set(chosen)

    def test_start_playoffs_with_extra_players(self):
        t = self._ready_tournament()
        t.start_playoffs(extra_players=[("External1", 10), ("External2", 5)])
        assert t.phase == GPPhase.PLAYOFFS
        bracket_teams = t.playoff_bracket.original_teams
        # 4 auto-advancing (top 2 per group) + 2 external = 6 → 3 teams of 2
        assert len(bracket_teams) == 3
        names = {p.name for team in bracket_teams for p in team}
        assert "External1" in names
        assert "External2" in names

    def test_start_playoffs_manual_selection_plus_extra(self):
        t = self._ready_tournament()
        chosen = [t.players[0].id, t.players[1].id]
        t.start_playoffs(
            advancing_player_ids=chosen,
            extra_players=[("Guest1", 0), ("Guest2", 0)],
        )
        assert t.phase == GPPhase.PLAYOFFS
        bracket_teams = t.playoff_bracket.original_teams
        # 2 chosen + 2 extra = 4 → 2 teams of 2
        assert len(bracket_teams) == 2
        names = {p.name for team in bracket_teams for p in team}
        assert "Guest1" in names
        assert t.players[0].name in names
        assert t.players[1].name in names

    def test_start_playoffs_duplicate_ids_rejected(self):
        t = self._ready_tournament()
        dup = [t.players[0].id, t.players[0].id]
        with pytest.raises(RuntimeError, match="unique"):
            t.start_playoffs(advancing_player_ids=dup)

    def test_start_playoffs_unknown_id_rejected(self):
        t = self._ready_tournament()
        with pytest.raises(KeyError, match="not found"):
            t.start_playoffs(advancing_player_ids=["nonexistent"])

    def test_start_playoffs_override_double_elimination(self):
        t = self._ready_tournament()
        assert t.double_elimination is False
        t.start_playoffs(double_elimination=True)
        assert t.double_elimination is True
        assert t.phase == GPPhase.PLAYOFFS

    def test_start_playoffs_only_extra_players(self):
        t = self._ready_tournament()
        t.start_playoffs(
            advancing_player_ids=[],
            extra_players=[("Guest1", 0), ("Guest2", 0), ("Guest3", 0), ("Guest4", 0)],
        )
        assert t.phase == GPPhase.PLAYOFFS
        bracket_teams = t.playoff_bracket.original_teams
        # 4 external → 2 teams of 2
        assert len(bracket_teams) == 2
        names = {p.name for team in bracket_teams for p in team}
        assert names == {"Guest1", "Guest2", "Guest3", "Guest4"}

    def test_start_playoffs_too_few_participants(self):
        t = self._ready_tournament()
        with pytest.raises(RuntimeError):
            t.start_playoffs(advancing_player_ids=[], extra_players=[("Solo", 0)])

    def test_start_playoffs_odd_number_rejected(self):
        """Odd number of individual players cannot form 2-player teams."""
        t = self._ready_tournament()
        chosen = [p.id for p in t.players[:3]]
        with pytest.raises(RuntimeError, match="even number"):
            t.start_playoffs(advancing_player_ids=chosen)

    def test_start_playoffs_teams_are_balanced(self):
        """Teams should pair high-scorer with low-scorer (fold method)."""
        t = self._ready_tournament()
        t.start_playoffs()  # auto top 2 per group = 4 players
        bracket_teams = t.playoff_bracket.original_teams
        assert len(bracket_teams) == 2
        for team in bracket_teams:
            assert len(team) == 2
