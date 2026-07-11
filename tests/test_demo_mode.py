"""
Tests for demo mode: throwaway demo accounts, feature gates, the
one-tournament cap, payload sanitization, and the 3-day purge job.

Demo mode only activates on a process started with AMISTOSO_DEMO_INSTANCE=1;
tests flip ``backend.config.DEMO_INSTANCE`` via monkeypatch (every consumer
reads it through the module for exactly this reason).
"""

from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone

import pytest

from backend import config
from backend.api.demo_cleanup import demo_expires_at, purge_expired_demo_data
from backend.auth.models import User, UserRole
from backend.auth.store import UserStore, user_store

GP_BODY = {
    "name": "Demo Cup",
    "player_names": ["A", "B", "C", "D"],
    "team_mode": False,
    "court_names": ["Court 1"],
    "num_groups": 1,
    "top_per_group": 1,
    "double_elimination": False,
}


@pytest.fixture
def demo_instance(monkeypatch):
    """Turn this process into the demo instance for one test."""
    monkeypatch.setattr(config, "DEMO_INSTANCE", True)


@pytest.fixture
def demo_session(client, demo_instance) -> dict:
    """Mint a demo account and return the mint response payload."""
    r = client.post("/api/auth/demo")
    assert r.status_code == 200
    return r.json()


def _headers(payload: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {payload['access_token']}"}


# ── Minting ────────────────────────────────────────────────


class TestDemoMint:
    def test_mint_404_when_not_demo_instance(self, client):
        r = client.post("/api/auth/demo")
        assert r.status_code == 404

    def test_mint_creates_throwaway_account(self, client, demo_instance):
        r = client.post("/api/auth/demo")
        assert r.status_code == 200
        data = r.json()
        assert re.fullmatch(r"demo-[23456789abcdefghjkmnpqrstuvwxyz]{6}", data["username"])
        assert "-" in data["passphrase"]
        assert data["role"] == "user"
        expires = datetime.fromisoformat(data["expires_at"])
        expected = datetime.now(timezone.utc) + timedelta(days=config.DEMO_TTL_DAYS)
        assert abs((expires - expected).total_seconds()) < 60

        user = user_store.get(data["username"])
        assert user is not None
        assert user.is_demo is True
        assert user.can_create_clubs is False
        assert user.created_at is not None

    def test_mint_token_works_and_me_reports_expiry(self, client, demo_session):
        r = client.get("/api/auth/me", headers=_headers(demo_session))
        assert r.status_code == 200
        me = r.json()
        assert me["username"] == demo_session["username"]
        assert me["is_demo"] is True
        assert me["demo_expires_at"] == demo_session["expires_at"]

    def test_regular_user_me_has_defaults(self, client, alice_headers):
        me = client.get("/api/auth/me", headers=alice_headers).json()
        assert me["is_demo"] is False
        assert me["demo_expires_at"] is None

    def test_login_with_passphrase_from_other_device(self, client, demo_session):
        r = client.post(
            "/api/auth/login",
            json={"username": demo_session["username"], "password": demo_session["passphrase"]},
        )
        assert r.status_code == 200
        assert r.json()["username"] == demo_session["username"]

    def test_mint_rate_limited(self, client, demo_instance):
        for _ in range(5):
            assert client.post("/api/auth/demo").status_code == 200
        assert client.post("/api/auth/demo").status_code == 429


# ── Feature gates ──────────────────────────────────────────


class TestDemoGates:
    def test_demo_cannot_create_registration_lobby(self, client, demo_session, alice_headers):
        r = client.post("/api/registrations", json={"name": "Lobby"}, headers=_headers(demo_session))
        assert r.status_code == 403
        # Regression guard: regular users unaffected.
        r = client.post("/api/registrations", json={"name": "Lobby"}, headers=alice_headers)
        assert r.status_code == 200

    def test_demo_cannot_set_tournament_alias(self, client, demo_session, alice_headers):
        tid = client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=_headers(demo_session)).json()["id"]
        r = client.put(f"/api/tournaments/{tid}/alias", json={"alias": "my-demo"}, headers=_headers(demo_session))
        assert r.status_code == 403
        r = client.delete(f"/api/tournaments/{tid}/alias", headers=_headers(demo_session))
        assert r.status_code == 403
        # Regular owner can still set an alias on their own tournament.
        tid2 = client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=alice_headers).json()["id"]
        r = client.put(f"/api/tournaments/{tid2}/alias", json={"alias": "alice-cup"}, headers=alice_headers)
        assert r.status_code == 200

    def test_demo_cannot_create_club(self, client, demo_session):
        r = client.post(
            "/api/clubs",
            json={"name": "Club", "community_id": "somewhere"},
            headers=_headers(demo_session),
        )
        assert r.status_code == 403

    def test_demo_cannot_set_player_email(self, client, demo_session):
        tid = client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=_headers(demo_session)).json()["id"]
        players = client.get(f"/api/tournaments/{tid}/player-secrets", headers=_headers(demo_session))
        assert players.status_code == 200
        pid = next(iter(players.json()["players"]))
        r = client.put(
            f"/api/tournaments/{tid}/player-secrets/{pid}/email",
            json={"email": "someone@example.com"},
            headers=_headers(demo_session),
        )
        assert r.status_code == 403

    def test_hub_profile_creation_blocked_on_demo_instance(self, client, demo_instance):
        r = client.post(
            "/api/player-profile",
            json={"participant_passphrase": "whatever", "email": "a@example.com"},
        )
        assert r.status_code == 403


