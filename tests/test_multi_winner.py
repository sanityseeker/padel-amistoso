"""Multi-winner single elimination + optional third-place match (engine level)."""

from __future__ import annotations

import math
import pickle

import pytest

from backend.models import MatchStatus, Player, POPhase
from backend.tournaments.playoff import (
    THIRD_PLACE_LABEL,
    EspejoParallelBracket,
    SingleEliminationBracket,
    valid_num_winners,
    validate_num_winners,
)
from backend.tournaments.playoff_tournament import PlayoffTournament


def _teams(n: int) -> list[list[Player]]:
    return [[Player(name=f"T{i}")] for i in range(n)]


def _play_all(bracket, *, limit: int = 200) -> None:
    """Play every ready match; the lower seed index (team1 side) always wins 6-3."""
    for _ in range(limit):
        pending = bracket.pending_matches()
        if not pending:
            return
        for m in pending:
            bracket.record_result(m.id, (6, 3))
    raise AssertionError("bracket did not terminate")


def _names(teams) -> list[str]:
    return [t[0].name for t in teams]


def _expected_matches(n: int, nw: int) -> int:
    """Real (non-bye) matches in a bracket truncated for *nw* winners."""
    size = 1 << (n - 1).bit_length()
    depth = int(math.log2(size))
    cut = 1 if nw == 3 else int(math.log2(nw))
    rounds = depth - cut
    total = 0
    cur = size // 2 + 0
    # round 0 real matches = pairs where both slots are filled
    r0 = n - size // 2
    total += r0
    cur = size // 2
    for _ in range(1, rounds):
        cur //= 2
        total += cur
    return total


