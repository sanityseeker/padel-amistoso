"""Tests for the Season management routes (CRUD, tournament assignment, standings)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.api.db import get_db


@pytest.fixture()
def client():
    return TestClient(app)


def _create_community(client: TestClient, auth_headers: dict, name: str = "Season Club") -> dict:
    res = client.post("/api/communities", json={"name": name}, headers=auth_headers)
    assert res.status_code == 201
    return res.json()


def _create_club(client: TestClient, auth_headers: dict, community_id: str, name: str = "Season Club") -> dict:
    res = client.post(
        "/api/clubs",
        json={"community_id": community_id, "name": name},
        headers=auth_headers,
    )
    assert res.status_code == 201
    return res.json()


def _create_season(client: TestClient, auth_headers: dict, club_id: str, name: str = "Season 1") -> dict:
    res = client.post(
        f"/api/clubs/{club_id}/seasons",
        json={"name": name},
        headers=auth_headers,
    )
    assert res.status_code == 201
    return res.json()


def _setup_club(client: TestClient, auth_headers: dict):
    """Create a community + club, return (club, community)."""
    comm = _create_community(client, auth_headers)
    club = _create_club(client, auth_headers, comm["id"])
    return club, comm


# ---------------------------------------------------------------------------
# Season CRUD
# ---------------------------------------------------------------------------


class TestSeasonCRUD:
    """Test season create / list / update / delete."""

    def test_create_season(self, client, auth_headers) -> None:
        club, _ = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        assert season["name"] == "Season 1"
        assert season["active"] is True
        assert season["club_id"] == club["id"]
        assert season["id"].startswith("sn_")

    def test_list_seasons(self, client, auth_headers) -> None:
        club, _ = _setup_club(client, auth_headers)
        _create_season(client, auth_headers, club["id"], "S1")
        _create_season(client, auth_headers, club["id"], "S2")
        res = client.get(f"/api/clubs/{club['id']}/seasons")
        assert res.status_code == 200
        seasons = res.json()
        assert len(seasons) == 2

    def test_update_season_name(self, client, auth_headers) -> None:
        club, _ = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        res = client.patch(
            f"/api/seasons/{season['id']}",
            json={"name": "Renamed"},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["name"] == "Renamed"

    def test_archive_season(self, client, auth_headers) -> None:
        club, _ = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        res = client.patch(
            f"/api/seasons/{season['id']}",
            json={"active": False},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["active"] is False

    def test_delete_season(self, client, auth_headers) -> None:
        club, _ = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        res = client.delete(f"/api/seasons/{season['id']}", headers=auth_headers)
        assert res.status_code == 200
        # Verify gone
        seasons = client.get(f"/api/clubs/{club['id']}/seasons").json()
        assert len(seasons) == 0

    def test_delete_season_nullifies_tournament_season_id(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])

        # Create a tournament with this season
        res = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "GP Test",
                "player_names": ["A", "B", "C", "D"],
                "num_groups": 1,
                "top_per_group": 2,
                "court_names": ["Court 1"],
                "community_id": comm["id"],
                "season_id": season["id"],
            },
            headers=auth_headers,
        )
        assert res.status_code == 200
        tid = res.json()["id"]

        # Delete the season
        client.delete(f"/api/seasons/{season['id']}", headers=auth_headers)

        # Tournament's season_id should now be null
        with get_db() as conn:
            row = conn.execute("SELECT season_id FROM tournaments WHERE id = ?", (tid,)).fetchone()
        assert row["season_id"] is None

    def test_create_season_requires_auth(self, client) -> None:
        res = client.post("/api/clubs/club_fake/seasons", json={"name": "S1"})
        assert res.status_code in (401, 403)

    def test_get_nonexistent_season_404(self, client, auth_headers) -> None:
        res = client.patch(
            "/api/seasons/sn_nonexist",
            json={"name": "X"},
            headers=auth_headers,
        )
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# Tournament season assignment
# ---------------------------------------------------------------------------


class TestTournamentSeasonAssignment:
    """Assign tournaments to seasons and verify validation."""

    def test_assign_tournament_to_season(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        res = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "GP",
                "player_names": ["A", "B", "C", "D"],
                "num_groups": 1,
                "top_per_group": 2,
                "court_names": ["Court 1"],
                "community_id": comm["id"],
            },
            headers=auth_headers,
        )
        tid = res.json()["id"]

        res = client.patch(
            f"/api/tournaments/{tid}/season",
            json={"season_id": season["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["season_id"] == season["id"]

    def test_remove_tournament_from_season(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        res = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "GP",
                "player_names": ["A", "B", "C", "D"],
                "num_groups": 1,
                "top_per_group": 2,
                "court_names": ["Court 1"],
                "community_id": comm["id"],
                "season_id": season["id"],
            },
            headers=auth_headers,
        )
        tid = res.json()["id"]

        res = client.patch(
            f"/api/tournaments/{tid}/season",
            json={"season_id": None},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["season_id"] is None

    def test_assign_tournament_wrong_community_rejected(self, client, auth_headers) -> None:
        """Assigning a tournament from a different community's season should fail."""
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])

        # Create tournament in a different community
        other_comm = _create_community(client, auth_headers, "Other")
        res = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "GP Other",
                "player_names": ["A", "B", "C", "D"],
                "num_groups": 1,
                "top_per_group": 2,
                "court_names": ["Court 1"],
                "community_id": other_comm["id"],
            },
            headers=auth_headers,
        )
        tid = res.json()["id"]

        res = client.patch(
            f"/api/tournaments/{tid}/season",
            json={"season_id": season["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 400


# ---------------------------------------------------------------------------
# Registration season assignment
# ---------------------------------------------------------------------------


class TestRegistrationSeasonAssignment:
    """Assign registrations (lobbies) to seasons."""

    def test_assign_registration_to_season(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])

        # Create a registration
        res = client.post(
            "/api/registrations",
            json={
                "name": "Lobby",
                "community_id": comm["id"],
            },
            headers=auth_headers,
        )
        assert res.status_code == 200
        rid = res.json()["id"]

        res = client.patch(
            f"/api/registrations/{rid}/season",
            json={"season_id": season["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["season_id"] == season["id"]

    def test_assign_registration_wrong_community_rejected(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])

        other_comm = _create_community(client, auth_headers, "Other")
        res = client.post(
            "/api/registrations",
            json={
                "name": "Lobby Other",
                "community_id": other_comm["id"],
            },
            headers=auth_headers,
        )
        rid = res.json()["id"]

        res = client.patch(
            f"/api/registrations/{rid}/season",
            json={"season_id": season["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 400


# ---------------------------------------------------------------------------
# Season standings (empty)
# ---------------------------------------------------------------------------


class TestSeasonStandings:
    """Test the season standings endpoint."""

    def test_empty_standings(self, client, auth_headers) -> None:
        club, _ = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        res = client.get(f"/api/seasons/{season['id']}/standings")
        assert res.status_code == 200
        data = res.json()
        assert data == {"padel": [], "tennis": []}

    def test_standings_with_tournament(self, client, auth_headers) -> None:
        """Create a tournament in the season and verify that standings endpoint
        returns a sport-split dict (even if both lists are empty when no ELO logs exist)."""
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        res = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "GP Test",
                "player_names": ["A", "B", "C", "D"],
                "num_groups": 1,
                "top_per_group": 2,
                "court_names": ["Court 1"],
                "community_id": comm["id"],
                "season_id": season["id"],
            },
            headers=auth_headers,
        )
        assert res.status_code == 200
        res = client.get(f"/api/seasons/{season['id']}/standings")
        assert res.status_code == 200
        data = res.json()
        assert "padel" in data
        assert "tennis" in data
        assert isinstance(data["padel"], list)
        assert isinstance(data["tennis"], list)

    def test_standings_nonexistent_season_404(self, client, auth_headers) -> None:
        res = client.get("/api/seasons/sn_nonexist/standings")
        assert res.status_code == 404


# ---------------------------------------------------------------------------
# Season with created_at on tournament
# ---------------------------------------------------------------------------


class TestTournamentCreatedAt:
    """Verify created_at is populated on tournaments."""

    def test_tournament_has_created_at(self, client, auth_headers) -> None:
        res = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "GP",
                "player_names": ["A", "B", "C", "D"],
                "num_groups": 1,
                "top_per_group": 2,
                "court_names": ["Court 1"],
            },
            headers=auth_headers,
        )
        assert res.status_code == 200
        tournaments = client.get("/api/tournaments", headers=auth_headers).json()
        found = [t for t in tournaments if t["id"] == res.json()["id"]]
        assert len(found) == 1
        assert found[0]["created_at"] != ""

    def test_tournament_season_id_passed_through(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        res = client.post(
            "/api/tournaments/group-playoff",
            json={
                "name": "GP",
                "player_names": ["A", "B", "C", "D"],
                "num_groups": 1,
                "top_per_group": 2,
                "court_names": ["Court 1"],
                "community_id": comm["id"],
                "season_id": season["id"],
            },
            headers=auth_headers,
        )
        assert res.status_code == 200
        tournaments = client.get("/api/tournaments", headers=auth_headers).json()
        found = [t for t in tournaments if t["id"] == res.json()["id"]]
        assert found[0]["season_id"] == season["id"]
