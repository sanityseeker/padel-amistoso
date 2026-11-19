"""ELO recalculation when a participation's Player Hub link changes.

A linked participant rates on their profile's community chain (it continues
from the profile's earlier matches in the community); an unlinked one starts a
chain of its own at 1000.  Linking, re-linking or unlinking must therefore
replay the community and rebuild the profile that lost the participation.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import backend.api.db as db_mod
from backend.api.elo_store import get_tournament_elos
from backend.auth.security import create_profile_token


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


def _give_earlier_result(client, auth_headers, profile_id: str) -> tuple[float, int]:
    """Play a tournament first with *profile_id* as its Alice; return the profile's (rating, matches)."""
    tid, ids = _play_mexicano(client, auth_headers)
    _link(client, auth_headers, profile_id, tid, ids["Alice"])
    return _profile_elo(profile_id)


class TestUnlinkRecalculatesElo:
    def test_unlink_resets_profile_and_restores_tournament(self, client, auth_headers):
        profile = _insert_profile("Alice")
        earlier = _give_earlier_result(client, auth_headers, profile)
        tid, ids = _play_mexicano(client, auth_headers)
        baseline = get_tournament_elos(tid, "padel")

        _link(client, auth_headers, profile, tid, ids["Alice"])
        # Alice now continues from her profile's earlier rating, which moves everyone.
        assert _elo_before(tid, ids["Alice"]) == earlier[0]
        assert get_tournament_elos(tid, "padel") != baseline
        assert _profile_elo(profile)[0] == get_tournament_elos(tid, "padel")[ids["Alice"]]

        r = client.delete(f"/api/admin/player-profiles/link/{tid}/{ids['Alice']}", headers=auth_headers)
        assert r.status_code == 200

        # Back to an unlinked 1000 start, and the profile falls back to its earlier result.
        assert _elo_before(tid, ids["Alice"]) == 1000
        assert get_tournament_elos(tid, "padel") == baseline
        assert _profile_elo(profile) == earlier

    def test_unlink_only_participation_resets_to_default(self, client, auth_headers):
        tid, ids = _play_mexicano(client, auth_headers)
        profile = _insert_profile("Bob")
        _link(client, auth_headers, profile, tid, ids["Bob"])
        assert _profile_elo(profile)[1] > 0

        client.delete(f"/api/admin/player-profiles/link/{tid}/{ids['Bob']}", headers=auth_headers)
        assert _profile_elo(profile) == (1000, 0)


class TestRelinkRecalculatesElo:
    def test_relink_moves_seed_and_rebuilds_old_profile(self, client, auth_headers):
        old = _insert_profile("Alice")
        earlier = _give_earlier_result(client, auth_headers, old)
        tid, ids = _play_mexicano(client, auth_headers)
        baseline = get_tournament_elos(tid, "padel")
        new = _insert_profile("Alicia")

        _link(client, auth_headers, old, tid, ids["Alice"])
        _link(client, auth_headers, new, tid, ids["Alice"])

        # The new profile has no earlier match, so Alice starts from 1000 again.
        assert _elo_before(tid, ids["Alice"]) == 1000
        assert get_tournament_elos(tid, "padel") == baseline
        assert _profile_elo(new)[0] == baseline[ids["Alice"]]
        assert _profile_elo(old) == earlier

    def test_moving_profile_to_other_participant_recalculates_both(self, client, auth_headers):
        profile = _insert_profile("Carol")
        earlier = _give_earlier_result(client, auth_headers, profile)
        tid, ids = _play_mexicano(client, auth_headers)

        _link(client, auth_headers, profile, tid, ids["Carol"])
        body = _link(client, auth_headers, profile, tid, ids["Dave"])

        assert body["unlinked_player_ids"] == [ids["Carol"]]
        assert _elo_before(tid, ids["Carol"]) == 1000
        assert _elo_before(tid, ids["Dave"]) == earlier[0]
        assert _profile_elo(profile)[0] == get_tournament_elos(tid, "padel")[ids["Dave"]]


class TestSelfUnlinkRecalculatesElo:
    def test_player_hub_unlink_rebuilds_profile(self, client, auth_headers):
        profile = _insert_profile("Dave")
        earlier = _give_earlier_result(client, auth_headers, profile)
        tid, ids = _play_mexicano(client, auth_headers)
        baseline = get_tournament_elos(tid, "padel")
        _link(client, auth_headers, profile, tid, ids["Dave"])

        r = client.request(
            "DELETE",
            "/api/player-profile/unlink",
            json={"entity_type": "tournament", "entity_id": tid},
            headers={"Authorization": f"Bearer {create_profile_token(profile)}"},
        )
        assert r.status_code == 200, r.text
        assert get_tournament_elos(tid, "padel") == baseline
        assert _profile_elo(profile) == earlier


class TestFlushReplaysOnlyItsCommunity:
    """A link change replays the community the participation rates in, and only that one."""

    def _count_replays(self, monkeypatch) -> list[str]:
        import backend.api.community_elo as community_elo_mod

        calls: list[str] = []
        real = community_elo_mod.replay_community

        def counting(community_id):
            calls.append(community_id)
            return real(community_id)

        monkeypatch.setattr(community_elo_mod, "replay_community", counting)
        return calls

    def test_link_replays_the_tournament_community_only(self, client, auth_headers, monkeypatch):
        t_other, _ = _play_mexicano(client, auth_headers)
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO communities (id, name, created_by, created_at) VALUES ('c-relink', 'C', 'admin', ?)",
                (datetime.now(timezone.utc).isoformat(),),
            )
        assert (
            client.patch(
                f"/api/tournaments/{t_other}/community", json={"community_id": "c-relink"}, headers=auth_headers
            ).status_code
            == 200
        )
        other_before = get_tournament_elos(t_other, "padel")
        tid, ids = _play_mexicano(client, auth_headers)
        profile = _insert_profile("Alice")
        calls = self._count_replays(monkeypatch)

        _link(client, auth_headers, profile, tid, ids["Alice"])

        assert calls == ["open"]
        assert get_tournament_elos(t_other, "padel") == other_before

    def test_first_link_of_new_profile_changes_no_rating(self, client, auth_headers):
        tid, ids = _play_mexicano(client, auth_headers)
        before = get_tournament_elos(tid, "padel")
        profile = _insert_profile("Carol")

        _link(client, auth_headers, profile, tid, ids["Carol"])

        assert get_tournament_elos(tid, "padel") == before
        assert _profile_elo(profile)[0] == before[ids["Carol"]]
