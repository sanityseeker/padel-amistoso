"""Players may not overwrite a recorded score; organizers still can.

Covers ``_require_score_permission`` (409 for a participant when ``match.score`` is set)
on all three tournament formats in immediate and required confirmation mode, plus the
``current_sit_out_ids`` field of ``GET /mex/status``.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

_GP_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"],
    "num_groups": 2,
    "top_per_group": 2,
    "num_courts": 2,
    "score_mode": "points",
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
_DETAIL = "A score was already submitted for this match"


def _set_mode(client: TestClient, tid: str, headers: dict, mode: str) -> None:
    r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"score_confirmation": mode}, headers=headers)
    assert r.status_code == 200


def _player(client: TestClient, tid: str, headers: dict, player_id: str) -> dict[str, str]:
    secrets = client.get(f"/api/tournaments/{tid}/player-secrets", headers=headers).json()["players"]
    r = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": secrets[player_id]["passphrase"]})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _gp(client: TestClient, headers: dict) -> tuple[str, dict, str]:
    tid = client.post("/api/tournaments/group-playoff", json=_GP_BODY, headers=headers).json()["id"]
    groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=headers).json()
    match = next(m for ms in groups["matches"].values() for m in ms)
    return tid, match, f"/api/tournaments/{tid}/gp/record-group"


def _mex(client: TestClient, headers: dict) -> tuple[str, dict, str]:
    tid = client.post("/api/tournaments/mexicano", json=_MEX_BODY, headers=headers).json()["id"]
    client.post(f"/api/tournaments/{tid}/mex/next-round", headers=headers)
    match = client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"][0]
    return tid, match, f"/api/tournaments/{tid}/mex/record"


def _po(client: TestClient, headers: dict) -> tuple[str, dict, str]:
    tid = client.post("/api/tournaments/playoff", json=_PO_BODY, headers=headers).json()["id"]
    match = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"][0]
    return tid, match, f"/api/tournaments/{tid}/po/record"


_FORMATS = {"gp": _gp, "mex": _mex, "po": _po}


class TestPlayerCannotOverwrite:
    @pytest.mark.parametrize("fmt", ["gp", "mex", "po"])
    @pytest.mark.parametrize("mode", ["immediate", "required"])
    def test_resubmit_is_409(self, client: TestClient, auth_headers: dict, fmt: str, mode: str) -> None:
        tid, match, url = _FORMATS[fmt](client, auth_headers)
        _set_mode(client, tid, auth_headers, mode)
        headers = _player(client, tid, auth_headers, match["team1_ids"][0])
        first = client.post(url, json={"match_id": match["id"], "score1": 20, "score2": 12}, headers=headers)
        assert first.status_code == 200
        second = client.post(url, json={"match_id": match["id"], "score1": 1, "score2": 31}, headers=headers)
        assert second.status_code == 409
        assert second.json()["detail"] == _DETAIL
        # The opponent cannot overwrite it either.
        other = _player(client, tid, auth_headers, match["team2_ids"][0])
        third = client.post(url, json={"match_id": match["id"], "score1": 1, "score2": 31}, headers=other)
        assert third.status_code == 409

    @pytest.mark.parametrize("fmt", ["gp", "mex", "po"])
    def test_organizer_can_still_rerecord(self, client: TestClient, auth_headers: dict, fmt: str) -> None:
        tid, match, url = _FORMATS[fmt](client, auth_headers)
        headers = _player(client, tid, auth_headers, match["team1_ids"][0])
        assert (
            client.post(url, json={"match_id": match["id"], "score1": 20, "score2": 12}, headers=headers).status_code
            == 200
        )
        r = client.post(url, json={"match_id": match["id"], "score1": 10, "score2": 22}, headers=auth_headers)
        assert r.status_code == 200

    def test_confirmed_score_cannot_be_overwritten(self, client: TestClient, auth_headers: dict) -> None:
        tid, match, url = _gp(client, auth_headers)
        _set_mode(client, tid, auth_headers, "required")
        first = _player(client, tid, auth_headers, match["team1_ids"][0])
        second = _player(client, tid, auth_headers, match["team2_ids"][0])
        assert (
            client.post(url, json={"match_id": match["id"], "score1": 6, "score2": 3}, headers=first).status_code == 200
        )
        accept = client.post(f"/api/tournaments/{tid}/matches/{match['id']}/accept", json={}, headers=second)
        assert accept.status_code == 200
        r = client.post(url, json={"match_id": match["id"], "score1": 0, "score2": 9}, headers=first)
        assert r.status_code == 409

    def test_tennis_scores_are_covered(self, client: TestClient, auth_headers: dict) -> None:
        tid, match, _ = _gp(client, auth_headers)
        headers = _player(client, tid, auth_headers, match["team1_ids"][0])
        url = f"/api/tournaments/{tid}/gp/record-group-tennis"
        body = {"match_id": match["id"], "sets": [[6, 3], [6, 4]]}
        assert client.post(url, json=body, headers=headers).status_code == 200
        assert client.post(url, json=body, headers=headers).status_code == 409

    def test_non_participant_still_gets_403(self, client: TestClient, auth_headers: dict) -> None:
        tid, match, url = _gp(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        taken = set(match["team1_ids"]) | set(match["team2_ids"])
        outsider = next(
            pid for ms in groups["matches"].values() for m in ms for pid in m["team1_ids"] if pid not in taken
        )
        assert (
            client.post(url, json={"match_id": match["id"], "score1": 6, "score2": 3}, headers=auth_headers).status_code
            == 200
        )
        r = client.post(
            url,
            json={"match_id": match["id"], "score1": 1, "score2": 2},
            headers=_player(client, tid, auth_headers, outsider),
        )
        assert r.status_code == 403


class TestMexStatusSitOuts:
    def test_current_sit_out_ids(self, client: TestClient, auth_headers: dict) -> None:
        body = {**_MEX_BODY, "player_names": ["Alice", "Bob", "Carol", "Dave", "Erin"]}
        tid = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers).json()["id"]
        before = client.get(f"/api/tournaments/{tid}/mex/status").json()
        assert before["current_sit_out_ids"] == []
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        ids = status["current_sit_out_ids"]
        assert len(ids) == 1
        playing = {
            pid
            for m in client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"]
            for pid in m["team1_ids"] + m["team2_ids"]
        }
        assert ids[0] not in playing
        assert {p["name"] for p in status["players"] if p["id"] == ids[0]} == set(status["sit_outs"][-1])

    def test_empty_when_everyone_plays(self, client: TestClient, auth_headers: dict) -> None:
        tid = client.post("/api/tournaments/mexicano", json=_MEX_BODY, headers=auth_headers).json()["id"]
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        assert client.get(f"/api/tournaments/{tid}/mex/status").json()["current_sit_out_ids"] == []
