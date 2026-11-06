"""Participant withdrawal: the 50% rule (G1), rotating groups (G2), bracket forfeits (P).

Engine tests run on the tournament classes directly; API tests go through the
real app with ``TestClient``.  See ``withdrawal-plan.md`` for the semantics.
"""

from __future__ import annotations

import pickle

import pytest

import backend.api.db as db_mod
from backend.api import state as state_mod
from backend.api.elo_store import get_tournament_elos
from backend.api.player_secret_store import extract_partner_rival_stats
from backend.models import GPPhase, InputFormat, MatchFormatOverride, MatchStatus, MexPhase, Player, POPhase, SetDecider
from backend.tournaments import GroupPlayoffTournament, PlayoffTournament
from backend.tournaments.errors import MatchClearBlocked, WithdrawalBlocked
from backend.tournaments.group_stage import Group
from backend.tournaments.mexicano import MexicanoTournament
from backend.tournaments.playoff import (
    DoubleEliminationBracket,
    EspejoParallelBracket,
    EspejoSplitBracket,
    SingleEliminationBracket,
)
from backend.tournaments.withdrawal import (
    WalkoverTemplate,
    WithdrawalKind,
    bracket_entry_key,
    check_template_fits,
    classify_fifty_percent,
)

# conftest stubs out ``_save_tournament``; keep the real one for SQLite round trips.
_REAL_SAVE_TOURNAMENT = state_mod._save_tournament

K = WithdrawalKind


# ────────────────────────────────────────────────────────────────────────────
# Engine helpers
# ────────────────────────────────────────────────────────────────────────────


def _players(n: int, prefix: str = "P") -> list[Player]:
    return [Player(name=f"{prefix}{i}", id=f"{prefix.lower()}{i}") for i in range(n)]


def _gp_teams(n: int) -> GroupPlayoffTournament:
    """One fixed-team group of *n* entries (round robin generated)."""
    t = GroupPlayoffTournament(_players(n), num_groups=1, team_mode=True, top_per_group=2)
    t.generate()
    return t


def _gp_rotating(n: int) -> GroupPlayoffTournament:
    """One rotating-partner group of *n* players (first round generated)."""
    t = GroupPlayoffTournament(_players(n), num_groups=1, team_mode=False, top_per_group=4)
    t.generate()
    return t


def _matches_of(group: Group, pid: str):
    return [m for m in group.matches if pid in {p.id for p in m.team1 + m.team2}]


def _win(t: GroupPlayoffTournament, m, team1_wins: bool = True) -> None:
    t.record_group_result(m.id, (6, 2) if team1_wins else (2, 6))


def _row(group: Group, pid: str):
    return next(r for r in group.standings() if r.player.id == pid)


def _record_bracket(t, m, team1_wins: bool = True) -> None:
    score = (6, 2) if team1_wins else (2, 6)
    if isinstance(t, GroupPlayoffTournament) or isinstance(t, MexicanoTournament):
        t.record_playoff_result(m.id, score)
    else:
        t.record_result(m.id, score)


def _po(n: int, **kw) -> PlayoffTournament:
    return PlayoffTournament([[p] for p in _players(n, "T")], **kw)


def _winner_ids(m) -> set[str]:
    return {p.id for p in (m.winner_team or [])}


def _pending_with(bracket, pid: str):
    return [m for m in bracket.pending_matches() if pid in {p.id for p in m.team1 + m.team2}]


# ────────────────────────────────────────────────────────────────────────────
# G1 — fixed-team groups: the 50% rule
# ────────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("played", "total", "kind"),
    [
        (0, 2, K.ANNUL),
        (1, 2, K.WALKOVER),
        (0, 3, K.ANNUL),
        (1, 3, K.ANNUL),
        (2, 3, K.WALKOVER),
        (1, 4, K.ANNUL),
        (2, 4, K.WALKOVER),
        (2, 5, K.ANNUL),
        (3, 5, K.WALKOVER),
        (0, 0, K.ANNUL),
    ],
)
def test_classify_fifty_percent(played: int, total: int, kind: WithdrawalKind) -> None:
    assert classify_fifty_percent(played, total) is kind


