"""Tests for score lifecycle endpoints: accept, correct, resolve-dispute, history."""

from __future__ import annotations

from fastapi.testclient import TestClient

from backend.api import state as state_mod
from backend.api.elo_store import get_tournament_elos
from backend.api.helpers import _find_match_full


# ── Tournament bodies ─────────────────────────────────────────────────────────

_GP_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana", "Eve", "Frank", "Grace", "Hank"],
    "num_groups": 2,
    "top_per_group": 2,
    "num_courts": 2,
    "score_mode": "points",
}

_MEX_BODY = {
    "player_names": ["Alice", "Bob", "Charlie", "Diana"],
    "num_courts": 1,
    "num_rounds": 2,
    "score_mode": "points",
}

# ── Shared helpers ────────────────────────────────────────────────────────────


def _create_gp(client: TestClient, auth_headers: dict) -> str:
    """Create a GP tournament and return its ID."""
    r = client.post("/api/tournaments/group-playoff", json=_GP_BODY, headers=auth_headers)
    assert r.status_code == 200
    return r.json()["id"]


def _create_mex(client: TestClient, auth_headers: dict) -> str:
    """Create a Mexicano tournament and return its ID."""
    r = client.post("/api/tournaments/mexicano", json=_MEX_BODY, headers=auth_headers)
    assert r.status_code == 200
    return r.json()["id"]


def _get_secrets(client: TestClient, tid: str, auth_headers: dict) -> dict:
    """Fetch player secrets dict (keyed by player_id)."""
    r = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers)
    assert r.status_code == 200
    return r.json()["players"]


def _player_headers(client: TestClient, tid: str, passphrase: str) -> dict[str, str]:
    """Authenticate a player by passphrase and return Authorization headers."""
    r = client.post(f"/api/tournaments/{tid}/player-auth", json={"passphrase": passphrase})
    assert r.status_code == 200
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _find_match_with_two_players(matches_by_group: dict, secrets: dict) -> tuple[str, str, str]:
    """Return (match_id, pid_team1, pid_team2) from first match with two known players."""
    for _, matches in matches_by_group.items():
        for m in matches:
            t1 = [pid for pid in m.get("team1_ids", []) if pid in secrets]
            t2 = [pid for pid in m.get("team2_ids", []) if pid in secrets]
            if t1 and t2:
                return m["id"], t1[0], t2[0]
    raise AssertionError("No match found with two known players on different teams")


def _setup_gp(client: TestClient, auth_headers: dict, *, required: bool = False) -> tuple[str, dict, dict]:
    """Create GP tournament; return (tid, secrets, groups).

    Pass ``required=True`` to switch the tournament to ``score_confirmation='required'``
    mode so lifecycle tests (accept / correct / dispute) work as expected.
    """
    tid = _create_gp(client, auth_headers)
    if required:
        client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"score_confirmation": "required"},
            headers=auth_headers,
        )
    secrets = _get_secrets(client, tid, auth_headers)
    groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
    return tid, secrets, groups


def _submit_gp_score(
    client: TestClient,
    tid: str,
    passphrase: str,
    match_id: str,
    score1: int = 6,
    score2: int = 3,
) -> dict[str, str]:
    """Submit a GP group-stage score as a player; return the player headers."""
    headers = _player_headers(client, tid, passphrase)
    r = client.post(
        f"/api/tournaments/{tid}/gp/record-group",
        json={"match_id": match_id, "score1": score1, "score2": score2},
        headers=headers,
    )
    assert r.status_code == 200
    return headers


# ── Test: immediate mode ──────────────────────────────────────────────────────


