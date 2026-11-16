"""Organizer announcements of a tournament: ``/api/tournaments/{tid}/announcements``."""

from __future__ import annotations

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import backend.api.routes_announcements as ann_mod
import backend.api.state as state_mod
from backend.api.schemas import ANNOUNCEMENT_MAX_LENGTH, ANNOUNCEMENTS_MAX_ITEMS

# Captured before conftest swaps it for a no-op: the real save writes SQLite and bumps the version.
_REAL_SAVE_TOURNAMENT = state_mod._save_tournament

GP_BODY = {
    "name": "Announcement Cup",
    "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
    "team_mode": False,
    "court_names": ["Court 1", "Court 2"],
    "num_groups": 2,
    "top_per_group": 2,
    "double_elimination": False,
}


@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    ann_mod._post_rate_limiter.clear()
    yield
    ann_mod._post_rate_limiter.clear()


def _create(client: TestClient, headers: dict) -> str:
    r = client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _url(tid: str, aid: str | None = None) -> str:
    return f"/api/tournaments/{tid}/announcements" + (f"/{aid}" if aid else "")


def _post(client: TestClient, headers: dict, tid: str, text: str, notify: bool = False):
    return client.post(_url(tid), json={"text": text, "notify": notify}, headers=headers)


def _player_headers(client: TestClient, tid: str, auth_headers: dict) -> dict[str, str]:
    secrets = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
    passphrase = next(iter(secrets.values()))["passphrase"]
    r = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": passphrase})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class TestRead:
    def test_anonymous_get_empty_then_listed(self, client, auth_headers):
        tid = _create(client, auth_headers)
        r = client.get(_url(tid))
        assert r.status_code == 200
        assert r.json() == []
        assert _post(client, auth_headers, tid, "Courts open at **9**").status_code == 201
        items = client.get(_url(tid)).json()
        assert [a["text"] for a in items] == ["Courts open at **9**"]
        assert set(items[0]) == {"id", "text", "created_at", "pinned"}
        assert items[0]["pinned"] is False

    def test_unknown_tournament_404(self, client):
        assert client.get(_url("nope")).status_code == 404

    def test_tv_settings_carries_announcements(self, client, auth_headers):
        """The TV and the Hub read announcements from the tv-settings call they already make."""
        tid = _create(client, auth_headers)
        _post(client, auth_headers, tid, "First")
        _post(client, auth_headers, tid, "Second")
        tv = client.get(f"/api/tournaments/{tid}/tv-settings").json()
        assert [a["text"] for a in tv["announcements"]] == ["Second", "First"]
        # PATCH tv-settings keeps the list in its response and in storage.
        r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"custom_info_title": "Hi"}, headers=auth_headers)
        assert [a["text"] for a in r.json()["announcements"]] == ["Second", "First"]
        assert len(client.get(_url(tid)).json()) == 2

    def test_pinned_first_then_newest(self, client, auth_headers):
        tid = _create(client, auth_headers)
        ids = [_post(client, auth_headers, tid, f"n{i}").json()["id"] for i in range(3)]
        assert client.patch(_url(tid, ids[0]), json={"pinned": True}, headers=auth_headers).status_code == 200
        assert [a["text"] for a in client.get(_url(tid)).json()] == ["n0", "n2", "n1"]


