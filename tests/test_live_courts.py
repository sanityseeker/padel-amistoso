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
        # A match held back by an earlier open round of its team is not eligible (team-mode round order).
        assert all(_ids(m) & busy or _lower_open(m, matches) for m in waiting), (
            "a court is idle while a match could be played"
        )


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

    def test_match_held_by_a_busy_player_says_so(self):
        # 2 groups of 4 teams on 4 courts: once one round-1 match ends, the next
        # matches of its teams wait for teams still on court, not for a court.
        t = _gp([4, 4], 4)
        group_a = t.groups[0].matches
        first = next(m for m in group_a if is_on_court(m))
        t.record_group_result(first.id, (6, 2))
        on = [m for m in t.all_group_matches() if is_on_court(m)]
        assert len(on) < len(t.courts)  # a court is free
        playing = set().union(*(_ids(m) for m in on))
        waiting = [m for m in group_a if m.status == MatchStatus.SCHEDULED and not is_on_court(m)]
        assert waiting
        for m in waiting:
            assert m.waiting_for_players == bool(_ids(m) & playing)
        assert any(m.waiting_for_players for m in waiting)
        assert not any(m.waiting_for_players for m in on)
        assert not first.waiting_for_players

    def test_groups_finish_together(self):
        # 7 teams (21 matches, 3 at once) vs 4 teams (6 matches, 2 at once) on 4 courts, averaged over
        # seeded match lengths (a single run with random lengths is too noisy).
        runs = [_timed_run([7, 4], 4, seed) for seed in range(20)]
        big = sum(r["A"] for r in runs) / len(runs)
        small = sum(r["B"] for r in runs) / len(runs)
        # The small group is not done long before the big one: it keeps finishing in the last stretch.
        assert small > 0.6 * big

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
    # Round order is strict: the 6-team group plays 5 rounds at full speed (about 5.5 match lengths) and the
    # 7-team group needs 7 rounds (about 7.6), so they are at best ~2 apart.  Slowing the small group down
    # to close the gap would only waste court time.
    assert gap < 2.5, f"groups finish {gap:.2f} match lengths apart"
    assert end < 8.5, f"group stage takes {end:.2f} match lengths"


# --- Round order: every team's matches go on court in round order (team mode) ---


def _lower_open(m: Match, ms: list[Match]) -> list[Match]:
    """Lower-round matches of either team of *m* that are neither played nor on court."""
    return [
        o
        for o in ms
        if o is not m
        and 0 < o.round_number < m.round_number
        and o.team1
        and o.team2
        and _ids(o) & _ids(m)
        and not court_done(o)
        and not is_on_court(o)
    ]


def _check_round_order(ms: list[Match], n_courts: int) -> None:
    on = [m for m in ms if is_on_court(m)]
    for m in on:
        assert not _lower_open(m, ms), f"{m.round_label} started before an earlier round of its team"
    busy: set[str] = set().union(*(_ids(m) for m in on)) if on else set()
    if len(on) < n_courts:
        # No court idles while an eligible match fits: every waiting match is held by a busy
        # player or by an earlier round of its team that is itself held back.
        for m in ms:
            if m.team1 and m.team2 and not court_done(m) and not is_on_court(m):
                assert _ids(m) & busy or _lower_open(m, ms), "a court is idle while an eligible match fits"


def _random_run(t: GroupPlayoffTournament, seed: int, *, on_step=None) -> int:
    """Finish a random match on court each step; checks order and idle courts. Returns steps."""
    rng = random.Random(seed)
    steps = 0
    while True:
        ms = t.all_group_matches()
        _check_round_order(ms, len(t.courts))
        on = [m for m in ms if is_on_court(m)]
        if not on:
            break
        if on_step is not None:
            on_step(steps)
        m = rng.choice(on)
        t.record_group_result(m.id, (6, 3))
        steps += 1
    assert all(court_done(m) for m in t.all_group_matches() if m.team1 and m.team2)
    return steps


