"""Tests for the Player Space feature: profile CRUD, login, dashboard, and linking."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

import backend.api.db as db_mod
from backend.api import app
from backend.auth.security import create_profile_token


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _create_profile(
    client: TestClient,
    name: str = "Test Player",
    email: str = "test@example.com",
    *,
    participant_passphrase: str | None = None,
) -> dict:
    """Create a profile and return the full JSON response.

    If no participant_passphrase is provided, a dummy player_secret row is
    inserted automatically so the gating check passes.
    """
    if participant_passphrase is None:
        tid = f"t-auto-{uuid.uuid4().hex[:8]}"
        pid = f"p-auto-{uuid.uuid4().hex[:8]}"
        participant_passphrase = f"auto-pp-{uuid.uuid4().hex[:12]}"
        _insert_player_secret(tid, pid, name, participant_passphrase, uuid.uuid4().hex)
    res = client.post(
        "/api/player-profile",
        json={"name": name, "email": email, "participant_passphrase": participant_passphrase},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _profile_auth(client: TestClient, passphrase: str) -> str:
    """Return a valid Bearer header value for the given passphrase."""
    res = client.post("/api/player-profile/login", json={"passphrase": passphrase})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _insert_tournament(rid: str, name: str = "Test Tournament") -> None:
    """Insert a minimal tournaments row so foreign-key joins resolve."""
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO tournaments
               (id, name, type, owner, public, tournament_blob, version, sport)
               VALUES (?, ?, 'group_playoff', 'admin', 1, ?, 0, 'padel')""",
            (rid, name, b""),
        )


def _insert_player_secret(
    tournament_id: str,
    player_id: str,
    player_name: str,
    passphrase: str,
    token: str,
    profile_id: str | None = None,
) -> None:
    """Write a row into player_secrets (test DB only)."""
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO player_secrets
               (tournament_id, player_id, player_name, passphrase, token, contact, email, profile_id)
               VALUES (?, ?, ?, ?, ?, '', '', ?)""",
            (tournament_id, player_id, player_name, passphrase, token, profile_id),
        )


def _insert_registration(rid: str, name: str = "Test Lobby") -> None:
    """Insert a minimal registrations row."""
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO registrations
               (id, name, owner, open, sport, converted_to_tids, created_at)
               VALUES (?, ?, 'admin', 1, 'padel', '[]', ?)""",
            (rid, name, now),
        )


def _insert_registrant(
    registration_id: str,
    player_id: str,
    player_name: str,
    passphrase: str,
    token: str,
    profile_id: str | None = None,
) -> None:
    """Write a row into registrants (test DB only)."""
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO registrants
               (registration_id, player_id, player_name, passphrase, token, email, registered_at, profile_id)
               VALUES (?, ?, ?, ?, ?, '', ?, ?)""",
            (registration_id, player_id, player_name, passphrase, token, now, profile_id),
        )


# ────────────────────────────────────────────────────────────────────────────
# Profile creation
# ────────────────────────────────────────────────────────────────────────────


class TestCreateProfile:
    def test_create_returns_token_and_empty_entries(self, client: TestClient) -> None:
        data = _create_profile(client)
        assert "access_token" in data
        assert data["entries"] == []
        assert data["profile"]["id"]

    def test_create_stores_name_and_email(self, client: TestClient) -> None:
        data = _create_profile(client, name="Alice Padel", email="alice@example.com")
        assert data["profile"]["name"] == "Alice Padel"
        assert data["profile"]["email"] == "alice@example.com"

    def test_create_generates_unique_passphrases(self, client: TestClient) -> None:
        for i in range(5):
            data = _create_profile(client, name=f"Player {i}")
            # Retrieve the passphrase via login: create then immediately login shows it's stored
            profile = data["profile"]
            assert profile["id"]
        # Verify all profile IDs are distinct (passphrase uniqueness checked separately via login)
        ids = [_create_profile(client, name=f"P{i}")["profile"]["id"] for i in range(5)]
        assert len(set(ids)) == 5

    def test_create_passphrase_is_unique_across_profiles(self, client: TestClient) -> None:
        # Create several profiles and verify their passphrases (visible via DB) are distinct
        for i in range(5):
            _create_profile(client, name=f"P{i}")
        with db_mod.get_db() as conn:
            rows = conn.execute("SELECT passphrase FROM player_profiles").fetchall()
        passphrases = [r["passphrase"] for r in rows]
        assert len(set(passphrases)) == len(passphrases)

    def test_create_returns_created_at(self, client: TestClient) -> None:
        data = _create_profile(client)
        assert data["profile"]["created_at"]

    def test_create_empty_name_is_valid(self, client: TestClient) -> None:
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_player_secret(tid, pid, "Anon", pp, uuid.uuid4().hex)
        res = client.post("/api/player-profile", json={"email": "anon@example.com", "participant_passphrase": pp})
        assert res.status_code == 200
        assert res.json()["profile"]["name"] == ""

    def test_create_missing_email_returns_422(self, client: TestClient) -> None:
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_player_secret(tid, "p1", "No Email", pp, uuid.uuid4().hex)
        res = client.post("/api/player-profile", json={"name": "No Email", "participant_passphrase": pp})
        assert res.status_code == 422

    @pytest.mark.parametrize("bad_email", ["", "notanemail", "missing@", "@nodomain"])
    def test_create_invalid_email_returns_422(self, client: TestClient, bad_email: str) -> None:
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_player_secret(tid, "p1", "Bad Email", pp, uuid.uuid4().hex)
        res = client.post(
            "/api/player-profile", json={"name": "Bad Email", "email": bad_email, "participant_passphrase": pp}
        )
        assert res.status_code == 422

    def test_create_returns_finished_entries_after_backfill(self, client: TestClient) -> None:
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"
        finished_at = datetime.now(timezone.utc).isoformat()
        _insert_tournament(tid, "Finished Before Profile")
        with db_mod.get_db() as conn:
            conn.execute(
                """
                INSERT INTO player_secrets
                    (tournament_id, player_id, player_name, passphrase, token, finished_at, tournament_name)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (tid, pid, "Late Link", passphrase, uuid.uuid4().hex, finished_at, "Finished Before Profile"),
            )

        res = client.post(
            "/api/player-profile",
            json={
                "name": "Late Link",
                "email": "latelink@example.com",
                "participant_passphrase": passphrase,
            },
        )
        assert res.status_code == 200, res.text
        entries = res.json()["entries"]
        assert any(
            e["entity_type"] == "tournament" and e["entity_id"] == tid and e["status"] == "finished" for e in entries
        )


