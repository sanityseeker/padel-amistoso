"""Per-club ELO: each club keeps its own rating chain (backend/api/club_elo.py).

Club tournaments are played through the real API, so the scoring, link and
club-assignment hooks all run.  Community and global ratings must not change.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

import backend.api.db as db_mod
from backend.api import state as state_mod
from backend.api import club_elo
from backend.auth.security import create_profile_token
from tests.test_elo_relink import _insert_profile

# conftest stubs out ``_save_tournament``; the club chain reads tournament rows
# (``tournaments.club_id``) from SQLite, so these tests need the real one.
_REAL_SAVE_TOURNAMENT = state_mod._save_tournament


@pytest.fixture(autouse=True)
def _persist_tournaments(monkeypatch):
    monkeypatch.setattr(state_mod, "_save_tournament", _REAL_SAVE_TOURNAMENT)


def _make_club(club_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES ('open', 'Open', 'admin', ?)",
            (now,),
        )
        conn.execute(
            "INSERT INTO clubs (id, name, slug, community_id, created_by, created_at)"
            " VALUES (?, ?, ?, 'open', 'admin', ?)",
            (club_id, f"Club {club_id}", club_id, now),
        )


def _new_tournament(
    client, auth_headers, club_id: str | None, profiles: dict[str, str] | None = None
) -> tuple[str, dict[str, str]]:
    """Create a 4-player Mexicano in *club_id*, linking ``{name: profile_id}`` before play.

    Returns the tournament id and ``{name: player_id}``.
    """
    r = client.post(
        "/api/tournaments/mexicano",
        json={
            "name": f"Club Mex {uuid.uuid4().hex[:6]}",
            "player_names": ["Alice", "Bob", "Carol", "Dave"],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "num_rounds": 3,
        },
        headers=auth_headers,
    )
    tid = r.json()["id"]
    if club_id is not None:
        res = client.patch(f"/api/tournaments/{tid}/club", json={"club_id": club_id}, headers=auth_headers)
        assert res.status_code == 200, res.text
    players = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
    # conftest keeps secrets in memory; the link endpoints need the DB rows.
    with db_mod.get_db() as conn:
        conn.executemany(
            "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token)"
            " VALUES (?, ?, ?, ?, ?)",
            [(tid, pid, info["name"], info["passphrase"], info["token"]) for pid, info in players.items()],
        )
    ids = {info["name"]: pid for pid, info in players.items()}
    for name, profile_id in (profiles or {}).items():
        _link(client, auth_headers, profile_id, tid, ids[name])
    return tid, ids


def _play_rounds(client, auth_headers, tid: str, winner: str, rounds: int = 1, *, loser: bool = False) -> None:
    """Play *rounds* Mexicano rounds; *winner*'s side wins every match (loses, with ``loser``)."""
    for _ in range(rounds):
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        for m in client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"]:
            won = (winner in m["team1"]) != loser
            client.post(
                f"/api/tournaments/{tid}/mex/record",
                json={"match_id": m["id"], "score1": 24 if won else 8, "score2": 8 if won else 24},
                headers=auth_headers,
            )


def _play(
    client,
    auth_headers,
    club_id: str | None,
    winner: str,
    profiles: dict[str, str] | None = None,
    *,
    loser: bool = False,
) -> tuple[str, dict[str, str]]:
    """Create a tournament in *club_id* and play one round; see :func:`_new_tournament`."""
    tid, ids = _new_tournament(client, auth_headers, club_id, profiles)
    _play_rounds(client, auth_headers, tid, winner, loser=loser)
    return tid, ids


def _link(client, auth_headers, profile_id: str, tid: str, player_id: str) -> None:
    r = client.post(f"/api/admin/player-profiles/{profile_id}/link/{tid}/{player_id}", headers=auth_headers)
    assert r.status_code == 200, r.text


def _log(tid: str, player_id: str) -> list[dict]:
    """The player's match rows in *tid*, in play order."""
    with db_mod.get_db() as conn:
        rows = conn.execute(
            "SELECT elo_before, elo_after, club_elo_before, club_elo_after, match_payload FROM player_elo_log"
            " WHERE tournament_id = ? AND player_id = ? AND is_manual = 0 ORDER BY updated_at",
            (tid, player_id),
        ).fetchall()
    return [dict(r) for r in rows]


