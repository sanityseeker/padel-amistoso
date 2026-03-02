"""
Tests for the auth module — login, user management, token validation, and alias endpoints.
"""

from __future__ import annotations

import pytest

from backend.auth.security import create_access_token, decode_access_token, hash_password, verify_password
from backend.auth.store import user_store


# ── Unit: security helpers ─────────────────────────────────


class TestPasswordHashing:
    def test_hash_and_verify(self):
        hashed = hash_password("s3cret")
        assert verify_password("s3cret", hashed)

    def test_wrong_password_fails(self):
        hashed = hash_password("correct")
        assert not verify_password("wrong", hashed)


class TestJWT:
    def test_roundtrip(self):
        token = create_access_token("alice")
        assert decode_access_token(token) == "alice"

    def test_invalid_token_returns_none(self):
        assert decode_access_token("garbage.token.here") is None

    def test_empty_token_returns_none(self):
        assert decode_access_token("") is None


# ── Unit: user store ───────────────────────────────────────


class TestUserStore:
    def test_create_and_get(self):
        user = user_store.get("admin")
        assert user is not None
        assert user.username == "admin"

    def test_create_duplicate_raises(self):
        with pytest.raises(ValueError, match="already exists"):
            user_store.create_user("admin", "pass")

    def test_authenticate_valid(self):
        user = user_store.authenticate("admin", "admin")
        assert user is not None
        assert user.username == "admin"

    def test_authenticate_wrong_password(self):
        assert user_store.authenticate("admin", "wrong") is None

    def test_authenticate_unknown_user(self):
        assert user_store.authenticate("nobody", "pass") is None

    def test_list_users(self):
        users = user_store.list_users()
        assert len(users) >= 1
        assert any(u.username == "admin" for u in users)

    def test_change_password(self):
        user_store.change_password("admin", "newpass")
        assert user_store.authenticate("admin", "newpass") is not None
        assert user_store.authenticate("admin", "admin") is None

    def test_delete_user(self):
        user_store.create_user("temp", "temp")
        user_store.delete_user("temp")
        assert user_store.get("temp") is None

    def test_delete_nonexistent_raises(self):
        with pytest.raises(KeyError):
            user_store.delete_user("ghost")


# ── Integration: auth API endpoints ───────────────────────


class TestAuthAPI:
    def test_login_success(self, client):
        r = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["username"] == "admin"

    def test_login_wrong_password(self, client):
        r = client.post("/api/auth/login", json={"username": "admin", "password": "wrong"})
        assert r.status_code == 401

    def test_login_unknown_user(self, client):
        r = client.post("/api/auth/login", json={"username": "nobody", "password": "pass"})
        assert r.status_code == 401

    def test_me_endpoint(self, client, auth_headers):
        r = client.get("/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["username"] == "admin"

    def test_me_without_auth(self, client):
        r = client.get("/api/auth/me")
        assert r.status_code == 401

    def test_create_user(self, client, auth_headers):
        r = client.post(
            "/api/auth/users",
            json={"username": "newadmin", "password": "pass1234"},
            headers=auth_headers,
        )
        assert r.status_code == 201
        assert r.json()["username"] == "newadmin"

    def test_create_duplicate_user(self, client, auth_headers):
        r = client.post(
            "/api/auth/users",
            json={"username": "admin", "password": "pass1234"},
            headers=auth_headers,
        )
        assert r.status_code == 409

    def test_list_users(self, client, auth_headers):
        r = client.get("/api/auth/users", headers=auth_headers)
        assert r.status_code == 200
        assert any(u["username"] == "admin" for u in r.json())

    def test_delete_user(self, client, auth_headers):
        client.post(
            "/api/auth/users",
            json={"username": "todel", "password": "pass1234"},
            headers=auth_headers,
        )
        r = client.delete("/api/auth/users/todel", headers=auth_headers)
        assert r.status_code == 204

    def test_delete_self_fails(self, client, auth_headers):
        r = client.delete("/api/auth/users/admin", headers=auth_headers)
        assert r.status_code == 400

    def test_change_password(self, client, auth_headers):
        r = client.patch(
            "/api/auth/users/admin/password",
            json={"new_password": "newpass"},
            headers=auth_headers,
        )
        assert r.status_code == 204

    def test_protected_endpoint_without_auth(self, client):
        r = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "Test",
                "player_names": ["A", "B", "C", "D"],
                "court_names": ["C1"],
                "num_groups": 1,
                "top_per_group": 2,
            },
        )
        assert r.status_code == 401


# ── Integration: tournament alias ─────────────────────────


class TestTournamentAlias:
    GP_BODY = {
        "name": "Alias Test",
        "player_names": ["A", "B", "C", "D"],
        "court_names": ["C1"],
        "num_groups": 1,
        "top_per_group": 2,
    }

    def test_set_and_resolve_alias(self, client, auth_headers):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        tid = r.json()["id"]

        r = client.put(f"/api/tournaments/{tid}/alias", json={"alias": "my-cup"}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["alias"] == "my-cup"

        r = client.get("/api/tournaments/resolve-alias/my-cup")
        assert r.status_code == 200
        assert r.json()["id"] == tid

    def test_alias_in_list(self, client, auth_headers):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        tid = r.json()["id"]
        client.put(f"/api/tournaments/{tid}/alias", json={"alias": "listed"}, headers=auth_headers)

        r = client.get("/api/tournaments")
        assert r.json()[0]["alias"] == "listed"

    def test_resolve_nonexistent_alias(self, client):
        r = client.get("/api/tournaments/resolve-alias/nope")
        assert r.status_code == 404

    def test_alias_uniqueness(self, client, auth_headers):
        r1 = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        tid1 = r1.json()["id"]
        r2 = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        tid2 = r2.json()["id"]

        client.put(f"/api/tournaments/{tid1}/alias", json={"alias": "uniq"}, headers=auth_headers)
        r = client.put(f"/api/tournaments/{tid2}/alias", json={"alias": "uniq"}, headers=auth_headers)
        assert r.status_code == 409

    def test_delete_alias(self, client, auth_headers):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        tid = r.json()["id"]
        client.put(f"/api/tournaments/{tid}/alias", json={"alias": "temp"}, headers=auth_headers)

        r = client.delete(f"/api/tournaments/{tid}/alias", headers=auth_headers)
        assert r.status_code == 200

        r = client.get("/api/tournaments/resolve-alias/temp")
        assert r.status_code == 404

    def test_set_alias_requires_auth(self, client, auth_headers):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        tid = r.json()["id"]
        r = client.put(f"/api/tournaments/{tid}/alias", json={"alias": "nope"})
        assert r.status_code == 401
