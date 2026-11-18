"""A team card in a wider scope is the record of the pair; the history ``limit`` of every card."""

from __future__ import annotations

import json
from datetime import timedelta

import pytest

from backend.api import state as state_mod
from backend.api.db import get_db
from backend.api.leaderboard_cache import invalidate_leaderboard_cache
from backend.api.player_card import HISTORY_HARD_CAP
from tests.test_scoped_player_card import (
    BASE,
    _create_open_event,
    _link,
    _link_event_player,
    _profile_headers,
    _seed_profile,
    _seed_tournament,
)

VIEWER = "pp_viewer"
TEAMS = [["Ann", "Bea"], ["Cid", "Dan"], ["Eli", "Fay"], ["Gus", "Hal"]]


@pytest.fixture(autouse=True)
def _fresh_cache():
    invalidate_leaderboard_cache()
    yield
    invalidate_leaderboard_cache()


def _rated(
    conn, tid: str, match_id: str, team1, team2, score, minute: int, sport: str = "padel", delta: float = 10
) -> None:
    payload = json.dumps(
        {
            "match_id": match_id,
            "score": list(score),
            "sets": [],
            "team1": [{"player_id": pid, "player_name": name} for pid, name in team1],
            "team2": [{"player_id": pid, "player_name": name} for pid, name in team2],
            "round_number": 1,
            "round_label": "R1",
        }
    )
    ts = (BASE + timedelta(minutes=minute)).isoformat()
    for pid, _name in team1 + team2:
        conn.execute(
            "INSERT INTO player_elo_log (tournament_id, player_id, sport, elo_before, elo_after,"
            " elo_delta, match_id, match_payload, match_order, updated_at, is_manual)"
            " VALUES (?, ?, ?, 1000, ?, ?, ?, ?, ?, ?, 0)",
            (tid, pid, sport, 1000 + delta, delta, match_id, payload, minute, ts),
        )


def _team_event(client, headers, sport: str = "padel", link_both: bool = True) -> tuple[str, str, list[str]]:
    tid = _create_open_event(client, headers, team_mode=True, teams=TEAMS, sport=sport)
    team_id, member_ids = next(iter(state_mod._tournaments[tid]["tournament"].team_roster.items()))
    _link_event_player(tid, member_ids[0], "pp_ann", "Ann")
    if link_both:
        _link_event_player(tid, member_ids[1], "pp_bea", "Bea")
    return tid, team_id, member_ids


def _seed_history(sport: str = "padel", with_unlisted: bool = True) -> None:
    """Ann and Bea: 3 matches together (2 W, 1 L; one in an unlisted event), 1 against each other, 1 apart."""
    with get_db() as conn:
        for pid, name in (("pp_cid", "Cid"), ("pp_viewer", "Viewer")):
            _seed_profile(conn, pid, name)
        for tid, public in (("p_open", True), ("p_hidden", False), ("p_other", True)):
            if conn.execute("SELECT 1 FROM tournaments WHERE id = ?", (tid,)).fetchone() is None:
                _seed_tournament(conn, tid, "open", None, public=public)
            for who, profile in (("ann", "pp_ann"), ("bea", "pp_bea"), ("cid", "pp_cid")):
                _link(conn, tid, f"{tid}_{who}", profile)
        ann, bea, cid = ("p_open_ann", "Ann"), ("p_open_bea", "Bea"), ("p_open_cid", "Cid")
        x = ("p_open_x", "Xena")
        _rated(conn, "p_open", "m1", [ann, bea], [x, cid], (6, 2), 1, sport, delta=10)
        _rated(conn, "p_open", "m2", [ann, bea], [x, cid], (3, 6), 2, sport, delta=-6)
        # Opposite sides, and one without Bea: not the pair's.
        _rated(conn, "p_open", "m3", [ann, x], [bea, cid], (6, 0), 3, sport)
        _rated(conn, "p_open", "m4", [ann, cid], [bea, x], (6, 0), 4, sport)
        if with_unlisted:
            h = lambda who, name: (f"p_hidden_{who}", name)  # noqa: E731
            _rated(conn, "p_hidden", "m5", [h("ann", "Ann"), h("bea", "Bea")], [h("x", "Xena")], (6, 1), 5, sport)
        # Another sport of the same people never counts in this one.
        other = "tennis" if sport == "padel" else "padel"
        _rated(
            conn,
            "p_other",
            "m6",
            [("p_other_ann", "Ann"), ("p_other_bea", "Bea")],
            [("p_other_x", "Z")],
            (6, 0),
            6,
            other,
        )