def _space(client, profile_id: str, query: str = "") -> dict:
    headers = {"Authorization": f"Bearer {create_profile_token(profile_id)}"}
    res = client.get(f"/api/player-profile/space{query}", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def _tier(client, auth_headers, club_id: str, profile_id: str, base_elo: int) -> None:
    tier = client.post(
        f"/api/clubs/{club_id}/tiers",
        json={"name": f"Tier {base_elo}", "sport": "padel", "base_elo": base_elo, "position": 0},
        headers=auth_headers,
    )
    assert tier.status_code in (200, 201), tier.text
    res = client.patch(
        f"/api/clubs/{club_id}/players/{profile_id}/tier",
        json={"sport": "padel", "tier_id": tier.json()["id"], "apply_base_elo": True},
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text


class TestClubChain:
    def test_club_rating_ignores_other_clubs(self, client, auth_headers):
        _make_club("ka")
        _make_club("kb")
        alice = _insert_profile("Alice")

        t_a1, ids_a1 = _play(client, auth_headers, "ka", winner="Alice", loser=True)
        t_b, ids_b = _play(client, auth_headers, "kb", winner="Alice")
        t_a2, ids_a2 = _play(client, auth_headers, "ka", winner="Alice", loser=True)
        # Linking after play rewrites club history: the flush replays the clubs.
        for tid, ids in ((t_a1, ids_a1), (t_b, ids_b), (t_a2, ids_a2)):
            _link(client, auth_headers, alice, tid, ids["Alice"])

        a1_end = _log(t_a1, ids_a1["Alice"])[-1]["club_elo_after"]
        a2_start = _log(t_a2, ids_a2["Alice"])[0]
        b_end = _log(t_b, ids_b["Alice"])[-1]
        # Club A picks up where Alice left club A, not where club B left her.
        assert a2_start["club_elo_before"] == a1_end
        assert a1_end < 1000 < b_end["club_elo_after"]
        # Her club B rating is unaffected by club A losses before it: B was her
        # first club B match, so it started from her community rating then.
        assert _log(t_b, ids_b["Alice"])[0]["club_elo_before"] == _log(t_b, ids_b["Alice"])[0]["elo_before"]

        club_a = _space(client, alice, "?club_id=ka")
        assert club_a["profile"]["elo_padel"] == _log(t_a2, ids_a2["Alice"])[-1]["club_elo_after"]
        history = [e for e in club_a["elo_history"] if not e["is_manual"]]
        assert {e["tournament_id"] for e in history} == {t_a1, t_a2}
        assert history[0]["elo_after"] == _log(t_a2, ids_a2["Alice"])[-1]["club_elo_after"]

    def test_community_rating_does_not_see_club_ratings(self, client, auth_headers):
        _make_club("kc")
        bob = _insert_profile("Bob")
        _tier(client, auth_headers, "kc", bob, 1400)
        tid, ids = _play(client, auth_headers, "kc", winner="Bob", profiles={"Bob": bob})

        first = _log(tid, ids["Bob"])[0]
        assert first["club_elo_before"] == 1400
        assert first["elo_before"] == 1000
        assert _space(client, bob)["profile"]["elo_padel"] == _log(tid, ids["Bob"])[-1]["elo_after"]
        assert _space(client, bob, "?club_id=kc")["profile"]["elo_padel"] == _log(tid, ids["Bob"])[-1]["club_elo_after"]


class TestClubRatingsSetByTheClub:
    def test_tier_for_never_played_profile_seeds_first_club_match(self, client, auth_headers):
        _make_club("kd")
        carol = _insert_profile("Carol")
        _tier(client, auth_headers, "kd", carol, 1350)
        tid, ids = _play(client, auth_headers, "kd", winner="Alice", profiles={"Carol": carol})
        assert _log(tid, ids["Carol"])[0]["club_elo_before"] == 1350

    def test_manual_rating_for_player_new_to_the_club_seeds_first_club_match(self, client, auth_headers):
        """A profile that has played elsewhere still gets its club override logged."""
        _make_club("ke")
        dave = _insert_profile("Dave")
        _play(client, auth_headers, None, winner="Dave", profiles={"Dave": dave})

        res = client.patch(
            f"/api/clubs/ke/players/{dave}/elo", json={"sport": "padel", "elo": 1250}, headers=auth_headers
        )
        assert res.status_code == 200, res.text
        tid, ids = _play(client, auth_headers, "ke", winner="Alice", profiles={"Dave": dave})
        assert _log(tid, ids["Dave"])[0]["club_elo_before"] == 1250

    def test_rating_set_mid_tournament_applies_to_the_next_match(self, client, auth_headers):
        _make_club("kf")
        alice = _insert_profile("Alice")
        _play(client, auth_headers, "kf", winner="Alice", profiles={"Alice": alice})
        _tier(client, auth_headers, "kf", alice, 900)
        t2, ids2 = _play(client, auth_headers, "kf", winner="Alice", profiles={"Alice": alice})
        assert _log(t2, ids2["Alice"])[0]["club_elo_before"] == 900


class TestChainMaintenance:
    def test_moving_a_tournament_to_another_club_moves_its_matches(self, client, auth_headers):
        _make_club("kg")
        _make_club("kh")
        alice = _insert_profile("Alice")
        _tier(client, auth_headers, "kh", alice, 1500)
        tid, ids = _play(client, auth_headers, "kg", winner="Alice", profiles={"Alice": alice})
        assert _log(tid, ids["Alice"])[0]["club_elo_before"] == 1000

        res = client.patch(f"/api/tournaments/{tid}/club", json={"club_id": "kh"}, headers=auth_headers)
        assert res.status_code == 200, res.text
        assert _log(tid, ids["Alice"])[0]["club_elo_before"] == 1500
        assert _space(client, alice, "?club_id=kg")["profile"]["elo_padel_matches"] == 0

    def test_match_payload_carries_club_ratings_for_every_participant(self, client, auth_headers):
        _make_club("ki")
        alice = _insert_profile("Alice")
        _tier(client, auth_headers, "ki", alice, 1200)
        tid, ids = _play(client, auth_headers, "ki", winner="Alice", profiles={"Alice": alice})

        history = _space(client, alice, "?club_id=ki")["elo_history"]
        match = next(e for e in history if not e["is_manual"])
        me = next(p for p in match["team1"] if p["player_id"] == ids["Alice"])
        first = _log(tid, ids["Alice"])[0]
        assert (me["elo_before"], me["elo_after"]) == (first["club_elo_before"], first["club_elo_after"])


class TestNewScores:
    def test_new_scores_are_rated_alone_and_match_a_full_replay(self, client, auth_headers, monkeypatch):
        _make_club("kq")
        alice, bob = _insert_profile("Alice"), _insert_profile("Bob")
        profiles = {"Alice": alice, "Bob": bob}
        _tier(client, auth_headers, "kq", alice, 1300)

        replays: list[str] = []
        real_replay = club_elo._replay_club
        for winner in ("Alice", "Carol", "Bob"):
            tid, _ids = _new_tournament(client, auth_headers, "kq", profiles)
            monkeypatch.setattr(
                club_elo, "_replay_club", lambda club_id: replays.append(club_id) or real_replay(club_id)
            )
            _play_rounds(client, auth_headers, tid, winner, rounds=3)
            monkeypatch.setattr(club_elo, "_replay_club", real_replay)

        assert replays == [], "a new score must not replay the club"
        with db_mod.get_db() as conn:
            unrated = conn.execute(
                "SELECT COUNT(*) FROM player_elo_log l JOIN tournaments t ON t.id = l.tournament_id"
                " WHERE t.club_id = 'kq' AND l.is_manual = 0 AND l.club_matches_after IS NULL"
            ).fetchone()[0]
        assert unrated == 0
        # Rating one match at a time gives exactly what a full replay gives.
        assert real_replay("kq") is False

    def test_a_score_older_than_the_club_s_latest_event_replays_the_club(self, client, auth_headers):
        _make_club("kr")
        alice = _insert_profile("Alice")
        tid, ids = _new_tournament(client, auth_headers, "kr", {"Alice": alice})
        # A manual rating dated in the future is "later" than any new score.
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO player_elo_log (tournament_id, sport, match_id, player_id, match_order, elo_before,"
                " elo_after, elo_delta, match_payload, updated_at, is_manual)"
                " VALUES ('kr', 'padel', 'MANUAL-x', ?, 0, 1000, 1600, 600, '{}', '2999-01-01T00:00:00+00:00', 1)",
                (alice,),
            )
        _play_rounds(client, auth_headers, tid, "Alice")
        # The replay puts the future rating after the match, so the match starts from 1000.
        assert _log(tid, ids["Alice"])[0]["club_elo_before"] == 1000
        assert club_elo._replay_club("kr") is False


class TestRecalculateClubEndpoint:
    def test_recalculate_rebuilds_the_club_ratings(self, client, auth_headers):
        _make_club("kt")
        alice = _insert_profile("Alice")
        _tier(client, auth_headers, "kt", alice, 1300)
        t1, ids1 = _play(client, auth_headers, "kt", winner="Alice", profiles={"Alice": alice})
        t2, ids2 = _play(client, auth_headers, "kt", winner="Bob", profiles={"Alice": alice})
        expected = {tid: _log(tid, ids[name]) for tid, ids in ((t1, ids1), (t2, ids2)) for name in ("Alice",)}
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE player_elo_log SET club_identity = NULL, club_elo_before = NULL,"
                " club_elo_after = NULL, club_matches_after = NULL WHERE tournament_id IN (?, ?)",
                (t1, t2),
            )

        res = client.post("/api/clubs/kt/elo/recalculate", headers=auth_headers)
        assert res.status_code == 200, res.text
        assert res.json()["recalculated_tournaments"] == 2
        assert {t1: _log(t1, ids1["Alice"]), t2: _log(t2, ids2["Alice"])} == expected

    def test_recalculate_requires_club_editing_access(self, client, alice_headers):
        _make_club("ku")
        res = client.post("/api/clubs/ku/elo/recalculate", headers=alice_headers)
        assert res.status_code == 403
