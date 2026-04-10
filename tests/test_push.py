"""Tests for Web Push notification support: VAPID keys, subscription CRUD, push event helpers."""

from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.api.push import (
    _clear_push_state,
    get_subscriptions_for_players,
    get_subscriptions_for_tournament,
    get_vapid_public_key,
    init_push,
    is_push_available,
    remove_subscription,
    save_subscription,
)
from backend.api.push_events import (
    _match_player_ids,
    _opponent_player_ids,
    _tv_url,
)
from backend.models import Match, Player

# ── Tournament bodies ─────────────────────────────────────────────────────────

_MEX_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana"],
    "num_courts": 1,
    "num_rounds": 2,
    "score_mode": "points",
}

_GP_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"],
    "num_groups": 2,
    "top_per_group": 2,
    "num_courts": 2,
    "score_mode": "points",
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _create_mex(client: TestClient, auth_headers: dict) -> str:
    r = client.post("/api/tournaments/mexicano", json=_MEX_BODY, headers=auth_headers)
    assert r.status_code == 200
    return r.json()["id"]


def _create_gp(client: TestClient, auth_headers: dict) -> str:
    r = client.post("/api/tournaments/group-playoff", json=_GP_BODY, headers=auth_headers)
    assert r.status_code == 200
    return r.json()["id"]


def _get_secrets(client: TestClient, tid: str, auth_headers: dict) -> dict:
    r = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers)
    assert r.status_code == 200
    return r.json()["players"]


def _player_headers(client: TestClient, tid: str, passphrase: str) -> dict[str, str]:
    r = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": passphrase})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# ═══════════════════════════════════════════════════════════════════════════════
# VAPID key management
# ═══════════════════════════════════════════════════════════════════════════════


class TestVapidKeyInit:
    """VAPID key generation and persistence."""

    def test_init_push_generates_keys(self):
        _clear_push_state()
        assert not is_push_available()
        assert get_vapid_public_key() is None

        init_push()

        assert is_push_available()
        key = get_vapid_public_key()
        assert key is not None
        assert len(key) > 40  # URL-safe base64 of 65 bytes

    def test_init_push_is_idempotent(self):
        _clear_push_state()
        init_push()
        key1 = get_vapid_public_key()

        # Second init should reuse the same key from DB.
        _clear_push_state()
        init_push()
        key2 = get_vapid_public_key()

        assert key1 == key2

    def test_init_push_env_override(self, monkeypatch):
        _clear_push_state()
        monkeypatch.setenv("AMISTOSO_VAPID_PRIVATE_KEY", "fake-pem")
        monkeypatch.setenv("AMISTOSO_VAPID_PUBLIC_KEY", "fake-b64")
        init_push()

        assert get_vapid_public_key() == "fake-b64"
        assert is_push_available()

        _clear_push_state()


# ═══════════════════════════════════════════════════════════════════════════════
# Push subscription storage
# ═══════════════════════════════════════════════════════════════════════════════


class TestSubscriptionStorage:
    """Direct push subscription CRUD (bypassing API routes)."""

    def test_save_and_get_subscription(self):
        sub = {"endpoint": "https://push.example/1", "keys": {"p256dh": "aaa", "auth": "bbb"}}
        save_subscription("t1", "p1", sub)

        subs = get_subscriptions_for_tournament("t1")
        assert len(subs) == 1
        assert subs[0][0] == "p1"
        assert subs[0][1]["endpoint"] == "https://push.example/1"

    def test_get_subscriptions_for_players(self):
        save_subscription("t1", "p1", {"endpoint": "e1", "keys": {}})
        save_subscription("t1", "p2", {"endpoint": "e2", "keys": {}})
        save_subscription("t1", "p3", {"endpoint": "e3", "keys": {}})

        result = get_subscriptions_for_players("t1", {"p1", "p3"})
        pids = {r[0] for r in result}
        assert pids == {"p1", "p3"}

    def test_remove_subscription(self):
        save_subscription("t1", "p1", {"endpoint": "e1", "keys": {}})
        assert len(get_subscriptions_for_tournament("t1")) == 1

        remove_subscription("t1", "p1")
        assert len(get_subscriptions_for_tournament("t1")) == 0

    def test_replace_subscription(self):
        save_subscription("t1", "p1", {"endpoint": "e1", "keys": {}})
        save_subscription("t1", "p1", {"endpoint": "e2", "keys": {}})

        subs = get_subscriptions_for_tournament("t1")
        assert len(subs) == 1
        assert subs[0][1]["endpoint"] == "e2"

    def test_empty_player_ids_returns_empty(self):
        assert get_subscriptions_for_players("t1", set()) == []


