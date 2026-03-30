"""
Tests for the auth module — login, user management, token validation, and alias endpoints.
"""

from __future__ import annotations

import pytest

import backend.email as email_mod
from backend.auth.models import UserRole
from backend.auth.security import create_access_token, decode_access_token, hash_password, verify_password
from backend.auth.store import AuthTokenType, user_store


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
            json={"new_password": "newpass12"},
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


# ── Unit: email helpers on User store ─────────────────────


class TestUserStoreEmail:
    def test_set_and_get_email(self):
        user_store.set_email("admin", "admin@example.com")
        user = user_store.get("admin")
        assert user is not None
        assert user.email == "admin@example.com"

    def test_set_email_clears_with_none(self):
        user_store.set_email("admin", "admin@example.com")
        user_store.set_email("admin", None)
        user = user_store.get("admin")
        assert user is not None
        assert user.email is None

    def test_set_email_unknown_user_raises(self):
        with pytest.raises(KeyError):
            user_store.set_email("ghost", "ghost@example.com")

    def test_find_by_email_returns_user(self):
        user_store.set_email("alice", "alice@example.com")
        found = user_store.find_by_email("alice@example.com")
        assert found is not None
        assert found.username == "alice"

    def test_find_by_email_case_insensitive(self):
        user_store.set_email("alice", "alice@example.com")
        found = user_store.find_by_email("ALICE@EXAMPLE.COM")
        assert found is not None

    def test_find_by_email_unknown_returns_none(self):
        assert user_store.find_by_email("nobody@nowhere.com") is None

    def test_create_user_with_email(self):
        user = user_store.create_user("withmail", "password1", email="withmail@example.com")
        assert user.email == "withmail@example.com"
        assert user_store.find_by_email("withmail@example.com") is not None


# ── Unit: auth tokens ─────────────────────────────────────


class TestAuthTokens:
    def test_invite_token_roundtrip(self):
        raw = user_store.create_auth_token("invited@example.com", AuthTokenType.INVITE, role=UserRole.USER)
        data = user_store.peek_auth_token(raw, AuthTokenType.INVITE)
        assert data is not None
        assert data["email"] == "invited@example.com"
        assert data["role"] == "user"

    def test_consume_token_marks_used(self):
        raw = user_store.create_auth_token("used@example.com", AuthTokenType.INVITE, role=UserRole.USER)
        data = user_store.consume_auth_token(raw, AuthTokenType.INVITE)
        assert data is not None
        # Second consume must fail
        assert user_store.consume_auth_token(raw, AuthTokenType.INVITE) is None

    def test_peek_does_not_consume(self):
        raw = user_store.create_auth_token("peek@example.com", AuthTokenType.INVITE, role=UserRole.USER)
        user_store.peek_auth_token(raw, AuthTokenType.INVITE)
        assert user_store.peek_auth_token(raw, AuthTokenType.INVITE) is not None

    def test_wrong_token_type_rejected(self):
        raw = user_store.create_auth_token("typed@example.com", AuthTokenType.INVITE, role=UserRole.USER)
        assert user_store.peek_auth_token(raw, AuthTokenType.PASSWORD_RESET) is None

    def test_unknown_token_returns_none(self):
        assert user_store.peek_auth_token("totallyfaketoken", AuthTokenType.INVITE) is None

    def test_password_reset_token_no_role(self):
        raw = user_store.create_auth_token("reset@example.com", AuthTokenType.PASSWORD_RESET)
        data = user_store.peek_auth_token(raw, AuthTokenType.PASSWORD_RESET)
        assert data is not None
        assert data["email"] == "reset@example.com"
        assert data["role"] is None

    def test_purge_removes_used_tokens(self):
        raw = user_store.create_auth_token("purge@example.com", AuthTokenType.INVITE, role=UserRole.USER)
        user_store.consume_auth_token(raw, AuthTokenType.INVITE)
        removed = user_store.purge_expired_tokens()
        assert removed >= 1


# ── Fixtures ──────────────────────────────────────────────


@pytest.fixture
def email_enabled():
    """Temporarily enable email so invite/reset endpoints are exercisable."""
    email_mod.SMTP_HOST = "localhost"
    email_mod.SMTP_FROM = "test@padel.local"
    yield
    email_mod.SMTP_HOST = None
    email_mod.SMTP_FROM = None


# ── Integration: invite flow ───────────────────────────────