class TestGroupTeamWithdrawal:
    def test_group_of_three_annul_leaves_two_entries_and_one_match(self) -> None:
        t = _gp_teams(3)
        g = t.groups[0]
        record, created = t.withdraw("p0")
        assert record.kind is K.ANNUL and created == []
        assert {p.id for p in g.players} == {"p1", "p2"}
        assert len(g.matches) == 1
        assert all(p.id != "p0" for p in t.players)
        assert {r.player.id for r in g.standings()} == {"p1", "p2"}

    @pytest.mark.parametrize("withdrawn_side_team1", [True, False])
    def test_group_of_three_keep_gives_one_walkover_for_the_opponent(self, withdrawn_side_team1: bool) -> None:
        t = _gp_teams(3)
        g = t.groups[0]
        first, second = _matches_of(g, "p0")
        _win(t, first, True)
        # Orient the remaining match so p0 is on the requested side.
        if (second.team1[0].id == "p0") != withdrawn_side_team1:
            second.team1, second.team2 = second.team2, second.team1
        record, created = t.withdraw("p0")
        assert record.kind is K.WALKOVER
        assert [m.id for m in created] == [second.id]
        assert second.walkover and second.status == MatchStatus.COMPLETED and second.score_confirmed
        assert "p0" not in _winner_ids(second)
        assert second.score == ((0, 6) if withdrawn_side_team1 else (6, 0))
        assert second.score_history[-1]["action"] == "walkover"
        rows = g.standings()
        assert rows[-1].player.id == "p0" and rows[-1].withdrawn

    def test_group_of_four_annul_after_one_played_removes_the_opponents_result(self) -> None:
        t = _gp_teams(4)
        g = t.groups[0]
        m = _matches_of(g, "p0")[0]
        opponent = next(p.id for p in m.team1 + m.team2 if p.id != "p0")
        _win(t, m)
        assert _row(g, opponent).played == 1
        record, _ = t.withdraw("p0")
        assert record.kind is K.ANNUL and record.played == 1 and record.total == 3
        assert _row(g, opponent).played == 0
        assert len(g.matches) == 3

    def test_group_of_four_keep_after_two_played(self) -> None:
        t = _gp_teams(4)
        g = t.groups[0]
        for m in _matches_of(g, "p0")[:2]:
            _win(t, m)
        record, created = t.withdraw("p0")
        assert record.kind is K.WALKOVER and (record.played, record.total) == (2, 3)
        assert len(created) == 1 and created[0].walkover

    def test_custom_points_template(self) -> None:
        t = _gp_teams(3)
        g = t.groups[0]
        _win(t, _matches_of(g, "p0")[0])
        _, created = t.withdraw("p0", template=WalkoverTemplate(points=(21, 15)))
        m = created[0]
        assert sorted(m.score) == [15, 21] and "p0" not in _winner_ids(m)

    @pytest.mark.parametrize(
        ("sets", "decider"),
        [
            ([(6, 0), (6, 0)], SetDecider.FULL_SET),
            ([(6, 3), (7, 5)], SetDecider.FULL_SET),
            ([(6, 3), (3, 6), (10, 8)], SetDecider.MATCH_TIEBREAK),
        ],
    )
    def test_set_templates(self, sets, decider) -> None:
        t = _gp_teams(3)
        g = t.groups[0]
        _win(t, _matches_of(g, "p0")[0])
        tpl = WalkoverTemplate(sets=sets, stage_mode=InputFormat.SETS, default_decider=decider)
        check_template_fits(tpl, [m for m in g.matches if m.status != MatchStatus.COMPLETED], False)
        _, created = t.withdraw("p0", template=tpl)
        m = created[0]
        assert m.sets is not None and len(m.sets) == len(sets)
        assert m.decider == decider
        assert "p0" not in _winner_ids(m)

    def test_three_set_template_under_match_tiebreak_needs_a_valid_tiebreak(self) -> None:
        tpl = WalkoverTemplate(
            sets=[(6, 3), (3, 6), (6, 4)], stage_mode=InputFormat.SETS, default_decider=SetDecider.MATCH_TIEBREAK
        )
        t = _gp_teams(3)
        with pytest.raises(ValueError):
            check_template_fits(tpl, list(t.groups[0].matches), False)

    @pytest.mark.parametrize("flag", ["in_progress", "disputed", "format_review"])
    def test_lifecycle_blockers(self, flag: str) -> None:
        t = _gp_teams(3)
        g = t.groups[0]
        m = _matches_of(g, "p0")[0]
        if flag == "in_progress":
            m.score, m.status = (6, 2), MatchStatus.IN_PROGRESS
        elif flag == "disputed":
            _win(t, m)
            m.disputed = True
        else:
            m.format_review, m.review_score = True, (6, 2)
        plan = t.plan_withdrawal("p0")
        assert [b.reason for b in plan.blockers] == [{"in_progress": "pending"}.get(flag, flag)]
        if flag == "in_progress":
            assert plan.played == 0
        with pytest.raises(WithdrawalBlocked):
            t.withdraw("p0")

    def test_withdrawal_after_all_group_matches_played(self) -> None:
        t = _gp_teams(4)
        g = t.groups[0]
        for m in g.matches:
            _win(t, m, team1_wins=any(p.id == "p0" for p in m.team1))
        assert g.top_players(1)[0].id == "p0"
        record, created = t.withdraw("p0")
        assert record.kind is K.WALKOVER and created == []
        assert "p0" not in {p.id for p in g.top_players(2)}
        with pytest.raises(RuntimeError, match="withdrawn"):
            t.start_playoffs(advancing_player_ids=["p0", "p1"])
        t.start_playoffs()
        teams = t.playoff_bracket.original_teams
        assert all(p.id != "p0" for team in teams for p in team)

    def test_withdrawn_entry_rejected_in_oro_plata_lists(self) -> None:
        t = _gp_teams(5)
        for m in t.groups[0].matches:
            _win(t, m)
        t.withdraw("p0")
        with pytest.raises(RuntimeError, match="withdrawn"):
            t.start_playoffs(espejo_split=True, oro_player_ids=["p0", "p1"], plata_player_ids=["p2", "p3"])

    def test_second_withdrawal_ignores_walkovers_against_the_first(self) -> None:
        t = _gp_teams(4)
        g = t.groups[0]
        for m in _matches_of(g, "p0")[:2]:
            _win(t, m)
        t.withdraw("p0")  # walkover branch: p0's last match becomes a W/O
        p0_vs = next(p.id for p in _matches_of(g, "p0")[2].team1 + _matches_of(g, "p0")[2].team2 if p.id != "p0")
        plan = t.plan_withdrawal(p0_vs)
        assert plan.total == 2  # 3 matches minus the walkover against p0

    def test_record_and_clear_refuse_walkovers(self) -> None:
        t = _gp_teams(3)
        g = t.groups[0]
        _win(t, _matches_of(g, "p0")[0])
        _, created = t.withdraw("p0")
        with pytest.raises(RuntimeError):
            t.record_group_result(created[0].id, (1, 6))
        with pytest.raises(MatchClearBlocked):
            t.clear_group_result(created[0].id)

    def test_undo_annul_restores_order_and_standings(self) -> None:
        t = _gp_teams(4)
        g = t.groups[0]
        _win(t, _matches_of(g, "p0")[0])
        before_ids = [m.id for m in g.matches]
        before_rows = [(r.player.id, r.played, r.wins) for r in g.standings()]
        t.withdraw("p0")
        t.undo_withdrawal("p0")
        assert [m.id for m in g.matches] == before_ids
        assert [(r.player.id, r.played, r.wins) for r in g.standings()] == before_rows
        assert [p.id for p in t.players] == ["p0", "p1", "p2", "p3"]
        assert t.withdrawals == {}

    def test_undo_walkover_resets_the_matches(self) -> None:
        t = _gp_teams(3)
        g = t.groups[0]
        _win(t, _matches_of(g, "p0")[0])
        _, created = t.withdraw("p0")
        t.undo_withdrawal("p0")
        assert created[0].status == MatchStatus.SCHEDULED and not created[0].walkover
        assert "p0" not in g.withdrawn_ids

    def test_roster_change_blocks_undo(self) -> None:
        t = _gp_teams(3)
        t.withdraw("p0")
        t.add_player_to_group(Player(name="New", id="new"), t.groups[0].name)
        assert t.undo_block_reason("p0") is not None
        with pytest.raises(WithdrawalBlocked):
            t.undo_withdrawal("p0")

    def test_added_entry_gets_a_walkover_against_a_withdrawn_entry(self) -> None:
        t = _gp_teams(3)
        g = t.groups[0]
        _win(t, _matches_of(g, "p0")[0])
        t.withdraw("p0")
        new = t.add_player_to_group(Player(name="New", id="new"), g.name)
        vs_p0 = next(m for m in new if "p0" in {p.id for p in m.team1 + m.team2})
        assert vs_p0.walkover and _winner_ids(vs_p0) == {"new"}

    def test_composite_team_member_withdraws_the_team(self) -> None:
        members = _players(6, "M")
        teams = [Player(name="M0 & M1", id="t0"), Player(name="M2 & M3", id="t1"), Player(name="M4 & M5", id="t2")]
        roster = {"t0": ["m0", "m1"], "t1": ["m2", "m3"], "t2": ["m4", "m5"]}
        t = GroupPlayoffTournament(teams, num_groups=1, team_mode=True, team_roster=roster)
        t.generate()
        assert members  # ids only matter through the roster
        plan = t.plan_withdrawal("m1")
        assert plan.entry_key == "t0"
        record, _ = t.withdraw("m1")
        assert set(record.member_ids) == {"t0", "m0", "m1"}
        with pytest.raises(WithdrawalBlocked, match="already"):
            t.plan_withdrawal("m0")


# ────────────────────────────────────────────────────────────────────────────
# G2 — rotating partners: exclude from following rounds
# ────────────────────────────────────────────────────────────────────────────


def _finish_round(t: GroupPlayoffTournament) -> None:
    for m in t.pending_group_matches():
        _win(t, m)


