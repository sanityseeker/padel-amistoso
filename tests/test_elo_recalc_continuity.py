"""Cross-tournament ELO continuity through recalculation.

A recalculation replays the community chain: it must keep every match's
original timestamp (the chain's order), be idempotent, and reproduce exactly
what live scoring wrote.  The chain itself is covered in test_community_chain.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import backend.api.db as db_mod
from backend.api.elo_store import get_tournament_elo_timestamps, get_tournament_elos


def _insert_profile(name: str = "Nadal") -> str:
    profile_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
            " VALUES (?, ?, ?, ?, '', ?, 0)",
            (profile_id, f"pp-{uuid.uuid4().hex[:12]}", name, f"{name}-{profile_id[:6]}@ex.com", now),
        )
    return profile_id


class TestRecalculationPreservesMatchTimestamps:
    """A recalculation must not restamp matches with the moment it ran."""

    def _play_mexicano(self, client, auth_headers) -> str:
        r = client.post(
            "/api/tournaments/mexicano",
            json={
                "name": "TS Mex",
                "player_names": ["Alice", "Bob", "Carol", "Dave"],
                "court_names": ["Court 1"],
                "total_points_per_match": 32,
                "num_rounds": 1,
            },
            headers=auth_headers,
        )
        tid = r.json()["id"]
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        for m in matches["current_matches"]:
            if m["status"] != "completed":
                client.post(
                    f"/api/tournaments/{tid}/mex/record",
                    json={"match_id": m["id"], "score1": 20, "score2": 12},
                    headers=auth_headers,
                )
        return tid

    def test_recalculate_keeps_original_log_timestamps(self, client, auth_headers):
        tid = self._play_mexicano(client, auth_headers)
        before_logs, before_elo = get_tournament_elo_timestamps(tid, "padel")
        assert before_logs, "expected ELO log rows after playing a round"

        r = client.post(f"/api/tournaments/{tid}/elo/recalculate", headers=auth_headers)
        assert r.status_code == 200

        after_logs, after_elo = get_tournament_elo_timestamps(tid, "padel")
        assert after_logs == before_logs, "recalculation must preserve per-match timestamps"
        assert after_elo == before_elo, "recalculation must preserve player ELO row timestamps"

    def test_recalculate_is_idempotent(self, client, auth_headers):
        """Running the recalculation twice leaves identical ratings and timestamps."""
        tid = self._play_mexicano(client, auth_headers)
        client.post(f"/api/tournaments/{tid}/elo/recalculate", headers=auth_headers)
        first_elos = get_tournament_elos(tid, "padel")
        first_ts = get_tournament_elo_timestamps(tid, "padel")

        client.post(f"/api/tournaments/{tid}/elo/recalculate", headers=auth_headers)
        assert get_tournament_elos(tid, "padel") == first_elos
        assert get_tournament_elo_timestamps(tid, "padel") == first_ts


class TestRecalculateAllEndpoint:
    """The admin-wide recalculation replays every tournament in order."""

    def _play_mexicano(self, client, auth_headers, name: str) -> str:
        r = client.post(
            "/api/tournaments/mexicano",
            json={
                "name": name,
                "player_names": ["Alice", "Bob", "Carol", "Dave"],
                "court_names": ["Court 1"],
                "total_points_per_match": 32,
                "num_rounds": 1,
            },
            headers=auth_headers,
        )
        tid = r.json()["id"]
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        for m in matches["current_matches"]:
            if m["status"] != "completed":
                client.post(
                    f"/api/tournaments/{tid}/mex/record",
                    json={"match_id": m["id"], "score1": 20, "score2": 12},
                    headers=auth_headers,
                )
        return tid

    def test_recalculate_all_processes_every_tournament(self, client, auth_headers):
        t1 = self._play_mexicano(client, auth_headers, "All A")
        t2 = self._play_mexicano(client, auth_headers, "All B")

        before = {t: get_tournament_elos(t, "padel") for t in (t1, t2)}

        r = client.post("/api/tournaments/elo/recalculate-all", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["ok"] is True
        assert body["recalculated_tournaments"] >= 2

        # Replaying every tournament must not change already-correct ratings.
        for t in (t1, t2):
            assert get_tournament_elos(t, "padel") == before[t]

    def test_recalculate_all_requires_admin(self, client, alice_headers):
        r = client.post("/api/tournaments/elo/recalculate-all", headers=alice_headers)
        assert r.status_code == 403

    def test_recalculate_all_reproduces_live_ratings_of_running_tournaments(self, client, auth_headers, monkeypatch):
        """Two running tournaments share the community chain; a full replay rates them exactly as scoring did.

        Regression: both unfinished tournaments seeded each other on recalculation,
        double-counting a linked player's live results.
        """
        from backend.api import state as state_mod
        from tests.test_club_elo import _REAL_SAVE_TOURNAMENT, _log, _new_tournament, _play_rounds

        monkeypatch.setattr(state_mod, "_save_tournament", _REAL_SAVE_TOURNAMENT)
        alice = _insert_profile("Alice")
        t1, ids1 = _new_tournament(client, auth_headers, None, {"Alice": alice})
        _play_rounds(client, auth_headers, t1, "Alice")
        t2, ids2 = _new_tournament(client, auth_headers, None, {"Alice": alice})
        _play_rounds(client, auth_headers, t2, "Alice")
        live = {t1: _log(t1, ids1["Alice"]), t2: _log(t2, ids2["Alice"])}

        r = client.post("/api/tournaments/elo/recalculate-all", headers=auth_headers)
        assert r.status_code == 200, r.text
        assert {t1: _log(t1, ids1["Alice"]), t2: _log(t2, ids2["Alice"])} == live