class TestImmediateMode:
    """Immediate-mode score submission behaviour."""

    def test_immediate_mode_submit_keeps_completed_status(self, client: TestClient, auth_headers: dict) -> None:
        """In immediate mode (default), submitting a score marks the match completed
        and score_confirmed=True immediately — no opponent acceptance is required."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        groups2 = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups2["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None
        assert match["status"] == "completed"
        assert match["score_confirmed"] is True
        assert match["scored_by"] == pid1


# ── Test: accept ──────────────────────────────────────────────────────────────


class TestAccept:
    """POST /{tid}/matches/{mid}/accept"""

    def test_opposing_team_can_accept(self, client: TestClient, auth_headers: dict) -> None:
        """Opposing team member can accept a pending score."""
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={}, headers=headers2)

        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_accept_marks_score_confirmed(self, client: TestClient, auth_headers: dict) -> None:
        """After acceptance, match serialization shows score_confirmed=True."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={}, headers=headers2)

        groups2 = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups2["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None, "Match not found after accept"
        assert match.get("score_confirmed") is True

    def test_accept_no_pending_score_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Accepting when no score has been submitted returns 409."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, _pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={}, headers=headers2)

        assert r.status_code == 409

    def test_accept_already_confirmed_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Cannot accept a score that was already confirmed."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={}, headers=headers2)
        # Second accept must fail.
        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={}, headers=headers2)

        assert r.status_code == 409

    def test_accept_disputed_score_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Cannot accept a score that is under dispute."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 3, "score2": 6},
            headers=headers2,
        )

        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={}, headers=headers2)

        assert r.status_code == 409

    def test_accept_unauthenticated_returns_403(self, client: TestClient, auth_headers: dict) -> None:
        """Unauthenticated accept returns 403."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={})

        assert r.status_code == 403

    def test_accept_adds_history_entry(self, client: TestClient, auth_headers: dict) -> None:
        """Accept action appears in match history."""
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={}, headers=headers2)

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history", headers=auth_headers)
        actions = [e["action"] for e in r.json()["history"]]
        assert "accept" in actions


# ── Test: correct ─────────────────────────────────────────────────────────────


class TestCorrect:
    """POST /{tid}/matches/{mid}/correct"""

    def test_opposing_team_can_correct(self, client: TestClient, auth_headers: dict) -> None:
        """Opposing team member can submit a score correction."""
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 3, "score2": 6},
            headers=headers2,
        )

        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_correct_sets_disputed_flag_and_dispute_score(self, client: TestClient, auth_headers: dict) -> None:
        """After correction, match shows disputed=True and the correction score is stored."""
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid, score1=6, score2=3)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 3, "score2": 6},
            headers=headers2,
        )

        groups2 = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups2["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None
        assert match.get("disputed") is True
        assert match.get("dispute_score") == [3, 6]
        assert match.get("score") == [6, 3]  # original score unchanged

    def test_second_correction_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Only one correction per match is allowed; a second attempt returns 409."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 3, "score2": 6},
            headers=headers2,
        )
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 4, "score2": 5},
            headers=headers2,
        )

        assert r.status_code == 409

    def test_correct_no_score_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Correcting a match with no submitted score returns 409."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, _pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 3, "score2": 6},
            headers=headers2,
        )

        assert r.status_code == 409

    def test_correct_confirmed_score_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Correcting a confirmed score returns 409."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", json={}, headers=headers2)
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 3, "score2": 6},
            headers=headers2,
        )

        assert r.status_code == 409

    def test_correct_unauthenticated_returns_403(self, client: TestClient, auth_headers: dict) -> None:
        """Unauthenticated correction request returns 403."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 3, "score2": 6},
        )

        assert r.status_code == 403

    def test_correct_adds_history_entry(self, client: TestClient, auth_headers: dict) -> None:
        """Correct action appears in match history."""
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct",
            json={"match_id": mid, "score1": 3, "score2": 6},
            headers=headers2,
        )

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history", headers=auth_headers)
        actions = [e["action"] for e in r.json()["history"]]
        assert "correct" in actions


# ── Test: resolve-dispute ─────────────────────────────────────────────────────


def _setup_dispute(client: TestClient, auth_headers: dict) -> tuple[str, str, dict, dict]:
    """Create a GP tournament with one disputed match; return (tid, mid, secrets, groups)."""
    tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
    mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
    _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid, score1=6, score2=3)

    headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
    client.post(
        f"/api/tournaments/{tid}/matches/{mid}/correct",
        json={"match_id": mid, "score1": 3, "score2": 6},
        headers=headers2,
    )
    return tid, mid, secrets, groups


class TestResolveDispute:
    """POST /{tid}/matches/{mid}/resolve-dispute"""

    def test_resolve_original_succeeds(self, client: TestClient, auth_headers: dict) -> None:
        """Admin can resolve a dispute by keeping the original score."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)

        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "original"},
            headers=auth_headers,
        )

        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_resolve_original_clears_dispute_and_confirms(self, client: TestClient, auth_headers: dict) -> None:
        """After resolving with original, disputed=False and score_confirmed=True."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "original"},
            headers=auth_headers,
        )

        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None
        assert match.get("disputed") is False
        assert match.get("score_confirmed") is True
        assert match.get("score") == [6, 3]

    def test_resolve_correction_applies_corrected_score(self, client: TestClient, auth_headers: dict) -> None:
        """Resolving with 'correction' applies the opponent's score."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "correction"},
            headers=auth_headers,
        )

        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None
        assert match.get("score") == [3, 6]
        assert match.get("disputed") is False

    def test_resolve_custom_applies_custom_score(self, client: TestClient, auth_headers: dict) -> None:
        """Admin can resolve a dispute with a completely custom score."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "custom", "score1": 7, "score2": 5},
            headers=auth_headers,
        )

        assert r.status_code == 200
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None
        assert match.get("score") == [7, 5]

    def test_resolve_not_under_dispute_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Resolving a match that has no active dispute returns 409."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "original"},
            headers=auth_headers,
        )

        assert r.status_code == 409

    def test_resolve_requires_admin(self, client: TestClient, auth_headers: dict, alice_headers: dict) -> None:
        """Non-admin cannot resolve a dispute."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)

        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "original"},
            headers=alice_headers,
        )

        assert r.status_code in (401, 403)

    def test_resolve_adds_history_entry(self, client: TestClient, auth_headers: dict) -> None:
        """resolve_dispute action appears in match history after resolution."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "original"},
            headers=auth_headers,
        )

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history", headers=auth_headers)
        actions = [e["action"] for e in r.json()["history"]]
        assert "resolve_dispute" in actions