class TestGroupRotatingWithdrawal:
    def test_between_rounds_the_next_round_leaves_the_person_out(self) -> None:
        t = _gp_rotating(8)
        g = t.groups[0]
        _finish_round(t)
        row_before = _row(g, "p0")
        record, _ = t.withdraw("p0")
        assert record.kind is K.EXCLUDE and record.dropped_match is None
        new = t.generate_next_group_round()
        assert new and all("p0" not in {p.id for p in m.team1 + m.team2} for m in new)
        # 7 active: 3 sit out, so one match.
        assert len(new) == 1
        row = _row(g, "p0")
        assert row.withdrawn and (row.played, row.wins, row.points_for) == (
            row_before.played,
            row_before.wins,
            row_before.points_for,
        )
        assert g.standings()[-1].player.id == "p0"

    def test_partner_results_are_unchanged(self) -> None:
        t = _gp_rotating(4)
        g = t.groups[0]
        _finish_round(t)
        m = g.matches[0]
        partner = next(
            p.id for team in (m.team1, m.team2) if "p0" in {x.id for x in team} for p in team if p.id != "p0"
        )
        before = _row(g, partner)
        t.withdraw("p0")
        after = _row(g, partner)
        assert (before.played, before.wins, before.points_for) == (after.played, after.wins, after.points_for)

    def test_unplayed_current_round_match_is_dropped_and_rolled_back(self) -> None:
        t = _gp_rotating(8)
        g = t.groups[0]
        mine = _matches_of(g, "p0")[0]
        other = next(m for m in g.matches if m is not mine)
        others = [p.id for p in mine.team1 + mine.team2 if p.id != "p0"]
        partner = next(
            p.id for team in (mine.team1, mine.team2) if "p0" in {x.id for x in team} for p in team if p.id != "p0"
        )
        opp_pair = frozenset(p.id for p in (mine.team2 if "p0" in {x.id for x in mine.team1} else mine.team1))
        record, _ = t.withdraw("p0")
        assert record.dropped_match is mine and mine not in g.matches
        assert other in g.matches and other.status == MatchStatus.SCHEDULED
        assert g._partner_history["p0"][partner] == 0
        assert opp_pair not in g._used_partnerships
        assert sorted(record.sit_out_bumped) == sorted(others)
        assert all(g._sit_out_counts[pid] == 1 for pid in others)
        _win(t, other)
        new = t.generate_next_group_round()
        assert new and all("p0" not in {p.id for p in m.team1 + m.team2} for m in new)
        # The three who sat out play next round (sit-out credit gives them priority).
        playing = {p.id for m in new for p in m.team1 + m.team2}
        assert set(others) <= playing

    @pytest.mark.parametrize(("size", "sit_outs"), [(5, 0), (6, 1)])
    def test_odd_counts(self, size: int, sit_outs: int) -> None:
        t = _gp_rotating(size)
        g = t.groups[0]
        _finish_round(t)
        t.withdraw("p0")
        seen_sitting: list[str] = []
        for _ in range(3):
            new = t.generate_next_group_round()
            if not new:
                break
            playing = {p.id for m in new for p in m.team1 + m.team2}
            sitting = [p.id for p in g.active_players if p.id not in playing]
            assert len(sitting) == sit_outs
            seen_sitting += sitting
            _finish_round(t)
        if sit_outs:
            # Fewest sit-outs first: nobody sits twice before everyone sat once.
            assert len(seen_sitting) == len(set(seen_sitting))

    def test_below_four_active_stops_rounds(self) -> None:
        t = _gp_rotating(4)
        g = t.groups[0]
        _finish_round(t)
        plan = t.plan_withdrawal("p0")
        assert plan.active_after == 3
        t.withdraw("p0")
        assert g.has_more_rounds is False
        count = g._round_count
        assert g.generate_next_round() == []
        assert g._round_count == count

    def test_pruned_partnerships_let_the_group_finish(self) -> None:
        t = _gp_rotating(5)
        _finish_round(t)
        t.withdraw("p0")
        for _ in range(30):
            if not t.generate_next_group_round():
                break
            _finish_round(t)
        assert t.has_more_group_rounds is False

    def test_undo_before_the_next_round_restores_everything(self) -> None:
        t = _gp_rotating(8)
        g = t.groups[0]
        mine = _matches_of(g, "p0")[0]
        ids = [m.id for m in g.matches]
        counts = dict(g._sit_out_counts)
        used = set(g._used_partnerships)
        allp = set(g._all_partnerships)
        t.withdraw("p0")
        t.undo_withdrawal("p0")
        assert [m.id for m in g.matches] == ids and mine in g.matches
        assert dict(g._sit_out_counts) == counts
        assert g._used_partnerships == used and g._all_partnerships == allp
        assert "p0" not in g.withdrawn_ids

    def test_undo_after_the_next_round_is_refused(self) -> None:
        t = _gp_rotating(8)
        _finish_round(t)
        t.withdraw("p0")
        t.generate_next_group_round()
        assert t.undo_block_reason("p0") is not None
        with pytest.raises(WithdrawalBlocked):
            t.undo_withdrawal("p0")

    def test_blocker_in_the_current_match(self) -> None:
        t = _gp_rotating(8)
        m = _matches_of(t.groups[0], "p0")[0]
        m.format_review, m.review_score = True, (6, 2)
        with pytest.raises(WithdrawalBlocked):
            t.withdraw("p0")

    def test_withdrawn_player_cannot_be_picked_for_playoffs(self) -> None:
        t = _gp_rotating(5)
        _finish_round(t)
        t.withdraw("p0")
        with pytest.raises(RuntimeError, match="withdrawn"):
            t.start_playoffs(advancing_player_ids=["p0", "p1"])


# ────────────────────────────────────────────────────────────────────────────
# P — brackets: forfeit with walkovers
# ────────────────────────────────────────────────────────────────────────────


