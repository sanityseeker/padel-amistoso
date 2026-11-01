"""Tests for the per-match scoring-format override.

Covers ``PATCH /api/tournaments/{tid}/matches/{mid}/format`` (auth, validation,
409 rules, re-recording), serialisation, persistence and pickle back-compat.
"""

from __future__ import annotations

import pickle

from fastapi.testclient import TestClient

from backend.api import state as state_mod
from backend.models import InputFormat, Match, MatchFormatOverride, Player, SetDecider

# conftest stubs out ``_save_tournament`` for every test; keep a handle on the
# real one (captured at collection time, before fixtures run) for the
# SQLite round-trip test.
_REAL_SAVE_TOURNAMENT = state_mod._save_tournament

# ── Bodies and helpers ────────────────────────────────────────────────────────

_GP_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"],
    "num_groups": 2,
    "top_per_group": 2,
    "num_courts": 2,
}

_MEX_BODY = {
    "player_names": ["Alice", "Bob", "Carol", "Dave"],
    "court_names": ["Court 1"],
    "total_points_per_match": 32,
    "num_rounds": 2,
}

_PO_BODY = {
    "name": "Quick Play-off",
    "participant_names": ["Alice", "Bob", "Carol", "Dave"],
    "court_names": ["Court 1"],
    "double_elimination": False,
}


def _format_url(tid: str, mid: str) -> str:
    return f"/api/tournaments/{tid}/matches/{mid}/format"


def _create_gp(client: TestClient, headers: dict) -> tuple[str, dict]:
    r = client.post("/api/tournaments/group-playoff", json=_GP_BODY, headers=headers)
    assert r.status_code == 200
    tid = r.json()["id"]
    groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=headers).json()
    first = next(m for ms in groups["matches"].values() for m in ms)
    return tid, first


def _create_mex(client: TestClient, headers: dict) -> tuple[str, dict]:
    r = client.post("/api/tournaments/mexicano", json=_MEX_BODY, headers=headers)
    assert r.status_code == 200
    tid = r.json()["id"]
    client.post(f"/api/tournaments/{tid}/mex/next-round", headers=headers)
    match = client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"][0]
    return tid, match


def _create_po(client: TestClient, headers: dict) -> tuple[str, dict]:
    r = client.post("/api/tournaments/playoff", json=_PO_BODY, headers=headers)
    assert r.status_code == 200
    tid = r.json()["id"]
    pending = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"]
    return tid, pending[0]


def _mex_match(client: TestClient, tid: str, mid: str) -> dict:
    data = client.get(f"/api/tournaments/{tid}/mex/matches").json()
    return next(m for m in data["all_matches"] if m["id"] == mid)


def _player_headers(client: TestClient, tid: str, auth_headers: dict, player_id: str) -> dict[str, str]:
    secrets = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
    r = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": secrets[player_id]["passphrase"]})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ── Auth ──────────────────────────────────────────────────────────────────────


class TestAuth:
    """Only organisers with editor access may change a match format."""

    def test_anonymous_gets_401(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"mode": "sets"}})
        assert r.status_code == 401

    def test_player_token_is_rejected(self, client: TestClient, auth_headers: dict) -> None:
        """A player passphrase JWT must never be able to change a target."""
        tid, m = _create_mex(client, auth_headers)
        headers = _player_headers(client, tid, auth_headers, m["team1_ids"][0])
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=headers)
        assert r.status_code in (401, 403)
        assert _mex_match(client, tid, m["id"])["format_override"] is None

    def test_non_editor_gets_403(self, client: TestClient, auth_headers: dict, bob_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"mode": "sets"}}, headers=bob_headers)
        assert r.status_code == 403

    def test_owner_gets_200(self, client: TestClient, alice_headers: dict) -> None:
        tid, m = _create_gp(client, alice_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"mode": "sets"}}, headers=alice_headers)
        assert r.status_code == 200

    def test_co_editor_gets_200(self, client: TestClient, alice_headers: dict, bob_headers: dict) -> None:
        tid, m = _create_gp(client, alice_headers)
        client.post(f"/api/tournaments/{tid}/collaborators", json={"username": "bob"}, headers=alice_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"mode": "sets"}}, headers=bob_headers)
        assert r.status_code == 200


# ── Validation ────────────────────────────────────────────────────────────────


