"""
Integration tests for the FastAPI REST API.

Uses httpx + FastAPI TestClient to exercise the full request/response cycle.
Fixtures (client, auth_headers, _clean_state) are provided by conftest.py.
"""

from __future__ import annotations

import re

# Captured at module load time, before conftest's autouse fixture replaces
# ``player_secret_store.delete_secrets_for_tournament`` with an in-memory
# no-op for test speed/isolation (see test_player_auth.py for the same
# pattern) — importing this inside a test function would instead capture
# the mock, since the fixture has already run by then.
from backend.api.player_secret_store import delete_secrets_for_tournament as _real_delete_secrets_for_tournament


# ── General ────────────────────────────────────────────────


class TestGeneral:
    def test_homepage_returns_html(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "Torneos" in r.text

    def test_list_tournaments_empty(self, client):
        r = client.get("/api/tournaments")
        assert r.status_code == 200
        assert r.json() == []

    def test_created_tournament_ids_are_unique_short_format(self, client, auth_headers):
        body = {
            "name": "UUID Cup",
            "player_names": ["A", "B", "C", "D"],
            "team_mode": False,
            "court_names": ["Court 1"],
            "num_groups": 1,
            "top_per_group": 1,
            "double_elimination": False,
        }

        first = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        second = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)

        assert first.status_code == 200
        assert second.status_code == 200

        tid1 = first.json()["id"]
        tid2 = second.json()["id"]

        assert tid1 != tid2
        assert re.fullmatch(r"tm_[23456789abcdefghjkmnpqrstuvwxyz]{8}", tid1)
        assert re.fullmatch(r"tm_[23456789abcdefghjkmnpqrstuvwxyz]{8}", tid2)


# ── Group + Play-off API ──────────────────────────────────


