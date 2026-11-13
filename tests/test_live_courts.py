"""Live court queue: free courts are refilled as matches finish (tournaments/live_courts.py)."""

from __future__ import annotations

import random

import pytest

from backend.models import Court, Match, MatchStatus, Player
from backend.tournaments.group_playoff import GroupPlayoffTournament
from backend.tournaments.live_courts import court_done, is_on_court
from backend.tournaments.playoff_tournament import PlayoffTournament


def _courts(n: int) -> list[Court]:
    return [Court(name=f"C{i + 1}") for i in range(n)]


def _ids(m: Match) -> set[str]:
    return {p.id for p in m.team1 + m.team2}


def _gp(teams_per_group: list[int], n_courts: int) -> GroupPlayoffTournament:
    teams = [Player(name=f"T{i}") for i in range(sum(teams_per_group))]
    groups, k = {}, 0
    for g, size in enumerate(teams_per_group):
        groups["AB"[g] if g < 2 else str(g)] = [t.name for t in teams[k : k + size]]
        k += size
    t = GroupPlayoffTournament(teams, num_groups=len(teams_per_group), courts=_courts(n_courts), team_mode=True)
    t.group_assignments = groups
    t.generate()
    return t


def _check_invariants(matches: list[Match], courts: list[Court]) -> None:
    on = [m for m in matches if is_on_court(m)]
    assert len({m.court.id for m in on}) == len(on), "two matches on one court"
    busy: set[str] = set()
    for m in on:
        assert not (_ids(m) & busy), "a player is on two courts"
        busy |= _ids(m)
    if len(on) < len(courts):
        waiting = [m for m in matches if m.team1 and m.team2 and not court_done(m) and not is_on_court(m)]
        assert all(_ids(m) & busy for m in waiting), "a court is idle while a match could be played"


def _play_out(t, matches, record, courts, rng) -> dict[str, float]:
    """Event-driven run: each match takes 0.7-1.3 time units. Returns finish time per match id."""
    start: dict[str, float] = {}
    finish: dict[str, float] = {}
    now = 0.0
    while True:
        ms = matches()
        _check_invariants(ms, courts)
        on = [m for m in ms if is_on_court(m)]
        for m in on:
            start.setdefault(m.id, now)
        if not on:
            break
        ends = {m.id: start[m.id] + 0.7 + 0.6 * ((hash(m.id) % 1000) / 1000) for m in on}
        first = min(on, key=lambda m: ends[m.id])
        now = ends[first.id]
        before = {m.id: m.court.id for m in on if m is not first}
        record(first)
        finish[first.id] = now
        # Matches being played never move.
        after = {m.id: m.court.id for m in matches() if is_on_court(m)}
        for mid, cid in before.items():
            assert after.get(mid) == cid, "a match on court was moved"
    assert all(court_done(m) for m in matches() if m.team1 and m.team2)
    return finish