# ── Test: history ─────────────────────────────────────────────────────────────


class TestScoreHistory:
    """GET /{tid}/matches/{mid}/history"""

    def test_history_returns_submit_entry(self, client: TestClient, auth_headers: dict) -> None:
        """History contains at least a 'submit' entry after a player scores."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history", headers=auth_headers)

        assert r.status_code == 200
        data = r.json()
        assert data["match_id"] == mid
        assert len(data["history"]) >= 1
        assert data["history"][0]["action"] == "submit"

    def test_history_empty_before_any_score(self, client: TestClient, auth_headers: dict) -> None:
        """History is empty for a match that has not been scored yet."""
        tid = _create_gp(client, auth_headers)
        secrets = _get_secrets(client, tid, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        mid, _pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history", headers=auth_headers)

        assert r.status_code == 200
        assert r.json()["history"] == []

    def test_history_requires_auth(self, client: TestClient, auth_headers: dict) -> None:
        """Unauthenticated request to history returns 401 or 403."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history")

        assert r.status_code in (401, 403)

    def test_history_nonexistent_match_returns_404(self, client: TestClient, auth_headers: dict) -> None:
        """History for an unknown match_id returns 404."""
        tid = _create_gp(client, auth_headers)

        r = client.get(f"/api/tournaments/{tid}/matches/nonexistent/history", headers=auth_headers)

        assert r.status_code == 404

    def test_history_full_lifecycle_sequence(self, client: TestClient, auth_headers: dict) -> None:
        """History tracks the full submit → correct → resolve_dispute chain."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "original"},
            headers=auth_headers,
        )

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history", headers=auth_headers)
        actions = [e["action"] for e in r.json()["history"]]

        assert "submit" in actions
        assert "correct" in actions
        assert "resolve_dispute" in actions


# ── Test: Mexicano credit reversal on retract ─────────────────────────────────


def _setup_dispute_with_ids(client: TestClient, auth_headers: dict) -> tuple[str, str, str, str, dict, dict]:
    """Create a GP tournament with one disputed match; return (tid, mid, pid1, pid2, secrets, groups)."""
    tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
    mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
    _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid, score1=6, score2=3)

    headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
    client.post(
        f"/api/tournaments/{tid}/matches/{mid}/correct",
        json={"match_id": mid, "score1": 3, "score2": 6},
        headers=headers2,
    )
    return tid, mid, pid1, pid2, secrets, groups


# ── Test: accept-correction ───────────────────────────────────────────────────


class TestAcceptCorrection:
    """POST /{tid}/matches/{mid}/accept-correction"""

    def test_submitter_can_accept_correction(self, client: TestClient, auth_headers: dict) -> None:
        """Original submitter can accept the opposing team's correction."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/accept-correction",
            json={},
            headers=headers1,
        )

        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_accept_correction_applies_correction_score(self, client: TestClient, auth_headers: dict) -> None:
        """After accepting, the match score becomes the correction score and is confirmed."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/accept-correction",
            json={},
            headers=headers1,
        )

        groups2 = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups2["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None
        assert match.get("score") == [3, 6]
        assert match.get("disputed") is False
        assert match.get("score_confirmed") is True
        assert match.get("dispute_escalated") is False

    def test_accept_correction_by_opponent_returns_403(self, client: TestClient, auth_headers: dict) -> None:
        """Opposing team (who submitted the correction) cannot accept their own correction."""
        tid, mid, _pid1, pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/accept-correction",
            json={},
            headers=headers2,
        )

        assert r.status_code == 403

    def test_accept_correction_not_disputed_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Cannot accept correction when match is not disputed."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        headers1 = _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/accept-correction",
            json={},
            headers=headers1,
        )

        assert r.status_code == 409

    def test_accept_correction_already_escalated_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Cannot accept correction once dispute has been escalated to admin."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        # Escalate first
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers1,
        )
        # Now try to accept correction
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/accept-correction",
            json={},
            headers=headers1,
        )

        assert r.status_code == 409

    def test_accept_correction_unauthenticated_returns_403(self, client: TestClient, auth_headers: dict) -> None:
        """Unauthenticated accept-correction returns 403."""
        tid, mid, _pid1, _pid2, _secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/accept-correction", json={})

        assert r.status_code == 403

    def test_accept_correction_adds_history_entry(self, client: TestClient, auth_headers: dict) -> None:
        """accept_correction action appears in match history."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/accept-correction",
            json={},
            headers=headers1,
        )

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history", headers=auth_headers)
        actions = [e["action"] for e in r.json()["history"]]
        assert "accept_correction" in actions


