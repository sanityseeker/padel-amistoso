"""
Tests for registration → tournament conversion with composite teams and initial strength.
"""

from __future__ import annotations

from fastapi.testclient import TestClient


class TestConvertWithTeams:
    """Composite team formation during registration conversion."""

    def _setup_registration(self, client: TestClient, auth_headers: dict, names: list[str]) -> str:
        """Create a registration and register the given player names."""
        r = client.post("/api/registrations", json={"name": "Team Tourney"}, headers=auth_headers)
        assert r.status_code == 200
        rid = r.json()["id"]
        for name in names:
            res = client.post(f"/api/registrations/{rid}/register", json={"player_name": name})
            assert res.status_code == 200
        return rid

    def test_convert_gp_with_composite_teams(self, client, auth_headers):
        """Converting with teams creates synthetic team entries in group standings."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Dave"]],
                "team_names": ["Team AB", "Team CD"],
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]

        # Verify group standings contain the composite team names
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_players = []
        for group_standings in groups["standings"].values():
            all_players.extend(s["player"] for s in group_standings)
        assert "Team AB" in all_players
        assert "Team CD" in all_players
        assert "Alice" not in all_players  # Individual names should NOT appear

    def test_convert_gp_teams_auto_names(self, client, auth_headers):
        """When team_names are empty, teams are named after members joined by ' & '."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Dave"]],
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        all_players = []
        for group_standings in groups["standings"].values():
            all_players.extend(s["player"] for s in group_standings)
        assert "Alice & Bob" in all_players
        assert "Charlie & Dave" in all_players

    def test_convert_gp_team_roster_in_status(self, client, auth_headers):
        """GP status includes team_roster for composite teams."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Dave"]],
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        tid = r.json()["tournament_id"]
        status = client.get(f"/api/tournaments/{tid}/gp/status").json()
        roster = status.get("team_roster", {})
        assert len(roster) == 2
        # Each team should have 2 member IDs
        for _team_pid, member_ids in roster.items():
            assert len(member_ids) == 2

    def test_convert_playoff_with_teams(self, client, auth_headers):
        """Converting to playoff with teams preserves team formation."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "playoff",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Dave"]],
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]
        status = client.get(f"/api/tournaments/{tid}/po/status").json()
        assert status is not None

    def test_convert_mexicano_team_mode_forms_composite_teams(self, client, auth_headers):
        """Converting to Mexicano with teams creates fixed team Players, not individual players."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "mexicano",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Dave"]],
                "team_names": ["Team AB", "Team CD"],
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]

        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        player_names = [p["name"] for p in status["players"]]

        # Tournament should have 2 team players, not 4 individual players
        assert len(player_names) == 2
        assert "Team AB" in player_names
        assert "Team CD" in player_names
        assert "Alice" not in player_names
        assert "Bob" not in player_names

        # Leaderboard should also reflect those team names
        leaderboard_names = [e["player"] for e in status["leaderboard"]]
        assert "Team AB" in leaderboard_names
        assert "Team CD" in leaderboard_names

    def test_convert_mexicano_team_mode_auto_names(self, client, auth_headers):
        """Mexicano team conversion uses member names as fallback when team_names is absent."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "mexicano",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Dave"]],
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]
        status = client.get(f"/api/tournaments/{tid}/mex/status").json()
        player_names = [p["name"] for p in status["players"]]
        assert "Alice & Bob" in player_names
        assert "Charlie & Dave" in player_names

        """Providing teams without team_mode=True is rejected."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": ["Alice", "Bob"],
                "team_mode": False,
                "teams": [["Alice", "Bob"]],
            },
            headers=auth_headers,
        )
        assert r.status_code == 422  # validation error

    def test_convert_teams_rejects_duplicate_player(self, client, auth_headers):
        """A player in multiple teams is rejected at the schema level."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": ["Alice", "Bob", "Charlie"],
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Alice", "Charlie"]],
            },
            headers=auth_headers,
        )
        assert r.status_code == 422

    def test_convert_teams_rejects_unknown_member(self, client, auth_headers):
        """Team members must belong to selected player_names."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Mallory"]],
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 400
        assert "not in player_names" in r.json()["detail"]

    def test_convert_teams_rejects_missing_selected_player(self, client, auth_headers):
        """All selected players must be assigned to a team when teams are provided."""
        rid = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": ["Alice", "Bob", "Charlie", "Dave"],
                "team_mode": True,
                "teams": [["Alice", "Bob"]],
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 400
        assert "missing from teams" in r.json()["detail"]


class TestConvertWithStrength:
    """Initial strength scoring during registration conversion."""

    def _setup_registration(self, client: TestClient, auth_headers: dict, names: list[str]) -> str:
        r = client.post("/api/registrations", json={"name": "Strength Tourney"}, headers=auth_headers)
        assert r.status_code == 200
        rid = r.json()["id"]
        for name in names:
            res = client.post(f"/api/registrations/{rid}/register", json={"player_name": name})
            assert res.status_code == 200
        return rid

    def test_convert_gp_with_strength_sorts_players(self, client, auth_headers):
        """Players with higher strength should be placed earlier (top seed)."""
        names = ["Weak", "Medium", "Strong", "Best"]
        rid = self._setup_registration(client, auth_headers, names)
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": names,
                "team_mode": True,
                "player_strengths": {"Weak": 10, "Medium": 50, "Strong": 80, "Best": 100},
                "num_groups": 2,
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()

        # Collect all player names across groups in seed order
        all_standings = []
        for _gname, standings in groups["standings"].items():
            all_standings.extend(standings)
        # "Best" and "Strong" should be in different groups (snake draft)
        # Find which group each is in
        group_map = {}
        for gname, standings in groups["standings"].items():
            for s in standings:
                group_map[s["player"]] = gname
        assert group_map["Best"] != group_map["Strong"], "Top 2 seeds should be in different groups"

    def test_convert_mexicano_with_strength(self, client, auth_headers):
        """Mexicano conversion with strength scores should succeed."""
        names = ["P1", "P2", "P3", "P4"]
        rid = self._setup_registration(client, auth_headers, names)
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "mexicano",
                "player_names": names,
                "player_strengths": {"P1": 100, "P2": 80, "P3": 60, "P4": 40},
            },
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_convert_playoff_with_strength_seeds(self, client, auth_headers):
        """Playoff conversion with strength should seed bracket correctly."""
        names = ["Seed1", "Seed2", "Seed3", "Seed4"]
        rid = self._setup_registration(client, auth_headers, names)
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "playoff",
                "player_names": names,
                "team_mode": True,
                "player_strengths": {"Seed1": 100, "Seed2": 80, "Seed3": 60, "Seed4": 40},
            },
            headers=auth_headers,
        )
        assert r.status_code == 200

    def test_convert_gp_teams_with_aggregated_strength(self, client, auth_headers):
        """Team strength is the sum of member strengths."""
        names = ["Alice", "Bob", "Charlie", "Dave"]
        rid = self._setup_registration(client, auth_headers, names)
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": names,
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Dave"]],
                "team_names": ["Strong Team", "Weak Team"],
                "player_strengths": {"Alice": 90, "Bob": 80, "Charlie": 20, "Dave": 10},
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        # Both teams in one group; Strong Team should appear first (higher combined strength)
        for _gname, standings in groups["standings"].items():
            players = [s["player"] for s in standings]
            assert players.index("Strong Team") < players.index("Weak Team")

    def test_convert_mexicano_team_mode_strength_aggregated(self, client, auth_headers):
        """Team strength is the sum of member strengths; top-2 teams play each other in round 1."""
        names = ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank", "Grace", "Henry"]
        rid = self._setup_registration(client, auth_headers, names)
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "mexicano",
                "player_names": names,
                "team_mode": True,
                "teams": [["Alice", "Bob"], ["Charlie", "Dave"], ["Eve", "Frank"], ["Grace", "Henry"]],
                # Explicit team names so we can match by name
                "team_names": ["Team AB", "Team CD", "Team EF", "Team GH"],
                # Individual strengths: AB→190, CD→150, EF→50, GH→15
                "player_strengths": {
                    "Alice": 100,
                    "Bob": 90,
                    "Charlie": 80,
                    "Dave": 70,
                    "Eve": 30,
                    "Frank": 20,
                    "Grace": 10,
                    "Henry": 5,
                },
                "court_names": ["Court 1", "Court 2"],
            },
            headers=auth_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]

        matches_data = client.get(f"/api/tournaments/{tid}/mex/matches").json()
        all_matches = matches_data["all_matches"]
        round1 = [m for m in all_matches if m["round_number"] == 1]
        # Two matches expected for 4 teams
        assert len(round1) == 2

        # Build a set of (team1, team2) frozensets from round 1
        match_pairs = {frozenset(round1[i]["team1"] + round1[i]["team2"]) for i in range(len(round1))}
        # Top-2 ranked teams (AB=190, CD=150) should play each other
        assert frozenset(["Team AB", "Team CD"]) in match_pairs
        # Bottom-2 ranked teams (EF=50, GH=15) should play each other
        assert frozenset(["Team EF", "Team GH"]) in match_pairs

        """Conversion without strength scores should still work fine."""
        names = ["A", "B", "C", "D"]
        rid = self._setup_registration(client, auth_headers, names)
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": names,
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert r.status_code == 200


class TestConvertPlayerAuth:
    """Player authentication through composite team roster."""

    def _setup_and_convert(
        self,
        client: TestClient,
        auth_headers: dict,
        names: list[str],
        teams: list[list[str]],
    ) -> tuple[str, dict[str, str]]:
        """Create registration, register players, convert with teams.

        Returns (tournament_id, {player_name: passphrase}).
        """
        r = client.post("/api/registrations", json={"name": "Auth Test"}, headers=auth_headers)
        rid = r.json()["id"]
        passphrases = {}
        for name in names:
            res = client.post(f"/api/registrations/{rid}/register", json={"player_name": name})
            passphrases[name] = res.json()["passphrase"]

        conv = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "group_playoff",
                "player_names": names,
                "team_mode": True,
                "teams": teams,
                "num_groups": 1,
            },
            headers=auth_headers,
        )
        assert conv.status_code == 200
        return conv.json()["tournament_id"], passphrases

    def test_member_can_authenticate_with_original_passphrase(self, client, auth_headers):
        """Individual team members can auth using their registration passphrase."""
        tid, passphrases = self._setup_and_convert(
            client,
            auth_headers,
            ["Alice", "Bob", "Charlie", "Dave"],
            [["Alice", "Bob"], ["Charlie", "Dave"]],
        )
        # Alice should be able to authenticate
        r = client.post(
            f"/api/tournaments/{tid}/player-auth",
            json={"passphrase": passphrases["Alice"]},
        )
        assert r.status_code == 200
        assert r.json()["player_name"] == "Alice"

    def test_member_can_score_team_match(self, client, auth_headers):
        """A team member should be able to score their team's match."""
        tid, passphrases = self._setup_and_convert(
            client,
            auth_headers,
            ["Alice", "Bob", "Charlie", "Dave"],
            [["Alice", "Bob"], ["Charlie", "Dave"]],
        )
        # Get a pending match
        groups = client.get(f"/api/tournaments/{tid}/gp/groups").json()
        pending = []
        for _gname, matches in groups["matches"].items():
            pending.extend(m for m in matches if m["status"] != "completed")
        assert len(pending) > 0
        match = pending[0]

        # Authenticate as Alice (member of a team)
        auth = client.post(
            f"/api/tournaments/{tid}/player-auth",
            json={"passphrase": passphrases["Alice"]},
        )
        jwt_token = auth.json()["access_token"]

        # Score the match using Alice's JWT
        r = client.post(
            f"/api/tournaments/{tid}/gp/record-group",
            json={"match_id": match["id"], "score1": 6, "score2": 4},
            headers={"Authorization": f"Bearer {jwt_token}"},
        )
        assert r.status_code == 200