class TestValidation:
    def test_unknown_match_404(self, client: TestClient, auth_headers: dict) -> None:
        tid, _m = _create_gp(client, auth_headers)
        r = client.patch(_format_url(tid, "nope"), json={"override": {"mode": "sets"}}, headers=auth_headers)
        assert r.status_code == 404

    def test_sets_on_mexicano_round_400(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"mode": "sets"}}, headers=auth_headers)
        assert r.status_code == 400

    def test_points_target_on_gp_400(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        assert r.status_code == 400

    def test_points_target_on_playoff_400(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_po(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        assert r.status_code == 400

    def test_decider_on_mexicano_round_400(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        r = client.patch(
            _format_url(tid, m["id"]), json={"override": {"decider": "match_tiebreak"}}, headers=auth_headers
        )
        assert r.status_code == 400

    def test_unknown_decider_422(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"decider": "coin_toss"}}, headers=auth_headers)
        assert r.status_code == 422

    def test_points_target_out_of_range_422(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 1}}, headers=auth_headers)
        assert r.status_code == 422


# ── Set / clear ───────────────────────────────────────────────────────────────


class TestSetAndClear:
    def test_set_then_clear_mode_on_gp(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"mode": "sets"}}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["match"]["format_override"] == {"mode": "sets", "points_target": None, "decider": None}

        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        served = next(x for ms in groups["matches"].values() for x in ms if x["id"] == m["id"])
        assert served["format_override"]["mode"] == "sets"
        # Audit fields never leak into public payloads.
        assert "set_by" not in served["format_override"]

        r = client.patch(_format_url(tid, m["id"]), json={"override": None}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["match"]["format_override"] is None

    def test_all_none_override_stores_none(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"mode": None}}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["match"]["format_override"] is None

    def test_mex_pending_target_and_effective_target(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        assert m["effective_points_target"] == 32
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        assert r.status_code == 200
        served = _mex_match(client, tid, m["id"])
        assert served["format_override"]["points_target"] == 24
        assert served["effective_points_target"] == 24

    def test_target_equal_to_total_clears_override(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 32}}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["match"]["format_override"] is None

    def test_mode_allowed_on_completed_playoff_match(self, client: TestClient, auth_headers: dict) -> None:
        """Completed bracket matches are found (``_find_match_full``) and mode changes freely."""
        tid, m = _create_po(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/po/record",
            json={"match_id": m["id"], "score1": 6, "score2": 3},
            headers=auth_headers,
        )
        assert r.status_code == 200
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"mode": "sets"}}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["match"]["score"] == [6, 3]

    def test_history_records_format_override(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        client.patch(_format_url(tid, m["id"]), json={"override": {"mode": "sets"}}, headers=auth_headers)
        hist = client.get(f"/api/tournaments/{tid}/matches/{m['id']}/history", headers=auth_headers).json()
        entry = next(e for e in hist["history"] if e["action"] == "format_override")
        assert entry["override"]["mode"] == "sets"


# ── Completed / disputed matches ──────────────────────────────────────────────


class TestScoredMatches:
    def test_pending_mex_override_then_record(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        bad = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        assert bad.status_code == 400
        assert "24" in bad.json()["detail"]
        ok = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 15, "score2": 9},
            headers=auth_headers,
        )
        assert ok.status_code == 200

    def test_completed_mex_target_change_without_score_409(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        assert r.status_code == 409
        assert _mex_match(client, tid, m["id"])["format_override"] is None

    def test_completed_mex_target_change_with_score_rerecords(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        r = client.patch(
            _format_url(tid, m["id"]),
            json={"override": {"points_target": 24}, "score1": 18, "score2": 6},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["match"]["score"] == [18, 6]

        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        board = {row["player_id"]: row for row in status["leaderboard"]}
        # 18 * 32/24 = 24, 6 * 32/24 = 8
        assert board[m["team1_ids"][0]]["total_points"] == 24
        assert board[m["team2_ids"][0]]["total_points"] == 8

        hist = client.get(f"/api/tournaments/{tid}/matches/{m['id']}/history", headers=auth_headers).json()
        assert "format_override" in [e["action"] for e in hist["history"]]

    def test_completed_mex_target_change_with_wrong_sum_400(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        r = client.patch(
            _format_url(tid, m["id"]),
            json={"override": {"points_target": 24}, "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        assert r.status_code == 400
        served = _mex_match(client, tid, m["id"])
        assert served["format_override"] is None
        assert served["score"] == [20, 12]

    def test_disputed_match_409(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings", json={"score_confirmation": "required"}, headers=auth_headers
        )
        h1 = _player_headers(client, tid, auth_headers, m["team1_ids"][0])
        h2 = _player_headers(client, tid, auth_headers, m["team2_ids"][0])
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=h1,
        )
        assert r.status_code == 200
        r = client.post(
            f"/api/tournaments/{tid}/matches/{m['id']}/correct",
            json={"match_id": m["id"], "score1": 12, "score2": 20},
            headers=h2,
        )
        assert r.status_code == 200
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        assert r.status_code == 409

    def test_pending_player_score_target_change_needs_score(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings", json={"score_confirmation": "required"}, headers=auth_headers
        )
        h1 = _player_headers(client, tid, auth_headers, m["team1_ids"][0])
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=h1,
        )
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        assert r.status_code == 409
        r = client.patch(
            _format_url(tid, m["id"]),
            json={"override": {"points_target": 24}, "score1": 15, "score2": 9},
            headers=auth_headers,
        )
        assert r.status_code == 200
        served = r.json()["match"]
        assert served["status"] == "completed"
        assert served["score_confirmed"] is True


# ── Persistence and back-compat ───────────────────────────────────────────────


class TestPersistence:
    def test_override_survives_reload_from_sqlite(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_mex(client, auth_headers)
        client.patch(_format_url(tid, m["id"]), json={"override": {"points_target": 24}}, headers=auth_headers)
        assert _REAL_SAVE_TOURNAMENT(tid) is True

        state_mod._tournaments.clear()
        state_mod._load_state()

        served = _mex_match(client, tid, m["id"])
        assert served["format_override"]["points_target"] == 24
        assert served["effective_points_target"] == 24

    def test_match_setstate_without_field_defaults_to_none(self) -> None:
        m = Match(team1=[Player(name="A")], team2=[Player(name="B")])
        state = m.__getstate__()
        del state["format_override"]
        fresh = Match.__new__(Match)
        fresh.__setstate__(state)
        assert fresh.format_override is None

    def test_old_blob_unpickles_through_restricted_unpickler(self) -> None:
        m = Match(team1=[Player(name="A")], team2=[Player(name="B")])
        del m.__dict__["format_override"]
        blob = pickle.dumps(m)
        loaded = state_mod._safe_loads(blob)
        assert loaded.format_override is None

    def test_new_override_round_trips_through_restricted_unpickler(self) -> None:
        m = Match(team1=[Player(name="A")], team2=[Player(name="B")])
        m.format_override = MatchFormatOverride(mode=InputFormat.SETS, set_by="admin", set_at=1.0)
        loaded = state_mod._safe_loads(pickle.dumps(m))
        assert loaded.format_override.mode == InputFormat.SETS
        assert loaded.format_override.points_target is None
        assert loaded.format_override.is_empty() is False

    def test_override_setstate_fills_missing_fields(self) -> None:
        fo = MatchFormatOverride.__new__(MatchFormatOverride)
        fo.__setstate__({"mode": InputFormat.POINTS})
        assert fo.points_target is None
        assert fo.decider is None
        assert fo.set_by is None


# ── Third-set decider (phase 2) ──────────────────────────────────────────────


def _record_gp_sets(client: TestClient, tid: str, mid: str, sets: list[list[int]], headers: dict):
    return client.post(
        f"/api/tournaments/{tid}/gp/record-group-tennis",
        json={"match_id": mid, "sets": sets},
        headers=headers,
    )


def _gp_match(client: TestClient, tid: str, mid: str, headers: dict) -> dict:
    groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=headers).json()
    return next(m for ms in groups["matches"].values() for m in ms if m["id"] == mid)


class TestDecider:
    """``decider`` on the override: set / clear, inheritance, re-recording rules."""

    def test_set_and_clear_on_pending_match(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        assert m["effective_decider"] is None  # inherits tv_settings.set_decider
        r = client.patch(
            _format_url(tid, m["id"]),
            json={"override": {"mode": "sets", "decider": "match_tiebreak"}},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["match"]["format_override"] == {
            "mode": "sets",
            "points_target": None,
            "decider": "match_tiebreak",
        }
        assert r.json()["match"]["effective_decider"] == "match_tiebreak"
        r = client.patch(_format_url(tid, m["id"]), json={"override": None}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["match"]["format_override"] is None
        assert r.json()["match"]["effective_decider"] is None

    def test_tournament_default_in_tv_settings(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        assert client.get(f"/api/tournaments/{tid}/tv-settings").json()["set_decider"] == "full_set"
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings", json={"set_decider": "match_tiebreak"}, headers=auth_headers
        )
        assert r.status_code == 200
        assert client.get(f"/api/tournaments/{tid}/tv-settings").json()["set_decider"] == "match_tiebreak"
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings", json={"set_decider": "sudden_death"}, headers=auth_headers
        )
        assert r.status_code == 422
        # The default is applied and stamped when a set score is recorded.
        r = _record_gp_sets(client, tid, m["id"], [[6, 4], [3, 6], [10, 8]], auth_headers)
        assert r.status_code == 200, r.text
        assert r.json()["score"] == [11, 10]
        assert _gp_match(client, tid, m["id"], auth_headers)["effective_decider"] == "match_tiebreak"

    def test_recorded_score_keeps_its_decider_when_default_changes(
        self, client: TestClient, auth_headers: dict
    ) -> None:
        tid, m = _create_gp(client, auth_headers)
        assert _record_gp_sets(client, tid, m["id"], [[6, 4], [3, 6], [7, 5]], auth_headers).status_code == 200
        client.patch(
            f"/api/tournaments/{tid}/tv-settings", json={"set_decider": "match_tiebreak"}, headers=auth_headers
        )
        match = _gp_match(client, tid, m["id"], auth_headers)
        assert match["effective_decider"] == "full_set"
        assert match["score"] == [16, 15]

    def test_completed_three_set_match_decider_change_needs_sets(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        assert _record_gp_sets(client, tid, m["id"], [[6, 4], [3, 6], [10, 8]], auth_headers).status_code == 200
        r = client.patch(
            _format_url(tid, m["id"]), json={"override": {"decider": "match_tiebreak"}}, headers=auth_headers
        )
        assert r.status_code == 409
        assert _gp_match(client, tid, m["id"], auth_headers)["format_override"] is None

    def test_completed_three_set_match_decider_change_rerecords(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        assert _record_gp_sets(client, tid, m["id"], [[6, 4], [3, 6], [10, 8]], auth_headers).status_code == 200
        assert _gp_match(client, tid, m["id"], auth_headers)["score"] == [19, 18]
        r = client.patch(
            _format_url(tid, m["id"]),
            json={"override": {"decider": "match_tiebreak"}, "sets": [[6, 4], [3, 6], [10, 8]]},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        match = r.json()["match"]
        assert match["effective_decider"] == "match_tiebreak"
        assert match["score"] == [11, 10]
        assert match["sets"] == [[6, 4], [3, 6], [10, 8]]
        assert match["third_set_loss"] is True
        history = client.get(f"/api/tournaments/{tid}/matches/{m['id']}/history", headers=auth_headers).json()[
            "history"
        ]
        assert [h["action"] for h in history][-2:] == ["admin_record", "format_override"]
        standings = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()["standings"]
        rows = {row["player_id"]: row for entries in standings.values() for row in entries}
        assert rows[m["team1_ids"][0]]["points_for"] == 10
        assert rows[m["team2_ids"][0]]["points_for"] == 10

    def test_rerecord_with_full_set_under_tiebreak_400(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        assert _record_gp_sets(client, tid, m["id"], [[6, 4], [3, 6], [7, 5]], auth_headers).status_code == 200
        r = client.patch(
            _format_url(tid, m["id"]),
            json={"override": {"decider": "match_tiebreak"}, "sets": [[6, 4], [3, 6], [7, 5]]},
            headers=auth_headers,
        )
        assert r.status_code == 400
        match = _gp_match(client, tid, m["id"], auth_headers)
        assert match["format_override"] is None
        assert match["effective_decider"] == "full_set"

    def test_two_set_match_decider_change_is_free(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        assert _record_gp_sets(client, tid, m["id"], [[6, 4], [6, 3]], auth_headers).status_code == 200
        r = client.patch(
            _format_url(tid, m["id"]), json={"override": {"decider": "match_tiebreak"}}, headers=auth_headers
        )
        assert r.status_code == 200, r.text
        assert r.json()["match"]["effective_decider"] == "match_tiebreak"
        assert r.json()["match"]["score"] == [12, 7]

    def test_player_token_cannot_set_decider(self, client: TestClient, auth_headers: dict) -> None:
        tid, m = _create_gp(client, auth_headers)
        headers = _player_headers(client, tid, auth_headers, m["team1_ids"][0])
        r = client.patch(_format_url(tid, m["id"]), json={"override": {"decider": "match_tiebreak"}}, headers=headers)
        assert r.status_code in (401, 403)

    def test_match_setstate_without_decider_defaults_to_none(self) -> None:
        m = Match(team1=[Player(name="A")], team2=[Player(name="B")], sets=[(6, 4), (3, 6), (10, 8)])
        state = m.__getstate__()
        del state["decider"]
        restored = Match.__new__(Match)
        restored.__setstate__(state)
        assert restored.decider is None
        # Legacy three-set scores keep counting as full sets.
        from backend.tournaments.set_format import games_from_sets, match_decider

        assert match_decider(restored) is SetDecider.FULL_SET
        assert games_from_sets(restored.sets, match_decider(restored)) == (19, 18)

    def test_override_decider_round_trips_through_pickle(self) -> None:
        import pickle

        fo = MatchFormatOverride(mode=InputFormat.SETS, decider=SetDecider.MATCH_TIEBREAK)
        m = Match(team1=[], team2=[], format_override=fo, decider=SetDecider.MATCH_TIEBREAK)
        back = pickle.loads(pickle.dumps(m))
        assert back.format_override.decider is SetDecider.MATCH_TIEBREAK
        assert back.decider is SetDecider.MATCH_TIEBREAK
