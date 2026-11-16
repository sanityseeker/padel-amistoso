"""Public tournament player card: team cards, stage scoping, walkovers, freshness."""

from __future__ import annotations

import pytest

from backend.api import state as state_mod

NAMES = ["Ann", "Bea", "Cid", "Dan", "Eli", "Fay", "Gus", "Hal"]
TEAMS = [["Ann", "Bea"], ["Cid", "Dan"], ["Eli", "Fay"], ["Gus", "Hal"]]


def _card(client, tid: str, pid: str, expect: int = 200) -> dict:
    res = client.get(f"/api/tournaments/{tid}/players/{pid}/public-card")
    assert res.status_code == expect, res.text
    return res.json()


def _gp_teams(client, headers, top: int = 2) -> str:
    r = client.post(
        "/api/tournaments/group-playoff",
        json={
            "name": "Team Cup",
            "player_names": NAMES,
            "team_mode": True,
            "teams": TEAMS,
            "court_names": ["Court 1"],
            "num_groups": 1,
            "top_per_group": top,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _group_matches(client, tid: str) -> list[dict]:
    return [m for ms in client.get(f"/api/tournaments/{tid}/gp/groups").json()["matches"].values() for m in ms]


def _rec_group(client, headers, tid: str, mid: str, s1: int = 6, s2: int = 2) -> None:
    r = client.post(
        f"/api/tournaments/{tid}/gp/record-group", json={"match_id": mid, "score1": s1, "score2": s2}, headers=headers
    )
    assert r.status_code == 200, r.text


def _standing_rows(client, tid: str) -> dict[str, dict]:
    groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()["standings"]
    return {row["player_id"]: row for rows in groups.values() for row in rows}


def _play_all_groups(client, headers, tid: str) -> None:
    for m in _group_matches(client, tid):
        _rec_group(client, headers, tid, m["id"])


def _play_playoffs(client, headers, tid: str) -> None:
    for _ in range(4):
        pending = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
        if not pending:
            return
        for m in pending:
            r = client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=headers,
            )
            assert r.status_code == 200, r.text


def _team_ids(tid: str) -> list[str]:
    return list(state_mod._tournaments[tid]["tournament"].team_roster)


def _mex_teams(client, headers) -> str:
    r = client.post(
        "/api/tournaments/mexicano",
        json={
            "name": "Mex Teams",
            "player_names": NAMES,
            "team_mode": True,
            "teams": TEAMS,
            "court_names": ["Court 1", "Court 2"],
            "total_points_per_match": 32,
            "num_rounds": 2,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _mex_round(client, headers, tid: str) -> None:
    assert client.post(f"/api/tournaments/{tid}/mex/next-round", headers=headers).status_code == 200
    for m in client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"]:
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=headers,
        )
        assert r.status_code == 200, r.text


def _assert_team_card_matches_row(card: dict, row: dict) -> None:
    assert card["is_team"] is True
    assert card["matches"] == row["played"]
    assert card["wins"] == row["wins"]
    assert card["losses"] == row["losses"]
    assert len(card["recent_matches"]) == row["played"]
    assert all(m["side"] in (1, 2) for m in card["recent_matches"])
    assert len(card["members"]) == 2
    assert "email" not in card


class TestGroupTeamCard:
    def test_team_card_matches_standings_row(self, client, auth_headers) -> None:
        tid = _gp_teams(client, auth_headers)
        _play_all_groups(client, auth_headers, tid)
        rows = _standing_rows(client, tid)
        assert set(rows) == set(_team_ids(tid))
        elos = {
            r["player_id"]: r["elo"]
            for rows_ in client.get(f"/api/tournaments/{tid}/gp/groups").json()["standings"].values()
            for r in rows_
        }
        for team_id, row in rows.items():
            card = _card(client, tid, team_id)
            _assert_team_card_matches_row(card, row)
            assert card["stages"] == ["group"]
            assert card["elo"] == pytest.approx(elos[team_id], abs=0.1)
            member_elos = [m["elo"] for m in card["members"]]
            assert card["elo"] == pytest.approx(sum(member_elos) / 2, abs=0.1)
            assert all(m["name"] for m in card["members"])
            assert card["stats"]["group"]["matches"] == row["played"]
            assert card["stats"]["all"]["elo_delta"] == pytest.approx(
                sum(m["elo_delta"]["all"] for m in card["members"]) / 2, abs=0.11
            )
            rated = [m for m in card["recent_matches"] if m["elo_delta"] is not None]
            assert rated and all(m["walkover"] is False for m in card["recent_matches"])

    def test_same_after_finish_and_recalculate(self, client, auth_headers) -> None:
        tid = _gp_teams(client, auth_headers, top=2)
        _play_all_groups(client, auth_headers, tid)
        assert (
            client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json={}, headers=auth_headers).status_code == 200
        )
        _play_playoffs(client, auth_headers, tid)
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["phase"] == "finished"
        before = {t: _card(client, tid, t) for t in _team_ids(tid)}
        assert client.post(f"/api/tournaments/{tid}/elo/recalculate", headers=auth_headers).status_code == 200
        rows = _standing_rows(client, tid)
        for team_id, row in rows.items():
            card = _card(client, tid, team_id)
            assert card["stats"]["group"]["matches"] == row["played"]
            assert card["stats"]["group"]["wins"] == row["wins"]
            assert card["stats"]["group"]["losses"] == row["losses"]
            assert card["matches"] == before[team_id]["matches"] > 0
            assert card["members"] and card["elo"] is not None

    def test_stage_scoping_with_playoffs(self, client, auth_headers) -> None:
        tid = _gp_teams(client, auth_headers, top=2)
        _play_all_groups(client, auth_headers, tid)
        rows = _standing_rows(client, tid)
        assert (
            client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json={}, headers=auth_headers).status_code == 200
        )
        _play_playoffs(client, auth_headers, tid)
        finalists = [
            t for t in _team_ids(tid) if any(m["stage"] == "playoff" for m in _card(client, tid, t)["recent_matches"])
        ]
        assert len(finalists) == 2
        for team_id in finalists:
            card = _card(client, tid, team_id)
            assert card["stages"] == ["group", "playoff"]
            assert card["stats"]["group"]["matches"] == rows[team_id]["played"]
            assert card["stats"]["playoff"]["matches"] == 1
            assert card["stats"]["all"]["matches"] == rows[team_id]["played"] + 1 == card["matches"]
            assert sum(1 for m in card["recent_matches"] if m["stage"] == "group") == rows[team_id]["played"]
            # Newest first: the play-off match leads.
            assert card["recent_matches"][0]["stage"] == "playoff"
        out = next(t for t in _team_ids(tid) if t not in finalists)
        assert _card(client, tid, out)["stages"] == ["group"]