# ────────────────────────────────────────────────────────────────────────────
# Profile creation gating
# ────────────────────────────────────────────────────────────────────────────


class TestCreateProfileGating:
    def test_valid_tournament_passphrase_allows_create(self, client: TestClient) -> None:
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_player_secret(tid, pid, "Alice", pp, uuid.uuid4().hex)
        res = client.post(
            "/api/player-profile", json={"name": "Alice", "email": "alice@example.com", "participant_passphrase": pp}
        )
        assert res.status_code == 200

    def test_valid_registrant_passphrase_allows_create(self, client: TestClient) -> None:
        rid = f"r-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_registration(rid)
        _insert_registrant(rid, pid, "Bob", pp, uuid.uuid4().hex)
        res = client.post(
            "/api/player-profile", json={"name": "Bob", "email": "bob@example.com", "participant_passphrase": pp}
        )
        assert res.status_code == 200

    def test_unknown_passphrase_returns_401(self, client: TestClient) -> None:
        res = client.post(
            "/api/player-profile",
            json={"name": "Hacker", "email": "hacker@example.com", "participant_passphrase": "made-up-word"},
        )
        assert res.status_code == 401

    def test_missing_participant_passphrase_returns_422(self, client: TestClient) -> None:
        res = client.post("/api/player-profile", json={"name": "Ghost", "email": "ghost@example.com"})
        assert res.status_code == 422

    def test_create_auto_links_tournament_participation(self, client: TestClient) -> None:
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_player_secret(tid, pid, "Carlos", pp, uuid.uuid4().hex)
        data = client.post(
            "/api/player-profile",
            json={"name": "Carlos", "email": "carlos@example.com", "participant_passphrase": pp},
        ).json()
        profile_id = data["profile"]["id"]
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
                (tid, pid),
            ).fetchone()
        assert row["profile_id"] == profile_id

    def test_create_auto_links_registrant_participation(self, client: TestClient) -> None:
        rid = f"r-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_registration(rid)
        _insert_registrant(rid, pid, "Diana", pp, uuid.uuid4().hex)
        data = client.post(
            "/api/player-profile",
            json={"name": "Diana", "email": "diana@example.com", "participant_passphrase": pp},
        ).json()
        profile_id = data["profile"]["id"]
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM registrants WHERE registration_id = ? AND player_id = ?",
                (rid, pid),
            ).fetchone()
        assert row["profile_id"] == profile_id


# ────────────────────────────────────────────────────────────────────────────
# Profile login
# ────────────────────────────────────────────────────────────────────────────


class TestProfileLogin:
    def test_login_with_correct_passphrase_returns_token(self, client: TestClient) -> None:
        # Get passphrase from the DB row after creation
        _create_profile(client, name="LoginTest")
        with db_mod.get_db() as conn:
            row = conn.execute("SELECT passphrase FROM player_profiles ORDER BY created_at DESC LIMIT 1").fetchone()
        token = _profile_auth(client, row["passphrase"])
        assert isinstance(token, str) and len(token) > 20

    def test_login_returns_profile_info(self, client: TestClient) -> None:
        _create_profile(client, name="Profile Info Test", email="info@test.com")
        with db_mod.get_db() as conn:
            row = conn.execute("SELECT passphrase FROM player_profiles WHERE name = 'Profile Info Test'").fetchone()
        res = client.post("/api/player-profile/login", json={"passphrase": row["passphrase"]})
        assert res.status_code == 200
        assert res.json()["profile"]["name"] == "Profile Info Test"
        assert res.json()["profile"]["email"] == "info@test.com"

    def test_login_wrong_passphrase_returns_401(self, client: TestClient) -> None:
        _create_profile(client)
        res = client.post("/api/player-profile/login", json={"passphrase": "wrong-pass-word"})
        assert res.status_code == 401

    def test_login_empty_string_passphrase_rejected_422(self, client: TestClient) -> None:
        res = client.post("/api/player-profile/login", json={"passphrase": ""})
        assert res.status_code == 422

    def test_login_whitespace_passphrase_returns_401(self, client: TestClient) -> None:
        # Pydantic accepts a string of spaces (length >= 1); the route returns 401
        # because no profile has "   " as its passphrase.
        res = client.post("/api/player-profile/login", json={"passphrase": "   "})
        assert res.status_code == 401


# ────────────────────────────────────────────────────────────────────────────
# Player Space dashboard (GET /space)
# ────────────────────────────────────────────────────────────────────────────


