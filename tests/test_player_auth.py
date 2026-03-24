"""Tests for player self-scoring: secrets generation, auth endpoints, and score permissions."""

from __future__ import annotations

import io

import pytest
from PIL import Image
from pyzbar.pyzbar import decode as decode_qr

from backend.tournaments.player_secrets import (
    PlayerSecret,
    generate_passphrase,
    generate_secrets_for_players,
    generate_token,
)


# ────────────────────────────────────────────────────────────────────────────
# Unit tests — player_secrets module
# ────────────────────────────────────────────────────────────────────────────


class TestGeneratePassphrase:
    def test_format_hyphenated_words(self):
        pp = generate_passphrase()
        parts = pp.split("-")
        # coolname.generate(3) picks 3 word-slots; some may expand to
        # multi-word slugs (e.g. "from-mars"), so we get >= 3 parts.
        assert len(parts) >= 3
        assert all(part.isalpha() for part in parts)

    def test_returns_lowercase(self):
        for _ in range(5):
            pp = generate_passphrase()
            assert pp == pp.lower()

    def test_different_each_call(self):
        passphrases = {generate_passphrase() for _ in range(20)}
        # With ~10^5 combos, 20 calls should all be unique
        assert len(passphrases) == 20


class TestGenerateToken:
    def test_returns_non_empty_string(self):
        tok = generate_token()
        assert isinstance(tok, str)
        assert len(tok) > 20

    def test_url_safe_characters(self):
        tok = generate_token()
        # secrets.token_urlsafe only produces [A-Za-z0-9_-]
        assert all(c.isalnum() or c in "_-" for c in tok)

    def test_unique(self):
        tokens = {generate_token() for _ in range(20)}
        assert len(tokens) == 20


class TestGenerateSecretsForPlayers:
    def test_returns_one_per_player(self):
        pids = ["aaa", "bbb", "ccc"]
        secrets = generate_secrets_for_players(pids)
        assert set(secrets.keys()) == set(pids)

    def test_all_passphrases_unique(self):
        pids = [f"p{i}" for i in range(15)]
        secrets = generate_secrets_for_players(pids)
        passphrases = [s.passphrase for s in secrets.values()]
        assert len(set(passphrases)) == len(passphrases)

    def test_all_tokens_unique(self):
        pids = [f"p{i}" for i in range(15)]
        secrets = generate_secrets_for_players(pids)
        tokens = [s.token for s in secrets.values()]
        assert len(set(tokens)) == len(tokens)

    def test_returns_player_secret_instances(self):
        secrets = generate_secrets_for_players(["x"])
        assert isinstance(secrets["x"], PlayerSecret)

    def test_empty_list(self):
        assert generate_secrets_for_players([]) == {}


class TestPlayerSecretModel:
    def test_frozen(self):
        sec = PlayerSecret(passphrase="a-b-c", token="tok")
        with pytest.raises(Exception):
            sec.passphrase = "new"  # type: ignore[misc]


# ────────────────────────────────────────────────────────────────────────────
# API tests — player auth endpoint
# ────────────────────────────────────────────────────────────────────────────

GP_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"],
    "num_groups": 2,
    "top_per_group": 2,
    "num_courts": 2,
    "score_mode": "points",
}

MEX_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana"],
    "num_courts": 1,
    "num_rounds": 2,
    "score_mode": "points",
}


def _create_gp(client, auth_headers) -> str:
    """Create a GP tournament and return its ID."""
    r = client.post("/api/tournaments/group-playoff", json=GP_BODY, headers=auth_headers)
    assert r.status_code == 200
    return r.json()["id"]


def _create_mex(client, auth_headers) -> str:
    """Create a Mexicano tournament and return its ID."""
    r = client.post("/api/tournaments/mexicano", json=MEX_BODY, headers=auth_headers)
    assert r.status_code == 200
    return r.json()["id"]


def _get_secrets(client, tid, auth_headers) -> dict:
    """Fetch player secrets dict (keyed by player_id)."""
    r = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers)
    assert r.status_code == 200
    return r.json()["players"]


def _player_auth_passphrase(client, tid, passphrase) -> dict:
    """Authenticate a player by passphrase, return full response dict."""
    return client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": passphrase})