class TestAuth:
    def test_anonymous_writes_401(self, client, auth_headers):
        tid = _create(client, auth_headers)
        aid = _post(client, auth_headers, tid, "x").json()["id"]
        assert client.post(_url(tid), json={"text": "y"}).status_code == 401
        assert client.patch(_url(tid, aid), json={"pinned": True}).status_code == 401
        assert client.delete(_url(tid, aid)).status_code == 401
        assert len(client.get(_url(tid)).json()) == 1

    def test_non_editor_403(self, client, auth_headers, alice_headers):
        tid = _create(client, auth_headers)
        aid = _post(client, auth_headers, tid, "x").json()["id"]
        assert _post(client, alice_headers, tid, "y").status_code == 403
        assert client.patch(_url(tid, aid), json={"text": "z"}, headers=alice_headers).status_code == 403
        assert client.delete(_url(tid, aid), headers=alice_headers).status_code == 403
        assert [a["text"] for a in client.get(_url(tid)).json()] == ["x"]

    def test_non_editor_does_not_use_rate_limit_budget(self, client, auth_headers, alice_headers):
        tid = _create(client, auth_headers)
        for _ in range(15):
            assert _post(client, alice_headers, tid, "spam").status_code == 403
        assert _post(client, auth_headers, tid, "ok").status_code == 201

    def test_co_editor_can_post(self, client, alice_headers, bob_headers):
        tid = _create(client, alice_headers)
        r = client.post(f"/api/tournaments/{tid}/collaborators", json={"username": "bob"}, headers=alice_headers)
        assert r.status_code == 200, r.text
        assert _post(client, bob_headers, tid, "from bob").status_code == 201

    def test_player_token_cannot_write(self, client, auth_headers):
        tid = _create(client, auth_headers)
        aid = _post(client, auth_headers, tid, "x").json()["id"]
        player = _player_headers(client, tid, auth_headers)
        assert _post(client, player, tid, "player post").status_code == 401
        assert client.patch(_url(tid, aid), json={"pinned": True}, headers=player).status_code == 401
        assert client.delete(_url(tid, aid), headers=player).status_code == 401
        assert [a["text"] for a in client.get(_url(tid)).json()] == ["x"]

    def test_post_rate_limited(self, client, auth_headers):
        tid = _create(client, auth_headers)
        codes = [_post(client, auth_headers, tid, f"m{i}").status_code for i in range(11)]
        assert codes[:10] == [201] * 10
        assert codes[10] == 429