@pytest.mark.parametrize(
    ("n", "nw"),
    [(n, nw) for n in (4, 5, 6, 8, 16) for nw in (2, 3, 4) if nw == 3 or nw <= (1 << (n - 1).bit_length()) // 2],
)
def test_truncated_bracket_shape_and_winners(n, nw):
    third = nw == 3
    b = SingleEliminationBracket(_teams(n), num_winners=nw, third_place=third)
    real = [m for m in b.matches if m.round_label != THIRD_PLACE_LABEL]
    assert len(real) == _expected_matches(n, nw)
    assert (b.third_place_match is not None) == third
    last_round = max(m.round_number for m in real)
    labels = {m.round_label for m in real if m.round_number == last_round}
    expected_label = {2: "Semi-Final", 3: "Semi-Final", 4: "Quarter-Final"}[nw]
    assert labels == {expected_label}
    assert b.winners() is None or all(m.status == MatchStatus.COMPLETED for m in real)

    _play_all(b)
    winners = b.winners()
    assert winners is not None and len(winners) == nw
    assert b.champion() is None
    # Everyone wins as the higher seed (team1 wins), ordered by original seed.
    seeds = [int(w[0].name[1:]) for w in winners]
    assert seeds == sorted(seeds)


def test_winners_none_until_all_cutoff_slots_decided():
    b = SingleEliminationBracket(_teams(8), num_winners=2)
    first, *rest = b.pending_matches()
    b.record_result(first.id, (6, 1))
    assert b.winners() is None
    for m in rest:
        b.record_result(m.id, (6, 1))
    # semis are not played yet at 8 teams / N=2 (quarter-finals first)
    assert b.winners() is None
    _play_all(b)
    assert len(b.winners()) == 2


def test_byes_count_as_winners_immediately_six_teams_n4():
    t = PlayoffTournament(_teams(6), num_winners=4)
    b = t.bracket
    # Seeds 0 and 1 have byes and are winners straight away; two real matches decide the rest.
    assert len([m for m in b.matches]) == 2
    assert t.phase == POPhase.PLAYOFFS and t.winners() is None
    m1, m2 = t.pending_matches()
    t.record_result(m1.id, (6, 2))
    assert t.phase == POPhase.PLAYOFFS
    t.record_result(m2.id, (2, 6))
    assert t.phase == POPhase.FINISHED
    names = _names(t.winners())
    assert len(names) == 4 and "T0" in names and "T1" in names
    assert t.champion() is None


def test_phase_flips_only_after_cutoff():
    t = PlayoffTournament(_teams(8), num_winners=2)
    assert t.phase == POPhase.PLAYOFFS
    while t.pending_matches():
        assert t.phase == POPhase.PLAYOFFS
        t.record_result(t.pending_matches()[0].id, (6, 0))
    assert t.phase == POPhase.FINISHED
    assert _names(t.winners()) == ["T0", "T1"]


class TestValidation:
    def test_helpers(self):
        assert valid_num_winners(8) == [1, 2, 3, 4]
        assert valid_num_winners(4) == [1, 2, 3]
        assert valid_num_winners(3) == [1, 2]
        assert valid_num_winners(6) == [1, 2, 3, 4]
        assert valid_num_winners(2) == [1]

    @pytest.mark.parametrize(
        ("n", "nw", "third"),
        [
            (3, 3, True),  # N=3 needs 4 teams
            (4, 4, False),  # too large
            (8, 8, False),
            (8, 3, False),  # N=3 needs the third place match
            (8, 5, False),  # not a power of two
            (8, 2, True),  # third place only with 1 or 3
            (3, 1, True),  # third place needs 4 teams
            (8, 0, False),
        ],
    )
    def test_invalid(self, n, nw, third):
        with pytest.raises(ValueError):
            validate_num_winners(n, nw, third)
        with pytest.raises(ValueError):
            SingleEliminationBracket(_teams(n), num_winners=nw, third_place=third)

    def test_multi_winner_rejected_for_double_elim_and_espejo(self):
        with pytest.raises(ValueError):
            PlayoffTournament(_teams(8), double_elimination=True, num_winners=2)
        with pytest.raises(ValueError):
            PlayoffTournament(_teams(8), espejo=True, num_winners=2)
        with pytest.raises(ValueError):
            PlayoffTournament(_teams(8), double_elimination=True, third_place=True)


class TestThirdPlace:
    def test_single_elim_n1_finishes_only_after_third_place(self):
        t = PlayoffTournament(_teams(4), third_place=True)
        tp = t.bracket.third_place_match
        assert tp is not None and tp.round_label == THIRD_PLACE_LABEL
        semis = t.pending_matches()
        assert len(semis) == 2
        for s in semis:
            t.record_result(s.id, (6, 1))
        # semi losers are in the 3rd-place match, final is ready
        assert {p.name for p in tp.team1 + tp.team2} == {"T3", "T2"}
        pend = {m.round_label for m in t.pending_matches()}
        assert pend == {"Final", THIRD_PLACE_LABEL}
        final = next(m for m in t.pending_matches() if m.round_label == "Final")
        t.record_result(final.id, (6, 0))
        assert t.phase == POPhase.PLAYOFFS and t.champion() is None
        assert t.bracket.champion() is not None  # final winner is known
        t.record_result(tp.id, (6, 4))
        assert t.phase == POPhase.FINISHED
        assert _names(t.winners()) == ["T0"]
        assert t.champion()[0].name == "T0"
        assert t.bracket.third_place_team()[0].name == "T3"

    def test_n3_has_no_final(self):
        t = PlayoffTournament(_teams(8), num_winners=3, third_place=True)
        labels = {m.round_label for m in t.all_matches()}
        assert "Final" not in labels and THIRD_PLACE_LABEL in labels
        while t.pending_matches():
            assert t.phase == POPhase.PLAYOFFS
            t.record_result(t.pending_matches()[0].id, (6, 0))
        assert t.phase == POPhase.FINISHED
        w = _names(t.winners())
        assert len(w) == 3
        assert t.champion() is None

    def test_espejo_third_place_in_winners_bracket(self):
        t = PlayoffTournament(_teams(8), espejo=True, third_place=True)
        wb = t.bracket.winners_bracket
        assert wb.third_place_match is not None
        guard = 0
        while t.pending_matches() and guard < 100:
            guard += 1
            pend = t.pending_matches()
            # Play the third-place match last to prove the Espejo waits for it.
            non_tp = [m for m in pend if m.round_label != THIRD_PLACE_LABEL]
            t.record_result((non_tp or pend)[0].id, (6, 2))
            if wb.champion() is not None and wb.third_place_match.status != MatchStatus.COMPLETED:
                assert t.phase == POPhase.PLAYOFFS
        assert t.phase == POPhase.FINISHED
        assert t.champion()[0].name == "T0"

    def test_third_place_court_assignment(self):
        from backend.models import Court

        t = PlayoffTournament(_teams(4), courts=[Court(name="A"), Court(name="B"), Court(name="C")], third_place=True)
        for s in t.pending_matches():
            t.record_result(s.id, (6, 1))
        assert all(m.court is not None for m in t.pending_matches())


def test_legacy_pickle_without_new_attrs():
    b = SingleEliminationBracket(_teams(4))
    # Simulate an object pickled before the attributes existed.
    for attr in ("num_winners", "third_place", "third_place_match", "_winner_slots", "_loser_next", "_final_id"):
        b.__dict__.pop(attr, None)
    b = pickle.loads(pickle.dumps(b))
    assert b.winners() is None
    _play_all(b)
    assert b.champion() is not None
    assert len(b.winners()) == 1
    t = PlayoffTournament(_teams(4))
    for attr in ("num_winners", "third_place"):
        t.__dict__.pop(attr, None)
    t.bracket = b
    assert t.phase == POPhase.FINISHED


def test_espejo_default_unchanged():
    e = EspejoParallelBracket(_teams(4))
    assert e.winners_bracket.third_place_match is None


# ═══════════════════════════════════════════════════════════════════════════════
# API level
# ═══════════════════════════════════════════════════════════════════════════════


def _po_body(n: int, **extra) -> dict:
    return {
        "name": "MW",
        "participant_names": [f"P{i}" for i in range(n)],
        "court_names": ["Court 1", "Court 2"],
        "team_mode": True,
        **extra,
    }


def _play_po(client, auth_headers, tid) -> None:
    for _ in range(100):
        pending = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"]
        if not pending:
            return
        r = client.post(
            f"/api/tournaments/{tid}/po/record",
            json={"match_id": pending[0]["id"], "score1": 6, "score2": 3},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
    raise AssertionError("did not terminate")


def _play_po_all_espejo(client, auth_headers, tid) -> None:
    _play_po(client, auth_headers, tid)


class TestPlayoffAPIMultiWinner:
    def test_two_winners_flow(self, client, auth_headers, monkeypatch):
        import backend.api.routes_playoff as po_mod

        finished: list[str] = []
        pushes: list[list[list[str]]] = []
        monkeypatch.setattr(po_mod, "elo_finish_tournament", lambda tid: finished.append(tid))
        monkeypatch.setattr(po_mod, "notify_winners", lambda tid, data, teams: pushes.append(teams))
        r = client.post("/api/tournaments/playoff", json=_po_body(8, num_winners=2), headers=auth_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["num_winners"] == 2 and st["winners"] is None and st["champion"] is None
        _play_po(client, auth_headers, tid)
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["phase"] == "finished"
        assert st["winners"] == [["P0"], ["P1"]]
        assert st["champion"] is None
        assert client.get(f"/api/tournaments/{tid}/po/playoffs").json()["winners"] == [["P0"], ["P1"]]
        assert finished == [tid] and pushes == [[["P0"], ["P1"]]]
        # Truncated: 4 quarter-finals + 2 semi-finals only.
        matches = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["matches"]
        assert len(matches) == 6 and "Final" not in {m["round_label"] for m in matches}

    def test_single_winner_unchanged(self, client, auth_headers):
        tid = client.post("/api/tournaments/playoff", json=_po_body(4), headers=auth_headers).json()["id"]
        _play_po(client, auth_headers, tid)
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["phase"] == "finished"
        assert st["champion"] == ["P0"] and st["winners"] == [["P0"]] and st["num_winners"] == 1

    def test_third_place_flow_and_diagram(self, client, auth_headers):
        tid = client.post("/api/tournaments/playoff", json=_po_body(4, third_place=True), headers=auth_headers).json()[
            "id"
        ]
        labels = {m["round_label"] for m in client.get(f"/api/tournaments/{tid}/po/playoffs").json()["matches"]}
        assert "3rd Place" in labels
        r = client.get(f"/api/tournaments/{tid}/po/playoffs-schema?fmt=png")
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/png")
        _play_po(client, auth_headers, tid)
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["phase"] == "finished" and st["champion"] == ["P0"] and st["third_place"] is True

    def test_n3_flow(self, client, auth_headers):
        body = _po_body(8, num_winners=3, third_place=True)
        tid = client.post("/api/tournaments/playoff", json=body, headers=auth_headers).json()["id"]
        _play_po(client, auth_headers, tid)
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["phase"] == "finished" and len(st["winners"]) == 3 and st["champion"] is None
        assert client.get(f"/api/tournaments/{tid}/po/playoffs-schema?fmt=svg").status_code == 200

    @pytest.mark.parametrize(
        "extra",
        [
            {"num_winners": 3},
            {"num_winners": 8},
            {"num_winners": 2, "double_elimination": True},
            {"num_winners": 2, "espejo": True},
            {"num_winners": 5},
        ],
    )
    def test_invalid_options_rejected(self, client, auth_headers, extra):
        n = 4 if extra.get("num_winners") == 8 else 8
        r = client.post("/api/tournaments/playoff", json=_po_body(n, **extra), headers=auth_headers)
        assert r.status_code in (400, 422), r.text

    def test_n3_needs_four_teams(self, client, auth_headers):
        r = client.post(
            "/api/tournaments/playoff", json=_po_body(3, num_winners=3, third_place=True), headers=auth_headers
        )
        assert r.status_code == 400

    def test_espejo_third_place(self, client, auth_headers):
        r = client.post(
            "/api/tournaments/playoff", json=_po_body(8, espejo=True, third_place=True), headers=auth_headers
        )
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        # Like every Espejo match, the 3rd-place match is listed once one of its teams is known.
        tp: list[dict] = []
        for _ in range(30):
            matches = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["matches"]
            tp = [m for m in matches if m["round_label"] == "3rd Place"]
            if tp:
                break
            m = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"][0]
            client.post(
                f"/api/tournaments/{tid}/po/record",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
        assert len(tp) == 1 and tp[0]["bracket_side"] == "winners"
        _play_po_all_espejo(client, auth_headers, tid)
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["phase"] == "finished" and st["champion"] == ["P0"]

    def test_schema_previews_truncated(self, client):
        r = client.get("/api/schema/playoff-preview?participants=8&num_winners=2&fmt=png")
        assert r.status_code == 200
        assert (
            client.get("/api/schema/playoff-preview?participants=8&num_winners=3&third_place=true").status_code == 200
        )
        assert client.get("/api/schema/playoff-preview?participants=8&num_winners=3").status_code == 400


class TestGroupPlayoffAPIMultiWinner:
    def _setup(self, client, auth_headers, *, team_mode: bool, n=8, top=2):
        body = {
            "name": "GPMW",
            "player_names": [f"P{i}" for i in range(n)],
            "team_mode": team_mode,
            "court_names": ["Court 1", "Court 2"],
            "num_groups": 2,
            "top_per_group": top,
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        for _ in range(20):
            groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
            pending = [m for ms in groups["matches"].values() for m in ms if m["status"] != "completed"]
            for m in pending:
                client.post(
                    f"/api/tournaments/{tid}/gp/record-group",
                    json={"match_id": m["id"], "score1": 6, "score2": 3},
                    headers=auth_headers,
                )
            if not groups.get("has_more_rounds", False):
                break
            client.post(f"/api/tournaments/{tid}/gp/next-group-round", headers=auth_headers)
        return tid

    def _play(self, client, auth_headers, tid):
        for _ in range(100):
            pending = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
            if not pending:
                return
            r = client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": pending[0]["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text

    def test_team_mode_two_winners(self, client, auth_headers):
        tid = self._setup(client, auth_headers, team_mode=True, n=16, top=4)
        r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json={"num_winners": 4}, headers=auth_headers)
        assert r.status_code == 200, r.text
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["num_winners"] == 4 and st["winners"] is None
        self._play(client, auth_headers, tid)
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["phase"] == "finished" and len(st["winners"]) == 4 and st["champion"] is None

    def test_individual_mode_validates_after_pairing(self, client, auth_headers):
        # 8 individuals advance (top 4 per group) -> 4 teams. N=4 is too many for 4 teams; N=2 is fine.
        tid = self._setup(client, auth_headers, team_mode=False, n=8, top=4)
        bad = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json={"num_winners": 4}, headers=auth_headers)
        assert bad.status_code == 400
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["phase"] == "groups"
        ok = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json={"num_winners": 2}, headers=auth_headers)
        assert ok.status_code == 200, ok.text
        self._play(client, auth_headers, tid)
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["phase"] == "finished" and len(st["winners"]) == 2

    def test_third_place_and_double_elim_rejected(self, client, auth_headers):
        tid = self._setup(client, auth_headers, team_mode=True, n=8, top=2)
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={"num_winners": 2, "double_elimination": True},
            headers=auth_headers,
        )
        assert r.status_code == 400
        r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json={"third_place": True}, headers=auth_headers)
        assert r.status_code == 200, r.text
        self._play(client, auth_headers, tid)
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["phase"] == "finished" and st["champion"] is not None


