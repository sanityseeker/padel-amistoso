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

    def test_group_courts_all_used_and_no_conflict(self):
        t = GroupPlayoffTournament(
            _make_players(8), num_groups=2, courts=_make_courts(4)
        )
        t.generate()
        assert len(t.groups) == 2

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
                    assert p.id not in seen, (
                        f"Player {p.name} plays two matches in slot {slot_idx}"
                    )
                    seen.add(p.id)

        # All 4 courts should be used at least once.
        used_courts = {m.court.name for m in all_matches}
        assert used_courts == {"C1", "C2", "C3", "C4"}

    def test_odd_court_count_fills_all_courts(self):
        """In team mode (2 participants/match), 3 courts should all fill."""
        t = GroupPlayoffTournament(
            _make_players(8), num_groups=2, courts=_make_courts(3),
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
            f"Expected at least one slot filling all 3 courts, "
            f"but max was {max_courts_in_slot}"
        )

        for slot_idx, slot_matches in by_slot.items():
            seen: set[str] = set()
            for m in slot_matches:
                for p in m.team1 + m.team2:
                    assert p.id not in seen, (
                        f"Player {p.name} plays two matches in slot {slot_idx}"
                    )
                    seen.add(p.id)


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


class TestTennisThirdSetConsolation:
    """Group stage standings give the 3rd-set loser 1 consolation match point."""

    def _make_simple_tournament(self):
        t = GroupPlayoffTournament(
            _make_players(4), num_groups=1, top_per_group=2
        )
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
        for m in t.all_group_matches():
            t.record_group_result(m.id, (6, 3))
        t.start_playoffs()
        assert t.phase == GPPhase.PLAYOFFS
        assert t.playoff_bracket is not None
