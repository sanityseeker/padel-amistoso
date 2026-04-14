"""Integration tests for the ELO system end-to-end.

Verifies that ELO ratings are initialized, updated after scores, appear
in leaderboard/standings API responses, and transfer to profiles on finish.
"""

from __future__ import annotations

from backend.api.elo_store import get_tournament_elos, get_tournament_match_counts
from backend.tournaments.elo import DEFAULT_RATING


class TestMexicanoEloIntegration:
    """ELO flows through a Mexicano tournament lifecycle."""

    MEX_BODY = {
        "name": "ELO Mex",
        "player_names": ["Alice", "Bob", "Carol", "Dave"],
        "court_names": ["Court 1"],
        "total_points_per_match": 32,
        "num_rounds": 2,
    }

    def _create(self, client, auth_headers) -> str:
        r = client.post("/api/tournaments/mexicano", json=self.MEX_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_elo_initialized_on_creation(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 4
        assert all(v == DEFAULT_RATING for v in elos.values())

    def test_elo_updated_after_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        m = matches["current_matches"][0]

        client.post(
            f"/api/tournaments/{tid}/mex/record",
            json={"match_id": m["id"], "score1": 20, "score2": 12},
            headers=auth_headers,
        )

        elos = get_tournament_elos(tid, "padel")
        counts = get_tournament_match_counts(tid, "padel")
        # Players from the recorded match should have updated ELOs
        changed = [pid for pid, elo in elos.items() if elo != DEFAULT_RATING]
        assert len(changed) > 0
        # At least some players have match count > 0
        assert any(c > 0 for c in counts.values())

    def test_leaderboard_includes_elo(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        # Before any matches, ELO should appear in leaderboard
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        for entry in status["leaderboard"]:
            assert "elo" in entry

        # Record a round and check again
        client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        for m in matches["current_matches"]:
            if m["status"] != "completed":
                client.post(
                    f"/api/tournaments/{tid}/mex/record",
                    json={"match_id": m["id"], "score1": 18, "score2": 14},
                    headers=auth_headers,
                )

        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        elos = [e["elo"] for e in status["leaderboard"] if e["elo"] is not None]
        # At least some players should have non-default ELO after matches
        assert len(elos) > 0

    def test_full_flow_elo_changes(self, client, auth_headers):
        """Play all rounds and verify ELOs diverge from default."""
        tid = self._create(client, auth_headers)

        for rnd in range(2):
            client.post(f"/api/tournaments/{tid}/mex/next-round", headers=auth_headers)
            matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
            for m in matches["current_matches"]:
                if m["status"] != "completed":
                    client.post(
                        f"/api/tournaments/{tid}/mex/record",
                        json={"match_id": m["id"], "score1": 20, "score2": 12},
                        headers=auth_headers,
                    )

        elos = get_tournament_elos(tid, "padel")
        # After a full tournament, ELOs should have diverged
        unique_elos = set(round(v, 1) for v in elos.values())
        assert len(unique_elos) > 1, "ELOs should diverge after multiple rounds"


class TestGroupPlayoffEloIntegration:
    """ELO flows through a Group-Playoff tournament lifecycle."""

    GP_BODY = {
        "name": "ELO GP",
        "player_names": ["Alice", "Bob", "Carol", "Dave"],
        "court_names": ["Court 1"],
        "num_groups": 1,
        "top_per_group": 2,
        "double_elimination": False,
    }

    def _create(self, client, auth_headers) -> str:
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_elo_initialized_on_creation(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 4

    def test_standings_include_elo(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        for group_name, rows in groups["standings"].items():
            for entry in rows:
                assert "elo" in entry

    def test_elo_updated_after_group_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        # Get first pending match
        for group_name, matches in groups["matches"].items():
            for m in matches:
                if m["status"] != "completed":
                    client.post(
                        f"/api/tournaments/{tid}/gp/record-group",
                        json={"match_id": m["id"], "score1": 10, "score2": 5},
                        headers=auth_headers,
                    )
                    break
            break

        elos = get_tournament_elos(tid, "padel")
        changed = [pid for pid, elo in elos.items() if elo != DEFAULT_RATING]
        assert len(changed) > 0


class TestPlayoffEloIntegration:
    """ELO flows through a Playoff tournament lifecycle."""

    PO_BODY = {
        "name": "ELO PO",
        "participant_names": ["Alice", "Bob", "Carol", "Dave"],
        "court_names": ["Court 1"],
        "double_elimination": False,
    }

    def _create(self, client, auth_headers) -> str:
        r = client.post("/api/tournaments/playoff", json=self.PO_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    def test_elo_initialized_on_creation(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 4

    def test_elo_updated_after_playoff_score(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        playoffs = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
        pending = playoffs["pending"]
        if pending:
            m = pending[0]
            client.post(
                f"/api/tournaments/{tid}/po/record",
                json={"match_id": m["id"], "score1": 10, "score2": 5},
                headers=auth_headers,
            )
            elos = get_tournament_elos(tid, "padel")
            changed = [pid for pid, elo in elos.items() if elo != DEFAULT_RATING]
            assert len(changed) > 0


class TestEloOnDeletion:
    """ELO rows are cleaned up when a tournament is deleted."""

    def test_elo_deleted_with_tournament(self, client, auth_headers):
        r = client.post(
            "/api/tournaments/mexicano",
            json={
                "name": "Deletable",
                "player_names": ["A", "B", "C", "D"],
                "court_names": ["Court 1"],
                "total_points_per_match": 32,
                "num_rounds": 1,
            },
            headers=auth_headers,
        )
        tid = r.json()["id"]
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 4

        client.delete(f"/api/tournaments/{tid}", headers=auth_headers)
        elos = get_tournament_elos(tid, "padel")
        assert len(elos) == 0