class TestGetPlayerSpace:
    def test_unauthenticated_returns_401(self, client: TestClient) -> None:
        res = client.get("/api/player-profile/space")
        assert res.status_code == 401

    def test_invalid_token_returns_401(self, client: TestClient) -> None:
        res = client.get("/api/player-profile/space", headers={"Authorization": "Bearer bad.token.here"})
        assert res.status_code == 401

    def test_authenticated_returns_profile_and_entries(self, client: TestClient) -> None:
        created = _create_profile(client, name="Dashboard Test")
        token = created["access_token"]
        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert res.status_code == 200
        data = res.json()
        assert data["profile"]["name"] == "Dashboard Test"
        assert isinstance(data["entries"], list)

    def test_empty_dashboard_has_no_entries(self, client: TestClient) -> None:
        created = _create_profile(client)
        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        assert res.json()["entries"] == []

    def test_dashboard_includes_linked_tournament(self, client: TestClient) -> None:
        created = _create_profile(client, name="With Tournament")
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "My Tournament")
        _insert_player_secret(tid, pid, "PlayerA", "brave-tiny-cat", "tok-abc", profile_id)

        token = created["access_token"]
        res = client.get("/api/player-profile/space", headers=_headers(token))
        entries = res.json()["entries"]
        assert any(e["entity_id"] == tid and e["entity_type"] == "tournament" for e in entries)

    def test_dashboard_includes_linked_registration(self, client: TestClient) -> None:
        created = _create_profile(client, name="With Registration")
        profile_id = created["profile"]["id"]

        rid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_registration(rid, "My Lobby")
        _insert_registrant(rid, pid, "PlayerB", "quick-blue-dog", "tok-def", profile_id)

        token = created["access_token"]
        res = client.get("/api/player-profile/space", headers=_headers(token))
        entries = res.json()["entries"]
        assert any(e["entity_id"] == rid and e["entity_type"] == "registration" for e in entries)

    def test_dashboard_excludes_archived_registration_from_active_entries(self, client: TestClient) -> None:
        created = _create_profile(client, name="Archived Lobby")
        profile_id = created["profile"]["id"]

        rid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_registration(rid, "Archived Lobby")
        with db_mod.get_db() as conn:
            conn.execute("UPDATE registrations SET archived = 1 WHERE id = ?", (rid,))
        _insert_registrant(rid, pid, "PlayerB", "quiet-green-owl", "tok-ghi", profile_id)

        token = created["access_token"]
        res = client.get("/api/player-profile/space", headers=_headers(token))
        entries = res.json()["entries"]
        assert not any(e["entity_id"] == rid and e["entity_type"] == "registration" for e in entries)

    def test_dashboard_excludes_closed_registration_from_active_entries(self, client: TestClient) -> None:
        created = _create_profile(client, name="Closed Lobby")
        profile_id = created["profile"]["id"]

        rid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_registration(rid, "Closed Lobby")
        with db_mod.get_db() as conn:
            conn.execute("UPDATE registrations SET open = 0 WHERE id = ?", (rid,))
        _insert_registrant(rid, pid, "PlayerC", "calm-red-fox", "tok-jkl", profile_id)

        token = created["access_token"]
        res = client.get("/api/player-profile/space", headers=_headers(token))
        entries = res.json()["entries"]
        assert not any(e["entity_id"] == rid and e["entity_type"] == "registration" for e in entries)

    def test_dashboard_entry_has_auto_login_token(self, client: TestClient) -> None:
        created = _create_profile(client)
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        _insert_tournament(tid)
        _insert_player_secret(tid, "p1", "P1", "pass-a-b", "my-tok-xyz", profile_id)

        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        entry = next(e for e in res.json()["entries"] if e["entity_id"] == tid)
        assert entry["auto_login_token"] == "my-tok-xyz"
        assert entry["status"] == "active"

    def test_dashboard_history_entry_has_no_token(self, client: TestClient) -> None:
        created = _create_profile(client)
        profile_id = created["profile"]["id"]

        eid = str(uuid.uuid4())
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO player_history (profile_id, entity_type, entity_id, player_id, player_name, finished_at) VALUES (?, ?, ?, ?, ?, ?)",
                (profile_id, "tournament", eid, "p1", "PlayerX", datetime.now(timezone.utc).isoformat()),
            )

        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        entry = next(e for e in res.json()["entries"] if e["entity_id"] == eid)
        assert entry["auto_login_token"] is None
        assert entry["status"] == "finished"

    def test_dashboard_history_entry_includes_full_partner_rival_arrays(self, client: TestClient) -> None:
        created = _create_profile(client)
        profile_id = created["profile"]["id"]

        eid = str(uuid.uuid4())
        top_partners = [{"id": "p2", "name": "Bob", "games": 5, "wins": 4, "win_pct": 80}]
        top_rivals = [{"id": "p3", "name": "Carol", "games": 4, "wins": 1, "win_pct": 25}]
        all_partners = [
            {"id": "p2", "name": "Bob", "games": 5, "wins": 4, "win_pct": 80},
            {"id": "p4", "name": "Dan", "games": 2, "wins": 1, "win_pct": 50},
        ]
        all_rivals = [
            {"id": "p3", "name": "Carol", "games": 4, "wins": 1, "win_pct": 25},
            {"id": "p5", "name": "Eve", "games": 3, "wins": 2, "win_pct": 67},
        ]
        with db_mod.get_db() as conn:
            conn.execute(
                """
                INSERT INTO player_history (
                    profile_id, entity_type, entity_id, player_id, player_name, finished_at,
                    top_partners, top_rivals, all_partners, all_rivals
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    profile_id,
                    "tournament",
                    eid,
                    "p1",
                    "Alice",
                    datetime.now(timezone.utc).isoformat(),
                    json.dumps(top_partners),
                    json.dumps(top_rivals),
                    json.dumps(all_partners),
                    json.dumps(all_rivals),
                ),
            )

        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        entry = next(e for e in res.json()["entries"] if e["entity_id"] == eid)
        assert entry["top_partners"] == top_partners
        assert entry["top_rivals"] == top_rivals
        assert entry["all_partners"] == all_partners
        assert entry["all_rivals"] == all_rivals

    def test_dashboard_finished_tournament_not_classified_as_active(self, client: TestClient) -> None:
        created = _create_profile(client)
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "Finished Cup")

        finished_at = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                """
                INSERT INTO player_secrets
                    (tournament_id, player_id, player_name, passphrase, token, profile_id, finished_at, tournament_name)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (tid, pid, "PlayerZ", "pp-finished-z", "tok-finished-z", profile_id, finished_at, "Finished Cup"),
            )
            conn.execute(
                """
                INSERT INTO player_history
                    (profile_id, entity_type, entity_id, entity_name, player_id, player_name, finished_at)
                VALUES (?, 'tournament', ?, ?, ?, ?, ?)
                """,
                (profile_id, tid, "Finished Cup", pid, "PlayerZ", finished_at),
            )

        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        assert res.status_code == 200
        entries = [e for e in res.json()["entries"] if e["entity_id"] == tid and e["entity_type"] == "tournament"]
        assert len(entries) == 1
        assert entries[0]["status"] == "finished"
        assert entries[0]["auto_login_token"] is None

    def test_dashboard_response_includes_fresh_token(self, client: TestClient) -> None:
        created = _create_profile(client)
        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        assert res.json()["access_token"]  # refreshed token present