# ═══════════════════════════════════════════════════════════════════════════════
# Push event helpers (unit tests)
# ═══════════════════════════════════════════════════════════════════════════════


class TestPushEventHelpers:
    """Unit tests for push_events helper functions."""

    def test_match_player_ids(self):
        m = Match(
            team1=[Player(name="Alice"), Player(name="Bob")],
            team2=[Player(name="Charlie"), Player(name="Diana")],
        )
        ids = _match_player_ids(m)
        assert len(ids) == 4
        # All players should have non-empty IDs
        assert all(isinstance(pid, str) and len(pid) > 0 for pid in ids)

    def test_opponent_player_ids(self):
        p1, p2, p3, p4 = Player(name="A"), Player(name="B"), Player(name="C"), Player(name="D")
        m = Match(team1=[p1, p2], team2=[p3, p4])

        # If submitter is on team1, opponents should be team2
        opps = _opponent_player_ids(m, p1.id)
        assert opps == {p3.id, p4.id}

        # If submitter is on team2, opponents should be team1
        opps2 = _opponent_player_ids(m, p3.id)
        assert opps2 == {p1.id, p2.id}

    def test_tv_url_with_alias(self):
        assert _tv_url("t123", "my-tourney") == "/t/my-tourney"

    def test_tv_url_without_alias(self):
        assert _tv_url("t123", None) == "/t/t123"


# ═══════════════════════════════════════════════════════════════════════════════
# API routes
# ═══════════════════════════════════════════════════════════════════════════════


class TestVapidKeyRoute:
    """GET /{tid}/push/vapid-key"""

    def test_vapid_key_unavailable_when_not_initialised(self, client):
        _clear_push_state()
        r = client.get("/api/tournaments/t123/push/vapid-key")
        assert r.status_code == 503

    def test_vapid_key_returned_when_initialised(self, client):
        _clear_push_state()
        init_push()
        r = client.get("/api/tournaments/t123/push/vapid-key")
        assert r.status_code == 200
        data = r.json()
        assert "public_key" in data
        assert len(data["public_key"]) > 40