# ═══════════════════════════════════════════════════════════════════════════════
# History, push, mexicano regression, banner
# ═══════════════════════════════════════════════════════════════════════════════


def test_history_stage_winner_for_co_winners():
    from backend.api.player_secret_store import extract_history_stats

    t = PlayoffTournament(_teams(8), num_winners=2)
    while t.pending_matches():
        t.record_result(t.pending_matches()[0].id, (6, 0))
    stats = extract_history_stats({"type": "playoff", "tournament": t})
    winners = {p.id for team in t.winners() for p in team}
    assert len(winners) == 2
    for pid in winners:
        assert stats[pid]["playoff_stage"] == "Winner"
        assert stats[pid]["playoff_stage_rank"] == 0
        assert stats[pid]["rank"] == 1


def test_history_stage_champion_and_third_place():
    from backend.api.player_secret_store import extract_history_stats

    t = PlayoffTournament(_teams(4), third_place=True)
    while t.pending_matches():
        t.record_result(t.pending_matches()[0].id, (6, 0))
    stats = extract_history_stats({"type": "playoff", "tournament": t})
    assert stats[t.champion()[0].id]["playoff_stage"] == "Champion"
    third = t.bracket.third_place_team()[0]
    assert stats[third.id]["playoff_stage"] == "3rd Place"


