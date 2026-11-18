"""A recalculation replays a tournament in the order it was played.

Scoring rates matches one at a time, in the order they are scored.  A full
recalculation used to replay them in structural order (groups, then rows) while
keeping the original timestamps, so the stored chain no longer chained in
``updated_at`` order and the club chain was seeded from the middle of it.
"""

from __future__ import annotations

import backend.api.db as db_mod
from backend.api import club_elo
from backend.api.elo_integration import elo_recalculate_tournament
from tests.test_club_elo import (
    _link,
    _make_club,
    _persist_tournaments,  # noqa: F401 — autouse fixture: club ELO reads persisted rows
)
from tests.test_elo_relink import _insert_profile

_BODY = {
    "name": "Replay Cup",
    "player_names": ["Ann", "Bea", "Cid", "Dan"],
    "sport": "tennis",
    "team_mode": True,
    "court_names": ["Court 1"],
    "num_groups": 1,
    "top_per_group": 2,
}


def _create(client, auth_headers, club_id: str) -> str:
    res = client.post("/api/tournaments/group-playoff", json=_BODY, headers=auth_headers)
    assert res.status_code == 200, res.text
    tid = res.json()["id"]
    res = client.patch(f"/api/tournaments/{tid}/club", json={"club_id": club_id}, headers=auth_headers)
    assert res.status_code == 200, res.text
    return tid


def _score_in_reverse(client, auth_headers, tid: str) -> None:
    groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()["matches"]
    matches = [m for ms in groups.values() for m in ms]
    for i, m in enumerate(reversed(matches)):
        res = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": m["id"], "score1": 6 + i % 2, "score2": 2 + i},
            headers=auth_headers,
        )
        assert res.status_code == 200, res.text


def _rows(tid: str) -> list[dict]:
    with db_mod.get_db() as conn:
        rows = conn.execute(
            "SELECT player_id, match_id, match_order, updated_at, elo_before, elo_after,"
            " club_elo_before, club_elo_after FROM player_elo_log"
            " WHERE tournament_id = ? AND is_manual = 0 ORDER BY player_id, updated_at, match_order",
            (tid,),
        ).fetchall()
    return [dict(r) for r in rows]


def _by_player(rows: list[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["player_id"], []).append(r)
    return out


def _assert_chained(rows: list[dict]) -> None:
    for chain in _by_player(rows).values():
        for prev, cur in zip(chain, chain[1:]):
            assert abs(cur["elo_before"] - prev["elo_after"]) < 1e-6
            assert abs(cur["club_elo_before"] - prev["club_elo_after"]) < 1e-6


def test_recalculation_keeps_the_played_order(client, auth_headers):
    _make_club("rp1")
    tid = _create(client, auth_headers, "rp1")
    _score_in_reverse(client, auth_headers, tid)
    before = _rows(tid)
    assert len(before) == 12  # 6 singles matches
    _assert_chained(before)

    elo_recalculate_tournament(tid)

    after = _rows(tid)
    _assert_chained(after)
    assert len(after) == len(before)
    for old, new in zip(before, after):
        assert (old["player_id"], old["match_id"]) == (new["player_id"], new["match_id"])
        for col in ("elo_before", "elo_after", "club_elo_before", "club_elo_after"):
            assert abs(old[col] - new[col]) < 1e-6
    with db_mod.get_db() as conn:
        starts = {
            r["player_id"]: r["elo_before"]
            for r in conn.execute("SELECT * FROM player_elo WHERE tournament_id = ?", (tid,))
        }
    for pid, chain in _by_player(after).items():
        assert chain[0]["club_elo_before"] == starts[pid]


def test_club_seed_uses_the_pre_tournament_rating(client, auth_headers):
    _make_club("rp2")
    tid = _create(client, auth_headers, "rp2")
    _score_in_reverse(client, auth_headers, tid)
    with db_mod.get_db() as conn:
        # Corrupt the main chain's start on every first row, as an old recalculation did.
        first = {}
        for r in conn.execute(
            "SELECT rowid, player_id FROM player_elo_log WHERE tournament_id = ? AND is_manual = 0"
            " ORDER BY updated_at, match_order",
            (tid,),
        ).fetchall():
            first.setdefault(r["player_id"], r["rowid"])
        for rowid in first.values():
            conn.execute("UPDATE player_elo_log SET elo_before = 987.0 WHERE rowid = ?", (rowid,))
    club_elo._replay_club("rp2")
    with db_mod.get_db() as conn:
        starts = {
            r["player_id"]: r["elo_before"]
            for r in conn.execute("SELECT * FROM player_elo WHERE tournament_id = ?", (tid,))
        }
    for pid, chain in _by_player(_rows(tid)).items():
        assert chain[0]["club_elo_before"] == starts[pid]
        assert starts[pid] != 987.0


def test_self_link_replays_club_without_double_counting(client, auth_headers):
    _make_club("rp3")
    ann = _insert_profile("Ann")
    tid = _create(client, auth_headers, "rp3")
    _score_in_reverse(client, auth_headers, tid)
    with db_mod.get_db() as conn:
        pid = conn.execute(
            "SELECT player_id FROM player_elo_log WHERE tournament_id = ? AND is_manual = 0 LIMIT 1", (tid,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token)"
            " VALUES (?, ?, 'Ann', 'pp-self', 'tok-self')",
            (tid, pid),
        )
    _link(client, auth_headers, ann, tid, pid)
    rows = _rows(tid)
    _assert_chained(rows)
    chain = _by_player(rows)[pid]
    with db_mod.get_db() as conn:
        start = conn.execute(
            "SELECT elo_before FROM player_elo WHERE tournament_id = ? AND player_id = ?", (tid, pid)
        ).fetchone()[0]
    assert chain[0]["club_elo_before"] == start
    net = sum(r["club_elo_after"] - r["club_elo_before"] for r in chain)
    assert abs(chain[-1]["club_elo_after"] - start - net) < 1e-6