class TestGroupPlayoffAPI:
    GP_BODY = {
        "name": "Test Cup",
        "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
        "team_mode": False,
        "court_names": ["Court 1", "Court 2"],
        "num_groups": 2,
        "top_per_group": 2,
        "double_elimination": False,
    }

    def _create(self, client, auth_headers):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def _complete_all_group_rounds(self, client, auth_headers, tid):
        """Record all group matches across all rounds via API."""
        while True:
            groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
            pending = [m for matches in groups["matches"].values() for m in matches if m["status"] != "completed"]
            for m in pending:
                client.post(
                    f"/api/tournaments/{tid}/gp/record-group",
                    json={"match_id": m["id"], "score1": 6, "score2": 3},
                    headers=auth_headers,
                )
            if not groups.get("has_more_rounds", False):
                break
            r = client.post(f"/api/tournaments/{tid}/gp/next-group-round", headers=auth_headers)
            assert r.status_code == 200

    def test_create(self, client, auth_headers):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert data["phase"] == "groups"

    def test_create_team_mode(self, client, auth_headers):
        body = {
            **self.GP_BODY,
            "team_mode": True,
            "player_names": ["A & B", "C & D", "E & F", "G & H"],
            "num_groups": 2,
            "top_per_group": 1,
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200

    def test_create_rejects_duplicate_player_names(self, client, auth_headers):
        body = {
            **self.GP_BODY,
            "player_names": ["A", "A", "B", "C"],
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 422

    def test_appears_in_list(self, client, auth_headers):
        self._create(client, auth_headers)
        r = client.get("/api/tournaments")
        assert len(r.json()) == 1
        assert r.json()[0]["type"] == "group_playoff"

    def test_status(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/gp/status")
        assert r.status_code == 200
        assert r.json()["phase"] == "groups"
        assert r.json()["num_groups"] == 2

    def test_status_includes_courts(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/gp/status")
        assert r.status_code == 200
        courts = r.json()["courts"]
        assert isinstance(courts, list)
        assert len(courts) == 2
        assert courts[0]["name"] == "Court 1"
        assert courts[1]["name"] == "Court 2"

    def test_update_courts(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/gp/courts",
            json={"court_names": ["Alpha", "Beta", "Gamma"]},
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert [c["name"] for c in data["courts"]] == ["Alpha", "Beta", "Gamma"]
        # Confirm status reflects the new courts
        status = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert [c["name"] for c in status["courts"]] == ["Alpha", "Beta", "Gamma"]

    def test_groups_endpoint(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/gp/groups")
        assert r.status_code == 200
        data = r.json()
        assert "standings" in data
        assert "matches" in data

    def test_record_group_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        # Find a match from any group
        match_id = None
        for gname, matches in groups["matches"].items():
            if matches:
                match_id = matches[0]["id"]
                break
        assert match_id is not None

        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={
                "match_id": match_id,
                "score1": 6,
                "score2": 3,
            },
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_record_bad_match_id(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={
                "match_id": "nonexistent",
                "score1": 6,
                "score2": 3,
            },
            headers=auth_headers,
        )
        assert r.status_code in (400, 404)

    def test_start_playoffs_requires_completed_groups(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", headers=auth_headers)
        assert r.status_code == 400  # matches not completed

    def test_full_flow_to_playoffs(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        # Complete all group rounds
        self._complete_all_group_rounds(client, auth_headers, tid)

        # Start playoffs
        r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["phase"] == "playoffs"

        # Check playoff matches exist
        r = client.get(f"/api/tournaments/{tid}/gp/playoffs")
        assert r.status_code == 200
        assert len(r.json()["matches"]) > 0

    def test_playoffs_schema_endpoint_returns_image(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        self._complete_all_group_rounds(client, auth_headers, tid)

        start = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", headers=auth_headers)
        assert start.status_code == 200

        r = client.get(f"/api/tournaments/{tid}/gp/playoffs-schema?fmt=png")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/png")
        assert len(r.content) > 0

    # ── Espejo (Winners bracket + consolation Losers bracket) ──

    def _start_espejo(self, client, auth_headers, *, teams=8, top_per_group=4, num_groups=2, body_extra=None):
        """Create a team-mode GP tournament, finish the groups and start Espejo play-offs."""
        body = {
            **self.GP_BODY,
            "team_mode": True,
            "player_names": [f"T{i} & U{i}" for i in range(teams)],
            "num_groups": num_groups,
            "top_per_group": top_per_group,
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        self._complete_all_group_rounds(client, auth_headers, tid)
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={"espejo": True, **(body_extra or {})},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["phase"] == "playoffs"
        return tid

    def _play_espejo_matches(self, client, auth_headers, tid, side):
        """Record every currently-pending match of *side* (and any it unlocks) until none remain."""
        played = 0
        while True:
            pending = [
                m
                for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
                if m["bracket_side"] == side
            ]
            if not pending:
                return played
            r = client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": pending[0]["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text
            played += 1

    def test_espejo_status_fields_and_bracket_side(self, client, auth_headers):
        tid = self._start_espejo(client, auth_headers)
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["espejo"] is True
        assert st["espejo_super_final"] is False
        assert st["espejo_losers_bracket_seeded"] is False
        assert st["winners_champion"] is None
        assert st["losers_champion"] is None
        po = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()
        assert po["matches"]
        assert {m["bracket_side"] for m in po["matches"]} == {"winners"}

    # ── Espejo Oro / Plata split ──

    def _start_split(self, client, auth_headers, *, teams=12, cutoff=3, body_extra=None, expect=200):
        """Team-mode GP, groups finished, then start the Oro/Plata split (ranks <= cutoff -> Oro)."""
        body = {
            **self.GP_BODY,
            "team_mode": True,
            "player_names": [f"T{i} & U{i}" for i in range(teams)],
            "num_groups": 2,
            "top_per_group": 2,
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        self._complete_all_group_rounds(client, auth_headers, tid)
        rows = client.get(f"/api/tournaments/{tid}/gp/recommend-playoffs").json()["recommended_participants"]
        assert all("group_rank" in row for row in rows)
        payload = {
            "espejo_split": True,
            "oro_player_ids": [x["player_id"] for x in rows if x["group_rank"] <= cutoff],
            "plata_player_ids": [x["player_id"] for x in rows if x["group_rank"] > cutoff],
            **(body_extra or {}),
        }
        r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs", json=payload, headers=auth_headers)
        assert r.status_code == expect, r.text
        return tid, rows

    def test_split_status_and_sides(self, client, auth_headers):
        tid, _ = self._start_split(client, auth_headers)
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["espejo"] is True and st["espejo_split"] is True
        assert st["espejo_losers_bracket_seeded"] is True
        assert st["champion"] is None
        po = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()
        assert {m["bracket_side"] for m in po["pending"]} == {"winners", "losers"}

    def test_regular_espejo_is_not_split(self, client, auth_headers):
        tid = self._start_espejo(client, auth_headers)
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["espejo_split"] is False

    def test_split_schema_both_sides_available_immediately(self, client, auth_headers):
        tid, _ = self._start_split(client, auth_headers)
        base = f"/api/tournaments/{tid}/gp/playoffs-schema?fmt=png"
        gold = client.get(f"{base}&side=winners")
        silver = client.get(f"{base}&side=losers")
        assert gold.status_code == 200 and silver.status_code == 200
        assert gold.content != silver.content

    def test_split_finishes_only_after_both_sides(self, client, auth_headers):
        tid, _ = self._start_split(client, auth_headers)
        self._play_espejo_matches(client, auth_headers, tid, "winners")
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["winners_champion"] is not None
        assert st["phase"] == "playoffs" and st["champion"] is None
        self._play_espejo_matches(client, auth_headers, tid, "losers")
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["phase"] == "finished"
        assert st["champion"] == st["winners_champion"]
        assert st["losers_champion"] not in (None, st["champion"])

    def test_split_plata_third_place(self, client, auth_headers):
        tid, _ = self._start_split(client, auth_headers, body_extra={"third_place": True, "plata_third_place": True})
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["third_place"] is True and st["plata_third_place"] is True
        assert st["plata_third_place_team"] is None
        self._play_espejo_matches(client, auth_headers, tid, "winners")
        self._play_espejo_matches(client, auth_headers, tid, "losers")
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["phase"] == "finished"
        assert st["plata_third_place_team"]
        po = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()
        assert po["plata_third_place"] is True
        labels = [(m["bracket_side"], m["round_label"]) for m in po["matches"]]
        assert sum(1 for side, lab in labels if side == "losers" and "3rd" in lab) == 1

    def test_split_external_participants(self, client, auth_headers):
        tid, _ = self._start_split(
            client,
            auth_headers,
            body_extra={
                "oro_extra_participants": [{"name": "Guest Gold", "score": 3}],
                "plata_extra_participants": [{"name": "Guest Silver", "score": 0}],
            },
        )
        po = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()
        side_of = {}
        for m in po["matches"]:
            for name in (*m["team1"], *m["team2"]):
                side_of[name] = m["bracket_side"]
        assert side_of["Guest Gold"] == "winners"
        assert side_of["Guest Silver"] == "losers"

    def test_split_rejects_shared_extra_participants(self, client, auth_headers):
        tid, rows = self._start_split(client, auth_headers, cutoff=6, expect=400)
        ids = [x["player_id"] for x in rows]
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={
                "espejo_split": True,
                "oro_player_ids": ids[:4],
                "plata_player_ids": ids[4:8],
                "extra_participants": [{"name": "Guest", "score": 0}],
            },
            headers=auth_headers,
        )
        assert r.status_code == 422
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={"plata_extra_participants": [{"name": "Guest", "score": 0}]},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_plata_fields_absent_for_normal_gp(self, client, auth_headers):
        tid = self._start_espejo(client, auth_headers)
        assert "plata_third_place" not in client.get(f"/api/tournaments/{tid}/gp/status").json()

    def test_split_rejections(self, client, auth_headers):
        # Bucket with one entry -> 400.
        tid, rows = self._start_split(client, auth_headers, cutoff=6, expect=400)
        # Overlap -> 400.
        ids = [x["player_id"] for x in rows]
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={"espejo_split": True, "oro_player_ids": ids[:4], "plata_player_ids": ids[3:8]},
            headers=auth_headers,
        )
        assert r.status_code == 400
        # Unknown id -> 400.
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={"espejo_split": True, "oro_player_ids": ["x", "y"], "plata_player_ids": ids[:3]},
            headers=auth_headers,
        )
        assert r.status_code == 400
        # advancing_player_ids together with the split -> 422; split fields without the flag -> 422.
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={"espejo_split": True, "advancing_player_ids": ids[:4], "oro_player_ids": ids[:2]},
            headers=auth_headers,
        )
        assert r.status_code == 422
        r = client.post(
            f"/api/tournaments/{tid}/gp/start-playoffs",
            json={"oro_player_ids": ids[:2]},
            headers=auth_headers,
        )
        assert r.status_code == 422
        # Double elimination / several winners -> 400; tournament is still in the group phase.
        for extra in ({"double_elimination": True}, {"num_winners": 2}):
            r = client.post(
                f"/api/tournaments/{tid}/gp/start-playoffs",
                json={"espejo_split": True, "oro_player_ids": ids[:3], "plata_player_ids": ids[6:9], **extra},
                headers=auth_headers,
            )
            assert r.status_code == 400
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["phase"] == "groups"

    def test_non_espejo_status_and_matches_have_no_espejo_data(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        self._complete_all_group_rounds(client, auth_headers, tid)
        client.post(f"/api/tournaments/{tid}/gp/start-playoffs", headers=auth_headers)
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["espejo"] is False
        assert st["espejo_losers_bracket_seeded"] is False
        assert st["winners_champion"] is None
        po = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()
        assert all("bracket_side" not in m for m in po["matches"])

    def test_espejo_schema_sides(self, client, auth_headers):
        tid = self._start_espejo(client, auth_headers)
        base = f"/api/tournaments/{tid}/gp/playoffs-schema?fmt=png"
        for url in (base, f"{base}&side=winners"):
            r = client.get(url)
            assert r.status_code == 200, r.text
            assert r.headers["content-type"].startswith("image/png")
        # LB is not seeded until every Winners Round-1 match is done.
        assert client.get(f"{base}&side=losers").status_code == 425

        # Play only Round 1 of the Winners bracket.
        r1 = [m for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]]
        for m in r1:
            assert m["round_label"] == "Quarter-Final"
            client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
        losers = client.get(f"{base}&side=losers")
        assert losers.status_code == 200
        winners = client.get(f"{base}&side=winners")
        assert losers.content != winners.content
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["espejo_losers_bracket_seeded"] is True

    def test_espejo_tags_losers_matches_separately(self, client, auth_headers):
        tid = self._start_espejo(client, auth_headers)
        for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]:
            client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
        matches = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["matches"]
        by_side = {s: {m["round_label"] for m in matches if m["bracket_side"] == s} for s in ("winners", "losers")}
        assert by_side["winners"] and by_side["losers"]
        # Both brackets have a "Semi-Final" -> only the side tag tells them apart.
        assert "Semi-Final" in by_side["winners"] and "Semi-Final" in by_side["losers"]

    def test_espejo_finishes_only_when_both_brackets_done(self, client, auth_headers, monkeypatch):
        import backend.api.routes_gp as gp_mod

        finished_calls: list[str] = []
        champion_pushes: list[list[str]] = []
        monkeypatch.setattr(gp_mod, "elo_finish_tournament", lambda tid: finished_calls.append(tid))
        monkeypatch.setattr(gp_mod, "notify_champion", lambda tid, data, names: champion_pushes.append(names))

        tid = self._start_espejo(client, auth_headers)
        status = f"/api/tournaments/{tid}/gp/status"

        # Play the whole Winners bracket first; the LB is seeded after Round 1.
        r1 = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
        for m in r1:
            client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
        self._play_espejo_matches(client, auth_headers, tid, "winners")

        st = client.get(status).json()
        assert st["winners_champion"] is not None
        assert st["losers_champion"] is None
        # LB matches remain -> not finished, no ELO transfer, no champion push.
        assert st["phase"] == "playoffs"
        assert st["champion"] is None
        assert finished_calls == []
        assert champion_pushes == []
        assert any(
            m["bracket_side"] == "losers" for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
        )

        # Finish the consolation bracket.
        assert self._play_espejo_matches(client, auth_headers, tid, "losers") > 0
        st = client.get(status).json()
        assert st["phase"] == "finished"
        assert st["champion"] == st["winners_champion"]
        assert st["losers_champion"] is not None
        assert st["losers_champion"] != st["champion"]
        assert finished_calls == [tid]
        assert len(champion_pushes) == 1
        assert champion_pushes[0] == st["winners_champion"]

    def test_espejo_finishes_when_lb_done_before_wb(self, client, auth_headers):
        tid = self._start_espejo(client, auth_headers)
        for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]:
            client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
        self._play_espejo_matches(client, auth_headers, tid, "losers")
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["losers_champion"] is not None
        assert st["phase"] == "playoffs"
        self._play_espejo_matches(client, auth_headers, tid, "winners")
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["phase"] == "finished"

    def test_espejo_tennis_scoring_reaches_losers_matches(self, client, auth_headers):
        """The tennis endpoint routes LB matches by id too."""
        tid = self._start_espejo(client, auth_headers, teams=8, top_per_group=2)
        for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]:
            r = client.post(
                f"/api/tournaments/{tid}/gp/record-playoff-tennis",
                json={"match_id": m["id"], "sets": [[6, 3], [6, 4]]},
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text
        lb = [
            m
            for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
            if m["bracket_side"] == "losers"
        ]
        assert len(lb) == 1
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-playoff-tennis",
            json={"match_id": lb[0]["id"], "sets": [[6, 3], [6, 4]]},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text

    def test_espejo_two_teams_finishes_with_winners_final(self, client, auth_headers):
        """Fewer than two played R1 losers -> no LB; the tournament still finishes."""
        tid = self._start_espejo(client, auth_headers, teams=4, top_per_group=1)
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["phase"] == "playoffs"
        self._play_espejo_matches(client, auth_headers, tid, "winners")
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["espejo_losers_bracket_seeded"] is False
        assert st["phase"] == "finished"
        assert st["champion"] == st["winners_champion"]
        assert st["losers_champion"] is None

    def test_espejo_three_teams_finishes_with_winners_final(self, client, auth_headers):
        """3 teams: one real R1 match -> one loser -> no LB; must not get stuck."""
        tid = self._start_espejo(client, auth_headers, teams=4, top_per_group=3, num_groups=1)
        self._play_espejo_matches(client, auth_headers, tid, "winners")
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["espejo_losers_bracket_seeded"] is False
        assert st["phase"] == "finished"
        assert st["champion"] == st["winners_champion"]

    def test_espejo_ignores_deprecated_super_final_flag(self, client, auth_headers):
        tid = self._start_espejo(client, auth_headers, body_extra={"espejo_super_final": True})
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["espejo_super_final"] is False
        for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]:
            client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
        self._play_espejo_matches(client, auth_headers, tid, "winners")
        self._play_espejo_matches(client, auth_headers, tid, "losers")
        matches = client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["matches"]
        assert "super_final" not in {m["bracket_side"] for m in matches}
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["phase"] == "finished"

    def test_espejo_legacy_super_final_tournament_still_completes(self, client, auth_headers):
        """A tournament persisted with a Super Final keeps working and exposes it."""
        import backend.api.state as state_mod

        tid = self._start_espejo(client, auth_headers, teams=8, top_per_group=2)
        # Simulate a pre-removal tournament by flipping the persisted flag.
        state_mod._tournaments[tid]["tournament"].playoff_bracket.super_final_enabled = True
        assert client.get(f"/api/tournaments/{tid}/gp/status").json()["espejo_super_final"] is True
        for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]:
            client.post(
                f"/api/tournaments/{tid}/gp/record-playoff",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
        self._play_espejo_matches(client, auth_headers, tid, "winners")
        self._play_espejo_matches(client, auth_headers, tid, "losers")
        # Both champions are known and the Super Final is waiting.
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["phase"] == "playoffs"
        sf = [
            m
            for m in client.get(f"/api/tournaments/{tid}/gp/playoffs").json()["pending"]
            if m["bracket_side"] == "super_final"
        ]
        assert len(sf) == 1
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-playoff",
            json={"match_id": sf[0]["id"], "score1": 3, "score2": 6},
            headers=auth_headers,
        )
        assert r.status_code == 200
        st = client.get(f"/api/tournaments/{tid}/gp/status").json()
        assert st["phase"] == "finished"
        assert st["champion"] == st["losers_champion"]  # legacy: Super Final winner

    def test_delete_tournament(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.delete(f"/api/tournaments/{tid}", headers=auth_headers)
        assert r.status_code == 200
        assert client.get("/api/tournaments").json() == []

    def test_delete_nonexistent(self, client, auth_headers):
        r = client.delete("/api/tournaments/fake", headers=auth_headers)
        assert r.status_code == 404

    def test_ghost_profiles_listing_and_purge(self, client, auth_headers):
        """Deleting with ?purge_ghosts=true removes ghost profiles linked to the tournament."""
        import uuid
        from datetime import datetime, timezone

        import backend.api.db as db_mod

        tid = self._create(client, auth_headers)

        ghost_id = str(uuid.uuid4())
        real_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
                " VALUES (?, ?, ?, '', '', ?, 1)",
                (ghost_id, f"pp-{uuid.uuid4().hex[:12]}", "Ghosty McGhost", now),
            )
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
                " VALUES (?, ?, ?, '', '', ?, 0)",
                (real_id, f"pp-{uuid.uuid4().hex[:12]}", "Real Player", now),
            )
            for pid, pname, profile_id in (
                ("p-ghost", "Ghosty McGhost", ghost_id),
                ("p-real", "Real Player", real_id),
            ):
                conn.execute(
                    """INSERT INTO player_secrets
                       (tournament_id, player_id, player_name, passphrase, token, contact, email, profile_id)
                       VALUES (?, ?, ?, ?, ?, '', '', ?)""",
                    (tid, pid, pname, f"ps-{uuid.uuid4().hex[:8]}", uuid.uuid4().hex, profile_id),
                )

        # Listing endpoint reports only the ghost.
        r = client.get(f"/api/tournaments/{tid}/ghost-profiles", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 1
        assert body["profiles"][0]["id"] == ghost_id
        assert body["profiles"][0]["name"] == "Ghosty McGhost"

        # Without purge_ghosts the ghost profile row survives.
        # Re-create a separate tournament to test the default branch.
        tid2 = self._create(client, auth_headers)
        r = client.delete(f"/api/tournaments/{tid2}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["ghosts_purged"] == 0
        with db_mod.get_db() as conn:
            assert conn.execute("SELECT 1 FROM player_profiles WHERE id = ?", (ghost_id,)).fetchone() is not None

        # With purge_ghosts the ghost is gone, the real profile remains.
        r = client.delete(f"/api/tournaments/{tid}?purge_ghosts=true", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["ghosts_purged"] == 1
        with db_mod.get_db() as conn:
            assert conn.execute("SELECT 1 FROM player_profiles WHERE id = ?", (ghost_id,)).fetchone() is None
            assert conn.execute("SELECT 1 FROM player_profiles WHERE id = ?", (real_id,)).fetchone() is not None

    def test_delete_tournament_snapshots_history_for_every_participant(self, client, auth_headers, monkeypatch):
        """Deleting a tournament outright must not silently drop history.

        ``delete_secrets_for_tournament`` has to run *before* the tournament
        row (and its player_secrets) are wiped, or its own query against
        ``player_secrets`` sees nothing and no history is written at all —
        for linked or unlinked participants alike.

        conftest's autouse fixture replaces ``routes_crud.delete_secrets_for_tournament``
        with an in-memory no-op for test speed/isolation; swap in the real
        implementation (captured at module load time, before the fixture
        mocks it) for this test so the endpoint's call ordering is actually
        exercised end-to-end.
        """
        import uuid

        import backend.api.db as db_mod
        import backend.api.routes_crud as crud_mod

        monkeypatch.setattr(crud_mod, "delete_secrets_for_tournament", _real_delete_secrets_for_tournament)

        tid = self._create(client, auth_headers)
        with db_mod.get_db() as conn:
            conn.execute(
                """INSERT INTO player_secrets
                   (tournament_id, player_id, player_name, passphrase, token, contact, email, profile_id)
                   VALUES (?, 'p-linked-del', 'Linked Del', ?, ?, '', '', 'profile-del')""",
                (tid, f"ps-{uuid.uuid4().hex[:8]}", uuid.uuid4().hex),
            )
            conn.execute(
                """INSERT INTO player_secrets
                   (tournament_id, player_id, player_name, passphrase, token, contact, email, profile_id)
                   VALUES (?, 'p-unlinked-del', 'Unlinked Del', ?, ?, '', '', NULL)""",
                (tid, f"ps-{uuid.uuid4().hex[:8]}", uuid.uuid4().hex),
            )

        r = client.delete(f"/api/tournaments/{tid}", headers=auth_headers)
        assert r.status_code == 200

        with db_mod.get_db() as conn:
            linked_hist = conn.execute(
                "SELECT profile_id FROM player_history WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
                (tid, "p-linked-del"),
            ).fetchone()
            unlinked_hist = conn.execute(
                "SELECT profile_id FROM player_history WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
                (tid, "p-unlinked-del"),
            ).fetchone()
            assert linked_hist is not None
            assert linked_hist["profile_id"] == "profile-del"
            assert unlinked_hist is not None
            assert unlinked_hist["profile_id"] is None


# ── Mexicano API ──────────────────────────────────────────


class TestMexicanoAPI:
    MEX_BODY = {
        "name": "Mex Night",
        "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
        "court_names": ["Court 1", "Court 2"],
        "total_points_per_match": 32,
        "num_rounds": 3,
    }

    def _create(self, client, auth_headers):
        r = client.post("/api/tournaments/mexicano", json=self.MEX_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_create(self, client, auth_headers):
        r = client.post("/api/tournaments/mexicano", json=self.MEX_BODY, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["current_round"] == 0

    def test_bad_player_count_too_few(self, client, auth_headers):
        body = {**self.MEX_BODY, "player_names": ["A", "B", "C"]}
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 422

    def test_non_div4_player_count_ok(self, client, auth_headers):
        body = {**self.MEX_BODY, "player_names": ["A", "B", "C", "D", "E"]}
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200

    def test_create_rejects_duplicate_player_names(self, client, auth_headers):
        body = {**self.MEX_BODY, "player_names": ["A", "A", "B", "C"]}
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 422

    def test_playoffs_schema_double_elim_splits_by_side(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        for m in client.get(f"/api/tournaments/{tid}/mex/matches").json()["current_matches"]:
            client.post(
                f"/api/tournaments/{tid}/mex/record",
                json={"match_id": m["id"], "score1": 20, "score2": 12},
                headers=auth_headers,
            )
        assert client.post(f"/api/tournaments/{tid}/mex/end", headers=auth_headers).status_code == 200
        r = client.post(
            f"/api/tournaments/{tid}/mex/start-playoffs",
            json={"n_teams": 8, "double_elimination": True},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        base = f"/api/tournaments/{tid}/mex/playoffs-schema?fmt=png"
        combined = client.get(base)
        assert combined.headers.get("etag")
        winners = client.get(f"{base}&side=winners").content
        losers = client.get(f"{base}&side=losers").content
        assert len({combined.content, winners, losers}) == 3

    def test_status_shows_leaderboard(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/mex/status")
        assert r.status_code == 200
        data = r.json()
        assert data["current_round"] == 0
        assert len(data["leaderboard"]) == 8

    def test_matches_endpoint(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/mex/matches")
        assert r.status_code == 200
        data = r.json()
        assert len(data["current_matches"]) == 0

    def test_record_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        m = matches["current_matches"][0]
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={
                "match_id": m["id"],
                "score1": 20,
                "score2": 12,
            },
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_record_bad_sum(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        m = matches["current_matches"][0]
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={
                "match_id": m["id"],
                "score1": 20,
                "score2": 10,
            },
            headers=auth_headers,
        )
        assert r.status_code == 400

    def test_next_round_requires_completed(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        # Generate round 1 — no pending matches yet, must succeed
        r = client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        assert r.status_code == 200
        # Round 1 is now pending; generating round 2 must fail
        r = client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        assert r.status_code == 400  # pending matches

    def test_full_mexicano_flow(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        # Generate round 1 via the same mechanism used for all subsequent rounds
        r = client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        assert r.status_code == 200

        for rnd in range(3):
            # Get current matches
            matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
            for m in matches["current_matches"]:
                if m["status"] != "completed":
                    client.post(
                        f"/api/tournaments/{tid}/mex/record",
                        json={
                            "match_id": m["id"],
                            "score1": 18,
                            "score2": 14,
                        },
                        headers=auth_headers,
                    )

            status = client.get(f"/api/tournaments/{tid}/mex/status").json()
            if rnd < 2:
                r = client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
                assert r.status_code == 200

        # Verify final leaderboard
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        assert status["is_finished"]
        assert status["leaderboard"][0]["total_points"] > 0

    def test_skill_gap_accepted(self, client, auth_headers):
        body = {**self.MEX_BODY, "skill_gap": 50}
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200

    def test_invalid_skill_gap_rejected(self, client, auth_headers):
        body = {**self.MEX_BODY, "skill_gap": -1}
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 422

    def test_team_mode_creates_1v1_matches(self, client, auth_headers):
        body = {
            "name": "Team Mex",
            "player_names": ["Alice & Bob", "Carlos & Diana", "Eve & Frank", "Gina & Hugo"],
            "court_names": ["Court 1", "Court 2"],
            "total_points_per_match": 32,
            "num_rounds": 2,
            "team_mode": True,
        }
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]

        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        assert status["team_mode"] is True

        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        for m in matches["current_matches"]:
            assert len(m["team1"]) == 1
            assert len(m["team2"]) == 1

    def test_team_mode_3_players_ok_with_sitout(self, client, auth_headers):
        """3 teams → 1 sit-out per round, 1 match."""
        body = {
            "name": "Odd Teams",
            "player_names": ["A & B", "C & D", "E & F"],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "num_rounds": 2,
            "team_mode": True,
        }
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200

    def test_nonexistent_tournament(self, client):
        r = client.get("/api/tournaments/fake/mex/status")
        assert r.status_code == 404

    def test_patch_settings_updates_values(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        payload = {
            "num_rounds": 5,
            "skill_gap": 40,
            "win_bonus": 3,
            "strength_weight": 0.5,
            "loss_discount": 0.8,
            "balance_tolerance": 0.3,
            "teammate_repeat_weight": 1.5,
            "opponent_repeat_weight": 0.5,
            "repeat_decay": 0.25,
        }
        r = client.patch(f"/api/tournaments/{tid}/mex/settings", json=payload, headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["num_rounds"] == 5
        assert data["skill_gap"] == 40
        assert data["win_bonus"] == 3
        assert data["strength_weight"] == 0.5
        assert data["loss_discount"] == 0.8

    def test_patch_settings_clears_skill_gap(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        payload = {
            "num_rounds": 3,
            "skill_gap": None,
            "win_bonus": 0,
            "strength_weight": 0.0,
            "loss_discount": 1.0,
            "balance_tolerance": 0.2,
            "teammate_repeat_weight": 2.0,
            "opponent_repeat_weight": 1.0,
            "repeat_decay": 0.5,
        }
        r = client.patch(f"/api/tournaments/{tid}/mex/settings", json=payload, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["skill_gap"] is None

    def test_patch_settings_persisted_in_status(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        payload = {
            "num_rounds": 10,
            "skill_gap": None,
            "win_bonus": 5,
            "strength_weight": 0.2,
            "loss_discount": 0.9,
            "balance_tolerance": 0.1,
            "teammate_repeat_weight": 3.0,
            "opponent_repeat_weight": 2.0,
            "repeat_decay": 1.0,
        }
        client.patch(f"/api/tournaments/{tid}/mex/settings", json=payload, headers=auth_headers)
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        assert status["num_rounds"] == 10
        assert status["win_bonus"] == 5
        assert status["loss_discount"] == 0.9

    def test_patch_settings_requires_auth(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        payload = {
            "num_rounds": 3,
            "skill_gap": None,
            "win_bonus": 0,
            "strength_weight": 0.0,
            "loss_discount": 1.0,
            "balance_tolerance": 0.2,
            "teammate_repeat_weight": 2.0,
            "opponent_repeat_weight": 1.0,
            "repeat_decay": 0.5,
        }
        r = client.patch(f"/api/tournaments/{tid}/mex/settings", json=payload)
        assert r.status_code == 401

    def test_patch_settings_rejects_invalid_values(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        payload = {
            "num_rounds": 3,
            "skill_gap": None,
            "win_bonus": -1,
            "strength_weight": 0.0,
            "loss_discount": 1.0,
            "balance_tolerance": 0.2,
            "teammate_repeat_weight": 2.0,
            "opponent_repeat_weight": 1.0,
            "repeat_decay": 0.5,
        }
        r = client.patch(f"/api/tournaments/{tid}/mex/settings", json=payload, headers=auth_headers)
        assert r.status_code == 422


# ── Standalone Play-off API ───────────────────────────────


class TestPlayoffAPI:
    PO_BODY = {
        "name": "Quick Play-off",
        "participant_names": ["Alice", "Bob", "Carol", "Dave"],
        "court_names": ["Court 1"],
        "double_elimination": False,
    }

    def _create(self, client, auth_headers):
        r = client.post("/api/tournaments/playoff", json=self.PO_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def _create_espejo(self, client, auth_headers, n=8, **extra):
        body = {
            **self.PO_BODY,
            "participant_names": [f"P{i}" for i in range(n)],
            "team_mode": True,
            "espejo": True,
            **extra,
        }
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def _play_po_side(self, client, auth_headers, tid, side):
        while True:
            pending = [
                m
                for m in client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"]
                if m["bracket_side"] == side
            ]
            if not pending:
                return
            r = client.post(
                f"/api/tournaments/{tid}/po/record",
                json={"match_id": pending[0]["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
            assert r.status_code == 200, r.text

    def test_espejo_finishes_only_when_both_brackets_done(self, client, auth_headers, monkeypatch):
        import backend.api.routes_playoff as po_mod

        finished: list[str] = []
        pushes: list[list[str]] = []
        monkeypatch.setattr(po_mod, "elo_finish_tournament", lambda tid: finished.append(tid))
        monkeypatch.setattr(po_mod, "notify_champion", lambda tid, data, names: pushes.append(names))

        tid = self._create_espejo(client, auth_headers)
        # Round 1 first so the LB is seeded, then the rest of the Winners bracket.
        for m in client.get(f"/api/tournaments/{tid}/po/playoffs").json()["pending"]:
            client.post(
                f"/api/tournaments/{tid}/po/record",
                json={"match_id": m["id"], "score1": 6, "score2": 3},
                headers=auth_headers,
            )
        self._play_po_side(client, auth_headers, tid, "winners")
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["winners_champion"] is not None
        assert st["phase"] == "playoffs"
        assert st["champion"] is None
        assert finished == [] and pushes == []

        self._play_po_side(client, auth_headers, tid, "losers")
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["phase"] == "finished"
        assert st["champion"] == st["winners_champion"]
        assert st["losers_champion"] is not None
        assert finished == [tid]
        assert pushes == [st["winners_champion"]]

    def test_espejo_small_bracket_finishes_without_losers_bracket(self, client, auth_headers):
        tid = self._create_espejo(client, auth_headers, n=3)
        self._play_po_side(client, auth_headers, tid, "winners")
        st = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert st["espejo_losers_bracket_seeded"] is False
        assert st["phase"] == "finished"

    def test_espejo_ignores_deprecated_super_final_flag(self, client, auth_headers):
        tid = self._create_espejo(client, auth_headers, n=4, espejo_super_final=True)
        assert client.get(f"/api/tournaments/{tid}/po/status").json()["espejo_super_final"] is False
        self._play_po_side(client, auth_headers, tid, "winners")
        self._play_po_side(client, auth_headers, tid, "losers")
        matches = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["matches"]
        assert "super_final" not in {m["bracket_side"] for m in matches}
        assert client.get(f"/api/tournaments/{tid}/po/status").json()["phase"] == "finished"

    def test_create(self, client, auth_headers):
        r = client.post("/api/tournaments/playoff", json=self.PO_BODY, headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert data["phase"] == "playoffs"

    def test_create_rejects_padel_individual_mode(self, client, auth_headers):
        body = {
            **self.PO_BODY,
            "sport": "padel",
            "team_mode": False,
        }
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 422

    def test_create_allows_tennis_individual_mode(self, client, auth_headers):
        body = {
            **self.PO_BODY,
            "sport": "tennis",
            "team_mode": False,
        }
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 200

    def test_appears_in_list(self, client, auth_headers):
        self._create(client, auth_headers)
        r = client.get("/api/tournaments")
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 1
        assert items[0]["type"] == "playoff"

    def test_status(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/po/status")
        assert r.status_code == 200
        data = r.json()
        assert data["phase"] == "playoffs"
        assert data["champion"] is None

    def test_playoffs_endpoint(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/po/playoffs")
        assert r.status_code == 200
        data = r.json()
        assert "matches" in data
        assert "pending" in data
        assert len(data["matches"]) > 0

    def test_record_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        playoffs = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
        m = playoffs["pending"][0]
        r = client.post(
            f"/api/tournaments/{tid}/po/record",
            json={"match_id": m["id"], "score1": 6, "score2": 3},
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_full_flow_finds_champion(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        # Keep recording until a champion is found
        for _ in range(20):
            playoffs = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
            pending = [m for m in playoffs.get("pending", []) if m["status"] != "completed"]
            if not pending:
                break
            for m in pending:
                client.post(
                    f"/api/tournaments/{tid}/po/record",
                    json={"match_id": m["id"], "score1": 6, "score2": 3},
                    headers=auth_headers,
                )
        status = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert status["phase"] == "finished"
        assert status["champion"] is not None

    def test_double_elim_losers_bracket_team_wins_grand_final(self, client, auth_headers):
        body = {**self.PO_BODY, "double_elimination": True}
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]

        wb_champ: list[str] | None = None
        for _ in range(30):
            data = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
            if not data["pending"]:
                break
            m = data["pending"][0]
            if m["round_label"] == "Grand Final":
                # The winners-bracket final is the last winners-round match played.
                wb_final = max(
                    (x for x in data["matches"] if x["round_label"].startswith("Winners")),
                    key=lambda x: x["round_number"],
                )
                wb_champ = wb_final["team1"] if wb_final["score"][0] > wb_final["score"][1] else wb_final["team2"]
                # Let the team that is NOT the winners-bracket champion win.
                score = (3, 6) if m["team1"] == wb_champ else (6, 3)
            else:
                score = (6, 3)
            client.post(
                f"/api/tournaments/{tid}/po/record",
                json={"match_id": m["id"], "score1": score[0], "score2": score[1]},
                headers=auth_headers,
            )

        data = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
        labels = [m["round_label"] for m in data["matches"]]
        assert labels.count("Grand Final") == 1
        assert "Grand Final Reset" not in labels
        assert data["pending"] == []
        assert data["champion"] is not None
        assert wb_champ is not None
        assert data["champion"] != wb_champ
        status = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert status["phase"] == "finished"
        assert status["champion"] is not None

    def test_schema_endpoint_returns_image(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/po/playoffs-schema?fmt=png")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/png")
        assert len(r.content) > 0

    def test_schema_double_elim_splits_by_side(self, client, auth_headers):
        r = client.post(
            "/api/tournaments/playoff",
            json={**self.PO_BODY, "double_elimination": True},
            headers=auth_headers,
        )
        tid = r.json()["id"]
        base = f"/api/tournaments/{tid}/po/playoffs-schema?fmt=png"
        combined = client.get(base).content
        winners = client.get(f"{base}&side=winners").content
        losers = client.get(f"{base}&side=losers").content
        assert len({combined, winners, losers}) == 3

    def test_too_few_participants_rejected(self, client, auth_headers):
        body = {**self.PO_BODY, "participant_names": ["Solo"]}
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 422

    def test_create_rejects_duplicate_participant_names(self, client, auth_headers):
        body = {**self.PO_BODY, "participant_names": ["Alice", "Alice", "Bob", "Carol"]}
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 422

    def test_nonexistent_tournament(self, client):
        r = client.get("/api/tournaments/fake/po/status")
        assert r.status_code == 404


# ── Registration Lobby API ────────────────────────────────


class TestRegistrationAPI:
    """Tests for registration lobby CRUD and public listing."""

    def _create_registration(self, client, auth_headers, **overrides):
        body = {"name": "Test Reg", **overrides}
        r = client.post("/api/registrations", json=body, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_create_and_list(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        r = client.get("/api/registrations", headers=auth_headers)
        assert r.status_code == 200
        assert any(reg["id"] == rid for reg in r.json())

    def test_create_returns_short_registration_id_format(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        assert re.fullmatch(r"rg_[23456789abcdefghjkmnpqrstuvwxyz]{8}", rid)

    def test_create_with_listed(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers, listed=True)
        r = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["listed"] is True

    def test_create_defaults_listed_false(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        r = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["listed"] is False

    def test_patch_listed(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        r = client.patch(f"/api/registrations/{rid}", json={"listed": True}, headers=auth_headers)
        assert r.status_code == 200
        r = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert r.json()["listed"] is True

    def test_patch_registration_name_treats_sql_payload_as_plain_text(self, client, auth_headers):
        rid_target = self._create_registration(client, auth_headers, name="Target")
        rid_other = self._create_registration(client, auth_headers, name="Other")

        sql_payload = "x', listed = 1 WHERE id = 'r999' --"
        patch = client.patch(
            f"/api/registrations/{rid_target}",
            json={"name": sql_payload},
            headers=auth_headers,
        )
        assert patch.status_code == 200

        target = client.get(f"/api/registrations/{rid_target}", headers=auth_headers)
        other = client.get(f"/api/registrations/{rid_other}", headers=auth_headers)
        assert target.status_code == 200
        assert other.status_code == 200
        assert target.json()["name"] == sql_payload
        assert other.json()["name"] == "Other"
        assert other.json()["listed"] is False

    def test_public_listing_returns_only_open_listed(self, client, auth_headers):
        # Create 3 registrations: listed+open, unlisted+open, listed+closed
        rid1 = self._create_registration(client, auth_headers, name="Listed Open", listed=True)
        self._create_registration(client, auth_headers, name="Unlisted Open", listed=False)
        rid3 = self._create_registration(client, auth_headers, name="Listed Closed", listed=True)
        client.patch(f"/api/registrations/{rid3}", json={"open": False}, headers=auth_headers)

        r = client.get("/api/registrations/public")
        assert r.status_code == 200
        lobbies = r.json()
        assert len(lobbies) == 1
        assert lobbies[0]["id"] == rid1
        assert lobbies[0]["name"] == "Listed Open"

    def test_public_listing_excludes_converted(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers, name="Will Convert", listed=True)
        # Register 2 players so we can convert
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Bob"})
        # Convert
        client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"], "team_mode": True},
            headers=auth_headers,
        )
        r = client.get("/api/registrations/public")
        assert r.status_code == 200
        assert len(r.json()) == 0

    def test_list_excludes_archived_by_default_and_can_include(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers, name="Archive Me", listed=True)
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Bob"})
        conv = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"], "team_mode": True},
            headers=auth_headers,
        )
        assert conv.status_code == 200
        assert conv.json()["all_assigned"] is True

        # After full conversion the lobby is closed but NOT auto-archived (archiving is manual).
        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert detail["open"] is False
        assert detail["archived"] is False

        # Lobby still appears in the default (non-archived) list while not archived.
        listed_default = client.get("/api/registrations", headers=auth_headers)
        assert listed_default.status_code == 200
        assert any(reg["id"] == rid for reg in listed_default.json())

        # Manually archive the registration — now it should be excluded by default.
        patch_r = client.patch(f"/api/registrations/{rid}", json={"archived": True}, headers=auth_headers)
        assert patch_r.status_code == 200

        listed_after_archive = client.get("/api/registrations", headers=auth_headers)
        assert listed_after_archive.status_code == 200
        assert all(reg["id"] != rid for reg in listed_after_archive.json())

        listed_all = client.get("/api/registrations?include_archived=1", headers=auth_headers)
        assert listed_all.status_code == 200
        archived_reg = next(reg for reg in listed_all.json() if reg["id"] == rid)
        assert archived_reg["archived"] is True

    def test_public_listing_empty(self, client):
        r = client.get("/api/registrations/public")
        assert r.status_code == 200
        assert r.json() == []

    def test_public_endpoint_returns_converted_to_tid(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers, name="Convertible")
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Bob"})
        conv = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"], "team_mode": True},
            headers=auth_headers,
        )
        tid = conv.json()["tournament_id"]

        r = client.get(f"/api/registrations/{rid}/public")
        assert r.status_code == 200
        data = r.json()
        assert data["converted"] is True
        assert data["converted_to_tid"] == tid
        assert data["linked_tournaments"][0]["id"] == tid
        assert data["linked_tournaments"][0]["name"]
        assert data["linked_tournaments"][0]["finished"] is False

    def test_public_endpoint_listed_field(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers, listed=True)
        r = client.get(f"/api/registrations/{rid}/public")
        assert r.status_code == 200
        assert r.json()["listed"] is True

    def test_register_player_and_list(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        r = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        assert r.status_code == 200
        assert r.json()["passphrase"]
        assert r.json()["token"]

        pub = client.get(f"/api/registrations/{rid}/public")
        assert pub.json()["registrant_count"] == 1
        # names-only player list is public; no secrets/answers/emails leak
        [public_entry] = pub.json()["registrants"]
        assert public_entry["player_name"] == "Alice"
        assert set(public_entry.keys()) == {"player_id", "player_name"}

        # admin endpoint still returns full registrant data
        admin = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert admin.json()["registrants"][0]["player_name"] == "Alice"

    def test_register_duplicate_name_rejected(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        r = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        assert r.status_code == 409

    def test_player_login_returns_registration(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        reg = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        passphrase = reg.json()["passphrase"]

        r = client.post(f"/api/registrations/{rid}/player-login", json={"passphrase": passphrase})
        assert r.status_code == 200
        data = r.json()
        assert data["player_name"] == "Alice"
        assert data["passphrase"] == passphrase
        assert "player_id" in data
        assert "registered_at" in data

    def test_player_login_wrong_passphrase_returns_401(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        r = client.post(f"/api/registrations/{rid}/player-login", json={"passphrase": "wrong-pass-word"})
        assert r.status_code == 401

    def test_player_login_passphrase_scoped_to_lobby(self, client, auth_headers):
        """Passphrase from lobby A must not work in lobby B."""
        rid_a = self._create_registration(client, auth_headers, name="Lobby A")
        rid_b = self._create_registration(client, auth_headers, name="Lobby B")
        reg = client.post(f"/api/registrations/{rid_a}/register", json={"player_name": "Alice"})
        passphrase = reg.json()["passphrase"]

        r = client.post(f"/api/registrations/{rid_b}/player-login", json={"passphrase": passphrase})
        assert r.status_code == 401

    def test_player_login_returns_answers(self, client, auth_headers):
        rid = self._create_registration(
            client, auth_headers, questions=[{"key": "q0", "label": "Level", "type": "text", "required": False}]
        )
        reg = client.post(
            f"/api/registrations/{rid}/register", json={"player_name": "Bob", "answers": {"q0": "intermediate"}}
        )
        passphrase = reg.json()["passphrase"]

        r = client.post(f"/api/registrations/{rid}/player-login", json={"passphrase": passphrase})
        assert r.status_code == 200
        assert r.json()["answers"] == {"q0": "intermediate"}

    def test_player_login_nonexistent_lobby_returns_404(self, client):
        r = client.post("/api/registrations/r999/player-login", json={"passphrase": "some-pass-word"})
        assert r.status_code == 404

    def test_player_login_returns_token_field(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        reg = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        passphrase = reg.json()["passphrase"]

        r = client.post(f"/api/registrations/{rid}/player-login", json={"passphrase": passphrase})
        assert r.status_code == 200
        data = r.json()
        assert "token" in data
        assert data["token"]  # non-empty

    def test_player_login_with_token_returns_registration(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        reg = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        reg_data = reg.json()
        token = reg_data["token"]

        r = client.post(f"/api/registrations/{rid}/player-login", json={"token": token})
        assert r.status_code == 200
        data = r.json()
        assert data["player_name"] == "Alice"
        assert data["token"] == token
        assert "passphrase" in data
        assert "player_id" in data

    def test_player_login_with_token_wrong_token_returns_401(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})

        r = client.post(f"/api/registrations/{rid}/player-login", json={"token": "not-a-real-token"})
        assert r.status_code == 401

    def test_player_login_with_token_scoped_to_lobby(self, client, auth_headers):
        rid_a = self._create_registration(client, auth_headers, name="Lobby A")
        rid_b = self._create_registration(client, auth_headers, name="Lobby B")
        reg = client.post(f"/api/registrations/{rid_a}/register", json={"player_name": "Alice"})
        token = reg.json()["token"]

        r = client.post(f"/api/registrations/{rid_b}/player-login", json={"token": token})
        assert r.status_code == 401

    def test_player_login_both_passphrase_and_token_rejected(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        reg = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        passphrase = reg.json()["passphrase"]
        token = reg.json()["token"]

        r = client.post(f"/api/registrations/{rid}/player-login", json={"passphrase": passphrase, "token": token})
        assert r.status_code == 400

    def test_player_login_neither_passphrase_nor_token_rejected(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        r = client.post(f"/api/registrations/{rid}/player-login", json={})
        assert r.status_code == 400

    def test_player_update_answers_with_passphrase(self, client, auth_headers):
        rid = self._create_registration(
            client,
            auth_headers,
            questions=[
                {"key": "q0", "label": "Level", "type": "text", "required": True},
                {"key": "q1", "label": "Side", "type": "text", "required": False},
            ],
        )
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "answers": {"q0": "intermediate"}},
        )
        passphrase = reg.json()["passphrase"]

        upd = client.patch(
            f"/api/registrations/{rid}/player-answers",
            json={"passphrase": passphrase, "answers": {"q0": "advanced", "q1": "right"}},
        )
        assert upd.status_code == 200
        assert upd.json()["answers"] == {"q0": "advanced", "q1": "right"}

        changes = client.get(f"/api/registrations/{rid}/answer-changes", headers=auth_headers)
        assert changes.status_code == 200
        assert len(changes.json()) == 2
        assert changes.json()[0]["changes"] == [
            {
                "question_key": "q0",
                "question_label": "Level",
                "change": "changed",
                "previous_answer": "intermediate",
                "new_answer": "advanced",
            },
            {
                "question_key": "q1",
                "question_label": "Side",
                "change": "added",
                "previous_answer": None,
                "new_answer": "right",
            },
        ]
        listed = client.get("/api/registrations", headers=auth_headers)
        assert listed.json()[0]["latest_answer_change_id"] == changes.json()[0]["id"]

        client.patch(
            f"/api/registrations/{rid}/player-answers",
            json={"passphrase": passphrase, "answers": {"q0": "advanced", "q1": "right"}},
        )
        unchanged = client.get(f"/api/registrations/{rid}/answer-changes", headers=auth_headers)
        assert len(unchanged.json()) == 2

        # public endpoint exposes names only — never answers
        pub = client.get(f"/api/registrations/{rid}/public")
        assert pub.status_code == 200
        [public_entry] = pub.json()["registrants"]
        assert set(public_entry.keys()) == {"player_id", "player_name"}

        # admin endpoint still returns full answers
        admin = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert admin.json()["registrants"][0]["answers"] == {"q0": "advanced", "q1": "right"}

    def test_player_update_answers_requires_required_questions(self, client, auth_headers):
        rid = self._create_registration(
            client,
            auth_headers,
            questions=[{"key": "q0", "label": "Level", "type": "text", "required": True}],
        )
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "answers": {"q0": "beginner"}},
        )
        passphrase = reg.json()["passphrase"]

        upd = client.patch(
            f"/api/registrations/{rid}/player-answers",
            json={"passphrase": passphrase, "answers": {}},
        )
        assert upd.status_code == 400

    def test_player_cancel_registration_with_passphrase(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers)
        reg = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        passphrase = reg.json()["passphrase"]

        cancel = client.post(f"/api/registrations/{rid}/player-cancel", json={"passphrase": passphrase})
        assert cancel.status_code == 200
        assert cancel.json() == {"ok": True}

        pub = client.get(f"/api/registrations/{rid}/public")
        assert pub.status_code == 200
        assert pub.json()["registrant_count"] == 0

    def test_player_self_service_works_via_alias(self, client, auth_headers):
        rid = self._create_registration(
            client,
            auth_headers,
            questions=[{"key": "q0", "label": "Level", "type": "text", "required": False}],
        )
        alias = "self-service-alias"
        set_alias = client.put(
            f"/api/registrations/{rid}/alias",
            json={"alias": alias},
            headers=auth_headers,
        )
        assert set_alias.status_code == 200

        reg = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        passphrase = reg.json()["passphrase"]

        upd = client.patch(
            f"/api/registrations/{alias}/player-answers",
            json={"passphrase": passphrase, "answers": {"q0": "advanced"}},
        )
        assert upd.status_code == 200
        assert upd.json()["answers"] == {"q0": "advanced"}

        cancel = client.post(f"/api/registrations/{alias}/player-cancel", json={"passphrase": passphrase})
        assert cancel.status_code == 200

        pub = client.get(f"/api/registrations/{rid}/public")
        assert pub.status_code == 200
        assert pub.json()["registrant_count"] == 0

    def test_registration_alias_allows_access_to_existing_registrants(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers, name="Alias Lobby")
        created = client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})
        assert created.status_code == 200
        passphrase = created.json()["passphrase"]

        alias = "alias-lobby"
        set_alias = client.put(
            f"/api/registrations/{rid}/alias",
            json={"alias": alias},
            headers=auth_headers,
        )
        assert set_alias.status_code == 200

        public_alias = client.get(f"/api/registrations/{alias}/public")
        assert public_alias.status_code == 200
        assert public_alias.json()["id"] == rid
        assert public_alias.json()["registrant_count"] == 1

        login_alias = client.post(
            f"/api/registrations/{alias}/player-login",
            json={"passphrase": passphrase},
        )
        assert login_alias.status_code == 200
        assert login_alias.json()["player_name"] == "Alice"

    def test_registration_alias_supports_admin_and_public_mutations(self, client, auth_headers):
        rid = self._create_registration(client, auth_headers, name="Alias Mutations")
        alias = "alias-mutations"
        set_alias = client.put(
            f"/api/registrations/{rid}/alias",
            json={"alias": alias},
            headers=auth_headers,
        )
        assert set_alias.status_code == 200

        reg_via_alias = client.post(f"/api/registrations/{alias}/register", json={"player_name": "Bob"})
        assert reg_via_alias.status_code == 200

        admin_update_alias = client.patch(
            f"/api/registrations/{alias}",
            json={"open": False},
            headers=auth_headers,
        )
        assert admin_update_alias.status_code == 200

        admin_get_id = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert admin_get_id.status_code == 200
        assert admin_get_id.json()["open"] is False
        assert len(admin_get_id.json()["registrants"]) == 1

        public_get_alias = client.get(f"/api/registrations/{alias}/public")
        assert public_get_alias.status_code == 200
        assert public_get_alias.json()["registrant_count"] == 1

    def test_clear_answers_for_keys_removes_targeted_answers(self, client, auth_headers):
        """PATCH with clear_answers_for_keys should wipe only the specified answer keys."""
        rid = self._create_registration(
            client,
            auth_headers,
            questions=[
                {"key": "q0", "label": "Level", "type": "text", "required": False},
                {"key": "q1", "label": "Side", "type": "text", "required": False},
            ],
        )
        client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "answers": {"q0": "advanced", "q1": "right"}},
        )
        client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Bob", "answers": {"q0": "beginner", "q1": "left"}},
        )

        r = client.patch(
            f"/api/registrations/{rid}",
            json={"clear_answers_for_keys": ["q0"]},
            headers=auth_headers,
        )
        assert r.status_code == 200

        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert detail.status_code == 200
        registrants = {reg["player_name"]: reg["answers"] for reg in detail.json()["registrants"]}
        assert "q0" not in registrants["Alice"]
        assert "q0" not in registrants["Bob"]
        assert registrants["Alice"].get("q1") == "right"
        assert registrants["Bob"].get("q1") == "left"

    def test_clear_answers_for_keys_ignores_absent_keys(self, client, auth_headers):
        """Clearing a key that was never answered must not raise an error."""
        rid = self._create_registration(
            client,
            auth_headers,
            questions=[{"key": "q0", "label": "Level", "type": "text", "required": False}],
        )
        client.post(f"/api/registrations/{rid}/register", json={"player_name": "Alice"})

        r = client.patch(
            f"/api/registrations/{rid}",
            json={"clear_answers_for_keys": ["q0", "q99"]},
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_multichoice_register_and_retrieve(self, client, auth_headers):
        """Multichoice answers are stored as JSON array strings and returned correctly."""
        rid = self._create_registration(
            client,
            auth_headers,
            questions=[
                {
                    "key": "q0",
                    "label": "Availability",
                    "type": "multichoice",
                    "required": False,
                    "choices": ["Mon", "Wed", "Fri"],
                },
            ],
        )
        import json

        answer = json.dumps(["Mon", "Fri"])
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "answers": {"q0": answer}},
        )
        assert reg.status_code == 200

        admin = client.get(f"/api/registrations/{rid}", headers=auth_headers)
        assert admin.status_code == 200
        alice = admin.json()["registrants"][0]
        assert json.loads(alice["answers"]["q0"]) == ["Mon", "Fri"]

    def test_multichoice_required_rejects_empty(self, client, auth_headers):
        """A required multichoice question rejects registration without an answer."""
        rid = self._create_registration(
            client,
            auth_headers,
            questions=[
                {
                    "key": "q0",
                    "label": "Availability",
                    "type": "multichoice",
                    "required": True,
                    "choices": ["Mon", "Wed"],
                },
            ],
        )
        r = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "answers": {}},
        )
        assert r.status_code == 400

    def test_multichoice_required_rejects_empty_array(self, client, auth_headers):
        """A required multichoice question rejects an empty JSON array."""
        import json

        rid = self._create_registration(
            client,
            auth_headers,
            questions=[
                {
                    "key": "q0",
                    "label": "Availability",
                    "type": "multichoice",
                    "required": True,
                    "choices": ["Mon", "Wed"],
                },
            ],
        )
        r = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "answers": {"q0": json.dumps([])}},
        )
        assert r.status_code == 400

    def test_multichoice_rejects_invalid_choice(self, client, auth_headers):
        """Multichoice answers with values not in the choices list are rejected."""
        import json

        rid = self._create_registration(
            client,
            auth_headers,
            questions=[
                {
                    "key": "q0",
                    "label": "Availability",
                    "type": "multichoice",
                    "required": False,
                    "choices": ["Mon", "Wed"],
                },
            ],
        )
        r = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Alice", "answers": {"q0": json.dumps(["Mon", "Sunday"])}},
        )
        assert r.status_code == 400

    def test_multichoice_player_update_answers(self, client, auth_headers):
        """Player can update multichoice answers via the player-answers endpoint."""
        import json

        rid = self._create_registration(
            client,
            auth_headers,
            questions=[
                {
                    "key": "q0",
                    "label": "Days",
                    "type": "multichoice",
                    "required": False,
                    "choices": ["Mon", "Wed", "Fri"],
                },
            ],
        )
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Bob", "answers": {"q0": json.dumps(["Mon"])}},
        )
        passphrase = reg.json()["passphrase"]

        upd = client.patch(
            f"/api/registrations/{rid}/player-answers",
            json={"passphrase": passphrase, "answers": {"q0": json.dumps(["Wed", "Fri"])}},
        )
        assert upd.status_code == 200
        assert json.loads(upd.json()["answers"]["q0"]) == ["Wed", "Fri"]


# ── Initial Strength in Create Endpoints ──────────────────


class TestCreateWithStrength:
    """Verify the create endpoints accept player_strengths and apply initial seeding."""

    def test_gp_create_with_strengths(self, client, auth_headers):
        body = {
            "name": "Strength GP",
            "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
            "court_names": ["Court 1"],
            "num_groups": 2,
            "player_strengths": {"A": 100, "C": 80},
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        standings = client.get(f"/api/tournaments/{tid}/gp/groups").json()["standings"]
        # Strength-based snake draft: A (100) and C (80) should land in different groups
        group_names = list(standings.keys())
        g1_names = {p["player"] for p in standings[group_names[0]]}
        g2_names = {p["player"] for p in standings[group_names[1]]}
        assert ("A" in g1_names and "C" in g2_names) or ("C" in g1_names and "A" in g2_names)

    def test_mex_create_with_strengths(self, client, auth_headers):
        body = {
            "name": "Strength Mex",
            "player_names": ["A", "B", "C", "D"],
            "court_names": ["Court 1"],
            "player_strengths": {"A": 50, "B": 40, "C": 30, "D": 20},
        }
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        # Leaderboard should reflect initial strengths (estimated_points) before any matches
        board = status["leaderboard"]
        assert board[0]["player"] == "A"
        assert board[-1]["player"] == "D"

    def test_po_create_with_strengths(self, client, auth_headers):
        body = {
            "name": "Strength PO",
            "participant_names": ["Weak", "Mid", "Strong", "Top"],
            "court_names": ["Court 1"],
            "player_strengths": {"Top": 100, "Strong": 75, "Mid": 50, "Weak": 25},
        }
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        matches = client.get(f"/api/tournaments/{tid}/po/playoffs").json()["matches"]
        # Top-seeded (Top) should face lowest-seeded (Weak) in the semi-final
        semis = [m for m in matches if m["round_number"] == 1]
        top_match = [m for m in semis if "Top" in m["team1"] or "Top" in m["team2"]][0]
        opponents = top_match["team1"] + top_match["team2"]
        assert "Weak" in opponents

    def test_create_without_strengths_still_works(self, client, auth_headers):
        body = {
            "name": "No Strength GP",
            "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
            "court_names": ["Court 1"],
            "num_groups": 2,
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200


class TestGroupAssignments:
    """Verify custom group_assignments override auto-distribution."""

    def test_gp_custom_group_assignments(self, client, auth_headers):
        body = {
            "name": "Custom Groups",
            "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
            "court_names": ["Court 1"],
            "num_groups": 2,
            "group_assignments": {
                "X": ["A", "B", "C", "D"],
                "Y": ["E", "F", "G", "H"],
            },
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        standings = client.get(f"/api/tournaments/{tid}/gp/groups").json()["standings"]
        assert "X" in standings and "Y" in standings
        x_names = {p["player"] for p in standings["X"]}
        y_names = {p["player"] for p in standings["Y"]}
        assert x_names == {"A", "B", "C", "D"}
        assert y_names == {"E", "F", "G", "H"}

    def test_gp_custom_groups_with_strengths(self, client, auth_headers):
        """Custom groups should take precedence over strength-based snake draft."""
        body = {
            "name": "Custom Over Strength",
            "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
            "court_names": ["Court 1"],
            "num_groups": 2,
            "player_strengths": {
                "A": 100,
                "B": 95,
                "C": 90,
                "D": 85,
                "E": 80,
                "F": 75,
                "G": 70,
                "H": 65,
            },
            "group_assignments": {
                "G1": ["A", "B", "C", "D"],
                "G2": ["E", "F", "G", "H"],
            },
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        standings = client.get(f"/api/tournaments/{tid}/gp/groups").json()["standings"]
        g1_names = {p["player"] for p in standings["G1"]}
        g2_names = {p["player"] for p in standings["G2"]}
        assert g1_names == {"A", "B", "C", "D"}
        assert g2_names == {"E", "F", "G", "H"}

    def test_gp_without_group_assignments_still_works(self, client, auth_headers):
        body = {
            "name": "Auto Groups",
            "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
            "court_names": ["Court 1"],
            "num_groups": 2,
        }
        r = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        standings = client.get(f"/api/tournaments/{tid}/gp/groups").json()["standings"]
        assert len(standings) == 2
