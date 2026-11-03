"""ELO recalculation when a participation's Player Hub link changes.

A participant's starting rating comes from their linked profile, so linking,
re-linking or unlinking must replay the tournament (everyone's ratings depend
on the seeds) and rebuild the profile that lost the participation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import backend.api.db as db_mod
from backend.api.elo_store import get_tournament_elos
from backend.auth.security import create_profile_token

EARLIER = "2026-01-01T00:00:00+00:00"


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


def _give_earlier_result(profile_id: str, elo_after: float, matches: int) -> None:
    """Record a finished, earlier tournament for *profile_id* ending at *elo_after*."""
    tid = f"t-old-{uuid.uuid4().hex[:6]}"
    player_id = f"p-old-{uuid.uuid4().hex[:6]}"
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT INTO tournaments (id, name, type, owner, public, tournament_blob, version, sport)
               VALUES (?, 'Old', 'mexicano', 'admin', 1, ?, 0, 'padel')""",
            (tid, b""),
        )
        conn.execute(
            """INSERT INTO player_history
               (profile_id, entity_type, entity_id, entity_name, player_id, player_name, finished_at, sport)
               VALUES (?, 'tournament', ?, 'Old', ?, 'P', ?, 'padel')""",
            (profile_id, tid, player_id, EARLIER),
        )
        conn.execute(
            """INSERT INTO player_elo
               (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)
               VALUES (?, ?, 'padel', 1000, ?, ?, ?)""",
            (tid, player_id, elo_after, matches, EARLIER),
        )


def _profile_elo(profile_id: str) -> tuple[float, int]:
    with db_mod.get_db() as conn:
        row = conn.execute(
            "SELECT elo_padel, elo_padel_matches FROM player_profiles WHERE id = ?", (profile_id,)
        ).fetchone()
    return row["elo_padel"], row["elo_padel_matches"]


def _elo_before(tid: str, player_id: str) -> float:
    with db_mod.get_db() as conn:
        row = conn.execute(
            "SELECT elo_before FROM player_elo WHERE tournament_id = ? AND player_id = ? AND sport = 'padel'",
            (tid, player_id),
        ).fetchone()
    return row["elo_before"]


def _play_mexicano(client, auth_headers) -> tuple[str, dict[str, str]]:
    """Play one round; return the tournament id and ``{name: player_id}``."""
    r = client.post(
        "/api/tournaments/mexicano",
        json={
            "name": "Relink Mex",
            "player_names": ["Alice", "Bob", "Carol", "Dave"],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "num_rounds": 1,
        },
        headers=auth_headers,
    )
    tid = r.json()["id"]
    client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
    for m in client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"]:
        if m["status"] != "completed":
            client.post(
                f"/api/tournaments/{tid}/mex/record",
                json={"match_id": m["id"], "score1": 20, "score2": 12},
                headers=auth_headers,
            )
    players = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
    # conftest keeps secrets in memory; the link endpoints need the DB rows.
    with db_mod.get_db() as conn:
        conn.executemany(
            "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token)"
            " VALUES (?, ?, ?, ?, ?)",
            [(tid, pid, info["name"], info["passphrase"], info["token"]) for pid, info in players.items()],
        )
    return tid, {info["name"]: pid for pid, info in players.items()}


def _link(client, auth_headers, profile_id: str, tid: str, player_id: str) -> dict:
    r = client.post(f"/api/admin/player-profiles/{profile_id}/link/{tid}/{player_id}", headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()


class TestUnlinkRecalculatesElo:
    def test_unlink_resets_profile_and_restores_tournament(self, client, auth_headers):
        tid, ids = _play_mexicano(client, auth_headers)
        baseline = get_tournament_elos(tid, "padel")
        profile = _insert_profile("Alice")
        _give_earlier_result(profile, elo_after=1300, matches=6)

        _link(client, auth_headers, profile, tid, ids["Alice"])
        # Alice now starts from her profile's earlier rating, which moves everyone.
        assert _elo_before(tid, ids["Alice"]) == 1300
        assert get_tournament_elos(tid, "padel") != baseline
        assert _profile_elo(profile)[0] == get_tournament_elos(tid, "padel")[ids["Alice"]]

        r = client.delete(f"/api/admin/player-profiles/link/{tid}/{ids['Alice']}", headers=auth_headers)
        assert r.status_code == 200

        # Back to an unlinked 1000 start, and the profile falls back to its earlier result.
        assert _elo_before(tid, ids["Alice"]) == 1000
        assert get_tournament_elos(tid, "padel") == baseline
        assert _profile_elo(profile) == (1300, 6)

    def test_unlink_only_participation_resets_to_default(self, client, auth_headers):
        tid, ids = _play_mexicano(client, auth_headers)
        profile = _insert_profile("Bob")
        _link(client, auth_headers, profile, tid, ids["Bob"])
        assert _profile_elo(profile)[1] > 0

        client.delete(f"/api/admin/player-profiles/link/{tid}/{ids['Bob']}", headers=auth_headers)
        assert _profile_elo(profile) == (1000, 0)


class TestRelinkRecalculatesElo:
    def test_relink_moves_seed_and_rebuilds_old_profile(self, client, auth_headers):
        tid, ids = _play_mexicano(client, auth_headers)
        baseline = get_tournament_elos(tid, "padel")
        old = _insert_profile("Alice")
        _give_earlier_result(old, elo_after=1300, matches=6)
        new = _insert_profile("Alicia")

        _link(client, auth_headers, old, tid, ids["Alice"])
        _link(client, auth_headers, new, tid, ids["Alice"])

        # The new profile has no earlier tournament, so Alice starts from 1000 again.
        assert _elo_before(tid, ids["Alice"]) == 1000
        assert get_tournament_elos(tid, "padel") == baseline
        assert _profile_elo(new)[0] == baseline[ids["Alice"]]
        assert _profile_elo(old) == (1300, 6)

    def test_moving_profile_to_other_participant_recalculates_both(self, client, auth_headers):
        tid, ids = _play_mexicano(client, auth_headers)
        profile = _insert_profile("Carol")
        _give_earlier_result(profile, elo_after=1300, matches=6)

        _link(client, auth_headers, profile, tid, ids["Carol"])
        body = _link(client, auth_headers, profile, tid, ids["Dave"])

        assert body["unlinked_player_ids"] == [ids["Carol"]]
        assert _elo_before(tid, ids["Carol"]) == 1000
        assert _elo_before(tid, ids["Dave"]) == 1300
        assert _profile_elo(profile)[0] == get_tournament_elos(tid, "padel")[ids["Dave"]]


class TestSelfUnlinkRecalculatesElo:
    def test_player_hub_unlink_rebuilds_profile(self, client, auth_headers):
        tid, ids = _play_mexicano(client, auth_headers)
        baseline = get_tournament_elos(tid, "padel")
        profile = _insert_profile("Dave")
        _give_earlier_result(profile, elo_after=1300, matches=6)
        _link(client, auth_headers, profile, tid, ids["Dave"])

        r = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "tournament", "entity_id": tid},
            headers={"Authorization": f"Bearer {create_profile_token(profile)}"},
        )
        assert r.status_code == 200, r.text
        assert get_tournament_elos(tid, "padel") == baseline
        assert _profile_elo(profile) == (1300, 6)