class TestMexicanoTeamCard:
    def test_team_card_and_playoff_scope(self, client, auth_headers) -> None:
        tid = _mex_teams(client, auth_headers)
        _mex_round(client, auth_headers, tid)
        _mex_round(client, auth_headers, tid)
        board = client.get(f"/api/tournaments/{tid}/mex/status").json()["leaderboard"]
        assert board
        for row in board:
            card = _card(client, tid, row["player_id"])
            assert card["is_team"] is True
            assert card["matches"] == row["matches_played"]
            assert card["stages"] == ["rounds"]
            assert len(card["members"]) == 2
            assert all(m["side"] in (1, 2) for m in card["recent_matches"])
            assert card["elo"] is not None
        assert client.post(f"/api/tournaments/{tid}/mex/end", headers=auth_headers).status_code == 200
        r = client.post(f"/api/tournaments/{tid}/mex/start-playoffs", json={"n_teams": 4}, headers=auth_headers)
        assert r.status_code == 200, r.text
        for m in client.get(f"/api/tournaments/{tid}/mex/playoffs").json()["pending"]:
            client.post(
                f"/api/tournaments/{tid}/mex/record-playoff",
                json={"match_id": m["id"], "score1": 21, "score2": 10},
                headers=auth_headers,
            )
        row = board[0]
        card = _card(client, tid, row["player_id"])
        assert card["stats"]["rounds"]["matches"] == row["matches_played"]
        assert "playoff" in card["stages"]
        assert card["stats"]["all"]["matches"] == row["matches_played"] + card["stats"]["playoff"]["matches"]


