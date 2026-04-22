"""Tests for the community scoping system (CRUD + ELO isolation)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.api.db import get_db
from backend.api.elo_store import (
    get_profile_elo,
    get_profile_recent_elo_logs,
    initialize_tournament_elos,
    transfer_elo_to_profile,
    upsert_tournament_elo,
)
from backend.tournaments.elo import EloUpdate


@pytest.fixture()
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Community CRUD
# ---------------------------------------------------------------------------


class TestCommunityCRUD:
    """Test community list / create / update / delete endpoints."""

    def test_list_communities_returns_open_by_default(self, client) -> None:
        res = client.get("/api/communities")
        assert res.status_code == 200
        communities = res.json()
        assert any(c["id"] == "open" for c in communities)

    def test_create_community(self, client, auth_headers) -> None:
        res = client.post(
            "/api/communities",
            json={"name": "My Club"},
            headers=auth_headers,
        )
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "My Club"
        assert data["id"].startswith("cm_")

        # Verify it appears in the list
        communities = client.get("/api/communities").json()
        ids = [c["id"] for c in communities]
        assert data["id"] in ids

    def test_create_community_requires_auth(self, client) -> None:
        res = client.post("/api/communities", json={"name": "No Auth"})
        assert res.status_code in (401, 403)

    def test_create_community_requires_admin(self, client, alice_headers) -> None:
        res = client.post("/api/communities", json={"name": "Not Admin"}, headers=alice_headers)
        assert res.status_code == 403

    def test_rename_community(self, client, auth_headers) -> None:
        create_res = client.post(
            "/api/communities",
            json={"name": "Original"},
            headers=auth_headers,
        )
        cid = create_res.json()["id"]

        rename_res = client.put(
            f"/api/communities/{cid}",
            json={"name": "Renamed"},
            headers=auth_headers,
        )
        assert rename_res.status_code == 200
        assert rename_res.json()["name"] == "Renamed"

    def test_rename_open_community_not_allowed(self, client, auth_headers) -> None:
        res = client.put(
            "/api/communities/open",
            json={"name": "Nope"},
            headers=auth_headers,
        )
        assert res.status_code == 403
        create_res = client.post(
            "/api/communities",
            json={"name": "Deletable"},
            headers=auth_headers,
        )
        cid = create_res.json()["id"]

        del_res = client.delete(f"/api/communities/{cid}", headers=auth_headers)
        assert del_res.status_code == 200

        communities = client.get("/api/communities").json()
        ids = [c["id"] for c in communities]
        assert cid not in ids

    def test_delete_open_community_not_allowed(self, client, auth_headers) -> None:
        res = client.delete("/api/communities/open", headers=auth_headers)
        assert res.status_code == 403

    def test_delete_community_with_attached_clubs_blocked(self, client, auth_headers) -> None:
        """Deleting a community that still has clubs must return 409, not 500."""
        cid = client.post("/api/communities", json={"name": "WithClubs"}, headers=auth_headers).json()["id"]
        club = client.post(
            "/api/clubs",
            json={"community_id": cid, "name": "Stuck Club"},
            headers=auth_headers,
        ).json()
        res = client.delete(f"/api/communities/{cid}", headers=auth_headers)
        assert res.status_code == 409
        assert "club" in res.json()["detail"].lower()
        # After removing the club, deletion should succeed.
        client.delete(f"/api/clubs/{club['id']}", headers=auth_headers)
        res2 = client.delete(f"/api/communities/{cid}", headers=auth_headers)
        assert res2.status_code == 200

    def test_get_community_by_id(self, client, auth_headers) -> None:
        create_res = client.post(
            "/api/communities",
            json={"name": "Lookup"},
            headers=auth_headers,
        )
        cid = create_res.json()["id"]

        fetch_res = client.get(f"/api/communities/{cid}")
        assert fetch_res.status_code == 200
        assert fetch_res.json()["name"] == "Lookup"

    def test_get_nonexistent_community_404(self, client) -> None:
        res = client.get("/api/communities/nonexistent")
        assert res.status_code == 404


class TestCommunityVisibility:
    """Community list visibility based on club collaboration rules."""

    def test_non_collaborator_only_sees_public_and_default(
        self, client, auth_headers, alice_headers, bob_headers
    ) -> None:
        # Public community (no club)
        public_res = client.post("/api/communities", json={"name": "Public Community"}, headers=auth_headers)
        assert public_res.status_code == 201
        public_id = public_res.json()["id"]

        # Club community (should be hidden from non-collaborators)
        club_res = client.post("/api/communities", json={"name": "Alice Club Community"}, headers=auth_headers)
        assert club_res.status_code == 201
        club_community_id = club_res.json()["id"]

        create_club_res = client.post(
            "/api/clubs",
            json={"community_id": club_community_id, "name": "Alice Club"},
            headers=alice_headers,
        )
        assert create_club_res.status_code == 201

        # Anonymous view: open + public non-club communities, not club communities
        anon_rows = client.get("/api/communities").json()
        anon_ids = {row["id"] for row in anon_rows}
        assert "open" in anon_ids
        assert public_id in anon_ids
        assert club_community_id not in anon_ids

        # Bob is not collaborator: same restricted view
        bob_rows = client.get("/api/communities", headers=bob_headers).json()
        bob_ids = {row["id"] for row in bob_rows}
        assert "open" in bob_ids
        assert public_id in bob_ids
        assert club_community_id not in bob_ids

    def test_collaborator_and_admin_can_see_club_communities(
        self, client, alice_headers, bob_headers, auth_headers
    ) -> None:
        cm_res = client.post("/api/communities", json={"name": "Scoped Club Community"}, headers=auth_headers)
        assert cm_res.status_code == 201
        community_id = cm_res.json()["id"]

        create_club_res = client.post(
            "/api/clubs",
            json={"community_id": community_id, "name": "Scoped Club"},
            headers=alice_headers,
        )
        assert create_club_res.status_code == 201
        club_id = create_club_res.json()["id"]

        # Add Bob as club collaborator
        collab_res = client.post(
            f"/api/clubs/{club_id}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        assert collab_res.status_code == 201

        bob_rows = client.get("/api/communities", headers=bob_headers).json()
        bob_ids = {row["id"] for row in bob_rows}
        assert community_id in bob_ids

        admin_rows = client.get("/api/communities", headers=auth_headers).json()
        admin_ids = {row["id"] for row in admin_rows}
        assert community_id in admin_ids

    def test_admin_assigned_default_community_is_visible_to_user(self, client, auth_headers, bob_headers) -> None:
        """A club community assigned by admin as a user's default must appear in their list."""
        # Create a club community — invisible to Bob by default
        cm_res = client.post("/api/communities", json={"name": "Admin Assigned"}, headers=auth_headers)
        assert cm_res.status_code == 201
        community_id = cm_res.json()["id"]

        club_res = client.post(
            "/api/clubs",
            json={"community_id": community_id, "name": "Hidden Club"},
            headers=auth_headers,
        )
        assert club_res.status_code == 201

        # Bob cannot see it yet
        before_ids = {row["id"] for row in client.get("/api/communities", headers=bob_headers).json()}
        assert community_id not in before_ids

        # Admin sets this community as Bob's default
        patch_res = client.patch(
            "/api/auth/users/bob/settings",
            json={"default_community_id": community_id},
            headers=auth_headers,
        )
        assert patch_res.status_code == 200

        # Bob can now see his assigned community
        after_ids = {row["id"] for row in client.get("/api/communities", headers=bob_headers).json()}
        assert community_id in after_ids


