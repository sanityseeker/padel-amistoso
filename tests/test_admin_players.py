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
    is_ghost: bool = False,
) -> str:
    """Insert a player_profiles row and return the profile ID."""
    profile_id = str(uuid.uuid4())
    passphrase = passphrase or f"pp-{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (profile_id, passphrase, name, email, contact, now, 1 if is_ghost else 0),
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


def _insert_club(cid: str = "c-test", club_id: str = "club-test") -> str:
    """Insert a minimal community and club row and return the club ID."""
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
            (cid, "Test Community", "admin", now),
        )
        conn.execute(
            """INSERT OR IGNORE INTO clubs
               (id, community_id, name, logo_path, email_settings, created_by, created_at)
               VALUES (?, ?, ?, NULL, NULL, ?, ?)""",
            (club_id, cid, "Test Club", "admin", now),
        )
    return club_id


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

    def test_delete_profile_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.delete("/api/admin/player-profiles/fake", headers=alice_headers)
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

    def test_list_filter_by_club(self, client: TestClient, auth_headers: dict) -> None:
        alice = _insert_profile(name="Alice", email="alice@example.com")
        _insert_profile(name="Bob", email="bob@example.com")
        carol = _insert_profile(name="Carol", email="carol@example.com")
        club = _insert_club(cid="comm-x", club_id="club-x")
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, 'padel', 1000, 0, 0)",
                (alice, club),
            )
            # Carol is in the club but hidden — should not appear.
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, 'padel', 1000, 0, 1)",
                (carol, club),
            )
        resp = client.get(f"/api/admin/player-profiles?club_id={club}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        names = {p["name"] for p in data}
        assert names == {"Alice"}

    def test_list_filter_by_community(self, client: TestClient, auth_headers: dict) -> None:
        alice = _insert_profile(name="Alice", email="alice@example.com")
        _insert_profile(name="Bob", email="bob@example.com")
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
                ("comm-y", "Y Community", "admin", "2026-01-01T00:00:00+00:00"),
            )
            conn.execute(
                "INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)"
                " VALUES (?, 'comm-y', 'padel', 1000, 0)",
                (alice,),
            )
        resp = client.get("/api/admin/player-profiles?community_id=comm-y", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        names = {p["name"] for p in data}
        assert names == {"Alice"}

    def test_list_filter_by_club_combined_with_query(self, client: TestClient, auth_headers: dict) -> None:
        alice = _insert_profile(name="Alice", email="alice@example.com")
        bob = _insert_profile(name="Bob", email="bob@example.com")
        club = _insert_club(cid="comm-z", club_id="club-z")
        with db_mod.get_db() as conn:
            for pid in (alice, bob):
                conn.execute(
                    "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                    " VALUES (?, ?, 'padel', 1000, 0, 0)",
                    (pid, club),
                )
        resp = client.get(f"/api/admin/player-profiles?club_id={club}&q=ali", headers=auth_headers)
        data = resp.json()
        assert {p["name"] for p in data} == {"Alice"}


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

    def test_link_already_linked_relinks_to_new_profile(self, client: TestClient, auth_headers: dict) -> None:
        """Linking a player already linked to a different profile re-links it."""
        pid = _insert_profile(name="Alice")
        other_pid = _insert_profile(name="Bob", email="bob@example.com", passphrase="unique-phrase-bob")
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Alice", profile_id=other_pid)

        resp = client.post(f"/api/admin/player-profiles/{pid}/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 200
        # Verify the link was updated to the new profile
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = 't1' AND player_id = 'p1'"
            ).fetchone()
            assert row["profile_id"] == pid

    def test_link_same_profile_idempotent(self, client: TestClient, auth_headers: dict) -> None:
        """Linking to the same profile that's already linked returns success."""
        pid = _insert_profile(name="Alice")
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Alice", profile_id=pid)

        resp = client.post(f"/api/admin/player-profiles/{pid}/link/t1/p1", headers=auth_headers)
        assert resp.status_code == 200

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
# Delete profile
# ────────────────────────────────────────────────────────────────────────────


class TestDeleteProfile:
    def test_delete_profile_removes_profile_bound_data(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Delete Me", email="deleteme@example.com")
        _insert_tournament("t1")
        _insert_player_secret("t1", "p1", "Delete Me", profile_id=pid)
        _insert_history(pid, "t1", "p1", player_name="Delete Me", tournament_name="T1")

        club_id = _insert_club()
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches) VALUES (?, 'open', 'padel', 1100, 4)",
                (pid,),
            )
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches) VALUES (?, ?, 'padel', 1090, 3)",
                (pid, club_id),
            )
            conn.execute(
                """INSERT INTO player_tournament_path_cache
                   (profile_id, entity_id, player_id, tournament_version, payload)
                   VALUES (?, 't1', 'p1', 1, '{}')""",
                (pid,),
            )

        resp = client.delete(f"/api/admin/player-profiles/{pid}", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        with db_mod.get_db() as conn:
            profile = conn.execute("SELECT 1 FROM player_profiles WHERE id = ?", (pid,)).fetchone()
            history = conn.execute("SELECT 1 FROM player_history WHERE profile_id = ?", (pid,)).fetchone()
            community_elo = conn.execute("SELECT 1 FROM profile_community_elo WHERE profile_id = ?", (pid,)).fetchone()
            club_elo = conn.execute("SELECT 1 FROM profile_club_elo WHERE profile_id = ?", (pid,)).fetchone()
            path_cache = conn.execute(
                "SELECT 1 FROM player_tournament_path_cache WHERE profile_id = ?",
                (pid,),
            ).fetchone()
            secret = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = 't1' AND player_id = 'p1'",
            ).fetchone()

        assert profile is None
        assert history is None
        assert community_elo is None
        assert club_elo is None
        assert path_cache is None
        assert secret is not None
        assert secret["profile_id"] is None

    def test_delete_profile_not_found(self, client: TestClient, auth_headers: dict) -> None:
        resp = client.delete("/api/admin/player-profiles/non-existent-profile", headers=auth_headers)
        assert resp.status_code == 404

    def test_delete_ghost_profile_purges_secrets_and_elo_log(self, client: TestClient, auth_headers: dict) -> None:
        """Deleting a ghost must remove its participations entirely so the
        player no longer reappears as a 'past participant'."""
        ghost_id = _insert_profile(name="1", email="", is_ghost=True)
        _insert_tournament("t-ghost")
        _insert_player_secret("t-ghost", "p-ghost-1", "1", profile_id=ghost_id, tournament_name="Test")
        _insert_history(ghost_id, "t-ghost", "p-ghost-1", player_name="1", tournament_name="Test")

        now = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO player_elo_log
                   (tournament_id, sport, match_id, player_id, match_order,
                    elo_before, elo_after, elo_delta, match_payload, updated_at)
                   VALUES ('t-ghost', 'padel', 'm1', 'p-ghost-1', 0,
                           1000, 1010, 10, '{}', ?)""",
                (now,),
            )

        resp = client.delete(f"/api/admin/player-profiles/{ghost_id}", headers=auth_headers)
        assert resp.status_code == 200

        with db_mod.get_db() as conn:
            secret = conn.execute(
                "SELECT 1 FROM player_secrets WHERE tournament_id = 't-ghost' AND player_id = 'p-ghost-1'"
            ).fetchone()
            elo_log = conn.execute(
                "SELECT 1 FROM player_elo_log WHERE tournament_id = 't-ghost' AND player_id = 'p-ghost-1'"
            ).fetchone()

        assert secret is None, "ghost participation should be fully purged, not unlinked"
        assert elo_log is None, "ghost ELO log entries should be purged"

        # And the past-participants endpoint must no longer surface this player.
        resp = client.get("/api/admin/player-profiles/past-participants?q=1", headers=auth_headers)
        assert resp.status_code == 200
        assert all(p["player_id"] != "p-ghost-1" for p in resp.json())


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


# ────────────────────────────────────────────────────────────────────────────
# K-factor override
# ────────────────────────────────────────────────────────────────────────────


class TestKFactorOverride:
    def test_update_k_factor_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.put(
            "/api/admin/player-profiles/fake/k-factor", headers=alice_headers, json={"k_factor_override": 30}
        )
        assert resp.status_code == 403

    def test_set_k_factor_override(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        resp = client.put(
            f"/api/admin/player-profiles/{pid}/k-factor", headers=auth_headers, json={"k_factor_override": 30}
        )
        assert resp.status_code == 200
        assert resp.json()["k_factor_override"] == 30

        # Verify it shows up in profile detail
        detail = client.get(f"/api/admin/player-profiles/{pid}", headers=auth_headers).json()
        assert detail["k_factor_override"] == 30

    def test_clear_k_factor_override(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        # Set it first
        client.put(f"/api/admin/player-profiles/{pid}/k-factor", headers=auth_headers, json={"k_factor_override": 50})
        # Clear it
        resp = client.put(
            f"/api/admin/player-profiles/{pid}/k-factor", headers=auth_headers, json={"k_factor_override": None}
        )
        assert resp.status_code == 200
        assert resp.json()["k_factor_override"] is None

        detail = client.get(f"/api/admin/player-profiles/{pid}", headers=auth_headers).json()
        assert detail["k_factor_override"] is None

    def test_k_factor_in_list_profiles(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Bob")
        client.put(f"/api/admin/player-profiles/{pid}/k-factor", headers=auth_headers, json={"k_factor_override": 25})

        profiles = client.get("/api/admin/player-profiles", headers=auth_headers).json()
        bob = next(p for p in profiles if p["id"] == pid)
        assert bob["k_factor_override"] == 25

    def test_k_factor_not_found(self, client: TestClient, auth_headers: dict) -> None:
        resp = client.put(
            "/api/admin/player-profiles/nonexistent/k-factor", headers=auth_headers, json={"k_factor_override": 30}
        )
        assert resp.status_code == 404

    def test_k_factor_validation_too_high(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        resp = client.put(
            f"/api/admin/player-profiles/{pid}/k-factor", headers=auth_headers, json={"k_factor_override": 300}
        )
        assert resp.status_code == 422

    def test_k_factor_validation_too_low(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Alice")
        resp = client.put(
            f"/api/admin/player-profiles/{pid}/k-factor", headers=auth_headers, json={"k_factor_override": 0}
        )
        assert resp.status_code == 422


# ────────────────────────────────────────────────────────────────────────────
# Past participants search
# ────────────────────────────────────────────────────────────────────────────


class TestPastParticipants:
    def test_returns_unlinked_player_secrets(self, client: TestClient, auth_headers: dict) -> None:
        _insert_tournament("t-past-1", "Past Tourney")
        _insert_player_secret("t-past-1", "pp-pid-1", "Ghostie García")

        resp = client.get("/api/admin/player-profiles/past-participants?q=Ghostie", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert any(p["name"] == "Ghostie García" and p["player_id"] == "pp-pid-1" for p in data)

    def test_excludes_linked_players(self, client: TestClient, auth_headers: dict) -> None:
        pid = _insert_profile(name="Linked Player")
        _insert_tournament("t-past-2", "Linked Tourney")
        _insert_player_secret("t-past-2", "pp-pid-linked", "Linked Player", profile_id=pid)

        resp = client.get("/api/admin/player-profiles/past-participants?q=Linked", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert not any(p["player_id"] == "pp-pid-linked" for p in data)

    def test_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.get("/api/admin/player-profiles/past-participants", headers=alice_headers)
        assert resp.status_code == 403

    def test_name_filter_is_case_insensitive(self, client: TestClient, auth_headers: dict) -> None:
        _insert_tournament("t-past-3", "Filter Tourney")
        _insert_player_secret("t-past-3", "pp-pid-2", "FilteredName")

        resp = client.get("/api/admin/player-profiles/past-participants?q=filteredname", headers=auth_headers)
        assert resp.status_code == 200
        assert any(p["player_id"] == "pp-pid-2" for p in resp.json())

    def test_empty_query_returns_recent_participants(self, client: TestClient, auth_headers: dict) -> None:
        _insert_tournament("t-past-4", "Nofilter Tourney")
        _insert_player_secret("t-past-4", "pp-pid-3", "SomePlayerNF")

        resp = client.get("/api/admin/player-profiles/past-participants", headers=auth_headers)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)


# ────────────────────────────────────────────────────────────────────────────
# Ghost profile creation
# ────────────────────────────────────────────────────────────────────────────


class TestGhostProfileCreation:
    def test_creates_ghost_profile_with_is_ghost_flag(self, auth_headers: dict) -> None:
        from backend.api.routes_player_auth import _get_or_create_ghost_profile

        _insert_tournament("t-ghost-1", "Ghost Tourney")
        _insert_player_secret("t-ghost-1", "ghost-pid-1", "Ghost Player")

        ghost_id = _get_or_create_ghost_profile("ghost-pid-1", "Ghost Player")

        assert ghost_id == "ghost_ghost-pid-1"
        with db_mod.get_db() as conn:
            row = conn.execute("SELECT name, is_ghost, email FROM player_profiles WHERE id = ?", (ghost_id,)).fetchone()
        assert row is not None
        assert row["name"] == "Ghost Player"
        assert row["is_ghost"] == 1
        assert row["email"] == ""

    def test_ghost_profile_creation_is_idempotent(self, auth_headers: dict) -> None:
        from backend.api.routes_player_auth import _get_or_create_ghost_profile

        _insert_tournament("t-ghost-2", "Ghost Tourney 2")
        _insert_player_secret("t-ghost-2", "ghost-pid-2", "Repeated Player")

        id1 = _get_or_create_ghost_profile("ghost-pid-2", "Repeated Player")
        id2 = _get_or_create_ghost_profile("ghost-pid-2", "Repeated Player")

        assert id1 == id2

        with db_mod.get_db() as conn:
            count = conn.execute("SELECT COUNT(*) FROM player_profiles WHERE id = ?", (id1,)).fetchone()[0]
        assert count == 1

    def test_ghost_profile_links_prior_player_secrets(self, auth_headers: dict) -> None:
        from backend.api.routes_player_auth import _get_or_create_ghost_profile

        _insert_tournament("t-ghost-3", "Ghost Tourney 3")
        _insert_player_secret("t-ghost-3", "ghost-pid-3", "Link Test Player")

        ghost_id = _get_or_create_ghost_profile("ghost-pid-3", "Link Test Player")

        with db_mod.get_db() as conn:
            row = conn.execute("SELECT profile_id FROM player_secrets WHERE player_id = ?", ("ghost-pid-3",)).fetchone()
        assert row is not None
        assert row["profile_id"] == ghost_id

    def test_is_ghost_flag_visible_in_admin_list(self, client: TestClient, auth_headers: dict) -> None:
        from backend.api.routes_player_auth import _get_or_create_ghost_profile

        _insert_tournament("t-ghost-4", "Ghost Tourney 4")
        _insert_player_secret("t-ghost-4", "ghost-pid-4", "Admin List Ghost")

        ghost_id = _get_or_create_ghost_profile("ghost-pid-4", "Admin List Ghost")

        resp = client.get("/api/admin/player-profiles?q=Admin List Ghost", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        ghost_entry = next((p for p in data if p["id"] == ghost_id), None)
        assert ghost_entry is not None
        assert ghost_entry["is_ghost"] is True


# ────────────────────────────────────────────────────────────────────────────
# Ghost profile consolidation
# ────────────────────────────────────────────────────────────────────────────


def _insert_ghost_profile(player_id: str, name: str) -> str:
    """Insert a ghost player_profiles row and return its id."""
    import secrets as _secrets

    ghost_id = f"ghost_{player_id}"
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO player_profiles
               (id, passphrase, name, email, contact, created_at, is_ghost)
               VALUES (?, ?, ?, '', '', ?, 1)""",
            (ghost_id, _secrets.token_hex(16), name, now),
        )
    return ghost_id


