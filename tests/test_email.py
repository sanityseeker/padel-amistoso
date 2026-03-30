"""
Tests for email functionality — configuration detection, template rendering,
registration email storage, send endpoints, auto-send behaviour, and
tournament notifications.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.email import (
    _esc,
    is_configured,
    is_valid_email,
    render_credentials_email,
    render_registration_confirmation,
    render_tournament_started_email,
)


# ── Unit tests for backend.email helpers ────────────────────────────────────


class TestIsValidEmail:
    """Validation of email address format."""

    @pytest.mark.parametrize(
        "email",
        [
            "alice@example.com",
            "bob+tag@sub.domain.org",
            "user@host.co",
        ],
    )
    def test_valid_addresses(self, email: str) -> None:
        assert is_valid_email(email) is True

    @pytest.mark.parametrize(
        "email",
        [
            "",
            "   ",
            "alice",
            "@example.com",
            "alice@",
            "alice@com",
            "alice @example.com",
        ],
    )
    def test_invalid_addresses(self, email: str) -> None:
        assert is_valid_email(email) is False


class TestEscape:
    """HTML escape helper."""

    def test_escapes_special_chars(self) -> None:
        assert _esc('<b>"A & B"</b>') == "&lt;b&gt;&quot;A &amp; B&quot;&lt;/b&gt;"

    def test_plain_text_unchanged(self) -> None:
        assert _esc("hello world") == "hello world"


class TestIsConfigured:
    """is_configured() checks SMTP_HOST and SMTP_FROM."""

    def test_not_configured_by_default(self) -> None:
        with patch("backend.email.SMTP_HOST", None), patch("backend.email.SMTP_FROM", None):
            assert is_configured() is False


class TestRenderRegistrationConfirmation:
    """Registration confirmation email template."""

    def test_contains_passphrase_and_player_name(self) -> None:
        subject, body = render_registration_confirmation(
            lobby_name="Friday Night",
            player_name="Alice",
            passphrase="green-frog",
            token="tok123",
            lobby_id="reg1",
        )
        assert "Friday Night" in subject
        assert "Alice" in body
        assert "green-frog" in body

    def test_login_url_includes_token(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_registration_confirmation(
                lobby_name="T",
                player_name="Bob",
                passphrase="pp",
                token="tok_abc",
                lobby_id="r1",
            )
        assert "tok_abc" in body

    def test_alias_used_in_url(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_registration_confirmation(
                lobby_name="T",
                player_name="Bob",
                passphrase="pp",
                token="tok_abc",
                lobby_alias="friday",
            )
        assert "/register/friday" in body


class TestRenderCredentialsEmail:
    """Credentials reminder email template."""

    def test_contains_passphrase(self) -> None:
        subject, body = render_credentials_email(
            lobby_name="Fun Padel",
            player_name="Charlie",
            passphrase="secret-word",
            token="t1",
            lobby_id="r2",
        )
        assert "secret-word" in body
        assert "Fun Padel" in subject


class TestRenderTournamentStartedEmail:
    """Tournament-started notification email template."""

    def test_contains_tournament_name_and_passphrase(self) -> None:
        subject, body = render_tournament_started_email(
            tournament_name="Grand Tournament",
            player_name="Dana",
            passphrase="purple-moon",
            token="tok_xyz",
            tournament_id="t42",
        )
        assert "Grand Tournament" in subject
        assert "purple-moon" in body
        assert "Dana" in body

    def test_alias_used_in_url(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_tournament_started_email(
                tournament_name="GT",
                player_name="Eve",
                passphrase="pp",
                token="tok1",
                tournament_alias="grand",
            )
        assert "/tv/grand" in body


# ── Integration tests for email-related API endpoints ──────────────────────


class TestEmailStatusEndpoint:
    """GET /api/tournaments/email-status."""

    def test_returns_configured_false_when_not_set(self, client: TestClient, auth_headers: dict) -> None:
        with patch("backend.api.routes_crud.email_is_configured", return_value=False):
            r = client.get("/api/tournaments/email-status", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["configured"] is False

    def test_returns_configured_true_when_set(self, client: TestClient, auth_headers: dict) -> None:
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.get("/api/tournaments/email-status", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["configured"] is True


class TestRegistrantEmailField:
    """Email field on registrants — stored and returned correctly."""

    def _create_registration(self, client: TestClient, auth_headers: dict, name: str = "Lobby") -> str:
        r = client.post("/api/registrations", json={"name": name}, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_register_with_email(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._create_registration(client, auth_headers)
        r = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "email": "alice@example.com"},
        )
        assert r.status_code == 200

        # Fetch detail — admin view should include email
        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        alice = next(p for p in detail["registrants"] if p["player_name"] == "Alice")
        assert alice["email"] == "alice@example.com"

    def test_register_without_email(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._create_registration(client, auth_headers)
        r = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Bob"})
        assert r.status_code == 200

        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        bob = next(p for p in detail["registrants"] if p["player_name"] == "Bob")
        assert bob["email"] == ""

    def test_patch_registrant_email(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._create_registration(client, auth_headers)
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Charlie"},
        ).json()
        pid = reg["player_id"]

        r = client.patch(
            f"/api/registrations/{rid}/registrant/{pid}",
            json={"email": "charlie@example.com"},
            headers=auth_headers,
        )
        assert r.status_code == 200

        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        charlie = next(p for p in detail["registrants"] if p["player_id"] == pid)
        assert charlie["email"] == "charlie@example.com"

    def test_admin_add_registrant_with_email(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._create_registration(client, auth_headers)
        r = client.post(
            f"/api/registrations/{rid}/registrant",
            json={"player_name": "Dana", "email": "dana@example.com"},
            headers=auth_headers,
        )
        assert r.status_code == 200

        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        dana = next(p for p in detail["registrants"] if p["player_name"] == "Dana")
        assert dana["email"] == "dana@example.com"


class TestAutoSendEmailSetting:
    """The auto_send_email flag on registration lobbies."""

    def test_create_with_auto_send(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post(
            "/api/registrations",
            json={"name": "AutoSend Lobby", "auto_send_email": True},
            headers=auth_headers,
        )
        assert r.status_code == 200
        detail = client.get(f"/api/registrations/{r.json()['id']}", headers=auth_headers).json()
        assert detail["auto_send_email"] is True

    def test_update_auto_send_toggle(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post("/api/registrations", json={"name": "Toggle"}, headers=auth_headers)
        rid = r.json()["id"]

        client.patch(
            f"/api/registrations/{rid}",
            json={"auto_send_email": True},
            headers=auth_headers,
        )
        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert detail["auto_send_email"] is True

        client.patch(
            f"/api/registrations/{rid}",
            json={"auto_send_email": False},
            headers=auth_headers,
        )
        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert detail["auto_send_email"] is False


class TestEmailRequirementSetting:
    """Tri-state email requirement on registration lobbies."""

    def test_create_with_required_email(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post(
            "/api/registrations",
            json={"name": "Email Required", "email_requirement": "required"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        rid = r.json()["id"]

        admin_detail = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert admin_detail.status_code == 200
        assert admin_detail.json()["email_requirement"] == "required"

        public_detail = client.get(f"/api/registrations/{rid}/public")
        assert public_detail.status_code == 200
        assert public_detail.json()["email_requirement"] == "required"

    def test_update_email_requirement(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post("/api/registrations", json={"name": "Email Mode"}, headers=auth_headers)
        rid = r.json()["id"]

        upd = client.patch(
            f"/api/registrations/{rid}",
            json={"email_requirement": "disabled"},
            headers=auth_headers,
        )
        assert upd.status_code == 200

        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert detail.status_code == 200
        assert detail.json()["email_requirement"] == "disabled"

    def test_register_required_rejects_missing_email(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post(
            "/api/registrations",
            json={"name": "Req", "email_requirement": "required"},
            headers=auth_headers,
        )
        rid = r.json()["id"]

        reg = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        assert reg.status_code == 400
        assert "email" in reg.json()["detail"].lower()

    def test_register_required_rejects_invalid_email(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post(
            "/api/registrations",
            json={"name": "Req", "email_requirement": "required"},
            headers=auth_headers,
        )
        rid = r.json()["id"]

        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "email": "not-an-email"},
        )
        # Schema validation rejects invalid email format before the route handler runs.
        assert reg.status_code == 422

    def test_register_required_accepts_valid_email(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post(
            "/api/registrations",
            json={"name": "Req", "email_requirement": "required"},
            headers=auth_headers,
        )
        rid = r.json()["id"]

        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "email": "alice@example.com"},
        )
        assert reg.status_code == 200

    def test_register_disabled_rejects_email(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post(
            "/api/registrations",
            json={"name": "NoEmail", "email_requirement": "disabled"},
            headers=auth_headers,
        )
        rid = r.json()["id"]

        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "email": "alice@example.com"},
        )
        assert reg.status_code == 400

    def test_register_optional_accepts_without_email(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post(
            "/api/registrations",
            json={"name": "Optional", "email_requirement": "optional"},
            headers=auth_headers,
        )
        rid = r.json()["id"]

        reg = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        assert reg.status_code == 200


class TestSendEmailEndpoint:
    """POST /api/registrations/{rid}/send-email/{player_id}."""

    def _setup(self, client: TestClient, auth_headers: dict) -> tuple[str, str]:
        r = client.post("/api/registrations", json={"name": "Email Lobby"}, headers=auth_headers)
        rid = r.json()["id"]
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "email": "alice@test.com"},
        ).json()
        return rid, reg["player_id"]

    def test_send_email_fails_when_not_configured(self, client: TestClient, auth_headers: dict) -> None:
        rid, pid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=False):
            r = client.post(f"/api/registrations/{rid}/send-email/{pid}", headers=auth_headers)
        assert r.status_code == 400
        assert "not configured" in r.json()["detail"].lower()

    def test_send_email_422_when_no_email(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post("/api/registrations", json={"name": "NoEmail"}, headers=auth_headers)
        rid = r.json()["id"]
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Bob"},
        ).json()
        pid = reg["player_id"]

        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(f"/api/registrations/{rid}/send-email/{pid}", headers=auth_headers)
        assert r.status_code == 422

    @patch("backend.api.routes_registration.send_email", new_callable=AsyncMock, return_value=True)
    def test_send_email_success(self, mock_send: AsyncMock, client: TestClient, auth_headers: dict) -> None:
        rid, pid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(f"/api/registrations/{rid}/send-email/{pid}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["sent"] is True
        mock_send.assert_called_once()
        # Verify the email address passed to send_email
        call_args = mock_send.call_args
        assert call_args[0][0] == "alice@test.com"

    def test_send_email_404_wrong_player(self, client: TestClient, auth_headers: dict) -> None:
        rid, _ = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(f"/api/registrations/{rid}/send-email/nonexist", headers=auth_headers)
        assert r.status_code == 404


class TestSendAllEmailsEndpoint:
    """POST /api/registrations/{rid}/send-all-emails."""

    def _setup(self, client: TestClient, auth_headers: dict) -> str:
        r = client.post("/api/registrations", json={"name": "Bulk Lobby"}, headers=auth_headers)
        rid = r.json()["id"]
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "A", "email": "a@test.com"})
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "B", "email": "b@test.com"})
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "C"})  # no email
        return rid

    def test_send_all_fails_when_not_configured(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=False):
            r = client.post(f"/api/registrations/{rid}/send-all-emails", headers=auth_headers)
        assert r.status_code == 400

    @patch("backend.api.routes_registration.send_email", new_callable=AsyncMock, return_value=True)
    def test_send_all_counts(self, mock_send: AsyncMock, client: TestClient, auth_headers: dict) -> None:
        rid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(f"/api/registrations/{rid}/send-all-emails", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 2
        assert data["skipped"] == 1
        assert data["failed"] == 0
        assert mock_send.call_count == 2

    @patch("backend.api.routes_registration.send_email", new_callable=AsyncMock, return_value=False)
    def test_send_all_counts_failures(self, mock_send: AsyncMock, client: TestClient, auth_headers: dict) -> None:
        rid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(f"/api/registrations/{rid}/send-all-emails", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 0
        assert data["skipped"] == 1
        assert data["failed"] == 2


class TestSendMessageEmailsEndpoint:
    """POST /api/registrations/{rid}/send-message-emails."""

    def _setup(self, client: TestClient, auth_headers: dict, with_message: bool = True) -> str:
        payload = {"name": "Message Lobby"}
        if with_message:
            payload["message"] = "Please be on time."
        r = client.post("/api/registrations", json=payload, headers=auth_headers)
        rid = r.json()["id"]
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "A", "email": "a@test.com"})
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "B", "email": "b@test.com"})
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "C"})
        return rid

    def test_send_message_fails_when_not_configured(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=False):
            r = client.post(f"/api/registrations/{rid}/send-message-emails", headers=auth_headers)
        assert r.status_code == 400

    def test_send_message_fails_when_message_empty(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._setup(client, auth_headers, with_message=False)
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(f"/api/registrations/{rid}/send-message-emails", headers=auth_headers)
        assert r.status_code == 400

    @patch("backend.api.routes_registration.send_email", new_callable=AsyncMock, return_value=True)
    def test_send_message_counts(self, mock_send: AsyncMock, client: TestClient, auth_headers: dict) -> None:
        rid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(f"/api/registrations/{rid}/send-message-emails", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 2
        assert data["skipped"] == 1
        assert data["failed"] == 0
        assert mock_send.call_count == 2


class TestNotifyPlayersEndpoint:
    """POST /api/tournaments/{tid}/notify-players."""

    def _create_gp_tournament(self, client: TestClient, auth_headers: dict) -> str:
        """Create a simple GP tournament for notification tests."""
        r = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "Notify Test",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        return r.json()["id"]

    def test_notify_fails_when_not_configured(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create_gp_tournament(client, auth_headers)
        with patch("backend.api.routes_crud.email_is_configured", return_value=False):
            r = client.post(f"/api/tournaments/{tid}/notify-players", headers=auth_headers)
        assert r.status_code == 400

    def test_notify_404_unknown_tournament(self, client: TestClient, auth_headers: dict) -> None:
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post("/api/tournaments/nonexistent/notify-players", headers=auth_headers)
        assert r.status_code == 404

    @patch("backend.api.routes_crud.send_email", new_callable=AsyncMock, return_value=True)
    def test_notify_skips_all_when_no_emails(
        self, mock_send: AsyncMock, client: TestClient, auth_headers: dict
    ) -> None:
        """Without email addresses on secrets, all players are skipped."""
        tid = self._create_gp_tournament(client, auth_headers)
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post(f"/api/tournaments/{tid}/notify-players", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 0
        assert data["skipped"] == 4
        assert data["failed"] == 0
        mock_send.assert_not_called()


class TestEmailCarriedThroughConversion:
    """Email addresses from registrants survive conversion to tournament player_secrets."""

    def _setup_and_convert(self, client: TestClient, auth_headers: dict) -> tuple[str, str]:
        """Create a lobby with emails, convert to GP tournament, return (rid, tid)."""
        r = client.post("/api/registrations", json={"name": "Email Conv"}, headers=auth_headers)
        rid = r.json()["id"]
        for name, email in [
            ("Alice", "alice@test.com"),
            ("Bob", "bob@test.com"),
            ("Charlie", ""),
            ("Dave", "dave@test.com"),
        ]:
            payload = {"player_name": name}
            if email:
                payload["email"] = email
            client.post(f"/api/registrations/{rid}/register", json=payload)

        conv = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert conv.status_code == 200
        tid = conv.json()["tournament_id"]
        return rid, tid

    @patch("backend.api.routes_crud.send_email", new_callable=AsyncMock, return_value=True)
    def test_email_preserved_in_player_secrets_after_conversion(
        self, mock_send: AsyncMock, client: TestClient, auth_headers: dict
    ) -> None:
        """Emails from registrants should be written to player_secrets during conversion.

        The conversion writes player_secrets directly to the test DB via
        ``conn.executemany``.  We verify the data arrived by reading it back
        from the DB through the real ``get_secrets_for_tournament`` from
        ``player_secret_store``.
        """
        _, tid = self._setup_and_convert(client, auth_headers)

        # Read secrets directly from the DB (bypasses in-memory mock)

        import backend.api.db as db_mod

        with db_mod.get_db() as conn:
            rows = conn.execute(
                "SELECT player_id, email FROM player_secrets WHERE tournament_id = ?",
                (tid,),
            ).fetchall()

        emails = {r["player_id"]: r["email"] for r in rows}
        # At least 3 of the 4 players should have emails (Alice, Bob, Dave)
        non_empty = [e for e in emails.values() if e]
        assert len(non_empty) == 3
        assert "alice@test.com" in emails.values()
        assert "bob@test.com" in emails.values()
        assert "dave@test.com" in emails.values()