def _pair(client, tid: str, team_id: str, scope: str = "all", headers=None, query: str = "") -> dict:
    res = client.get(
        f"/api/tournaments/{tid}/players/{team_id}/card?scope={scope}{query}",
        headers=headers or _profile_headers(VIEWER),
    )
    assert res.status_code == 200, res.text
    return res.json()


class TestPairCard:
    def test_padel_pair_record(self, client, auth_headers) -> None:
        tid, team_id, member_ids = _team_event(client, auth_headers)
        _seed_history()
        card = _pair(client, tid, team_id)
        assert card["is_team"] is True and card["pair"] is True
        assert card["profile_id"] is None
        assert [m["player_id"] for m in card["members"]] == member_ids
        assert [m["has_profile"] for m in card["members"]] == [True, True]
        # Together: m1 W, m2 L, plus the unlisted m5 W (counted, not listed to a stranger).
        (stats,) = card["stats"]
        assert (stats["sport"], stats["matches"], stats["wins"], stats["losses"]) == ("padel", 3, 2, 1)
        assert stats["elo"] is None
        assert card["unlisted_matches"] == 1
        assert card["recent_total"] == 2
        assert [m["outcome"] for m in card["recent_matches"]] == ["L", "W"]  # newest first
        first = card["recent_matches"][1]
        assert first["partners"] == [] and first["opponents"] == ["Xena", "Cid"]
        assert first["opponent_profiles"] == [None, "pp_cid"]
        # The unlisted match is not tallied for a stranger: both opponents of m1 / m2, twice each.
        assert {(o["name"], o["matches"], o["wins"]) for o in card["top_opponents"]} == {("Cid", 2, 1), ("Xena", 2, 1)}
        assert card["top_partners"] == []

    def test_member_ratings_are_their_scoped_elo(self, client, auth_headers) -> None:
        tid, team_id, _ = _team_event(client, auth_headers)
        _seed_history()
        card = _pair(client, tid, team_id)
        ann = client.get("/api/player-cards/pp_ann", headers=_profile_headers(VIEWER)).json()
        bea = client.get("/api/player-cards/pp_bea", headers=_profile_headers(VIEWER)).json()
        assert [m["elo"] for m in card["members"]] == [ann["stats"][0]["elo"], bea["stats"][0]["elo"]]

    def test_unlisted_rows_for_a_member(self, client, auth_headers) -> None:
        tid, team_id, _ = _team_event(client, auth_headers)
        _seed_history()
        card = _pair(client, tid, team_id, headers=_profile_headers("pp_ann"))
        assert card["unlisted_matches"] == 0
        assert card["recent_total"] == 3

    def test_tennis_doubles(self, client, auth_headers) -> None:
        tid, team_id, _ = _team_event(client, auth_headers, sport="tennis")
        _seed_history(sport="tennis")
        card = _pair(client, tid, team_id)
        assert card["sport"] == "tennis"
        (stats,) = card["stats"]
        assert (stats["sport"], stats["matches"]) == ("tennis", 3)

    def test_scope_filtering(self, client, auth_headers) -> None:
        tid, team_id, _ = _team_event(client, auth_headers)
        _seed_history()
        with get_db() as conn:
            # A club event where the pair also played, and a closed-community one.
            res = client.post("/api/communities", json={"name": "Closed"}, headers=auth_headers)
            comm = res.json()["id"]
            res = client.post("/api/clubs", json={"community_id": comm, "name": "Club P"}, headers=auth_headers)
            club = res.json()["id"]
            _seed_tournament(conn, "p_club", comm, club)
            for who, profile in (("ann", "pp_ann"), ("bea", "pp_bea")):
                _link(conn, "p_club", f"p_club_{who}", profile)
            _rated(conn, "p_club", "mc", [("p_club_ann", "Ann"), ("p_club_bea", "Bea")], [("p_club_x", "Q")], (6, 0), 9)
        # "All" counts the club event as well; the open-community one lists only its own matches.
        card = _pair(client, tid, team_id)
        assert card["stats"][0]["matches"] == 4
        assert "Event p_club" in {m["tournament_name"] for m in card["recent_matches"]}
        # A club event of that club widens to the club: only its matches.
        state_mod._tournaments[tid]["club_id"] = club
        state_mod._tournaments[tid]["community_id"] = comm
        with get_db() as conn:
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, 'padel', 1000, 0, 0)",
                (VIEWER, club),
            )
        res = client.get(f"/api/tournaments/{tid}/players/{team_id}/card?scope=club", headers=_profile_headers(VIEWER))
        assert res.status_code == 200, res.text
        club_card = res.json()
        assert club_card["scope"]["kind"] == "club"
        assert club_card["stats"][0]["matches"] == 1
        assert {m["tournament_name"] for m in club_card["recent_matches"]} == {"Event p_club"}

    def test_member_without_profile_has_no_pair(self, client, auth_headers) -> None:
        tid, team_id, _ = _team_event(client, auth_headers, link_both=False)
        _seed_history()
        public = client.get(f"/api/tournaments/{tid}/players/{team_id}/public-card").json()
        assert public["has_profile"] is True
        assert [m["has_profile"] for m in public["members"]] == [True, False]
        card = _pair(client, tid, team_id)
        assert card["is_team"] is True and card["pair"] is False
        assert card["stats"] == [] and card["recent_matches"] == []
        assert [m["has_profile"] for m in card["members"]] == [True, False]

    def test_no_pii(self, client, auth_headers) -> None:
        tid, team_id, _ = _team_event(client, auth_headers)
        _seed_history()
        body = json.dumps(_pair(client, tid, team_id))
        assert "secret-contact" not in body and "@example.com" not in body

    def test_anonymous_is_refused(self, client, auth_headers) -> None:
        tid, team_id, _ = _team_event(client, auth_headers)
        assert client.get(f"/api/tournaments/{tid}/players/{team_id}/card?scope=all").status_code == 401