class TestGroupStage:
    @pytest.mark.parametrize("sizes,n_courts", [([5, 4], 6), ([6, 5], 6), ([5, 5], 3), ([7, 4], 4), ([4, 4], 2)])
    def test_courts_never_idle_and_matches_never_move(self, sizes, n_courts):
        random.seed(7)
        t = _gp(sizes, n_courts)
        _play_out(
            t,
            t.all_group_matches,
            lambda m: t.record_group_result(m.id, (6, 3)),
            t.courts,
            random.Random(1),
        )

    def test_freed_court_takes_a_waiting_match_at_once(self):
        t = _gp([5, 4], 6)
        on = [m for m in t.all_group_matches() if is_on_court(m)]
        first = on[0]
        t.record_group_result(first.id, (6, 2))
        on_after = [m for m in t.all_group_matches() if is_on_court(m)]
        assert len(on_after) >= len(on) - 1
        _check_invariants(t.all_group_matches(), t.courts)

    def test_groups_finish_together(self):
        # 7 teams (21 matches, 3 at once) vs 4 teams (6 matches, 2 at once) on 4 courts.
        t = _gp([7, 4], 4)
        finish = _play_out(t, t.all_group_matches, lambda m: t.record_group_result(m.id, (6, 3)), t.courts, None)
        last = {g.name: max(finish[m.id] for m in g.matches) for g in t.groups}
        end = max(last.values())
        # The small group is not done long before the big one: it keeps finishing in the last stretch.
        assert last["B"] > 0.6 * end

    def test_rest_is_spread_when_there_are_more_teams_than_courts(self):
        # 6 teams, 1 court: a team never plays twice in a row while its round has a match without it.
        t = _gp([6], 1)
        prev: set[str] = set()
        while True:
            on = [m for m in t.all_group_matches() if is_on_court(m)]
            if not on:
                break
            m = on[0]
            pending = [x for x in t.all_group_matches() if not court_done(x)]
            low = min(x.round_number for x in pending)
            if _ids(m) & prev and m.round_number == low:
                assert all(_ids(x) & prev for x in pending if x.round_number == low)
            prev = _ids(m)
            t.record_group_result(m.id, (6, 3))

    def test_score_awaiting_confirmation_frees_the_court(self):
        t = _gp([4, 4], 2)
        m = next(m for m in t.all_group_matches() if is_on_court(m))
        court = m.court.id
        t.record_group_result(m.id, (6, 3))
        m.status = MatchStatus.IN_PROGRESS  # the route keeps it unconfirmed
        t.refill_group_courts()
        assert not is_on_court(m)
        assert any(is_on_court(x) and x.court.id == court for x in t.all_group_matches())

    def test_cleared_result_does_not_displace_a_match_on_court(self):
        t = _gp([5, 4], 6)
        done = next(m for m in t.all_group_matches() if is_on_court(m))
        t.record_group_result(done.id, (6, 3))
        on = {m.id: m.court.id for m in t.all_group_matches() if is_on_court(m)}
        t.clear_group_result(done.id)
        after = {m.id: m.court.id for m in t.all_group_matches() if is_on_court(m)}
        for mid, cid in on.items():
            assert after[mid] == cid
        _check_invariants(t.all_group_matches(), t.courts)

    def test_court_edit_mid_event_keeps_matches_on_their_court(self):
        t = _gp([5, 4], 6)
        m = next(m for m in t.all_group_matches() if is_on_court(m))
        t.record_group_result(m.id, (6, 3))
        on = {m.id: m.court.name for m in t.all_group_matches() if is_on_court(m)}
        t.update_courts([Court(name=c.name) for c in t.courts] + [Court(name="C7")])
        after = {m.id: m.court.name for m in t.all_group_matches() if is_on_court(m)}
        for mid, name in on.items():
            assert after[mid] == name
        _check_invariants(t.all_group_matches(), t.courts)


class TestPlayoffs:
    def test_group_playoff_bracket_uses_the_free_court(self):
        t = _gp([4, 4, 4, 4], 4)
        for m in t.all_group_matches():
            t.record_group_result(m.id, (6, 2))
        t.start_playoffs()
        _play_out(
            t,
            t.playoff_matches,
            lambda m: t.record_playoff_result(m.id, (6, 2)),
            t.courts,
            None,
        )

    def test_direct_playoffs_keep_courts_busy(self):
        teams = [[Player(name=f"T{i}")] for i in range(16)]
        t = PlayoffTournament(teams, courts=_courts(3))
        _play_out(t, t.all_matches, lambda m: t.record_result(m.id, (6, 2)), t.courts, None)

    def test_direct_playoffs_score_awaiting_confirmation_frees_the_court(self):
        teams = [[Player(name=f"T{i}")] for i in range(8)]
        t = PlayoffTournament(teams, courts=_courts(2))
        m = next(m for m in t.all_matches() if is_on_court(m))
        court = m.court.id
        m.score = (6, 2)
        m.status = MatchStatus.IN_PROGRESS
        t._assign_courts_greedily()
        assert any(is_on_court(x) and x.court.id == court for x in t.all_matches())


def _timed_run(sizes: list[int], n_courts: int, seed: int) -> dict[str, float]:
    """Event-driven run with seeded match lengths (0.7-1.3); returns each group's finish time."""
    random.seed(seed)
    rng = random.Random(seed)
    t = _gp(sizes, n_courts)
    start: dict[str, float] = {}
    length: dict[str, float] = {}
    finish: dict[str, float] = {}
    now = 0.0
    while True:
        ms = t.all_group_matches()
        _check_invariants(ms, t.courts)
        on = [m for m in ms if is_on_court(m)]
        if not on:
            break
        for m in on:
            start.setdefault(m.id, now)
            length.setdefault(m.id, rng.uniform(0.7, 1.3))
        first = min(on, key=lambda m: start[m.id] + length[m.id])
        now = start[first.id] + length[first.id]
        finish[first.id] = now
        t.record_group_result(first.id, (6, 3))
    return {g.name: max(finish[m.id] for m in g.matches) for g in t.groups}


def test_seven_and_six_teams_on_six_courts_finish_together():
    # 21 and 15 matches, at most 3 at once each: the 7-team group can't finish before ~7 match lengths.
    runs = [_timed_run([7, 6], 6, seed) for seed in range(20)]
    gap = sum(r["A"] - r["B"] for r in runs) / len(runs)
    end = sum(r["A"] for r in runs) / len(runs)
    assert gap < 1.5, f"groups finish {gap:.2f} match lengths apart"
    assert end < 8.5, f"group stage takes {end:.2f} match lengths"