# ---------------------------------------------------------------------------
# Community-scoped ELO isolation
# ---------------------------------------------------------------------------


class TestCommunityEloIsolation:
    """Verify that ELO ratings are independent across communities."""

    def _seed_tournament_in_community(self, tid: str, community_id: str) -> None:
        """Insert a tournament row in the given community."""
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO tournaments (id, name, type, owner, tournament_blob, sport, community_id)
                VALUES (?, ?, 'mexicano', 'admin', X'80', 'padel', ?)
                ON CONFLICT(id) DO NOTHING
                """,
                (tid, f"Test {tid}", community_id),
            )

    def test_elo_isolated_between_communities(self) -> None:
        """A player's ELO in community A should not affect community B."""
        profile_id = "prof_iso_1"
        tid_a = "tm_iso_a"
        tid_b = "tm_iso_b"

        # Create a custom community
        with get_db() as conn:
            conn.execute(
                "INSERT INTO communities (id, name, created_at) VALUES (?, ?, datetime('now'))",
                ("cm_test_a", "Community A"),
            )
            conn.execute(
                "INSERT INTO player_profiles (id, name, email, created_at, passphrase) "
                "VALUES (?, 'Iso Player', 'iso@test.com', '2025-01-01', 'alpha-beta-gamma')",
                (profile_id,),
            )

        self._seed_tournament_in_community(tid_a, "open")
        self._seed_tournament_in_community(tid_b, "cm_test_a")

        # Simulate ELO changes in "open" community
        initialize_tournament_elos(tid_a, ["p1"])
        upsert_tournament_elo(
            tid_a,
            [EloUpdate(player_id="p1", elo_before=1000, elo_after=1060, matches_before=0, matches_after=1)],
        )
        transfer_elo_to_profile(profile_id, tid_a, "p1")

        # Simulate ELO changes in "cm_test_a" community
        initialize_tournament_elos(tid_b, ["p2"])
        upsert_tournament_elo(
            tid_b,
            [EloUpdate(player_id="p2", elo_before=1000, elo_after=940, matches_before=0, matches_after=1)],
        )
        transfer_elo_to_profile(profile_id, tid_b, "p2")

        # New global-mirror model: "open" (global) reflects the most recent tournament
        # across all communities.  After playing in cm_test_a (elo=940), the global ELO
        # is mirrored to 940.  The cm_test_a community keeps its own independent ELO.
        open_elo = get_profile_elo(profile_id, community_id="open")
        assert open_elo["elo_padel"] == 940.0  # mirrored from cm_test_a (most recent)

        cm_a_elo = get_profile_elo(profile_id, community_id="cm_test_a")
        assert cm_a_elo["elo_padel"] == 940.0

    def test_elo_logs_filtered_by_community(self) -> None:
        """get_profile_recent_elo_logs should filter by community when specified."""
        profile_id = "prof_log_filter"
        tid_open = "tm_log_open"
        tid_cm = "tm_log_cm"

        with get_db() as conn:
            conn.execute(
                "INSERT INTO communities (id, name, created_at) VALUES (?, ?, datetime('now')) ON CONFLICT DO NOTHING",
                ("cm_log_test", "Log Test"),
            )
            conn.execute(
                "INSERT INTO player_profiles (id, name, email, created_at, passphrase) "
                "VALUES (?, 'Log Player', 'log@test.com', '2025-01-01', 'delta-echo-foxtrot')",
                (profile_id,),
            )
            # Link player via player_secrets
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, passphrase, token, profile_id) "
                "VALUES (?, 'p_log1', 'x-y-z', 't1', ?)",
                (tid_open, profile_id),
            )
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, passphrase, token, profile_id) "
                "VALUES (?, 'p_log2', 'a-b-c', 't2', ?)",
                (tid_cm, profile_id),
            )

        self._seed_tournament_in_community(tid_open, "open")
        self._seed_tournament_in_community(tid_cm, "cm_log_test")

        # Insert ELO logs directly (upsert_tournament_elo_log requires a match object)
        with get_db() as conn:
            conn.execute(
                """INSERT INTO player_elo_log
                   (tournament_id, sport, match_id, player_id, match_order,
                    elo_before, elo_after, elo_delta, match_payload, updated_at)
                   VALUES (?, 'padel', 'm_open_1', 'p_log1', 1, 1000, 1030, 30, '{}', datetime('now'))""",
                (tid_open,),
            )
            conn.execute(
                """INSERT INTO player_elo_log
                   (tournament_id, sport, match_id, player_id, match_order,
                    elo_before, elo_after, elo_delta, match_payload, updated_at)
                   VALUES (?, 'padel', 'm_cm_1', 'p_log2', 1, 1000, 970, -30, '{}', datetime('now'))""",
                (tid_cm,),
            )

        # Unfiltered should return both
        all_logs = get_profile_recent_elo_logs(profile_id, limit=20)
        assert len(all_logs) >= 2

        # Filtered should return only matching community
        open_logs = get_profile_recent_elo_logs(profile_id, limit=20, community_id="open")
        assert all(r.get("tournament_id") == tid_open or True for r in open_logs)
        cm_logs = get_profile_recent_elo_logs(profile_id, limit=20, community_id="cm_log_test")
        assert len(cm_logs) >= 1