# ────────────────────────────────────────────────────────────────────────────
# Profile update (PUT)
# ────────────────────────────────────────────────────────────────────────────


class TestUpdateProfile:
    def test_update_name_and_email(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]
        res = client.put(
            "/api/player-profile", json={"name": "Updated", "email": "new@test.com"}, headers=_headers(token)
        )
        assert res.status_code == 200
        assert res.json()["name"] == "Updated"
        assert res.json()["email"] == "new@test.com"

    def test_update_unauthenticated_returns_401(self, client: TestClient) -> None:
        res = client.put("/api/player-profile", json={"name": "X"})
        assert res.status_code == 401

    def test_update_strips_whitespace(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]
        res = client.put(
            "/api/player-profile", json={"name": "  Alice  ", "email": "  a@b.com  "}, headers=_headers(token)
        )
        assert res.json()["name"] == "Alice"
        assert res.json()["email"] == "a@b.com"

    def test_update_persists_in_dashboard(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]
        client.put("/api/player-profile", json={"name": "Persistent"}, headers=_headers(token))
        space = client.get("/api/player-profile/space", headers=_headers(token))
        assert space.json()["profile"]["name"] == "Persistent"


# ────────────────────────────────────────────────────────────────────────────
# Link participation (POST /link)
# ────────────────────────────────────────────────────────────────────────────


class TestLinkParticipation:
    def test_link_tournament_participaton_by_passphrase(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "Linkable Tournament")
        _insert_player_secret(tid, pid, "Linker", "link-pass-a", "link-tok-a")

        res = client.post(
            "/api/player-profile/link",
            json={"entity_type": "tournament", "entity_id": tid, "passphrase": "link-pass-a"},
            headers=_headers(token),
        )
        assert res.status_code == 200
        data = res.json()
        assert data["entity_id"] == tid
        assert data["entity_type"] == "tournament"
        assert data["auto_login_token"] == "link-tok-a"

    def test_link_registration_participation_by_passphrase(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]

        rid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_registration(rid, "Linkable Lobby")
        _insert_registrant(rid, pid, "RegLinker", "link-pass-b", "link-tok-b")

        res = client.post(
            "/api/player-profile/link",
            json={"entity_type": "registration", "entity_id": rid, "passphrase": "link-pass-b"},
            headers=_headers(token),
        )
        assert res.status_code == 200
        assert res.json()["entity_id"] == rid

    def test_link_wrong_passphrase_returns_401(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]

        tid = str(uuid.uuid4())
        _insert_tournament(tid)
        _insert_player_secret(tid, "p1", "P1", "real-pass-x", "tok-x")

        res = client.post(
            "/api/player-profile/link",
            json={"entity_type": "tournament", "entity_id": tid, "passphrase": "wrong-pass-x"},
            headers=_headers(token),
        )
        assert res.status_code == 401

    def test_link_unauthenticated_returns_401(self, client: TestClient) -> None:
        tid = str(uuid.uuid4())
        res = client.post(
            "/api/player-profile/link",
            json={"entity_type": "tournament", "entity_id": tid, "passphrase": "some-pass"},
        )
        assert res.status_code == 401

    def test_link_invalid_entity_type_returns_422(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]
        tid = str(uuid.uuid4())
        res = client.post(
            "/api/player-profile/link",
            json={"entity_type": "invalid", "entity_id": tid, "passphrase": "x"},
            headers=_headers(token),
        )
        assert res.status_code == 422

    def test_linked_tournament_appears_in_dashboard(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]

        tid = str(uuid.uuid4())
        _insert_tournament(tid, "Dashboard After Link")
        _insert_player_secret(tid, "px", "PX", "dashboard-after-link", "tok-pal")

        client.post(
            "/api/player-profile/link",
            json={"entity_type": "tournament", "entity_id": tid, "passphrase": "dashboard-after-link"},
            headers=_headers(token),
        )

        res = client.get("/api/player-profile/space", headers=_headers(token))
        entries = res.json()["entries"]
        assert any(e["entity_id"] == tid for e in entries)

    def test_link_sets_profile_id_in_db(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        _insert_tournament(tid)
        _insert_player_secret(tid, "pz", "PZ", "set-profile-pp", "tok-pz")

        client.post(
            "/api/player-profile/link",
            json={"entity_type": "tournament", "entity_id": tid, "passphrase": "set-profile-pp"},
            headers=_headers(token),
        )

        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = ? AND passphrase = ?",
                (tid, "set-profile-pp"),
            ).fetchone()
        assert row["profile_id"] == profile_id


