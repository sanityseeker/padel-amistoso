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
        assert "Torneos Amistosos" in r.text

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

    def test_create(self, client, auth_headers):
        r = client.post("/api/tournaments/playoff", json=self.PO_BODY, headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert "id" in data
        assert data["phase"] == "playoffs"

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

    def test_schema_endpoint_returns_image(self, client, auth_headers):
        tid = self._create(client, auth_headers)
        r = client.get(f"/api/tournaments/{tid}/po/playoffs-schema?fmt=png")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("image/png")
        assert len(r.content) > 0

    def test_too_few_participants_rejected(self, client, auth_headers):
        body = {**self.PO_BODY, "participant_names": ["Solo"]}
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
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        r = client.get("/api/registrations/public")
        assert r.status_code == 200
        assert len(r.json()) == 0

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
            json={"tournament_type": "playoff", "player_names": ["Alice", "Bob"]},
            headers=auth_headers,
        )
        tid = conv.json()["tournament_id"]

        r = client.get(f"/api/registrations/{rid}/public")
        assert r.status_code == 200
        data = r.json()
        assert data["converted"] is True
        assert data["converted_to_tid"] == tid

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
        assert pub.json()["registrants"][0]["player_name"] == "Alice"

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

        pub = client.get(f"/api/registrations/{rid}/public")
        assert pub.status_code == 200
        assert pub.json()["registrants"][0]["answers"] == {"q0": "advanced", "q1": "right"}

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
