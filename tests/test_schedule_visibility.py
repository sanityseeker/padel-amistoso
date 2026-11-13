"""Tests for the ``hide_schedule`` TV setting: players and anonymous viewers see only played matches."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import push_events

_GP_BODY = {
    "name": "Hidden Cup",
    "player_names": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"],
    "num_groups": 2,
    "top_per_group": 2,
    "num_courts": 2,
    "score_mode": "points",
}
_MEX_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana"],
    "num_courts": 1,
    "num_rounds": 2,
    "score_mode": "points",
}
_PO_BODY = {"name": "Hidden KO", "participant_names": ["A", "B", "C", "D"], "court_names": ["Court 1"]}


def _hide(client: TestClient, tid: str, headers: dict, value: bool = True) -> None:
    r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"hide_schedule": value}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["hide_schedule"] is value


def _gp(client: TestClient, headers: dict) -> str:
    r = client.post("/api/tournaments/group-playoff", json=_GP_BODY, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _all_group_matches(payload: dict) -> list[dict]:
    return [m for matches in payload["matches"].values() for m in matches]


def _score_first_group_match(client: TestClient, tid: str, headers: dict) -> str:
    groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=headers).json()
    mid = _all_group_matches(groups)[0]["id"]
    r = client.post(
        f"/api/tournaments/{tid}/gp/record-group",
        json={"match_id": mid, "score1": 6, "score2": 3},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return mid


def _finish_groups_and_start_playoffs(client: TestClient, tid: str, headers: dict) -> None:
    while True:
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=headers).json()
        for m in _all_group_matches(groups):
            if m["status"] != "completed":
                client.post(
                    f"/api/tournaments/{tid}/gp/record-group",
                    json={"match_id": m["id"], "score1": 6, "score2": 3},
                    headers=headers,
                )
        if not groups.get("has_more_rounds"):
            break
        assert client.post(f"/api/tournaments/{tid}/gp/next-group-round", headers=headers).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/gp/start-playoffs", headers=headers).status_code == 200


def _player_headers(client: TestClient, tid: str, headers: dict, match: dict) -> dict:
    secrets = client.get(f"/api/tournaments/{tid}/player-secrets", headers=headers).json()["players"]
    pid = next(p for p in match["team1_ids"] if p in secrets)
    r = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": secrets[pid]["passphrase"]})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class TestGroupPlayoff:
    def test_anonymous_sees_nothing_unplayed(self, client: TestClient, auth_headers: dict) -> None:
        tid = _gp(client, auth_headers)
        _hide(client, tid, auth_headers)
        anon = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        assert anon["standings"] == {}
        assert _all_group_matches(anon) == []
        assert client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()["standings"]

    def test_scored_match_becomes_visible(self, client: TestClient, auth_headers: dict) -> None:
        tid = _gp(client, auth_headers)
        _hide(client, tid, auth_headers)
        mid = _score_first_group_match(client, tid, auth_headers)
        anon = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        assert [m["id"] for m in _all_group_matches(anon)] == [mid]
        assert anon["standings"] == {}

    def test_owner_co_editor_and_stranger(
        self, client: TestClient, alice_headers: dict, bob_headers: dict, auth_headers: dict
    ) -> None:
        tid = _gp(client, alice_headers)
        _hide(client, tid, alice_headers)
        full = client.get(f"/api/tournaments/{tid}/gp/groups", headers=alice_headers).json()
        assert _all_group_matches(full)
        # bob is not an editor yet
        assert _all_group_matches(client.get(f"/api/tournaments/{tid}/gp/groups", headers=bob_headers).json()) == []
        client.post(f"/api/tournaments/{tid}/collaborators", json={"username": "bob"}, headers=alice_headers)
        assert client.get(f"/api/tournaments/{tid}/gp/groups", headers=bob_headers).json() == full

    def test_flag_off_matches_admin_payload(self, client: TestClient, auth_headers: dict) -> None:
        tid = _gp(client, auth_headers)
        anon = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        assert anon == client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()

    def test_playoffs_and_schema(self, client: TestClient, alice_headers: dict) -> None:
        tid = _gp(client, alice_headers)
        _finish_groups_and_start_playoffs(client, tid, alice_headers)
        _hide(client, tid, alice_headers)
        anon = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()
        assert anon["pending"] == []
        assert all(m["status"] == "completed" or m["score"] is not None for m in anon["matches"])
        assert client.get(f"/api/tournaments/{tid}/gp/playoffs", headers=alice_headers).json()["pending"]
        assert client.get(f"/api/tournaments/{tid}/gp/playoffs-schema?fmt=png").status_code == 404
        assert (
            client.get(f"/api/tournaments/{tid}/gp/playoffs-schema?fmt=png", headers=alice_headers).status_code == 200
        )
        _hide(client, tid, alice_headers, False)
        assert client.get(f"/api/tournaments/{tid}/gp/playoffs-schema?fmt=png").status_code == 200


class TestMexicano:
    def test_matches_and_sit_outs(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post("/api/tournaments/mexicano", json=_MEX_BODY, headers=auth_headers)
        tid = r.json()["id"]
        assert client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers).status_code == 200
        full = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        assert full["current_matches"]
        _hide(client, tid, auth_headers)
        anon = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        assert anon["current_matches"] == [] and anon["pending"] == [] and anon["all_matches"] == []
        assert client.get(f"/api/tournaments/{tid}/mex/status").json()["current_sit_out_ids"] == []
        assert client.get(f"/api/tournaments/{tid}/mex/status").json()["leaderboard"]
        assert client.get(f"/api/tournaments/{tid}/mex/matches", headers=auth_headers).json()["current_matches"]


class TestPlayoff:
    def test_pending_and_schema(self, client: TestClient, alice_headers: dict) -> None:
        tid = client.post("/api/tournaments/playoff", json=_PO_BODY, headers=alice_headers).json()["id"]
        _hide(client, tid, alice_headers)
        anon = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
        assert anon["pending"] == [] and anon["matches"] == []
        assert client.get(f"/api/tournaments/{tid}/po/playoffs-schema?fmt=png").status_code == 404
        assert (
            client.get(f"/api/tournaments/{tid}/po/playoffs-schema?fmt=png", headers=alice_headers).status_code == 200
        )


class TestPlayerActions:
    def test_opponents_empty_and_scoring_blocked(self, client: TestClient, auth_headers: dict) -> None:
        tid = _gp(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        matches = _all_group_matches(groups)
        match = matches[0]
        player = _player_headers(client, tid, auth_headers, match)
        assert client.get(f"/api/tournaments/{tid}/player/opponents", headers=player).json()["opponents"]
        _hide(client, tid, auth_headers)
        assert client.get(f"/api/tournaments/{tid}/player/opponents", headers=player).json() == {"opponents": []}
        body = {"match_id": match["id"], "score1": 6, "score2": 3}
        r = client.post(f"/api/tournaments/{tid}/gp/record-group", json=body, headers=player)
        assert r.status_code == 403
        assert "organizer" in r.json()["detail"]
        # The organizer can still score it, and the scored match is then visible to everyone.
        assert (
            client.post(f"/api/tournaments/{tid}/gp/record-group", json=body, headers=auth_headers).status_code == 200
        )
        anon = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        assert [m["id"] for m in _all_group_matches(anon)] == [match["id"]]


class TestPush:
    def test_match_ready_push_suppressed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sent: list[dict] = []
        monkeypatch.setattr(push_events, "send_push_to_players", lambda **kw: sent.append(kw))
        from backend.models import Match, Player

        match = Match(id="m1", team1=[Player(id="p1", name="A")], team2=[Player(id="p2", name="B")])
        push_events.notify_matches_ready("t1", {"name": "X", "tv_settings": {"hide_schedule": True}}, [match])
        assert sent == []
        push_events.notify_matches_ready("t1", {"name": "X", "tv_settings": {}}, [match])
        assert len(sent) == 1


@pytest.mark.parametrize(
    "path",
    ["gp/groups", "gp/playoffs"],
)
def test_guard_no_unplayed_match_in_anonymous_payload(client: TestClient, auth_headers: dict, path: str) -> None:
    tid = _gp(client, auth_headers)
    _finish_groups_and_start_playoffs(client, tid, auth_headers)
    _hide(client, tid, auth_headers)
    payload = client.get(f"/api/tournaments/{tid}/{path}").json()
    matches = _all_group_matches(payload) if isinstance(payload["matches"], dict) else payload["matches"]
    assert all(m["status"] == "completed" or m["score"] is not None for m in matches)
    assert payload.get("pending", []) == []