# ────────────────────────────────────────────────────────────────────────────
# Profile JWT edge cases
# ────────────────────────────────────────────────────────────────────────────


class TestProfileJWT:
    def test_manually_crafted_profile_token_grants_access(self, client: TestClient) -> None:
        created = _create_profile(client, name="JWT Test")
        profile_id = created["profile"]["id"]
        token = create_profile_token(profile_id)
        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert res.status_code == 200
        assert res.json()["profile"]["name"] == "JWT Test"

    def test_admin_token_cannot_access_profile_space(self, client: TestClient) -> None:
        from backend.auth.security import create_access_token

        admin_token = create_access_token("admin")
        res = client.get("/api/player-profile/space", headers=_headers(admin_token))
        assert res.status_code == 401

    def test_player_token_cannot_access_profile_space(self, client: TestClient) -> None:
        from backend.auth.security import create_player_token

        player_token = create_player_token("t1", "p1")
        res = client.get("/api/player-profile/space", headers=_headers(player_token))
        assert res.status_code == 401

    def test_nonexistent_profile_id_in_token_returns_404(self, client: TestClient) -> None:
        fake_token = create_profile_token(str(uuid.uuid4()))
        res = client.get("/api/player-profile/space", headers=_headers(fake_token))
        assert res.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Passphrase recovery
# ────────────────────────────────────────────────────────────────────────────


class TestRecoverPassphrase:
    def test_recover_known_email_returns_200(self, client: TestClient) -> None:
        _create_profile(client, name="Recover Test", email="recover@example.com")
        res = client.post("/api/player-profile/recover", json={"email": "recover@example.com"})
        assert res.status_code == 200
        assert res.json() == {"ok": True}

    def test_recover_unknown_email_still_returns_200(self, client: TestClient) -> None:
        # Must not leak whether the email exists
        res = client.post("/api/player-profile/recover", json={"email": "nobody@nowhere.com"})
        assert res.status_code == 200
        assert res.json() == {"ok": True}

    def test_recover_case_insensitive_email_match(self, client: TestClient) -> None:
        _create_profile(client, name="CaseTest", email="Case@Example.COM")
        # Lower-cased lookup should still find it
        res = client.post("/api/player-profile/recover", json={"email": "case@example.com"})
        assert res.status_code == 200

    def test_recover_invalid_email_does_not_raise_validation_error(self, client: TestClient) -> None:
        # Invalid email silently does nothing; rate limiter may fire in test runs (429 also acceptable)
        res = client.post("/api/player-profile/recover", json={"email": "notanemail"})
        assert res.status_code in (200, 429)

    def test_recover_missing_email_returns_422(self, client: TestClient) -> None:
        res = client.post("/api/player-profile/recover", json={})
        assert res.status_code == 422


# ────────────────────────────────────────────────────────────────────────────
# Auto-link at registration by email
# ────────────────────────────────────────────────────────────────────────────


class TestAutoLinkByEmail:
    def _create_lobby(self, client: TestClient, auth_headers: dict) -> str:
        """Create an open registration lobby and return its id."""
        r = client.post("/api/registrations", json={"name": "AutoLink Lobby"}, headers=auth_headers)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_auto_links_matching_email_to_profile(self, client: TestClient, auth_headers: dict) -> None:
        # Create a Player Space profile with a known email
        _create_profile(client, name="AutoLink Player", email="autolink@example.com")
        with db_mod.get_db() as conn:
            profile_row = conn.execute("SELECT id FROM player_profiles WHERE email = 'autolink@example.com'").fetchone()
        profile_id = profile_row["id"]

        rid = self._create_lobby(client, auth_headers)
        res = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "AutoLink Player", "email": "autolink@example.com"},
        )
        assert res.status_code == 200, res.text

        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM registrants WHERE registration_id = ? AND player_name = ?",
                (rid, "AutoLink Player"),
            ).fetchone()
        assert row["profile_id"] == profile_id

    def test_auto_link_sets_profile_passphrase_as_player_passphrase(
        self, client: TestClient, auth_headers: dict
    ) -> None:
        _create_profile(client, name="PP Test", email="pptest@example.com")
        with db_mod.get_db() as conn:
            pp_row = conn.execute(
                "SELECT passphrase FROM player_profiles WHERE email = 'pptest@example.com'"
            ).fetchone()
        global_pp = pp_row["passphrase"]

        rid = self._create_lobby(client, auth_headers)
        res = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "PP Test Player", "email": "pptest@example.com"},
        )
        assert res.status_code == 200
        # The registration response passphrase should be the global profile passphrase
        assert res.json()["passphrase"] == global_pp

    def test_no_profile_email_no_auto_link(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._create_lobby(client, auth_headers)
        res = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "No Link Player", "email": "noprofile@example.com"},
        )
        assert res.status_code == 200
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM registrants WHERE registration_id = ? AND player_name = ?",
                (rid, "No Link Player"),
            ).fetchone()
        assert row["profile_id"] is None

    def test_explicit_profile_passphrase_takes_priority_over_email(
        self, client: TestClient, auth_headers: dict
    ) -> None:
        # Create two profiles; one matches by email, one by explicit passphrase
        _create_profile(client, name="Profile1", email="p1@example.com")
        _create_profile(client, name="Profile2", email="p2@example.com")
        with db_mod.get_db() as conn:
            p2 = conn.execute("SELECT id, passphrase FROM player_profiles WHERE email = 'p2@example.com'").fetchone()

        rid = self._create_lobby(client, auth_headers)
        res = client.post(
            f"/api/registrations/{rid}/register",
            json={
                "player_name": "Priority Test",
                "email": "p1@example.com",  # would auto-link to p1
                "profile_passphrase": p2["passphrase"],  # explicitly linked to p2
            },
        )
        assert res.status_code == 200
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM registrants WHERE registration_id = ? AND player_name = ?",
                (rid, "Priority Test"),
            ).fetchone()
        # Explicit passphrase wins → linked to p2, not p1
        assert row["profile_id"] == p2["id"]