def _insert_player_elo(tournament_id: str, player_id: str, elo_after: float, matches: int = 1) -> None:
    """Insert a player_elo row representing a finished tournament result."""
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO player_elo
               (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)
               VALUES (?, ?, 'padel', 1000.0, ?, ?, ?)""",
            (tournament_id, player_id, elo_after, matches, now),
        )


class TestGhostProfileConsolidation:
    """Consolidating ghost profiles merges stats and ELO correctly."""

    def test_consolidate_merges_two_ghosts(self, client: TestClient, auth_headers: dict) -> None:
        pid1 = "cg-pid-1"
        pid2 = "cg-pid-2"
        ghost1 = _insert_ghost_profile(pid1, "Ros A")
        ghost2 = _insert_ghost_profile(pid2, "Ros B")

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost1, ghost2], "name": "Ros"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == ghost1
        assert data["name"] == "Ros"
        assert data["is_ghost"] is True

        # Secondary profile is deleted
        with db_mod.get_db() as conn:
            row = conn.execute("SELECT id FROM player_profiles WHERE id = ?", (ghost2,)).fetchone()
        assert row is None

    def test_consolidate_reassigns_history_to_primary(self, client: TestClient, auth_headers: dict) -> None:
        pid1 = "cg-pid-h1"
        pid2 = "cg-pid-h2"
        ghost1 = _insert_ghost_profile(pid1, "Hist A")
        ghost2 = _insert_ghost_profile(pid2, "Hist B")
        _insert_tournament("cg-t-h1", "Hist T1")
        _insert_tournament("cg-t-h2", "Hist T2")
        _insert_history(ghost1, "cg-t-h1", pid1, player_name="Hist A", wins=3)
        _insert_history(ghost2, "cg-t-h2", pid2, player_name="Hist B", wins=2)

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost1, ghost2]},
        )
        assert resp.status_code == 200

        with db_mod.get_db() as conn:
            rows = conn.execute("SELECT entity_id FROM player_history WHERE profile_id = ?", (ghost1,)).fetchall()
            history_tids = {r["entity_id"] for r in rows}

        # Both tournament history rows should now belong to ghost1
        assert "cg-t-h1" in history_tids
        assert "cg-t-h2" in history_tids

    def test_consolidate_recalculates_elo(self, client: TestClient, auth_headers: dict) -> None:
        pid1 = "cg-pid-e1"
        pid2 = "cg-pid-e2"
        ghost1 = _insert_ghost_profile(pid1, "Elo A")
        ghost2 = _insert_ghost_profile(pid2, "Elo B")
        _insert_tournament("cg-t-e1", "Elo T1")
        _insert_tournament("cg-t-e2", "Elo T2")
        _insert_player_elo("cg-t-e1", pid1, elo_after=1080.0, matches=5)
        _insert_player_elo("cg-t-e2", pid2, elo_after=1120.0, matches=8)
        # Link both player_ids to their respective ghost profiles via player_history
        _insert_history(ghost1, "cg-t-e1", pid1, wins=3)
        _insert_history(ghost2, "cg-t-e2", pid2, wins=5)

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost1, ghost2]},
        )
        assert resp.status_code == 200

        # ELO should now reflect the most recent tournament (1120), and matches
        # should be the SUM across all merged ghosts (5 + 8 = 13). Before the
        # fix, matches were overwritten with the last tournament's count (8),
        # which understated the player's true match count in community/global
        # leaderboards and the admin panel.
        data = resp.json()
        assert data["elo_padel_matches"] == 13
        assert abs(data["elo_padel"] - 1120.0) < 0.01

    def test_consolidate_requires_auth(self, client: TestClient) -> None:
        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            json={"source_ids": ["a", "b"]},
        )
        assert resp.status_code == 401

    def test_consolidate_requires_admin(self, client: TestClient, alice_headers: dict) -> None:
        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=alice_headers,
            json={"source_ids": ["a", "b"]},
        )
        assert resp.status_code == 403

    def test_consolidate_rejects_multiple_non_ghost(self, client: TestClient, auth_headers: dict) -> None:
        """Two non-ghost (Hub) profiles in the list must be rejected."""
        pid1 = "cg-pid-ng1"
        ghost1 = _insert_ghost_profile(pid1, "Ghost")
        regular1 = _insert_profile(name="Hub Player 1")
        regular2 = _insert_profile(name="Hub Player 2")

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost1, regular1, regular2]},
        )
        assert resp.status_code == 422
        assert "non-ghost" in resp.json()["detail"].lower()

    def test_consolidate_rejects_all_non_ghost(self, client: TestClient, auth_headers: dict) -> None:
        """A list with no ghost profiles at all must be rejected."""
        regular1 = _insert_profile(name="Hub Player A")
        regular2 = _insert_profile(name="Hub Player B")

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [regular1, regular2]},
        )
        assert resp.status_code == 422
        assert "ghost" in resp.json()["detail"].lower()

    def test_consolidate_rejects_single_id(self, client: TestClient, auth_headers: dict) -> None:
        pid1 = "cg-pid-s1"
        ghost1 = _insert_ghost_profile(pid1, "Solo Ghost")

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost1]},
        )
        assert resp.status_code == 422

    def test_consolidate_404_for_missing_profile(self, client: TestClient, auth_headers: dict) -> None:
        pid1 = "cg-pid-m1"
        ghost1 = _insert_ghost_profile(pid1, "Existing Ghost")

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost1, "nonexistent-ghost-id"]},
        )
        assert resp.status_code == 404

    def test_consolidate_optional_name_preserved_when_omitted(self, client: TestClient, auth_headers: dict) -> None:
        pid1 = "cg-pid-n1"
        pid2 = "cg-pid-n2"
        ghost1 = _insert_ghost_profile(pid1, "Original Name")
        ghost2 = _insert_ghost_profile(pid2, "Other Ghost")

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost1, ghost2]},
        )
        assert resp.status_code == 200
        # When no name provided, primary retains its original name
        assert resp.json()["name"] == "Original Name"

    def test_consolidate_deduplicated_ids(self, client: TestClient, auth_headers: dict) -> None:
        """Passing the same id twice should be treated as a single-id request."""
        pid1 = "cg-pid-d1"
        ghost1 = _insert_ghost_profile(pid1, "Dup Ghost")

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost1, ghost1]},
        )
        assert resp.status_code == 422

    def test_consolidate_ghost_into_hub_profile(self, client: TestClient, auth_headers: dict) -> None:
        """A non-ghost Hub profile can be used as the merge target; ghosts are absorbed into it."""
        from backend.api.db import get_db

        pid_ghost = "cg-hub-g1"
        hub_id = _insert_profile(name="Hub Player")
        ghost_id = _insert_ghost_profile(pid_ghost, "Ghost Player")

        # Link the ghost to a player_secret so history is reassignable
        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO player_secrets (player_id, tournament_id, player_name, passphrase)"
                " VALUES (?, 'x', 'Ghost Player', 'x')",
                (pid_ghost,),
            )
            conn.execute(
                "UPDATE player_secrets SET profile_id = ? WHERE player_id = ?",
                (ghost_id, pid_ghost),
            )

        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [hub_id, ghost_id]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == hub_id
        assert data["is_ghost"] is False, "Hub profile must remain non-ghost after merge"

        # Ghost profile should be deleted
        get_resp = client.get(f"/api/admin/player-profiles/{ghost_id}", headers=auth_headers)
        assert get_resp.status_code == 404

    def test_consolidate_ghost_into_hub_forces_hub_as_primary(self, client: TestClient, auth_headers: dict) -> None:
        """Even if hub profile is not listed first, it becomes the primary."""
        from backend.api.db import get_db

        pid_ghost = "cg-hub-g2"
        hub_id = _insert_profile(name="Hub Primary")
        ghost_id = _insert_ghost_profile(pid_ghost, "Ghost Secondary")

        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO player_secrets (player_id, tournament_id, player_name, passphrase)"
                " VALUES (?, 'y', 'Ghost Secondary', 'y')",
                (pid_ghost,),
            )
            conn.execute(
                "UPDATE player_secrets SET profile_id = ? WHERE player_id = ?",
                (ghost_id, pid_ghost),
            )

        # Ghost listed first, hub second — hub should still become primary
        resp = client.post(
            "/api/admin/player-profiles/consolidate-ghosts",
            headers=auth_headers,
            json={"source_ids": [ghost_id, hub_id]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == hub_id
        assert data["is_ghost"] is False


# ---------------------------------------------------------------------------
# Ghost → Hub profile conversion
# ---------------------------------------------------------------------------


class TestGhostConvert:
    """Converting a ghost profile into a real Player Hub profile."""

    def test_convert_generates_passphrase_and_clears_ghost_flag(self, client: TestClient, auth_headers: dict) -> None:
        """Converted profile has is_ghost=False and a usable 3-word passphrase."""
        pid = "cv-pid-1"
        ghost_id = _insert_ghost_profile(pid, "Convert Me")

        resp = client.post(
            f"/api/admin/player-profiles/{ghost_id}/convert-ghost",
            headers=auth_headers,
            json={},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["is_ghost"] is False
        assert data["id"] == ghost_id
        phrase = data.get("passphrase", "")
        # 3-word passphrases are hyphen-separated words; the old hex token has no hyphens
        assert phrase.count("-") >= 2, f"Expected 3-word passphrase (hyphen-separated), got: {phrase!r}"

    def test_convert_renames_profile_when_name_given(self, client: TestClient, auth_headers: dict) -> None:
        """Optional name parameter updates the profile name on conversion."""
        pid = "cv-pid-2"
        ghost_id = _insert_ghost_profile(pid, "Old Name")

        resp = client.post(
            f"/api/admin/player-profiles/{ghost_id}/convert-ghost",
            headers=auth_headers,
            json={"name": "New Name"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New Name"

    def test_convert_sets_email_when_provided(self, client: TestClient, auth_headers: dict) -> None:
        """Email provided during conversion is persisted on the profile."""
        pid = "cv-pid-3"
        ghost_id = _insert_ghost_profile(pid, "Email Ghost")

        resp = client.post(
            f"/api/admin/player-profiles/{ghost_id}/convert-ghost",
            headers=auth_headers,
            json={"email": "player@example.com"},
        )
        assert resp.status_code == 200
        assert resp.json()["email"] == "player@example.com"

    def test_convert_rejects_non_ghost_profile(self, client: TestClient, auth_headers: dict) -> None:
        """Attempting to convert a real profile returns 422."""
        import secrets as _secrets

        now = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
                " VALUES (?, ?, ?, '', '', ?, 0)",
                ("cv-real-1", _secrets.token_hex(8), "Real Player", now),
            )

        resp = client.post(
            "/api/admin/player-profiles/cv-real-1/convert-ghost",
            headers=auth_headers,
            json={},
        )
        assert resp.status_code == 422

    def test_convert_404_for_missing_profile(self, client: TestClient, auth_headers: dict) -> None:
        """Returns 404 when the profile does not exist."""
        resp = client.post(
            "/api/admin/player-profiles/ghost_does_not_exist_xyz/convert-ghost",
            headers=auth_headers,
            json={},
        )
        assert resp.status_code == 404

    def test_convert_rejects_invalid_email(self, client: TestClient, auth_headers: dict) -> None:
        """Invalid email address returns 422."""
        pid = "cv-pid-4"
        ghost_id = _insert_ghost_profile(pid, "Bad Email Ghost")

        resp = client.post(
            f"/api/admin/player-profiles/{ghost_id}/convert-ghost",
            headers=auth_headers,
            json={"email": "not-an-email"},
        )
        assert resp.status_code == 422

    def test_convert_passphrase_is_unique(self, client: TestClient, auth_headers: dict) -> None:
        """Two separately converted ghosts each receive distinct passphrases."""
        ghost_a = _insert_ghost_profile("cv-ua-1", "Ghost A")
        ghost_b = _insert_ghost_profile("cv-ub-1", "Ghost B")

        resp_a = client.post(
            f"/api/admin/player-profiles/{ghost_a}/convert-ghost",
            headers=auth_headers,
            json={},
        )
        resp_b = client.post(
            f"/api/admin/player-profiles/{ghost_b}/convert-ghost",
            headers=auth_headers,
            json={},
        )
        assert resp_a.status_code == 200
        assert resp_b.status_code == 200
        assert resp_a.json()["passphrase"] != resp_b.json()["passphrase"]
