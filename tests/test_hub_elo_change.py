"""The Hub rating card's change: every rated match in the scope, manual club ratings left out."""

from __future__ import annotations

from datetime import datetime, timezone

import backend.api.db as db_mod

from tests.test_club_elo import (  # noqa: F401
    _log,
    _new_tournament,
    _persist_tournaments,
    _play_rounds,
    _space,
    _tier,
)
from tests.test_elo_relink import _insert_profile


def _club(club_id: str, community_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, 'admin', ?)",
            (community_id, community_id, now),
        )
        conn.execute(
            "INSERT INTO clubs (id, name, slug, community_id, created_by, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
            (club_id, club_id, club_id, community_id, now),
        )


def _new_t(client, auth_headers, club_id, community_id, profiles):
    import uuid  # noqa: PLC0415

    r = client.post(
        "/api/tournaments/mexicano",
        json={
            "name": f"M {uuid.uuid4().hex[:6]}",
            "player_names": ["Alice", "Bob", "Carol", "Dave"],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "num_rounds": 3,
        },
        headers=auth_headers,
    )
    tid = r.json()["id"]
    res = client.patch(f"/api/tournaments/{tid}/community", json={"community_id": community_id}, headers=auth_headers)
    assert res.status_code == 200, res.text
    res = client.patch(f"/api/tournaments/{tid}/club", json={"club_id": club_id}, headers=auth_headers)
    assert res.status_code == 200, res.text
    players = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
    with db_mod.get_db() as conn:
        conn.executemany(
            "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token) VALUES (?, ?, ?, ?, ?)",
            [(tid, pid, i["name"], i["passphrase"], i["token"]) for pid, i in players.items()],
        )
    ids = {i["name"]: pid for pid, i in players.items()}
    for name, prof in profiles.items():
        r = client.post(f"/api/admin/player-profiles/{prof}/link/{tid}/{ids[name]}", headers=auth_headers)
        assert r.status_code == 200, r.text
    return tid, ids


def _match_change(space: dict, sport: str = "padel") -> float:
    return round(sum(m["elo_delta"] for m in space["elo_history"] if m["sport"] == sport and not m["is_manual"]), 1)


def test_change_sums_matches_and_skips_manual_club_rating(client, auth_headers):
    _club("beg", "com_a")
    _club("bil", "com_b")
    denis = _insert_profile("Denis")
    t_bil, _ = _new_t(client, auth_headers, "bil", "com_b", {"Alice": denis})
    _play_rounds(client, auth_headers, t_bil, "Alice", rounds=2)
    # A tier set between two rounds is a manual club row: a starting value, not a result.
    t_beg, _ = _new_t(client, auth_headers, "beg", "com_a", {"Alice": denis})
    _play_rounds(client, auth_headers, t_beg, "Alice", rounds=1)
    _tier(client, auth_headers, "beg", denis, 1000)
    _play_rounds(client, auth_headers, t_beg, "Alice", rounds=1)

    for query in ("club_id=beg", "club_id=bil", "community_id=com_a", "community_id=com_b"):
        space = _space(client, denis, f"?{query}&elo_history_limit=50")
        assert space["elo_change"]["padel"] == _match_change(space), query
    beg = _space(client, denis, "?club_id=beg&elo_history_limit=50")
    assert any(m["is_manual"] for m in beg["elo_history"])
    assert beg["elo_change"]["padel"] != round(sum(m["elo_delta"] for m in beg["elo_history"]), 1)

    # Replaying the club from its ratings moves the manual row before the first match; still left out.
    r = client.post("/api/clubs/beg/elo/recalculate?from_club_ratings=true", headers=auth_headers)
    assert r.status_code == 200, r.text
    beg = _space(client, denis, "?club_id=beg&elo_history_limit=50")
    assert beg["elo_change"]["padel"] == _match_change(beg)
