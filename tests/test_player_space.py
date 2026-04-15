"""Tests for the Player Hub feature: profile CRUD, login, dashboard, and linking."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import backend.api.db as db_mod
from backend.api import app
from backend.api.player_secret_store import (
    delete_secrets_for_tournament as _real_delete_secrets,
    extract_history_stats,
    upsert_live_stats,
)
from backend.api.state import maybe_update_live_stats, _tournaments
from backend.auth.security import create_profile_email_verify_token, create_profile_token


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


def _insert_tournament(rid: str, name: str = "Test Tournament", alias: str | None = None) -> None:
    """Insert a minimal tournaments row so foreign-key joins resolve."""
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO tournaments
               (id, name, type, owner, public, tournament_blob, version, sport, alias)
               VALUES (?, ?, 'group_playoff', 'admin', 1, ?, 0, 'padel', ?)""",
            (rid, name, b"", alias),
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


def _insert_registration(rid: str, name: str = "Test Lobby", alias: str | None = None) -> None:
    """Insert a minimal registrations row."""
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR IGNORE INTO registrations
               (id, name, owner, open, sport, converted_to_tids, created_at, alias)
               VALUES (?, ?, 'admin', 1, 'padel', '[]', ?, ?)""",
            (rid, name, now, alias),
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
        assert data["profile"]["email_verified"] is False

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
# Player Hub dashboard (GET /space)
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

    def test_dashboard_active_tournament_includes_live_elo(self, client: TestClient) -> None:
        created = _create_profile(client, name="Live Elo")
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "Live Elo Tournament")
        _insert_player_secret(tid, pid, "LiveEloPlayer", "live-elo-pass", "tok-live-elo", profile_id)

        now = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                """
                INSERT INTO player_elo
                    (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)
                VALUES (?, ?, 'padel', ?, ?, ?, ?)
                """,
                (tid, pid, 1000.0, 1014.25, 1, now),
            )

        token = created["access_token"]
        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert res.status_code == 200
        entry = next(e for e in res.json()["entries"] if e["entity_id"] == tid and e["entity_type"] == "tournament")
        assert entry["status"] == "active"
        assert entry["elo_before"] == 1000.0
        assert entry["elo_after"] == 1014.25

    def test_dashboard_includes_recent_elo_history_rows(self, client: TestClient) -> None:
        created = _create_profile(client, name="Elo History")
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "Elo History Tournament")
        _insert_player_secret(tid, pid, "EloPlayer", "elo-history-pass", "tok-elo-history", profile_id)

        payload = {
            "match_id": "m-1",
            "score": [21, 17],
            "sets": [],
            "team1": [
                {"player_id": pid, "player_name": "EloPlayer", "elo_before": 1000.0, "elo_after": 1014.0},
                {"player_id": "p2", "player_name": "Mate", "elo_before": 1000.0, "elo_after": 1012.0},
            ],
            "team2": [
                {"player_id": "p3", "player_name": "Opp1", "elo_before": 1000.0, "elo_after": 988.0},
                {"player_id": "p4", "player_name": "Opp2", "elo_before": 1000.0, "elo_after": 986.0},
            ],
        }

        now = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                """
                INSERT INTO player_elo_log
                    (tournament_id, sport, match_id, player_id, match_order,
                     elo_before, elo_after, elo_delta, match_payload, updated_at)
                VALUES (?, 'padel', 'm-1', ?, 1, ?, ?, ?, ?, ?)
                """,
                (tid, pid, 1000.0, 1014.0, 14.0, json.dumps(payload), now),
            )

        token = created["access_token"]
        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert res.status_code == 200
        history = res.json()["elo_history"]
        assert len(history) == 1
        assert history[0]["tournament_id"] == tid
        assert history[0]["match_id"] == "m-1"
        assert history[0]["elo_delta"] == 14.0
        assert history[0]["score"] == [21, 17]
        assert history[0]["team1"][0]["player_id"] == pid

    def test_dashboard_elo_history_limit_query_param(self, client: TestClient) -> None:
        created = _create_profile(client, name="Elo Limit")
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "Elo Limit Tournament")
        _insert_player_secret(tid, pid, "EloLimitPlayer", "elo-limit-pass", "tok-elo-limit", profile_id)

        now = datetime.now(timezone.utc)
        with db_mod.get_db() as conn:
            for idx in range(12):
                payload = {
                    "match_id": f"m-{idx}",
                    "score": [21, 19],
                    "sets": [],
                    "team1": [
                        {
                            "player_id": pid,
                            "player_name": "EloLimitPlayer",
                            "elo_before": 1000.0,
                            "elo_after": 1001.0 + idx,
                        }
                    ],
                    "team2": [],
                }
                conn.execute(
                    """
                    INSERT INTO player_elo_log
                        (tournament_id, sport, match_id, player_id, match_order,
                         elo_before, elo_after, elo_delta, match_payload, updated_at)
                    VALUES (?, 'padel', ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        tid,
                        f"m-{idx}",
                        pid,
                        idx + 1,
                        1000.0 + idx,
                        1001.0 + idx,
                        1.0,
                        json.dumps(payload),
                        (now.replace(microsecond=0) if idx == 0 else now).isoformat(),
                    ),
                )

        token = created["access_token"]
        res = client.get("/api/player-profile/space?elo_history_limit=10", headers=_headers(token))
        assert res.status_code == 200
        assert len(res.json()["elo_history"]) == 10

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

    def test_link_tournament_by_alias_resolves_to_real_id(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "Alias Tournament", alias="my-alias-t")
        _insert_player_secret(tid, pid, "AliasPlayer", "alias-pass-t", "alias-tok-t")

        res = client.post(
            "/api/player-profile/link",
            json={"entity_type": "tournament", "entity_id": "my-alias-t", "passphrase": "alias-pass-t"},
            headers=_headers(token),
        )
        assert res.status_code == 200
        data = res.json()
        assert data["entity_id"] == tid
        assert data["auto_login_token"] == "alias-tok-t"

    def test_link_registration_by_alias_resolves_to_real_id(self, client: TestClient) -> None:
        created = _create_profile(client)
        token = created["access_token"]

        rid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_registration(rid, "Alias Lobby", alias="my-alias-r")
        _insert_registrant(rid, pid, "AliasReg", "alias-pass-r", "alias-tok-r")

        res = client.post(
            "/api/player-profile/link",
            json={"entity_type": "registration", "entity_id": "my-alias-r", "passphrase": "alias-pass-r"},
            headers=_headers(token),
        )
        assert res.status_code == 200
        assert res.json()["entity_id"] == rid


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

    def test_recover_unverified_email_still_returns_200(self, client: TestClient) -> None:
        _create_profile(client, name="Unverified", email="unverified@example.com")
        res = client.post("/api/player-profile/recover", json={"email": "unverified@example.com"})
        assert res.status_code in (200, 429)
        if res.status_code == 200:
            assert res.json() == {"ok": True}

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
        # Create and verify a Player Hub profile with a known email
        _create_profile(client, name="AutoLink Player", email="autolink@example.com")
        with db_mod.get_db() as conn:
            profile_row = conn.execute("SELECT id FROM player_profiles WHERE email = 'autolink@example.com'").fetchone()
        profile_id = profile_row["id"]
        verify_token = create_profile_email_verify_token(profile_id, "autolink@example.com")
        verify_res = client.post("/api/player-profile/verify-email", json={"token": verify_token})
        assert verify_res.status_code == 200

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
                "SELECT id, passphrase FROM player_profiles WHERE email = 'pptest@example.com'"
            ).fetchone()
        global_pp = pp_row["passphrase"]
        verify_token = create_profile_email_verify_token(pp_row["id"], "pptest@example.com")
        verify_res = client.post("/api/player-profile/verify-email", json={"token": verify_token})
        assert verify_res.status_code == 200

        rid = self._create_lobby(client, auth_headers)
        res = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "PP Test Player", "email": "pptest@example.com"},
        )
        assert res.status_code == 200
        # The registration response passphrase should be the global profile passphrase
        assert res.json()["passphrase"] == global_pp

    def test_unverified_email_does_not_auto_link(self, client: TestClient, auth_headers: dict) -> None:
        _create_profile(client, name="No Verify", email="noverify@example.com")
        with db_mod.get_db() as conn:
            profile_row = conn.execute("SELECT id FROM player_profiles WHERE email = 'noverify@example.com'").fetchone()

        rid = self._create_lobby(client, auth_headers)
        res = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "No Verify", "email": "noverify@example.com"},
        )
        assert res.status_code == 200
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM registrants WHERE registration_id = ? AND player_name = ?",
                (rid, "No Verify"),
            ).fetchone()
        assert row["profile_id"] is None
        assert profile_row["id"] is not None