class TestValidation:
    @pytest.mark.parametrize("text", ["", "   ", "\n\t"])
    def test_blank_rejected(self, client, auth_headers, text):
        tid = _create(client, auth_headers)
        assert _post(client, auth_headers, tid, text).status_code == 422

    def test_length_limit(self, client, auth_headers):
        tid = _create(client, auth_headers)
        assert _post(client, auth_headers, tid, "a" * ANNOUNCEMENT_MAX_LENGTH).status_code == 201
        assert _post(client, auth_headers, tid, "a" * (ANNOUNCEMENT_MAX_LENGTH + 1)).status_code == 422
        aid = client.get(_url(tid)).json()[0]["id"]
        r = client.patch(_url(tid, aid), json={"text": "b" * (ANNOUNCEMENT_MAX_LENGTH + 1)}, headers=auth_headers)
        assert r.status_code == 422

    def test_text_is_stripped(self, client, auth_headers):
        tid = _create(client, auth_headers)
        assert _post(client, auth_headers, tid, "  hello \n").json()["text"] == "hello"

    def test_list_cap_drops_oldest_unpinned(self, client, auth_headers):
        tid = _create(client, auth_headers)
        first = _post(client, auth_headers, tid, "pinned-oldest").json()["id"]
        client.patch(_url(tid, first), json={"pinned": True}, headers=auth_headers)
        for i in range(ANNOUNCEMENTS_MAX_ITEMS + 4):
            ann_mod._post_rate_limiter.clear()
            assert _post(client, auth_headers, tid, f"m{i}").status_code == 201
        texts = [a["text"] for a in client.get(_url(tid)).json()]
        assert len(texts) == ANNOUNCEMENTS_MAX_ITEMS
        assert texts[0] == "pinned-oldest"
        assert texts[1] == f"m{ANNOUNCEMENTS_MAX_ITEMS + 3}"
        assert "m0" not in texts and "m4" not in texts and "m5" in texts

    def test_edit_and_pin(self, client, auth_headers):
        tid = _create(client, auth_headers)
        aid = _post(client, auth_headers, tid, "old").json()["id"]
        r = client.patch(_url(tid, aid), json={"text": "new", "pinned": True}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["text"] == "new" and r.json()["pinned"] is True
        r = client.patch(_url(tid, aid), json={"pinned": False}, headers=auth_headers)
        assert r.json() == {**r.json(), "text": "new", "pinned": False}
        assert client.patch(_url(tid, "missing"), json={"pinned": True}, headers=auth_headers).status_code == 404

    def test_delete_is_idempotent(self, client, auth_headers):
        tid = _create(client, auth_headers)
        aid = _post(client, auth_headers, tid, "bye").json()["id"]
        assert client.delete(_url(tid, aid), headers=auth_headers).status_code == 204
        assert client.delete(_url(tid, aid), headers=auth_headers).status_code == 204
        assert client.get(_url(tid)).json() == []


class TestPersistence:
    def test_survives_reload_and_bumps_version(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(state_mod, "_save_tournament", _REAL_SAVE_TOURNAMENT)
        tid = _create(client, auth_headers)
        v0 = state_mod._tournament_versions.get(tid, 0)
        aid = _post(client, auth_headers, tid, "Lunch at **13:00**").json()["id"]
        v1 = state_mod._tournament_versions.get(tid, 0)
        assert v1 > v0
        client.patch(_url(tid, aid), json={"pinned": True}, headers=auth_headers)
        assert state_mod._tournament_versions.get(tid, 0) > v1

        state_mod._tournaments.clear()
        state_mod._tournament_versions.clear()
        state_mod._load_state()
        items = client.get(_url(tid)).json()
        assert [(a["id"], a["text"], a["pinned"]) for a in items] == [(aid, "Lunch at **13:00**", True)]
        assert state_mod.get_tournament_data(tid)["announcements"][0]["id"] == aid

    def test_removed_with_tournament(self, client, auth_headers, monkeypatch):
        monkeypatch.setattr(state_mod, "_save_tournament", _REAL_SAVE_TOURNAMENT)
        tid = _create(client, auth_headers)
        _post(client, auth_headers, tid, "gone soon")
        assert client.delete(f"/api/tournaments/{tid}", headers=auth_headers).status_code == 200
        assert client.get(_url(tid)).status_code == 404
        state_mod._tournaments.clear()
        state_mod._load_state()
        assert tid not in state_mod._tournaments
        assert client.get(_url(tid)).status_code == 404

    def test_absent_from_public_events(self, client, auth_headers):
        tid = _create(client, auth_headers)
        _post(client, auth_headers, tid, "SECRET-ANNOUNCEMENT-TEXT")
        r = client.get("/api/public-events")
        assert any(it["id"] == tid for it in r.json())
        assert "SECRET-ANNOUNCEMENT-TEXT" not in r.text
        assert "announcements" not in r.text


class TestPush:
    def test_push_only_when_notify(self, client, auth_headers):
        tid = _create(client, auth_headers)
        with patch("backend.api.push_events.send_push_to_tournament") as mock_push:
            assert _post(client, auth_headers, tid, "quiet", notify=False).status_code == 201
            mock_push.assert_not_called()
            aid = _post(client, auth_headers, tid, "# Final\n\n**Court 1** at [noon](https://x.y)", notify=True)
            aid = aid.json()["id"]
            mock_push.assert_called_once()
            kwargs = mock_push.call_args.kwargs
            assert kwargs["tournament_id"] == tid
            assert kwargs["url"] == f"/player/matches/tournament/{tid}"
            assert kwargs["tag"] == f"{tid}-announcement-{aid}"
            assert kwargs["body"] == "Final Court 1 at noon"
            assert kwargs["title"] == GP_BODY["name"]

    def test_notify_defaults_to_true_and_body_truncated(self, client, auth_headers):
        tid = _create(client, auth_headers)
        with patch("backend.api.push_events.send_push_to_tournament") as mock_push:
            r = client.post(_url(tid), json={"text": "word " * 100}, headers=auth_headers)
            assert r.status_code == 201
            body = mock_push.call_args.kwargs["body"]
            assert len(body) <= 140 and body.endswith("…")

    def test_edit_pin_delete_never_push(self, client, auth_headers):
        tid = _create(client, auth_headers)
        aid = _post(client, auth_headers, tid, "x").json()["id"]
        with patch("backend.api.push_events.send_push_to_tournament") as mock_push:
            client.patch(_url(tid, aid), json={"text": "y", "pinned": True}, headers=auth_headers)
            client.delete(_url(tid, aid), headers=auth_headers)
            mock_push.assert_not_called()
