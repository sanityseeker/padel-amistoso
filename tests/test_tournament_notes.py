"""Tests for the private organizer notepad of a tournament (tournaments.admin_notes)."""

from __future__ import annotations

from fastapi.testclient import TestClient

NOTE = "Court 3 light is broken; Ana leaves at 20:00."


def _lobby(client: TestClient, headers: dict, notes: str | None = None) -> str:
    r = client.post("/api/registrations", json={"name": "Notes Cup"}, headers=headers)
    assert r.status_code == 200, r.text
    rid = r.json()["id"]
    if notes is not None:
        r = client.patch(f"/api/registrations/{rid}", json={"admin_notes": notes}, headers=headers)
        assert r.status_code == 200, r.text
    for name in ("Ana", "Ben", "Cid", "Dan"):
        r = client.post(f"/api/registrations/{rid}/register", json={"player_name": name})
        assert r.status_code == 200, r.text
    return rid


def _tournament(client: TestClient, headers: dict, lobby_notes: str | None = None) -> str:
    rid = _lobby(client, headers, lobby_notes)
    r = client.post(f"/api/registrations/{rid}/convert", json={"tournament_type": "mexicano"}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["tournament_id"]


def _put(client: TestClient, headers: dict, tid: str, text: str):
    return client.put(f"/api/tournaments/{tid}/notes", json={"admin_notes": text}, headers=headers)


def _get(client: TestClient, headers: dict, tid: str):
    r = client.get(f"/api/tournaments/{tid}/notes", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["admin_notes"]


class TestTournamentNotes:
    def test_default_is_none(self, client, auth_headers):
        tid = _tournament(client, auth_headers)
        assert _get(client, auth_headers, tid) is None

    def test_put_then_get(self, client, auth_headers):
        tid = _tournament(client, auth_headers)
        r = _put(client, auth_headers, tid, NOTE)
        assert r.status_code == 200 and r.json()["admin_notes"] == NOTE
        assert _get(client, auth_headers, tid) == NOTE

    def test_blank_clears_to_none(self, client, auth_headers):
        tid = _tournament(client, auth_headers)
        _put(client, auth_headers, tid, NOTE)
        assert _put(client, auth_headers, tid, "  \n ").json()["admin_notes"] is None
        assert _get(client, auth_headers, tid) is None

    def test_survives_tournament_saves(self, client, auth_headers):
        tid = _tournament(client, auth_headers)
        _put(client, auth_headers, tid, NOTE)
        r = client.patch(f"/api/tournaments/{tid}/tv-settings", json={"show_courts": False}, headers=auth_headers)
        assert r.status_code == 200, r.text
        assert _get(client, auth_headers, tid) == NOTE

    def test_too_long_rejected(self, client, auth_headers):
        tid = _tournament(client, auth_headers)
        assert _put(client, auth_headers, tid, "x" * 10001).status_code == 422
        assert _put(client, auth_headers, tid, "x" * 10000).status_code == 200

    def test_unknown_tournament(self, client, auth_headers):
        assert client.get("/api/tournaments/nope/notes", headers=auth_headers).status_code == 404

    def test_non_editor_forbidden(self, client, alice_headers, bob_headers):
        tid = _tournament(client, alice_headers)
        assert client.get(f"/api/tournaments/{tid}/notes").status_code == 401
        assert client.get(f"/api/tournaments/{tid}/notes", headers=bob_headers).status_code == 403
        assert _put(client, bob_headers, tid, NOTE).status_code == 403

    def test_co_editor_can_read_and_write(self, client, alice_headers, bob_headers):
        tid = _tournament(client, alice_headers)
        r = client.post(f"/api/tournaments/{tid}/collaborators", json={"username": "bob"}, headers=alice_headers)
        assert r.status_code == 200, r.text
        assert _put(client, bob_headers, tid, NOTE).status_code == 200
        assert _get(client, alice_headers, tid) == NOTE

    def test_lobby_notes_copied_on_convert(self, client, auth_headers):
        tid = _tournament(client, auth_headers, lobby_notes=NOTE)
        assert _get(client, auth_headers, tid) == NOTE


class TestTournamentNotesNotLeaked:
    def test_not_in_list_or_public_endpoints(self, client, auth_headers):
        tid = _tournament(client, auth_headers)
        _put(client, auth_headers, tid, NOTE)
        for url in (
            "/api/tournaments",
            f"/api/tournaments/{tid}/tv-settings",
            f"/api/tournaments/{tid}/mex/status",
            f"/api/tournaments/{tid}/mex/matches",
            "/api/public-events",
        ):
            r = client.get(url, headers=auth_headers)
            assert NOTE not in r.text, url