class TestInviteFlow:
    def test_send_invite_no_smtp_returns_503(self, client, auth_headers):
        r = client.post("/api/auth/invite", json={"email": "new@example.com", "role": "user"}, headers=auth_headers)
        assert r.status_code == 503

    def test_send_invite_requires_admin(self, client, alice_headers):
        r = client.post("/api/auth/invite", json={"email": "new@example.com", "role": "user"}, headers=alice_headers)
        assert r.status_code == 403

    def test_send_invite_unauthenticated(self, client):
        r = client.post("/api/auth/invite", json={"email": "new@example.com", "role": "user"})
        assert r.status_code == 401

    def test_send_invite_success(self, client, auth_headers, email_enabled):
        r = client.post("/api/auth/invite", json={"email": "new@example.com", "role": "admin"}, headers=auth_headers)
        assert r.status_code == 204

    def test_preview_invite_invalid_token(self, client):
        r = client.get("/api/auth/invite/badtoken")
        assert r.status_code == 404

    def test_preview_invite_valid_token(self, client):
        raw = user_store.create_auth_token("preview@example.com", AuthTokenType.INVITE, role=UserRole.ADMIN)
        r = client.get(f"/api/auth/invite/{raw}")
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == "preview@example.com"
        assert data["role"] == "admin"

    def test_accept_invite_creates_user(self, client):
        raw = user_store.create_auth_token("newuser@example.com", AuthTokenType.INVITE, role=UserRole.USER)
        r = client.post(f"/api/auth/invite/{raw}/accept", json={"username": "newuser", "password": "securepass1"})
        assert r.status_code == 201
        data = r.json()
        assert data["username"] == "newuser"
        assert data["role"] == "user"
        assert data["email"] == "newuser@example.com"

    def test_accept_invite_twice_fails(self, client):
        raw = user_store.create_auth_token("twice@example.com", AuthTokenType.INVITE, role=UserRole.USER)
        client.post(f"/api/auth/invite/{raw}/accept", json={"username": "twice1user", "password": "securepass1"})
        r = client.post(f"/api/auth/invite/{raw}/accept", json={"username": "twice2user", "password": "securepass1"})
        assert r.status_code == 404

    def test_accept_invite_invalid_token_fails(self, client):
        r = client.post("/api/auth/invite/fakebadtoken/accept", json={"username": "nobody", "password": "securepass1"})
        assert r.status_code == 404

    def test_accept_invite_duplicate_username_fails(self, client):
        raw = user_store.create_auth_token("dup@example.com", AuthTokenType.INVITE, role=UserRole.USER)
        r = client.post(f"/api/auth/invite/{raw}/accept", json={"username": "admin", "password": "securepass1"})
        assert r.status_code == 409

    @pytest.mark.parametrize("role", ["admin", "user"])
    def test_accept_invite_preserves_role(self, client, role):
        user_role = UserRole(role)
        raw = user_store.create_auth_token(f"role_{role}@example.com", AuthTokenType.INVITE, role=user_role)
        uname = f"role_{role}_user"
        r = client.post(f"/api/auth/invite/{raw}/accept", json={"username": uname, "password": "securepass1"})
        assert r.status_code == 201
        assert r.json()["role"] == role


# ── Integration: password-reset flow ──────────────────────


class TestPasswordResetFlow:
    def test_forgot_password_no_smtp_returns_503(self, client):
        r = client.post("/api/auth/forgot-password", json={"email": "admin@example.com"})
        assert r.status_code == 503

    def test_forgot_password_unknown_email_still_204(self, client, email_enabled):
        """Always 204 to avoid account enumeration."""
        r = client.post("/api/auth/forgot-password", json={"email": "nobody@nowhere.com"})
        assert r.status_code == 204

    def test_forgot_password_known_email_sends_reset(self, client, email_enabled):
        user_store.set_email("admin", "admin@example.com")
        r = client.post("/api/auth/forgot-password", json={"email": "admin@example.com"})
        assert r.status_code == 204

    def test_reset_password_invalid_token(self, client):
        r = client.post("/api/auth/reset-password/badtoken", json={"new_password": "newpass1234"})
        assert r.status_code == 404

    def test_reset_password_happy_path(self, client):
        user_store.set_email("admin", "admin@example.com")
        raw = user_store.create_auth_token("admin@example.com", AuthTokenType.PASSWORD_RESET)
        r = client.post(f"/api/auth/reset-password/{raw}", json={"new_password": "brandnewpass"})
        assert r.status_code == 204
        # Verify new password works
        login = client.post("/api/auth/login", json={"username": "admin", "password": "brandnewpass"})
        assert login.status_code == 200

    def test_reset_password_used_token_rejected(self, client):
        user_store.set_email("admin", "admin@example.com")
        raw = user_store.create_auth_token("admin@example.com", AuthTokenType.PASSWORD_RESET)
        client.post(f"/api/auth/reset-password/{raw}", json={"new_password": "brandnewpass"})
        r = client.post(f"/api/auth/reset-password/{raw}", json={"new_password": "anotherpass"})
        assert r.status_code == 404

    def test_reset_password_invite_token_rejected(self, client):
        """Reset endpoint must not accept invite tokens."""
        raw = user_store.create_auth_token("admin@example.com", AuthTokenType.INVITE, role=UserRole.ADMIN)
        r = client.post(f"/api/auth/reset-password/{raw}", json={"new_password": "brandnewpass"})
        assert r.status_code == 404


# ── Integration: email in user management ─────────────────


class TestUserEmailManagement:
    def test_create_user_with_email(self, client, auth_headers):
        r = client.post(
            "/api/auth/users",
            json={"username": "emailuser", "password": "pass1234", "email": "emailuser@example.com"},
            headers=auth_headers,
        )
        assert r.status_code == 201
        assert r.json()["email"] == "emailuser@example.com"

    def test_create_user_without_email(self, client, auth_headers):
        r = client.post(
            "/api/auth/users",
            json={"username": "noemail", "password": "pass1234"},
            headers=auth_headers,
        )
        assert r.status_code == 201
        assert r.json()["email"] is None

    def test_list_users_includes_email(self, client, auth_headers):
        user_store.set_email("alice", "alice@example.com")
        r = client.get("/api/auth/users", headers=auth_headers)
        assert r.status_code == 200
        alice = next(u for u in r.json() if u["username"] == "alice")
        assert alice["email"] == "alice@example.com"

    def test_me_endpoint_includes_email(self, client, auth_headers):
        user_store.set_email("admin", "admin@example.com")
        r = client.get("/api/auth/me", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["email"] == "admin@example.com"
