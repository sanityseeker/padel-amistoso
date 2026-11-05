"""Clearing a match result: POST /api/tournaments/{tid}/matches/{mid}/clear."""

from __future__ import annotations

import pytest

import backend.api.db as db_mod
from backend.api import state as state_mod
from backend.api.elo_store import get_tournament_elos
from tests.test_club_elo import (
    _log,
    _make_club,
    _new_tournament,
    _persist_tournaments,  # noqa: F401 — autouse fixture: club ELO reads persisted rows
    _play_rounds,
)

_GP_TEAMS = {
    "name": "Clear Cup",
    "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
    "team_mode": True,
    "court_names": ["Court 1", "Court 2"],
    "num_groups": 2,
    "top_per_group": 2,
}
_GP_INDIVIDUAL = {**_GP_TEAMS, "team_mode": False}


def _create_gp(client, auth_headers, body=None) -> str:
    r = client.post("/api/tournaments/group-playoff", json=body or _GP_TEAMS, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _group_matches(client, tid) -> list[dict]:
    groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
    return [m for ms in groups["matches"].values() for m in ms]


def _record_group(client, auth_headers, tid, mid, s1=6, s2=3):
    return client.post(
        f"/api/tournaments/{tid}/gp/record-group",
        json={"match_id": mid, "score1": s1, "score2": s2},
        headers=auth_headers,
    )


def _record_all_groups(client, auth_headers, tid):
    for m in _group_matches(client, tid):
        if m["status"] != "completed":
            assert _record_group(client, auth_headers, tid, m["id"]).status_code == 200


def _clear(client, tid, mid, headers):
    return client.post(f"/api/tournaments/{tid}/matches/{mid}/clear", headers=headers)


def _elo_rows(tid: str) -> int:
    with db_mod.get_db() as conn:
        return conn.execute("SELECT COUNT(*) FROM player_elo_log WHERE tournament_id = ?", (tid,)).fetchone()[0]


class TestGroupClear:
    def test_clear_reverts_standings_and_elo_for_the_only_match(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        seeded = dict(get_tournament_elos(tid, "padel"))
        m = _group_matches(client, tid)[0]
        assert _record_group(client, auth_headers, tid, m["id"]).status_code == 200
        assert _elo_rows(tid) > 0
        assert get_tournament_elos(tid, "padel") != seeded

        r = _clear(client, tid, m["id"], auth_headers)
        assert r.status_code == 200, r.text
        assert r.json() == {"ok": True, "phase": "groups"}
        assert _elo_rows(tid) == 0
        assert get_tournament_elos(tid, "padel") == seeded
        after = next(x for x in _group_matches(client, tid) if x["id"] == m["id"])
        assert after["status"] == "scheduled" and not after.get("score1")
        standings = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert standings["phase"] == "groups"

    def test_score_history_gets_an_admin_clear_entry(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        m = _group_matches(client, tid)[0]
        _record_group(client, auth_headers, tid, m["id"])
        _clear(client, tid, m["id"], auth_headers)
        match = next(x for g in state_mod._tournaments[tid]["tournament"].groups for x in g.matches if x.id == m["id"])
        entry = match.score_history[-1]
        assert entry["action"] == "admin_clear" and entry["score"] == [6, 3]
        assert entry["player_id"] == "admin"

    def test_clearing_an_unplayed_match_is_409(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        m = _group_matches(client, tid)[0]
        assert _clear(client, tid, m["id"], auth_headers).status_code == 409

    def test_unknown_match_is_404(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        assert _clear(client, tid, "nope", auth_headers).status_code == 404

    def test_anonymous_and_non_editor_are_rejected(self, client, auth_headers, alice_headers):
        tid = _create_gp(client, auth_headers)
        m = _group_matches(client, tid)[0]
        _record_group(client, auth_headers, tid, m["id"])
        assert client.post(f"/api/tournaments/{tid}/matches/{m['id']}/clear").status_code == 401
        assert _clear(client, tid, m["id"], alice_headers).status_code == 403

    def test_conflict_once_playoffs_started(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        _record_all_groups(client, auth_headers, tid)
        m = _group_matches(client, tid)[0]
        assert client.post(f"/api/tournaments/{tid}/gp/start-playoffs", headers=auth_headers).status_code == 200
        assert _clear(client, tid, m["id"], auth_headers).status_code == 409

    def test_individual_mode_only_latest_round(self, client, auth_headers):
        tid = _create_gp(client, auth_headers, _GP_INDIVIDUAL)
        first = _group_matches(client, tid)
        for m in first:
            _record_group(client, auth_headers, tid, m["id"])
        assert client.post(f"/api/tournaments/{tid}/gp/next-group-round", headers=auth_headers).status_code == 200
        r = _clear(client, tid, first[0]["id"], auth_headers)
        assert r.status_code == 409


class TestPlayoffClear:
    def _po(self, client, auth_headers, n=4, **extra) -> str:
        r = client.post(
            "/api/tournaments/playoff",
            json={"participant_names": [f"T{i}" for i in range(n)], "court_names": ["C1"], **extra},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def _matches(self, client, tid):
        return client.get(f"/api/tournaments/{tid}/po/playoffs").json()["matches"]

    def _record(self, client, auth_headers, tid, mid):
        r = client.post(
            f"/api/tournaments/{tid}/po/record",
            json={"match_id": mid, "score1": 6, "score2": 2},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

    def test_semi_clear_then_blocked_after_final_and_finished(self, client, auth_headers):
        tid = self._po(client, auth_headers)
        semis = [m for m in self._matches(client, tid) if m["round_label"] == "Semi-Final"]
        self._record(client, auth_headers, tid, semis[0]["id"])
        assert _clear(client, tid, semis[0]["id"], auth_headers).status_code == 200
        for s in semis:
            self._record(client, auth_headers, tid, s["id"])
        final = next(m for m in self._matches(client, tid) if m["round_label"] == "Final")
        # The final was not played: semis can still be cleared; once it is, they cannot.
        self._record(client, auth_headers, tid, final["id"])
        r = _clear(client, tid, semis[0]["id"], auth_headers)
        assert r.status_code == 409
        # Tournament is finished now.
        r = _clear(client, tid, final["id"], auth_headers)
        assert r.status_code == 409
        assert "Finished" in r.json()["detail"]

    def test_semi_clear_empties_third_place_slot(self, client, auth_headers):
        tid = self._po(client, auth_headers, third_place=True)
        semi = next(m for m in self._matches(client, tid) if m["round_label"] == "Semi-Final")
        self._record(client, auth_headers, tid, semi["id"])
        assert _clear(client, tid, semi["id"], auth_headers).status_code == 200
        t = state_mod._tournaments[tid]["tournament"]
        tp = t.bracket.third_place_match
        assert not tp.team1 and not tp.team2

    def test_espejo_re_seeds_after_clear(self, client, auth_headers):
        tid = self._po(client, auth_headers, espejo=True)
        t = state_mod._tournaments[tid]["tournament"]
        r1 = [m for m in t.bracket.winners_bracket.matches if m.round_number == 1]
        for m in r1:
            self._record(client, auth_headers, tid, m.id)
        assert t.bracket.losers_bracket is not None
        assert _clear(client, tid, r1[-1].id, auth_headers).status_code == 200
        assert t.bracket.losers_bracket is None
        self._record(client, auth_headers, tid, r1[-1].id)
        assert t.bracket.losers_bracket is not None

    def test_espejo_blocked_when_losers_match_played(self, client, auth_headers):
        tid = self._po(client, auth_headers, espejo=True)
        t = state_mod._tournaments[tid]["tournament"]
        r1 = [m for m in t.bracket.winners_bracket.matches if m.round_number == 1]
        for m in r1:
            self._record(client, auth_headers, tid, m.id)
        self._record(client, auth_headers, tid, t.bracket.losers_bracket.matches[0].id)
        assert _clear(client, tid, r1[0].id, auth_headers).status_code == 409


class TestMexicanoClear:
    def _setup(self, client, auth_headers):
        r = client.post(
            "/api/tournaments/mexicano",
            json={"player_names": ["A", "B", "C", "D"], "court_names": ["C1"], "num_rounds": 3},
            headers=auth_headers,
        )
        tid = r.json()["id"]
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        m = client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"][0]
        return tid, m

    def _record(self, client, auth_headers, tid, mid):
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": mid, "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

    def test_clear_restores_leaderboard(self, client, auth_headers):
        tid, m = self._setup(client, auth_headers)
        before = client.get(f"/api/tournaments/{tid}/mex/status").json()["leaderboard"]
        self._record(client, auth_headers, tid, m["id"])
        assert _clear(client, tid, m["id"], auth_headers).status_code == 200
        assert client.get(f"/api/tournaments/{tid}/mex/status").json()["leaderboard"] == before
        assert _elo_rows(tid) == 0

    def test_previous_round_blocked(self, client, auth_headers):
        tid, m = self._setup(client, auth_headers)
        self._record(client, auth_headers, tid, m["id"])
        assert client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers).status_code == 200
        assert _clear(client, tid, m["id"], auth_headers).status_code == 409

    def test_disputed_match_is_reset(self, client, auth_headers):
        tid, m = self._setup(client, auth_headers)
        self._record(client, auth_headers, tid, m["id"])
        match = state_mod._tournaments[tid]["tournament"].rounds[-1][0]
        match.disputed = True
        match.dispute_score = (10, 22)
        match.dispute_by = "x"
        assert _clear(client, tid, m["id"], auth_headers).status_code == 200
        assert not match.disputed and match.dispute_score is None and match.dispute_by is None

    def test_pending_score_can_be_cleared(self, client, auth_headers):
        tid, m = self._setup(client, auth_headers)
        match = state_mod._tournaments[tid]["tournament"].rounds[-1][0]
        state_mod._tournaments[tid]["tournament"].store_pending_score(match.id, (20, 12))
        assert _clear(client, tid, m["id"], auth_headers).status_code == 200
        assert match.score is None

    def test_blocked_while_ended(self, client, auth_headers):
        tid, m = self._setup(client, auth_headers)
        self._record(client, auth_headers, tid, m["id"])
        state_mod._tournaments[tid]["tournament"].end_mexicano()
        assert _clear(client, tid, m["id"], auth_headers).status_code == 409


class TestClubClear:
    def test_club_rows_disappear_and_leaderboard_reverts(self, client, auth_headers):
        _make_club("kc")
        tid, ids = _new_tournament(client, auth_headers, "kc")
        _play_rounds(client, auth_headers, tid, "Alice")
        assert _log(tid, ids["Alice"])
        match = state_mod._tournaments[tid]["tournament"].rounds[-1]
        for m in match:
            assert _clear(client, tid, m.id, auth_headers).status_code == 200
        assert _log(tid, ids["Alice"]) == []
        with db_mod.get_db() as conn:
            n = conn.execute(
                "SELECT COUNT(*) FROM player_elo_log WHERE tournament_id = ? AND club_elo_after IS NOT NULL", (tid,)
            ).fetchone()[0]
        assert n == 0
        board = client.get(f"/api/tournaments/{tid}/mex/status").json()["leaderboard"]
        assert all(e["total_points"] == 0 for e in board)


@pytest.mark.parametrize(
    "key", ["txt_match_clear_btn", "txt_match_clear_title", "txt_match_clear_confirm", "txt_match_clear_done"]
)
def test_clear_i18n_keys_exist_in_both_languages(key):
    from pathlib import Path

    src = (Path(__file__).resolve().parents[1] / "frontend" / "i18n.js").read_text()
    assert src.count(f'"{key}"') == 2