# ── Test: escalate-dispute ────────────────────────────────────────────────────


class TestEscalateDispute:
    """POST /{tid}/matches/{mid}/escalate-dispute"""

    def test_submitter_can_escalate(self, client: TestClient, auth_headers: dict) -> None:
        """Original submitter can escalate a dispute to the admin."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers1,
        )

        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_escalate_sets_dispute_escalated_flag(self, client: TestClient, auth_headers: dict) -> None:
        """After escalation, match shows dispute_escalated=True."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers1,
        )

        groups2 = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups2["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None
        assert match.get("disputed") is True
        assert match.get("dispute_escalated") is True

    def test_escalate_by_opponent_returns_403(self, client: TestClient, auth_headers: dict) -> None:
        """Opposing team (who submitted the correction) cannot escalate."""
        tid, mid, _pid1, pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers2,
        )

        assert r.status_code == 403

    def test_escalate_not_disputed_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Cannot escalate when match is not disputed."""
        tid, secrets, groups = _setup_gp(client, auth_headers)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        headers1 = _submit_gp_score(client, tid, secrets[pid1]["passphrase"], mid)

        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers1,
        )

        assert r.status_code == 409

    def test_escalate_already_escalated_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        """Cannot escalate twice."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers1,
        )
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers1,
        )

        assert r.status_code == 409

    def test_escalate_unauthenticated_returns_403(self, client: TestClient, auth_headers: dict) -> None:
        """Unauthenticated escalation returns 403."""
        tid, mid, _pid1, _pid2, _secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute", json={})

        assert r.status_code == 403

    def test_escalate_adds_history_entry(self, client: TestClient, auth_headers: dict) -> None:
        """escalate action appears in match history."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers1,
        )

        r = client.get(f"/api/tournaments/{tid}/matches/{mid}/history", headers=auth_headers)
        actions = [e["action"] for e in r.json()["history"]]
        assert "escalate" in actions

    def test_admin_can_resolve_after_escalation(self, client: TestClient, auth_headers: dict) -> None:
        """Admin can resolve a dispute that has been escalated by a player."""
        tid, mid, pid1, _pid2, secrets, _groups = _setup_dispute_with_ids(client, auth_headers)

        headers1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/escalate-dispute",
            json={},
            headers=headers1,
        )

        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "correction"},
            headers=auth_headers,
        )

        assert r.status_code == 200
        groups2 = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
        match = next(
            (m for matches in groups2["matches"].values() for m in matches if m["id"] == mid),
            None,
        )
        assert match is not None
        assert match.get("score") == [3, 6]
        assert match.get("disputed") is False
        assert match.get("dispute_escalated") is False


# ── Test: custom set-score dispute resolution (QW3 regression) ───────────────


def _get_gp_match(client: TestClient, tid: str, mid: str, auth_headers: dict) -> dict:
    """Return the serialised GP group match *mid*."""
    groups = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()
    match = next((m for ms in groups["matches"].values() for m in ms if m["id"] == mid), None)
    assert match is not None
    return match


class TestResolveDisputeCustomSets:
    """Custom set scores in resolve-dispute are recorded as set results with the right winner."""

    def test_custom_sets_give_set_winner_the_match(self, client: TestClient, auth_headers: dict) -> None:
        """6-4 / 0-6 / 7-5: team 1 wins on sets although games are 13-15."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "custom", "sets": [[6, 4], [0, 6], [7, 5]]},
            headers=auth_headers,
        )
        assert r.status_code == 200

        match = _get_gp_match(client, tid, mid, auth_headers)
        assert match["sets"] == [[6, 4], [0, 6], [7, 5]]
        assert match["score"][0] > match["score"][1]
        assert match["third_set_loss"] is True
        assert match["disputed"] is False

    def test_custom_sets_ignore_client_game_sums(self, client: TestClient, auth_headers: dict) -> None:
        """Legacy clients that also send raw game sums cannot flip the winner."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "custom", "score1": 13, "score2": 15, "sets": [[6, 4], [0, 6], [7, 5]]},
            headers=auth_headers,
        )
        assert r.status_code == 200
        match = _get_gp_match(client, tid, mid, auth_headers)
        assert match["score"][0] > match["score"][1]

    def test_custom_sets_update_standings_winner(self, client: TestClient, auth_headers: dict) -> None:
        """The set winner is credited with the win in the group standings."""
        tid, mid, _secrets, groups = _setup_dispute(client, auth_headers)
        match_before = _get_gp_match(client, tid, mid, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "custom", "sets": [[6, 4], [0, 6], [7, 5]]},
            headers=auth_headers,
        )
        standings = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()["standings"]
        rows = {row["player_id"]: row for entries in standings.values() for row in entries}
        t1_id = match_before["team1_ids"][0]
        t2_id = match_before["team2_ids"][0]
        assert rows[t1_id]["wins"] == 1
        assert rows[t2_id]["wins"] == 0

    def test_custom_sets_two_set_match_has_no_third_set_flag(self, client: TestClient, auth_headers: dict) -> None:
        """A straight-sets custom score leaves third_set_loss False."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "custom", "sets": [[4, 6], [3, 6]]},
            headers=auth_headers,
        )
        match = _get_gp_match(client, tid, mid, auth_headers)
        assert match["score"][1] > match["score"][0]
        assert match["third_set_loss"] is False

    def test_custom_sets_invalid_returns_422(self, client: TestClient, auth_headers: dict) -> None:
        """Tied sets are rejected by request validation."""
        tid, mid, _secrets, _groups = _setup_dispute(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "custom", "sets": [[6, 4], [4, 6]]},
            headers=auth_headers,
        )
        assert r.status_code == 422


