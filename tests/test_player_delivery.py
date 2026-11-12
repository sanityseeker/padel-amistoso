"""
Tests for the tournament delivery mode: organizer sends go by push, email or both.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from backend.api.player_delivery import PUSH_BODY_MAX, _clip, push_next_round, push_results
from backend.api.push import save_subscription

_SUB = {"endpoint": "https://push.example/abc", "keys": {"p256dh": "k", "auth": "a"}}


def _create(client: TestClient, headers: dict) -> str:
    """GP tournament: Alice and Bob have an email, Charlie and Dave do not."""
    r = client.post(
        "/api/tournaments/group-playoff",
        json={
            "name": "Delivery GP",
            "player_names": ["Alice", "Bob", "Charlie", "Dave"],
            "num_groups": 1,
            "player_emails": {"Alice": "alice@test.com", "Bob": "bob@test.com"},
        },
        headers=headers,
    )
    assert r.status_code == 200
    return r.json()["id"]


def _ids(client: TestClient, tid: str, headers: dict) -> dict[str, str]:
    players = client.get(f"/api/tournaments/{tid}/player-secrets", headers=headers).json()["players"]
    return {info["name"]: pid for pid, info in players.items()}


def _set_delivery(client: TestClient, tid: str, headers: dict, mode: str) -> dict:
    r = client.patch(f"/api/tournaments/{tid}/email-settings", json={"delivery": mode}, headers=headers)
    assert r.status_code == 200
    return r.json()


@contextmanager
def _channels(*, email: bool = True, push: bool = True) -> Iterator[tuple[AsyncMock, MagicMock]]:
    with (
        patch("backend.api.player_delivery.email_is_configured", return_value=email),
        patch("backend.api.player_delivery.is_push_available", return_value=push),
        patch("backend.api.routes_crud.is_push_available", return_value=push),
        patch("backend.api.player_delivery.send_email", new_callable=AsyncMock, return_value=True) as mail,
        patch("backend.api.player_delivery.send_push_to_players") as push_send,
    ):
        yield mail, push_send


def _message(client: TestClient, tid: str, headers: dict, text: str = "Courts moved to the north side") -> dict:
    r = client.post(f"/api/tournaments/{tid}/send-message-emails", json={"message": text}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


class TestDeliverySettings:
    def test_default_is_email(self, client: TestClient, auth_headers: dict) -> None:
        tid = _create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/email-settings", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["delivery"] == "email"
        assert body["push_subscribers"] == 0

    def test_patch_keeps_sender_and_counts_subscribers(self, client: TestClient, auth_headers: dict) -> None:
        tid = _create(client, auth_headers)
        client.patch(f"/api/tournaments/{tid}/email-settings", json={"sender_name": "Club"}, headers=auth_headers)
        save_subscription(tid, _ids(client, tid, auth_headers)["Alice"], _SUB)
        with _channels():
            body = _set_delivery(client, tid, auth_headers, "push_first")
        assert body["delivery"] == "push_first"
        assert body["sender_name"] == "Club"
        assert body["push_available"] is True
        assert body["push_subscribers"] == 1

    def test_rejects_unknown_mode(self, client: TestClient, auth_headers: dict) -> None:
        tid = _create(client, auth_headers)
        r = client.patch(f"/api/tournaments/{tid}/email-settings", json={"delivery": "sms"}, headers=auth_headers)
        assert r.status_code == 422


class TestDeliveryModes:
    def _setup(self, client: TestClient, headers: dict, mode: str) -> tuple[str, dict[str, str]]:
        """Alice (email) and Charlie (no email) have notifications on."""
        tid = _create(client, headers)
        ids = _ids(client, tid, headers)
        save_subscription(tid, ids["Alice"], _SUB)
        save_subscription(tid, ids["Charlie"], {**_SUB, "endpoint": "https://push.example/c"})
        _set_delivery(client, tid, headers, mode)
        return tid, ids

    def test_email_mode_ignores_push(self, client: TestClient, auth_headers: dict) -> None:
        tid, _ = self._setup(client, auth_headers, "email")
        with _channels() as (mail, push_send):
            data = _message(client, tid, auth_headers)
        assert (data["sent"], data["pushed"], data["skipped"]) == (2, 0, 2)
        push_send.assert_not_called()
        assert mail.await_count == 2

    def test_push_first_pushes_subscribers_and_emails_the_rest(self, client: TestClient, auth_headers: dict) -> None:
        tid, ids = self._setup(client, auth_headers, "push_first")
        with _channels() as (mail, push_send):
            data = _message(client, tid, auth_headers)
        # Alice and Charlie by push, Bob by email, Dave unreachable.
        assert (data["sent"], data["pushed"], data["skipped"]) == (1, 2, 1)
        pushed_to = {next(iter(c.kwargs["player_ids"])) for c in push_send.call_args_list}
        assert pushed_to == {ids["Alice"], ids["Charlie"]}
        assert [c.args[0] for c in mail.await_args_list] == ["bob@test.com"]
        assert push_send.call_args.kwargs["body"] == "Courts moved to the north side"

    def test_both_sends_push_and_email(self, client: TestClient, auth_headers: dict) -> None:
        tid, _ = self._setup(client, auth_headers, "both")
        with _channels() as (mail, _push_send):
            data = _message(client, tid, auth_headers)
        assert (data["sent"], data["pushed"], data["skipped"]) == (2, 2, 1)
        assert sorted(c.args[0] for c in mail.await_args_list) == ["alice@test.com", "bob@test.com"]

    def test_push_works_without_email_configured(self, client: TestClient, auth_headers: dict) -> None:
        tid, _ = self._setup(client, auth_headers, "push_first")
        with _channels(email=False) as (mail, _push_send):
            data = _message(client, tid, auth_headers)
        assert (data["sent"], data["pushed"], data["skipped"]) == (0, 2, 2)
        mail.assert_not_called()

    def test_email_mode_without_email_is_rejected(self, client: TestClient, auth_headers: dict) -> None:
        tid, _ = self._setup(client, auth_headers, "email")
        with _channels(email=False):
            r = client.post(f"/api/tournaments/{tid}/send-message-emails", json={"message": "x"}, headers=auth_headers)
        assert r.status_code == 400

    def test_tournament_started_by_push(self, client: TestClient, auth_headers: dict) -> None:
        tid, _ = self._setup(client, auth_headers, "push_first")
        with _channels() as (_mail, push_send):
            r = client.post(f"/api/tournaments/{tid}/notify-players", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["pushed"] == 2
        assert push_send.call_args.kwargs["url"] == f"/tv/{tid}"

    def test_next_round_by_push(self, client: TestClient, auth_headers: dict) -> None:
        tid, _ = self._setup(client, auth_headers, "push_first")
        with _channels() as (_mail, push_send):
            r = client.post(f"/api/tournaments/{tid}/send-next-round-emails", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["pushed"] == 2
        assert "vs" in push_send.call_args.kwargs["body"]

    def test_login_codes_stay_email_only(self, client: TestClient, auth_headers: dict) -> None:
        tid, _ = self._setup(client, auth_headers, "push_first")
        with (
            patch("backend.api.routes_crud.email_is_configured", return_value=True),
            patch("backend.api.routes_crud.send_email", new_callable=AsyncMock, return_value=True),
            patch("backend.api.player_delivery.send_push_to_players") as push_send,
        ):
            r = client.post(f"/api/tournaments/{tid}/send-all-emails", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["sent"] == 2
        push_send.assert_not_called()


class TestPushTexts:
    def test_long_message_is_clipped(self) -> None:
        clipped = _clip("ж" * 3000)
        assert len(clipped) == PUSH_BODY_MAX
        assert clipped.endswith("…")

    def test_short_message_whitespace_is_collapsed(self) -> None:
        assert _clip("Hello\n\n  players") == "Hello players"

    @pytest.mark.parametrize(
        ("lang", "expected"),
        [
            ("en", "Round 2: With Bob vs Carla & Dan, court 1"),
            ("es", "Ronda 2: Con Bob vs Carla & Dan, cancha 1"),
            ("ru", "Раунд 2: Партнёр: Bob, соперники: Carla & Dan, корт 1"),
        ],
    )
    def test_next_round_text(self, lang: str, expected: str) -> None:
        info = [{"teammates": "Bob", "opponents": "Carla & Dan", "court": "1", "round_number": 2}]
        assert push_next_round(lang, 2, info) == expected

    def test_next_round_uses_the_match_round_label(self) -> None:
        info = [{"opponents": "Carla", "round_label": "Final", "bye": False}]
        assert push_next_round("en", 3, info) == "Final: vs Carla"

    def test_results_text(self) -> None:
        assert push_results("en", 2, 8) == "Final results are in: you finished 2 of 8."