class TestEmailVerification:
    def _create_lobby(self, client: TestClient, auth_headers: dict) -> str:
        r = client.post("/api/registrations", json={"name": "AutoLink Lobby"}, headers=auth_headers)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_verify_email_marks_profile_verified_and_links_by_email(self, client: TestClient) -> None:
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_tournament(tid, "Verify Cup")
        with db_mod.get_db() as conn:
            conn.execute(
                """
                INSERT INTO player_secrets
                    (tournament_id, player_id, player_name, passphrase, token, contact, email, profile_id)
                VALUES (?, ?, ?, ?, ?, '', ?, NULL)
                """,
                (tid, pid, "Verify Player", pp, uuid.uuid4().hex, "verify@example.com"),
            )

        created = _create_profile(
            client,
            name="Verify Player",
            email="verify@example.com",
            participant_passphrase=pp,
        )
        profile_id = created["profile"]["id"]

        with db_mod.get_db() as conn:
            before = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
                (tid, pid),
            ).fetchone()
        assert before["profile_id"] == profile_id

        tid_other = f"t-{uuid.uuid4().hex[:8]}"
        pid_other = f"p-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid_other, "Verify Cup 2")
        with db_mod.get_db() as conn:
            conn.execute(
                """
                INSERT INTO player_secrets
                    (tournament_id, player_id, player_name, passphrase, token, contact, email, profile_id)
                VALUES (?, ?, ?, ?, ?, '', ?, NULL)
                """,
                (
                    tid_other,
                    pid_other,
                    "Verify Player 2",
                    f"pp-{uuid.uuid4().hex[:12]}",
                    uuid.uuid4().hex,
                    "verify@example.com",
                ),
            )

        verify_token = create_profile_email_verify_token(profile_id, "verify@example.com")
        res = client.post("/api/player-profile/verify-email", json={"token": verify_token})
        assert res.status_code == 200
        assert res.json() == {"ok": True}

        with db_mod.get_db() as conn:
            prof = conn.execute("SELECT email_verified_at FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
            linked = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
                (tid_other, pid_other),
            ).fetchone()
        assert prof["email_verified_at"] is not None
        assert linked["profile_id"] == profile_id

    def test_verify_email_invalid_token_returns_400(self, client: TestClient) -> None:
        res = client.post("/api/player-profile/verify-email", json={"token": "bad-token"})
        assert res.status_code == 400

    def test_resend_verification_requires_auth(self, client: TestClient) -> None:
        res = client.post("/api/player-profile/resend-verification")
        assert res.status_code == 401

    def test_resend_verification_unverified_profile_returns_ok(self, client: TestClient) -> None:
        created = _create_profile(client, name="Resend", email="resend@example.com")
        token = created["access_token"]
        res = client.post("/api/player-profile/resend-verification", headers=_headers(token))
        assert res.status_code == 200
        assert res.json()["ok"] is True
        assert res.json()["already_verified"] is False

    def test_resend_verification_verified_profile_reports_already_verified(self, client: TestClient) -> None:
        created = _create_profile(client, name="Resend Verified", email="resendv@example.com")
        token = created["access_token"]
        profile_id = created["profile"]["id"]

        verify_token = create_profile_email_verify_token(profile_id, "resendv@example.com")
        verify_res = client.post("/api/player-profile/verify-email", json={"token": verify_token})
        assert verify_res.status_code == 200

        res = client.post("/api/player-profile/resend-verification", headers=_headers(token))
        assert res.status_code == 200
        assert res.json()["ok"] is True
        assert res.json()["already_verified"] is True

    def test_resend_verification_email_contains_verify_and_login_tokens(
        self, client: TestClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sent_html: list[str] = []

        monkeypatch.setattr("backend.email.SITE_URL", "https://example.com")

        def _capture_email(_to: str, _subject: str, html_body: str) -> None:
            sent_html.append(html_body)

        monkeypatch.setattr("backend.api.routes_player_space.send_email_background", _capture_email)

        created = _create_profile(client, name="Resend Link", email="resendlink@example.com")
        token = created["access_token"]

        res = client.post("/api/player-profile/resend-verification", headers=_headers(token))
        assert res.status_code == 200
        assert res.json()["ok"] is True
        assert res.json()["already_verified"] is False

        assert sent_html
        html_body = sent_html[-1]
        assert "#verify_token=" in html_body
        assert "&amp;token=" in html_body
        assert html_body.find("#verify_token=") < html_body.find("&amp;token=")

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
# Unlink a participation from the player's own profile
# ────────────────────────────────────────────────────────────────────────────


class TestUnlinkParticipation:
    def test_unlink_active_tournament(self, client: TestClient) -> None:
        created = _create_profile(client, name="Unlinker")
        token = created["access_token"]
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "Unlinkable Tournament")
        _insert_player_secret(tid, pid, "Unlinker", "unlink-pass-active", "tok-unl-a", profile_id)

        # Confirm it appears in dashboard
        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert any(e["entity_id"] == tid for e in res.json()["entries"])

        # Unlink
        res = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "tournament", "entity_id": tid},
            headers=_headers(token),
        )
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["status"] == "active"
        assert data["warning"] is None

        # Confirm profile_id is cleared in DB
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
                (tid, pid),
            ).fetchone()
        assert row["profile_id"] is None

        # Confirm it disappears from dashboard
        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert not any(e["entity_id"] == tid for e in res.json()["entries"])

    def test_unlink_finished_tournament_deletes_history(self, client: TestClient) -> None:
        created = _create_profile(client, name="History Unlinker")
        token = created["access_token"]
        profile_id = created["profile"]["id"]

        eid = str(uuid.uuid4())
        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO player_history
                   (profile_id, entity_type, entity_id, player_id, player_name, finished_at, wins, losses)
                   VALUES (?, 'tournament', ?, 'p1', 'History Unlinker', ?, 5, 3)""",
                (profile_id, eid, datetime.now(timezone.utc).isoformat()),
            )

        # Confirm finished entry exists in dashboard
        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert any(e["entity_id"] == eid and e["status"] == "finished" for e in res.json()["entries"])

        # Unlink
        res = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "tournament", "entity_id": eid},
            headers=_headers(token),
        )
        assert res.status_code == 200
        data = res.json()
        assert data["ok"] is True
        assert data["status"] == "finished"
        assert data["warning"] is not None

        # Confirm history row is deleted
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT 1 FROM player_history WHERE profile_id = ? AND entity_id = ?",
                (profile_id, eid),
            ).fetchone()
        assert row is None

        # Confirm it disappears from dashboard
        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert not any(e["entity_id"] == eid for e in res.json()["entries"])

    def test_unlink_finished_with_secrets_row(self, client: TestClient) -> None:
        """Finished tournament where the player_secrets row still exists."""
        created = _create_profile(client, name="SecretFinished")
        token = created["access_token"]
        profile_id = created["profile"]["id"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        finished_at = datetime.now(timezone.utc).isoformat()
        _insert_tournament(tid, "Finished With Secret")
        _insert_player_secret(tid, pid, "SecretFinished", "unlink-pass-fin", "tok-fin", profile_id)
        # Mark as finished
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE player_secrets SET finished_at = ? WHERE tournament_id = ? AND player_id = ?",
                (finished_at, tid, pid),
            )
            conn.execute(
                """INSERT INTO player_history
                   (profile_id, entity_type, entity_id, player_id, player_name, finished_at, wins, losses)
                   VALUES (?, 'tournament', ?, ?, 'SecretFinished', ?, 2, 1)""",
                (profile_id, tid, pid, finished_at),
            )

        res = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "tournament", "entity_id": tid},
            headers=_headers(token),
        )
        assert res.status_code == 200
        assert res.json()["status"] == "finished"

        # Both profile_id cleared in secrets and history row deleted
        with db_mod.get_db() as conn:
            sec = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
                (tid, pid),
            ).fetchone()
            hist = conn.execute(
                "SELECT 1 FROM player_history WHERE profile_id = ? AND entity_id = ?",
                (profile_id, tid),
            ).fetchone()
        assert sec["profile_id"] is None
        assert hist is None

    def test_unlink_not_found_returns_404(self, client: TestClient) -> None:
        created = _create_profile(client, name="Ghost Unlinker")
        token = created["access_token"]

        res = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "tournament", "entity_id": "nonexistent-tid"},
            headers=_headers(token),
        )
        assert res.status_code == 404

    def test_unlink_unauthenticated_returns_401(self, client: TestClient) -> None:
        res = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "tournament", "entity_id": "some-tid"},
        )
        assert res.status_code == 401

    def test_unlink_other_players_tournament_returns_404(self, client: TestClient) -> None:
        """A player cannot unlink a tournament owned by a different profile."""
        created_a = _create_profile(client, name="Owner A", email="a@example.com")
        created_b = _create_profile(client, name="Owner B", email="b@example.com")
        profile_a = created_a["profile"]["id"]
        token_b = created_b["access_token"]

        tid = str(uuid.uuid4())
        pid = str(uuid.uuid4())
        _insert_tournament(tid, "A's Tournament")
        _insert_player_secret(tid, pid, "Owner A", "cross-pass", "tok-cross", profile_a)

        # Profile B tries to unlink Profile A's tournament
        res = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "tournament", "entity_id": tid},
            headers=_headers(token_b),
        )
        assert res.status_code == 404

        # Profile A's link is unchanged
        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT profile_id FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
                (tid, pid),
            ).fetchone()
        assert row["profile_id"] == profile_a

    def test_unlink_registration_returns_422(self, client: TestClient) -> None:
        created = _create_profile(client, name="Reg Unlinker")
        token = created["access_token"]

        res = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "registration", "entity_id": "some-rid"},
            headers=_headers(token),
        )
        assert res.status_code == 422


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

    def test_dashboard_history_refreshes_stats_with_playoff_results(self, client: TestClient) -> None:
        from backend.models import Court, Player
        from backend.tournaments.group_playoff import GroupPlayoffTournament

        created = _create_profile(client)
        token = created["access_token"]
        profile_id = created["profile"]["id"]

        tid = f"t-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid, name="Refresh Cup")

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        t = GroupPlayoffTournament(
            players=[p1, p2, p3, p4],
            num_groups=1,
            courts=[Court(name="C1")],
            top_per_group=4,
            team_mode=True,
        )
        t.generate()
        for idx, match in enumerate(t.pending_group_matches()):
            if idx % 2 == 0:
                t.record_group_result(match.id, (10, 6))
            else:
                t.record_group_result(match.id, (6, 10))

        t.start_playoffs()
        po_match = next(
            m
            for m in t.pending_playoff_matches()
            if p1.id in {pp.id for pp in m.team1} or p1.id in {pp.id for pp in m.team2}
        )
        if p1.id in {pp.id for pp in po_match.team1}:
            t.record_playoff_result(po_match.id, (4, 10))
        else:
            t.record_playoff_result(po_match.id, (10, 4))

        _tournaments[tid] = {
            "name": "Refresh Cup",
            "type": "group_playoff",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        expected = extract_history_stats({"type": "group_playoff", "tournament": t})[p1.id]

        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO player_history
                   (profile_id, entity_type, entity_id, entity_name, player_id, player_name, finished_at,
                    rank, total_players, wins, losses, draws, points_for, points_against)
                   VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    profile_id,
                    tid,
                    "Refresh Cup",
                    p1.id,
                    p1.name,
                    datetime.now(timezone.utc).isoformat(),
                    None,
                    None,
                    0,
                    0,
                    0,
                    0,
                    0,
                ),
            )

        try:
            res = client.get("/api/player-profile/space", headers=_headers(token))
            assert res.status_code == 200, res.text
            entry = next(e for e in res.json()["entries"] if e["entity_id"] == tid)
            assert entry["playoff_stage"] == expected.get("playoff_stage")
            assert entry["playoff_stage_rank"] == expected.get("playoff_stage_rank")
            assert entry["wins"] == expected["wins"]
            assert entry["losses"] == expected["losses"]
            assert entry["draws"] == expected["draws"]
            assert entry["points_for"] == expected["points_for"]
            assert entry["points_against"] == expected["points_against"]
        finally:
            _tournaments.pop(tid, None)

    def test_dashboard_history_refreshes_stats_with_mexicano_playoff(self, client: TestClient) -> None:
        """Mexicano → playoff tournaments should produce playoff_stage stats."""
        from backend.models import Court, Player
        from backend.tournaments.mexicano import MexicanoTournament

        created = _create_profile(client)
        token = created["access_token"]
        profile_id = created["profile"]["id"]

        tid = f"t-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid, name="Mex Playoff Cup")

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        t = MexicanoTournament(
            players=[p1, p2, p3, p4],
            courts=[Court(name="C1")],
            num_rounds=1,
        )
        # Play one mexicano round so we can transition to playoffs.
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (20, 12))

        t.end_mexicano()
        t.start_playoffs(n_teams=4)

        # Record all playoff matches until a champion is decided.
        safety = 0
        while t.champion() is None and safety < 20:
            for pm in t.pending_playoff_matches():
                t.record_playoff_result(pm.id, (10, 6))
            safety += 1

        assert t.champion() is not None, "Playoff should have a champion"

        _tournaments[tid] = {
            "name": "Mex Playoff Cup",
            "type": "mexicano",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        stats = extract_history_stats({"type": "mexicano", "tournament": t})

        # At least the champion and finalist should have playoff_stage set.
        champion_ids = {p.id for p in t.champion()}
        has_stage = {pid for pid, s in stats.items() if "playoff_stage" in s}
        assert champion_ids.issubset(has_stage), "Champion should have playoff_stage"
        for pid in champion_ids:
            assert stats[pid]["playoff_stage"] == "Champion"
            assert stats[pid]["playoff_stage_rank"] == 0

        # Find the tracked player (p1) and verify via API.
        expected = stats.get(p1.id, {})

        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO player_history
                   (profile_id, entity_type, entity_id, entity_name, player_id, player_name, finished_at,
                    rank, total_players, wins, losses, draws, points_for, points_against)
                   VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    profile_id,
                    tid,
                    "Mex Playoff Cup",
                    p1.id,
                    p1.name,
                    datetime.now(timezone.utc).isoformat(),
                    None,
                    None,
                    0,
                    0,
                    0,
                    0,
                    0,
                ),
            )

        try:
            res = client.get("/api/player-profile/space", headers=_headers(token))
            assert res.status_code == 200, res.text
            entry = next(e for e in res.json()["entries"] if e["entity_id"] == tid)
            assert entry["playoff_stage"] == expected.get("playoff_stage")
            assert entry["playoff_stage_rank"] == expected.get("playoff_stage_rank")
            assert entry["wins"] == expected["wins"]
            assert entry["losses"] == expected["losses"]
            assert entry["points_for"] == expected["points_for"]
            assert entry["points_against"] == expected["points_against"]
        finally:
            _tournaments.pop(tid, None)

    def test_extract_history_stats_mexicano_without_playoffs_has_no_stage(self) -> None:
        """A finished Mexicano without playoffs should NOT have playoff_stage."""
        from backend.models import Court, Player
        from backend.tournaments.mexicano import MexicanoTournament

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        t = MexicanoTournament(
            players=[p1, p2, p3, p4],
            courts=[Court(name="C1")],
            num_rounds=1,
        )
        t.generate_next_round()
        for m in t.current_round_matches():
            t.record_result(m.id, (20, 12))

        t.finish_without_playoffs()
        stats = extract_history_stats({"type": "mexicano", "tournament": t})

        for pid, s in stats.items():
            assert "playoff_stage" not in s, f"Player {pid} should not have playoff_stage without playoffs"


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


# ────────────────────────────────────────────────────────────────────────────
# Tournament path endpoint (GET /player-profile/tournament-path/...)
# ────────────────────────────────────────────────────────────────────────────


class TestTournamentPath:
    def test_tournament_path_requires_auth(self, client: TestClient) -> None:
        res = client.get("/api/player-profile/tournament-path/tid/pid")
        assert res.status_code == 401

    def test_tournament_path_group_playoff_returns_round_rows(self, client: TestClient) -> None:
        from backend.models import MatchStatus
        from backend.models import Court, Player
        from backend.tournaments.group_stage import Group
        from backend.tournaments.group_playoff import GroupPlayoffTournament

        tid = f"t-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        _insert_tournament(tid, name="Group Path Cup")
        _insert_player_secret(tid, p1.id, p1.name, passphrase, uuid.uuid4().hex)
        created = _create_profile(client, name=p1.name, participant_passphrase=passphrase)
        token = created["access_token"]

        t = GroupPlayoffTournament(
            players=[p1, p2, p3, p4],
            num_groups=1,
            courts=[Court(name="C1")],
            top_per_group=2,
            team_mode=False,
        )
        t.generate()
        pending = [m for m in t.pending_group_matches() if m.status != MatchStatus.COMPLETED]
        for idx, match in enumerate(pending):
            if idx % 2 == 0:
                t.record_group_result(match.id, (9, 8))
            else:
                t.record_group_result(match.id, (3, 12))

        if t.has_more_group_rounds:
            t.generate_next_group_round()
            pending2 = [m for m in t.pending_group_matches() if m.status != MatchStatus.COMPLETED]
            for idx, match in enumerate(pending2):
                if idx % 2 == 0:
                    t.record_group_result(match.id, (11, 4))
                else:
                    t.record_group_result(match.id, (6, 7))

        _tournaments[tid] = {
            "name": "Group Path Cup",
            "type": "group_playoff",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        try:
            res = client.get(
                f"/api/player-profile/tournament-path/{tid}/{p1.id}",
                headers=_headers(token),
            )
            assert res.status_code == 200, res.text
            data = res.json()
            assert data["available"] is True
            assert data["tournament_type"] == "group_playoff"
            assert len(data["rounds"]) >= 1

            played_rows = [row for row in data["rounds"] if row["played"]]
            assert played_rows

            group = t.groups[0]
            for row in played_rows:
                shadow = Group(name=group.name, players=list(group.players), team_mode=group.team_mode)
                shadow.matches = [
                    m for m in group.matches if int(getattr(m, "round_number", 0) or 0) <= int(row["round_number"])
                ]
                standings = shadow.standings()
                rank_map = {entry.player.id: idx for idx, entry in enumerate(standings, start=1)}
                points_map = {entry.player.id: entry.points_for for entry in standings}
                assert row["rank"] == rank_map[p1.id]
                assert row["cumulative_points"] == points_map[p1.id]

            for row in played_rows:
                assert 1 <= (row["rank"] or 1) <= row["total_players"]
                assert len(row["partners"]) >= 1
                assert len(row["opponents"]) >= 1
                assert row["score"] is not None
                assert row["score_mode"] in {"points", "tennis"}
        finally:
            _tournaments.pop(tid, None)

    def test_tournament_path_group_playoff_includes_playoff_rows_and_elimination(self, client: TestClient) -> None:
        from backend.models import Court, Player
        from backend.tournaments.group_playoff import GroupPlayoffTournament

        tid = f"t-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        _insert_tournament(tid, name="Path Playoff Cup")
        _insert_player_secret(tid, p1.id, p1.name, passphrase, uuid.uuid4().hex)
        created = _create_profile(client, name=p1.name, participant_passphrase=passphrase)
        token = created["access_token"]

        t = GroupPlayoffTournament(
            players=[p1, p2, p3, p4],
            num_groups=1,
            courts=[Court(name="C1")],
            top_per_group=4,
            team_mode=True,
        )
        t.generate()
        for idx, match in enumerate(t.pending_group_matches()):
            if idx % 2 == 0:
                t.record_group_result(match.id, (9, 7))
            else:
                t.record_group_result(match.id, (5, 8))

        t.start_playoffs()
        target_match = None
        for match in t.pending_playoff_matches():
            team1_ids = {pp.id for pp in match.team1}
            team2_ids = {pp.id for pp in match.team2}
            if p1.id in team1_ids or p1.id in team2_ids:
                target_match = match
                break

        assert target_match is not None
        if p1.id in {pp.id for pp in target_match.team1}:
            t.record_playoff_result(target_match.id, (4, 10))
        else:
            t.record_playoff_result(target_match.id, (10, 4))

        _tournaments[tid] = {
            "name": "Path Playoff Cup",
            "type": "group_playoff",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        try:
            res = client.get(
                f"/api/player-profile/tournament-path/{tid}/{p1.id}",
                headers=_headers(token),
            )
            assert res.status_code == 200, res.text
            data = res.json()

            playoff_rows = [row for row in data["rounds"] if row.get("stage") == "playoff"]
            assert playoff_rows
            assert any(row.get("score") for row in playoff_rows)
            assert any(row.get("eliminated") is True for row in playoff_rows)

            expected_score = "4-10"
            eliminated_row = next(row for row in playoff_rows if row.get("eliminated") is True)
            assert eliminated_row.get("score") == expected_score
        finally:
            _tournaments.pop(tid, None)

    def test_tournament_path_mexicano_returns_round_rows(self, client: TestClient) -> None:
        from backend.models import Court, Player
        from backend.tournaments.mexicano import MexicanoTournament

        tid = f"t-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        _insert_tournament(tid, name="Mex Path Cup")
        _insert_player_secret(tid, p1.id, p1.name, passphrase, uuid.uuid4().hex)
        created = _create_profile(client, name=p1.name, participant_passphrase=passphrase)
        token = created["access_token"]

        t = MexicanoTournament(
            players=[p1, p2, p3, p4],
            courts=[Court(name="C1")],
            num_rounds=2,
            total_points_per_match=32,
        )
        t.generate_next_round()
        for match in t.current_round_matches():
            t.record_result(match.id, (20, 12))
        t.generate_next_round()
        for match in t.current_round_matches():
            t.record_result(match.id, (18, 14))

        _tournaments[tid] = {
            "name": "Mex Path Cup",
            "type": "mexicano",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        try:
            res = client.get(
                f"/api/player-profile/tournament-path/{tid}/{p1.id}",
                headers=_headers(token),
            )
            assert res.status_code == 200, res.text
            data = res.json()
            assert data["available"] is True
            assert data["tournament_type"] == "mexicano"
            assert len(data["rounds"]) == 2

            points: dict[str, int] = {p.id: 0 for p in t.players}
            raw_points: dict[str, int] = {p.id: 0 for p in t.players}
            played: dict[str, int] = {p.id: 0 for p in t.players}
            opp_counts: dict[str, dict[str, int]] = {p.id: {} for p in t.players}

            def _buchholz(pid: str) -> float:
                total = 0.0
                for opp_id, count in opp_counts.get(pid, {}).items():
                    total += float(raw_points.get(opp_id, 0)) * float(count)
                return total

            for idx, round_matches in enumerate(t.rounds, start=1):
                for match in round_matches:
                    team1_ids = [p.id for p in match.team1]
                    team2_ids = [p.id for p in match.team2]
                    score1 = int(match.score[0]) if match.score else 0
                    score2 = int(match.score[1]) if match.score else 0
                    breakdown = t.get_match_breakdown(match.id) or {}

                    for pid in team1_ids:
                        detail = breakdown.get(pid, {}) if isinstance(breakdown, dict) else {}
                        credited = int(detail.get("final", score1)) if isinstance(detail, dict) else score1
                        raw = int(detail.get("raw", score1)) if isinstance(detail, dict) else score1
                        points[pid] += credited
                        raw_points[pid] += raw
                        played[pid] += 1

                    for pid in team2_ids:
                        detail = breakdown.get(pid, {}) if isinstance(breakdown, dict) else {}
                        credited = int(detail.get("final", score2)) if isinstance(detail, dict) else score2
                        raw = int(detail.get("raw", score2)) if isinstance(detail, dict) else score2
                        points[pid] += credited
                        raw_points[pid] += raw
                        played[pid] += 1

                    for pid1 in team1_ids:
                        for pid2 in team2_ids:
                            opp_counts.setdefault(pid1, {})[pid2] = opp_counts.setdefault(pid1, {}).get(pid2, 0) + 1
                            opp_counts.setdefault(pid2, {})[pid1] = opp_counts.setdefault(pid2, {}).get(pid1, 0) + 1

                cohort_ids = [p.id for p in t.players]
                by_avg = len({played.get(pid, 0) for pid in cohort_ids}) > 1

                def _avg(pid: str) -> float:
                    val = played.get(pid, 0)
                    return float(points.get(pid, 0)) / float(val) if val else 0.0

                if by_avg:
                    ranked = sorted(
                        cohort_ids,
                        key=lambda pid: (-_avg(pid), -float(points.get(pid, 0)), -_buchholz(pid)),
                    )
                else:
                    ranked = sorted(
                        cohort_ids,
                        key=lambda pid: (-float(points.get(pid, 0)), -_avg(pid), -_buchholz(pid)),
                    )

                expected_rank = ranked.index(p1.id) + 1
                path_row = data["rounds"][idx - 1]
                assert path_row["rank"] == expected_rank
                assert path_row["cumulative_points"] == points[p1.id]

            assert data["rounds"][1]["cumulative_points"] >= data["rounds"][0]["cumulative_points"]
        finally:
            _tournaments.pop(tid, None)

    def test_tournament_path_mexicano_includes_playoff_rows_and_elimination(self, client: TestClient) -> None:
        """Mexicano → playoff should append playoff stage rows to the path."""
        from backend.models import Court, Player
        from backend.tournaments.mexicano import MexicanoTournament

        tid = f"t-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        _insert_tournament(tid, name="Mex Playoff Path Cup")
        _insert_player_secret(tid, p1.id, p1.name, passphrase, uuid.uuid4().hex)
        created = _create_profile(client, name=p1.name, participant_passphrase=passphrase)
        token = created["access_token"]

        t = MexicanoTournament(
            players=[p1, p2, p3, p4],
            courts=[Court(name="C1")],
            num_rounds=1,
        )
        t.generate_next_round()
        for match in t.current_round_matches():
            t.record_result(match.id, (20, 12))

        t.end_mexicano()
        t.start_playoffs(n_teams=4)

        # Record all playoff matches until a champion is decided.
        safety = 0
        while t.champion() is None and safety < 20:
            for pm in t.pending_playoff_matches():
                # Make p1 lose when encountered so we can verify elimination.
                team1_ids = {pp.id for pp in pm.team1}
                team2_ids = {pp.id for pp in pm.team2}
                if p1.id in team1_ids:
                    t.record_playoff_result(pm.id, (4, 10))
                elif p1.id in team2_ids:
                    t.record_playoff_result(pm.id, (10, 4))
                else:
                    t.record_playoff_result(pm.id, (10, 6))
            safety += 1

        _tournaments[tid] = {
            "name": "Mex Playoff Path Cup",
            "type": "mexicano",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        try:
            res = client.get(
                f"/api/player-profile/tournament-path/{tid}/{p1.id}",
                headers=_headers(token),
            )
            assert res.status_code == 200, res.text
            data = res.json()

            # Should have mexicano round rows AND playoff rows.
            group_rows = [row for row in data["rounds"] if row.get("stage") == "groups"]
            playoff_rows = [row for row in data["rounds"] if row.get("stage") == "playoff"]
            assert group_rows, "Should have at least one mexicano round row"
            assert playoff_rows, "Should have playoff rows after mexicano rounds"

            # p1 should be eliminated in the playoff.
            assert any(row.get("score") for row in playoff_rows)
            assert any(row.get("eliminated") is True for row in playoff_rows)

            # The eliminated row for p1 should show the losing score.
            eliminated_row = next(row for row in playoff_rows if row.get("eliminated") is True)
            assert eliminated_row.get("score") == "4-10"
        finally:
            _tournaments.pop(tid, None)

    def test_tournament_path_returns_unavailable_when_tournament_missing(self, client: TestClient) -> None:
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"

        _insert_player_secret(tid, pid, "Ghost", passphrase, uuid.uuid4().hex)
        created = _create_profile(client, name="Ghost", participant_passphrase=passphrase)
        token = created["access_token"]

        res = client.get(f"/api/player-profile/tournament-path/{tid}/{pid}", headers=_headers(token))
        assert res.status_code == 200
        data = res.json()
        assert data["available"] is False
        assert data["reason"] == "tournament_unavailable"
        assert data["rounds"] == []

    def test_tournament_path_other_profile_gets_404(self, client: TestClient) -> None:
        from backend.models import Court, Player
        from backend.tournaments.mexicano import MexicanoTournament

        tid = f"t-{uuid.uuid4().hex[:8]}"
        owner_pid = f"p-{uuid.uuid4().hex[:8]}"
        owner_pp = f"pp-{uuid.uuid4().hex[:12]}"

        _insert_tournament(tid, name="Private Path Cup")
        _insert_player_secret(tid, owner_pid, "Owner", owner_pp, uuid.uuid4().hex)
        _create_profile(client, name="Owner", participant_passphrase=owner_pp)

        p1 = Player(name="Owner")
        p2 = Player(name="R1")
        p3 = Player(name="R2")
        p4 = Player(name="R3")
        t = MexicanoTournament(
            players=[p1, p2, p3, p4],
            courts=[Court(name="C1")],
            num_rounds=1,
            total_points_per_match=32,
        )
        t.generate_next_round()
        for match in t.current_round_matches():
            t.record_result(match.id, (20, 12))

        _tournaments[tid] = {
            "name": "Private Path Cup",
            "type": "mexicano",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        other_tid = f"t-{uuid.uuid4().hex[:8]}"
        other_pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_player_secret(other_tid, f"p-{uuid.uuid4().hex[:8]}", "Other", other_pp, uuid.uuid4().hex)
        other = _create_profile(client, name="Other", participant_passphrase=other_pp)

        try:
            res = client.get(
                f"/api/player-profile/tournament-path/{tid}/{owner_pid}",
                headers=_headers(other["access_token"]),
            )
            assert res.status_code == 404
        finally:
            _tournaments.pop(tid, None)

    def test_tournament_path_uses_cached_payload_same_version(self, client: TestClient, monkeypatch) -> None:
        from backend.models import Court, Player
        from backend.tournaments.mexicano import MexicanoTournament
        import backend.api.routes_player_space as rps

        tid = f"t-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        _insert_tournament(tid, name="Cached Path Cup")
        _insert_player_secret(tid, p1.id, p1.name, passphrase, uuid.uuid4().hex)
        created = _create_profile(client, name=p1.name, participant_passphrase=passphrase)
        token = created["access_token"]

        t = MexicanoTournament(
            players=[p1, p2, p3, p4],
            courts=[Court(name="C1")],
            num_rounds=1,
            total_points_per_match=32,
        )
        t.generate_next_round()
        for match in t.current_round_matches():
            t.record_result(match.id, (20, 12))

        _tournaments[tid] = {
            "name": "Cached Path Cup",
            "type": "mexicano",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        try:
            first = client.get(
                f"/api/player-profile/tournament-path/{tid}/{p1.id}",
                headers=_headers(token),
            )
            assert first.status_code == 200, first.text
            first_data = first.json()
            assert first_data["available"] is True

            def _fail_recompute(*_args, **_kwargs):
                raise AssertionError("Path was recomputed instead of using cache")

            monkeypatch.setattr(rps, "_build_mex_path_rows", _fail_recompute)

            second = client.get(
                f"/api/player-profile/tournament-path/{tid}/{p1.id}",
                headers=_headers(token),
            )
            assert second.status_code == 200, second.text
            assert second.json() == first_data
        finally:
            _tournaments.pop(tid, None)

    def test_tournament_path_ignores_stale_cache_schema(self, client: TestClient, monkeypatch) -> None:
        import backend.api.routes_player_space as rps

        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"

        _insert_tournament(tid, name="Stale Cache Cup")
        _insert_player_secret(tid, pid, "Alice", passphrase, uuid.uuid4().hex)
        created = _create_profile(client, name="Alice", participant_passphrase=passphrase)
        token = created["access_token"]

        _tournaments[tid] = {
            "name": "Stale Cache Cup",
            "type": "mexicano",
            "tournament": object(),
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        stale_payload = {
            "entity_id": tid,
            "player_id": pid,
            "tournament_type": "mexicano",
            "available": True,
            "reason": None,
            "rounds": [
                {
                    "round_number": 1,
                    "round_label": "Round 1",
                    "cumulative_points": 10,
                    "rank": 1,
                    "total_players": 4,
                    "partners": [],
                    "opponents": [],
                    "played": True,
                    "score": "10-4",
                    "score_mode": "points",
                    "stage": "groups",
                }
            ],
        }

        with db_mod.get_db() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO player_tournament_path_cache
                    (profile_id, entity_id, player_id, tournament_version, payload, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
                """,
                (created["profile"]["id"], tid, pid, 0, json.dumps(stale_payload)),
            )

        def _fresh_rows(_tournament: object, _player_id: str) -> list[rps.PlayerPathRound]:
            return [
                rps.PlayerPathRound(
                    round_number=1,
                    round_label="Round 1",
                    cumulative_points=4,
                    rank=2,
                    total_players=4,
                    partners=[],
                    opponents=[],
                    played=True,
                    score="4-10",
                    stage="groups",
                )
            ]

        monkeypatch.setattr(rps, "_build_mex_path_rows", _fresh_rows)

        try:
            res = client.get(f"/api/player-profile/tournament-path/{tid}/{pid}", headers=_headers(token))
            assert res.status_code == 200, res.text
            data = res.json()
            assert data["available"] is True
            assert data["rounds"][0]["score"] == "4-10"
        finally:
            _tournaments.pop(tid, None)

    def test_tournament_path_recomputes_after_version_bump(self, client: TestClient, monkeypatch) -> None:
        from backend.api.state import bump_tournament_version
        from backend.models import Court, Player
        from backend.tournaments.mexicano import MexicanoTournament
        import backend.api.routes_player_space as rps

        tid = f"t-{uuid.uuid4().hex[:8]}"
        passphrase = f"pp-{uuid.uuid4().hex[:12]}"

        p1 = Player(name="Alice")
        p2 = Player(name="Bob")
        p3 = Player(name="Charlie")
        p4 = Player(name="Dani")

        _insert_tournament(tid, name="Versioned Path Cup")
        _insert_player_secret(tid, p1.id, p1.name, passphrase, uuid.uuid4().hex)
        created = _create_profile(client, name=p1.name, participant_passphrase=passphrase)
        token = created["access_token"]

        t = MexicanoTournament(
            players=[p1, p2, p3, p4],
            courts=[Court(name="C1")],
            num_rounds=1,
            total_points_per_match=32,
        )
        t.generate_next_round()
        for match in t.current_round_matches():
            t.record_result(match.id, (20, 12))

        _tournaments[tid] = {
            "name": "Versioned Path Cup",
            "type": "mexicano",
            "tournament": t,
            "owner": "admin",
            "public": True,
            "sport": "padel",
            "assign_courts": True,
        }

        try:
            first = client.get(
                f"/api/player-profile/tournament-path/{tid}/{p1.id}",
                headers=_headers(token),
            )
            assert first.status_code == 200, first.text

            bump_tournament_version(tid)

            patched_rows = [
                rps.PlayerPathRound(
                    round_number=1,
                    round_label="Round 1",
                    cumulative_points=999,
                    rank=1,
                    total_players=4,
                    partners=["Patched Partner"],
                    opponents=["Patched Opponent"],
                    played=True,
                )
            ]
            monkeypatch.setattr(rps, "_build_mex_path_rows", lambda *_args, **_kwargs: patched_rows)

            second = client.get(
                f"/api/player-profile/tournament-path/{tid}/{p1.id}",
                headers=_headers(token),
            )
            assert second.status_code == 200, second.text
            rows = second.json()["rounds"]
            assert rows and rows[0]["cumulative_points"] == 999
            assert rows[0]["partners"] == ["Patched Partner"]
        finally:
            _tournaments.pop(tid, None)


