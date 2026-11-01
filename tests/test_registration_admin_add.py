"""Tests for admin-adding a club member (Hub profile) to a registration lobby."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import backend.api.db as db_mod
from backend.api import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _insert_profile(name: str, email: str = "", passphrase: str | None = None) -> tuple[str, str]:
    """Insert a player_profiles row and return (profile_id, passphrase)."""
    profile_id = str(uuid.uuid4())
    passphrase = passphrase or f"pp-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
            " VALUES (?, ?, ?, ?, '', ?, 0)",
            (profile_id, passphrase, name, email, now),
        )
    return profile_id, passphrase


def _create_club_lobby(client: TestClient, auth_headers: dict) -> tuple[str, str]:
    """Create a community + club + lobby attached to the club; return (rid, club_id)."""
    community = client.post("/api/communities", json={"name": "Comm"}, headers=auth_headers).json()
    club = client.post(
        "/api/clubs", json={"community_id": community["id"], "name": "Club"}, headers=auth_headers
    ).json()
    r = client.post(
        "/api/registrations",
        json={"name": "Club Lobby", "club_id": club["id"]},
        headers=auth_headers,
    )
    assert r.status_code == 200
    return r.json()["id"], club["id"]


class TestAdminAddClubMember:
    def test_detail_exposes_club_id(self, client: TestClient, auth_headers: dict) -> None:
        rid, club_id = _create_club_lobby(client, auth_headers)
        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert detail["club_id"] == club_id

    def test_add_with_profile_links_and_reuses_passphrase(self, client: TestClient, auth_headers: dict) -> None:
        rid, _ = _create_club_lobby(client, auth_headers)
        profile_id, passphrase = _insert_profile("Marta", "marta@example.com")

        r = client.post(
            f"/api/registrations/{rid}/registrant",
            json={"player_name": "Marta", "email": "marta@example.com", "profile_id": profile_id},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["passphrase"] == passphrase

        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        entry = next(p for p in detail["registrants"] if p["player_name"] == "Marta")
        assert entry["profile_id"] == profile_id
        assert entry["email"] == "marta@example.com"

    def test_same_profile_twice_conflicts(self, client: TestClient, auth_headers: dict) -> None:
        rid, _ = _create_club_lobby(client, auth_headers)
        profile_id, _ = _insert_profile("Luis")
        url = f"/api/registrations/{rid}/registrant"
        assert (
            client.post(url, json={"player_name": "Luis", "profile_id": profile_id}, headers=auth_headers).status_code
            == 200
        )
        r = client.post(url, json={"player_name": "Luis B", "profile_id": profile_id}, headers=auth_headers)
        assert r.status_code == 409

    def test_unknown_profile_404(self, client: TestClient, auth_headers: dict) -> None:
        rid, _ = _create_club_lobby(client, auth_headers)
        r = client.post(
            f"/api/registrations/{rid}/registrant",
            json={"player_name": "Ghost", "profile_id": "does-not-exist"},
            headers=auth_headers,
        )
        assert r.status_code == 404

    def test_add_without_profile_still_works(self, client: TestClient, auth_headers: dict) -> None:
        rid, _ = _create_club_lobby(client, auth_headers)
        r = client.post(f"/api/registrations/{rid}/registrant", json={"player_name": "Ana"}, headers=auth_headers)
        assert r.status_code == 200
        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert detail["registrants"][0]["profile_id"] is None