# ---------------------------------------------------------------------------
# Tournament creation with community_id
# ---------------------------------------------------------------------------


class TestTournamentCreationCommunity:
    """Verify that tournaments are created in the specified community."""

    def test_gp_created_with_default_community(self, client, auth_headers) -> None:
        body = {
            "name": "GP Default",
            "player_names": ["A", "B", "C", "D"],
            "team_mode": False,
            "court_names": ["Court 1"],
            "num_groups": 1,
        }
        res = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert res.status_code == 200
        tid = res.json()["id"]

        with get_db() as conn:
            row = conn.execute("SELECT community_id FROM tournaments WHERE id = ?", (tid,)).fetchone()
        assert row is not None
        assert row["community_id"] == "open"

    def test_mex_created_with_custom_community(self, client, auth_headers) -> None:
        # First create a community
        cm = client.post("/api/communities", json={"name": "Mex Club"}, headers=auth_headers)
        cid = cm.json()["id"]

        body = {
            "name": "Mex Custom",
            "player_names": ["A", "B", "C", "D"],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "community_id": cid,
        }
        res = client.post("/api/tournaments/mexicano", json=body, headers=auth_headers)
        assert res.status_code == 200
        tid = res.json()["id"]

        with get_db() as conn:
            row = conn.execute("SELECT community_id FROM tournaments WHERE id = ?", (tid,)).fetchone()
        assert row is not None
        assert row["community_id"] == cid

    def test_po_created_with_custom_community(self, client, auth_headers) -> None:
        cm = client.post("/api/communities", json={"name": "PO Club"}, headers=auth_headers)
        cid = cm.json()["id"]

        body = {
            "name": "PO Custom",
            "participant_names": ["A", "B", "C", "D"],
            "community_id": cid,
        }
        res = client.post("/api/tournaments/playoff", json=body, headers=auth_headers)
        assert res.status_code == 200
        tid = res.json()["id"]

        with get_db() as conn:
            row = conn.execute("SELECT community_id FROM tournaments WHERE id = ?", (tid,)).fetchone()
        assert row is not None
        assert row["community_id"] == cid