def test_notify_winners_text():
    from unittest.mock import patch

    from backend.api.push_events import notify_champion, notify_winners

    with patch("backend.api.push_events.send_push_to_tournament") as send:
        notify_winners("t1", {"name": "Cup"}, [["A", "B"], ["C", "D"]])
        assert send.call_args.kwargs["body"] == "Tournament finished! Winners: A & B; C & D"
        notify_champion("t1", {"name": "Cup"}, ["A", "B"])
        assert send.call_args.kwargs["body"] == "Tournament finished! Champion: A & B"


def test_tournament_winners_helper_mexicano_fallback():
    from types import SimpleNamespace

    from backend.api.helpers import tournament_winners

    p = Player(name="X")
    assert tournament_winners(SimpleNamespace(champion=lambda: [p])) == [[p]]
    assert tournament_winners(SimpleNamespace(champion=lambda: None)) is None


class TestBannerTextarea:
    def _tid(self, client, auth_headers):
        return client.post("/api/tournaments/playoff", json=_po_body(4), headers=auth_headers).json()["id"]

    def test_multiline_round_trip(self, client, auth_headers):
        tid = self._tid(client, auth_headers)
        text = "Line one\nLine two\n\nLine four"
        r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"banner_text": text}, headers=auth_headers)
        assert r.status_code == 200, r.text
        assert client.get(f"/api/tournaments/{tid}/tv-settings").json()["banner_text"] == text

    def test_over_length_rejected(self, client, auth_headers):
        tid = self._tid(client, auth_headers)
        r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"banner_text": "x" * 5001}, headers=auth_headers)
        assert r.status_code == 422
        r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"banner_text": "x" * 5000}, headers=auth_headers)
        assert r.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Static frontend assertions