# ── Test: per-match points target on the player / dispute paths ──────────────


def _setup_mex_override(client: TestClient, auth_headers: dict, target: int = 24) -> tuple[str, dict, dict]:
    """Mexicano (4 players, 32 pts) in required mode with one round-1 match set to *target*."""
    r = client.post(
        "/api/tournaments/mexicano",
        json={**_MEX_BODY, "total_points_per_match": 32},
        headers=auth_headers,
    )
    tid = r.json()["id"]
    client.patch(f"/api/tournaments/{tid}/tv-settings", json={"score_confirmation": "required"}, headers=auth_headers)
    client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
    match = client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"][0]
    r = client.patch(
        f"/api/tournaments/{tid}/matches/{match['id']}/format",
        json={"override": {"points_target": target}},
        headers=auth_headers,
    )
    assert r.status_code == 200
    secrets = _get_secrets(client, tid, auth_headers)
    return tid, match, secrets


class TestMexicanoOverrideOnPlayerPaths:
    """Player submissions, corrections and dispute resolution honour the per-match target."""

    def test_player_submit_validated_against_override(self, client: TestClient, auth_headers: dict) -> None:
        tid, m, secrets = _setup_mex_override(client, auth_headers)
        h1 = _player_headers(client, tid, secrets[m["team1_ids"][0]]["passphrase"])
        bad = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=h1,
        )
        assert bad.status_code == 400
        ok = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 15, "score2": 9},
            headers=h1,
        )
        assert ok.status_code == 200

    def test_correct_with_wrong_sum_returns_400(self, client: TestClient, auth_headers: dict) -> None:
        tid, m, secrets = _setup_mex_override(client, auth_headers)
        h1 = _player_headers(client, tid, secrets[m["team1_ids"][0]]["passphrase"])
        h2 = _player_headers(client, tid, secrets[m["team2_ids"][0]]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 15, "score2": 9},
            headers=h1,
        )
        r = client.post(
            f"/api/tournaments/{tid}/matches/{m['id']}/correct",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=h2,
        )
        assert r.status_code == 400
        assert "24" in r.json()["detail"]
        r = client.post(
            f"/api/tournaments/{tid}/matches/{m['id']}/correct",
            json={"match_id": m["id"], "score1": 9, "score2": 15},
            headers=h2,
        )
        assert r.status_code == 200

    def test_resolve_custom_uses_effective_target(self, client: TestClient, auth_headers: dict) -> None:
        tid, m, secrets = _setup_mex_override(client, auth_headers)
        h1 = _player_headers(client, tid, secrets[m["team1_ids"][0]]["passphrase"])
        h2 = _player_headers(client, tid, secrets[m["team2_ids"][0]]["passphrase"])
        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 15, "score2": 9},
            headers=h1,
        )
        client.post(
            f"/api/tournaments/{tid}/matches/{m['id']}/correct",
            json={"match_id": m["id"], "score1": 9, "score2": 15},
            headers=h2,
        )
        url = f"/api/tournaments/{tid}/matches/{m['id']}/resolve-dispute"
        bad = client.post(url, json={"chosen": "custom", "score1": 20, "score2": 12}, headers=auth_headers)
        assert bad.status_code == 400
        ok = client.post(url, json={"chosen": "custom", "score1": 12, "score2": 12}, headers=auth_headers)
        assert ok.status_code == 200
        match = next(
            x for x in client.get(f"/api/tournaments/{tid}/mex/matches").json()["all_matches"] if x["id"] == m["id"]
        )
        assert match["score"] == [12, 12]
        assert match["disputed"] is False


# ── Mexicano play-off disputes ───────────────────────────────────────────────


