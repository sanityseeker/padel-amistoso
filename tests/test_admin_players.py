"""Tests for the admin Player Hub management endpoints."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import backend.api.db as db_mod
from backend.api import app
from backend.auth.security import create_access_token


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def auth_headers() -> dict[str, str]:
    """Return Authorization headers with a valid admin JWT."""
    token = create_access_token("admin")
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def alice_headers() -> dict[str, str]:
    """Return Authorization headers for regular (non-admin) user alice."""
    token = create_access_token("alice")
    return {"Authorization": f"Bearer {token}"}


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _insert_profile(
    name: str = "Test Player",
    email: str = "test@example.com",
    contact: str = "",
    passphrase: str | None = None,
) -> str:
    """Insert a player_profiles row and return the profile ID."""
    profile_id = str(uuid.uuid4())
    passphrase = passphrase or f"pp-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (profile_id, passphrase, name, email, contact, now),
        )
    return profile_id


def _insert_tournament(tid: str, name: str = "Test Tournament") -> None:
    """Insert a minimal tournaments row."""
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO tournaments
               (id, name, type, owner, public, tournament_blob, version, sport)
               VALUES (?, ?, 'group_playoff', 'admin', 1, ?, 0, 'padel')""",
            (tid, name, b""),
        )


def _insert_player_secret(
    tournament_id: str,
    player_id: str,
    player_name: str,
    passphrase: str | None = None,
    token: str | None = None,
    profile_id: str | None = None,
    finished_at: str | None = None,
    tournament_name: str = "",
    finished_stats: str | None = None,
) -> None:
    """Insert a player_secrets row."""
    passphrase = passphrase or f"ps-{uuid.uuid4().hex[:12]}"
    token = token or uuid.uuid4().hex
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO player_secrets
               (tournament_id, player_id, player_name, passphrase, token,
                contact, email, profile_id, finished_at, tournament_name,
                finished_sport, finished_stats, finished_top_partners,
                finished_top_rivals, finished_all_partners, finished_all_rivals)
               VALUES (?, ?, ?, ?, ?, '', '', ?, ?, ?, 'padel', ?, '[]', '[]', '[]', '[]')""",
            (
                tournament_id,
                player_id,
                player_name,
                passphrase,
                token,
                profile_id,
                finished_at,
                tournament_name,
                finished_stats,
            ),
        )


def _insert_history(
    profile_id: str,
    tid: str,
    player_id: str,
    player_name: str = "Player",
    tournament_name: str = "Tourney",
    rank: int = 1,
    total_players: int = 4,
    wins: int = 3,
    losses: int = 0,
    draws: int = 0,
    points_for: int = 90,
    points_against: int = 50,
) -> None:
    """Insert a player_history row."""
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO player_history
               (profile_id, entity_type, entity_id, entity_name,
                player_id, player_name, finished_at,
                rank, total_players, wins, losses, draws,
                points_for, points_against, sport,
                top_partners, top_rivals, all_partners, all_rivals)
               VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'padel', '[]', '[]', '[]', '[]')""",
            (
                profile_id,
                tid,
                tournament_name,
                player_id,
                player_name,
                now,
                rank,
                total_players,
                wins,
                losses,
                draws,
                points_for,
                points_against,
            ),
        )


# ────────────────────────────────────────────────────────────────────────────
# Auth guards
# ────────────────────────────────────────────────────────────────────────────


class TestAuthGuards:
    """All endpoints must return 401/403 for unauthenticated/non-admin callers."""

    def test_list_profiles_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.get("/api/admin/player-profiles", headers=alice_headers)
        assert resp.status_code == 403

    def test_list_profiles_requires_auth(self, client: TestClient) -> None:
        resp = client.get("/api/admin/player-profiles")
        assert resp.status_code == 401

    def test_get_profile_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.get("/api/admin/player-profiles/fake-id", headers=alice_headers)
        assert resp.status_code == 403

    def test_link_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.post("/api/admin/player-profiles/fake/link/t1/p1", headers=alice_headers)
        assert resp.status_code == 403

    def test_unlink_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.delete("/api/admin/player-profiles/link/t1/p1", headers=alice_headers)
        assert resp.status_code == 403

    def test_reset_passphrase_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.post("/api/admin/player-profiles/fake/reset-passphrase", headers=alice_headers)
        assert resp.status_code == 403

    def test_update_email_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.put("/api/admin/player-profiles/fake/email", headers=alice_headers, json={"email": ""})
        assert resp.status_code == 403