class TestFlushReplaysOnlyWhatChanges:
    """The flush replays a tournament only when its starting ratings change."""

    def _count_replays(self, monkeypatch) -> list[str]:
        import backend.api.elo_recalc as elo_recalc_mod

        calls: list[str] = []
        real = elo_recalc_mod.elo_recalculate_tournament

        def counting(tid, reseed=()):
            calls.append(tid)
            return real(tid, reseed)

        monkeypatch.setattr(elo_recalc_mod, "elo_recalculate_tournament", counting)
        return calls

    @staticmethod
    def _history(tid: str, player_id: str, profile_id: str | None, finished_at: str) -> None:
        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO player_history
                   (profile_id, entity_type, entity_id, entity_name, player_id, player_name, finished_at, sport)
                   VALUES (?, 'tournament', ?, 'T', ?, 'P', ?, 'padel')""",
                (profile_id, tid, player_id, finished_at),
            )

    def test_link_propagates_to_later_tournament_only(self, client, auth_headers, monkeypatch):
        t1, ids1 = _play_mexicano(client, auth_headers)
        t2, ids2 = _play_mexicano(client, auth_headers)
        t3, ids3 = _play_mexicano(client, auth_headers)
        profile = _insert_profile("Alice")
        # t1 (finished first, unlinked) -> t2 (finished later, already linked) -> t3 (unrelated).
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE player_secrets SET finished_at = ? WHERE tournament_id = ? AND player_id = ?",
                ("2026-01-01T00:00:00+00:00", t1, ids1["Alice"]),
            )
            conn.execute(
                "UPDATE player_secrets SET profile_id = ? WHERE tournament_id = ? AND player_id = ?",
                (profile, t2, ids2["Alice"]),
            )
        self._history(t1, ids1["Alice"], None, "2026-01-01T00:00:00+00:00")
        self._history(t2, ids2["Alice"], profile, "2026-02-01T00:00:00+00:00")
        self._history(t3, ids3["Alice"], None, "2026-03-01T00:00:00+00:00")
        t3_before = get_tournament_elos(t3, "padel")
        with db_mod.get_db() as conn:
            t1_alice = conn.execute(
                "SELECT elo_after FROM player_elo WHERE tournament_id = ? AND player_id = ?", (t1, ids1["Alice"])
            ).fetchone()[0]
        calls = self._count_replays(monkeypatch)

        _link(client, auth_headers, profile, t1, ids1["Alice"])

        # t1's starting ratings are unchanged (Alice had no earlier result), so
        # only t2 — now seeded from t1 — is replayed; t3 is untouched.
        assert calls == [t2]
        assert _elo_before(t2, ids2["Alice"]) == t1_alice
        assert get_tournament_elos(t3, "padel") == t3_before
        assert _profile_elo(profile)[0] == get_tournament_elos(t2, "padel")[ids2["Alice"]]

    def test_first_link_of_new_profile_replays_nothing(self, client, auth_headers, monkeypatch):
        tid, ids = _play_mexicano(client, auth_headers)
        profile = _insert_profile("Carol")
        calls = self._count_replays(monkeypatch)

        _link(client, auth_headers, profile, tid, ids["Carol"])

        assert calls == []
        assert _profile_elo(profile)[0] == get_tournament_elos(tid, "padel")[ids["Carol"]]