class TestHistoryLimit:
    def _many(self, n: int) -> None:
        with get_db() as conn:
            _seed_profile(conn, "pp_ann", "Ann")
            _seed_tournament(conn, "lim", "open", None)
            _link(conn, "lim", "lim_ann", "pp_ann")
            for i in range(n):
                _rated(conn, "lim", f"m{i}", [("lim_ann", "Ann")], [("lim_x", "Xena")], (6, 2), i + 1)

    def test_profile_card_default_and_limit(self, client) -> None:
        self._many(30)
        url = "/api/player-cards/pp_ann"
        card = client.get(url, headers=_profile_headers(VIEWER)).json()
        assert len(card["recent_matches"]) == 10 and card["recent_total"] == 30
        assert card["stats"][0]["matches"] == 30
        assert len(client.get(f"{url}?limit=25", headers=_profile_headers(VIEWER)).json()["recent_matches"]) == 25
        everything = client.get(f"{url}?limit={HISTORY_HARD_CAP}", headers=_profile_headers(VIEWER)).json()
        assert len(everything["recent_matches"]) == 30
        # Newest first whatever the limit.
        assert everything["recent_matches"][:10] == card["recent_matches"]

    @pytest.mark.parametrize("bad", ["0", "-1", str(HISTORY_HARD_CAP + 1), "x"])
    def test_limit_is_bounded(self, client, bad) -> None:
        self._many(1)
        assert client.get(f"/api/player-cards/pp_ann?limit={bad}", headers=_profile_headers(VIEWER)).status_code == 422

    def test_event_card_limit_and_stage(self, client, auth_headers) -> None:
        tid = _create_open_event(client, auth_headers)
        pid = next(p.id for p in state_mod._tournaments[tid]["tournament"].players if p.name == "Ann")
        base = f"/api/tournaments/{tid}/players/{pid}/public-card"
        body = client.get(base).json()
        assert body["recent_total"] == len(body["recent_matches"]) == 0
        assert client.get(f"{base}?limit=0").status_code == 422
        assert client.get(f"{base}?stage=bogus").status_code == 422
        assert client.get(f"{base}?limit=25&stage=group").status_code == 200

    def test_event_card_total_survives_the_cut(self, client, auth_headers) -> None:
        tid = _create_open_event(client, auth_headers, team_mode=True, teams=TEAMS)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()["matches"]
        for match in [m for ms in groups.values() for m in ms]:
            res = client.post(
                f"/api/tournaments/{tid}/gp/record-group",
                json={"match_id": match["id"], "score1": 6, "score2": 2},
                headers=auth_headers,
            )
            assert res.status_code == 200, res.text
        pid = next(iter(state_mod._tournaments[tid]["tournament"].team_roster))
        base = f"/api/tournaments/{tid}/players/{pid}/public-card"
        full = client.get(f"{base}?limit=500").json()
        assert full["recent_total"] == len(full["recent_matches"]) == 3
        cut = client.get(f"{base}?limit=2").json()
        assert len(cut["recent_matches"]) == 2 and cut["recent_total"] == 3
        assert cut["matches"] == 3  # the numbers always cover the whole event
        # A stage the player has no matches in (or the only stage they have) filters nothing.
        assert client.get(f"{base}?stage=playoff").json()["recent_total"] == 3
        assert client.get(f"{base}?stage=group").json()["recent_total"] == 3
