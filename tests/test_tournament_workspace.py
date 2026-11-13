"""Tests for ``GET /api/tournaments/{tid}/workspace``: the organizer workspace in one request.

It must return exactly what the per-piece endpoints return (same serialization, same
``hide_schedule`` handling), plus booleans about the caller's rights and nothing else.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

_GP_BODY = {
    "name": "Workspace Cup",
    "player_names": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"],
    "num_groups": 2,
    "top_per_group": 2,
    "court_names": ["Court 1", "Court 2"],
}
_MEX_BODY = {
    "name": "Workspace Mex",
    "player_names": ["A", "B", "C", "D"],
    "court_names": ["Court 1"],
    "num_rounds": 2,
}
_PO_BODY = {"name": "Workspace KO", "participant_names": ["A", "B", "C", "D"], "court_names": ["Court 1"]}


def _create(client: TestClient, kind: str, headers: dict[str, str]) -> str:
    url, body = {
        "gp": ("/api/tournaments/group-playoff", _GP_BODY),
        "mex": ("/api/tournaments/mexicano", _MEX_BODY),
        "po": ("/api/tournaments/playoff", _PO_BODY),
    }[kind]
    r = client.post(url, json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _workspace(client: TestClient, tid: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    r = client.get(f"/api/tournaments/{tid}/workspace", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


def _get(client: TestClient, path: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    r = client.get(f"/api/tournaments/{path}", headers=headers or {})
    assert r.status_code == 200, r.text
    return r.json()


def _group_matches(payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [m for matches in payload["matches"].values() for m in matches]


def _finish_groups(client: TestClient, tid: str, headers: dict[str, str]) -> None:
    while True:
        groups = _get(client, f"{tid}/gp/groups", headers)
        for m in _group_matches(groups):
            if m["status"] != "completed":
                r = client.post(
                    f"/api/tournaments/{tid}/gp/record-group",
                    json={"match_id": m["id"], "score1": 6, "score2": 3},
                    headers=headers,
                )
                assert r.status_code == 200, r.text
        if not groups.get("has_more_rounds"):
            return
        assert client.post(f"/api/tournaments/{tid}/gp/next-group-round", headers=headers).status_code == 200


def _play_mex_round(client: TestClient, tid: str, headers: dict[str, str]) -> None:
    assert client.post(f"/api/tournaments/{tid}/mex/next-round", headers=headers).status_code == 200
    for m in _get(client, f"{tid}/mex/matches", headers)["current_matches"]:
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=headers,
        )
        assert r.status_code == 200, r.text


def _assert_parity(client: TestClient, tid: str, prefix: str, headers: dict[str, str] | None = None) -> dict[str, Any]:
    """The workspace equals the per-piece endpoints, as the frontend used to combine them."""
    ws = _workspace(client, tid, headers)
    status = _get(client, f"{tid}/{prefix}/status", headers)
    assert ws["prefix"] == prefix
    assert ws["status"] == status
    assert ws["data"] == _get(client, f"{tid}/{prefix}/{ws['path']}", headers)
    assert ws["tv_settings"] == _get(client, f"{tid}/tv-settings", headers)
    if prefix == "gp" and not ws["group_stage"]:
        assert ws["groups"] == _get(client, f"{tid}/gp/groups", headers)
    else:
        assert ws["groups"] is None
    return ws


class TestTypesAndPhases:
    def test_group_stage(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        tid = _create(client, "gp", auth_headers)
        ws = _assert_parity(client, tid, "gp", auth_headers)
        assert ws["type"] == "group_playoff"
        assert ws["group_stage"] is True
        assert ws["path"] == "groups"
        assert ws["rounds"] is None

    def test_group_playoff_in_playoffs_keeps_group_results(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        tid = _create(client, "gp", auth_headers)
        _finish_groups(client, tid, auth_headers)
        assert client.post(f"/api/tournaments/{tid}/gp/start-playoffs", headers=auth_headers).status_code == 200
        ws = _assert_parity(client, tid, "gp", auth_headers)
        assert ws["group_stage"] is False
        assert ws["path"] == "playoffs"
        assert ws["groups"]["matches"]

    def test_mexicano_rounds(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        tid = _create(client, "mex", auth_headers)
        _play_mex_round(client, tid, auth_headers)
        ws = _assert_parity(client, tid, "mex", auth_headers)
        assert ws["type"] == "mexicano"
        assert ws["path"] == "matches"
        assert ws["rounds"] is None

    def test_mexicano_playoffs(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        tid = _create(client, "mex", auth_headers)
        _play_mex_round(client, tid, auth_headers)
        assert client.post(f"/api/tournaments/{tid}/mex/end", headers=auth_headers).status_code == 200
        r = client.post(f"/api/tournaments/{tid}/mex/start-playoffs", json={"n_teams": 4}, headers=auth_headers)
        assert r.status_code == 200, r.text
        ws = _assert_parity(client, tid, "mex", auth_headers)
        assert ws["path"] == "playoffs"
        assert ws["data"]["matches"]
        assert ws["rounds"] is None

    def test_mexicano_finished_without_playoffs_lists_rounds(
        self, client: TestClient, auth_headers: dict[str, str]
    ) -> None:
        tid = _create(client, "mex", auth_headers)
        _play_mex_round(client, tid, auth_headers)
        assert client.post(f"/api/tournaments/{tid}/mex/finish", headers=auth_headers).status_code == 200
        ws = _assert_parity(client, tid, "mex", auth_headers)
        assert ws["status"]["phase"] == "finished"
        assert ws["path"] == "playoffs"
        assert ws["data"]["matches"] == []
        assert ws["rounds"] == _get(client, f"{tid}/mex/matches", auth_headers)
        assert ws["rounds"]["all_matches"]

    def test_playoff(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        tid = _create(client, "po", auth_headers)
        ws = _assert_parity(client, tid, "po", auth_headers)
        assert ws["type"] == "playoff"
        assert ws["path"] == "playoffs"
        assert ws["group_stage"] is False

    def test_unknown_tournament_is_404(self, client: TestClient, auth_headers: dict[str, str]) -> None:
        assert client.get("/api/tournaments/nope/workspace", headers=auth_headers).status_code == 404
        assert client.get("/api/tournaments/nope/workspace").status_code == 404


class TestHiddenSchedule:
    @pytest.mark.parametrize("kind", ["gp", "mex", "po"])
    def test_anonymous_gets_the_hidden_view_and_the_editor_the_full_one(
        self, client: TestClient, alice_headers: dict[str, str], kind: str
    ) -> None:
        tid = _create(client, kind, alice_headers)
        if kind == "mex":
            assert client.post(f"/api/tournaments/{tid}/mex/next-round", headers=alice_headers).status_code == 200
        r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"hide_schedule": True}, headers=alice_headers)
        assert r.status_code == 200, r.text
        anonymous = _assert_parity(client, tid, kind)
        editor = _assert_parity(client, tid, kind, alice_headers)
        assert anonymous["data"] != editor["data"]
        assert editor["tv_settings"]["hide_schedule"] is True


class TestAccess:
    def _shared(self, client: TestClient, alice_headers: dict[str, str]) -> str:
        tid = _create(client, "mex", alice_headers)
        r = client.post(f"/api/tournaments/{tid}/collaborators", json={"username": "bob"}, headers=alice_headers)
        assert r.status_code == 200, r.text
        return tid

    def test_anonymous(self, client: TestClient, alice_headers: dict[str, str]) -> None:
        ws = _workspace(client, self._shared(client, alice_headers))
        assert ws["access"] == {"can_edit": False, "is_owner_or_admin": False}
        assert ws["tournament"] is None

    def test_owner(self, client: TestClient, alice_headers: dict[str, str]) -> None:
        tid = self._shared(client, alice_headers)
        ws = _workspace(client, tid, alice_headers)
        assert ws["access"] == {"can_edit": True, "is_owner_or_admin": True}
        listed = next(t for t in _list(client, alice_headers) if t["id"] == tid)
        assert ws["tournament"] == {k: listed[k] for k in ws["tournament"]}

    def test_co_editor(self, client: TestClient, alice_headers: dict[str, str], bob_headers: dict[str, str]) -> None:
        ws = _workspace(client, self._shared(client, alice_headers), bob_headers)
        assert ws["access"] == {"can_edit": True, "is_owner_or_admin": False}
        assert ws["tournament"]["name"] == "Workspace Mex"

    def test_other_user(self, client: TestClient, alice_headers: dict[str, str], bob_headers: dict[str, str]) -> None:
        tid = _create(client, "mex", alice_headers)
        ws = _workspace(client, tid, bob_headers)
        assert ws["access"] == {"can_edit": False, "is_owner_or_admin": False}
        assert ws["tournament"] is None

    def test_admin(self, client: TestClient, alice_headers: dict[str, str], auth_headers: dict[str, str]) -> None:
        ws = _workspace(client, self._shared(client, alice_headers), auth_headers)
        assert ws["access"] == {"can_edit": True, "is_owner_or_admin": True}
        assert ws["tournament"] is not None

    def test_never_names_the_owner(
        self, client: TestClient, alice_headers: dict[str, str], bob_headers: dict[str, str]
    ) -> None:
        tid = self._shared(client, alice_headers)
        for headers in (None, alice_headers, bob_headers):
            ws = _workspace(client, tid, headers)
            assert "owner" not in ws
            assert "owner" not in (ws["tournament"] or {})
            assert "shared" not in (ws["tournament"] or {})


def _list(client: TestClient, headers: dict[str, str]) -> list[dict[str, Any]]:
    r = client.get("/api/tournaments", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()