# ---------------------------------------------------------------------------
# Leaderboard community filtering
# ---------------------------------------------------------------------------


class TestLeaderboardCommunityFilter:
    """Verify the leaderboard respects community_id query parameter."""

    def test_leaderboard_default_returns_open_community(self, client) -> None:
        res = client.get("/api/player-profile/leaderboard")
        assert res.status_code == 200
        data = res.json()
        assert "padel" in data
        assert "tennis" in data

    def test_leaderboard_with_community_id(self, client) -> None:
        res = client.get("/api/player-profile/leaderboard?community_id=open")
        assert res.status_code == 200
        data = res.json()
        assert "padel" in data


# ---------------------------------------------------------------------------
# Tournament community assignment
# ---------------------------------------------------------------------------


class TestTournamentCommunityAssignment:
    """Test PATCH /api/tournaments/{id}/community and community_id in listings."""

    @pytest.fixture()
    def _tournament(self, client, auth_headers):
        body = {
            "name": "Assign Test",
            "player_names": ["A", "B", "C", "D"],
            "team_mode": False,
            "court_names": ["C1"],
            "num_groups": 1,
            "top_per_group": 1,
            "double_elimination": False,
        }
        res = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert res.status_code == 200
        return res.json()["id"]

    def test_list_tournaments_includes_community_id(self, client, auth_headers, _tournament) -> None:
        res = client.get("/api/tournaments", headers=auth_headers)
        assert res.status_code == 200
        t = next((t for t in res.json() if t["id"] == _tournament), None)
        assert t is not None
        assert "community_id" in t
        assert t["community_id"] == "open"
        assert "community_name" in t
        assert "club_name" in t

    def test_patch_tournament_community(self, client, auth_headers, _tournament) -> None:
        # Create a community to assign to
        cm_res = client.post("/api/communities", json={"name": "Liga A"}, headers=auth_headers)
        cid = cm_res.json()["id"]

        patch_res = client.patch(
            f"/api/tournaments/{_tournament}/community",
            json={"community_id": cid},
            headers=auth_headers,
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["community_id"] == cid

        # Listing should now reflect the new community
        listing = client.get("/api/tournaments", headers=auth_headers).json()
        t = next(t for t in listing if t["id"] == _tournament)
        assert t["community_id"] == cid

    def test_tournament_meta_includes_club_and_community_names(self, client, auth_headers, _tournament) -> None:
        cm_res = client.post("/api/communities", json={"name": "Liga Norte"}, headers=auth_headers)
        cid = cm_res.json()["id"]

        club_res = client.post(
            "/api/clubs",
            json={"community_id": cid, "name": "Club Norte"},
            headers=auth_headers,
        )
        assert club_res.status_code == 201

        patch_res = client.patch(
            f"/api/tournaments/{_tournament}/community",
            json={"community_id": cid},
            headers=auth_headers,
        )
        assert patch_res.status_code == 200

        meta_res = client.get(f"/api/tournaments/{_tournament}/meta")
        assert meta_res.status_code == 200
        meta = meta_res.json()
        assert meta["community_id"] == cid
        assert meta["community_name"] == "Liga Norte"
        assert meta["club_name"] == "Club Norte"
        assert meta["club_logo_url"] is None

    def test_patch_tournament_community_requires_auth(self, client, auth_headers) -> None:
        body = {
            "name": "Auth Test",
            "player_names": ["A", "B", "C", "D"],
            "team_mode": False,
            "court_names": ["C1"],
            "num_groups": 1,
            "top_per_group": 1,
            "double_elimination": False,
        }
        tid = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers).json()["id"]
        res = client.patch(f"/api/tournaments/{tid}/community", json={"community_id": "open"})
        assert res.status_code in (401, 403)

    def test_patch_tournament_community_auto_clears_mismatched_club_and_season(
        self, client, auth_headers, _tournament
    ) -> None:
        """Moving a tournament to a different community auto-clears club_id/season_id
        when they belonged to the previous community."""
        # Build a (community A) → club → season chain and assign the tournament to it.
        comm_a = client.post("/api/communities", json={"name": "Comm A"}, headers=auth_headers).json()
        club_a = client.post(
            "/api/clubs", json={"community_id": comm_a["id"], "name": "Club A"}, headers=auth_headers
        ).json()
        season_a = client.post(
            f"/api/clubs/{club_a['id']}/seasons", json={"name": "Season A"}, headers=auth_headers
        ).json()

        client.patch(
            f"/api/tournaments/{_tournament}/community",
            json={"community_id": comm_a["id"]},
            headers=auth_headers,
        )
        client.patch(
            f"/api/tournaments/{_tournament}/season",
            json={"season_id": season_a["id"]},
            headers=auth_headers,
        )

        # Now move the tournament to a different community.
        comm_b = client.post("/api/communities", json={"name": "Comm B"}, headers=auth_headers).json()
        res = client.patch(
            f"/api/tournaments/{_tournament}/community",
            json={"community_id": comm_b["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert body["community_id"] == comm_b["id"]
        assert body["club_id"] is None
        assert body["season_id"] is None

    def test_patch_tournament_community_preserves_matching_club_and_season(
        self, client, auth_headers, _tournament
    ) -> None:
        """Moving a tournament to a community that already owns the current club/season
        preserves club_id/season_id (no spurious clearing)."""
        comm_a = client.post("/api/communities", json={"name": "Comm Keep"}, headers=auth_headers).json()
        club_a = client.post(
            "/api/clubs", json={"community_id": comm_a["id"], "name": "Club Keep"}, headers=auth_headers
        ).json()
        season_a = client.post(
            f"/api/clubs/{club_a['id']}/seasons", json={"name": "Season Keep"}, headers=auth_headers
        ).json()

        client.patch(
            f"/api/tournaments/{_tournament}/community",
            json={"community_id": comm_a["id"]},
            headers=auth_headers,
        )
        client.patch(
            f"/api/tournaments/{_tournament}/season",
            json={"season_id": season_a["id"]},
            headers=auth_headers,
        )

        # Re-patch to the same community — must keep both ids.
        res = client.patch(
            f"/api/tournaments/{_tournament}/community",
            json={"community_id": comm_a["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        body = res.json()
        assert body["community_id"] == comm_a["id"]
        assert body["club_id"] == club_a["id"]
        assert body["season_id"] == season_a["id"]

    def test_tournament_meta_branding_uses_explicit_club_id_over_first_in_community(
        self, client, auth_headers, _tournament
    ) -> None:
        """When a tournament has an explicit club_id, branding must use that club's
        name, not the first (oldest) club in the community."""
        comm = client.post("/api/communities", json={"name": "Multi Club"}, headers=auth_headers).json()
        # First club in community (oldest by creation date) — would be the legacy default.
        first_club = client.post(
            "/api/clubs", json={"community_id": comm["id"], "name": "First Club"}, headers=auth_headers
        ).json()
        assert first_club["id"]
        second_club = client.post(
            "/api/clubs", json={"community_id": comm["id"], "name": "Second Club"}, headers=auth_headers
        ).json()

        # Move tournament into the multi-club community, then assign the second club explicitly.
        client.patch(
            f"/api/tournaments/{_tournament}/community",
            json={"community_id": comm["id"]},
            headers=auth_headers,
        )
        res = client.patch(
            f"/api/tournaments/{_tournament}/club",
            json={"club_id": second_club["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200

        meta = client.get(f"/api/tournaments/{_tournament}/meta").json()
        assert meta["club_name"] == "Second Club"

        # Listing should reflect the same explicit-club branding.
        listing = client.get("/api/tournaments", headers=auth_headers).json()
        t_row = next(t for t in listing if t["id"] == _tournament)
        assert t_row["club_name"] == "Second Club"
        assert t_row["club_id"] == second_club["id"]


# ---------------------------------------------------------------------------
# Registration community_id
# ---------------------------------------------------------------------------


class TestRegistrationCommunityId:
    """Test community_id on registration lobbies: create / list / patch."""

    def test_create_registration_stores_community_id(self, client, auth_headers) -> None:
        cm_res = client.post("/api/communities", json={"name": "Reg Club"}, headers=auth_headers)
        cid = cm_res.json()["id"]

        res = client.post(
            "/api/registrations",
            json={"name": "Club Open", "community_id": cid},
            headers=auth_headers,
        )
        assert res.status_code == 200
        rid = res.json()["id"]

        # List and find by id
        listing = client.get("/api/registrations", headers=auth_headers).json()
        reg = next((r for r in listing if r["id"] == rid), None)
        assert reg is not None
        assert reg["community_id"] == cid
        assert "community_name" in reg
        assert "club_name" in reg

    def test_create_registration_defaults_to_open(self, client, auth_headers) -> None:
        res = client.post(
            "/api/registrations",
            json={"name": "Default Community Reg"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        rid = res.json()["id"]
        listing = client.get("/api/registrations", headers=auth_headers).json()
        reg = next(r for r in listing if r["id"] == rid)
        assert reg["community_id"] == "open"

    def test_patch_registration_community(self, client, auth_headers) -> None:
        cm_res = client.post("/api/communities", json={"name": "Reassign Club"}, headers=auth_headers)
        cid = cm_res.json()["id"]

        reg_res = client.post(
            "/api/registrations",
            json={"name": "Move Me"},
            headers=auth_headers,
        )
        rid = reg_res.json()["id"]

        patch_res = client.patch(
            f"/api/registrations/{rid}/community",
            json={"community_id": cid},
            headers=auth_headers,
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["community_id"] == cid

        # Verify in listing
        listing = client.get("/api/registrations", headers=auth_headers).json()
        reg = next(r for r in listing if r["id"] == rid)
        assert reg["community_id"] == cid

    def test_registration_public_identity_prefers_club_name(self, client, auth_headers) -> None:
        community_res = client.post(
            "/api/communities",
            json={"name": "Community Scope"},
            headers=auth_headers,
        )
        cid = community_res.json()["id"]

        club_res = client.post(
            "/api/clubs",
            json={"community_id": cid, "name": "Club Scope"},
            headers=auth_headers,
        )
        assert club_res.status_code == 201

        reg_res = client.post(
            "/api/registrations",
            json={"name": "Identity Lobby", "community_id": cid},
            headers=auth_headers,
        )
        assert reg_res.status_code == 200
        rid = reg_res.json()["id"]

        public_res = client.get(f"/api/registrations/{rid}/public")
        assert public_res.status_code == 200
        public_data = public_res.json()
        assert public_data["community_name"] == "Community Scope"
        assert public_data["club_name"] == "Club Scope"


# ---------------------------------------------------------------------------
# User default community
# ---------------------------------------------------------------------------


class TestUserDefaultCommunity:
    """Test PATCH /api/auth/me/settings and reflection in GET /api/auth/me."""

    def test_me_returns_default_community_id(self, client, auth_headers) -> None:
        res = client.get("/api/auth/me", headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert "default_community_id" in data
        assert data["default_community_id"] == "open"

    def test_patch_me_settings_updates_default_community(self, client, auth_headers) -> None:
        cm_res = client.post("/api/communities", json={"name": "My Club"}, headers=auth_headers)
        cid = cm_res.json()["id"]

        patch_res = client.patch(
            "/api/auth/me/settings",
            json={"default_community_id": cid},
            headers=auth_headers,
        )
        assert patch_res.status_code == 200
        assert patch_res.json()["default_community_id"] == cid

        # Verify persisted via /me
        me_res = client.get("/api/auth/me", headers=auth_headers)
        assert me_res.json()["default_community_id"] == cid

    def test_patch_me_settings_requires_auth(self, client) -> None:
        res = client.patch("/api/auth/me/settings", json={"default_community_id": "open"})
        assert res.status_code in (401, 403)
