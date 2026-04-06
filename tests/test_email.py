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
    render_cancellation_email,
    render_credentials_email,
    render_next_round_email,
    render_registration_confirmation,
    render_tournament_message_email,
    render_tournament_results_email,
    render_tournament_started_email,
    render_waitlist_spot_email,
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


class TestRenderTournamentMessageEmail:
    """Tournament message email template."""

    def test_contains_message_and_tournament_name(self) -> None:
        subject, body = render_tournament_message_email(
            tournament_name="Cup 2025",
            player_name="Alice",
            message="Please arrive 15 min early",
            token="tok_abc",
            tournament_id="t99",
        )
        assert "Cup 2025" in subject
        assert "Please arrive 15 min early" in body
        assert "Alice" in body

    def test_alias_used_in_url(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_tournament_message_email(
                tournament_name="Cup",
                player_name="Bob",
                message="msg",
                token="tok1",
                tournament_alias="cup-2025",
            )
        assert "/tv/cup-2025" in body


class TestRenderNextRoundEmail:
    """Next-round notification email template."""

    def test_contains_round_number_and_match_info(self) -> None:
        subject, body = render_next_round_email(
            tournament_name="Weekend Cup",
            player_name="Alice",
            round_number=3,
            matches_info=[
                {"teammates": "Bob", "opponents": "Charlie, Dave", "court": "Court 1"},
            ],
            token="tok_abc",
            tournament_id="t1",
        )
        assert "Round 3" in subject
        assert "Weekend Cup" in subject
        assert "Alice" in body
        assert "Bob" in body
        assert "Charlie, Dave" in body
        assert "Court 1" in body

    def test_sit_out_message_when_no_matches(self) -> None:
        _, body = render_next_round_email(
            tournament_name="Cup",
            player_name="Eve",
            round_number=2,
            matches_info=[],
            token="tok1",
            tournament_id="t1",
        )
        assert "sit-out" in body.lower()

    def test_alias_used_in_url(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_next_round_email(
                tournament_name="Cup",
                player_name="Bob",
                round_number=1,
                matches_info=[{"teammates": "X", "opponents": "Y"}],
                token="tok1",
                tournament_alias="weekend",
            )
        assert "/tv/weekend" in body

    def test_multiple_matches_listed(self) -> None:
        _, body = render_next_round_email(
            tournament_name="Cup",
            player_name="Alice",
            round_number=1,
            matches_info=[
                {"teammates": "Bob", "opponents": "Charlie, Dave"},
                {"teammates": "Eve", "opponents": "Frank, Grace", "court": "Court 2"},
            ],
            token="tok1",
            tournament_id="t1",
        )
        assert "Bob" in body
        assert "Eve" in body
        assert "Court 2" in body

    def test_comment_rendered_when_present(self) -> None:
        _, body = render_next_round_email(
            tournament_name="Cup",
            player_name="Alice",
            round_number=1,
            matches_info=[
                {"teammates": "Bob", "opponents": "Charlie, Dave", "comment": "Play on grass court"},
            ],
            token="tok1",
            tournament_id="t1",
        )
        assert "Play on grass court" in body

    def test_no_comment_when_empty(self) -> None:
        _, body = render_next_round_email(
            tournament_name="Cup",
            player_name="Alice",
            round_number=1,
            matches_info=[
                {"teammates": "Bob", "opponents": "Charlie", "comment": ""},
            ],
            token="tok1",
            tournament_id="t1",
        )
        assert "📝" not in body

    def test_contacts_rendered_when_present(self) -> None:
        _, body = render_next_round_email(
            tournament_name="Cup",
            player_name="Alice",
            round_number=1,
            matches_info=[
                {
                    "teammates": "Bob",
                    "opponents": "Charlie",
                    "contacts": [
                        {"name": "Bob", "info": "bob@test.com"},
                        {"name": "Charlie", "info": "+34 600 123 456"},
                    ],
                },
            ],
            token="tok1",
            tournament_id="t1",
        )
        assert "bob@test.com" in body
        assert "+34 600 123 456" in body
        assert "Bob" in body
        assert "Charlie" in body

    def test_no_contacts_section_when_empty(self) -> None:
        _, body = render_next_round_email(
            tournament_name="Cup",
            player_name="Alice",
            round_number=1,
            matches_info=[
                {"teammates": "Bob", "opponents": "Charlie", "contacts": []},
            ],
            token="tok1",
            tournament_id="t1",
        )
        assert "📇" not in body


class TestRenderTournamentResultsEmail:
    """Final results email template."""

    def test_contains_rank_and_leaderboard(self) -> None:
        subject, body = render_tournament_results_email(
            tournament_name="Grand Finale",
            player_name="Alice",
            rank=2,
            total_players=8,
            stats={"wins": 5, "losses": 2, "draws": 1},
            leaderboard_top=[
                {"rank": 1, "name": "Bob", "score": 42},
                {"rank": 2, "name": "Alice", "score": 38},
                {"rank": 3, "name": "Charlie", "score": 30},
            ],
            token="tok_xyz",
            tournament_id="t99",
        )
        assert "Grand Finale" in subject
        assert "#2" in body
        assert "8 players" in body or "8" in body
        assert "5W" in body
        assert "Bob" in body
        assert "Alice" in body

    def test_draws_omitted_when_zero(self) -> None:
        _, body = render_tournament_results_email(
            tournament_name="Cup",
            player_name="Alice",
            rank=1,
            total_players=4,
            stats={"wins": 3, "losses": 1, "draws": 0},
            leaderboard_top=[{"rank": 1, "name": "Alice", "score": 30}],
            token="tok1",
            tournament_id="t1",
        )
        assert "3W" in body
        assert "1L" in body
        assert "D" not in body.split("3W")[1].split("</p>")[0]

    def test_alias_used_in_url(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_tournament_results_email(
                tournament_name="Cup",
                player_name="Bob",
                rank=1,
                total_players=4,
                stats={"wins": 3, "losses": 0, "draws": 0},
                leaderboard_top=[{"rank": 1, "name": "Bob", "score": 30}],
                token="tok1",
                tournament_alias="grand",
            )
        assert "/tv/grand" in body


class TestRenderCancellationEmail:
    """Registration cancellation confirmation email template."""

    def test_contains_player_name_and_lobby(self) -> None:
        subject, body = render_cancellation_email(
            lobby_name="Friday League",
            player_name="Alice",
            lobby_id="reg1",
        )
        assert "Friday League" in subject
        assert "cancelled" in subject.lower()
        assert "Alice" in body

    def test_alias_used_in_url(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_cancellation_email(
                lobby_name="T",
                player_name="Bob",
                lobby_alias="friday",
            )
        assert "/register/friday" in body


class TestRenderWaitlistSpotEmail:
    """Waitlist spot-available notification email template."""

    def test_contains_player_name_and_lobby(self) -> None:
        subject, body = render_waitlist_spot_email(
            lobby_name="Saturday Padel",
            player_name="Charlie",
            token="tok_wait",
            lobby_id="reg2",
        )
        assert "Saturday Padel" in subject
        assert "spot" in subject.lower()
        assert "Charlie" in body
        assert "waiting list" in body.lower() or "spot" in body.lower()

    def test_login_url_includes_token(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_waitlist_spot_email(
                lobby_name="T",
                player_name="Eve",
                token="tok_abc",
                lobby_id="r1",
            )
        assert "tok_abc" in body

    def test_alias_used_in_url(self) -> None:
        with patch("backend.email.SITE_URL", "https://example.com"):
            _, body = render_waitlist_spot_email(
                lobby_name="T",
                player_name="Eve",
                token="tok_abc",
                lobby_alias="saturday",
            )
        assert "/register/saturday" in body


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


# ────────────────────────────────────────────────────────────────────────────
# Creation with player_emails
# ────────────────────────────────────────────────────────────────────────────


class TestCreationWithPlayerEmails:
    """player_emails dict is accepted at creation time for all tournament types."""

    def _make_gp(self, client: TestClient, headers: dict, emails: dict | None = None) -> str:
        body: dict = {
            "name": "Email GP",
            "player_names": ["Alice", "Bob", "Charlie", "Dave"],
            "num_groups": 1,
        }
        if emails is not None:
            body["player_emails"] = emails
        r = client.post("/api/tournaments/group-playoff", json=body, headers=headers)
        assert r.status_code == 200
        return r.json()["id"]

    def _make_mex(self, client: TestClient, headers: dict, emails: dict | None = None) -> str:
        body: dict = {
            "name": "Email Mex",
            "player_names": ["Alice", "Bob", "Charlie", "Dave"],
            "num_courts": 1,
        }
        if emails is not None:
            body["player_emails"] = emails
        r = client.post("/api/tournaments/mexicano", json=body, headers=headers)
        assert r.status_code == 200
        return r.json()["id"]

    def _make_po(self, client: TestClient, headers: dict, emails: dict | None = None) -> str:
        body: dict = {
            "name": "Email PO",
            "participant_names": ["Alice", "Bob", "Charlie", "Dave"],
        }
        if emails is not None:
            body["player_emails"] = emails
        r = client.post("/api/tournaments/playoff", json=body, headers=headers)
        assert r.status_code == 200
        return r.json()["id"]

    def _secrets(self, client: TestClient, tid: str, headers: dict) -> dict:
        r = client.get(f"/api/tournaments/{tid}/player-secrets", headers=headers)
        assert r.status_code == 200
        return r.json()["players"]

    @pytest.mark.parametrize("create_fn", ["_make_gp", "_make_mex", "_make_po"])
    def test_emails_stored_at_creation(self, client: TestClient, auth_headers: dict, create_fn: str) -> None:
        emails = {"Alice": "alice@test.com", "Bob": "bob@test.com"}
        tid = getattr(self, create_fn)(client, auth_headers, emails)
        secrets = self._secrets(client, tid, auth_headers)
        email_values = {s["email"] for s in secrets.values() if s["email"]}
        assert "alice@test.com" in email_values
        assert "bob@test.com" in email_values

    @pytest.mark.parametrize("create_fn", ["_make_gp", "_make_mex", "_make_po"])
    def test_creation_without_emails_still_works(self, client: TestClient, auth_headers: dict, create_fn: str) -> None:
        tid = getattr(self, create_fn)(client, auth_headers)
        secrets = self._secrets(client, tid, auth_headers)
        assert all(s["email"] == "" for s in secrets.values())

    def test_invalid_email_in_player_emails_rejected(self, client: TestClient, auth_headers: dict) -> None:
        r = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "Bad Email GP",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "num_groups": 1,
                "player_emails": {"Alice": "not-an-email"},
            },
            headers=auth_headers,
        )
        assert r.status_code == 422


# ────────────────────────────────────────────────────────────────────────────
# Tournament email sending endpoints
# ────────────────────────────────────────────────────────────────────────────


class TestTournamentSendEmail:
    """POST /api/tournaments/{tid}/send-email/{player_id}."""

    def _create_gp_with_email(self, client: TestClient, headers: dict) -> tuple[str, dict]:
        tid = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "Send Email GP",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "num_groups": 1,
                "player_emails": {"Alice": "alice@test.com", "Bob": "bob@test.com"},
            },
            headers=headers,
        ).json()["id"]
        r = client.get(f"/api/tournaments/{tid}/player-secrets", headers=headers)
        return tid, r.json()["players"]

    def test_send_fails_when_email_not_configured(self, client: TestClient, auth_headers: dict) -> None:
        tid, secrets = self._create_gp_with_email(client, auth_headers)
        pid = next(pid for pid, s in secrets.items() if s["email"] == "alice@test.com")
        with patch("backend.api.routes_crud.email_is_configured", return_value=False):
            r = client.post(f"/api/tournaments/{tid}/send-email/{pid}", headers=auth_headers)
        assert r.status_code == 400

    @patch("backend.api.routes_crud.send_email", new_callable=AsyncMock, return_value=True)
    def test_send_succeeds_for_player_with_email(
        self, mock_send: AsyncMock, client: TestClient, auth_headers: dict
    ) -> None:
        tid, secrets = self._create_gp_with_email(client, auth_headers)
        pid = next(pid for pid, s in secrets.items() if s["email"] == "alice@test.com")
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post(f"/api/tournaments/{tid}/send-email/{pid}", headers=auth_headers)
        assert r.status_code == 200
        mock_send.assert_called_once()

    def test_send_404_for_nonexistent_player(self, client: TestClient, auth_headers: dict) -> None:
        tid, _ = self._create_gp_with_email(client, auth_headers)
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post(f"/api/tournaments/{tid}/send-email/no-such-id", headers=auth_headers)
        assert r.status_code == 404

    @patch("backend.api.routes_crud.send_email", new_callable=AsyncMock, return_value=True)
    def test_send_400_when_player_has_no_email(
        self, mock_send: AsyncMock, client: TestClient, auth_headers: dict
    ) -> None:
        tid, secrets = self._create_gp_with_email(client, auth_headers)
        pid = next(pid for pid, s in secrets.items() if not s["email"])
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post(f"/api/tournaments/{tid}/send-email/{pid}", headers=auth_headers)
        assert r.status_code == 422
        mock_send.assert_not_called()


class TestTournamentSendAllEmails:
    """POST /api/tournaments/{tid}/send-all-emails."""

    def _create_gp_with_email(self, client: TestClient, headers: dict) -> str:
        return client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "Send All GP",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "num_groups": 1,
                "player_emails": {"Alice": "alice@test.com", "Bob": "bob@test.com"},
            },
            headers=headers,
        ).json()["id"]

    @patch("backend.api.routes_crud.send_email", new_callable=AsyncMock, return_value=True)
    def test_send_all_sends_to_players_with_email(
        self, mock_send: AsyncMock, client: TestClient, auth_headers: dict
    ) -> None:
        tid = self._create_gp_with_email(client, auth_headers)
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post(f"/api/tournaments/{tid}/send-all-emails", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 2  # Alice + Bob
        assert data["skipped"] == 2  # Charlie + Dave

    @patch("backend.api.routes_crud.send_email", new_callable=AsyncMock, return_value=True)
    def test_send_all_skips_when_no_emails(self, mock_send: AsyncMock, client: TestClient, auth_headers: dict) -> None:
        tid = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "No Email GP",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "num_groups": 1,
            },
            headers=auth_headers,
        ).json()["id"]
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post(f"/api/tournaments/{tid}/send-all-emails", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 0
        assert data["skipped"] == 4


class TestTournamentSendMessageEmails:
    """POST /api/tournaments/{tid}/send-message-emails."""

    def _create_gp_with_email(self, client: TestClient, headers: dict) -> str:
        return client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "Message GP",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "num_groups": 1,
                "player_emails": {"Alice": "alice@test.com"},
            },
            headers=headers,
        ).json()["id"]

    @patch("backend.api.routes_crud.send_email", new_callable=AsyncMock, return_value=True)
    def test_send_message_to_players_with_email(
        self, mock_send: AsyncMock, client: TestClient, auth_headers: dict
    ) -> None:
        tid = self._create_gp_with_email(client, auth_headers)
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post(
                f"/api/tournaments/{tid}/send-message-emails",
                json={"message": "Hello players!"},
                headers=auth_headers,
            )
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 1
        assert data["skipped"] == 3

    def test_send_message_requires_message(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create_gp_with_email(client, auth_headers)
        with patch("backend.api.routes_crud.email_is_configured", return_value=True):
            r = client.post(
                f"/api/tournaments/{tid}/send-message-emails",
                json={"message": ""},
                headers=auth_headers,
            )
        assert r.status_code == 422

    def test_send_message_fails_when_not_configured(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create_gp_with_email(client, auth_headers)
        with patch("backend.api.routes_crud.email_is_configured", return_value=False):
            r = client.post(
                f"/api/tournaments/{tid}/send-message-emails",
                json={"message": "hello"},
                headers=auth_headers,
            )
        assert r.status_code == 400


# ── Unit tests for send_email header behaviour ─────────────────────────────


class TestSendEmailHeaders:
    """send_email() correctly sets From and Reply-To headers."""

    @pytest.fixture()
    def smtp_configured(self):
        """Patch SMTP settings to simulate a configured environment."""
        with (
            patch("backend.email.SMTP_HOST", "smtp.example.com"),
            patch("backend.email.SMTP_FROM", "noreply@example.com"),
            patch("backend.email.SMTP_PORT", 587),
            patch("backend.email.SMTP_USER", None),
            patch("backend.email.SMTP_PASS", None),
            patch("backend.email.SMTP_USE_TLS", False),
        ):
            yield

    def test_from_header_is_raw_address_when_no_sender_name(self, smtp_configured) -> None:
        import asyncio
        from backend.email import send_email

        with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
            result = asyncio.run(send_email("player@example.com", "Subject", "<p>body</p>"))
        assert result is True
        sent_msg = mock_send.call_args[0][0]
        assert sent_msg["From"] == "noreply@example.com"
        assert sent_msg["Reply-To"] is None

    def test_from_header_uses_sender_name_when_provided(self, smtp_configured) -> None:
        import asyncio
        from backend.email import send_email

        with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
            result = asyncio.run(
                send_email(
                    "player@example.com",
                    "Subject",
                    "<p>body</p>",
                    sender_name="Summer Cup",
                )
            )
        assert result is True
        sent_msg = mock_send.call_args[0][0]
        assert "Summer Cup" in sent_msg["From"]
        assert "noreply@example.com" in sent_msg["From"]

    def test_reply_to_header_set_when_provided(self, smtp_configured) -> None:
        import asyncio
        from backend.email import send_email

        with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
            asyncio.run(
                send_email(
                    "player@example.com",
                    "Subject",
                    "<p>body</p>",
                    reply_to="organizer@club.com",
                )
            )
        sent_msg = mock_send.call_args[0][0]
        assert sent_msg["Reply-To"] == "organizer@club.com"

    def test_reply_to_header_absent_when_empty(self, smtp_configured) -> None:
        import asyncio
        from backend.email import send_email

        with patch("aiosmtplib.send", new_callable=AsyncMock) as mock_send:
            asyncio.run(send_email("player@example.com", "Subject", "<p>body</p>", reply_to=""))
        sent_msg = mock_send.call_args[0][0]
        assert sent_msg["Reply-To"] is None

    def test_returns_false_when_not_configured(self) -> None:
        import asyncio
        from backend.email import send_email

        with patch("backend.email.SMTP_HOST", ""), patch("backend.email.SMTP_FROM", ""):
            result = asyncio.run(send_email("player@example.com", "Subject", "<p>body</p>"))
        assert result is False


# ── Integration tests for GET/PATCH email-settings ────────────────────────


class TestEmailSettingsEndpoint:
    """GET and PATCH /api/tournaments/{tid}/email-settings."""

    GP_BODY = {
        "name": "Settings Cup",
        "player_names": ["A", "B", "C", "D"],
        "court_names": ["Court 1"],
        "num_groups": 1,
        "top_per_group": 2,
    }

    def _create(self, client: TestClient, auth_headers: dict) -> str:
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_get_returns_defaults(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/email-settings", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["sender_name"] == ""
        assert data["reply_to"] == ""

    def test_patch_sets_sender_name(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/email-settings",
            json={"sender_name": "Summer Cup"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["sender_name"] == "Summer Cup"

    def test_patch_persists_and_get_reflects_changes(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/email-settings",
            json={"sender_name": "My Club", "reply_to": "org@club.com"},
            headers=auth_headers,
        )
        r = client.get(f"/api/tournaments/{tid}/email-settings", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["sender_name"] == "My Club"
        assert data["reply_to"] == "org@club.com"

    def test_patch_partial_update_preserves_other_field(self, client: TestClient, auth_headers: dict) -> None:
        """PATCH with only sender_name does not reset reply_to."""
        tid = self._create(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/email-settings",
            json={"sender_name": "Club A", "reply_to": "org@club.com"},
            headers=auth_headers,
        )
        client.patch(
            f"/api/tournaments/{tid}/email-settings",
            json={"sender_name": "Club B"},
            headers=auth_headers,
        )
        r = client.get(f"/api/tournaments/{tid}/email-settings", headers=auth_headers)
        data = r.json()
        assert data["sender_name"] == "Club B"
        assert data["reply_to"] == "org@club.com"

    def test_patch_invalid_reply_to_returns_422(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/email-settings",
            json={"reply_to": "not-an-email"},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_patch_sender_name_too_long_returns_422(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/email-settings",
            json={"sender_name": "X" * 101},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_patch_requires_editor_access(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create(client, auth_headers)
        # No auth headers — should be rejected
        r = client.patch(
            f"/api/tournaments/{tid}/email-settings",
            json={"sender_name": "Attacker"},
        )
        assert r.status_code in (401, 403)

    def test_get_requires_editor_access(self, client: TestClient, auth_headers: dict) -> None:
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/email-settings")
        assert r.status_code in (401, 403)

    def test_patch_nonexistent_tournament_returns_404(self, client: TestClient, auth_headers: dict) -> None:
        r = client.patch(
            "/api/tournaments/nonexistent/email-settings",
            json={"sender_name": "X"},
            headers=auth_headers,
        )
        assert r.status_code == 404