def _player_auth_token(client, tid, token) -> dict:
    """Authenticate a player by token, return full response."""
    return client.post(f"/api/tournaments/{tid}/player-auth", json={"token": token})


def _player_headers(client, tid, passphrase) -> dict[str, str]:
    """Get Authorization headers for a player."""
    r = _player_auth_passphrase(client, tid, passphrase)
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class TestPlayerAuthEndpoint:
    """POST /{tid}/player-auth"""

    def test_auth_with_valid_passphrase(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid, sec = next(iter(secrets.items()))

        r = _player_auth_passphrase(client, tid, sec["passphrase"])
        assert r.status_code == 200
        data = r.json()
        assert data["player_id"] == pid
        assert data["player_name"] == sec["name"]
        assert data["tournament_id"] == tid
        assert "access_token" in data

    def test_auth_with_valid_token(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid, sec = next(iter(secrets.items()))

        r = _player_auth_token(client, tid, sec["token"])
        assert r.status_code == 200
        data = r.json()
        assert data["player_id"] == pid
        assert data["tournament_id"] == tid

    def test_auth_invalid_passphrase_returns_401(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        r = _player_auth_passphrase(client, tid, "wrong-pass-phrase")
        assert r.status_code == 401

    def test_auth_invalid_token_returns_401(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        r = _player_auth_token(client, tid, "not-a-real-token")
        assert r.status_code == 401

    def test_auth_both_passphrase_and_token_returns_400(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        sec = next(iter(secrets.values()))

        r = client.post(
            f"/api/tournaments/{tid}/player-auth",
            json={"passphrase": sec["passphrase"], "token": sec["token"]},
        )
        assert r.status_code == 400

    def test_auth_neither_passphrase_nor_token_returns_400(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        r = client.post(f"/api/tournaments/{tid}/player-auth", json={})
        assert r.status_code == 400

    def test_auth_nonexistent_tournament_returns_404(self, client):
        r = _player_auth_passphrase(client, "no-such-tid", "any-phrase")
        assert r.status_code == 404

    def test_auth_token_wrong_tournament_returns_401(self, client, auth_headers):
        """Token belongs to tournament A, but we try it against tournament B."""
        tid_a = _create_gp(client, auth_headers)
        tid_b = _create_gp(client, auth_headers)
        secrets_a = _get_secrets(client, tid_a, auth_headers)
        sec = next(iter(secrets_a.values()))

        r = _player_auth_token(client, tid_b, sec["token"])
        assert r.status_code == 401

    def test_rate_limit_after_too_many_failures(self, client, auth_headers):
        """After 10 failures the endpoint returns 429."""
        import backend.api.routes_player_auth as rpa

        rpa._fail_log.clear()

        tid = _create_gp(client, auth_headers)
        for _ in range(10):
            r = _player_auth_passphrase(client, tid, "wrong-wrong-wrong")
            assert r.status_code == 401

        r = _player_auth_passphrase(client, tid, "wrong-wrong-wrong")
        assert r.status_code == 429

        # Clean up so other tests aren't affected
        rpa._fail_log.clear()


# ────────────────────────────────────────────────────────────────────────────
# API tests — secrets management endpoints (owner/admin only)
# ────────────────────────────────────────────────────────────────────────────


class TestPlayerSecretsEndpoints:
    def test_get_secrets_as_owner(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["tournament_id"] == tid
        assert len(data["players"]) == 8  # 8 players in GP_BODY
        first = next(iter(data["players"].values()))
        assert "passphrase" in first
        assert "token" in first
        assert "name" in first

    def test_get_secrets_non_owner_returns_403(self, client, auth_headers, bob_headers):
        tid = _create_gp(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/player-secrets", headers=bob_headers)
        assert r.status_code == 403

    def test_get_secrets_unauthenticated_returns_401(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/player-secrets")
        assert r.status_code == 401

    def test_regenerate_secret(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid, old = next(iter(secrets.items()))

        r = client.post(
            f"/api/tournaments/{tid}/player-secrets/regenerate/{pid}",
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["player_id"] == pid
        assert data["passphrase"] != old["passphrase"]
        assert data["token"] != old["token"]

    def test_regenerate_invalidates_old_passphrase(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid, sec = next(iter(secrets.items()))
        old_pp = sec["passphrase"]

        client.post(
            f"/api/tournaments/{tid}/player-secrets/regenerate/{pid}",
            headers=auth_headers,
        )
        # Old passphrase should no longer work
        r = _player_auth_passphrase(client, tid, old_pp)
        assert r.status_code == 401

    def test_regenerate_new_passphrase_works(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid = next(iter(secrets.keys()))

        r = client.post(
            f"/api/tournaments/{tid}/player-secrets/regenerate/{pid}",
            headers=auth_headers,
        )
        new_pp = r.json()["passphrase"]
        r2 = _player_auth_passphrase(client, tid, new_pp)
        assert r2.status_code == 200
        assert r2.json()["player_id"] == pid

    def test_regenerate_nonexistent_player_returns_404(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/player-secrets/regenerate/no-such-id",
            headers=auth_headers,
        )
        assert r.status_code == 404

    def test_regenerate_non_owner_returns_403(self, client, auth_headers, bob_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid = next(iter(secrets.keys()))

        r = client.post(
            f"/api/tournaments/{tid}/player-secrets/regenerate/{pid}",
            headers=bob_headers,
        )
        assert r.status_code == 403

    def test_qr_code_returns_png(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid = next(iter(secrets.keys()))

        r = client.get(
            f"/api/tournaments/{tid}/player-secrets/qr/{pid}",
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.headers["content-type"] == "image/png"
        # PNG signature: first 8 bytes
        assert r.content[:4] == b"\x89PNG"

    def test_qr_code_encodes_tv_url(self, client, auth_headers):
        """QR must encode /tv path, not /public.html."""
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        pid = next(iter(secrets.keys()))
        token = secrets[pid]["token"]

        origin = "https://example.com"
        r = client.get(
            f"/api/tournaments/{tid}/player-secrets/qr/{pid}?origin={origin}",
            headers=auth_headers,
        )
        assert r.status_code == 200

        # Decode the QR to verify the encoded URL
        img = Image.open(io.BytesIO(r.content))
        decoded = decode_qr(img)
        assert len(decoded) == 1
        qr_url = decoded[0].data.decode()
        assert "/tv?" in qr_url, f"QR should use /tv path, got: {qr_url}"
        assert "public.html" not in qr_url, f"QR should not use public.html, got: {qr_url}"
        assert f"player_token={token}" in qr_url

    def test_qr_code_nonexistent_player_returns_404(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        r = client.get(
            f"/api/tournaments/{tid}/player-secrets/qr/no-such-id",
            headers=auth_headers,
        )
        assert r.status_code == 404


# ────────────────────────────────────────────────────────────────────────────
# Integration tests — player score submission
# ────────────────────────────────────────────────────────────────────────────


def _find_match_containing_player(matches_by_group: dict, player_id: str) -> tuple[str, dict]:
    """Return (match_id, match_dict) for the first match containing player_id."""
    for _group, matches in matches_by_group.items():
        for m in matches:
            if player_id in m.get("team1_ids", []) or player_id in m.get("team2_ids", []):
                return m["id"], m
    msg = f"No match found for player {player_id}"
    raise AssertionError(msg)


def _find_match_not_containing_player(matches_by_group: dict, player_id: str) -> str:
    """Return match_id for a match that does NOT contain the player."""
    for _group, matches in matches_by_group.items():
        for m in matches:
            if player_id not in m.get("team1_ids", []) and player_id not in m.get("team2_ids", []):
                return m["id"]
    msg = f"All matches contain player {player_id}"
    raise AssertionError(msg)


class TestPlayerScoreSubmission:
    """Integration: player authenticates and submits scores."""

    def _setup_gp(self, client, auth_headers):
        """Create a GP tournament and return (tid, secrets_dict, groups_data)."""
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        return tid, secrets, groups

    def test_player_scores_own_match(self, client, auth_headers):
        tid, secrets, groups = self._setup_gp(client, auth_headers)

        pid, sec = next(iter(secrets.items()))
        match_id, _match = _find_match_containing_player(groups["matches"], pid)
        headers = _player_headers(client, tid, sec["passphrase"])

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
            headers=headers,
        )
        assert r.status_code == 200

    def test_player_cannot_score_others_match(self, client, auth_headers):
        tid, secrets, groups = self._setup_gp(client, auth_headers)

        pid, sec = next(iter(secrets.items()))
        other_match_id = _find_match_not_containing_player(groups["matches"], pid)
        headers = _player_headers(client, tid, sec["passphrase"])

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": other_match_id, "score1": 6, "score2": 3},
            headers=headers,
        )
        assert r.status_code == 403

    def test_unauthenticated_cannot_score(self, client, auth_headers):
        tid, secrets, groups = self._setup_gp(client, auth_headers)
        pid = next(iter(secrets.keys()))
        match_id, _ = _find_match_containing_player(groups["matches"], pid)

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
        )
        assert r.status_code == 403

    def test_admin_can_still_score(self, client, auth_headers):
        tid, secrets, groups = self._setup_gp(client, auth_headers)
        pid = next(iter(secrets.keys()))
        match_id, _ = _find_match_containing_player(groups["matches"], pid)

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_owner_can_score(self, client, alice_headers):
        """Alice (regular user, owner) can score matches she created."""
        tid = _create_gp(client, alice_headers)
        secrets = _get_secrets(client, tid, alice_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=alice_headers).json()
        pid = next(iter(secrets.keys()))
        match_id, _ = _find_match_containing_player(groups["matches"], pid)

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
            headers=alice_headers,
        )
        assert r.status_code == 200

    def test_non_owner_non_player_cannot_score(self, client, alice_headers, bob_headers):
        """Bob is neither admin, owner, nor player — should get 403."""
        tid = _create_gp(client, alice_headers)
        secrets = _get_secrets(client, tid, alice_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=alice_headers).json()
        pid = next(iter(secrets.keys()))
        match_id, _ = _find_match_containing_player(groups["matches"], pid)

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
            headers=bob_headers,
        )
        assert r.status_code == 403

    def test_player_jwt_from_different_tournament_rejected(self, client, auth_headers):
        """Player JWT for tournament A should not work for tournament B."""
        tid_a = _create_gp(client, auth_headers)
        tid_b = _create_gp(client, auth_headers)

        secrets_a = _get_secrets(client, tid_a, auth_headers)
        pid_a, sec_a = next(iter(secrets_a.items()))
        headers_a = _player_headers(client, tid_a, sec_a["passphrase"])

        groups_b = client.get(f"/api/tournaments/{tid_b}/gp/groups", headers=auth_headers).json()
        some_match = next(iter(next(iter(groups_b["matches"].values()))))
        match_id_b = some_match["id"]

        r = client.post(
            f"/api/tournaments/{tid_b}/gp/record-group",
            json={"match_id": match_id_b, "score1": 6, "score2": 3},
            headers=headers_a,
        )
        assert r.status_code == 403


class TestPlayerScoreMexicano:
    """Player scoring for mexicano tournaments."""

    def test_player_scores_mexicano_match(self, client, auth_headers):
        tid = _create_mex(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)

        # Get current round matches via the matches endpoint
        r = client.get(f"/api/tournaments/{tid}/mex/matches", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        matches = data.get("current_matches", [])
        assert len(matches) > 0

        # Find a match for the first player and authenticate
        pid, sec = next(iter(secrets.items()))
        match_id = None
        for m in matches:
            if pid in m.get("team1_ids", []) or pid in m.get("team2_ids", []):
                match_id = m["id"]
                break
        assert match_id is not None, f"Player {pid} not found in any match"

        headers = _player_headers(client, tid, sec["passphrase"])
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": match_id, "score1": 20, "score2": 12},
            headers=headers,
        )
        assert r.status_code == 200


class TestAllowPlayerScoringToggle:
    """Verify the allow_player_scoring TV setting blocks player score submission."""

    def _setup_gp(self, client, auth_headers):
        """Create a GP tournament and return (tid, secrets, groups)."""
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        return tid, secrets, groups

    def _disable_player_scoring(self, client, tid, auth_headers):
        """Turn off allow_player_scoring via the TV settings endpoint."""
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"allow_player_scoring": False},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["allow_player_scoring"] is False

    def test_player_blocked_when_scoring_disabled(self, client, auth_headers):
        """Player in the match gets 403 when allow_player_scoring is False."""
        tid, secrets, groups = self._setup_gp(client, auth_headers)
        pid, sec = next(iter(secrets.items()))
        match_id, _ = _find_match_containing_player(groups["matches"], pid)
        headers = _player_headers(client, tid, sec["passphrase"])

        self._disable_player_scoring(client, tid, auth_headers)

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
            headers=headers,
        )
        assert r.status_code == 403

    def test_admin_still_scores_when_player_scoring_disabled(self, client, auth_headers):
        """Admin can always score regardless of the toggle."""
        tid, secrets, groups = self._setup_gp(client, auth_headers)
        pid = next(iter(secrets.keys()))
        match_id, _ = _find_match_containing_player(groups["matches"], pid)

        self._disable_player_scoring(client, tid, auth_headers)

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_owner_still_scores_when_player_scoring_disabled(self, client, alice_headers):
        """Tournament owner can score even when player scoring is off."""
        tid = _create_gp(client, alice_headers)
        secrets = _get_secrets(client, tid, alice_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=alice_headers).json()
        pid = next(iter(secrets.keys()))
        match_id, _ = _find_match_containing_player(groups["matches"], pid)

        self._disable_player_scoring(client, tid, alice_headers)

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
            headers=alice_headers,
        )
        assert r.status_code == 200

    def test_player_allowed_when_scoring_reenabled(self, client, auth_headers):
        """After toggling allow_player_scoring back on, player can score again."""
        tid, secrets, groups = self._setup_gp(client, auth_headers)
        pid, sec = next(iter(secrets.items()))
        match_id, _ = _find_match_containing_player(groups["matches"], pid)
        headers = _player_headers(client, tid, sec["passphrase"])

        # Disable then re-enable
        self._disable_player_scoring(client, tid, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"allow_player_scoring": True},
            headers=auth_headers,
        )
        assert r.status_code == 200

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match_id, "score1": 6, "score2": 3},
            headers=headers,
        )
        assert r.status_code == 200

    def test_default_setting_is_enabled(self, client, auth_headers):
        """Default TV settings have allow_player_scoring=True."""
        tid = _create_gp(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/tv-settings")
        assert r.status_code == 200
        assert r.json()["allow_player_scoring"] is True

    def test_mexicano_player_blocked_when_scoring_disabled(self, client, auth_headers):
        """Player scoring disabled blocks mexicano matches too."""
        tid = _create_mex(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        matches_r = client.get(f"/api/tournaments/{tid}/mex/matches", headers=auth_headers)
        matches = matches_r.json().get("current_matches", [])
        assert len(matches) > 0

        pid, sec = next(iter(secrets.items()))
        match_id = None
        for m in matches:
            if pid in m.get("team1_ids", []) or pid in m.get("team2_ids", []):
                match_id = m["id"]
                break
        assert match_id is not None

        headers = _player_headers(client, tid, sec["passphrase"])
        self._disable_player_scoring(client, tid, auth_headers)

        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": match_id, "score1": 20, "score2": 12},
            headers=headers,
        )
        assert r.status_code == 403


class TestSecretsLifecycle:
    """Secrets are created with tournaments and deleted with them."""

    def test_secrets_created_on_gp_creation(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        assert len(secrets) == 8  # 8 players in GP_BODY

    def test_secrets_created_on_mex_creation(self, client, auth_headers):
        tid = _create_mex(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        assert len(secrets) == 4  # 4 players in MEX_BODY

    def test_secrets_deleted_with_tournament(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        assert len(secrets) == 8

        r = client.delete(f"/api/tournaments/{tid}", headers=auth_headers)
        assert r.status_code == 200

        # Secrets endpoint should now 404 (tournament gone)
        r = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers)
        assert r.status_code == 404

    def test_each_player_has_unique_passphrase(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        passphrases = [s["passphrase"] for s in secrets.values()]
        assert len(set(passphrases)) == len(passphrases)
