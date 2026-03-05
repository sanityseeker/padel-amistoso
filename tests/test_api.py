"""
Integration tests for the FastAPI REST API.

Uses httpx + FastAPI TestClient to exercise the full request/response cycle.
Fixtures (client, auth_headers, _clean_state) are provided by conftest.py.
"""

from __future__ import annotations


# ── General ────────────────────────────────────────────────


class TestGeneral:
    def test_homepage_returns_html(self, client):
        r = client.get("/")
        assert r.status_code == 200
        assert "Padel Tournament" in r.text

    def test_list_tournaments_empty(self, client):
        r = client.get("/api/tournaments")
        assert r.status_code == 200
        assert r.json() == []


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
        assert r.status_code == 400

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

    def test_delete_tournament(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.delete(f"/api/tournaments/{tid}", headers=auth_headers)
        assert r.status_code == 200
        assert client.get("/api/tournaments").json() == []

    def test_delete_nonexistent(self, client, auth_headers):
        r = client.delete("/api/tournaments/fake", headers=auth_headers)
        assert r.status_code == 404


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
        assert r.json()["current_round"] == 1

    def test_bad_player_count_too_few(self, client, auth_headers):
        body = {**self.MEX_BODY, "player_names": ["A", "B", "C"]}
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 422

    def test_non_div4_player_count_ok(self, client, auth_headers):
        body = {**self.MEX_BODY, "player_names": ["A", "B", "C", "D", "E"]}
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200

    def test_status_shows_leaderboard(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/mex/status")
        assert r.status_code == 200
        data = r.json()
        assert data["current_round"] == 1
        assert len(data["leaderboard"]) == 8

    def test_matches_endpoint(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/mex/matches")
        assert r.status_code == 200
        data = r.json()
        assert len(data["current_matches"]) == 2

    def test_record_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
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
        r = client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        assert r.status_code == 400  # pending matches

    def test_full_mexicano_flow(self, client, auth_headers):
        tid = self._create(client, auth_headers)

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
