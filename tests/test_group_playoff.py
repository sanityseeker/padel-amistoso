"""Tests for the GroupPlayoffTournament orchestrator."""

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
        t = GroupPlayoffTournament(
            _make_players(8), num_groups=2, courts=_make_courts(2)
        )
        t.generate()
        assert t.phase == GPPhase.GROUPS
        assert len(t.groups) == 2

    def test_group_matches_created(self):
        t = GroupPlayoffTournament(
            _make_players(8), num_groups=2, courts=_make_courts(2)
        )
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

    def test_group_courts_partitioned_by_group(self):
        t = GroupPlayoffTournament(
            _make_players(8), num_groups=2, courts=_make_courts(4)
        )
        t.generate()
        assert len(t.groups) == 2

        # With 4 courts and 2 groups => 2 courts per group
        group_a_courts = {"C1", "C2"}
        group_b_courts = {"C3", "C4"}

        for m in t.groups[0].matches:
            assert m.court is not None
            assert m.court.name in group_a_courts

        for m in t.groups[1].matches:
            assert m.court is not None
            assert m.court.name in group_b_courts

    def test_odd_shared_court_available_for_both_groups_not_same_slot(self):
        t = GroupPlayoffTournament(
            _make_players(8), num_groups=2, courts=_make_courts(3)
        )
        t.generate()
        assert len(t.groups) == 2

        a_allowed = {"C1", "C3"}
        b_allowed = {"C2", "C3"}

        for m in t.groups[0].matches:
            assert m.court is not None
            assert m.court.name in a_allowed

        for m in t.groups[1].matches:
            assert m.court is not None
            assert m.court.name in b_allowed

        max_slots = max(len(t.groups[0].matches), len(t.groups[1].matches))
        for i in range(max_slots):
            c1 = (
                t.groups[0].matches[i].court.name
                if i < len(t.groups[0].matches) and t.groups[0].matches[i].court
                else None
            )
            c2 = (
                t.groups[1].matches[i].court.name
                if i < len(t.groups[1].matches) and t.groups[1].matches[i].court
                else None
            )
            assert not (c1 == "C3" and c2 == "C3")


class TestGroupPhase:
    def _make_tournament(self):
        t = GroupPlayoffTournament(
            _make_players(8), num_groups=2, courts=_make_courts(2), top_per_group=2
        )
        t.generate()
        return t

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
        t = GroupPlayoffTournament(
            _make_players(8), num_groups=2, courts=_make_courts(2), top_per_group=2
        )
        t.generate()
        # Complete all group matches
        for m in t.all_group_matches():
            t.record_group_result(m.id, (6, 3))
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
        for m in t.all_group_matches():
            t.record_group_result(m.id, (6, 3))
        t.start_playoffs()
        assert t.phase == GPPhase.PLAYOFFS
        assert t.playoff_bracket is not None