# ── One-tournament cap + sanitization ──────────────────────


class TestDemoTournamentCap:
    def test_one_active_tournament_at_a_time(self, client, demo_session):
        headers = _headers(demo_session)
        first = client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=headers)
        assert first.status_code == 200
        tid = first.json()["id"]

        second_bodies = {
            "group-playoff": GP_BODY,
            "mexicano": {"name": "X", "player_names": ["A", "B", "C", "D"]},
            "playoff": {"name": "X", "participant_names": ["T1", "T2"], "teams": [["A", "B"], ["C", "D"]]},
        }
        for path, body in second_bodies.items():
            r = client.post(f"/api/tournaments/{path}", json=body, headers=headers)
            assert r.status_code == 403, path

        # Deleting the tournament frees the slot.
        assert client.delete(f"/api/tournaments/{tid}", headers=headers).status_code == 200
        assert client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=headers).status_code == 200

    def test_cap_does_not_apply_to_regular_users(self, client, alice_headers):
        assert client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=alice_headers).status_code == 200
        assert client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=alice_headers).status_code == 200

    def test_demo_create_payload_sanitized(self, client, demo_session):
        from backend.api.state import _tournaments

        body = {
            **GP_BODY,
            "community_id": "some-community",
            "club_id": "some-club",
            "season_id": "some-season",
            "player_emails": {"A": "a@example.com"},
            "player_profile_ids": {"A": "prof123"},
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=_headers(demo_session))
        assert r.status_code == 200
        data = _tournaments[r.json()["id"]]
        assert data["community_id"] == "open"
        assert data["club_id"] is None
        assert data["season_id"] is None


# ── Expiry helper + store round-trip ───────────────────────


class TestDemoExpiry:
    def test_demo_expires_at_regular_user(self):
        assert demo_expires_at(User(username="abc", password_hash="x")) is None

    def test_demo_expires_at_demo_user(self):
        created = datetime.now(timezone.utc)
        user = User(username="demo-abc234", password_hash="x", is_demo=True, created_at=created.isoformat())
        expires = datetime.fromisoformat(demo_expires_at(user))
        assert expires == created + timedelta(days=config.DEMO_TTL_DAYS)

    def test_user_store_roundtrip_preserves_demo_columns(self):
        # Apply the users-table migrations to the temp test DB, then bypass the
        # conftest no-op to exercise the real save/load path.
        user_store.load()
        created = datetime.now(timezone.utc).isoformat()
        user = User(
            username="demo-persist",
            password_hash="x",
            role=UserRole.USER,
            is_demo=True,
            created_at=created,
            can_create_clubs=False,
        )
        UserStore._save_user(user_store, user)
        user_store._users.pop("demo-persist", None)
        user_store.load()
        loaded = user_store.get("demo-persist")
        assert loaded is not None
        assert loaded.is_demo is True
        assert loaded.created_at == created
        assert loaded.can_create_clubs is False