# ────────────────────────────────────────────────────────────────────────────
# Live in-progress stats — upsert_live_stats / maybe_update_live_stats
# ────────────────────────────────────────────────────────────────────────────


class TestLiveStats:
    """Tests for incremental Player Hub stats written on round completion."""

    def _setup_active_tournament(
        self, client: TestClient, *, profile_name: str = "Live Player"
    ) -> tuple[str, str, str, str, str]:
        """Create a profile, tournament, and linked player secret.

        Returns (profile_id, token, tid, player_id, passphrase).
        """
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        pp = f"pp-{uuid.uuid4().hex[:12]}"
        _insert_tournament(tid, name="Live Cup")
        _insert_player_secret(tid, pid, profile_name, pp, uuid.uuid4().hex)
        created = _create_profile(client, name=profile_name, participant_passphrase=pp)
        profile_id = created["profile"]["id"]
        token = created["access_token"]
        return profile_id, token, tid, pid, pp

    def test_upsert_live_stats_writes_in_progress_row(self, client: TestClient) -> None:
        """upsert_live_stats writes a player_history row with finished_at=''."""
        profile_id, token, tid, pid, _ = self._setup_active_tournament(client)

        # Simulate tournament data with stats for the player
        t_data = {
            "name": "Live Cup",
            "type": "mexicano",
            "sport": "padel",
            "tournament": SimpleNamespace(
                leaderboard=lambda: [
                    {"player_id": pid, "rank": 2, "total_points": 30, "wins": 3, "losses": 1, "draws": 0}
                ],
                team_roster={},
            ),
        }
        upsert_live_stats(tid, t_data)

        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT * FROM player_history WHERE profile_id = ? AND entity_id = ?",
                (profile_id, tid),
            ).fetchone()
        assert row is not None
        assert row["finished_at"] == ""
        assert row["wins"] == 3
        assert row["losses"] == 1
        assert row["rank"] == 2

    def test_upsert_live_stats_updates_on_subsequent_rounds(self, client: TestClient) -> None:
        """Calling upsert_live_stats again replaces the previous in-progress snapshot."""
        profile_id, token, tid, pid, _ = self._setup_active_tournament(client)

        def make_t_data(wins: int, losses: int) -> dict:
            return {
                "name": "Live Cup",
                "type": "mexicano",
                "sport": "padel",
                "tournament": SimpleNamespace(
                    leaderboard=lambda wins=wins, losses=losses: [
                        {"player_id": pid, "rank": 1, "total_points": 50, "wins": wins, "losses": losses, "draws": 0}
                    ],
                    team_roster={},
                ),
            }

        upsert_live_stats(tid, make_t_data(2, 0))
        upsert_live_stats(tid, make_t_data(4, 1))

        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT * FROM player_history WHERE profile_id = ? AND entity_id = ?",
                (profile_id, tid),
            ).fetchone()
        assert row["wins"] == 4
        assert row["losses"] == 1

    def test_dashboard_active_entry_includes_live_stats(self, client: TestClient) -> None:
        """GET /player/space returns W/L/D on active entries after upsert_live_stats."""
        profile_id, token, tid, pid, _ = self._setup_active_tournament(client)

        t_data = {
            "name": "Live Cup",
            "type": "mexicano",
            "sport": "padel",
            "tournament": SimpleNamespace(
                leaderboard=lambda: [
                    {"player_id": pid, "rank": 1, "total_points": 40, "wins": 5, "losses": 2, "draws": 1}
                ],
                team_roster={},
            ),
        }
        upsert_live_stats(tid, t_data)

        res = client.get("/api/player-profile/space", headers=_headers(token))
        assert res.status_code == 200
        entries = res.json()["entries"]
        active = [e for e in entries if e["status"] == "active" and e["entity_id"] == tid]
        assert len(active) == 1
        entry = active[0]
        assert entry["wins"] == 5
        assert entry["losses"] == 2
        assert entry["draws"] == 1
        assert entry["rank"] == 1

    def test_in_progress_row_excluded_from_history_section(self, client: TestClient) -> None:
        """In-progress rows (finished_at='') do not appear as 'finished' entries."""
        profile_id, token, tid, pid, _ = self._setup_active_tournament(client)

        t_data = {
            "name": "Live Cup",
            "type": "mexicano",
            "sport": "padel",
            "tournament": SimpleNamespace(
                leaderboard=lambda: [
                    {"player_id": pid, "rank": 1, "total_points": 10, "wins": 1, "losses": 0, "draws": 0}
                ],
                team_roster={},
            ),
        }
        upsert_live_stats(tid, t_data)

        res = client.get("/api/player-profile/space", headers=_headers(token))
        entries = res.json()["entries"]
        finished = [e for e in entries if e["status"] == "finished" and e["entity_id"] == tid]
        assert len(finished) == 0

    def test_finish_overwrites_in_progress_row(self, client: TestClient) -> None:
        """delete_secrets_for_tournament replaces the in-progress row with final stats."""
        profile_id, token, tid, pid, _ = self._setup_active_tournament(client)

        # Write in-progress snapshot
        t_data = {
            "name": "Live Cup",
            "type": "mexicano",
            "sport": "padel",
            "tournament": SimpleNamespace(
                leaderboard=lambda: [
                    {"player_id": pid, "rank": 2, "total_points": 20, "wins": 2, "losses": 1, "draws": 0}
                ],
                team_roster={},
            ),
        }
        upsert_live_stats(tid, t_data)

        # Call the REAL function (conftest mocks the module attribute).
        _real_delete_secrets(
            tid,
            entity_name="Live Cup",
            player_stats={
                pid: {
                    "rank": 1,
                    "total_players": 8,
                    "wins": 5,
                    "losses": 2,
                    "draws": 0,
                    "points_for": 60,
                    "points_against": 30,
                }
            },
            sport="padel",
            partner_rival_stats={
                pid: {
                    "top_partners": [{"name": "Bob", "wins": 3, "games": 4, "win_pct": 75}],
                    "top_rivals": [],
                    "all_partners": [],
                    "all_rivals": [],
                }
            },
        )

        with db_mod.get_db() as conn:
            rows = conn.execute(
                "SELECT * FROM player_history WHERE profile_id = ? AND entity_id = ?",
                (profile_id, tid),
            ).fetchall()
        # Should have exactly one row (replaced, not duplicated)
        assert len(rows) == 1
        row = rows[0]
        assert row["finished_at"] != ""
        assert row["wins"] == 5
        assert row["rank"] == 1

    def test_maybe_update_live_stats_skips_finished_tournament(self) -> None:
        """maybe_update_live_stats does nothing for finished tournaments."""
        tid = f"t-{uuid.uuid4().hex[:8]}"
        _tournaments[tid] = {
            "name": "Done Cup",
            "type": "mexicano",
            "sport": "padel",
            "tournament": SimpleNamespace(phase="finished"),
        }
        try:
            # Should not raise, should be a no-op
            maybe_update_live_stats(tid)
        finally:
            _tournaments.pop(tid, None)

    def test_upsert_live_stats_skips_when_no_linked_profiles(self) -> None:
        """upsert_live_stats gracefully does nothing when no profiles are linked."""
        tid = f"t-{uuid.uuid4().hex[:8]}"
        pid = f"p-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid, name="No Links")
        # player secret without profile_id
        _insert_player_secret(tid, pid, "Solo", f"pp-{uuid.uuid4().hex}", uuid.uuid4().hex)

        t_data = {
            "name": "No Links",
            "type": "mexicano",
            "sport": "padel",
            "tournament": SimpleNamespace(
                leaderboard=lambda: [
                    {"player_id": pid, "rank": 1, "total_points": 10, "wins": 1, "losses": 0, "draws": 0}
                ],
                team_roster={},
            ),
        }
        upsert_live_stats(tid, t_data)

        with db_mod.get_db() as conn:
            rows = conn.execute("SELECT * FROM player_history WHERE entity_id = ?", (tid,)).fetchall()
        assert len(rows) == 0