def _setup_mex_playoff_dispute(client: TestClient, auth_headers: dict) -> tuple[str, dict, dict, dict]:
    """Mexicano (4 players) in required mode with one disputed play-off final.

    Round 1 is recorded by the organiser, the Mexicano is ended, a 2-team
    play-off is started and the final's score is submitted by team 1 and
    corrected by team 2.  Returns (tid, final match, team-1 headers,
    team-2 headers).

    Play-off submissions are confirmed on submit (the bracket advances at
    once), so the stored score is reopened in memory before the correction;
    the correction and every resolution path then run through the real API.
    """
    tid = _create_mex(client, auth_headers)
    client.patch(f"/api/tournaments/{tid}/tv-settings", json={"score_confirmation": "required"}, headers=auth_headers)
    client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
    for m in client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"]:
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )
        assert r.status_code == 200
    assert client.post(f"/api/tournaments/{tid}/mex/end", headers=auth_headers).status_code == 200
    r = client.post(f"/api/tournaments/{tid}/mex/start-playoffs", json={"n_teams": 4}, headers=auth_headers)
    assert r.status_code == 200, r.text
    final = client.get(f"/api/tournaments/{tid}/mex/playoffs").json()["pending"][0]
    secrets = _get_secrets(client, tid, auth_headers)
    h1 = _player_headers(client, tid, secrets[final["team1_ids"][0]]["passphrase"])
    h2 = _player_headers(client, tid, secrets[final["team2_ids"][0]]["passphrase"])
    r = client.post(
        f"/api/tournaments/{tid}/mex/record-playoff",
        json={"match_id": final["id"], "score1": 6, "score2": 3},
        headers=h1,
    )
    assert r.status_code == 200
    _find_match_full(state_mod._tournaments[tid]["tournament"], final["id"]).score_confirmed = False
    r = client.post(
        f"/api/tournaments/{tid}/matches/{final['id']}/correct",
        json={"match_id": final["id"], "score1": 3, "score2": 6},
        headers=h2,
    )
    assert r.status_code == 200, r.text
    return tid, final, h1, h2


def _mex_playoff_match(client: TestClient, tid: str, mid: str) -> dict:
    data = client.get(f"/api/tournaments/{tid}/mex/playoffs").json()
    return next(m for m in data["matches"] if m["id"] == mid)