class TestSubscribeRoute:
    """POST /{tid}/push/subscribe"""

    def test_subscribe_requires_player_auth(self, client, auth_headers):
        _clear_push_state()
        init_push()
        tid = _create_mex(client, auth_headers)

        # No auth → 401 or 403
        r = client.post(
            f"/api/tournaments/{tid}/push/subscribe",
            json={
                "endpoint": "https://push.example/1",
                "keys": {"p256dh": "aaa", "auth": "bbb"},
            },
        )
        assert r.status_code in (401, 403, 422)

    def test_subscribe_and_unsubscribe(self, client, auth_headers):
        _clear_push_state()
        init_push()
        tid = _create_mex(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid, sec = next(iter(secrets.items()))
        ph = _player_headers(client, tid, sec["passphrase"])

        # Subscribe
        r = client.post(
            f"/api/tournaments/{tid}/push/subscribe",
            json={
                "endpoint": "https://push.example/1",
                "keys": {"p256dh": "test-p256dh", "auth": "test-auth"},
            },
            headers=ph,
        )
        assert r.status_code == 200
        assert r.json()["ok"]

        # Verify stored
        subs = get_subscriptions_for_tournament(tid)
        assert len(subs) == 1
        assert subs[0][0] == pid

        # Unsubscribe
        r = client.post(f"/api/tournaments/{tid}/push/unsubscribe", headers=ph)
        assert r.status_code == 200

        # Verify removed
        subs = get_subscriptions_for_tournament(tid)
        assert len(subs) == 0

    def test_subscribe_wrong_tournament(self, client, auth_headers):
        _clear_push_state()
        init_push()
        tid = _create_mex(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        _pid, sec = next(iter(secrets.items()))
        ph = _player_headers(client, tid, sec["passphrase"])

        # Try subscribing to a different tournament
        r = client.post(
            "/api/tournaments/wrong-tid/push/subscribe",
            json={
                "endpoint": "https://push.example/1",
                "keys": {"p256dh": "aaa", "auth": "bbb"},
            },
            headers=ph,
        )
        assert r.status_code == 403


class TestPushNotificationsOnMutations:
    """Verify that push notification events fire during tournament mutations.

    These tests mock the ``send_push_to_players`` and ``send_push_to_tournament``
    functions to verify they are called with the correct arguments at the right
    mutation points, without actually sending any pushes.
    """

    def test_mex_next_round_triggers_matches_ready(self, client, auth_headers):
        _clear_push_state()
        init_push()
        tid = _create_mex(client, auth_headers)

        # Record scores for the first round
        r = client.get(f"/api/tournaments/{tid}/mex/matches")
        assert r.status_code == 200
        for m in r.json()["pending"]:
            client.post(
                f"/api/tournaments/{tid}/mex/record",
                json={
                    "match_id": m["id"],
                    "score1": 10,
                    "score2": 5,
                },
                headers=auth_headers,
            )

        # Generate next round — should trigger matches_ready
        with patch("backend.api.push_events.send_push_to_players") as mock_push:
            r = client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
            assert r.status_code == 200
            mock_push.assert_called_once()
            call_kwargs = mock_push.call_args
            assert call_kwargs[1]["tournament_id"] == tid or call_kwargs[0][0] == tid

    def test_gp_start_playoffs_triggers_matches_ready(self, client, auth_headers):
        _clear_push_state()
        init_push()
        tid = _create_gp(client, auth_headers)

        # Record all group-stage scores
        r = client.get(f"/api/tournaments/{tid}/gp/groups")
        assert r.status_code == 200
        data = r.json()
        for group_name, matches in data["matches"].items():
            for m in matches:
                client.post(
                    f"/api/tournaments/{tid}/gp/record-group",
                    json={
                        "match_id": m["id"],
                        "score1": 10,
                        "score2": 5,
                    },
                    headers=auth_headers,
                )

        with patch("backend.api.push_events.send_push_to_players") as mock_push:
            r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", headers=auth_headers)
            assert r.status_code == 200
            mock_push.assert_called_once()

    def test_champion_notification_on_final_score(self, client, auth_headers):
        """Recording the final playoff match should trigger champion notification."""
        _clear_push_state()
        init_push()

        # Create a small 2-player playoff
        r = client.post(
            "/api/tournaments/playoff",
            json={
                "participant_names": ["Alice", "Bob"],
                "assign_courts": False,
                "score_mode": "points",
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["id"]

        # Get the single match
        r = client.get(f"/api/tournaments/{tid}/po/playoffs")
        assert r.status_code == 200
        pending = r.json()["pending"]
        assert len(pending) == 1

        # Record the final score
        with patch("backend.api.push_events.send_push_to_tournament") as mock_push:
            r = client.post(
                f"/api/tournaments/{tid}/po/record",
                json={
                    "match_id": pending[0]["id"],
                    "score1": 10,
                    "score2": 5,
                },
                headers=auth_headers,
            )
            assert r.status_code == 200
            mock_push.assert_called_once()
            # Verify champion notification content
            call_kwargs = mock_push.call_args
            args = call_kwargs[1] if call_kwargs[1] else {}
            if "title" in args:
                assert "🏆" in args["title"]
