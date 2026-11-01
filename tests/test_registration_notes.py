"""Tests for the private organizer notepad (registrations.admin_notes)."""

from __future__ import annotations

from fastapi.testclient import TestClient

NOTE = "Pair Ana with Ben; keep Carl on the left side."


def _create_lobby(client: TestClient, headers: dict, **extra) -> str:
    payload = {"name": "Notes Lobby", **extra}
    r = client.post("/api/registrations", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _patch(client: TestClient, headers: dict, rid: str, body: dict):
    return client.patch(f"/api/registrations/{rid}", json=body, headers=headers)


def _get_notes(client: TestClient, headers: dict, rid: str):
    r = client.get(f"/api/registrations/{rid}", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["admin_notes"]


class TestAdminNotes:
    def test_default_is_none(self, client, auth_headers):
        rid = _create_lobby(client, auth_headers)
        assert _get_notes(client, auth_headers, rid) is None

    def test_patch_then_get(self, client, auth_headers):
        rid = _create_lobby(client, auth_headers)
        assert _patch(client, auth_headers, rid, {"admin_notes": NOTE}).status_code == 200
        assert _get_notes(client, auth_headers, rid) == NOTE

    def test_blank_clears_to_none(self, client, auth_headers):
        rid = _create_lobby(client, auth_headers)
        _patch(client, auth_headers, rid, {"admin_notes": NOTE})
        assert _patch(client, auth_headers, rid, {"admin_notes": ""}).status_code == 200
        assert _get_notes(client, auth_headers, rid) is None
        _patch(client, auth_headers, rid, {"admin_notes": NOTE})
        assert _patch(client, auth_headers, rid, {"admin_notes": "  \n "}).status_code == 200
        assert _get_notes(client, auth_headers, rid) is None

    def test_patch_without_notes_leaves_unchanged(self, client, auth_headers):
        rid = _create_lobby(client, auth_headers)
        _patch(client, auth_headers, rid, {"admin_notes": NOTE})
        assert _patch(client, auth_headers, rid, {"description": "Hello"}).status_code == 200
        assert _get_notes(client, auth_headers, rid) == NOTE

    def test_too_long_rejected(self, client, auth_headers):
        rid = _create_lobby(client, auth_headers)
        r = _patch(client, auth_headers, rid, {"admin_notes": "x" * 10001})
        assert r.status_code == 422
        assert _patch(client, auth_headers, rid, {"admin_notes": "x" * 10000}).status_code == 200

    def test_non_owner_forbidden(self, client, alice_headers, bob_headers):
        rid = _create_lobby(client, alice_headers)
        assert _patch(client, bob_headers, rid, {"admin_notes": NOTE}).status_code == 403
        assert client.get(f"/api/registrations/{rid}", headers=bob_headers).status_code == 403

    def test_co_editor_can_read_and_write(self, client, alice_headers, bob_headers):
        rid = _create_lobby(client, alice_headers)
        r = client.post(f"/api/registrations/{rid}/collaborators", json={"username": "bob"}, headers=alice_headers)
        assert r.status_code == 200, r.text
        assert _patch(client, bob_headers, rid, {"admin_notes": NOTE}).status_code == 200
        assert _get_notes(client, bob_headers, rid) == NOTE
        assert _get_notes(client, alice_headers, rid) == NOTE


class TestAdminNotesNotLeaked:
    def test_not_in_public_or_list_endpoints(self, client, auth_headers):
        rid = _create_lobby(client, auth_headers, listed=True)
        _patch(client, auth_headers, rid, {"admin_notes": NOTE})

        r = client.get(f"/api/registrations/{rid}/public")
        assert r.status_code == 200
        assert "admin_notes" not in r.json()
        assert NOTE not in r.text

        r = client.get("/api/registrations/public")
        assert r.status_code == 200
        assert NOTE not in r.text

        r = client.get(f"/api/registrations/public/{rid}")
        assert NOTE not in r.text

        r = client.get("/api/registrations", headers=auth_headers)
        assert r.status_code == 200
        rows = [row for row in r.json() if row["id"] == rid]
        assert rows
        assert all("admin_notes" not in row for row in rows)
        assert NOTE not in r.text
