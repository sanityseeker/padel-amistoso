"""One rating chain per community: tournaments that run side by side share it.

Regression: two leagues of one community running at the same time each started
the player from their last *finished* tournament, so the Hub showed two
interleaved chains (a win in one league could "drop" the rating to the other
league's lower value).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

import backend.api.db as db_mod
from backend.api import state as state_mod
from backend.api.community_elo import replay_community
from tests.test_club_elo import _REAL_SAVE_TOURNAMENT, _new_tournament, _play_rounds


@pytest.fixture(autouse=True)
def _persist_tournaments(monkeypatch):
    monkeypatch.setattr(state_mod, "_save_tournament", _REAL_SAVE_TOURNAMENT)


def _insert_profile(name: str) -> str:
    profile_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
            " VALUES (?, ?, ?, ?, '', ?, 0)",
            (profile_id, f"pp-{uuid.uuid4().hex[:12]}", name, f"{name}-{profile_id[:6]}@ex.com", now),
        )
    return profile_id


def _profile_rows(profile_id: str) -> list[dict]:
    """The profile's community log rows in play order."""
    with db_mod.get_db() as conn:
        rows = conn.execute(
            """SELECT l.tournament_id, l.match_id, l.elo_before, l.elo_after, l.updated_at
                 FROM player_elo_log l
                 JOIN player_secrets ps ON ps.tournament_id = l.tournament_id AND ps.player_id = l.player_id
                WHERE ps.profile_id = ? AND l.is_manual = 0
             ORDER BY l.updated_at, l.match_order""",
            (profile_id,),
        ).fetchall()
    return [dict(r) for r in rows]


def _community_rating(profile_id: str, community_id: str = "open") -> tuple[float, int]:
    with db_mod.get_db() as conn:
        row = conn.execute(
            "SELECT elo, matches FROM profile_community_elo WHERE profile_id = ? AND community_id = ? AND sport = 'padel'",
            (profile_id, community_id),
        ).fetchone()
    return row["elo"], row["matches"]


def _assert_one_chain(rows: list[dict]) -> None:
    """Each match starts where the previous one ended."""
    assert rows
    assert rows[0]["elo_before"] == pytest.approx(1000)
    for prev, cur in zip(rows, rows[1:]):
        assert cur["elo_before"] == pytest.approx(prev["elo_after"])


def _two_running_leagues(client, auth_headers, alice: str) -> tuple[str, str]:
    """Two tournaments of one community, both running; Alice wins rounds in turn."""
    t1, _ = _new_tournament(client, auth_headers, None, {"Alice": alice})
    t2, _ = _new_tournament(client, auth_headers, None, {"Alice": alice})
    for tid in (t1, t2, t1, t2, t1):
        _play_rounds(client, auth_headers, tid, "Alice")
    return t1, t2


class TestSharedChain:
    def test_running_tournaments_continue_one_rating(self, client, auth_headers):
        alice = _insert_profile("Alice")
        _two_running_leagues(client, auth_headers, alice)

        rows = _profile_rows(alice)
        assert len({r["tournament_id"] for r in rows}) == 2
        _assert_one_chain(rows)
        # Every match was a win: the rating only goes up.
        assert all(r["elo_after"] > r["elo_before"] for r in rows)
        assert _community_rating(alice) == (pytest.approx(rows[-1]["elo_after"]), len(rows))

    def test_incremental_rating_equals_a_full_replay(self, client, auth_headers):
        alice = _insert_profile("Alice")
        _two_running_leagues(client, auth_headers, alice)
        live = _profile_rows(alice)

        replay_community("open")

        assert _profile_rows(alice) == live

    def test_correcting_an_early_score_moves_the_other_tournament(self, client, auth_headers):
        alice = _insert_profile("Alice")
        t1, t2 = _two_running_leagues(client, auth_headers, alice)
        before = {r["match_id"]: r["elo_after"] for r in _profile_rows(alice) if r["tournament_id"] == t2}

        # Alice's first match (in t1) now becomes a loss.
        first = _profile_rows(alice)[0]
        match = next(
            m
            for m in client.get(f"/api/tournaments/{t1}/mex/matches").json()["all_matches"]
            if m["id"] == first["match_id"]
        )
        alice_in_team1 = "Alice" in match["team1"]
        res = client.post(
            f"/api/tournaments/{t1}/mex/record",
            json={
                "match_id": match["id"],
                "score1": 8 if alice_in_team1 else 24,
                "score2": 24 if alice_in_team1 else 8,
            },
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text

        rows = _profile_rows(alice)
        _assert_one_chain(rows)
        after = {r["match_id"]: r["elo_after"] for r in rows if r["tournament_id"] == t2}
        assert all(after[m] < before[m] for m in before)

    def test_communities_never_seed_each_other(self, client, auth_headers):
        alice = _insert_profile("Alice")
        now = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO communities (id, name, created_by, created_at) VALUES ('c-other', 'Other', 'admin', ?)",
                (now,),
            )
        t1, _ = _new_tournament(client, auth_headers, None, {"Alice": alice})
        _play_rounds(client, auth_headers, t1, "Alice", rounds=2)
        t2, _ = _new_tournament(client, auth_headers, None, {"Alice": alice})
        res = client.patch(f"/api/tournaments/{t2}/community", json={"community_id": "c-other"}, headers=auth_headers)
        assert res.status_code == 200, res.text
        _play_rounds(client, auth_headers, t2, "Alice")

        other = [r for r in _profile_rows(alice) if r["tournament_id"] == t2]
        assert other[0]["elo_before"] == pytest.approx(1000)
        assert _community_rating(alice, "c-other")[1] == len(other)
        assert _community_rating(alice, "open")[1] == len(_profile_rows(alice)) - len(other)

    def test_moving_a_tournament_out_rebuilds_both_chains(self, client, auth_headers):
        alice = _insert_profile("Alice")
        t1, t2 = _two_running_leagues(client, auth_headers, alice)
        now = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO communities (id, name, created_by, created_at) VALUES ('c-move', 'Move', 'admin', ?)",
                (now,),
            )

        res = client.patch(f"/api/tournaments/{t2}/community", json={"community_id": "c-move"}, headers=auth_headers)
        assert res.status_code == 200, res.text

        rows = _profile_rows(alice)
        _assert_one_chain([r for r in rows if r["tournament_id"] == t1])
        _assert_one_chain([r for r in rows if r["tournament_id"] == t2])
        assert _community_rating(alice, "c-move")[1] == sum(r["tournament_id"] == t2 for r in rows)


class TestUnlinkedHistoryRows:
    def test_unlinked_history_row_is_not_a_profile(self, client, auth_headers):
        """A ``player_history`` row without a profile (an unlinked participant) never gets a rating row."""
        tid, ids = _new_tournament(client, auth_headers, None)
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO player_history (profile_id, entity_type, entity_id, entity_name, player_id,"
                " player_name, finished_at, sport) VALUES (NULL, 'tournament', ?, 'T', ?, 'Bob', '', 'padel')",
                (tid, ids["Bob"]),
            )
        # Live scoring (no replay): every match must be rated.
        _play_rounds(client, auth_headers, tid, "Alice", rounds=2)

        with db_mod.get_db() as conn:
            rated = conn.execute(
                "SELECT COUNT(DISTINCT match_id) FROM player_elo_log WHERE tournament_id = ?", (tid,)
            ).fetchone()[0]
            null_rows = conn.execute("SELECT COUNT(*) FROM profile_community_elo WHERE profile_id IS NULL").fetchone()[
                0
            ]
        assert rated == 2
        assert null_rows == 0