class TestMexicanoPlayoffDisputes:
    """Dispute actions on a Mexicano play-off match go through the bracket, not the rounds."""

    def test_resolve_original(self, client: TestClient, auth_headers: dict) -> None:
        tid, final, _h1, _h2 = _setup_mex_playoff_dispute(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/matches/{final['id']}/resolve-dispute",
            json={"chosen": "original"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        m = _mex_playoff_match(client, tid, final["id"])
        assert m["score"] == [6, 3]
        assert m["disputed"] is False
        assert m["score_confirmed"] is True
        assert m["status"] == "completed"

    def test_resolve_correction_changes_bracket_winner(self, client: TestClient, auth_headers: dict) -> None:
        tid, final, _h1, _h2 = _setup_mex_playoff_dispute(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/matches/{final['id']}/resolve-dispute",
            json={"chosen": "correction"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        m = _mex_playoff_match(client, tid, final["id"])
        assert m["score"] == [3, 6]
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        assert status["champion"] == final["team2"]

    def test_resolve_custom_sets(self, client: TestClient, auth_headers: dict) -> None:
        tid, final, _h1, _h2 = _setup_mex_playoff_dispute(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/matches/{final['id']}/resolve-dispute",
            json={"chosen": "custom", "sets": [[6, 4], [0, 6], [7, 5]]},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        m = _mex_playoff_match(client, tid, final["id"])
        assert m["sets"] == [[6, 4], [0, 6], [7, 5]]
        assert m["score"][0] > m["score"][1]
        assert m["effective_decider"] == "full_set"

    def test_accept_correction(self, client: TestClient, auth_headers: dict) -> None:
        tid, final, h1, _h2 = _setup_mex_playoff_dispute(client, auth_headers)
        r = client.post(f"/api/tournaments/{tid}/matches/{final['id']}/accept-correction", headers=h1)
        assert r.status_code == 200, r.text
        m = _mex_playoff_match(client, tid, final["id"])
        assert m["score"] == [3, 6]
        assert m["disputed"] is False
        assert m["score_confirmed"] is True

    def test_resolve_recalculates_elo(self, client: TestClient, auth_headers: dict) -> None:
        tid, final, _h1, _h2 = _setup_mex_playoff_dispute(client, auth_headers)
        loser_id = final["team2_ids"][0]
        before = get_tournament_elos(tid, "padel")[loser_id]
        r = client.post(
            f"/api/tournaments/{tid}/matches/{final['id']}/resolve-dispute",
            json={"chosen": "correction"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        after = get_tournament_elos(tid, "padel")[loser_id]
        assert after > before


class TestMatchCommentOnCompletedBracketMatch:
    """``PATCH /match-comment`` finds completed play-off matches (``_find_match_full``)."""

    def test_comment_on_completed_playoff_match(self, client: TestClient, auth_headers: dict) -> None:
        body = {
            "name": "Quick Play-off",
            "participant_names": ["Alice", "Bob", "Carol", "Dave"],
            "court_names": ["Court 1"],
            "double_elimination": False,
        }
        tid = client.post("/api/tournaments/playoff", json=body, headers=auth_headers).json()["id"]
        m = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"][0]
        r = client.post(
            f"/api/tournaments/{tid}/po/record",
            json={"match_id": m["id"], "score1": 6, "score2": 3},
            headers=auth_headers,
        )
        assert r.status_code == 200
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": m["id"], "comment": "Rain delay"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        matches = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["matches"]
        assert next(x for x in matches if x["id"] == m["id"])["comment"] == "Rain delay"


# ── Match tie-break decider on the player path ───────────────────────────────


def _submit_gp_sets(client: TestClient, tid: str, headers: dict, match_id: str, sets: list[list[int]]):
    return client.post(
        f"/api/tournaments/{tid}/gp/record-group-tennis",
        json={"match_id": match_id, "sets": sets},
        headers=headers,
    )


class TestMatchTiebreakDeciderPlayerPath:
    """Player submissions honour the tournament / per-match third-set decider."""

    def test_tournament_default_tiebreak_counts_one_game(self, client: TestClient, auth_headers: dict) -> None:
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"set_decider": "match_tiebreak", "score_mode": {"gp-group": "sets"}},
            headers=auth_headers,
        )
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        h1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        r = _submit_gp_sets(client, tid, h1, mid, [[6, 4], [3, 6], [10, 8]])
        assert r.status_code == 200, r.text
        # 6+3+1 vs 4+6+0, then the set winner is bumped above the loser.
        assert r.json()["score"] == [11, 10]
        h2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        assert client.post(f"/api/tournaments/{tid}/matches/{mid}/accept", headers=h2).status_code == 200

        match = _get_gp_match(client, tid, mid, auth_headers)
        assert match["effective_decider"] == "match_tiebreak"
        assert match["third_set_loss"] is True
        standings = client.get(f"/api/tournaments/{tid}/gp/groups", headers=auth_headers).json()["standings"]
        rows = {row["player_id"]: row for entries in standings.values() for row in entries}
        assert rows[pid1]["points_for"] == 10
        assert rows[pid1]["points_against"] == 10
        assert rows[pid1]["wins"] == 1

    def test_full_set_under_tiebreak_decider_returns_400(self, client: TestClient, auth_headers: dict) -> None:
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"set_decider": "match_tiebreak", "score_mode": {"gp-group": "sets"}},
            headers=auth_headers,
        )
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        h1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        r = _submit_gp_sets(client, tid, h1, mid, [[6, 4], [3, 6], [7, 5]])
        assert r.status_code == 400
        assert "tie-break" in r.json()["detail"]
        # Two-set results are never checked against the decider.
        r = _submit_gp_sets(client, tid, h1, mid, [[6, 4], [6, 3]])
        assert r.status_code == 200

    def test_per_match_override_wins_over_tournament_default(self, client: TestClient, auth_headers: dict) -> None:
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
        r = client.patch(
            f"/api/tournaments/{tid}/matches/{mid}/format",
            json={"override": {"mode": "sets", "decider": "match_tiebreak"}},
            headers=auth_headers,
        )
        assert r.status_code == 200
        h1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        assert _submit_gp_sets(client, tid, h1, mid, [[6, 4], [3, 6], [7, 5]]).status_code == 400
        assert _submit_gp_sets(client, tid, h1, mid, [[6, 4], [3, 6], [10, 8]]).status_code == 200

    def test_correct_tennis_validates_decider(self, client: TestClient, auth_headers: dict) -> None:
        tid, secrets, groups = _setup_gp(client, auth_headers, required=True)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"set_decider": "match_tiebreak", "score_mode": {"gp-group": "sets"}},
            headers=auth_headers,
        )
        mid, pid1, pid2 = _find_match_with_two_players(groups["matches"], secrets)
        h1 = _player_headers(client, tid, secrets[pid1]["passphrase"])
        assert _submit_gp_sets(client, tid, h1, mid, [[6, 4], [3, 6], [10, 8]]).status_code == 200
        h2 = _player_headers(client, tid, secrets[pid2]["passphrase"])
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct-tennis",
            json={"match_id": mid, "sets": [[4, 6], [6, 3], [5, 7]]},
            headers=h2,
        )
        assert r.status_code == 400
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/correct-tennis",
            json={"match_id": mid, "sets": [[4, 6], [6, 3], [8, 10]]},
            headers=h2,
        )
        assert r.status_code == 200
        r = client.post(
            f"/api/tournaments/{tid}/matches/{mid}/resolve-dispute",
            json={"chosen": "correction"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        match = _get_gp_match(client, tid, mid, auth_headers)
        assert match["sets"] == [[4, 6], [6, 3], [8, 10]]
        assert match["score"] == [10, 11]


# ── Test: off-format submissions go to organiser review ──────────────────────


def _gp_player_setup(client: TestClient, auth_headers: dict) -> tuple[str, str, dict]:
    """GP tournament in its default points mode; return (tid, match_id, player headers)."""
    tid, secrets, groups = _setup_gp(client, auth_headers)
    mid, pid1, _pid2 = _find_match_with_two_players(groups["matches"], secrets)
    return tid, mid, _player_headers(client, tid, secrets[pid1]["passphrase"])


def _submit_sets(client: TestClient, tid: str, mid: str, headers: dict) -> dict:
    r = client.post(
        f"/api/tournaments/{tid}/gp/record-group-tennis",
        json={"match_id": mid, "sets": [[6, 3], [6, 4]]},
        headers=headers,
    )
    assert r.status_code == 200
    return r.json()


class TestFormatReview:
    """A player score in a format other than the match's is held for the organiser."""

    def test_off_format_submit_is_parked_not_counted(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        assert _submit_sets(client, tid, mid, headers)["review"] is True

        m = _get_gp_match(client, tid, mid, auth_headers)
        assert m["format_review"] is True
        assert m["review_sets"] == [[6, 3], [6, 4]]
        assert m["score"] is None
        assert m["status"] != "completed"

    def test_matching_format_submit_counts_immediately(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": mid, "score1": 6, "score2": 3},
            headers=headers,
        )
        assert r.status_code == 200
        assert "review" not in r.json()
        m = _get_gp_match(client, tid, mid, auth_headers)
        assert m["status"] == "completed"
        assert m["format_review"] is False

    def test_match_override_defines_expected_format(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/matches/{mid}/format", json={"override": {"mode": "sets"}}, headers=auth_headers
        )
        assert r.status_code == 200
        assert "review" not in _submit_sets(client, tid, mid, headers)
        assert _get_gp_match(client, tid, mid, auth_headers)["status"] == "completed"

    def test_resubmit_while_under_review_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        _submit_sets(client, tid, mid, headers)
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": mid, "score1": 6, "score2": 3},
            headers=headers,
        )
        assert r.status_code == 409

    def test_approve_applies_parked_score(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        _submit_sets(client, tid, mid, headers)
        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/approve-review", headers=auth_headers)
        assert r.status_code == 200
        m = _get_gp_match(client, tid, mid, auth_headers)
        assert m["status"] == "completed"
        assert m["sets"] == [[6, 3], [6, 4]]
        assert m["format_review"] is False
        assert m["review_sets"] is None

    def test_reject_clears_review_and_allows_resubmit(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        _submit_sets(client, tid, mid, headers)
        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/reject-review", headers=auth_headers)
        assert r.status_code == 200
        m = _get_gp_match(client, tid, mid, auth_headers)
        assert m["format_review"] is False
        assert m["score"] is None
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": mid, "score1": 6, "score2": 3},
            headers=headers,
        )
        assert r.status_code == 200

    def test_review_actions_require_organiser(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        _submit_sets(client, tid, mid, headers)
        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/approve-review", headers=headers)
        assert r.status_code in (401, 403)

    def test_approve_without_review_returns_409(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, _headers = _gp_player_setup(client, auth_headers)
        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/approve-review", headers=auth_headers)
        assert r.status_code == 409

    def test_off_decider_super_tiebreak_goes_to_review(self, client: TestClient, auth_headers: dict) -> None:
        """Sets stage with a full-set decider: a super tie-break third set is parked, then adopted on approval."""
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings", json={"score_mode": {"gp-group": "sets"}}, headers=auth_headers
        )
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group-tennis",
            json={"match_id": mid, "sets": [[6, 4], [3, 6], [10, 8]], "decider": "match_tiebreak"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["review"] is True
        m = _get_gp_match(client, tid, mid, auth_headers)
        assert m["review_decider"] == "match_tiebreak"

        r = client.post(f"/api/tournaments/{tid}/matches/{mid}/approve-review", headers=auth_headers)
        assert r.status_code == 200, r.text
        m = _get_gp_match(client, tid, mid, auth_headers)
        assert m["status"] == "completed"
        assert m["effective_decider"] == "match_tiebreak"
        assert m["format_override"]["decider"] == "match_tiebreak"

    def test_matching_decider_counts_immediately(self, client: TestClient, auth_headers: dict) -> None:
        tid, mid, headers = _gp_player_setup(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"score_mode": {"gp-group": "sets"}, "set_decider": "match_tiebreak"},
            headers=auth_headers,
        )
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group-tennis",
            json={"match_id": mid, "sets": [[6, 4], [3, 6], [10, 8]], "decider": "match_tiebreak"},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        assert "review" not in r.json()
        assert _get_gp_match(client, tid, mid, auth_headers)["status"] == "completed"
