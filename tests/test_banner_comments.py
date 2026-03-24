"""
Tests for the tournament announcement banner and match comment features.
"""

from __future__ import annotations


class TestBannerAndComments:
    """Tests for the banner (via TV settings) and match comment API endpoints."""

    GP_BODY = {
        "name": "Banner Test",
        "player_names": ["A", "B", "C", "D", "E", "F", "G", "H"],
        "team_mode": False,
        "court_names": ["Court 1", "Court 2"],
        "num_groups": 2,
        "top_per_group": 2,
        "double_elimination": False,
    }

    def _create(self, client, auth_headers) -> str:
        r = client.post("/api/tournaments/group-playoff", json=self.GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        return r.json()["id"]

    # ── Banner ─────────────────────────────────────────────

    def test_banner_default_empty(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/tv-settings")
        assert r.status_code == 200
        assert r.json()["banner_text"] == ""

    def test_set_banner_via_tv_settings(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"banner_text": "Next round at 3pm!"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["banner_text"] == "Next round at 3pm!"

        # Verify it persists on re-read
        r = client.get(f"/api/tournaments/{tid}/tv-settings")
        assert r.json()["banner_text"] == "Next round at 3pm!"

    def test_clear_banner(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"banner_text": "Hello"},
            headers=auth_headers,
        )
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"banner_text": ""},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["banner_text"] == ""

    def test_banner_requires_auth(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"banner_text": "Nope"},
        )
        assert r.status_code in (401, 403)

    # ── Match comments ─────────────────────────────────────

    def test_set_match_comment(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        pending = [m for m in all_matches if m["status"] != "completed"]
        assert len(pending) > 0

        match_id = pending[0]["id"]
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Play on time!"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["comment"] == "Play on time!"

        # Verify comment is serialized in response
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        match = next(m for ms in groups["matches"].values() for m in ms if m["id"] == match_id)
        assert match["comment"] == "Play on time!"

    def test_clear_match_comment(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        match_id = all_matches[0]["id"]

        # Set then clear
        client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Temp"},
            headers=auth_headers,
        )
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": ""},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["comment"] == ""

    def test_match_comment_requires_auth(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        match_id = all_matches[0]["id"]

        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Nope"},
        )
        assert r.status_code in (401, 403)

    def test_match_comment_not_found(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": "nonexistent", "comment": "test"},
            headers=auth_headers,
        )
        assert r.status_code == 404

    def test_match_comment_tournament_not_found(self, client, auth_headers):
        r = client.patch(
            "/api/tournaments/fake/match-comment",
            json={"match_id": "x", "comment": "test"},
            headers=auth_headers,
        )
        assert r.status_code == 404

    def test_comment_max_length_enforced(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        match_id = all_matches[0]["id"]

        long_comment = "x" * 501
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": long_comment},
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_match_comment_default_empty_in_serialized_match(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_matches = [m for ms in groups["matches"].values() for m in ms]
        assert all(m.get("comment", "") == "" for m in all_matches)

    def test_comment_on_mexicano_match(self, client, auth_headers):
        """Comments work across tournament types (mexicano)."""
        body = {
            "name": "Mex Comment Test",
            "player_names": ["A", "B", "C", "D"],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "num_rounds": 2,
        }
        r = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]

        matches = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        current = matches["current_matches"]
        assert len(current) > 0

        match_id = current[0]["id"]
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Vamos!"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["comment"] == "Vamos!"

    def test_comment_on_playoff_match(self, client, auth_headers):
        """Comments work on standalone playoff matches."""
        body = {
            "name": "PO Comment Test",
            "participant_names": ["A & B", "C & D", "E & F", "G & H"],
            "court_names": ["Court 1"],
            "team_mode": True,
        }
        r = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]

        playoffs = client.get(f"/api/tournaments/{tid}/po/playoffs").json()
        pending = [m for m in playoffs.get("pending", []) if m["status"] != "completed"]
        assert len(pending) > 0

        match_id = pending[0]["id"]
        r = client.patch(
            f"/api/tournaments/{tid}/match-comment",
            json={"match_id": match_id, "comment": "Semi-final!"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["comment"] == "Semi-final!"