# ────────────────────────────────────────────────────────────────────────────
# History stats — rank, W/L stored when secrets are purged
# ────────────────────────────────────────────────────────────────────────────


class TestHistoryStats:
    def _insert_history_row(
        self,
        profile_id: str,
        entity_id: str,
        *,
        entity_name: str = "Test Tournament",
        rank: int | None = None,
        total_players: int | None = None,
        wins: int = 0,
        losses: int = 0,
        draws: int = 0,
        points_for: int = 0,
        points_against: int = 0,
    ) -> None:
        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO player_history
                   (profile_id, entity_type, entity_id, entity_name, player_id, player_name, finished_at,
                    rank, total_players, wins, losses, draws, points_for, points_against)
                   VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    profile_id,
                    entity_id,
                    entity_name,
                    "p-h",
                    "Player H",
                    datetime.now(timezone.utc).isoformat(),
                    rank,
                    total_players,
                    wins,
                    losses,
                    draws,
                    points_for,
                    points_against,
                ),
            )

    def test_history_entry_stores_entity_name_and_survives_without_live_tournament(self, client: TestClient) -> None:
        """entity_name persists in the row even if the tournament row no longer exists."""
        created = _create_profile(client)
        profile_id = created["profile"]["id"]
        eid = str(uuid.uuid4())
        self._insert_history_row(profile_id, eid, entity_name="Winter Cup")

        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        entry = next(e for e in res.json()["entries"] if e["entity_id"] == eid)
        assert entry["entity_name"] == "Winter Cup"
        assert entry["entity_deleted"] is True

    def test_history_entry_marks_live_tournament_as_not_deleted(self, client: TestClient) -> None:
        created = _create_profile(client)
        profile_id = created["profile"]["id"]
        eid = str(uuid.uuid4())
        _insert_tournament(eid, name="Live Cup")
        self._insert_history_row(profile_id, eid, entity_name="Live Cup")

        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        entry = next(e for e in res.json()["entries"] if e["entity_id"] == eid)
        assert entry["entity_deleted"] is False

    def test_dashboard_history_returns_rank_total_wl(self, client: TestClient) -> None:
        created = _create_profile(client)
        profile_id = created["profile"]["id"]
        eid = str(uuid.uuid4())
        self._insert_history_row(
            profile_id,
            eid,
            entity_name="Trophy Open",
            rank=1,
            total_players=10,
            wins=7,
            losses=2,
            draws=0,
            points_for=35,
            points_against=18,
        )

        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        entry = next(e for e in res.json()["entries"] if e["entity_id"] == eid)
        assert entry["entity_name"] == "Trophy Open"
        assert entry["rank"] == 1
        assert entry["total_players"] == 10
        assert entry["wins"] == 7
        assert entry["losses"] == 2
        assert entry["draws"] == 0
        assert entry["points_for"] == 35
        assert entry["points_against"] == 18

    def test_dashboard_history_defaults_stats_when_not_stored(self, client: TestClient) -> None:
        """Rows without stats (e.g. legacy rows) default to 0 / None via the API."""
        created = _create_profile(client)
        profile_id = created["profile"]["id"]
        eid = str(uuid.uuid4())
        # Insert with explicit nulls / zeros
        self._insert_history_row(profile_id, eid, entity_name="Old Cup")

        res = client.get("/api/player-profile/space", headers=_headers(created["access_token"]))
        entry = next(e for e in res.json()["entries"] if e["entity_id"] == eid)
        assert entry["rank"] is None
        assert entry["wins"] == 0
        assert entry["losses"] == 0


# ────────────────────────────────────────────────────────────────────────────
# Registration deletion → history snapshot
# ────────────────────────────────────────────────────────────────────────────


class TestRegistrationHistorySnapshot:
    def test_delete_registration_creates_history_for_linked_profile(
        self, client: TestClient, auth_headers: dict
    ) -> None:
        created = _create_profile(client)
        profile_id = created["profile"]["id"]

        rid = str(uuid.uuid4())
        _insert_registration(rid, name="Spring Lobby")

        # Insert a registrant linked to the profile
        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO registrants
                   (registration_id, player_id, player_name, passphrase, token, email, registered_at, profile_id)
                   VALUES (?, ?, ?, ?, ?, '', datetime('now'), ?)""",
                (rid, "reg-p1", "Lobby Player", "pp-lobby", "tok-lobby", profile_id),
            )

        res = client.delete(f"/api/registrations/{rid}", headers=auth_headers)
        assert res.status_code == 200

        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT entity_type, entity_name FROM player_history WHERE profile_id = ? AND entity_id = ?",
                (profile_id, rid),
            ).fetchone()
        assert row is not None
        assert row["entity_type"] == "registration"
        assert row["entity_name"] == "Spring Lobby"

    def test_delete_registration_without_linked_profiles_writes_no_history(
        self, client: TestClient, auth_headers: dict
    ) -> None:
        rid = str(uuid.uuid4())
        _insert_registration(rid, name="Ghost Lobby")

        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO registrants
                   (registration_id, player_id, player_name, passphrase, token, email, registered_at)
                   VALUES (?, ?, ?, ?, ?, '', datetime('now'))""",
                (rid, "unreg-p", "No Profile", "pp-np", "tok-np"),
            )

        res = client.delete(f"/api/registrations/{rid}", headers=auth_headers)
        assert res.status_code == 200

        with db_mod.get_db() as conn:
            row = conn.execute("SELECT 1 FROM player_history WHERE entity_id = ?", (rid,)).fetchone()
        assert row is None  # nothing written — no linked profiles