# ────────────────────────────────────────────────────────────────────────────
# List profiles
# ────────────────────────────────────────────────────────────────────────────


class TestListProfiles:
    def test_list_empty(self, client: TestClient, auth_headers: dict) -> None:
        resp = client.get("/api/admin/player-profiles", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_returns_profiles(self, client: TestClient, auth_headers: dict) -> None:
        _insert_profile(name="Alice", email="alice@example.com")
        _insert_profile(name="Bob", email="bob@example.com")
        resp = client.get("/api/admin/player-profiles", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        names = {p["name"] for p in data}
        assert names == {"Alice", "Bob"}

    def test_list_filter_by_name(self, client: TestClient, auth_headers: dict) -> None:
        _insert_profile(name="Alice", email="alice@example.com")
        _insert_profile(name="Bob", email="bob@example.com")
        resp = client.get("/api/admin/player-profiles?q=ali", headers=auth_headers)
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Alice"

    def test_list_filter_by_email(self, client: TestClient, auth_headers: dict) -> None:
        _insert_profile(name="Alice", email="alice@example.com")
        _insert_profile(name="Bob", email="bob@other.com")
        resp = client.get("/api/admin/player-profiles?q=other.com", headers=auth_headers)
        data = resp.json()
        assert len(data) == 1
        assert data[0]["name"] == "Bob"


# ────────────────────────────────────────────────────────────────────────────
# Get profile detail
# ────────────────────────────────────────────────────────────────────────────


class TestGetProfileDetail:
    def test_not_found(self, client: TestClient, auth_headers: dict) -> None:
        resp = client.get("/api/admin/player-profiles/nonexistent", headers=auth_headers)
        assert resp.status_code == 404

    def test_returns_profile_with_participations(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice", email="alice@example.com")
        _insert_tournament("t1", "Tournament One")
        _insert_player_secret("t1", "p1", "Alice", profile_id=pid)

        resp = client.get(f"/api/admin/player-profiles/{pid}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Alice"
        assert data["email"] == "alice@example.com"
        assert len(data["participations"]) == 1
        assert data["participations"][0]["status"] == "active"
        assert data["participations"][0]["tournament_name"] == "Tournament One"

    def test_shows_finished_from_history(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Bob")
        _insert_history(pid, "t2", "p2", player_name="Bob", tournament_name="Old Tourney", rank=2, wins=5, losses=3)

        resp = client.get(f"/api/admin/player-profiles/{pid}", headers=auth_headers)
        data = resp.json()
        finished = [p for p in data["participations"] if p["status"] == "finished"]
        assert len(finished) == 1
        assert finished[0]["tournament_name"] == "Old Tourney"
        assert finished[0]["rank"] == 2
        assert finished[0]["wins"] == 5
        assert finished[0]["losses"] == 3


# ────────────────────────────────────────────────────────────────────────────
# Link participation
# ────────────────────────────────────────────────────────────────────────────


class TestLinkParticipation:
    def test_link_active_tournament(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        _insert_tournament("t1", "Tournament One")
        _insert_player_secret("t1", "p1", "Alice")

        resp = client.post(f"/api/admin/player-profiles/{pid}/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "active"

        # Verify profile_id is set on the player_secrets row.
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id='t1' AND player_id='p1'"
            ).fetchone()
        assert row["profile_id"] == pid

    def test_link_finished_tournament_creates_history(self, client: TestClient, auth_headers: dict) -> None:
        """Linking a finished tournament should backfill player_history and remove the player_secrets row."""
        pid = _insert_profile(name="Alice")
        _insert_tournament("t1", "Tournament One")
        stats = json.dumps(
            {"rank": 1, "total_players": 4, "wins": 3, "losses": 0, "draws": 0, "points_for": 90, "points_against": 50}
        )
        _insert_player_secret(
            "t1",
            "p1",
            "Alice",
            finished_at=datetime.now(timezone.utc).isoformat(),
            tournament_name="Tournament One",
            finished_stats=stats,
        )

        resp = client.post(f"/api/admin/player-profiles/{pid}/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "finished"

        # History row should exist.
        with db_mod.get_db() as conn:
            hist = conn.execute("SELECT * FROM player_history WHERE profile_id=? AND entity_id='t1'", (pid,)).fetchone()
        assert hist is not None
        assert hist["rank"] == 1
        assert hist["wins"] == 3

        # player_secrets row should be deleted after backfill.
        with db_mod.get_db() as conn:
            secret = conn.execute("SELECT 1 FROM player_secrets WHERE tournament_id='t1' AND player_id='p1'").fetchone()
        assert secret is None

    def test_link_already_linked_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        other_pid = _insert_profile(name="Bob", email="bob@example.com", passphrase="unique-phrase-bob")
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Alice", profile_id=other_pid)

        resp = client.post(f"/api/admin/player-profiles/{pid}/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 409

    def test_link_nonexistent_profile_returns_404(self, client: TestClient, auth_headers: dict) -> None:
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Alice")
        resp = client.post("/api/admin/player-profiles/bad-id/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 404

    def test_link_nonexistent_secret_returns_404(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile()
        resp = client.post(f"/api/admin/player-profiles/{pid}/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Unlink participation
# ────────────────────────────────────────────────────────────────────────────


class TestUnlinkParticipation:
    def test_unlink_active_tournament(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Alice", profile_id=pid)

        resp = client.delete("/api/admin/player-profiles/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "active"
        assert resp.json()["warning"] is None

        # profile_id should be NULL now.
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id='t1' AND player_id='p1'"
            ).fetchone()
        assert row["profile_id"] is None

    def test_unlink_finished_tournament_deletes_history(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        _insert_history(pid, "t1", "p1", player_name="Alice", tournament_name="T1", rank=1)

        resp = client.delete("/api/admin/player-profiles/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["status"] == "finished"
        assert resp.json()["warning"] is not None

        # History row should be gone.
        with db_mod.get_db() as conn:
            hist = conn.execute("SELECT 1 FROM player_history WHERE profile_id=? AND entity_id='t1'", (pid,)).fetchone()
        assert hist is None

    def test_unlink_not_found(self, client: TestClient, auth_headers: dict) -> None:
        resp = client.delete("/api/admin/player-profiles/link/t999/p999", headers=auth_headers)
        assert resp.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Reset passphrase
# ────────────────────────────────────────────────────────────────────────────


class TestResetPassphrase:
    def test_reset_returns_new_passphrase(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice", passphrase="old-pass-phrase")

        resp = client.post(f"/api/admin/player-profiles/{pid}/reset-passphrase", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["ok"] is True
        new_pp = data["passphrase"]
        assert new_pp != "old-pass-phrase"
        # Should be a valid coolname triple (3 words separated by hyphens).
        assert len(new_pp.split("-")) >= 2

        # DB should be updated.
        with db_mod.get_db() as conn:
            row = conn.execute("SELECT passphrase FROM player_profiles WHERE id=?", (pid,)).fetchone()
        assert row["passphrase"] == new_pp

    def test_reset_not_found(self, client: TestClient, auth_headers: dict) -> None:
        resp = client.post("/api/admin/player-profiles/bad-id/reset-passphrase", headers=auth_headers)
        assert resp.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Update email
# ────────────────────────────────────────────────────────────────────────────


class TestUpdateEmail:
    def test_update_email_propagates(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice", email="old@example.com")
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Alice", profile_id=pid)

        resp = client.put(
            f"/api/admin/player-profiles/{pid}/email",
            headers=auth_headers,
            json={"email": "new@example.com"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "new@example.com"

        # Profile should be updated.
        with db_mod.get_db() as conn:
            profile = conn.execute("SELECT email FROM player_profiles WHERE id=?", (pid,)).fetchone()
            assert profile["email"] == "new@example.com"

            # Active player_secrets should also be updated.
            secret = conn.execute(
                "SELECT email FROM player_secrets WHERE tournament_id='t1' AND player_id='p1'"
            ).fetchone()
            assert secret["email"] == "new@example.com"

    def test_update_email_clears(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice", email="old@example.com")

        resp = client.put(
            f"/api/admin/player-profiles/{pid}/email",
            headers=auth_headers,
            json={"email": ""},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == ""

    def test_update_email_not_found(self, client: TestClient, auth_headers: dict) -> None:
        resp = client.put(
            "/api/admin/player-profiles/bad-id/email",
            headers=auth_headers,
            json={"email": "x@example.com"},
        )
        assert resp.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Unlinked players listing
# ────────────────────────────────────────────────────────────────────────────


class TestUnlinkedPlayers:
    def test_returns_only_unlinked(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Alice", profile_id=pid)
        _insert_player_secret("t1", "p2", "Bob")

        resp = client.get("/api/admin/player-profiles/unlinked/t1", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["player_id"] == "p2"

    def test_returns_empty_when_all_linked(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Alice", profile_id=pid)

        resp = client.get("/api/admin/player-profiles/unlinked/t1", headers=auth_headers)
        data = resp.json()
        assert len(data) == 0
