"""
Integration tests for the FastAPI REST API.

Uses httpx + FastAPI TestClient to exercise the full request/response cycle.
"""

import pytest
from fastapi.testclient import TestClient

from backend.api import app


@pytest.fixture(autouse=True)
def _clean_state():
    """Reset in-memory state between tests."""
    import backend.api.state as state_mod

    state_mod._tournaments.clear()
    state_mod._counter = 0
    yield
    state_mod._tournaments.clear()
    state_mod._counter = 0


@pytest.fixture
def client():
    return TestClient(app)


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

    def _create(self, client):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY)
        assert r.status_code == 200
        return r.json()["id"]

    def test_create(self, client):
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY)
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert data["phase"] == "groups"

    def test_create_team_mode(self, client):
        body = {
            **self.GP_BODY,
            "team_mode": True,
            "player_names": ["A & B", "C & D", "E & F", "G & H"],
            "num_groups": 2,
            "top_per_group": 1,
        }
        r = client.post("/api/tournaments/group-playoff", json=body)
        assert r.status_code == 200

    def test_appears_in_list(self, client):
        self._create(client)
        r = client.get("/api/tournaments")
        assert len(r.json()) == 1
        assert r.json()[0]["type"] == "group_playoff"

    def test_status(self, client):
        tid = self._create(client)
        r = client.get(f"/api/tournaments/{tid}/gp/status")
        assert r.status_code == 200
        assert r.json()["phase"] == "groups"
        assert r.json()["num_groups"] == 2

    def test_groups_endpoint(self, client):
        tid = self._create(client)
        r = client.get(f"/api/tournaments/{tid}/gp/groups")
        assert r.status_code == 200
        data = r.json()
        assert "standings" in data
        assert "matches" in data

    def test_record_group_score(self, client):
        tid = self._create(client)
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
        )
        assert r.status_code == 200

    def test_record_bad_match_id(self, client):
        tid = self._create(client)
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={
                "match_id": "nonexistent",
                "score1": 6,
                "score2": 3,
            },
        )
        assert r.status_code == 400

    def test_start_playoffs_requires_completed_groups(self, client):
        tid = self._create(client)
        r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs")
        assert r.status_code == 400  # matches not completed

    def test_full_flow_to_playoffs(self, client):
        tid = self._create(client)
        # Complete all group matches
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        for gname, matches in groups["matches"].items():
            for m in matches:
                if m["status"] != "completed":
                    client.post(
                        f"/api/tournaments/{tid}/gp/record-group",
                        json={
                            "match_id": m["id"],
                            "score1": 6,
                            "score2": 3,
                        },
                    )

        # Start playoffs
        r = client.post(f"/api/tournaments/{tid}/gp/start-playoffs")
        assert r.status_code == 200
        assert r.json()["phase"] == "playoffs"

        # Check playoff matches exist
        r = client.get(f"/api/tournaments/{tid}/gp/playoffs")
        assert r.status_code == 200
        assert len(r.json()["matches"]) > 0

    def test_playoffs_schema_endpoint_returns_image(self, client):
        tid = self._create(client)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        for matches in groups["matches"].values():
            for m in matches:
                if m["status"] != "completed":
                    client.post(
                        f"/api/tournaments/{tid}/gp/record-group",
                        json={"match_id": m["id"], "score1": 6, "score2": 3},
                    )

        start = client.post(f"/api/tournaments/{tid}/gp/start-playoffs")
        assert start.status_code == 200

        r = client.get(f"/api/tournaments/{tid}/gp/playoffs-schema?fmt=png")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/png")
        assert len(r.content) > 0

    def test_delete_tournament(self, client):
        tid = self._create(client)
        r = client.delete(f"/api/tournaments/{tid}")
        assert r.status_code == 200
        assert client.get("/api/tournaments").json() == []

    def test_delete_nonexistent(self, client):
        r = client.delete("/api/tournaments/fake")
        assert r.status_code == 404


# ── Mexicano API ──────────────────────────────────────────


class TestMexicanoAPI:
    MEX_BODY = {
        "name": "Mex Night",
        "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
        "court_names": ["Court 1", "Court 2"],
        "total_points_per_match": 32,
        "num_rounds": 3,
        "randomness": 0.1,
    }

    def _create(self, client):
        r = client.post("/api/tournaments/mexicano", json=self.MEX_BODY)
        assert r.status_code == 200
        return r.json()["id"]

    def test_create(self, client):
        r = client.post("/api/tournaments/mexicano", json=self.MEX_BODY)
        assert r.status_code == 200
        assert r.json()["current_round"] == 1

    def test_bad_player_count_too_few(self, client):
        body = {**self.MEX_BODY, "player_names": ["A", "B", "C"]}
        r = client.post("/api/tournaments/mexicano", json=body)
        assert r.status_code == 422

    def test_non_div4_player_count_ok(self, client):
        body = {**self.MEX_BODY, "player_names": ["A", "B", "C", "D", "E"]}
        r = client.post("/api/tournaments/mexicano", json=body)
        assert r.status_code == 200

    def test_status_shows_leaderboard(self, client):
        tid = self._create(client)
        r = client.get(f"/api/tournaments/{tid}/mex/status")
        assert r.status_code == 200
        data = r.json()
        assert data["current_round"] == 1
        assert len(data["leaderboard"]) == 8

    def test_matches_endpoint(self, client):
        tid = self._create(client)
        r = client.get(f"/api/tournaments/{tid}/mex/matches")
        assert r.status_code == 200
        data = r.json()
        assert len(data["current_matches"]) == 2

    def test_record_score(self, client):
        tid = self._create(client)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        m = matches["current_matches"][0]
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={
                "match_id": m["id"],
                "score1": 20,
                "score2": 12,
            },
        )
        assert r.status_code == 200

    def test_record_bad_sum(self, client):
        tid = self._create(client)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        m = matches["current_matches"][0]
        r = client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={
                "match_id": m["id"],
                "score1": 20,
                "score2": 10,
            },
        )
        assert r.status_code == 400

    def test_next_round_requires_completed(self, client):
        tid = self._create(client)
        r = client.post(f"/api/tournaments/{tid}/mex/next-round")
        assert r.status_code == 400  # pending matches

    def test_full_mexicano_flow(self, client):
        tid = self._create(client)

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
                    )

            status = client.get(f"/api/tournaments/{tid}/mex/status").json()
            if rnd < 2:
                r = client.post(f"/api/tournaments/{tid}/mex/next-round")
                assert r.status_code == 200

        # Verify final leaderboard
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        assert status["is_finished"]
        assert status["leaderboard"][0]["total_points"] > 0

    def test_skill_gap_accepted(self, client):
        body = {**self.MEX_BODY, "skill_gap": 50}
        r = client.post("/api/tournaments/mexicano", json=body)
        assert r.status_code == 200

    def test_invalid_skill_gap_rejected(self, client):
        body = {**self.MEX_BODY, "skill_gap": -1}
        r = client.post("/api/tournaments/mexicano", json=body)
        assert r.status_code == 422

    def test_nonexistent_tournament(self, client):
        r = client.get("/api/tournaments/fake/mex/status")
        assert r.status_code == 404