class TestRoundOrder:
    @pytest.mark.parametrize(
        "sizes,n_courts", [([5, 7], 4), ([6, 6], 6), ([8], 4), ([5], 2), ([7], 3), ([5, 7], 6), ([3, 6], 2)]
    )
    @pytest.mark.parametrize("seed", range(8))
    def test_rounds_go_on_court_in_order(self, sizes, n_courts, seed):
        t = _gp(sizes, n_courts)
        _random_run(t, seed)

    def test_early_finish_pulls_next_eligible_match_never_a_busy_team(self):
        t = _gp([6, 6], 6)
        for _ in range(10):
            on = [m for m in t.all_group_matches() if is_on_court(m)]
            first = on[0]
            t.record_group_result(first.id, (6, 1))
            ms = t.all_group_matches()
            on_after = [m for m in ms if is_on_court(m)]
            seen: set[str] = set()
            for m in on_after:
                assert not (_ids(m) & seen), "a busy team was put on a second court"
                seen |= _ids(m)
            _check_round_order(ms, len(t.courts))
            if not on_after:
                break

    def test_queue_slots_respect_round_order(self):
        t = _gp([7], 3)
        ms = [m for m in t.all_group_matches() if not court_done(m)]
        for m in ms:
            for o in ms:
                if o is not m and 0 < o.round_number < m.round_number and _ids(o) & _ids(m):
                    assert o.slot_number <= m.slot_number, "a later round was planned before an earlier one"

    def test_withdrawal_mid_stage_does_not_block_later_rounds(self):
        t = _gp([6, 6], 4)
        first = next(m for m in t.all_group_matches() if is_on_court(m))
        t.record_group_result(first.id, (6, 2))
        victim = next(m for m in t.all_group_matches() if not court_done(m) and not is_on_court(m)).team1[0]
        t.withdraw(victim.id)
        _random_run(t, 3)

    def test_late_added_stubs_get_rounds_and_are_scheduled(self):
        t = _gp([4, 4], 3)
        group = t.groups[0]
        last = max(m.round_number for m in group.matches)
        stubs = t.add_player_to_group(Player(name="Late"), group.name)
        assert [m.round_number for m in stubs] == list(range(last + 1, last + 1 + len(stubs)))
        assert all(m.round_label == f"Group {group.name} R{m.round_number}" for m in stubs)
        _random_run(t, 5)
        assert all(court_done(m) for m in stubs)

    def test_late_added_team_after_some_results(self):
        t = _gp([5], 2)
        for _ in range(3):
            m = next(m for m in t.all_group_matches() if is_on_court(m))
            t.record_group_result(m.id, (6, 4))
        t.add_player_to_group(Player(name="Late"), "A")
        _random_run(t, 11)

    def test_save_load_round_trip_keeps_the_plan(self):
        import pickle

        t = _gp([5, 7], 4)
        for _ in range(4):
            m = next(m for m in t.all_group_matches() if is_on_court(m))
            t.record_group_result(m.id, (6, 4))

        def plan(x: GroupPlayoffTournament) -> list[tuple[str, int, str | None, bool]]:
            return [
                (m.id, m.slot_number, m.court.name if m.court else None, bool(m.on_court))
                for m in x.all_group_matches()
            ]

        before = plan(t)
        loaded = pickle.loads(pickle.dumps(t))
        assert plan(loaded) == before
        loaded.refill_group_courts()
        assert plan(loaded) == before
        _random_run(loaded, 2)

    def test_old_plan_is_replanned_in_order_and_on_court_matches_stay(self):
        t = _gp([6, 6], 6)
        on = {m.id: m.court.id for m in t.all_group_matches() if is_on_court(m)}
        # Simulate an old out-of-order plan: swap the slots of two queued matches of one team.
        queued = [m for m in t.all_group_matches() if not is_on_court(m) and not court_done(m)]
        a = min(queued, key=lambda m: m.round_number)
        b = max((m for m in queued if _ids(m) & _ids(a)), key=lambda m: m.round_number)
        a.slot_number, b.slot_number = b.slot_number, a.slot_number
        t.refill_group_courts()
        assert {m.id: m.court.id for m in t.all_group_matches() if is_on_court(m)} == on
        assert a.slot_number <= b.slot_number