# ────────────────────────────────────────────────────────────────────────────
# Team mode → individual stats expansion
# ────────────────────────────────────────────────────────────────────────────


class TestTeamStatsExpansion:
    """Verify that composite-team stats are correctly expanded to individual members."""

    def test_expand_team_matches_replaces_composite_players(self) -> None:
        """_expand_team_matches should expand composite team players to individual members."""
        from types import SimpleNamespace

        from backend.api.player_secret_store import _expand_team_matches

        team_roster = {"team-ab": ["alice-id", "bob-id"], "team-cd": ["charlie-id", "dave-id"]}
        team_member_names = {"team-ab": ["Alice", "Bob"], "team-cd": ["Charlie", "Dave"]}
        matches = [
            SimpleNamespace(
                id="m1",
                team1=[SimpleNamespace(id="team-ab", name="Alice & Bob")],
                team2=[SimpleNamespace(id="team-cd", name="Charlie & Dave")],
                score=(6, 3),
            ),
        ]

        expanded = _expand_team_matches(matches, team_roster, team_member_names)
        assert len(expanded) == 1
        m = expanded[0]
        assert len(m.team1) == 2
        assert {p.id for p in m.team1} == {"alice-id", "bob-id"}
        assert {p.name for p in m.team1} == {"Alice", "Bob"}
        assert len(m.team2) == 2
        assert {p.id for p in m.team2} == {"charlie-id", "dave-id"}
        assert m.score == (6, 3)

    def test_expand_team_matches_noop_when_no_roster(self) -> None:
        """When team_roster is empty, matches should be returned unchanged."""
        from types import SimpleNamespace

        from backend.api.player_secret_store import _expand_team_matches

        matches = [
            SimpleNamespace(
                id="m1",
                team1=[SimpleNamespace(id="p1", name="Player 1")],
                team2=[SimpleNamespace(id="p2", name="Player 2")],
                score=(4, 6),
            ),
        ]
        result = _expand_team_matches(matches, {}, {})
        assert result is matches  # exact same list, not a copy

    def test_extract_history_stats_expands_team_to_individuals_gp(self) -> None:
        """extract_history_stats should produce entries for individual members of GP teams."""
        from backend.api.player_secret_store import extract_history_stats
        from backend.models import Court, Player
        from backend.tournaments.group_playoff import GroupPlayoffTournament

        # Create 6 individual players → 3 composite teams (min 3 for a group)
        alice = Player(name="Alice")
        bob = Player(name="Bob")
        charlie = Player(name="Charlie")
        dave = Player(name="Dave")
        eve = Player(name="Eve")
        frank = Player(name="Frank")

        team_ab = Player(name="Alice & Bob")
        team_cd = Player(name="Charlie & Dave")
        team_ef = Player(name="Eve & Frank")

        team_roster = {
            team_ab.id: [alice.id, bob.id],
            team_cd.id: [charlie.id, dave.id],
            team_ef.id: [eve.id, frank.id],
        }
        team_member_names = {
            team_ab.id: ["Alice", "Bob"],
            team_cd.id: ["Charlie", "Dave"],
            team_ef.id: ["Eve", "Frank"],
        }

        t = GroupPlayoffTournament(
            players=[team_ab, team_cd, team_ef],
            num_groups=1,
            courts=[Court(name="C1")],
            top_per_group=2,
            team_mode=True,
            team_roster=team_roster,
            team_member_names=team_member_names,
        )
        t.generate()

        # Score all group matches so standings exist
        group = t.groups[0]
        for match in group.matches:
            t.record_group_result(match.id, (6, 3))

        t_data = {"type": "group_playoff", "tournament": t}
        stats = extract_history_stats(t_data)

        # Composite team stats should be present
        assert team_ab.id in stats
        assert team_cd.id in stats
        assert team_ef.id in stats

        # Individual member stats should also be present
        for mid in [alice.id, bob.id]:
            assert mid in stats, f"individual member {mid} should be in stats"
            assert stats[mid]["wins"] == stats[team_ab.id]["wins"]
            assert stats[mid]["losses"] == stats[team_ab.id]["losses"]

        for mid in [charlie.id, dave.id]:
            assert mid in stats
            assert stats[mid]["wins"] == stats[team_cd.id]["wins"]

    def test_extract_partner_rival_stats_individuals_gp(self) -> None:
        """extract_partner_rival_stats should produce partner/rival data for individual members."""
        from backend.api.player_secret_store import extract_partner_rival_stats
        from backend.models import Court, Player
        from backend.tournaments.group_playoff import GroupPlayoffTournament

        alice = Player(name="Alice")
        bob = Player(name="Bob")
        charlie = Player(name="Charlie")
        dave = Player(name="Dave")
        eve = Player(name="Eve")
        frank = Player(name="Frank")

        team_ab = Player(name="Alice & Bob")
        team_cd = Player(name="Charlie & Dave")
        team_ef = Player(name="Eve & Frank")

        team_roster = {
            team_ab.id: [alice.id, bob.id],
            team_cd.id: [charlie.id, dave.id],
            team_ef.id: [eve.id, frank.id],
        }
        team_member_names = {
            team_ab.id: ["Alice", "Bob"],
            team_cd.id: ["Charlie", "Dave"],
            team_ef.id: ["Eve", "Frank"],
        }

        t = GroupPlayoffTournament(
            players=[team_ab, team_cd, team_ef],
            num_groups=1,
            courts=[Court(name="C1")],
            top_per_group=2,
            team_mode=True,
            team_roster=team_roster,
            team_member_names=team_member_names,
        )
        t.generate()

        # Score all group matches
        group = t.groups[0]
        for match in group.matches:
            t.record_group_result(match.id, (6, 3))

        t_data = {"type": "group_playoff", "tournament": t}
        pr = extract_partner_rival_stats(t_data)

        # Alice's partner should be Bob, and rivals should include Charlie, Dave, Eve, or Frank
        assert alice.id in pr
        partners_of_alice = {e["id"] for e in pr[alice.id]["top_partners"]}
        rivals_of_alice = {e["id"] for e in pr[alice.id]["top_rivals"]}
        assert bob.id in partners_of_alice
        assert rivals_of_alice & {charlie.id, dave.id, eve.id, frank.id}

        # Bob's partner should be Alice
        assert bob.id in pr
        partners_of_bob = {e["id"] for e in pr[bob.id]["top_partners"]}
        assert alice.id in partners_of_bob

        # Composite team PIDs should NOT be in the result (no composite-composite pairing)
        assert team_ab.id not in pr
        assert team_cd.id not in pr
        assert team_ef.id not in pr

    def test_extract_history_stats_expands_team_to_individuals_mex(self) -> None:
        """extract_history_stats expands Mex team leaderboard to individual members."""
        from backend.api.player_secret_store import extract_history_stats
        from backend.models import Court, Player
        from backend.tournaments.mexicano import MexicanoTournament

        alice = Player(name="Alice")
        bob = Player(name="Bob")
        charlie = Player(name="Charlie")
        dave = Player(name="Dave")

        team_ab = Player(name="Alice & Bob")
        team_cd = Player(name="Charlie & Dave")

        team_roster = {team_ab.id: [alice.id, bob.id], team_cd.id: [charlie.id, dave.id]}
        team_member_names = {team_ab.id: ["Alice", "Bob"], team_cd.id: ["Charlie", "Dave"]}

        t = MexicanoTournament(
            players=[team_ab, team_cd],
            courts=[Court(name="C1")],
            num_rounds=1,
            team_mode=True,
        )
        t.team_roster = team_roster
        t.team_member_names = team_member_names

        # Generate round 1 and score it
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (20, 12))

        t_data = {"type": "mexicano", "tournament": t}
        stats = extract_history_stats(t_data)

        # Individual member stats should be present
        for mid in [alice.id, bob.id, charlie.id, dave.id]:
            assert mid in stats, f"member {mid} should have stats in Mex team mode"

    def test_extract_history_stats_playoff_uses_original_teams(self) -> None:
        """extract_history_stats for playoff type should use original_teams, not .players."""
        from backend.api.player_secret_store import extract_history_stats
        from backend.models import Court, Player
        from backend.tournaments.playoff_tournament import PlayoffTournament

        alice = Player(name="Alice")
        bob = Player(name="Bob")
        charlie = Player(name="Charlie")
        dave = Player(name="Dave")

        t = PlayoffTournament(
            teams=[[alice, bob], [charlie, dave]],
            courts=[Court(name="C1")],
            team_mode=True,
        )

        t_data = {"type": "playoff", "tournament": t}
        stats = extract_history_stats(t_data)

        # All individual players should have stats (not empty dict)
        assert len(stats) == 4
        for p in [alice, bob, charlie, dave]:
            assert p.id in stats
            assert stats[p.id]["total_players"] == 4
            assert stats[p.id]["rank"] is None  # no champion yet

    def test_extract_history_stats_playoff_champion_gets_rank1(self) -> None:
        """Champion team members should receive rank=1 in playoff stats."""
        from backend.api.player_secret_store import extract_history_stats
        from backend.models import Court, Player
        from backend.tournaments.playoff_tournament import PlayoffTournament

        alice = Player(name="Alice")
        bob = Player(name="Bob")
        charlie = Player(name="Charlie")
        dave = Player(name="Dave")

        t = PlayoffTournament(
            teams=[[alice, bob], [charlie, dave]],
            courts=[Court(name="C1")],
            team_mode=True,
        )

        # Record a result so we have a champion
        match = t.pending_matches()[0]
        t.record_result(match.id, (6, 3))

        t_data = {"type": "playoff", "tournament": t}
        stats = extract_history_stats(t_data)

        champion = t.champion()
        assert champion is not None
        champion_ids = {p.id for p in champion}
        non_champion_ids = {alice.id, bob.id, charlie.id, dave.id} - champion_ids

        for cid in champion_ids:
            assert stats[cid]["rank"] == 1
            assert stats[cid]["wins"] == 1
            assert stats[cid]["losses"] == 0
            assert stats[cid]["draws"] == 0
        for nid in non_champion_ids:
            assert stats[nid]["rank"] is None
            assert stats[nid]["wins"] == 0
            assert stats[nid]["losses"] == 1
            assert stats[nid]["draws"] == 0
