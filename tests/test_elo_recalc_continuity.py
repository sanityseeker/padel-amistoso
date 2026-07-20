"""Cross-tournament ELO continuity through recalculation.

Covers the three failure modes that made recalculating two tournaments produce
wrong ratings:

* a tournament restarting every player from 1000 instead of continuing from
  their earlier tournaments,
* recalculating an *older* tournament overwriting a newer tournament's result
  on the profile ("the second tournament overwrites the first"),
* a recalculation restamping every match with the moment it ran, scrambling the
  chronology the leaderboard uses to pick a player's latest rating.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import backend.api.db as db_mod
from backend.api.elo_store import (
    get_pretournament_seed,
    get_tournament_elos,
    get_tournament_elo_timestamps,
    refresh_profiles_after_tournament,
)


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


def _insert_tournament(tid: str, community_id: str = "open") -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, 'admin', ?)",
            (community_id, f"Community {community_id}", now),
        )
        conn.execute(
            """INSERT OR IGNORE INTO tournaments
               (id, name, type, owner, public, tournament_blob, version, sport, community_id)
               VALUES (?, ?, 'mexicano', 'admin', 1, ?, 0, 'padel', ?)""",
            (tid, f"T-{tid}", b"", community_id),
        )


def _link_player(tid: str, player_id: str, profile_id: str) -> None:
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)
               VALUES (?, ?, 'P', ?, ?, ?)""",
            (tid, player_id, f"ps-{uuid.uuid4().hex[:10]}", uuid.uuid4().hex, profile_id),
        )


def _finish_with_elo(
    tid: str,
    player_id: str,
    profile_id: str,
    *,
    elo_after: float,
    matches: int,
    finished_at: str,
) -> None:
    """Record a finished tournament result for a linked player."""
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT INTO player_history
               (profile_id, entity_type, entity_id, entity_name, player_id, player_name, finished_at, sport)
               VALUES (?, 'tournament', ?, ?, ?, 'P', ?, 'padel')""",
            (profile_id, tid, f"T-{tid}", player_id, finished_at),
        )
        conn.execute(
            """INSERT INTO player_elo
               (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)
               VALUES (?, ?, 'padel', 1000, ?, ?, ?)""",
            (tid, player_id, elo_after, matches, finished_at),
        )


class TestPretournamentSeed:
    """A tournament's starting ratings continue from the player's earlier events."""

    def test_seed_chains_from_earlier_tournament(self, client):
        """A later tournament seeds from the earlier one, not from 1000."""
        profile = _insert_profile()
        _insert_tournament("t-a", "c1")
        _insert_tournament("t-b", "c1")
        _link_player("t-a", "pid-a", profile)
        _link_player("t-b", "pid-b", profile)
        _finish_with_elo("t-a", "pid-a", profile, elo_after=1200, matches=5, finished_at="2026-01-01T00:00:00+00:00")

        seed = get_pretournament_seed("t-b", "padel")
        assert seed == {"pid-b": (1200, 5)}

    def test_first_tournament_has_no_seed(self, client):
        """With no earlier event the player is omitted, so the engine starts at 1000."""
        profile = _insert_profile()
        _insert_tournament("t-only", "c1")
        _link_player("t-only", "pid-only", profile)

        assert get_pretournament_seed("t-only", "padel") == {}

    def test_same_community_wins_over_global_fallback(self, client):
        """An in-community result takes precedence over a later out-of-community one."""
        profile = _insert_profile()
        for tid, community in (("t-c1", "c1"), ("t-open", "open"), ("t-target", "c1")):
            _insert_tournament(tid, community)
        _link_player("t-c1", "pid-c1", profile)
        _link_player("t-open", "pid-open", profile)
        _link_player("t-target", "pid-target", profile)

        _finish_with_elo("t-c1", "pid-c1", profile, elo_after=1200, matches=5, finished_at="2026-01-01T00:00:00+00:00")
        # Later, but in a different community — must not win over the c1 chain.
        _finish_with_elo(
            "t-open", "pid-open", profile, elo_after=1400, matches=9, finished_at="2026-02-01T00:00:00+00:00"
        )

        assert get_pretournament_seed("t-target", "padel") == {"pid-target": (1200, 5)}

    def test_global_chain_used_when_new_to_community(self, client):
        """With no prior event in this community, the global chain seeds the player."""
        profile = _insert_profile()
        _insert_tournament("t-open2", "open")
        _insert_tournament("t-new", "c2")
        _link_player("t-open2", "pid-open2", profile)
        _link_player("t-new", "pid-new", profile)
        _finish_with_elo(
            "t-open2", "pid-open2", profile, elo_after=1300, matches=8, finished_at="2026-01-01T00:00:00+00:00"
        )

        assert get_pretournament_seed("t-new", "padel") == {"pid-new": (1300, 8)}


class TestRefreshDoesNotClobberNewerResults:
    """Recalculating an older tournament must not roll the profile backwards."""

    def test_older_tournament_recalc_keeps_latest_rating(self, client):
        """Refreshing after the OLDER event still leaves the NEWER event's rating."""
        profile = _insert_profile()
        _insert_tournament("t-old", "c1")
        _insert_tournament("t-new", "c1")
        _link_player("t-old", "pid-old", profile)
        _link_player("t-new", "pid-new", profile)
        _finish_with_elo(
            "t-old", "pid-old", profile, elo_after=1200, matches=5, finished_at="2026-01-01T00:00:00+00:00"
        )
        _finish_with_elo(
            "t-new", "pid-new", profile, elo_after=1250, matches=8, finished_at="2026-03-01T00:00:00+00:00"
        )

        # Simulate recalculating the OLDER tournament — the previous bug wrote the
        # older result onto the profile because it had the freshest updated_at.
        refresh_profiles_after_tournament("t-old", "padel")

        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT elo, matches FROM profile_community_elo"
                " WHERE profile_id = ? AND community_id = 'c1' AND sport = 'padel'",
                (profile,),
            ).fetchone()
        assert (row["elo"], row["matches"]) == (1250, 8), "older recalc must not overwrite the newer result"

    def test_refresh_after_latest_tournament_writes_it(self, client):
        """Refreshing after the newest event stores that event's cumulative state."""
        profile = _insert_profile()
        _insert_tournament("t-1", "c1")
        _insert_tournament("t-2", "c1")
        _link_player("t-1", "pid-1", profile)
        _link_player("t-2", "pid-2", profile)
        _finish_with_elo("t-1", "pid-1", profile, elo_after=1200, matches=5, finished_at="2026-01-01T00:00:00+00:00")
        _finish_with_elo("t-2", "pid-2", profile, elo_after=1275, matches=11, finished_at="2026-03-01T00:00:00+00:00")

        refresh_profiles_after_tournament("t-2", "padel")

        with db_mod.get_db() as conn:
            row = conn.execute(
                "SELECT elo, matches FROM profile_community_elo"
                " WHERE profile_id = ? AND community_id = 'c1' AND sport = 'padel'",
                (profile,),
            ).fetchone()
            flat = conn.execute(
                "SELECT elo_padel, elo_padel_matches FROM player_profiles WHERE id = ?",
                (profile,),
            ).fetchone()
        assert (row["elo"], row["matches"]) == (1275, 11)
        # Cumulative match count carries across tournaments, not just the last one.
        assert (flat["elo_padel"], flat["elo_padel_matches"]) == (1275, 11)


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