# ────────────────────────────────────────────────────────────────────────────
# Passphrase resolve endpoint
# ────────────────────────────────────────────────────────────────────────────


class TestResolvePassphrase:
    """Tests for POST /api/player-profile/resolve — unified login discovery."""

    def test_resolve_not_found(self, client: TestClient) -> None:
        res = client.post("/api/player-profile/resolve", json={"passphrase": "nonexistent-phrase-here"})
        assert res.status_code == 200
        data = res.json()
        assert data["type"] == "not_found"
        assert data["matches"] == []

    def test_resolve_tournament_match(self, client: TestClient) -> None:
        tid = f"t-resolve-{uuid.uuid4().hex[:8]}"
        pid = f"p-resolve-{uuid.uuid4().hex[:8]}"
        pp = f"resolve-tourn-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid, name="Summer Cup")
        _insert_player_secret(tid, pid, "Alice", pp, uuid.uuid4().hex)

        res = client.post("/api/player-profile/resolve", json={"passphrase": pp})
        assert res.status_code == 200
        data = res.json()
        assert data["type"] == "participation"
        assert len(data["matches"]) == 1
        m = data["matches"][0]
        assert m["entity_type"] == "tournament"
        assert m["entity_name"] == "Summer Cup"
        assert m["player_name"] == "Alice"

    def test_resolve_registration_match(self, client: TestClient) -> None:
        rid = f"r-resolve-{uuid.uuid4().hex[:8]}"
        pid = f"p-resolve-{uuid.uuid4().hex[:8]}"
        pp = f"resolve-reg-{uuid.uuid4().hex[:8]}"
        _insert_registration(rid, name="Winter Lobby")
        _insert_registrant(rid, pid, "Bob", pp, uuid.uuid4().hex)

        res = client.post("/api/player-profile/resolve", json={"passphrase": pp})
        assert res.status_code == 200
        data = res.json()
        assert data["type"] == "participation"
        assert len(data["matches"]) == 1
        m = data["matches"][0]
        assert m["entity_type"] == "registration"
        assert m["entity_name"] == "Winter Lobby"
        assert m["player_name"] == "Bob"

    def test_resolve_multiple_matches(self, client: TestClient) -> None:
        """Same passphrase in two tournaments → both returned."""
        pp = f"resolve-multi-{uuid.uuid4().hex[:8]}"
        tid1 = f"t-multi1-{uuid.uuid4().hex[:8]}"
        tid2 = f"t-multi2-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid1, name="Cup A")
        _insert_tournament(tid2, name="Cup B")
        _insert_player_secret(tid1, "p1", "Carol", pp, uuid.uuid4().hex)
        _insert_player_secret(tid2, "p2", "Carol", pp, uuid.uuid4().hex)

        res = client.post("/api/player-profile/resolve", json={"passphrase": pp})
        assert res.status_code == 200
        data = res.json()
        assert data["type"] == "participation"
        assert len(data["matches"]) == 2
        names = {m["entity_name"] for m in data["matches"]}
        assert names == {"Cup A", "Cup B"}

    def test_resolve_profile_match(self, client: TestClient) -> None:
        """When a profile exists with this passphrase, resolve returns 'profile'."""
        tid = f"t-profres-{uuid.uuid4().hex[:8]}"
        pid = f"p-profres-{uuid.uuid4().hex[:8]}"
        pp = f"resolve-prof-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid)
        _insert_player_secret(tid, pid, "Dave", pp, uuid.uuid4().hex)

        # Create a profile so the passphrase gets claimed as a profile passphrase
        resp = _create_profile(client, name="Dave", email="dave@example.com", participant_passphrase=pp)
        profile_pp = resp["profile"]["passphrase"]

        res = client.post("/api/player-profile/resolve", json={"passphrase": profile_pp})
        assert res.status_code == 200
        data = res.json()
        assert data["type"] == "profile"
        assert data["matches"] == []

    def test_resolve_empty_passphrase_rejected(self, client: TestClient) -> None:
        res = client.post("/api/player-profile/resolve", json={"passphrase": ""})
        assert res.status_code == 422

    def test_resolve_mixed_tournament_and_registration(self, client: TestClient) -> None:
        """Passphrase matches both a tournament and a registration."""
        pp = f"resolve-mixed-{uuid.uuid4().hex[:8]}"
        tid = f"t-mixed-{uuid.uuid4().hex[:8]}"
        rid = f"r-mixed-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid, name="Mixed Cup")
        _insert_player_secret(tid, "p1", "Eve", pp, uuid.uuid4().hex)
        _insert_registration(rid, name="Mixed Lobby")
        _insert_registrant(rid, "p2", "Eve", pp, uuid.uuid4().hex)

        res = client.post("/api/player-profile/resolve", json={"passphrase": pp})
        assert res.status_code == 200
        data = res.json()
        assert data["type"] == "participation"
        assert len(data["matches"]) == 2
        types = {m["entity_type"] for m in data["matches"]}
        assert types == {"tournament", "registration"}