class TestWalkoverAndFreshness:
    def test_walkover_is_flagged_without_elo(self, client, auth_headers) -> None:
        tid = _gp_teams(client, auth_headers)
        team_a = _team_ids(tid)[0]
        member = state_mod._tournaments[tid]["tournament"].team_roster[team_a][0]
        mine = [m for m in _group_matches(client, tid) if team_a in m["team1_ids"] + m["team2_ids"]]
        for m in mine[:2]:
            _rec_group(client, auth_headers, tid, m["id"])
        r = client.post(
            f"/api/tournaments/{tid}/withdrawals",
            json={"player_id": member, "expected_kind": "walkover"},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        # The walkover opponent's card lists it, flagged, with no rating change.
        opponent = next(
            t
            for m in _group_matches(client, tid)
            if m.get("walkover")
            for t in m["team1_ids"] + m["team2_ids"]
            if t != team_a
        )
        card = _card(client, tid, opponent)
        wo = [m for m in card["recent_matches"] if m["walkover"]]
        assert len(wo) == 1
        assert wo[0]["elo_delta"] is None and wo[0]["elo_after"] is None
        assert card["stats"]["group"]["walkovers"] == 1
        row = _standing_rows(client, tid)[opponent]
        assert card["matches"] == row["played"]

    def test_card_is_fresh_after_a_new_score(self, client, auth_headers) -> None:
        tid = _gp_teams(client, auth_headers)
        matches = _group_matches(client, tid)
        first = matches[0]
        team = first["team1_ids"][0]
        assert _card(client, tid, team)["matches"] == 0
        _rec_group(client, auth_headers, tid, first["id"])
        card = _card(client, tid, team)
        assert card["matches"] == 1 and card["wins"] == 1

    def test_individual_card_is_unchanged(self, client, auth_headers) -> None:
        r = client.post(
            "/api/tournaments/mexicano",
            json={
                "name": "Solo",
                "player_names": ["Alice", "Bob", "Carol", "Dave"],
                "court_names": ["Court 1"],
                "total_points_per_match": 32,
                "num_rounds": 1,
            },
            headers=auth_headers,
        )
        tid = r.json()["id"]
        _mex_round(client, auth_headers, tid)
        board = client.get(f"/api/tournaments/{tid}/mex/status").json()["leaderboard"]
        for row in board:
            card = _card(client, tid, row["player_id"])
            assert card["is_team"] is False and card["members"] == []
            assert card["matches"] == 1 and card["stages"] == ["rounds"]
            m = card["recent_matches"][0]
            assert m["elo_delta"] is not None and m["elo_after"] is not None
            # Event player ids line up with the names: each name opens that player's card.
            ids = {p["player_id"]: p["player"] for p in board}
            assert [ids[i] for i in m["team1_ids"]] == m["team1"]
            assert [ids[i] for i in m["team2_ids"]] == m["team2"]
            assert card["elo_delta_total"] == pytest.approx(m["elo_delta"], abs=0.1)
            assert card["elo_history"] == [pytest.approx(m["elo_after"], abs=0.1)]

    def test_total_change_ignores_the_order_matches_were_scored(self, client, auth_headers) -> None:
        """Later rounds scored first: the total is still the sum of each match's change."""
        tid = _gp_teams(client, auth_headers)
        matches = _group_matches(client, tid)
        for i, m in enumerate(reversed(matches)):
            _rec_group(client, auth_headers, tid, m["id"], 6, 2 + i % 4)
        for team in _team_ids(tid):
            card = _card(client, tid, team)
            deltas = [m["elo_delta"] for m in card["recent_matches"]]
            assert len(deltas) == 3 and None not in deltas
            assert card["elo_delta_total"] == pytest.approx(sum(deltas), abs=0.15)
            assert card["stats"]["all"]["elo_delta"] == card["elo_delta_total"]