class TestBracketForfeit:
    def test_se_known_opponent_advances_by_walkover(self) -> None:
        t = _po(4)
        semi = _pending_with(t.bracket, "t0")[0]
        record, created = t.withdraw("t0")
        assert record.kind is K.FORFEIT and created == [semi]
        assert semi.walkover and "t0" not in _winner_ids(semi)
        final = t.bracket._final_match()
        assert any(p.id in _winner_ids(semi) for p in final.team1 + final.team2)

    def test_se_tbd_opponent_walkover_on_feeder_record(self) -> None:
        t = _po(4)
        semis = list(t.bracket.pending_matches())
        _record_bracket(t, next(m for m in semis if "t0" in {p.id for p in m.team1 + m.team2}))
        plan = t.plan_withdrawal("t0")
        assert plan.tbd and plan.pending_forfeit_match is None
        _, created = t.withdraw("t0")
        assert created == []
        other = next(m for m in semis if m.status != MatchStatus.COMPLETED)
        _record_bracket(t, other)
        final = t.bracket._final_match()
        assert final.walkover and "t0" not in _winner_ids(final)
        assert t.phase == POPhase.FINISHED

    def test_se_first_round_bye_waits_then_forfeits(self) -> None:
        t = _po(3)  # t0 has a bye straight into the final
        record, created = t.withdraw("t0")
        assert created == [] and record.kind is K.FORFEIT
        r1 = t.bracket.pending_matches()[0]
        _record_bracket(t, r1)
        final = t.bracket._final_match()
        assert final.walkover and _winner_ids(final) == _winner_ids(r1)
        assert t.phase == POPhase.FINISHED

    def test_se_third_place_chain(self) -> None:
        t = _po(4, third_place=True)
        semi = _pending_with(t.bracket, "t0")[0]
        plan = t.plan_withdrawal("t0")
        assert plan.third_place_note
        t.withdraw("t0")
        assert semi.walkover
        tp = t.bracket.third_place_match
        assert "t0" in {p.id for p in tp.team1 + tp.team2}
        other = next(m for m in t.bracket.pending_matches() if m.round_label == "Semi-Final")
        _record_bracket(t, other)
        assert tp.walkover and "t0" not in _winner_ids(tp)

    def test_withdrawal_inside_a_pending_third_place_match(self) -> None:
        t = _po(4, third_place=True)
        for m in list(t.bracket.pending_matches()):
            _record_bracket(t, m)
        tp = t.bracket.third_place_match
        loser = tp.team1[0].id
        t.withdraw(loser)
        assert tp.walkover and loser not in _winner_ids(tp)

    def test_walkover_final_leaves_third_place_alone(self) -> None:
        t = _po(4, third_place=True)
        for m in list(t.bracket.pending_matches()):
            _record_bracket(t, m)
        final = t.bracket._final_match()
        tp = t.bracket.third_place_match
        t.withdraw(final.team1[0].id)
        assert final.walkover and tp.status != MatchStatus.COMPLETED
        _record_bracket(t, tp)
        assert t.phase == POPhase.FINISHED

    def test_multi_winner_cutoff_match(self) -> None:
        t = _po(4, num_winners=2)
        t.withdraw("t0")
        semi = next(m for m in t.bracket.matches if "t0" in {p.id for p in m.team1 + m.team2})
        assert semi.walkover
        other = next(m for m in t.bracket.pending_matches())
        _record_bracket(t, other)
        winners = t.winners()
        assert winners is not None and all(p.id != "t0" for team in winners for p in team)

    def test_double_elimination_chain(self) -> None:
        t = _po(4, double_elimination=True)
        b: DoubleEliminationBracket = t.bracket
        wr1 = _pending_with(b, "t0")[0]
        plan = t.plan_withdrawal("t0")
        assert plan.lb_drop
        t.withdraw("t0")
        assert wr1.walkover
        lr = next(m for m in b.losers_matches if "t0" in {p.id for p in m.team1 + m.team2})
        assert lr.status != MatchStatus.COMPLETED  # opponent not known yet
        other = next(m for m in b.winners_matches if m.round_number == 1 and m.status != MatchStatus.COMPLETED)
        _record_bracket(t, other)
        assert lr.walkover and "t0" not in _winner_ids(lr)

    def test_double_elimination_withdrawal_in_losers_bracket(self) -> None:
        t = _po(4, double_elimination=True)
        b: DoubleEliminationBracket = t.bracket
        for m in [m for m in b.winners_matches if m.round_number == 1]:
            _record_bracket(t, m)
        lr = next(m for m in b.pending_matches() if m.round_label.startswith("Losers"))
        victim = lr.team2[0].id
        t.withdraw(victim)
        assert lr.walkover and victim not in _winner_ids(lr)

    def test_double_elimination_grand_final_makes_opponent_champion(self) -> None:
        t = _po(4, double_elimination=True)
        b: DoubleEliminationBracket = t.bracket
        while b.grand_final.status != MatchStatus.COMPLETED and not (b.grand_final.team1 and b.grand_final.team2):
            _record_bracket(t, b.pending_matches()[0])
        victim = b.grand_final.team1[0].id
        t.withdraw(victim)
        assert b.grand_final.walkover
        assert t.phase == POPhase.FINISHED and all(p.id != victim for p in t.champion())

    def test_double_elimination_auto_bye_carries_withdrawn_entry(self) -> None:
        t = _po(3, double_elimination=True)
        b: DoubleEliminationBracket = t.bracket
        wr1 = b.pending_matches()[0]
        victim = wr1.team2[0].id
        t.withdraw(victim)
        assert wr1.walkover
        # The withdrawn loser passes the LR bye and forfeits the next real match.
        for _ in range(6):
            pending = b.pending_matches()
            if not pending:
                break
            _record_bracket(t, pending[0])
        assert t.phase == POPhase.FINISHED
        assert all(p.id != victim for p in t.champion())
        assert any(
            m.walkover for m in b.losers_matches + [b.grand_final] if victim in {p.id for p in m.team1 + m.team2}
        )

    def test_espejo_parallel_r1_loss_is_forfeited_in_the_losers_bracket(self) -> None:
        t = _po(4, espejo=True)
        b: EspejoParallelBracket = t.bracket
        r1 = _pending_with(b, "t0")[0]
        plan = t.plan_withdrawal("t0")
        assert plan.lb_drop
        t.withdraw("t0")
        assert r1.walkover and b.losers_bracket is None
        other = next(m for m in b.winners_bracket.matches if m.round_number == 1 and m.status != MatchStatus.COMPLETED)
        _record_bracket(t, other)
        assert b.losers_bracket is not None
        lb_final = b.losers_bracket.matches[0]
        assert lb_final.walkover and "t0" not in _winner_ids(lb_final)

    def test_espejo_parallel_r1_loser_waiting_for_lb_seed_can_withdraw(self) -> None:
        t = _po(4, espejo=True)
        b: EspejoParallelBracket = t.bracket
        r1 = _pending_with(b, "t0")[0]
        _record_bracket(t, r1, team1_wins=r1.team1[0].id != "t0")
        assert b.losers_bracket is None
        plan = t.plan_withdrawal("t0")
        assert plan.tbd and plan.pending_forfeit_match is None
        t.withdraw("t0")
        other = next(m for m in b.winners_bracket.matches if m.round_number == 1 and m.status != MatchStatus.COMPLETED)
        _record_bracket(t, other)
        assert b.losers_bracket.matches[0].walkover

    def test_espejo_split_plata_forfeits_independently(self) -> None:
        oro = [[p] for p in _players(4, "O")]
        plata = [[p] for p in _players(4, "L")]
        bracket = EspejoSplitBracket(oro, plata)
        t = _po(4)
        t.bracket = bracket
        victim = plata[0][0].id
        t.withdraw(victim)
        semi = next(m for m in bracket.losers_bracket.matches if victim in {p.id for p in m.team1 + m.team2})
        assert semi.walkover
        assert not any(m.walkover for m in bracket.winners_bracket.matches)

    def test_both_sides_withdrawn_better_seed_takes_the_walkover(self) -> None:
        t = _po(4)
        _record_bracket(t, _pending_with(t.bracket, "t0")[0], team1_wins=True)
        _ = t.withdraw("t0")  # t0 waits for the final
        other = t.bracket.pending_matches()[0]
        other_winner = other.team1[0].id
        _record_bracket(t, other, team1_wins=True)
        final = t.bracket._final_match()
        if not final.walkover:
            t.withdraw(other_winner)
        assert final.walkover
        assert _winner_ids(final) in ({"t0"}, {other_winner})

    def test_both_withdrawn_in_one_pending_match(self) -> None:
        t = _po(4)
        b: SingleEliminationBracket = t.bracket
        for m in list(b.pending_matches()):
            _record_bracket(t, m)
        final = b._final_match()
        seeds = {bracket_entry_key(team): i for i, team in enumerate(b.original_teams)}
        t1, t2 = final.team1[0].id, final.team2[0].id
        # Mark the first withdrawal without resolving, then withdraw the other side.
        from backend.tournaments.withdrawal import WithdrawalRecord

        t.withdrawals[t1] = WithdrawalRecord(entry_key=t1, entry=list(final.team1), kind=K.FORFEIT, member_ids=[t1])
        t.withdraw(t2)
        better = t1 if seeds[t1] < seeds[t2] else t2
        assert final.walkover and _winner_ids(final) == {better}
        assert final.score_history[-1].get("both_withdrawn") is True

    def test_already_eliminated_and_finished(self) -> None:
        t = _po(4)
        semi = _pending_with(t.bracket, "t0")[0]
        _record_bracket(t, semi, team1_wins=semi.team1[0].id != "t0")
        with pytest.raises(WithdrawalBlocked, match="eliminated"):
            t.plan_withdrawal("t0")
        for m in list(t.bracket.pending_matches()):
            _record_bracket(t, m)
        final = t.bracket._final_match()
        _record_bracket(t, final)
        assert t.phase == POPhase.FINISHED
        with pytest.raises(WithdrawalBlocked, match="finished"):
            t.plan_withdrawal(final.team1[0].id)

    def test_blocker_in_the_current_match(self) -> None:
        t = _po(4)
        semi = _pending_with(t.bracket, "t0")[0]
        semi.format_review, semi.review_score = True, (6, 2)
        with pytest.raises(WithdrawalBlocked):
            t.withdraw("t0")

    @staticmethod
    def _t0_waits_in_semi() -> tuple[PlayoffTournament, object, object]:
        """8 teams; t0 won its quarter-final and withdrew.  Returns (t, sibling QF, semi)."""
        t = _po(8)
        b: SingleEliminationBracket = t.bracket
        qf = _pending_with(b, "t0")[0]
        _record_bracket(t, qf, team1_wins=qf.team1[0].id == "t0")
        t.withdraw("t0")
        semi_id = b._next_match[qf.id][0]
        sibling = next(m for m in b.matches if m.id != qf.id and b._next_match.get(m.id, ("",))[0] == semi_id)
        return t, sibling, b._match_map[semi_id]

    def test_clear_feeder_unwinds_the_walkover(self) -> None:
        t, sibling, semi = self._t0_waits_in_semi()
        _record_bracket(t, sibling)
        assert semi.walkover
        t.clear_result(sibling.id)
        assert sibling.status == MatchStatus.SCHEDULED
        assert not semi.walkover and semi.status != MatchStatus.COMPLETED
        assert semi.id not in t.withdrawals["t0"].walkover_match_ids
        _record_bracket(t, sibling)
        assert semi.walkover  # recreated once the opponent is known again

    def test_rerecord_feeder_with_other_winner_reresolves(self) -> None:
        t, sibling, semi = self._t0_waits_in_semi()
        _record_bracket(t, sibling, team1_wins=True)
        assert _winner_ids(semi) == {sibling.team1[0].id}
        _record_bracket(t, sibling, team1_wins=False)
        assert semi.walkover and _winner_ids(semi) == {sibling.team2[0].id}

    def test_really_played_downstream_still_blocks_and_rolls_back(self) -> None:
        t = _po(8)
        b: SingleEliminationBracket = t.bracket
        qf = _pending_with(b, "t0")[0]
        t.withdraw("t0")  # QF walkover: the opponent waits in the semi
        assert qf.walkover
        semi_feeder = next(
            m
            for m in b.matches
            if m.round_label == "Quarter-Final"
            and m.status != MatchStatus.COMPLETED
            and b._next_match[m.id][0] == b._next_match[qf.id][0]
        )
        _record_bracket(t, semi_feeder)
        semi = b._match_map[b._next_match[qf.id][0]]
        _record_bracket(t, semi)  # really played
        with pytest.raises(MatchClearBlocked):
            t.clear_result(semi_feeder.id)
        assert t.bracket._match_map[semi.id].status == MatchStatus.COMPLETED

    def test_undo_is_refused_for_forfeits(self) -> None:
        t = _po(4)
        t.withdraw("t0")
        assert t.undo_block_reason("t0") is not None

    def test_gp_playoffs_walkover_final_finishes(self) -> None:
        t = _gp_teams(4)
        for m in t.groups[0].matches:
            _win(t, m)
        t.start_playoffs()
        final = t.playoff_bracket._final_match()
        team = t.playoff_bracket.original_teams[0]
        t.withdraw(team[0].id)
        assert final.walkover and t.phase == GPPhase.FINISHED

    def test_mexicano_playoffs_forfeit_finishes(self) -> None:
        t = MexicanoTournament(_players(4), courts=[], total_points_per_match=16, num_rounds=1)
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (10, 6))
        t.end_mexicano()
        t.start_playoffs(n_teams=4)
        final = t.pending_playoff_matches()[0]
        with pytest.raises(WithdrawalBlocked):
            MexicanoTournament(_players(4), courts=[], num_rounds=1).plan_withdrawal("p0")
        t.withdraw(final.team1[0].id)
        assert final.walkover and t.phase == MexPhase.FINISHED


