"""Tests for the Club management routes (CRUD, logo, tiers, player ELO)."""

from __future__ import annotations


import secrets as _secrets
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.api.routes_clubs import _MAX_LOGO_BYTES
from backend.api.db import get_db


@pytest.fixture()
def client():
    return TestClient(app)


def _create_community(client: TestClient, auth_headers: dict, name: str = "Test Club") -> dict:
    """Helper: create a community and return the response dict."""
    res = client.post("/api/communities", json={"name": name}, headers=auth_headers)
    assert res.status_code == 201
    return res.json()


def _create_club(client: TestClient, auth_headers: dict, community_id: str, name: str = "My Club") -> dict:
    """Helper: create a club wrapping a community and return the response dict."""
    res = client.post(
        "/api/clubs",
        json={"community_id": community_id, "name": name},
        headers=auth_headers,
    )
    assert res.status_code == 201
    return res.json()


# ---------------------------------------------------------------------------
# Club CRUD
# ---------------------------------------------------------------------------


class TestClubCRUD:
    """Test club list / create / update / delete endpoints."""

    def test_create_club(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        assert club["name"] == "My Club"
        assert club["community_id"] == comm["id"]
        assert club["id"].startswith("cl_")

    def test_create_club_does_not_sync_community_name(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers, name="Community Name Stays")
        _create_club(client, auth_headers, comm["id"], name="Club Has Own Name")
        res = client.get(f"/api/communities/{comm['id']}", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["name"] == "Community Name Stays"

    def test_list_clubs(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        _create_club(client, auth_headers, comm["id"])
        res = client.get("/api/clubs", headers=auth_headers)
        assert res.status_code == 200
        clubs = res.json()
        assert len(clubs) >= 1
        assert any(c["community_id"] == comm["id"] for c in clubs)

    def test_get_club(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.get(f"/api/clubs/{club['id']}", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["name"] == "My Club"

    def test_rename_club(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/clubs/{club['id']}",
            json={"name": "Renamed Club"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["name"] == "Renamed Club"

    def test_rename_club_does_not_sync_community_name(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers, name="Community Name Stays")
        club = _create_club(client, auth_headers, comm["id"], name="Original Club")
        res = client.patch(
            f"/api/clubs/{club['id']}",
            json={"name": "Renamed Club"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        community_res = client.get(f"/api/communities/{comm['id']}", headers=auth_headers)
        assert community_res.status_code == 200
        assert community_res.json()["name"] == "Community Name Stays"  # unchanged

    def test_delete_club(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.delete(f"/api/clubs/{club['id']}", headers=auth_headers)
        assert res.status_code == 200

        # Verify gone
        res = client.get(f"/api/clubs/{club['id']}", headers=auth_headers)
        assert res.status_code == 404

    def test_create_club_requires_auth(self, client) -> None:
        res = client.post("/api/clubs", json={"community_id": "open", "name": "X"})
        assert res.status_code in (401, 403)

    def test_multiple_clubs_per_community_allowed(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club1 = _create_club(client, auth_headers, comm["id"], name="First Club")
        res = client.post(
            "/api/clubs",
            json={"community_id": comm["id"], "name": "Second Club"},
            headers=auth_headers,
        )
        assert res.status_code == 201
        assert res.json()["id"] != club1["id"]
        assert res.json()["community_id"] == comm["id"]

    def test_get_nonexistent_club_404(self, client, auth_headers) -> None:
        res = client.get("/api/clubs/club_nonexist", headers=auth_headers)
        assert res.status_code == 404

    def test_any_authenticated_user_can_create_club(self, client, auth_headers, alice_headers) -> None:
        """Any authenticated user can create a club in any non-open community."""
        comm = _create_community(client, auth_headers)
        res = client.post(
            "/api/clubs",
            json={"community_id": comm["id"], "name": "Alice Club"},
            headers=alice_headers,
        )
        assert res.status_code == 201

    def test_user_cannot_create_club_when_permission_disabled(self, client, auth_headers, alice_headers) -> None:
        comm = _create_community(client, auth_headers)
        settings_res = client.patch(
            "/api/auth/users/alice/settings",
            json={"can_create_clubs": False},
            headers=auth_headers,
        )
        assert settings_res.status_code == 200

        res = client.post(
            "/api/clubs",
            json={"community_id": comm["id"], "name": "Blocked Club"},
            headers=alice_headers,
        )
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# Tiers
# ---------------------------------------------------------------------------


class TestClubTiers:
    """Test tier CRUD for a club."""

    def _setup(self, client, auth_headers):
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        return club

    def test_create_tier(self, client, auth_headers) -> None:
        club = self._setup(client, auth_headers)
        res = client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1500, "position": 1},
            headers=auth_headers,
        )
        assert res.status_code == 201
        data = res.json()
        assert data["name"] == "Gold"
        assert data["sport"] == "padel"
        assert data["base_elo"] == 1500
        assert data["position"] == 1

    def test_list_tiers(self, client, auth_headers) -> None:
        club = self._setup(client, auth_headers)
        client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1500, "position": 1},
            headers=auth_headers,
        )
        client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Silver", "sport": "tennis", "base_elo": 1200, "position": 2},
            headers=auth_headers,
        )
        res = client.get(f"/api/clubs/{club['id']}/tiers", headers=auth_headers)
        assert res.status_code == 200
        tiers = res.json()
        assert len(tiers) == 2

    def test_update_tier(self, client, auth_headers) -> None:
        club = self._setup(client, auth_headers)
        tier_res = client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1500, "position": 1},
            headers=auth_headers,
        )
        tier = tier_res.json()
        res = client.patch(
            f"/api/clubs/{club['id']}/tiers/{tier['id']}",
            json={"name": "Platinum", "base_elo": 1600},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["name"] == "Platinum"
        assert res.json()["base_elo"] == 1600

    def test_delete_tier(self, client, auth_headers) -> None:
        club = self._setup(client, auth_headers)
        tier_res = client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1500, "position": 1},
            headers=auth_headers,
        )
        tier = tier_res.json()
        res = client.delete(
            f"/api/clubs/{club['id']}/tiers/{tier['id']}",
            headers=auth_headers,
        )
        assert res.status_code == 200
        # Verify gone
        tiers = client.get(f"/api/clubs/{club['id']}/tiers", headers=auth_headers).json()
        assert len(tiers) == 0


# ---------------------------------------------------------------------------
# Player ELO management
# ---------------------------------------------------------------------------


class TestClubPlayerELO:
    """Test player ELO and tier assignment within a club."""

    def _setup_with_profile(self, client, auth_headers):
        """Create club + a player profile added to the club via API."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            conn.execute(
                "INSERT INTO player_profiles (id, name, email, passphrase, created_at) VALUES (?, ?, ?, ?, ?)",
                ("prof_test1", "Test Player", "test@example.com", "testphrase123", "2024-01-01T00:00:00+00:00"),
            )
        # Add via API so that profile_club_elo rows are created
        client.post(
            f"/api/clubs/{club['id']}/players",
            json={"profile_id": "prof_test1"},
            headers=auth_headers,
        )
        # Set an initial padel ELO so tests that depend on a specific value are stable
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/elo",
            json={"sport": "padel", "elo": 1200.0},
            headers=auth_headers,
        )
        return club, comm

    def test_list_players(self, client, auth_headers) -> None:
        club, comm = self._setup_with_profile(client, auth_headers)
        res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert res.status_code == 200
        players = res.json()
        assert len(players) >= 1
        found = [p for p in players if p["profile_id"] == "prof_test1"]
        assert len(found) == 1
        assert found[0]["name"] == "Test Player"

    def test_update_player_elo(self, client, auth_headers) -> None:
        club, comm = self._setup_with_profile(client, auth_headers)
        res = client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/elo",
            json={"sport": "padel", "elo": 1400.0},
            headers=auth_headers,
        )
        assert res.status_code == 200
        # Verify ELO changed in the club-local table
        with get_db() as conn:
            row = conn.execute(
                "SELECT elo FROM profile_club_elo WHERE profile_id = ? AND club_id = ? AND sport = ?",
                ("prof_test1", club["id"], "padel"),
            ).fetchone()
        assert row["elo"] == 1400.0

    def test_assign_player_tier(self, client, auth_headers) -> None:
        club, comm = self._setup_with_profile(client, auth_headers)
        # Also create a tennis ELO row
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/elo",
            json={"elo": 1100, "sport": "tennis"},
            headers=auth_headers,
        )
        # Create a tier first
        tier = client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1500, "position": 1},
            headers=auth_headers,
        ).json()
        # Assign tier to padel only
        res = client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/tier",
            json={"sport": "padel", "tier_id": tier["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        # Verify only padel row gets the tier; tennis row is unaffected
        with get_db() as conn:
            rows = conn.execute(
                "SELECT sport, tier_id FROM profile_club_elo WHERE profile_id = ? AND club_id = ? ORDER BY sport",
                ("prof_test1", club["id"]),
            ).fetchall()
        by_sport = {r["sport"]: r["tier_id"] for r in rows}
        assert by_sport["padel"] == tier["id"]
        assert by_sport["tennis"] is None  # tennis tier untouched

    def test_assign_player_tier_apply_base_elo_per_sport(self, client, auth_headers) -> None:
        """When apply_base_elo is True, the padel sport row gets the tier's base ELO; tennis is unaffected."""
        club, comm = self._setup_with_profile(client, auth_headers)
        # Create tennis ELO row too
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/elo",
            json={"elo": 1100, "sport": "tennis"},
            headers=auth_headers,
        )
        # Create a padel-only tier
        tier = client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1500, "position": 1},
            headers=auth_headers,
        ).json()
        assert tier["sport"] == "padel"
        # Assign padel tier with apply_base_elo=True
        res = client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/tier",
            json={"sport": "padel", "tier_id": tier["id"], "apply_base_elo": True},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["applied_base_elo"] is True
        assert res.json()["sport"] == "padel"
        # Verify padel ELO was reset; tennis ELO unchanged
        with get_db() as conn:
            rows = conn.execute(
                "SELECT sport, elo, tier_id FROM profile_club_elo WHERE profile_id = ? AND club_id = ? ORDER BY sport",
                ("prof_test1", club["id"]),
            ).fetchall()
        by_sport = {r["sport"]: dict(r) for r in rows}
        assert by_sport["padel"]["elo"] == 1500
        assert by_sport["padel"]["tier_id"] == tier["id"]
        assert by_sport["tennis"]["elo"] == 1100  # unchanged
        assert by_sport["tennis"]["tier_id"] is None  # not touched

    def test_remove_player_tier(self, client, auth_headers) -> None:
        club, comm = self._setup_with_profile(client, auth_headers)
        tier = client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1500, "position": 1},
            headers=auth_headers,
        ).json()
        # Assign then remove
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/tier",
            json={"sport": "padel", "tier_id": tier["id"]},
            headers=auth_headers,
        )
        res = client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/tier",
            json={"sport": "padel", "tier_id": None},
            headers=auth_headers,
        )
        assert res.status_code == 200
        with get_db() as conn:
            row = conn.execute(
                "SELECT tier_id FROM profile_club_elo WHERE profile_id = ? AND club_id = ? AND sport = ?",
                ("prof_test1", club["id"], "padel"),
            ).fetchone()
        assert row["tier_id"] is None

    def test_assign_player_tier_wrong_sport_rejected(self, client, auth_headers) -> None:
        """Assigning a padel tier to the tennis sport slot must return 422."""
        club, comm = self._setup_with_profile(client, auth_headers)
        tier = client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "sport": "padel", "base_elo": 1500, "position": 1},
            headers=auth_headers,
        ).json()
        res = client.patch(
            f"/api/clubs/{club['id']}/players/prof_test1/tier",
            json={"sport": "tennis", "tier_id": tier["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 422


# ---------------------------------------------------------------------------
# Club logo
# ---------------------------------------------------------------------------


class TestClubLogo:
    """Basic tests for club logo upload / delete / serve."""

    @staticmethod
    def _make_png(width: int = 64, height: int = 64) -> bytes:
        """Create a minimal valid PNG image using Pillow."""
        import io

        from PIL import Image

        img = Image.new("RGB", (width, height), color=(255, 0, 0))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def test_upload_logo(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        png = self._make_png()
        res = client.put(
            f"/api/clubs/{club['id']}/logo",
            files={"file": ("logo.png", png, "image/png")},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["ok"] is True

    def test_upload_logo_over_max_size_rejected(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        too_large = b"x" * (_MAX_LOGO_BYTES + 1)
        res = client.put(
            f"/api/clubs/{club['id']}/logo",
            files={"file": ("logo.png", too_large, "image/png")},
            headers=auth_headers,
        )
        assert res.status_code == 400
        assert "5 MB" in res.json()["detail"]

    def test_upload_logo_resizes_large_image(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        # Upload a 512×512 image — should be resized to 256×256
        big_png = self._make_png(512, 512)
        res = client.put(
            f"/api/clubs/{club['id']}/logo",
            files={"file": ("logo.png", big_png, "image/png")},
            headers=auth_headers,
        )
        assert res.status_code == 200
        # Serve and check it was saved as PNG
        serve = client.get(f"/api/clubs/{club['id']}/logo")
        assert serve.status_code == 200
        assert serve.headers["content-type"] == "image/png"

    def test_upload_jpeg_converted_to_png(self, client, auth_headers) -> None:
        import io

        from PIL import Image

        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        img = Image.new("RGB", (100, 100), color=(0, 128, 0))
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        jpeg_data = buf.getvalue()
        res = client.put(
            f"/api/clubs/{club['id']}/logo",
            files={"file": ("logo.jpg", jpeg_data, "image/jpeg")},
            headers=auth_headers,
        )
        assert res.status_code == 200

    def test_serve_logo_after_upload(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        png = self._make_png()
        client.put(
            f"/api/clubs/{club['id']}/logo",
            files={"file": ("logo.png", png, "image/png")},
            headers=auth_headers,
        )
        res = client.get(f"/api/clubs/{club['id']}/logo")
        assert res.status_code == 200

    def test_delete_logo(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        png = self._make_png()
        client.put(
            f"/api/clubs/{club['id']}/logo",
            files={"file": ("logo.png", png, "image/png")},
            headers=auth_headers,
        )
        res = client.delete(f"/api/clubs/{club['id']}/logo", headers=auth_headers)
        assert res.status_code == 200

    def test_get_logo_no_upload_404(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.get(f"/api/clubs/{club['id']}/logo")
        assert res.status_code == 404

    def test_by_community_returns_club_info(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.get(f"/api/clubs/by-community/{comm['id']}")
        assert res.status_code == 200
        data = res.json()
        assert data["id"] == club["id"]
        assert data["has_logo"] is False
        assert data["logo_url"] is None

    def test_by_community_with_logo(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        png = self._make_png()
        client.put(
            f"/api/clubs/{club['id']}/logo",
            files={"file": ("logo.png", png, "image/png")},
            headers=auth_headers,
        )
        res = client.get(f"/api/clubs/by-community/{comm['id']}")
        assert res.status_code == 200
        data = res.json()
        assert data["has_logo"] is True
        assert data["logo_url"] == f"/api/clubs/{club['id']}/logo"

    def test_by_community_no_club_404(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        res = client.get(f"/api/clubs/by-community/{comm['id']}")
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# Delete club cascading
# ---------------------------------------------------------------------------


class TestClubDeleteCascade:
    """Verify deleting a club removes tiers and seasons."""

    def test_delete_club_removes_tiers(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.post(
            f"/api/clubs/{club['id']}/tiers",
            json={"name": "Gold", "base_elo_padel": 1500, "base_elo_tennis": 1400, "position": 1},
            headers=auth_headers,
        )
        client.delete(f"/api/clubs/{club['id']}", headers=auth_headers)
        with get_db() as conn:
            tiers = conn.execute("SELECT * FROM club_tiers WHERE club_id = ?", (club["id"],)).fetchall()
        assert len(tiers) == 0

    def test_delete_club_removes_seasons(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.post(
            f"/api/clubs/{club['id']}/seasons",
            json={"name": "Season 1"},
            headers=auth_headers,
        )
        client.delete(f"/api/clubs/{club['id']}", headers=auth_headers)
        with get_db() as conn:
            seasons = conn.execute("SELECT * FROM seasons WHERE club_id = ?", (club["id"],)).fetchall()
        assert len(seasons) == 0

    def test_delete_club_clears_in_memory_tournament_refs(self, client, auth_headers) -> None:
        """Deleting a club must clear stale ``club_id``/``season_id`` from the
        in-memory tournaments cache (FK cascades NULL the DB rows; in-memory
        state must follow)."""
        from backend.api.state import _tournaments

        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        season = client.post(
            f"/api/clubs/{club['id']}/seasons",
            json={"name": "S1"},
            headers=auth_headers,
        ).json()
        body = {
            "name": "Mem Sync",
            "player_names": ["A", "B", "C", "D"],
            "team_mode": False,
            "court_names": ["C1"],
            "num_groups": 1,
            "top_per_group": 1,
            "double_elimination": False,
        }
        tid = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers).json()["id"]
        client.patch(
            f"/api/tournaments/{tid}/community",
            json={"community_id": comm["id"]},
            headers=auth_headers,
        )
        client.patch(
            f"/api/tournaments/{tid}/season",
            json={"season_id": season["id"]},
            headers=auth_headers,
        )
        assert _tournaments[tid]["club_id"] == club["id"]
        assert _tournaments[tid]["season_id"] == season["id"]

        res = client.delete(f"/api/clubs/{club['id']}", headers=auth_headers)
        assert res.status_code == 200
        assert _tournaments[tid]["club_id"] is None
        assert _tournaments[tid]["season_id"] is None

    def test_resolve_club_for_scope_ignores_cross_community_club_id(self, client, auth_headers) -> None:
        """An explicit ``club_id`` pointing to a different community is ignored
        and the function falls back to the first club in the requested community."""
        from backend.api.routes_clubs import resolve_club_for_scope

        comm_a = _create_community(client, auth_headers, name="Comm A Resolve")
        comm_b = _create_community(client, auth_headers, name="Comm B Resolve")
        club_a = _create_club(client, auth_headers, comm_a["id"], name="Club A Resolve")
        club_b = _create_club(client, auth_headers, comm_b["id"], name="Club B Resolve")

        # Explicit club_a but request community_b → must fall back to club_b.
        resolved = resolve_club_for_scope(comm_b["id"], club_a["id"])
        assert resolved is not None
        assert resolved.id == club_b["id"]

        # Same community → explicit club is honored.
        resolved_same = resolve_club_for_scope(comm_a["id"], club_a["id"])
        assert resolved_same is not None
        assert resolved_same.id == club_a["id"]


# ---------------------------------------------------------------------------
# Club scoping (Block B)
# ---------------------------------------------------------------------------


class TestClubScoping:
    """Verify list_clubs returns only owned + shared clubs for non-admins."""

    def test_owner_sees_own_club(self, client, auth_headers, alice_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, alice_headers, comm["id"])
        res = client.get("/api/clubs", headers=alice_headers)
        assert res.status_code == 200
        ids = [c["id"] for c in res.json()]
        assert club["id"] in ids

    def test_other_user_cannot_see_club(self, client, auth_headers, alice_headers, bob_headers) -> None:
        comm = _create_community(client, auth_headers)
        _create_club(client, alice_headers, comm["id"])
        res = client.get("/api/clubs", headers=bob_headers)
        assert res.status_code == 200
        assert res.json() == []

    def test_shared_club_visible_to_co_editor(self, client, auth_headers, alice_headers, bob_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, alice_headers, comm["id"])
        # Alice shares the club with bob
        res = client.post(
            f"/api/clubs/{club['id']}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        assert res.status_code == 201
        # Bob can now see it in his list
        res = client.get("/api/clubs", headers=bob_headers)
        assert res.status_code == 200
        found = [c for c in res.json() if c["id"] == club["id"]]
        assert len(found) == 1
        assert found[0]["shared"] is True

    def test_admin_sees_all_clubs(self, client, auth_headers, alice_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, alice_headers, comm["id"])
        res = client.get("/api/clubs", headers=auth_headers)
        assert res.status_code == 200
        ids = [c["id"] for c in res.json()]
        assert club["id"] in ids


# ---------------------------------------------------------------------------
# Club Collaborators (Block A)
# ---------------------------------------------------------------------------


class TestClubCollaborators:
    """Tests for co-editor (collaborator) CRUD on clubs."""

    def test_list_collaborators_empty(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.get(f"/api/clubs/{club['id']}/collaborators", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["collaborators"] == []

    def test_add_and_list_collaborator(self, client, auth_headers, alice_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.post(
            f"/api/clubs/{club['id']}/collaborators",
            json={"username": "alice"},
            headers=auth_headers,
        )
        assert res.status_code == 201
        res = client.get(f"/api/clubs/{club['id']}/collaborators", headers=auth_headers)
        assert "alice" in res.json()["collaborators"]

    def test_add_duplicate_collaborator_is_idempotent(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.post(f"/api/clubs/{club['id']}/collaborators", json={"username": "alice"}, headers=auth_headers)
        res = client.post(f"/api/clubs/{club['id']}/collaborators", json={"username": "alice"}, headers=auth_headers)
        assert res.status_code == 201
        collabs = client.get(f"/api/clubs/{club['id']}/collaborators", headers=auth_headers).json()["collaborators"]
        assert collabs.count("alice") == 1

    def test_remove_collaborator(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.post(f"/api/clubs/{club['id']}/collaborators", json={"username": "alice"}, headers=auth_headers)
        res = client.delete(f"/api/clubs/{club['id']}/collaborators/alice", headers=auth_headers)
        assert res.status_code == 200
        collabs = client.get(f"/api/clubs/{club['id']}/collaborators", headers=auth_headers).json()["collaborators"]
        assert "alice" not in collabs

    def test_editor_can_update_club_but_not_delete(self, client, auth_headers, alice_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.post(f"/api/clubs/{club['id']}/collaborators", json={"username": "alice"}, headers=auth_headers)
        # alice can update club name
        res = client.patch(f"/api/clubs/{club['id']}", json={"name": "Updated"}, headers=alice_headers)
        assert res.status_code == 200
        # alice cannot delete the club
        res = client.delete(f"/api/clubs/{club['id']}", headers=alice_headers)
        assert res.status_code == 403

    def test_non_owner_cannot_add_collaborators(self, client, auth_headers, alice_headers, bob_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, alice_headers, comm["id"])
        # bob is not even a co-editor — should get 403
        res = client.post(
            f"/api/clubs/{club['id']}/collaborators",
            json={"username": "bob"},
            headers=bob_headers,
        )
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# Add/Remove player explicitly (Block C)
# ---------------------------------------------------------------------------


class TestClubAddRemovePlayer:
    """Tests for explicit add/remove of players from a club community."""

    def _make_profile(self, conn, profile_id: str = "prof_new") -> None:
        conn.execute(
            "INSERT INTO player_profiles (id, name, email, passphrase, created_at) VALUES (?, ?, ?, ?, ?)",
            (profile_id, "New Player", "new@example.com", f"phrase-{profile_id}", "2024-01-01T00:00:00+00:00"),
        )

    def test_add_player_creates_elo_row(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        res = client.post(
            f"/api/clubs/{club['id']}/players",
            json={"profile_id": "prof_new"},
            headers=auth_headers,
        )
        assert res.status_code == 201
        with get_db() as conn:
            rows = conn.execute(
                "SELECT sport FROM profile_club_elo WHERE profile_id = 'prof_new' AND club_id = ?",
                (club["id"],),
            ).fetchall()
        sports = {r["sport"] for r in rows}
        assert sports == {"padel", "tennis"}

    def test_add_player_appears_in_list(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert res.status_code == 200
        ids = [p["profile_id"] for p in res.json()]
        assert "prof_new" in ids

    def test_player_list_includes_email_field(self, client, auth_headers) -> None:
        """Club player list includes profile email for invitation UX."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert res.status_code == 200
        row = next((p for p in res.json() if p["profile_id"] == "prof_new"), None)
        assert row is not None
        assert row["email"] == "new@example.com"

    def test_player_list_includes_hub_status_marker(self, client, auth_headers) -> None:
        """Club player list marks whether a player has a real Player Hub profile."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert res.status_code == 200
        row = next((p for p in res.json() if p["profile_id"] == "prof_new"), None)
        assert row is not None
        assert row["has_hub_profile"] is True

    def test_list_players_does_not_auto_sync_from_community_elo(self, client, auth_headers) -> None:
        """Hub profiles in the community are NOT auto-added to the club roster.

        Automatic addition is scoped to participation in this club's events
        only.  Cross-community hub profiles are surfaced via the
        ``/players/candidates`` search instead.
        """
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])

        with get_db() as conn:
            self._make_profile(conn, profile_id="prof_auto")
            conn.execute(
                """
                INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                VALUES (?, ?, ?, ?, ?)
                """,
                ("prof_auto", comm["id"], "padel", 1234.0, 7),
            )

        res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert res.status_code == 200
        assert not any(p["profile_id"] == "prof_auto" for p in res.json())

    def test_list_players_reflects_club_tournament_matches(self, client, auth_headers) -> None:
        """Club leaderboard reflects matches and ELO from this club's tournaments live."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn, profile_id="prof_live")
            # Add the profile to the club (creates profile_club_elo rows).
        client.post(
            f"/api/clubs/{club['id']}/players",
            json={"profile_id": "prof_live"},
            headers=auth_headers,
        )

        # Simulate a club-scoped tournament with this profile playing 3 padel matches.
        now = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO tournaments (id, name, type, owner, tournament_blob,
                                         sport, community_id, club_id)
                VALUES (?, ?, 'mexicano', 'admin', X'80', 'padel', ?, ?)
                """,
                ("t_live_club", "Club Tournament", comm["id"], club["id"]),
            )
            conn.execute(
                """
                INSERT INTO player_secrets
                    (tournament_id, player_id, player_name, passphrase, token,
                     email, contact, profile_id)
                VALUES (?, ?, ?, ?, ?, '', '', ?)
                """,
                ("t_live_club", "p_live", "Live Player", "live-pass", "tok-live", "prof_live"),
            )
            for idx in range(3):
                elo_after = 1180.0 if idx == 2 else 1100.0 + idx
                conn.execute(
                    """
                    INSERT INTO player_elo_log
                        (tournament_id, sport, match_id, player_id, match_order,
                         elo_before, elo_after, elo_delta, match_payload, updated_at)
                    VALUES (?, 'padel', ?, ?, ?, 1000.0, ?, ?, '{}', ?)
                    """,
                    ("t_live_club", f"m-{idx}", "p_live", idx + 1, elo_after, elo_after - 1000.0, now),
                )

        res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert res.status_code == 200
        row = next((p for p in res.json() if p["profile_id"] == "prof_live"), None)
        assert row is not None
        assert row["matches_padel"] == 3
        assert row["elo_padel"] == 1180.0
        # No tennis matches recorded -> default snapshot is preserved.
        assert row["matches_tennis"] == 0

    def test_list_players_auto_syncs_unlinked_past_participant_as_ghost(self, client, auth_headers) -> None:
        """Unlinked tournament participants are hidden from main roster and appear in possible-members."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])

        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO tournaments (id, name, type, owner, tournament_blob, sport, community_id, club_id)
                VALUES (?, ?, 'mexicano', 'admin', X'80', 'padel', ?, ?)
                """,
                ("t_auto_ghost", "Auto Ghost", comm["id"], club["id"]),
            )
            conn.execute(
                """
                INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, email, contact)
                VALUES (?, ?, ?, ?, ?, '', '')
                """,
                ("t_auto_ghost", "legacy_1", "Legacy Player", "legacy-pass", "legacy-token"),
            )

        # Ghost profiles must NOT appear in the main club roster (opt-in roster architecture)
        res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert res.status_code == 200
        assert not any(p["profile_id"] == "ghost_legacy_1" for p in res.json())

        # Ghost profiles appear in the possible-members endpoint instead
        pm_res = client.get(f"/api/clubs/{club['id']}/players/possible-members", headers=auth_headers)
        assert pm_res.status_code == 200
        row = next((p for p in pm_res.json() if p["profile_id"] == "ghost_legacy_1"), None)
        assert row is not None
        assert row["name"] == "Legacy Player"
        assert row["has_hub_profile"] is False

        # profile_club_elo rows exist for both sports
        with get_db() as conn:
            rows = conn.execute(
                "SELECT sport FROM profile_club_elo WHERE profile_id = ? AND club_id = ?",
                ("ghost_legacy_1", club["id"]),
            ).fetchall()
        assert {r["sport"] for r in rows} == {"padel", "tennis"}

    def test_search_candidates_returns_club_past_participants_only(self, client, auth_headers) -> None:
        """Club candidate search includes only past participants from that club's community."""
        comm_a = _create_community(client, auth_headers, name="Club A")
        comm_b = _create_community(client, auth_headers, name="Club B")
        club_a = _create_club(client, auth_headers, comm_a["id"], name="Club A")

        with get_db() as conn:
            conn.execute(
                "INSERT INTO tournaments (id, name, type, owner, tournament_blob, sport, community_id) VALUES (?, ?, 'mexicano', 'admin', X'80', 'padel', ?)",
                ("t_club_a", "A Tourney", comm_a["id"]),
            )
            conn.execute(
                "INSERT INTO tournaments (id, name, type, owner, tournament_blob, sport, community_id) VALUES (?, ?, 'mexicano', 'admin', X'80', 'padel', ?)",
                ("t_club_b", "B Tourney", comm_b["id"]),
            )
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, email, contact) VALUES (?, ?, ?, ?, ?, '', '')",
                ("t_club_a", "past_a_1", "Past A Player", "pp-a-1", "tok-a-1"),
            )
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, email, contact) VALUES (?, ?, ?, ?, ?, '', '')",
                ("t_club_b", "past_b_1", "Past B Player", "pp-b-1", "tok-b-1"),
            )

        res = client.get(
            f"/api/clubs/{club_a['id']}/players/candidates?q=Past",
            headers=auth_headers,
        )
        assert res.status_code == 200
        rows = res.json()
        ids = {r.get("past_player_id") for r in rows if r.get("past_player_id")}
        assert "past_a_1" in ids
        assert "past_b_1" not in ids

    def test_search_candidates_excludes_hub_profiles_outside_club_community(self, client, auth_headers) -> None:
        """Hub profile candidates are scoped to the club's community via profile_community_elo."""
        comm_a = _create_community(client, auth_headers, name="Cand Comm A")
        comm_b = _create_community(client, auth_headers, name="Cand Comm B")
        club_a = _create_club(client, auth_headers, comm_a["id"], name="Cand Club A")

        with get_db() as conn:
            # Two hub profiles with the same searchable substring.
            for pid, name in (("prof_in_a", "Searchable In A"), ("prof_in_b", "Searchable In B")):
                conn.execute(
                    """
                    INSERT INTO player_profiles
                        (id, passphrase, name, email, is_ghost, created_at)
                    VALUES (?, ?, ?, '', 0, datetime('now'))
                    """,
                    (pid, f"pp-{pid}", name),
                )
            # Profile A has a community_elo row in club A's community; B does not.
            conn.execute(
                "INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)"
                " VALUES (?, ?, 'padel', 1000, 0)",
                ("prof_in_a", comm_a["id"]),
            )
            conn.execute(
                "INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)"
                " VALUES (?, ?, 'padel', 1000, 0)",
                ("prof_in_b", comm_b["id"]),
            )

        res = client.get(
            f"/api/clubs/{club_a['id']}/players/candidates?q=Searchable",
            headers=auth_headers,
        )
        assert res.status_code == 200
        ids = {r.get("profile_id") for r in res.json() if r.get("profile_id")}
        assert "prof_in_a" in ids
        assert "prof_in_b" not in ids


class TestClubPlayerManagement:
    """Tests for adding, removing and listing players in a club."""

    def _make_profile(self, conn, profile_id: str = "prof_new") -> None:
        conn.execute(
            "INSERT INTO player_profiles (id, name, email, passphrase, created_at) VALUES (?, ?, ?, ?, ?)",
            (profile_id, "New Player", "new@example.com", "phrase", "2024-01-01T00:00:00+00:00"),
        )

    def test_add_nonexistent_player_returns_404(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.post(
            f"/api/clubs/{club['id']}/players",
            json={"profile_id": "does_not_exist"},
            headers=auth_headers,
        )
        assert res.status_code == 404

    def test_remove_player_hides_elo_rows(self, client, auth_headers) -> None:
        """Removing a player sets hidden=1; rows still exist but are not returned by list."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        res = client.delete(f"/api/clubs/{club['id']}/players/prof_new", headers=auth_headers)
        assert res.status_code == 200
        # Rows must exist but be hidden=1
        with get_db() as conn:
            rows = conn.execute(
                "SELECT hidden FROM profile_club_elo WHERE profile_id = 'prof_new' AND club_id = ?",
                (club["id"],),
            ).fetchall()
        assert len(rows) > 0
        assert all(r["hidden"] == 1 for r in rows)
        # Player must not appear in the list endpoint anymore
        list_res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert list_res.status_code == 200
        assert all(p["profile_id"] != "prof_new" for p in list_res.json())

    def test_zero_match_players_appear_in_list(self, client, auth_headers) -> None:
        """Players with 0 matches must be visible in the club player list."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert res.status_code == 200
        ids = [p["profile_id"] for p in res.json()]
        assert "prof_new" in ids

    def test_hide_from_single_sport_keeps_player_in_list_with_flag(self, client, auth_headers) -> None:
        """Hiding from padel only keeps the player in list but marks hidden_padel=True."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)

        res = client.patch(
            f"/api/clubs/{club['id']}/players/prof_new/sport-visibility",
            json={"sport": "padel", "hidden": True},
            headers=auth_headers,
        )
        assert res.status_code == 200

        list_res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert list_res.status_code == 200
        row = next((p for p in list_res.json() if p["profile_id"] == "prof_new"), None)
        assert row is not None, "player should still appear in list (tennis row is visible)"
        assert row["hidden_padel"] is True
        assert row["hidden_tennis"] is False

    def test_hide_from_padel_excludes_db_row(self, client, auth_headers) -> None:
        """Hiding from padel sets the padel DB row to hidden=1, tennis row stays hidden=0."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_new/sport-visibility",
            json={"sport": "padel", "hidden": True},
            headers=auth_headers,
        )
        with get_db() as conn:
            rows = {
                r["sport"]: r["hidden"]
                for r in conn.execute(
                    "SELECT sport, hidden FROM profile_club_elo WHERE profile_id = 'prof_new' AND club_id = ?",
                    (club["id"],),
                ).fetchall()
            }
        assert rows["padel"] == 1
        assert rows["tennis"] == 0

    def test_restore_sport_visibility(self, client, auth_headers) -> None:
        """Restoring padel visibility clears the hidden flag and player returns to visible list."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_new/sport-visibility",
            json={"sport": "padel", "hidden": True},
            headers=auth_headers,
        )
        res = client.patch(
            f"/api/clubs/{club['id']}/players/prof_new/sport-visibility",
            json={"sport": "padel", "hidden": False},
            headers=auth_headers,
        )
        assert res.status_code == 200

        list_res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        row = next((p for p in list_res.json() if p["profile_id"] == "prof_new"), None)
        assert row is not None
        assert row["hidden_padel"] is False

    def test_hide_both_sports_removes_player_from_list(self, client, auth_headers) -> None:
        """Hiding a player from both sports removes them from the list entirely."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_new/sport-visibility",
            json={"sport": "padel", "hidden": True},
            headers=auth_headers,
        )
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_new/sport-visibility",
            json={"sport": "tennis", "hidden": True},
            headers=auth_headers,
        )
        list_res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert list_res.status_code == 200
        assert all(p["profile_id"] != "prof_new" for p in list_res.json())

    def test_player_hidden_from_sport_has_elo_value_preserved(self, client, auth_headers) -> None:
        """ELO value is returned even for hidden sport rows so admin can see it in the management table."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
            conn.execute(
                "INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches) VALUES (?, ?, ?, ?, ?)",
                ("prof_new", comm["id"], "padel", 1250.0, 5),
            )
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_new/sport-visibility",
            json={"sport": "padel", "hidden": True},
            headers=auth_headers,
        )
        list_res = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        row = next((p for p in list_res.json() if p["profile_id"] == "prof_new"), None)
        assert row is not None
        assert row["elo_padel"] is not None
        assert row["hidden_padel"] is True

    def test_list_players_sport_filter_excludes_hidden_players_for_that_sport(self, client, auth_headers) -> None:
        """Tournament creation can request only players visible for a given sport."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)
        client.patch(
            f"/api/clubs/{club['id']}/players/prof_new/sport-visibility",
            json={"sport": "padel", "hidden": True},
            headers=auth_headers,
        )

        padel_res = client.get(f"/api/clubs/{club['id']}/players?sport=padel", headers=auth_headers)
        tennis_res = client.get(f"/api/clubs/{club['id']}/players?sport=tennis", headers=auth_headers)

        assert padel_res.status_code == 200
        assert tennis_res.status_code == 200
        assert all(p["profile_id"] != "prof_new" for p in padel_res.json())
        assert any(p["profile_id"] == "prof_new" for p in tennis_res.json())

    def test_list_players_sport_filter_keeps_matching_sport_elo(self, client, auth_headers) -> None:
        """Sport-filtered club list still returns the requested sport ELO for import into tournament creation."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            self._make_profile(conn)
            conn.execute(
                "INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches) VALUES (?, ?, ?, ?, ?)",
                ("prof_new", comm["id"], "tennis", 1380.0, 9),
            )
        client.post(f"/api/clubs/{club['id']}/players", json={"profile_id": "prof_new"}, headers=auth_headers)

        res = client.get(f"/api/clubs/{club['id']}/players?sport=tennis", headers=auth_headers)
        assert res.status_code == 200
        row = next((p for p in res.json() if p["profile_id"] == "prof_new"), None)
        assert row is not None
        assert row["elo_tennis"] == 1380.0


class TestClubMessaging:
    """Tests for lobby invite and announcement messaging routes."""

    def _seed_profile(self, conn, profile_id: str, name: str, email: str | None) -> None:
        conn.execute(
            "INSERT INTO player_profiles (id, name, email, passphrase, created_at) VALUES (?, ?, ?, ?, ?)",
            (profile_id, name, email, f"phrase-{profile_id}", "2024-01-01T00:00:00+00:00"),
        )

    def _seed_club_membership(self, conn, profile_id: str, club_id: str) -> None:
        conn.execute(
            "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches) VALUES (?, ?, ?, ?, ?)",
            (profile_id, club_id, "padel", 1000.0, 0),
        )

    def _create_registration(self, client, headers: dict, community_id: str) -> dict:
        res = client.post(
            "/api/registrations",
            json={"name": "Summer League", "sport": "padel", "community_id": community_id},
            headers=headers,
        )
        assert res.status_code == 200
        return res.json()

    # ── Lobby invite ────────────────────────────────────────────────────────

    def test_lobby_invite_sends_emails_and_reports_result(
        self, client, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        reg = self._create_registration(client, auth_headers, comm["id"])

        sent_to: list[str] = []

        def _capture(to_addr: str, *_args, **_kwargs) -> None:
            sent_to.append(to_addr)

        monkeypatch.setattr("backend.api.routes_clubs.send_email_background", _capture)

        with get_db() as conn:
            self._seed_profile(conn, "msg_ok", "Player OK", "ok@example.com")
            self._seed_profile(conn, "msg_no_email", "No Email", "invalid-email")
            self._seed_profile(conn, "msg_outside", "Outside", "outside@example.com")
            self._seed_club_membership(conn, "msg_ok", club["id"])
            self._seed_club_membership(conn, "msg_no_email", club["id"])

        res = client.post(
            f"/api/clubs/{club['id']}/players/invite-lobby",
            json={"profile_ids": ["msg_ok", "msg_no_email", "msg_outside"], "registration_id": reg["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["requested"] == 3
        assert data["sent"] == 1
        assert len(data["failed"]) == 2
        reasons = {f["profile_id"]: f["reason"] for f in data["failed"]}
        assert "email" in reasons["msg_no_email"].lower()
        assert reasons["msg_outside"] == "Player not found in this club"
        assert sent_to == ["ok@example.com"]

    def test_lobby_invite_rejects_wrong_community(self, client, auth_headers, monkeypatch: pytest.MonkeyPatch) -> None:
        comm1 = _create_community(client, auth_headers, name="Community 1")
        comm2 = _create_community(client, auth_headers, name="Community 2")
        club = _create_club(client, auth_headers, comm1["id"])
        reg_other = self._create_registration(client, auth_headers, comm2["id"])

        res = client.post(
            f"/api/clubs/{club['id']}/players/invite-lobby",
            json={"profile_ids": ["some_profile"], "registration_id": reg_other["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_lobby_invite_missing_registration_returns_404(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.post(
            f"/api/clubs/{club['id']}/players/invite-lobby",
            json={"profile_ids": ["some_profile"], "registration_id": "reg_doesnotexist"},
            headers=auth_headers,
        )
        assert res.status_code == 404

    # ── Announcement ────────────────────────────────────────────────────────

    def test_announce_sends_emails_and_reports_result(
        self, client, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])

        sent_calls: list[tuple[str, str]] = []  # (to, subject)

        def _capture(to_addr: str, subject: str, *_args, **_kwargs) -> None:
            sent_calls.append((to_addr, subject))

        monkeypatch.setattr("backend.api.routes_clubs.send_email_background", _capture)

        with get_db() as conn:
            self._seed_profile(conn, "ann_ok", "Anna", "anna@example.com")
            self._seed_profile(conn, "ann_no_email", "Bob", "")
            self._seed_club_membership(conn, "ann_ok", club["id"])
            self._seed_club_membership(conn, "ann_no_email", club["id"])

        res = client.post(
            f"/api/clubs/{club['id']}/players/announce",
            json={"profile_ids": ["ann_ok", "ann_no_email"], "subject": "Club news", "message": "See you Friday!"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["sent"] == 1
        assert len(data["failed"]) == 1
        assert sent_calls == [("anna@example.com", "Club news")]

    def test_announce_non_editor_forbidden(self, client, auth_headers, bob_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.post(
            f"/api/clubs/{club['id']}/players/announce",
            json={"profile_ids": ["some_profile"], "subject": "Hi", "message": "Hello"},
            headers=bob_headers,
        )
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# Email settings (Block E)
# ---------------------------------------------------------------------------


class TestClubEmailSettings:
    """Tests for GET/PATCH of club email settings."""

    def test_save_email_settings(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/clubs/{club['id']}/email-settings",
            json={"reply_to": "club@example.com", "sender_name": "My Club"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["reply_to"] == "club@example.com"

    def test_email_settings_persisted_in_club_detail(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.patch(
            f"/api/clubs/{club['id']}/email-settings",
            json={"reply_to": "club@example.com", "sender_name": "My Club"},
            headers=auth_headers,
        )
        res = client.get(f"/api/clubs/{club['id']}", headers=auth_headers)
        assert res.status_code == 200
        settings = res.json()["email_settings"]
        assert settings["reply_to"] == "club@example.com"
        assert settings["sender_name"] == "My Club"

    def test_editor_can_save_email_settings(self, client, auth_headers, alice_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.post(f"/api/clubs/{club['id']}/collaborators", json={"username": "alice"}, headers=auth_headers)
        res = client.patch(
            f"/api/clubs/{club['id']}/email-settings",
            json={"reply_to": "alice@example.com", "sender_name": "Alice"},
            headers=alice_headers,
        )
        assert res.status_code == 200

    def test_non_editor_cannot_save_email_settings(self, client, auth_headers, bob_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/clubs/{club['id']}/email-settings",
            json={"reply_to": "bob@example.com", "sender_name": "Bob"},
            headers=bob_headers,
        )
        assert res.status_code == 403


# ---------------------------------------------------------------------------
# Multi-club community (new model)
# ---------------------------------------------------------------------------


class TestMultiClubCommunity:
    """Verify that multiple clubs can exist in one community with independent ELO."""

    def test_two_clubs_in_same_community(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers, name="City")
        club1 = _create_club(client, auth_headers, comm["id"], name="North Club")
        club2 = _create_club(client, auth_headers, comm["id"], name="South Club")
        assert club1["id"] != club2["id"]
        assert club1["community_id"] == comm["id"]
        assert club2["community_id"] == comm["id"]

    def test_list_clubs_shows_all_clubs_in_community(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers, name="City")
        _create_club(client, auth_headers, comm["id"], name="Club 1")
        _create_club(client, auth_headers, comm["id"], name="Club 2")
        res = client.get("/api/clubs", headers=auth_headers)
        assert res.status_code == 200
        clubs = [c for c in res.json() if c["community_id"] == comm["id"]]
        assert len(clubs) == 2

    def test_player_elo_independent_per_club(self, client, auth_headers) -> None:
        """Same player in two clubs has independent ELO in each club."""
        comm = _create_community(client, auth_headers, name="City")
        club1 = _create_club(client, auth_headers, comm["id"], name="Club 1")
        club2 = _create_club(client, auth_headers, comm["id"], name="Club 2")
        with get_db() as conn:
            conn.execute(
                "INSERT INTO player_profiles (id, name, email, passphrase, created_at) VALUES (?, ?, ?, ?, ?)",
                ("prof_multi", "Multi Player", "multi@example.com", "multiphrase", "2024-01-01T00:00:00+00:00"),
            )
        client.post(f"/api/clubs/{club1['id']}/players", json={"profile_id": "prof_multi"}, headers=auth_headers)
        client.post(f"/api/clubs/{club2['id']}/players", json={"profile_id": "prof_multi"}, headers=auth_headers)
        # Set different ELOs in each club
        client.patch(
            f"/api/clubs/{club1['id']}/players/prof_multi/elo",
            json={"sport": "padel", "elo": 1300.0},
            headers=auth_headers,
        )
        client.patch(
            f"/api/clubs/{club2['id']}/players/prof_multi/elo",
            json={"sport": "padel", "elo": 1700.0},
            headers=auth_headers,
        )
        players1 = client.get(f"/api/clubs/{club1['id']}/players", headers=auth_headers).json()
        players2 = client.get(f"/api/clubs/{club2['id']}/players", headers=auth_headers).json()
        p1 = next(p for p in players1 if p["profile_id"] == "prof_multi")
        p2 = next(p for p in players2 if p["profile_id"] == "prof_multi")
        assert p1["elo_padel"] == 1300.0
        assert p2["elo_padel"] == 1700.0

    def test_removing_from_one_club_does_not_affect_other(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers, name="City")
        club1 = _create_club(client, auth_headers, comm["id"], name="Club 1")
        club2 = _create_club(client, auth_headers, comm["id"], name="Club 2")
        with get_db() as conn:
            conn.execute(
                "INSERT INTO player_profiles (id, name, email, passphrase, created_at) VALUES (?, ?, ?, ?, ?)",
                ("prof_two", "Two Club Player", "two@example.com", "twophrase", "2024-01-01T00:00:00+00:00"),
            )
        client.post(f"/api/clubs/{club1['id']}/players", json={"profile_id": "prof_two"}, headers=auth_headers)
        client.post(f"/api/clubs/{club2['id']}/players", json={"profile_id": "prof_two"}, headers=auth_headers)
        # Remove from club1 only
        client.delete(f"/api/clubs/{club1['id']}/players/prof_two", headers=auth_headers)
        # Player should still be in club2
        players2 = client.get(f"/api/clubs/{club2['id']}/players", headers=auth_headers).json()
        assert any(p["profile_id"] == "prof_two" for p in players2)
        # And absent from club1
        players1 = client.get(f"/api/clubs/{club1['id']}/players", headers=auth_headers).json()
        assert not any(p["profile_id"] == "prof_two" for p in players1)

    def test_club_names_independent_from_community(self, client, auth_headers) -> None:
        """Club names do not overwrite the parent community name."""
        comm = _create_community(client, auth_headers, name="City Community")
        _create_club(client, auth_headers, comm["id"], name="Club Alpha")
        res = client.get(f"/api/communities/{comm['id']}", headers=auth_headers)
        assert res.json()["name"] == "City Community"


# ---------------------------------------------------------------------------
# Club ghost profile deduplication
# ---------------------------------------------------------------------------


def _insert_club_ghost(conn, club_id: str, name: str, player_id_suffix: str) -> str:
    """Insert a ghost player_profiles row, link it to the club, and return the profile id."""
    ghost_id = f"ghost_club_{player_id_suffix}"
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT OR IGNORE INTO player_profiles
           (id, passphrase, name, email, contact, created_at, is_ghost)
           VALUES (?, ?, ?, '', '', ?, 1)""",
        (ghost_id, _secrets.token_hex(16), name, now),
    )
    for sport in ("padel", "tennis"):
        conn.execute(
            """INSERT OR IGNORE INTO profile_club_elo
               (profile_id, club_id, sport, elo, matches, hidden)
               VALUES (?, ?, ?, 1000.0, 0, 0)""",
            (ghost_id, club_id, sport),
        )
    return ghost_id


class TestClubGhostConsolidation:
    """Tests for ghost-duplicates detection and consolidate-ghosts endpoints."""

    def test_ghost_duplicates_returns_same_name_groups(self, client, auth_headers) -> None:
        """Endpoint returns groups with ≥ 2 ghost profiles sharing the same name."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            _insert_club_ghost(conn, club["id"], "Maria Garcia", "mg1")
            _insert_club_ghost(conn, club["id"], "maria garcia", "mg2")

        res = client.get(f"/api/clubs/{club['id']}/players/ghost-duplicates", headers=auth_headers)
        assert res.status_code == 200
        groups = res.json()
        assert len(groups) == 1
        assert len(groups[0]["profiles"]) == 2

    def test_ghost_duplicates_ignores_hub_profiles(self, client, auth_headers) -> None:
        """Non-ghost profiles (has_hub_profile) must not appear in duplicate groups."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        now = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            # Insert a real (non-ghost) profile with same name
            conn.execute(
                """INSERT OR IGNORE INTO player_profiles
                   (id, passphrase, name, email, contact, created_at, is_ghost)
                   VALUES (?, ?, ?, '', '', ?, 0)""",
                ("real_mg1", _secrets.token_hex(16), "Maria Garcia", now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden) VALUES (?, ?, 'padel', 1000.0, 0, 0)",
                ("real_mg1", club["id"]),
            )
            _insert_club_ghost(conn, club["id"], "Maria Garcia", "mg_real_dup")

        res = client.get(f"/api/clubs/{club['id']}/players/ghost-duplicates", headers=auth_headers)
        assert res.status_code == 200
        # Only ghosts counted — should be 0 groups (only 1 ghost of that name)
        assert len(res.json()) == 0

    def test_ghost_duplicates_includes_hidden(self, client, auth_headers) -> None:
        """Hidden ghost profiles still appear in duplicate groups so they can be merged."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            _insert_club_ghost(conn, club["id"], "Luis Perez", "lp1")
            _insert_club_ghost(conn, club["id"], "Luis Perez", "lp2")
            # Hide second profile (still counts for deduplication)
            conn.execute(
                "UPDATE profile_club_elo SET hidden = 1 WHERE profile_id = 'ghost_club_lp2'",
            )

        res = client.get(f"/api/clubs/{club['id']}/players/ghost-duplicates", headers=auth_headers)
        assert res.status_code == 200
        # Both ghosts (including hidden) → 1 duplicate group to merge
        assert len(res.json()) == 1

    def test_ghost_duplicates_empty_when_none(self, client, auth_headers) -> None:
        """Returns empty list when no duplicate ghost profiles exist."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.get(f"/api/clubs/{club['id']}/players/ghost-duplicates", headers=auth_headers)
        assert res.status_code == 200
        assert res.json() == []

    def test_consolidate_merges_ghosts_in_club(self, client, auth_headers) -> None:
        """POST consolidate-ghosts merges two ghost profiles into one."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid1 = _insert_club_ghost(conn, club["id"], "Pedro Santos", "ps1")
            gid2 = _insert_club_ghost(conn, club["id"], "Pedro Santos", "ps2")

        res = client.post(
            f"/api/clubs/{club['id']}/players/consolidate-ghosts",
            json={"source_ids": [gid1, gid2]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["profile_id"] == gid1

        # Secondary profile must be deleted
        with get_db() as conn:
            row = conn.execute("SELECT id FROM player_profiles WHERE id = ?", (gid2,)).fetchone()
        assert row is None

    def test_consolidate_allows_different_name_variants(self, client, auth_headers) -> None:
        """Consolidation works even when ghost profile names are not an exact match."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid1 = _insert_club_ghost(conn, club["id"], "Maria", "mv1")
            gid2 = _insert_club_ghost(conn, club["id"], "Maria Garcia", "mv2")

        res = client.post(
            f"/api/clubs/{club['id']}/players/consolidate-ghosts",
            json={"source_ids": [gid1, gid2], "name": "Maria Garcia"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["profile_id"] == gid1
        assert data["name"] == "Maria Garcia"

        with get_db() as conn:
            row = conn.execute("SELECT id FROM player_profiles WHERE id = ?", (gid2,)).fetchone()
        assert row is None

    def test_consolidate_renames_primary_when_name_given(self, client, auth_headers) -> None:
        """Providing a name updates the surviving profile's display name."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid1 = _insert_club_ghost(conn, club["id"], "Anna Old", "ao1")
            gid2 = _insert_club_ghost(conn, club["id"], "Anna Old", "ao2")

        res = client.post(
            f"/api/clubs/{club['id']}/players/consolidate-ghosts",
            json={"source_ids": [gid1, gid2], "name": "Anna New"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["name"] == "Anna New"

    def test_consolidate_rejects_non_ghost_profiles(self, client, auth_headers) -> None:
        """Consolidation of a non-ghost profile must return 422."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        now = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost) VALUES (?, ?, ?, '', '', ?, 0)",
                ("real_pr1", _secrets.token_hex(16), "Real Player", now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden) VALUES (?, ?, 'padel', 1000.0, 0, 0)",
                ("real_pr1", club["id"]),
            )
            gid = _insert_club_ghost(conn, club["id"], "Real Player", "rp_dup")

        res = client.post(
            f"/api/clubs/{club['id']}/players/consolidate-ghosts",
            json={"source_ids": ["real_pr1", gid]},
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_consolidate_requires_two_distinct_ids(self, client, auth_headers) -> None:
        """Passing fewer than 2 distinct IDs returns 422."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid = _insert_club_ghost(conn, club["id"], "Solo Ghost", "sg1")

        res = client.post(
            f"/api/clubs/{club['id']}/players/consolidate-ghosts",
            json={"source_ids": [gid, gid]},
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_consolidate_404_for_missing_profile(self, client, auth_headers) -> None:
        """Returns 404 when a given profile id does not exist."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid = _insert_club_ghost(conn, club["id"], "Ghost Only", "go1")

        res = client.post(
            f"/api/clubs/{club['id']}/players/consolidate-ghosts",
            json={"source_ids": [gid, "ghost_nonexistent_xyz"]},
            headers=auth_headers,
        )
        assert res.status_code == 404


class TestClubConvertGhost:
    """Tests for the club-scoped ghost-to-Hub-profile convert endpoint."""

    def test_convert_generates_passphrase_and_clears_ghost_flag(self, client, auth_headers) -> None:
        """Converted profile gets a 3-word passphrase and is_ghost=False in DB."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid = _insert_club_ghost(conn, club["id"], "Convert Club", "cc1")

        res = client.post(
            f"/api/clubs/{club['id']}/players/{gid}/convert-ghost",
            json={},
            headers=auth_headers,
        )
        assert res.status_code == 200
        data = res.json()
        assert data["profile_id"] == gid
        assert data["is_ghost"] is False
        assert data["passphrase"].count("-") >= 2, "Expected 3-word passphrase (hyphen-separated)"

    def test_convert_renames_profile_when_name_given(self, client, auth_headers) -> None:
        """Optional name parameter is reflected in the result."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid = _insert_club_ghost(conn, club["id"], "Old Club Name", "cc2")

        res = client.post(
            f"/api/clubs/{club['id']}/players/{gid}/convert-ghost",
            json={"name": "New Club Name"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["name"] == "New Club Name"

    def test_convert_sets_email(self, client, auth_headers) -> None:
        """Email provided on conversion is persisted."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid = _insert_club_ghost(conn, club["id"], "Email Club Ghost", "cc3")

        res = client.post(
            f"/api/clubs/{club['id']}/players/{gid}/convert-ghost",
            json={"email": "club@example.com"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["email"] == "club@example.com"

    def test_convert_rejects_non_ghost(self, client, auth_headers) -> None:
        """Attempting to convert a real profile returns 422."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        now = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
                " VALUES (?, ?, ?, '', '', ?, 0)",
                ("real-club-cv1", _secrets.token_hex(16), "Real Player", now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, 'padel', 1000.0, 0, 0)",
                ("real-club-cv1", club["id"]),
            )

        res = client.post(
            f"/api/clubs/{club['id']}/players/real-club-cv1/convert-ghost",
            json={},
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_convert_404_missing(self, client, auth_headers) -> None:
        """Returns 404 for a non-existent profile id."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.post(
            f"/api/clubs/{club['id']}/players/ghost_nonexistent_abc/convert-ghost",
            json={},
            headers=auth_headers,
        )
        assert res.status_code == 404


class TestClubPossibleMembers:
    """Tests for GET /{club_id}/players/possible-members."""

    def test_excludes_real_hub_profiles(self, client, auth_headers) -> None:
        """Real Hub profiles must not appear in possible-members."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        now = datetime.now(timezone.utc).isoformat()
        with get_db() as conn:
            conn.execute(
                "INSERT OR IGNORE INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
                " VALUES (?, ?, ?, '', '', ?, 0)",
                ("real-pm-test1", _secrets.token_hex(16), "Hub Player", now),
            )
            conn.execute(
                "INSERT OR IGNORE INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, 'padel', 1000.0, 0, 0)",
                ("real-pm-test1", club["id"]),
            )

        res = client.get(f"/api/clubs/{club['id']}/players/possible-members", headers=auth_headers)
        assert res.status_code == 200
        ids = [p["profile_id"] for p in res.json()]
        assert "real-pm-test1" not in ids

    def test_includes_hidden_ghost_profiles(self, client, auth_headers) -> None:
        """Possible-members shows hidden=1 ghost profiles so they can be actioned."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            _insert_club_ghost(conn, club["id"], "Hidden Ghost", "hg1")
            conn.execute("UPDATE profile_club_elo SET hidden = 1 WHERE profile_id = 'ghost_club_hg1'")

        res = client.get(f"/api/clubs/{club['id']}/players/possible-members", headers=auth_headers)
        assert res.status_code == 200
        ids = [p["profile_id"] for p in res.json()]
        assert "ghost_club_hg1" in ids

    def test_ghost_absent_from_main_roster(self, client, auth_headers) -> None:
        """Ghost profiles must not appear in the main GET /players list."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid = _insert_club_ghost(conn, club["id"], "Roster Ghost", "rg1")

        roster = client.get(f"/api/clubs/{club['id']}/players", headers=auth_headers)
        assert roster.status_code == 200
        assert not any(p["profile_id"] == gid for p in roster.json())

    def test_empty_when_no_ghost_profiles(self, client, auth_headers) -> None:
        """Returns an empty list when there are no ghost profiles for the club."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])

        res = client.get(f"/api/clubs/{club['id']}/players/possible-members", headers=auth_headers)
        assert res.status_code == 200
        assert res.json() == []

    def test_add_to_roster_moves_ghost_to_main_list(self, client, auth_headers) -> None:
        """POSTing profile_id un-hides the ghost so it shows up in main list.

        Note: ghost profiles never appear in the main list (is_ghost=0 filter),
        so the expected final state is: no longer in possible-members,
        but the profile_club_elo row has hidden=0.
        """
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            gid = _insert_club_ghost(conn, club["id"], "Add To Roster", "atr1")

        add_res = client.post(
            f"/api/clubs/{club['id']}/players",
            json={"profile_id": gid},
            headers=auth_headers,
        )
        assert add_res.status_code == 201

        with get_db() as conn:
            row = conn.execute(
                "SELECT hidden FROM profile_club_elo WHERE profile_id = ? AND club_id = ? AND sport = 'padel'",
                (gid, club["id"]),
            ).fetchone()
        assert row is not None
        assert row["hidden"] == 0


# ---------------------------------------------------------------------------
# Subdomain slug + public landing-page endpoints
# ---------------------------------------------------------------------------


class TestClubSlug:
    """PATCH /api/clubs/{id}/slug — set/clear/validate/conflict."""

    def test_set_and_get_slug(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/clubs/{club['id']}/slug",
            json={"slug": "myclub"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["slug"] == "myclub"

        get_res = client.get(f"/api/clubs/{club['id']}", headers=auth_headers)
        assert get_res.status_code == 200
        assert get_res.json()["slug"] == "myclub"

    def test_clear_slug(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.patch(f"/api/clubs/{club['id']}/slug", json={"slug": "todrop"}, headers=auth_headers)
        res = client.patch(f"/api/clubs/{club['id']}/slug", json={"slug": None}, headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["slug"] is None

    @pytest.mark.parametrize("bad", ["x", "A", "with space", "under_score"])
    def test_invalid_slug_rejected(self, client, auth_headers, bad) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/clubs/{club['id']}/slug",
            json={"slug": bad},
            headers=auth_headers,
        )
        assert res.status_code == 400

    @pytest.mark.parametrize("reserved", ["admin", "tv", "register", "api", "www"])
    def test_reserved_slug_rejected(self, client, auth_headers, reserved) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/clubs/{club['id']}/slug",
            json={"slug": reserved},
            headers=auth_headers,
        )
        assert res.status_code == 400

    def test_duplicate_slug_rejected(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        c1 = _create_club(client, auth_headers, comm["id"], name="One")
        c2 = _create_club(client, auth_headers, comm["id"], name="Two")
        client.patch(f"/api/clubs/{c1['id']}/slug", json={"slug": "shared"}, headers=auth_headers)
        res = client.patch(
            f"/api/clubs/{c2['id']}/slug",
            json={"slug": "shared"},
            headers=auth_headers,
        )
        assert res.status_code == 409


class TestClubBySlug:
    """GET /api/clubs/by-slug/{slug} — public lookup."""

    def test_resolve_known_slug(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.patch(f"/api/clubs/{club['id']}/slug", json={"slug": "found"}, headers=auth_headers)
        # Public — no auth header
        res = client.get("/api/clubs/by-slug/found")
        assert res.status_code == 200
        body = res.json()
        assert body["club_id"] == club["id"]
        assert body["slug"] == "found"
        assert body["name"] == club["name"]
        assert "email" not in body

    def test_unknown_slug_returns_404(self, client) -> None:
        res = client.get("/api/clubs/by-slug/does-not-exist")
        assert res.status_code == 404

    def test_reserved_slug_returns_404(self, client) -> None:
        res = client.get("/api/clubs/by-slug/admin")
        assert res.status_code == 404


class TestSubdomainRouter:
    """Heuristic + strict modes of the ``subdomain_router`` middleware."""

    def test_heuristic_serves_club_html_for_known_slug(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        client.patch(f"/api/clubs/{club['id']}/slug", json={"slug": "myclub"}, headers=auth_headers)
        # No AMISTOSO_DOMAIN env var → heuristic mode picks ``myclub`` from the host.
        res = client.get("/", headers={"host": "myclub.example.com"})
        assert res.status_code == 200
        assert "text/html" in res.headers["content-type"]
        # club.html ships a ``<body data-page="club">`` marker; a sufficient fingerprint
        # is that the response is NOT the admin SPA index.
        assert 'id="club-root"' in res.text or "club" in res.text.lower()

    def test_heuristic_404_for_unknown_slug(self, client) -> None:
        res = client.get("/", headers={"host": "nosuchclub.example.com"})
        assert res.status_code == 404

    def test_heuristic_skips_assets_on_unknown_subdomain(self, client) -> None:
        # Static / API requests on an unknown subdomain must fall through to the
        # apex routes so the 404 page itself can load its assets.
        res = client.get("/api/config", headers={"host": "nosuchclub.example.com"})
        assert res.status_code == 200

    def test_heuristic_ignores_apex_two_part_host(self, client) -> None:
        # ``example.com`` has only 2 parts → no subdomain → admin SPA served.
        res = client.get("/", headers={"host": "example.com"})
        assert res.status_code == 200

    def test_heuristic_ignores_reserved_label(self, client) -> None:
        res = client.get("/", headers={"host": "www.example.com"})
        assert res.status_code == 200

    def test_heuristic_ignores_bare_ip(self, client) -> None:
        res = client.get("/", headers={"host": "192.168.1.1"})
        assert res.status_code == 200

    def test_heuristic_ignores_onrender_service_host(self, client) -> None:
        # ``<service>.onrender.com`` is the app's own hostname on Render, not a
        # club subdomain — the apex must be served even without AMISTOSO_DOMAIN.
        res = client.get("/", headers={"host": "padel-amistoso.onrender.com"})
        assert res.status_code == 200


class TestPublicLeaderboard:
    """GET /api/clubs/{id}/public-leaderboard — no auth, no email."""

    def test_empty_club(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.get(f"/api/clubs/{club['id']}/public-leaderboard?sport=padel")
        assert res.status_code == 200
        assert res.json() == []

    def test_unknown_club(self, client) -> None:
        res = client.get("/api/clubs/cl_unknown/public-leaderboard")
        assert res.status_code == 404

    def test_no_email_in_response(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        # Seed one profile with a club ELO row + one match in a club tournament.
        with get_db() as conn:
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
                " VALUES (?, ?, ?, ?, '', ?, 0)",
                ("pp_lb1", _secrets.token_hex(8), "Leaderboard P1", "secret@example.com", now),
            )
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, 'padel', 1100, 0, 0)",
                ("pp_lb1", club["id"]),
            )
            conn.execute(
                "INSERT INTO tournaments (id, name, type, owner, public, tournament_blob, version,"
                " sport, community_id, created_at, club_id)"
                " VALUES (?, 'T', 'group_playoff', 'admin', 1, X'00', 0, 'padel', ?, ?, ?)",
                ("t_lb1", comm["id"], now, club["id"]),
            )
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)"
                " VALUES (?, ?, '', ?, ?, ?)",
                ("t_lb1", "pl1", _secrets.token_hex(8), _secrets.token_hex(8), "pp_lb1"),
            )
            conn.execute(
                "INSERT INTO player_elo_log (tournament_id, player_id, sport, elo_before, elo_after,"
                " elo_delta, match_id, match_payload, match_order, updated_at, is_manual)"
                " VALUES (?, ?, 'padel', 1000, 1100, 100, 'm1', '{}', 1, ?, 0)",
                ("t_lb1", "pl1", now),
            )
        res = client.get(f"/api/clubs/{club['id']}/public-leaderboard?sport=padel")
        assert res.status_code == 200
        rows = res.json()
        assert len(rows) == 1
        row = rows[0]
        assert row["name"] == "Leaderboard P1"
        assert row["matches"] == 1
        assert row["rank"] == 1
        assert row["elo"] == 1100.0
        assert "email" not in row


class TestPublicPlayerCard:
    """GET /api/clubs/{id}/players/{profile_id}/public-card — no auth, no email."""

    def _seed_player_with_match(self, client, auth_headers, *, hidden: bool = False):
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
                " VALUES (?, ?, ?, ?, '', ?, 0)",
                ("pp_card1", _secrets.token_hex(8), "Card Player", "secret@example.com", now),
            )
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, 'padel', 1175, 0, ?)",
                ("pp_card1", club["id"], 1 if hidden else 0),
            )
            conn.execute(
                "INSERT INTO tournaments (id, name, type, owner, public, tournament_blob, version,"
                " sport, community_id, created_at, club_id)"
                " VALUES (?, 'CardT', 'group_playoff', 'admin', 1, X'00', 0, 'padel', ?, ?, ?)",
                ("t_card1", comm["id"], now, club["id"]),
            )
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)"
                " VALUES (?, ?, '', ?, ?, ?)",
                ("t_card1", "plc1", _secrets.token_hex(8), _secrets.token_hex(8), "pp_card1"),
            )
            payload = '{"team1":[{"player_name":"Card Player"}],"team2":[{"player_name":"Opp"}],"score":[[6,3]]}'
            conn.execute(
                "INSERT INTO player_elo_log (tournament_id, player_id, sport, elo_before, elo_after,"
                " elo_delta, match_id, match_payload, match_order, updated_at, is_manual)"
                " VALUES (?, ?, 'padel', 1100, 1175, 75, 'mc1', ?, 1, ?, 0)",
                ("t_card1", "plc1", payload, now),
            )
        return club

    def test_unknown_club(self, client) -> None:
        res = client.get("/api/clubs/cl_missing/players/pp_x/public-card")
        assert res.status_code == 404

    def test_unknown_profile(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.get(f"/api/clubs/{club['id']}/players/pp_missing/public-card")
        assert res.status_code == 404

    def test_returns_stats_recent_and_no_email(self, client, auth_headers) -> None:
        club = self._seed_player_with_match(client, auth_headers)
        res = client.get(f"/api/clubs/{club['id']}/players/pp_card1/public-card")
        assert res.status_code == 200
        body = res.json()
        assert body["name"] == "Card Player"
        assert body["elo_padel"] == 1175.0
        assert body["matches_padel"] == 1
        assert body["rank_padel"] == 1
        assert body["elo_tennis"] is None
        assert body["matches_tennis"] == 0
        assert body["rank_tennis"] is None
        assert isinstance(body["recent_matches"], list)
        assert len(body["recent_matches"]) == 1
        rm = body["recent_matches"][0]
        assert rm["sport"] == "padel"
        assert rm["elo_after"] == 1175
        assert rm["team1"] == ["Card Player"]
        assert "email" not in body

    def test_tennis_recent_match_includes_sets(self, client, auth_headers) -> None:
        """recent_matches for tennis matches must include the sets array, not just the game total."""
        import json as _json

        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            now = datetime.now(timezone.utc).isoformat()
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
                " VALUES (?, ?, ?, ?, '', ?, 0)",
                ("pp_tennis1", _secrets.token_hex(8), "Tennis Player", "t@example.com", now),
            )
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)"
                " VALUES (?, ?, 'tennis', 1050, 0, 0)",
                ("pp_tennis1", club["id"]),
            )
            conn.execute(
                "INSERT INTO tournaments (id, name, type, owner, public, tournament_blob, version,"
                " sport, community_id, created_at, club_id)"
                " VALUES (?, 'TennisT', 'group_playoff', 'admin', 1, X'00', 0, 'tennis', ?, ?, ?)",
                ("t_tennis1", comm["id"], now, club["id"]),
            )
            conn.execute(
                "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id)"
                " VALUES (?, ?, '', ?, ?, ?)",
                ("t_tennis1", "plt1", _secrets.token_hex(8), _secrets.token_hex(8), "pp_tennis1"),
            )
            sets = [[6, 4], [3, 6], [7, 5]]
            mp = _json.dumps(
                {
                    "team1": [{"player_name": "Tennis Player"}],
                    "team2": [{"player_name": "Opp"}],
                    "score": [16, 15],
                    "sets": sets,
                }
            )
            conn.execute(
                "INSERT INTO player_elo_log (tournament_id, player_id, sport, elo_before, elo_after,"
                " elo_delta, match_id, match_payload, match_order, updated_at, is_manual)"
                " VALUES (?, ?, 'tennis', 1000, 1050, 50, 'mt1', ?, 1, ?, 0)",
                ("t_tennis1", "plt1", mp, now),
            )
        res = client.get(f"/api/clubs/{club['id']}/players/pp_tennis1/public-card")
        assert res.status_code == 200
        body = res.json()
        assert len(body["recent_matches"]) == 1
        rm = body["recent_matches"][0]
        assert rm["sport"] == "tennis"
        assert rm["sets"] == [[6, 4], [3, 6], [7, 5]], "sets must be forwarded to the mini-card payload"
        assert rm["score"] == [16, 15]

    def test_hidden_player_hides_elo_and_tier(self, client, auth_headers) -> None:
        # A profile that is hidden in every sport is not exposed at all.
        club = self._seed_player_with_match(client, auth_headers, hidden=True)
        res = client.get(f"/api/clubs/{club['id']}/players/pp_card1/public-card")
        assert res.status_code == 404


class TestLeaderboardCacheReuse:
    """``_compute_club_leaderboard_rows`` caches behind a version key."""

    def test_repeat_calls_use_cache(self, client, auth_headers) -> None:
        from backend.api import leaderboard_cache, routes_clubs

        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        leaderboard_cache.invalidate_leaderboard_cache(club["id"])
        with get_db() as conn:
            rows1 = routes_clubs._compute_club_leaderboard_rows(conn, club["id"])
            cached1 = leaderboard_cache._LEADERBOARD_CACHE.get(club["id"])
            rows2 = routes_clubs._compute_club_leaderboard_rows(conn, club["id"])
            cached2 = leaderboard_cache._LEADERBOARD_CACHE.get(club["id"])
        assert rows1 == rows2
        # Same in-memory list object (no recomputation) when version unchanged.
        assert cached1 is cached2
        assert rows2 is cached2[1]

    def test_invalidate_drops_cached_rows(self, client, auth_headers) -> None:
        from backend.api import leaderboard_cache, routes_clubs

        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            routes_clubs._compute_club_leaderboard_rows(conn, club["id"])
        assert club["id"] in leaderboard_cache._LEADERBOARD_CACHE
        leaderboard_cache.invalidate_leaderboard_cache(club["id"])
        assert club["id"] not in leaderboard_cache._LEADERBOARD_CACHE

    def test_max_age_guard_evicts_stale_entries(self, client, auth_headers) -> None:
        """Even with an unchanged version key, entries past the TTL are recomputed."""
        from backend.api import leaderboard_cache, routes_clubs

        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        leaderboard_cache.invalidate_leaderboard_cache(club["id"])
        with get_db() as conn:
            rows1 = routes_clubs._compute_club_leaderboard_rows(conn, club["id"])
            cached1 = leaderboard_cache._LEADERBOARD_CACHE[club["id"]]
            # Force-expire by rewriting the entry with an expires_at in the past.
            leaderboard_cache._LEADERBOARD_CACHE[club["id"]] = (cached1[0], cached1[1], 0.0)
            rows2 = routes_clubs._compute_club_leaderboard_rows(conn, club["id"])
            cached2 = leaderboard_cache._LEADERBOARD_CACHE[club["id"]]
        assert rows1 == rows2
        # Entry was rebuilt (new tuple, different expires_at).
        assert cached2[2] > 0.0


class TestMiniCardCache:
    """``get_mini_card_cached`` absorbs repeat lookups within the TTL."""

    def test_ttl_cache_returns_same_payload(self) -> None:
        from backend.api import leaderboard_cache

        leaderboard_cache.invalidate_mini_card_cache()
        calls = {"n": 0}

        def builder() -> dict:
            calls["n"] += 1
            return {"value": calls["n"]}

        a = leaderboard_cache.get_mini_card_cached(("test", "k1"), builder)
        b = leaderboard_cache.get_mini_card_cached(("test", "k1"), builder)
        assert a == b == {"value": 1}
        assert calls["n"] == 1

    def test_invalidate_by_prefix(self) -> None:
        from backend.api import leaderboard_cache

        leaderboard_cache.invalidate_mini_card_cache()
        leaderboard_cache.get_mini_card_cached(("club", "a", "p1"), lambda: {"v": 1})
        leaderboard_cache.get_mini_card_cached(("club", "b", "p2"), lambda: {"v": 2})
        leaderboard_cache.get_mini_card_cached(("tournament", "t1", "p1"), lambda: {"v": 3})
        leaderboard_cache.invalidate_mini_card_cache(("club", "a"))
        # Only the ("club", "a", ...) entry was dropped.
        assert ("club", "a", "p1") not in leaderboard_cache._MINI_CARD_CACHE
        assert ("club", "b", "p2") in leaderboard_cache._MINI_CARD_CACHE
        assert ("tournament", "t1", "p1") in leaderboard_cache._MINI_CARD_CACHE


class TestPublicEndpointETags:
    """``ETag`` + ``Cache-Control`` short-circuit on public endpoints."""

    def test_leaderboard_returns_etag_and_handles_if_none_match(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        url = f"/api/clubs/{club['id']}/public-leaderboard"
        first = client.get(url)
        assert first.status_code == 200
        tag = first.headers.get("etag")
        assert tag and tag.startswith('"') and tag.endswith('"')
        assert "max-age" in (first.headers.get("cache-control") or "")
        second = client.get(url, headers={"If-None-Match": tag})
        assert second.status_code == 304
        assert second.headers.get("etag") == tag


class TestPublicTournaments:
    """GET /api/clubs/{id}/public-tournaments — public list."""

    _GP_BODY = {
        "name": "Test Cup",
        "player_names": ["A", "B", "C", "D"],
        "team_mode": False,
        "court_names": ["Court 1"],
        "num_groups": 1,
        "top_per_group": 1,
        "double_elimination": False,
    }

    def _setup_club_with_tournament(self, client, auth_headers) -> tuple[dict, str]:
        """Create a community + club, create a GP tournament, assign it to the club."""
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        r = client.post("/api/tournaments/group-playoff", json=self._GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        client.patch(
            f"/api/tournaments/{tid}/community",
            json={"community_id": comm["id"]},
            headers=auth_headers,
        )
        client.patch(
            f"/api/tournaments/{tid}/club",
            json={"club_id": club["id"]},
            headers=auth_headers,
        )
        return club, tid

    def test_unknown_club(self, client) -> None:
        res = client.get("/api/clubs/cl_unknown/public-tournaments")
        assert res.status_code == 404

    def test_empty_club(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.get(f"/api/clubs/{club['id']}/public-tournaments")
        assert res.status_code == 200
        assert res.json() == []

    def test_upcoming_tournament_shows_correct_status(self, client, auth_headers) -> None:
        """A GP tournament in SETUP phase is reported as 'upcoming'."""
        from backend.models import GPPhase
        from backend.api.state import _tournaments

        club, tid = self._setup_club_with_tournament(client, auth_headers)
        # Manually rewind to SETUP to verify the upcoming status mapping.
        _tournaments[tid]["tournament"]._phase = GPPhase.SETUP

        res = client.get(f"/api/clubs/{club['id']}/public-tournaments")
        assert res.status_code == 200
        items = res.json()
        assert len(items) == 1
        assert items[0]["id"] == tid
        assert items[0]["status"] == "upcoming"
        assert items[0]["kind"] == "tournament"

    def test_in_progress_tournament_shows_correct_status(self, client, auth_headers) -> None:
        """A GP tournament in GROUPS phase is reported as 'in_progress'."""
        from backend.models import GPPhase
        from backend.api.state import _tournaments

        club, tid = self._setup_club_with_tournament(client, auth_headers)
        _tournaments[tid]["tournament"]._phase = GPPhase.GROUPS

        res = client.get(f"/api/clubs/{club['id']}/public-tournaments")
        assert res.status_code == 200
        items = res.json()
        assert len(items) == 1
        assert items[0]["id"] == tid
        assert items[0]["status"] == "in_progress"

    def test_finished_gp_tournament_shows_correct_status(self, client, auth_headers) -> None:
        """A finished GP tournament is included in the list with status 'finished'."""
        from backend.models import GPPhase
        from backend.api.state import _tournaments

        club, tid = self._setup_club_with_tournament(client, auth_headers)
        _tournaments[tid]["tournament"]._phase = GPPhase.FINISHED

        res = client.get(f"/api/clubs/{club['id']}/public-tournaments")
        assert res.status_code == 200
        items = res.json()
        assert len(items) == 1
        assert items[0]["id"] == tid
        assert items[0]["status"] == "finished"
        assert items[0]["kind"] == "tournament"

    def test_finished_mex_tournament_shows_correct_status(self, client, auth_headers) -> None:
        """A finished Mexicano tournament is included with status 'finished'."""
        from backend.api.state import _tournaments

        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        mex_body = {
            "name": "Mex Cup",
            "player_names": ["A", "B", "C", "D"],
            "court_names": ["Court 1"],
            "total_points_per_match": 32,
            "num_rounds": 2,
        }
        r = client.post("/api/tournaments/mexicano", json=mex_body, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        client.patch(
            f"/api/tournaments/{tid}/community",
            json={"community_id": comm["id"]},
            headers=auth_headers,
        )
        client.patch(
            f"/api/tournaments/{tid}/club",
            json={"club_id": club["id"]},
            headers=auth_headers,
        )
        # MexicanTournament stores phase in _phase attribute (same pattern as GP)
        _tournaments[tid]["tournament"]._phase = "finished"

        res = client.get(f"/api/clubs/{club['id']}/public-tournaments")
        assert res.status_code == 200
        items = res.json()
        assert len(items) == 1
        assert items[0]["id"] == tid
        assert items[0]["status"] == "finished"

    def test_private_finished_tournament_excluded(self, client, auth_headers) -> None:
        """A private (public=False) finished tournament is excluded from the list."""
        from backend.models import GPPhase
        from backend.api.state import _tournaments

        club, tid = self._setup_club_with_tournament(client, auth_headers)
        _tournaments[tid]["tournament"]._phase = GPPhase.FINISHED
        _tournaments[tid]["public"] = False

        res = client.get(f"/api/clubs/{club['id']}/public-tournaments")
        assert res.status_code == 200
        assert res.json() == []

    def test_finished_tournament_from_other_club_not_included(self, client, auth_headers) -> None:
        """A finished tournament assigned to a different club is not listed."""
        from backend.models import GPPhase
        from backend.api.state import _tournaments

        comm = _create_community(client, auth_headers)
        club_a = _create_club(client, auth_headers, comm["id"], name="Club A")
        club_b = _create_club(client, auth_headers, comm["id"], name="Club B")

        r = client.post("/api/tournaments/group-playoff", json=self._GP_BODY, headers=auth_headers)
        assert r.status_code == 200
        tid = r.json()["id"]
        client.patch(f"/api/tournaments/{tid}/community", json={"community_id": comm["id"]}, headers=auth_headers)
        client.patch(f"/api/tournaments/{tid}/club", json={"club_id": club_b["id"]}, headers=auth_headers)
        _tournaments[tid]["tournament"]._phase = GPPhase.FINISHED

        res = client.get(f"/api/clubs/{club_a['id']}/public-tournaments")
        assert res.status_code == 200
        assert res.json() == []


# ---------------------------------------------------------------------------
# Validation hardening
# ---------------------------------------------------------------------------


class TestClubNameValidation:
    """Reject blank / whitespace-only club names on create and rename."""

    @pytest.mark.parametrize("blank_name", ["", "   ", "\t", "\n"])
    def test_create_rejects_blank_name(self, client, auth_headers, blank_name) -> None:
        comm = _create_community(client, auth_headers)
        res = client.post(
            "/api/clubs",
            json={"community_id": comm["id"], "name": blank_name},
            headers=auth_headers,
        )
        assert res.status_code == 422

    def test_rename_rejects_whitespace_only(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/clubs/{club['id']}",
            json={"name": "   "},
            headers=auth_headers,
        )
        assert res.status_code == 422


class TestLandingPinnedValidation:
    """Pinned tournament IDs must belong to the same club; foreign IDs are dropped."""

    def test_unknown_pinned_ids_are_filtered(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/clubs/{club['id']}/landing",
            json={"pinned_tournament_ids": ["tn_does_not_exist", "rg_also_fake"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["pinned_tournament_ids"] == []

    def test_pinned_ids_dedupe(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        # Create a registration belonging to the club so it becomes a valid pinnable id.
        reg = client.post(
            "/api/registrations",
            json={
                "name": "Open Reg",
                "community_id": comm["id"],
                "club_id": club["id"],
                "sport": "padel",
            },
            headers=auth_headers,
        )
        assert reg.status_code in (200, 201)
        rid = reg.json()["id"]
        res = client.patch(
            f"/api/clubs/{club['id']}/landing",
            json={"pinned_tournament_ids": [rid, rid, "tn_unknown"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["pinned_tournament_ids"] == [f"reg:{rid}"]

    def test_prefixed_pinned_id_is_kept_and_exposed_in_public_list(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        reg = client.post(
            "/api/registrations",
            json={
                "name": "Prefixed Open Reg",
                "community_id": comm["id"],
                "club_id": club["id"],
                "sport": "padel",
                "open": True,
                "listed": True,
            },
            headers=auth_headers,
        )
        assert reg.status_code in (200, 201)
        rid = reg.json()["id"]
        prefixed = f"reg:{rid}"

        update = client.patch(
            f"/api/clubs/{club['id']}/landing",
            json={"pinned_tournament_ids": [prefixed]},
            headers=auth_headers,
        )
        assert update.status_code == 200
        assert update.json()["pinned_tournament_ids"] == [prefixed]

        public = client.get(f"/api/clubs/{club['id']}/public-tournaments")
        assert public.status_code == 200
        reg_row = next((row for row in public.json() if row["kind"] == "registration" and row["id"] == rid), None)
        assert reg_row is not None
        assert reg_row["pin_key"] == prefixed
        assert reg_row["pinned"] is True


class TestClubMalformedJsonResilience:
    """Read endpoints should not 500 if legacy/malformed JSON is in the DB."""

    def test_list_clubs_with_corrupt_pinned_json(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            conn.execute(
                "UPDATE clubs SET pinned_tournament_ids = ? WHERE id = ?",
                ("not-valid-json{", club["id"]),
            )
        res = client.get(f"/api/clubs/{club['id']}", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["pinned_tournament_ids"] == []
        public = client.get(f"/api/clubs/{club['id']}/public-tournaments")
        assert public.status_code == 200

    def test_club_with_corrupt_email_settings(self, client, auth_headers) -> None:
        comm = _create_community(client, auth_headers)
        club = _create_club(client, auth_headers, comm["id"])
        with get_db() as conn:
            conn.execute(
                "UPDATE clubs SET email_settings = ? WHERE id = ?",
                ("{not json", club["id"]),
            )
        res = client.get(f"/api/clubs/{club['id']}", headers=auth_headers)
        assert res.status_code == 200
        assert res.json()["email_settings"] is None
