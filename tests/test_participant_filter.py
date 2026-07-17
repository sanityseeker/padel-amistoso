"""Tests for the registration participant filter (final eligible set + filtered messaging)."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

QUESTIONS = [
    {"key": "level", "label": "Level", "type": "choice", "required": False, "choices": ["A", "B", "C"]},
    {"key": "days", "label": "Days", "type": "multichoice", "required": False, "choices": ["Mon", "Tue", "Wed"]},
    {"key": "rating", "label": "Rating", "type": "number", "required": False, "choices": []},
    {"key": "notes", "label": "Notes", "type": "text", "required": False, "choices": []},
]


def _create_lobby(client: TestClient, auth_headers: dict, **extra) -> str:
    payload = {"name": "Filter Lobby", "questions": QUESTIONS, **extra}
    r = client.post("/api/registrations", json=payload, headers=auth_headers)
    assert r.status_code == 200
    return r.json()["id"]


def _register(client: TestClient, rid: str, name: str, answers: dict, email: str = "") -> str:
    r = client.post(
        f"/api/registrations/{rid}/register",
        json={"player_name": name, "answers": answers, "email": email},
    )
    assert r.status_code == 200
    return r.json()["player_id"]


def _set_filter(client: TestClient, auth_headers: dict, rid: str, conditions: list[dict]) -> None:
    r = client.patch(
        f"/api/registrations/{rid}",
        json={"participant_filter": conditions},
        headers=auth_headers,
    )
    assert r.status_code == 200


def _eligible_names(client: TestClient, auth_headers: dict, rid: str) -> set[str]:
    r = client.get(f"/api/registrations/{rid}", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    eligible = set(data["eligible_player_ids"])
    return {p["player_name"] for p in data["registrants"] if p["player_id"] in eligible}


class TestParticipantFilterEvaluation:
    def _lobby_with_players(self, client: TestClient, auth_headers: dict) -> str:
        rid = _create_lobby(client, auth_headers)
        _register(
            client,
            rid,
            "Ana",
            {"level": "A", "days": json.dumps(["Mon", "Tue"]), "rating": "4.5", "notes": "Left-handed"},
        )
        _register(
            client, rid, "Bea", {"level": "B", "days": json.dumps(["Wed"]), "rating": "3", "notes": "prefers mornings"}
        )
        _register(client, rid, "Cruz", {"level": "C", "rating": "not-a-number"})
        _register(client, rid, "Dani", {})
        return rid

    def test_no_filter_everyone_eligible(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        r = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        data = r.json()
        assert data["participant_filter"] == []
        assert len(data["eligible_player_ids"]) == 4

    def test_choice_any_of(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        _set_filter(client, auth_headers, rid, [{"key": "level", "op": "any_of", "values": ["A", "B"]}])
        assert _eligible_names(client, auth_headers, rid) == {"Ana", "Bea"}

    def test_multichoice_any_of_intersects(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        _set_filter(client, auth_headers, rid, [{"key": "days", "op": "any_of", "values": ["Tue", "Wed"]}])
        assert _eligible_names(client, auth_headers, rid) == {"Ana", "Bea"}

    def test_number_range(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        _set_filter(client, auth_headers, rid, [{"key": "rating", "op": "range", "min_value": 4}])
        assert _eligible_names(client, auth_headers, rid) == {"Ana"}
        _set_filter(client, auth_headers, rid, [{"key": "rating", "op": "range", "max_value": 4}])
        # Cruz's non-numeric answer and Dani's missing answer both fail
        assert _eligible_names(client, auth_headers, rid) == {"Bea"}
        _set_filter(client, auth_headers, rid, [{"key": "rating", "op": "range", "min_value": 1, "max_value": 5}])
        assert _eligible_names(client, auth_headers, rid) == {"Ana", "Bea"}

    def test_text_contains_case_insensitive(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        _set_filter(client, auth_headers, rid, [{"key": "notes", "op": "contains", "text": "LEFT"}])
        assert _eligible_names(client, auth_headers, rid) == {"Ana"}

    def test_answered(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        _set_filter(client, auth_headers, rid, [{"key": "notes", "op": "answered"}])
        assert _eligible_names(client, auth_headers, rid) == {"Ana", "Bea"}

    def test_conditions_are_anded(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        _set_filter(
            client,
            auth_headers,
            rid,
            [
                {"key": "level", "op": "any_of", "values": ["A", "B"]},
                {"key": "days", "op": "any_of", "values": ["Mon"]},
            ],
        )
        assert _eligible_names(client, auth_headers, rid) == {"Ana"}

    def test_clear_filter(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        _set_filter(client, auth_headers, rid, [{"key": "level", "op": "any_of", "values": ["A"]}])
        r = client.patch(
            f"/api/registrations/{rid}",
            json={"clear_participant_filter": True},
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert data["participant_filter"] == []
        assert len(data["eligible_player_ids"]) == 4

    def test_invalid_op_rejected(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        r = client.patch(
            f"/api/registrations/{rid}",
            json={"participant_filter": [{"key": "level", "op": "not_an_op"}]},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_filter_survives_and_returns_on_get(self, client: TestClient, auth_headers: dict) -> None:
        rid = self._lobby_with_players(client, auth_headers)
        conditions = [{"key": "rating", "op": "range", "min_value": 2.5, "max_value": 4.5}]
        _set_filter(client, auth_headers, rid, conditions)
        data = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert len(data["participant_filter"]) == 1
        cond = data["participant_filter"][0]
        assert cond["key"] == "rating"
        assert cond["op"] == "range"
        assert cond["min_value"] == 2.5
        assert cond["max_value"] == 4.5


class TestSendMessageEligibleOnly:
    def _setup(self, client: TestClient, auth_headers: dict) -> str:
        rid = _create_lobby(client, auth_headers, message="See you Saturday.")
        _register(client, rid, "Ana", {"level": "A"}, email="ana@test.com")
        _register(client, rid, "Bea", {"level": "B"}, email="bea@test.com")
        _register(client, rid, "Cruz", {"level": "A"})  # eligible but no email
        _set_filter(client, auth_headers, rid, [{"key": "level", "op": "any_of", "values": ["A"]}])
        return rid

    @patch("backend.api.routes_registration.send_email", new_callable=AsyncMock, return_value=True)
    def test_eligible_only_restricts_recipients(
        self, mock_send: AsyncMock, client: TestClient, auth_headers: dict
    ) -> None:
        rid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(
                f"/api/registrations/{rid}/send-message-emails",
                json={"eligible_only": True},
                headers=auth_headers,
            )
        assert r.status_code == 200
        data = r.json()
        assert data["sent"] == 1  # only Ana: eligible and has an email
        assert data["skipped"] == 1  # Cruz: eligible, no email
        assert mock_send.call_count == 1
        assert mock_send.call_args[0][0] == "ana@test.com"

    @patch("backend.api.routes_registration.send_email", new_callable=AsyncMock, return_value=True)
    def test_default_still_sends_to_all(self, mock_send: AsyncMock, client: TestClient, auth_headers: dict) -> None:
        rid = self._setup(client, auth_headers)
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(f"/api/registrations/{rid}/send-message-emails", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["sent"] == 2
        assert mock_send.call_count == 2

    @patch("backend.api.routes_registration.send_email", new_callable=AsyncMock, return_value=True)
    def test_eligible_only_without_filter_sends_to_all(
        self, mock_send: AsyncMock, client: TestClient, auth_headers: dict
    ) -> None:
        rid = _create_lobby(client, auth_headers, message="Hello.")
        _register(client, rid, "Ana", {}, email="ana@test.com")
        _register(client, rid, "Bea", {}, email="bea@test.com")
        with patch("backend.api.routes_registration.email_is_configured", return_value=True):
            r = client.post(
                f"/api/registrations/{rid}/send-message-emails",
                json={"eligible_only": True},
                headers=auth_headers,
            )
        assert r.status_code == 200
        assert r.json()["sent"] == 2