# ── Purge job ──────────────────────────────────────────────


class TestDemoPurge:
    def _backdate(self, username: str, days: float = 4.0) -> None:
        user = user_store.get(username)
        user.created_at = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()

    def test_purge_removes_expired_account_and_all_data(self, client, demo_session, alice_headers):
        from backend.api.db import get_db
        from backend.api.state import _tournaments

        headers = _headers(demo_session)
        username = demo_session["username"]
        tid = client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=headers).json()["id"]
        alice_tid = client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=alice_headers).json()["id"]

        # Seed the residue a played-out tournament leaves behind: ELO rows,
        # history snapshots, and a ghost profile linked via player_secrets.
        now = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            for t in (tid, alice_tid):
                conn.execute(
                    "INSERT INTO player_elo (tournament_id, player_id, sport, elo_before, elo_after, updated_at)"
                    " VALUES (?, 'p1', 'padel', 1000, 1010, ?)",
                    (t, now),
                )
                conn.execute(
                    "INSERT INTO player_elo_log (tournament_id, sport, match_id, player_id, elo_before,"
                    " elo_after, elo_delta, match_payload, updated_at)"
                    " VALUES (?, 'padel', 'm1', 'p1', 1000, 1010, 10, '{}', ?)",
                    (t, now),
                )
                conn.execute(
                    "INSERT INTO player_history (entity_type, entity_id, player_id, finished_at)"
                    " VALUES ('tournament', ?, 'p1', ?)",
                    (t, now),
                )
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, created_at, is_ghost)"
                " VALUES ('ghost1', 'ghost-pass-one', 'Ghost', ?, 1)",
                (now,),
            )
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, passphrase, token, profile_id)"
                " VALUES (?, 'p1', 'pp-demo-p1', 'tok-demo-p1', 'ghost1')",
                (tid,),
            )

        self._backdate(username)
        result = asyncio.run(purge_expired_demo_data())
        assert result == {"users": 1, "tournaments": 1}

        assert user_store.get(username) is None
        assert tid not in _tournaments
        assert alice_tid in _tournaments
        with get_db() as conn:
            for table, col in (
                ("player_elo", "tournament_id"),
                ("player_elo_log", "tournament_id"),
                ("player_history", "entity_id"),
            ):
                gone = conn.execute(f"SELECT 1 FROM {table} WHERE {col} = ?", (tid,)).fetchone()  # noqa: S608
                kept = conn.execute(f"SELECT 1 FROM {table} WHERE {col} = ?", (alice_tid,)).fetchone()  # noqa: S608
                assert gone is None, table
                assert kept is not None, table
            assert conn.execute("SELECT 1 FROM player_profiles WHERE id = 'ghost1'").fetchone() is None
            assert conn.execute("SELECT 1 FROM player_secrets WHERE tournament_id = ?", (tid,)).fetchone() is None

    def test_purge_skips_fresh_demo_accounts(self, client, demo_instance):
        fresh = client.post("/api/auth/demo").json()
        expired = client.post("/api/auth/demo").json()
        self._backdate(expired["username"])

        result = asyncio.run(purge_expired_demo_data())
        assert result["users"] == 1
        assert user_store.get(expired["username"]) is None
        assert user_store.get(fresh["username"]) is not None

    def test_purge_noop_without_expired_accounts(self):
        result = asyncio.run(purge_expired_demo_data())
        assert result == {"users": 0, "tournaments": 0}


# ── Config exposure ────────────────────────────────────────


class TestDemoConfigEndpoint:
    def test_core_instance_defaults(self, client):
        cfg = client.get("/api/config").json()
        assert cfg["demo_instance"] is False
        assert cfg["demo_url"] is None

    def test_demo_url_and_instance_exposed(self, client, monkeypatch):
        monkeypatch.setattr(config, "DEMO_INSTANCE", True)
        monkeypatch.setattr(config, "DEMO_URL", "http://localhost:8001")
        cfg = client.get("/api/config").json()
        assert cfg["demo_instance"] is True
        assert cfg["demo_url"] == "http://localhost:8001"
        # The legacy whole-server banner flag is untouched by demo instance mode.
        assert cfg["demo_mode"] is False