# ═══════════════════════════════════════════════════════════════════════════════


def _frontend(name: str) -> str:
    from pathlib import Path

    return (Path(__file__).resolve().parent.parent / "frontend" / name).read_text(encoding="utf-8")


def test_banner_is_autogrowing_textarea_with_buttons_below():
    js = _frontend("admin-tv-email.js")
    assert '<input type="text" id="tournament-banner-input"' not in js
    assert '<textarea id="tournament-banner-input" class="reg-desc-textarea' in js
    assert 'maxlength="5000"' in js
    assert "_autoResizeTextarea" in js
    area = js.index('<textarea id="tournament-banner-input"')
    assert area < js.index("_setTournamentBanner()") and area < js.index("_clearTournamentBanner()")


def test_tv_banner_keeps_newlines():
    css = _frontend("tv.css")
    block = css[css.index(".admin-banner {") :].split("}")[0]
    assert "white-space: pre-line" in block


def test_multi_winner_frontend_wiring():
    assert 'id="po-num-winners"' in _frontend("index.html") and 'id="po-third-place"' in _frontend("index.html")
    assert "num_winners" in _frontend("admin-gp.js") and "_gpReadWinnerControls('gp')" in _frontend("admin-gp.js")
    assert "_gpReadWinnerControls('po')" in _frontend("admin-create.js")
    assert "status.winners" in _frontend("tv.js")
    i18n = _frontend("i18n.js")
    for key in ("txt_num_winners", "txt_winner_word", "txt_winners_word", "txt_third_place_label"):
        assert i18n.count(f'"{key}"') == 2, key  # en + es