# ────────────────────────────────────────────────────────────────────────────
# Back-compat: pickles from before withdrawals existed
# ────────────────────────────────────────────────────────────────────────────


class TestOldPickles:
    def test_old_objects_get_defaults(self) -> None:
        gp = _gp_teams(3)
        del gp.__dict__["withdrawals"]
        del gp.groups[0].__dict__["withdrawn_ids"]
        for m in gp.groups[0].matches:
            del m.__dict__["walkover"]
        loaded = state_mod._safe_loads(pickle.dumps(gp))
        assert loaded.withdrawals == {}
        assert loaded.groups[0].withdrawn_ids == set()
        assert all(m.walkover is False for m in loaded.groups[0].matches)
        assert all(r.withdrawn is False for r in loaded.groups[0].standings())

        po = _po(4)
        del po.__dict__["withdrawals"]
        assert state_mod._safe_loads(pickle.dumps(po)).withdrawals == {}

        mex = MexicanoTournament(_players(4), courts=[], num_rounds=1)
        del mex.__dict__["withdrawals"]
        assert state_mod._safe_loads(pickle.dumps(mex)).withdrawals == {}

    def test_records_round_trip(self) -> None:
        t = _gp_teams(3)
        _win(t, _matches_of(t.groups[0], "p0")[0])
        t.withdraw("p0", template=WalkoverTemplate(points=(9, 1)))
        loaded = state_mod._safe_loads(pickle.dumps(t))
        rec = loaded.withdrawals["p0"]
        assert rec.kind is K.WALKOVER and rec.template.points == (9, 1)
        assert loaded.groups[0].withdrawn_ids == {"p0"}


def test_deciders_needed_lists_each_distinct_decider() -> None:
    from backend.models import Match
    from backend.tournaments.withdrawal import deciders_needed

    template = WalkoverTemplate(stage_mode=InputFormat.SETS, default_decider=SetDecider.FULL_SET)
    plain = Match(id="m1", team1=[], team2=[])
    tb = Match(id="m2", team1=[], team2=[], format_override=MatchFormatOverride(decider=SetDecider.MATCH_TIEBREAK))
    points = Match(id="m3", team1=[], team2=[], format_override=MatchFormatOverride(mode=InputFormat.POINTS))
    assert deciders_needed(template, [plain], False) == [SetDecider.FULL_SET]
    assert deciders_needed(template, [tb], False) == [SetDecider.MATCH_TIEBREAK]
    assert deciders_needed(template, [plain, tb], False) == [SetDecider.FULL_SET, SetDecider.MATCH_TIEBREAK]
    assert deciders_needed(template, [tb, points], True) == [SetDecider.FULL_SET, SetDecider.MATCH_TIEBREAK]
    assert deciders_needed(template, [points], False) == []
    # check_template_fits rejects a full-set 3rd set when any affected match needs a tie-break.
    template.sets = [(6, 3), (3, 6), (6, 4)]
    with pytest.raises(ValueError):
        check_template_fits(template, [plain, tb], False)


# ────────────────────────────────────────────────────────────────────────────
# API
# ────────────────────────────────────────────────────────────────────────────

_GP_SINGLES = {
    "name": "Withdraw Cup",
    "player_names": ["A", "B", "C", "D"],
    "team_mode": True,
    "court_names": ["Court 1"],
    "num_groups": 1,
    "top_per_group": 2,
}