# ────────────────────────────────────────────────────────────────────────────
# Leaderboard (public, no auth)
# ────────────────────────────────────────────────────────────────────────────


class TestLeaderboard:
    """GET /api/player-profile/leaderboard — public ELO leaderboard."""

    def test_leaderboard_empty_when_no_rated_profiles(self, client: TestClient) -> None:
        res = client.get("/api/player-profile/leaderboard")
        assert res.status_code == 200
        data = res.json()
        assert data["padel"] == []
        assert data["tennis"] == []

    def test_leaderboard_returns_rated_padel_players_sorted(self, client: TestClient) -> None:
        p1 = _create_profile(client, name="Alice Padel", email="alice-lb@example.com")
        p2 = _create_profile(client, name="Bob Padel", email="bob-lb@example.com")
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE player_profiles SET elo_padel = 1200, elo_padel_matches = 5 WHERE id = ?",
                (p1["profile"]["id"],),
            )
            conn.execute(
                "UPDATE player_profiles SET elo_padel = 1300, elo_padel_matches = 3 WHERE id = ?",
                (p2["profile"]["id"],),
            )

        res = client.get("/api/player-profile/leaderboard")
        assert res.status_code == 200
        padel = res.json()["padel"]
        assert len(padel) >= 2
        # Bob has higher ELO → should be first
        names = [e["name"] for e in padel]
        assert names.index("Bob Padel") < names.index("Alice Padel")
        bob_entry = next(e for e in padel if e["name"] == "Bob Padel")
        assert bob_entry["rank"] == names.index("Bob Padel") + 1
        assert bob_entry["elo"] == 1300
        assert bob_entry["matches"] == 3

    def test_leaderboard_excludes_unrated_players(self, client: TestClient) -> None:
        _create_profile(client, name="Unrated Player", email="unrated-lb@example.com")
        res = client.get("/api/player-profile/leaderboard")
        assert res.status_code == 200
        names = [e["name"] for e in res.json()["padel"]]
        assert "Unrated Player" not in names

    def test_leaderboard_returns_tennis_players(self, client: TestClient) -> None:
        p1 = _create_profile(client, name="Tennis Player", email="tennis-lb@example.com")
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE player_profiles SET elo_tennis = 1100, elo_tennis_matches = 2 WHERE id = ?",
                (p1["profile"]["id"],),
            )

        res = client.get("/api/player-profile/leaderboard")
        assert res.status_code == 200
        tennis = res.json()["tennis"]
        tennis_names = [e["name"] for e in tennis]
        assert "Tennis Player" in tennis_names

    def test_leaderboard_no_auth_required(self, client: TestClient) -> None:
        """Ensure endpoint works without any Authorization header."""
        res = client.get("/api/player-profile/leaderboard")
        assert res.status_code == 200

    def test_leaderboard_includes_unlinked_players(self, client: TestClient) -> None:
        """Unlinked tournament participants should appear with has_profile=False."""
        tid = f"t-lb-unlinked-{uuid.uuid4().hex[:8]}"
        _insert_tournament(tid, name="Leaderboard Cup")
        _insert_player_secret(tid, "p-unlinked", "Unlinked Player", "pp-unlinked", uuid.uuid4().hex)
        now = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO player_elo (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)"
                " VALUES (?, ?, 'padel', 1000, 1050, 3, ?)",
                (tid, "p-unlinked", now),
            )

        res = client.get("/api/player-profile/leaderboard")
        assert res.status_code == 200
        padel = res.json()["padel"]
        entry = next((e for e in padel if e["name"] == "Unlinked Player"), None)
        assert entry is not None
        assert entry["has_profile"] is False
        assert entry["elo"] == 1050
        assert entry["matches"] == 3

    def test_leaderboard_profile_players_have_has_profile_true(self, client: TestClient) -> None:
        p1 = _create_profile(client, name="Profiled Player", email="profiled-lb@example.com")
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE player_profiles SET elo_padel = 1150, elo_padel_matches = 4 WHERE id = ?",
                (p1["profile"]["id"],),
            )

        res = client.get("/api/player-profile/leaderboard")
        assert res.status_code == 200
        entry = next((e for e in res.json()["padel"] if e["name"] == "Profiled Player"), None)
        assert entry is not None
        assert entry["has_profile"] is True