class TestMultiTournamentConversion:
    """Splitting one registration lobby into multiple independent tournaments."""

    def _setup_registration(
        self, client: TestClient, auth_headers: dict, names: list[str]
    ) -> tuple[str, dict[str, str]]:
        """Create a registration, register players, return (rid, {name: passphrase})."""
        r = client.post("/api/registrations", json={"name": "Multi Split Tourney"}, headers=auth_headers)
        assert r.status_code == 200
        rid = r.json()["id"]
        passphrases: dict[str, str] = {}
        for name in names:
            res = client.post(f"/api/registrations/{rid}/register", json={"player_name": name})
            assert res.status_code == 200
            passphrases[name] = res.json()["passphrase"]
        return rid, passphrases

    # ── Core multi-conversion ────────────────────────────────────────

    def test_convert_twice_disjoint_subsets_succeeds(self, client, auth_headers):
        """Two separate convert calls with non-overlapping player subsets both succeed."""
        rid, _ = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])

        r1 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        assert r1.status_code == 200
        tid1 = r1.json()["tournament_id"]

        r2 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Charlie", "Dave"]},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        tid2 = r2.json()["tournament_id"]

        # Both tournament IDs should be different
        assert tid1 != tid2

    def test_convert_overlap_allowed_with_warning(self, client, auth_headers):
        """Including a player already assigned to a previous tournament is allowed.

        The response must include the overlapping player names so the caller can warn the user.
        The created tournament must still exist and contain the overlapping player.
        """
        rid, _ = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])

        r1 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        assert r1.status_code == 200

        # Alice is already assigned — a second conversion with Alice must still succeed
        r2 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Charlie"]},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        data = r2.json()
        assert "Alice" in data["overlapping_players"]
        assert data["tournament_id"] is not None
        # Verify Alice actually appears in the new tournament's player secrets
        from backend.api.db import get_db

        with get_db() as conn:
            row = conn.execute(
                "SELECT * FROM player_secrets WHERE tournament_id = ?",
                (data["tournament_id"],),
            ).fetchall()
        names_in_t = {r["player_name"] for r in row}
        assert "Alice" in names_in_t

    def test_convert_partial_does_not_auto_close(self, client, auth_headers):
        """Converting a subset of players leaves the registration open."""
        rid, _ = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])

        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["all_assigned"] is False

        # Registration must still be open
        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert detail["open"] is True
        assert detail["archived"] is False

    def test_convert_all_players_auto_closes_registration(self, client, auth_headers):
        """Once every registrant is assigned the registration auto-closes."""
        rid, _ = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])

        client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        r2 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Charlie", "Dave"]},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        assert r2.json()["all_assigned"] is True

        # Registration must now be closed but not archived
        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert detail["open"] is False
        assert detail["archived"] is False

    def test_registration_admin_out_has_converted_to_tids(self, client, auth_headers):
        """RegistrationAdminOut exposes converted_to_tids as a list."""
        rid, _ = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])

        r1 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        tid1 = r1.json()["tournament_id"]

        r2 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Charlie", "Dave"]},
            headers=auth_headers,
        )
        tid2 = r2.json()["tournament_id"]

        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert isinstance(detail["converted_to_tids"], list)
        assert set(detail["converted_to_tids"]) == {tid1, tid2}
        linked = detail["linked_tournaments"]
        assert [item["id"] for item in linked] == [tid1, tid2]
        assert all(item["name"] for item in linked)
        assert all("type" in item for item in linked)
        # Legacy field still points to the first tournament
        assert detail["converted_to_tid"] == tid1

    def test_assigned_player_ids_populated(self, client, auth_headers):
        """assigned_player_ids reflects the players that have been placed in tournaments."""
        rid, _ = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])

        # Before any conversion: no assigned players
        detail_before = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        assert detail_before["assigned_player_ids"] == []

        # Convert first pair
        client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )

        detail_after = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        registrant_map = {r["player_name"]: r["player_id"] for r in detail_after["registrants"]}
        assigned = set(detail_after["assigned_player_ids"])
        assert registrant_map["Alice"] in assigned
        assert registrant_map["Bob"] in assigned
        assert registrant_map["Charlie"] not in assigned
        assert registrant_map["Dave"] not in assigned

    def test_convert_second_tournament_using_unassigned_from_detail_succeeds(self, client, auth_headers):
        """Using assigned_player_ids from registration detail to pick remaining players allows a second conversion."""
        rid, _ = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])

        first = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        assert first.status_code == 200

        detail = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        registrants: list[dict[str, str]] = detail["registrants"]
        assigned_ids = set(detail["assigned_player_ids"])

        remaining_names = [
            registrant["player_name"] for registrant in registrants if registrant["player_id"] not in assigned_ids
        ]

        assert set(remaining_names) == {"Charlie", "Dave"}

        second = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": remaining_names},
            headers=auth_headers,
        )
        assert second.status_code == 200
        assert second.json()["all_assigned"] is True

        detail_after = client.get(f"/api/registrations/{rid}", headers=auth_headers).json()
        all_ids = {registrant["player_id"] for registrant in detail_after["registrants"]}
        assert set(detail_after["assigned_player_ids"]) == all_ids

    def test_passphrases_preserved_across_multiple_conversions(self, client, auth_headers):
        """Registrant passphrases carry over to their respective tournaments."""
        # Use Mexicano (needs 4 players each); 8 registrants split into two groups of 4
        names = ["Alice", "Bob", "Charlie", "Dave", "Eve", "Frank", "Grace", "Henry"]
        rid, passphrases = self._setup_registration(client, auth_headers, names)

        r1 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "mexicano", "player_names": ["Alice", "Bob", "Charlie", "Dave"]},
            headers=auth_headers,
        )
        assert r1.status_code == 200
        tid1 = r1.json()["tournament_id"]

        r2 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "mexicano", "player_names": ["Eve", "Frank", "Grace", "Henry"]},
            headers=auth_headers,
        )
        assert r2.status_code == 200
        tid2 = r2.json()["tournament_id"]

        # Alice should authenticate in tournament 1 with her original passphrase
        auth_alice = client.post(
            f"/api/tournaments/{tid1}/player-auth",
            json={"passphrase": passphrases["Alice"]},
        )
        assert auth_alice.status_code == 200

        # Eve should authenticate in tournament 2 with her original passphrase
        auth_eve = client.post(
            f"/api/tournaments/{tid2}/player-auth",
            json={"passphrase": passphrases["Eve"]},
        )
        assert auth_eve.status_code == 200

    def test_assigned_player_cannot_cancel(self, client, auth_headers):
        """A registrant already placed in a tournament cannot cancel their registration."""
        rid, passphrases = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie"])

        client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )

        r = client.post(
            f"/api/registrations/{rid}/player-cancel",
            json={"passphrase": passphrases["Alice"]},
        )
        assert r.status_code == 400

    def test_unassigned_player_can_still_cancel(self, client, auth_headers):
        """A registrant NOT yet placed in a tournament can still cancel."""
        rid, passphrases = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie"])

        # Only Alice and Bob are converted
        client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )

        r = client.post(
            f"/api/registrations/{rid}/player-cancel",
            json={"passphrase": passphrases["Charlie"]},
        )
        assert r.status_code == 200

    def test_public_view_shows_converted_tournament_metadata(self, client, auth_headers):
        """Public registration endpoint exposes all linked tournaments with metadata."""
        rid, _ = self._setup_registration(client, auth_headers, ["Alice", "Bob", "Charlie", "Dave"])

        r1 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        tid1 = r1.json()["tournament_id"]

        r2 = client.post(
            f"/api/registrations/{rid}/convert",
            json={"tournament_type": "playoff", "player_names": ["Charlie", "Dave"]},
            headers=auth_headers,
        )
        tid2 = r2.json()["tournament_id"]

        pub = client.get(f"/api/registrations/{rid}/public").json()
        assert pub["converted"] is True
        assert pub["converted_to_tids"] == [tid1, tid2]
        linked = pub["linked_tournaments"]
        assert [item["id"] for item in linked] == [tid1, tid2]
        assert all(item["name"] for item in linked)
        assert all("finished" in item for item in linked)