def _create_gp(client, headers, body: dict | None = None) -> str:
    r = client.post("/api/tournaments/group-playoff", json=body or _GP_SINGLES, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _ids(tid: str) -> dict[str, str]:
    t = state_mod._tournaments[tid]["tournament"]
    names: dict[str, str] = {}
    for p in getattr(t, "players", []) or []:
        names[p.name] = p.id
    for team in getattr(t, "original_teams", []) or []:
        for p in team:
            names[p.name] = p.id
    return names


def _gp_group_matches(client, tid) -> list[dict]:
    return [m for ms in client.get(f"/api/tournaments/{tid}/gp/groups").json()["matches"].values() for m in ms]


def _rec_group(client, headers, tid, mid, s1=6, s2=2):
    r = client.post(
        f"/api/tournaments/{tid}/gp/record-group", json={"match_id": mid, "score1": s1, "score2": s2}, headers=headers
    )
    assert r.status_code == 200, r.text


def _preview(client, headers, tid, pid):
    return client.get(f"/api/tournaments/{tid}/withdrawals/preview", params={"player_id": pid}, headers=headers)


def _withdraw(client, headers, tid, pid, kind, walkover=None):
    body: dict = {"player_id": pid, "expected_kind": kind}
    if walkover is not None:
        body["walkover"] = walkover
    return client.post(f"/api/tournaments/{tid}/withdrawals", json=body, headers=headers)


def _elo_rows(tid: str, match_ids: list[str] | None = None) -> int:
    with db_mod.get_db() as conn:
        if match_ids is None:
            return conn.execute("SELECT COUNT(*) FROM player_elo_log WHERE tournament_id = ?", (tid,)).fetchone()[0]
        marks = ",".join("?" for _ in match_ids)
        return conn.execute(
            f"SELECT COUNT(*) FROM player_elo_log WHERE tournament_id = ? AND match_id IN ({marks})",
            (tid, *match_ids),
        ).fetchone()[0]


def _a_matches(client, tid) -> list[dict]:
    a = _ids(tid)["A"]
    return [m for m in _gp_group_matches(client, tid) if a in m["team1_ids"] + m["team2_ids"]]


class TestWithdrawalAPI:
    def test_auth(self, client, alice_headers, bob_headers) -> None:
        tid = _create_gp(client, alice_headers)
        a = _ids(tid)["A"]
        assert _preview(client, {}, tid, a).status_code == 401
        assert _withdraw(client, {}, tid, a, "annul").status_code == 401
        assert client.delete(f"/api/tournaments/{tid}/withdrawals/{a}").status_code == 401
        assert _preview(client, bob_headers, tid, a).status_code == 403
        assert _withdraw(client, bob_headers, tid, a, "annul").status_code == 403
        assert _preview(client, alice_headers, tid, a).status_code == 200
        r = client.post(f"/api/tournaments/{tid}/collaborators", json={"username": "bob"}, headers=alice_headers)
        assert r.status_code == 200, r.text
        assert _withdraw(client, bob_headers, tid, a, "annul").status_code == 200
        assert client.delete(f"/api/tournaments/{tid}/withdrawals/{a}", headers=alice_headers).status_code == 200

    def test_preview_matches_outcome_and_stale_kind(self, client, auth_headers) -> None:
        tid = _create_gp(client, auth_headers)
        a = _ids(tid)["A"]
        p = _preview(client, auth_headers, tid, a).json()
        assert p["kind"] == "annul" and (p["played"], p["total"]) == (0, 3)
        assert len(p["annul_matches"]) == 3 and p["undo_possible"] is True
        for m in _a_matches(client, tid)[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        p = _preview(client, auth_headers, tid, a).json()
        assert p["kind"] == "walkover" and len(p["walkover_matches"]) == 1
        assert p["walkover_matches"][0]["resulting_score"] == "6-0"
        assert p["modes_needed"] == ["points"]
        assert _withdraw(client, auth_headers, tid, a, "annul").status_code == 409
        r = _withdraw(client, auth_headers, tid, a, "walkover")
        assert r.status_code == 200, r.text
        assert r.json()["walkovers_created"] == 1 and r.json()["withdrawal"]["undo_allowed"] is True
        assert _preview(client, auth_headers, tid, "nobody").status_code == 404
        assert _preview(client, auth_headers, tid, a).status_code == 409  # already withdrawn

    @pytest.mark.parametrize(
        "walkover",
        [
            {"points": [3, 3]},
            {"points": [2, 6]},
            {"points": [201, 0]},
            {"sets": [[6, 6]]},
            {"sets": [[0, 6], [0, 6]]},
        ],
    )
    def test_invalid_walkover_scores_are_422(self, client, auth_headers, walkover) -> None:
        tid = _create_gp(client, auth_headers)
        for m in _a_matches(client, tid)[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        r = _withdraw(client, auth_headers, tid, _ids(tid)["A"], "walkover", walkover)
        assert r.status_code == 422

    def test_sets_template_checked_against_the_decider(self, client, auth_headers) -> None:
        tid = _create_gp(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"set_decider": "match_tiebreak", "score_mode": {"gp-group": "sets"}},
            headers=auth_headers,
        )
        for m in _a_matches(client, tid)[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        a = _ids(tid)["A"]
        p = _preview(client, auth_headers, tid, a).json()
        assert p["modes_needed"] == ["sets"] and p["default_decider"] == "match_tiebreak"
        bad = {"sets": [[6, 3], [3, 6], [6, 4]]}
        assert _withdraw(client, auth_headers, tid, a, "walkover", bad).status_code == 422
        good = {"sets": [[6, 3], [3, 6], [10, 7]]}
        r = _withdraw(client, auth_headers, tid, a, "walkover", good)
        assert r.status_code == 200, r.text
        wo = next(m for m in _a_matches(client, tid) if m["walkover"])
        assert len(wo["sets"]) == 3 and wo["effective_decider"] == "match_tiebreak"

    def test_payloads_persistence_and_version(self, client, auth_headers, monkeypatch) -> None:
        # The real save writes SQLite and bumps the SSE version.
        monkeypatch.setattr(state_mod, "_save_tournament", _REAL_SAVE_TOURNAMENT)
        tid = _create_gp(client, auth_headers)
        for m in _a_matches(client, tid)[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        a = _ids(tid)["A"]
        v0 = state_mod._tournament_versions.get(tid, 0)
        assert _withdraw(client, auth_headers, tid, a, "walkover").status_code == 200
        v1 = state_mod._tournament_versions.get(tid, 0)
        assert v1 > v0
        status = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert [w["entry_key"] for w in status["withdrawals"]] == [a]
        assert status["withdrawals"][0]["member_ids"] == [a]
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        rows = next(iter(groups["standings"].values()))
        assert rows[-1]["player_id"] == a and rows[-1]["withdrawn"] is True
        assert any(m["walkover"] for m in _a_matches(client, tid))

        state_mod._tournaments.clear()
        state_mod._load_state()
        status = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert status["withdrawals"][0]["kind"] == "walkover"
        assert any(m["walkover"] for m in _a_matches(client, tid))

        assert client.delete(f"/api/tournaments/{tid}/withdrawals/{a}", headers=auth_headers).status_code == 200
        assert state_mod._tournament_versions.get(tid, 0) > v1
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["withdrawals"] == []

    def test_rotating_preview_reports_dropped_match(self, client, auth_headers) -> None:
        tid = _create_gp(
            client, auth_headers, {**_GP_SINGLES, "player_names": ["A", "B", "C", "D", "E"], "team_mode": False}
        )
        t = state_mod._tournaments[tid]["tournament"]
        g = t.groups[0]
        person = g.matches[0].team1[0].id
        p = _preview(client, auth_headers, tid, person).json()
        assert p["kind"] == "exclude" and p["dropped_match"] is not None
        assert len(p["sit_out_names"]) == 3 and p["active_after"] == 4
        r = _withdraw(client, auth_headers, tid, person, "exclude")
        assert r.status_code == 200, r.text
        assert client.post(f"/api/tournaments/{tid}/gp/next-group-round", headers=auth_headers).status_code == 200

    def test_composite_team_member_resolves_to_entry(self, client, auth_headers) -> None:
        body = {
            **_GP_SINGLES,
            "player_names": ["A", "B", "C", "D", "E", "F"],
            "teams": [["A", "B"], ["C", "D"], ["E", "F"]],
        }
        tid = _create_gp(client, auth_headers, body)
        t = state_mod._tournaments[tid]["tournament"]
        b_id = next(mid for team, members in t.team_roster.items() for mid in members if mid)
        p = _preview(client, auth_headers, tid, b_id).json()
        assert p["entry_key"] in t.team_roster and len(p["member_names"]) == 2

    def test_g1_annul_drops_elo_rows_and_keeps_seed_row(self, client, auth_headers) -> None:
        tid = _create_gp(client, auth_headers)
        ids = _ids(tid)
        seeded = dict(get_tournament_elos(tid, "padel"))
        played = _a_matches(client, tid)[0]
        _rec_group(client, auth_headers, tid, played["id"])
        assert _elo_rows(tid, [played["id"]]) > 0
        p = _preview(client, auth_headers, tid, ids["A"]).json()
        assert p["kind"] == "annul" and p["elo_recalc"] is True
        r = _withdraw(client, auth_headers, tid, ids["A"], "annul")
        assert r.status_code == 200 and r.json()["elo_recalculated"] is True
        assert _elo_rows(tid) == 0
        elos = get_tournament_elos(tid, "padel")
        assert elos == seeded  # nothing else was played: everyone is back at the seed
        assert ids["A"] in elos
        # Undo puts the result (and its rating) back.
        r = client.delete(f"/api/tournaments/{tid}/withdrawals/{ids['A']}", headers=auth_headers)
        assert r.status_code == 200 and r.json()["elo_recalculated"] is True
        assert _elo_rows(tid, [played["id"]]) > 0

    def test_walkovers_are_never_rated(self, client, auth_headers) -> None:
        from backend.api.elo_integration import elo_recalculate_tournament

        tid = _create_gp(client, auth_headers)
        for m in _a_matches(client, tid)[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        assert _withdraw(client, auth_headers, tid, _ids(tid)["A"], "walkover").status_code == 200
        wo_ids = [m["id"] for m in _a_matches(client, tid) if m["walkover"]]
        assert wo_ids and _elo_rows(tid, wo_ids) == 0
        elo_recalculate_tournament(tid)
        assert _elo_rows(tid, wo_ids) == 0
        assert _elo_rows(tid) > 0

    def test_partner_stats_skip_walkovers(self, client, auth_headers) -> None:
        tid = _create_gp(client, auth_headers)
        for m in _a_matches(client, tid)[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        _withdraw(client, auth_headers, tid, _ids(tid)["A"], "walkover")
        data = state_mod._tournaments[tid]
        wo = next(m for g in data["tournament"].groups for m in g.matches if m.walkover)
        opponent = next(p.id for p in wo.team1 + wo.team2 if p.id != _ids(tid)["A"])
        stats = extract_partner_rival_stats(data)
        rivals = {r["id"]: r["games"] for r in stats.get(opponent, {}).get("top_rivals", [])}
        assert rivals.get(_ids(tid)["A"], 0) == 0


class TestBracketAPI:
    def _po(self, client, headers, n=4, **extra) -> str:
        r = client.post(
            "/api/tournaments/playoff",
            json={"name": "PO", "participant_names": [f"T{i}" for i in range(n)], "court_names": ["C1"], **extra},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_po_forfeit_end_to_end(self, client, auth_headers) -> None:
        tid = self._po(client, auth_headers)
        pending = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"]
        victim = pending[0]["team1_ids"][0]
        p = _preview(client, auth_headers, tid, victim).json()
        assert p["kind"] == "forfeit" and p["pending_forfeit_match"]["match_id"] == pending[0]["id"]
        assert p["advance_to"] == "Final" and p["undo_possible"] is False
        r = _withdraw(client, auth_headers, tid, victim, "forfeit", {"points": [11, 4]})
        assert r.status_code == 200, r.text
        assert r.json()["walkovers_created"] == 1
        served = next(
            m
            for m in client.get(f"/api/tournaments/{tid}/po/playoffs").json()["matches"]
            if m["id"] == pending[0]["id"]
        )
        assert served["walkover"] and served["score"] == [4, 11]
        status = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert status["withdrawals"][0]["kind"] == "forfeit"
        assert status["withdrawals"][0]["undo_allowed"] is False
        assert client.delete(f"/api/tournaments/{tid}/withdrawals/{victim}", headers=auth_headers).status_code == 409
        # Recording the other semi decides the final by walkover? No: the opponent advanced.
        other = next(m for m in client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"])
        r = client.post(
            f"/api/tournaments/{tid}/po/record",
            json={"match_id": other["id"], "score1": 6, "score2": 2},
            headers=auth_headers,
        )
        assert r.status_code == 200
        # Walkovers get a W/O label on the bracket image.
        from backend.api.helpers import _build_match_labels

        labels = _build_match_labels(state_mod._tournaments[tid]["tournament"].bracket)
        assert any(v["score"] == "W/O" for v in labels.values())

    def test_po_walkover_final_finishes_and_notifies(self, client, auth_headers, monkeypatch) -> None:
        import backend.api.routes_withdrawals as rw

        calls: list[str] = []
        monkeypatch.setattr(rw, "notify_champion", lambda tid, data, names: calls.append("champion"))
        monkeypatch.setattr(rw, "elo_finish_tournament", lambda tid: calls.append("elo"))
        tid = self._po(client, auth_headers, n=2)
        final = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"][0]
        r = _withdraw(client, auth_headers, tid, final["team1_ids"][0], "forfeit")
        assert r.status_code == 200 and r.json()["phase"] == "finished"
        assert calls == ["elo", "champion"]
        assert _preview(client, auth_headers, tid, final["team2_ids"][0]).status_code == 409

    def test_gp_playoffs_forfeit_end_to_end(self, client, auth_headers) -> None:
        tid = _create_gp(client, auth_headers)
        for m in _gp_group_matches(client, tid):
            _rec_group(client, auth_headers, tid, m["id"])
        assert (
            client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json={}, headers=auth_headers).status_code == 200
        )
        final = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"][0]
        r = _withdraw(client, auth_headers, tid, final["team2_ids"][0], "forfeit")
        assert r.status_code == 200, r.text
        status = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert status["phase"] == "finished" and status["champion"] == final["team1"]
        # Someone who did not reach the play-offs cannot withdraw now.
        left_out = next(pid for name, pid in _ids(tid).items() if pid not in final["team1_ids"] + final["team2_ids"])
        assert _preview(client, auth_headers, tid, left_out).status_code == 409

    def test_preview_reports_each_matchs_decider(self, client, auth_headers) -> None:
        tid = _create_gp(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"set_decider": "full_set", "score_mode": {"gp-group": "sets"}},
            headers=auth_headers,
        )
        mine = _a_matches(client, tid)
        for m in mine[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        a = _ids(tid)["A"]
        p = _preview(client, auth_headers, tid, a).json()
        assert p["deciders_needed"] == ["full_set"]
        assert p["walkover_matches"][0]["decider"] == "full_set"
        # The one pending match overrides the default with a match tie-break.
        t = state_mod._tournaments[tid]["tournament"]
        pending = next(m for m in t.groups[0].matches if m.id == mine[2]["id"])
        pending.format_override = MatchFormatOverride(decider=SetDecider.MATCH_TIEBREAK)
        p = _preview(client, auth_headers, tid, a).json()
        assert p["default_decider"] == "full_set"
        assert p["deciders_needed"] == ["match_tiebreak"]
        assert p["walkover_matches"][0]["decider"] == "match_tiebreak"
        assert p["walkover_matches"][0]["resulting_score"] == "6-0 6-0"
        # A full-set 3rd set breaks the per-match decider: rejected (the dialog catches it first).
        bad = {"sets": [[6, 3], [3, 6], [6, 4]]}
        assert _withdraw(client, auth_headers, tid, a, "walkover", bad).status_code == 422

    def test_points_mode_has_no_deciders(self, client, auth_headers) -> None:
        tid = _create_gp(client, auth_headers)
        for m in _a_matches(client, tid)[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        p = _preview(client, auth_headers, tid, _ids(tid)["A"]).json()
        assert p["deciders_needed"] == [] and p["walkover_matches"][0]["decider"] is None

    def test_status_flags_entries_whose_bracket_is_over(self, client, auth_headers) -> None:
        body = {**_GP_SINGLES, "top_per_group": 4}
        tid = _create_gp(client, auth_headers, body)
        for m in _gp_group_matches(client, tid):
            _rec_group(client, auth_headers, tid, m["id"])
        # Group stage: nothing is flagged.
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["withdraw_unavailable_ids"] == []
        r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json={"third_place": True}, headers=auth_headers)
        assert r.status_code == 200, r.text
        status = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert status["withdraw_unavailable_ids"] == []  # semi-finalists are all alive
        pending = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
        for m in pending:  # both semi-finals, team 1 wins
            rec = client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": m["id"], "score1": 6, "score2": 2},
                headers=auth_headers,
            )
            assert rec.status_code == 200, rec.text
        pending = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
        third = next(m for m in pending if "3rd" in m["round_label"])
        final = next(m for m in pending if m is not third)
        rec = client.post(
            f"/api/tournaments/{tid}/gp/record-playoff",
            json={"match_id": third["id"], "score1": 6, "score2": 2},
            headers=auth_headers,
        )
        assert rec.status_code == 200, rec.text
        status = client.get(f"/api/tournaments/{tid}/gp/status").json()
        # Both 3rd-place players are done; the finalists can still withdraw.
        assert sorted(status["withdraw_unavailable_ids"]) == sorted(third["team1_ids"] + third["team2_ids"])
        for pid in final["team1_ids"] + final["team2_ids"]:
            assert pid not in status["withdraw_unavailable_ids"]
            assert _preview(client, auth_headers, tid, pid).status_code == 200
        for pid in status["withdraw_unavailable_ids"]:
            assert _preview(client, auth_headers, tid, pid).status_code == 409

    def test_withdrawn_entries_stay_rejected_for_the_playoff_start(self, client, auth_headers) -> None:
        body = {**_GP_SINGLES, "top_per_group": 4}
        tid = _create_gp(client, auth_headers, body)
        for m in _gp_group_matches(client, tid):
            _rec_group(client, auth_headers, tid, m["id"])
        a = _ids(tid)["A"]
        assert _withdraw(client, auth_headers, tid, a, "walkover").status_code == 200
        rec = client.get(f"/api/tournaments/{tid}/gp/recommend-playoffs").json()["recommended_participants"]
        assert next(r for r in rec if r["player_id"] == a)["withdrawn"] is True
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={"advancing_player_ids": [r["player_id"] for r in rec]},
            headers=auth_headers,
        )
        assert r.status_code == 400, r.text

    def test_mexicano_playoffs_forfeit_and_delete_guard(self, client, auth_headers) -> None:
        r = client.post(
            "/api/tournaments/mexicano",
            json={"name": "Mex", "player_names": ["A", "B", "C", "D"], "court_names": ["C1"], "num_rounds": 1},
            headers=auth_headers,
        )
        tid = r.json()["id"]
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        a = _ids(tid)["A"]
        assert _preview(client, auth_headers, tid, a).status_code == 409  # rounds: use remove
        for m in client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"]:
            client.post(
                f"/api/tournaments/{tid}/mex/record",
                json={"match_id": m["id"], "score1": 20, "score2": 12},
                headers=auth_headers,
            )
        client.post(f"/api/tournaments/{tid}/mex/end", headers=auth_headers)
        r = client.post(f"/api/tournaments/{tid}/mex/start-playoffs", json={"n_teams": 4}, headers=auth_headers)
        assert r.status_code == 200, r.text
        assert client.delete(f"/api/tournaments/{tid}/players/{a}", headers=auth_headers).status_code == 409
        r = _withdraw(client, auth_headers, tid, a, "forfeit")
        assert r.status_code == 200, r.text
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        assert status["phase"] == "finished" and status["withdrawals"][0]["kind"] == "forfeit"
        assert a in status["withdrawals"][0]["member_ids"]


def test_hub_path_rows_carry_walkover() -> None:
    from backend.api.routes_player_space import _build_group_playoff_rows

    t = _gp_teams(4)
    for m in t.groups[0].matches:
        _win(t, m)
    t.start_playoffs()
    final = t.playoff_bracket._final_match()
    winner, quitter = final.team1[0].id, final.team2[0].id
    t.withdraw(quitter)
    names = {p.id: p.name for p in t.players}
    rows = _build_group_playoff_rows(t, winner, names, {}, winner, 0)
    assert rows and rows[-1].walkover is True
    # The Hub tooltip names the side that withdrew: the walkover loser.
    assert rows[-1].walkover_lost is False
    quitter_rows = _build_group_playoff_rows(t, quitter, names, {}, quitter, 0)
    assert quitter_rows[-1].walkover is True and quitter_rows[-1].walkover_lost is True


def test_hub_group_path_rows_flag_the_withdrawn_side() -> None:
    from backend.api.routes_player_space import _build_group_path_rows

    t = _gp_teams(3)
    first, second = _matches_of(t.groups[0], "p0")
    _win(t, first)
    t.withdraw("p0")
    assert second.walkover
    opponent = next(p.id for p in second.team1 + second.team2 if p.id != "p0")
    by_side = {pid: [r for r in _build_group_path_rows(t, pid) if r.walkover] for pid in ("p0", opponent)}
    assert [r.walkover_lost for r in by_side["p0"]] == [True]
    assert [r.walkover_lost for r in by_side[opponent]] == [False]


# ────────────────────────────────────────────────────────────────────────────
# Bracket image: strike through the walkover loser
# ────────────────────────────────────────────────────────────────────────────


def _render_with_strikes(t, monkeypatch):
    """Render *t*'s bracket image; return (png bytes, list of strike jobs drawn)."""
    from backend.api.helpers import _build_match_labels
    from backend.models import EliminationType
    from backend.viz import bracket_schema as bs

    seen: list = []
    real = bs._draw_strikes

    def spy(fig, ax, jobs):
        seen.extend(jobs)
        n_before = len(ax.lines)
        real(fig, ax, jobs)
        seen.append(("drawn", len(ax.lines) - n_before))

    monkeypatch.setattr(bs, "_draw_strikes", spy)
    br = t.bracket
    img = bs.render_playoff_schema(
        [" & ".join(p.name for p in team) for team in br.original_teams],
        EliminationType.DOUBLE if t.double_elimination else EliminationType.SINGLE,
        match_labels=_build_match_labels(br),
        third_place=bool(getattr(br, "third_place", False)),
    )
    return img, seen


class TestBracketImageStrike:
    def test_single_elimination_with_third_place(self, monkeypatch) -> None:
        t = _po(8, third_place=True)
        for m in list(t.bracket.pending_matches())[:4]:
            t.record_result(m.id, (6, 2))
        semis = t.bracket.pending_matches()
        t.withdraw(semis[0].team1[0].id)  # semi-final loser by walkover, so he also drops into the 3rd place
        img, seen = _render_with_strikes(t, monkeypatch)
        assert img[:8] == b"\x89PNG\r\n\x1a\n"
        jobs = [j for j in seen if j[0] != "drawn"]
        assert len(jobs) >= 1
        # Exactly one line (the loser's name) per struck node.
        assert all(len(j[1]) == 1 for j in jobs)
        assert [x for x in seen if x[0] == "drawn"][0][1] == len(jobs)

    def test_double_elimination_and_both_sides_withdrawn(self, monkeypatch) -> None:
        t = _po(4, double_elimination=True)
        a, b = (m for m in t.bracket.pending_matches())
        t.withdraw(a.team1[0].id)
        t.withdraw(a.team2[0].id)  # both sides of one first-round match withdrew
        img, seen = _render_with_strikes(t, monkeypatch)
        assert img[:4] == b"\x89PNG"
        jobs = [j for j in seen if j[0] != "drawn"]
        assert jobs and all(len(j[1]) == 1 for j in jobs)

    def test_label_data_names_the_loser_side_only(self) -> None:
        from backend.api.helpers import _build_match_labels
        from backend.viz.bracket_schema import _strike_lines

        t = _po(4)
        m = t.bracket.pending_matches()[0]
        t.withdraw(m.team2[0].id)
        entry = next(v for v in _build_match_labels(t.bracket).values() if v["score"] == "W/O")
        assert entry["walkover_loser"] == "team2"
        assert _strike_lines(entry) == [2]  # team1 / score / team2
        assert _strike_lines({**entry, "walkover_loser": "team1"}) == [0]
        assert _strike_lines({"team1": "A", "team2": "B", "score": "6-2"}) == []
        # A two-line name shifts the second side's line index.
        assert _strike_lines({"team1": "A\nB", "team2": "C", "walkover_loser": "team2"}) == [3]
