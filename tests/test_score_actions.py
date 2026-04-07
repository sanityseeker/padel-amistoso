"""Tests for score lifecycle endpoints: accept, correct, resolve-dispute, history."""

from __future__ import annotations

from fastapi.testclient import TestClient


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
