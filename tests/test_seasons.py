"""Tests for the Season management routes (CRUD, tournament assignment, standings)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.api import app
from backend.api import state as _state
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

    def test_standings_resolve_elo_start_end_across_multiple_player_ids(self, client, auth_headers) -> None:
        """One profile linked to two different player_ids across two season tournaments
        must report elo_start from the temporally earliest event and elo_end from the
        latest, regardless of dict iteration order."""
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])

        # Create two tournaments in the season.
        tids = []
        for i in range(2):
            res = client.post(
                "/api/tournaments/group-playoff",
                json={
                    "name": f"GP Std {i}",
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
            tids.append(res.json()["id"])

        # Create one profile and link two distinct player_ids (one per tournament) to it.
        profile_id = "prof_multi_pid"
        with get_db() as conn:
            conn.execute(
                "INSERT INTO player_profiles (id, passphrase, name, email, is_ghost, created_at)"
                " VALUES (?, ?, 'Multi PID', '', 0, datetime('now'))",
                (profile_id, "pp-multi-pid"),
            )
            for idx, tid in enumerate(tids):
                conn.execute(
                    "INSERT OR REPLACE INTO player_secrets"
                    " (tournament_id, player_id, player_name, passphrase, token, contact, email, profile_id)"
                    " VALUES (?, ?, 'Multi PID', ?, ?, '', '', ?)",
                    (tid, f"pid-multi-{idx}", f"pp-secret-{idx}", f"tok-{idx}", profile_id),
                )

        # Insert chronological elo log entries:
        #   tournament 0 → player_id pid-multi-0 (earliest, t0)
        #   tournament 1 → player_id pid-multi-1 (latest, t1)
        # Crucially, the profile's elo_start must come from t0 even though
        # iteration may visit pid-multi-1 first when merging.
        base = datetime.now(timezone.utc)
        with get_db() as conn:
            conn.execute(
                "INSERT INTO player_elo_log"
                " (tournament_id, sport, match_id, player_id, match_order, elo_before, elo_after, elo_delta, match_payload, updated_at)"
                " VALUES (?, 'padel', 'm0', ?, 0, 1000.0, 1100.0, 100.0, '{}', ?)",
                (tids[0], "pid-multi-0", base.isoformat()),
            )
            conn.execute(
                "INSERT INTO player_elo_log"
                " (tournament_id, sport, match_id, player_id, match_order, elo_before, elo_after, elo_delta, match_payload, updated_at)"
                " VALUES (?, 'padel', 'm1', ?, 0, 1100.0, 1300.0, 200.0, '{}', ?)",
                (tids[1], "pid-multi-1", (base + timedelta(hours=1)).isoformat()),
            )

        res = client.get(f"/api/seasons/{season['id']}/standings")
        assert res.status_code == 200
        padel = res.json()["padel"]
        entry = next((e for e in padel if e["profile_id"] == profile_id), None)
        assert entry is not None
        assert entry["elo_start"] == 1000.0
        assert entry["elo_end"] == 1300.0
        assert entry["matches_played"] == 2
        assert entry["elo_change"] == 300.0


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


# ---------------------------------------------------------------------------
# Direct club_id assignment (tournaments belong to a club without a season)
# ---------------------------------------------------------------------------


class TestTournamentClubAssignment:
    """Tournaments can belong to a club directly, without going through a season."""

    def _create_gp(self, client, auth_headers, comm_id, season_id=None, club_id=None):
        body = {
            "name": "GP",
            "player_names": ["A", "B", "C", "D"],
            "num_groups": 1,
            "top_per_group": 2,
            "court_names": ["Court 1"],
            "community_id": comm_id,
        }
        if season_id is not None:
            body["season_id"] = season_id
        if club_id is not None:
            body["club_id"] = club_id
        res = client.post("/api/tournaments/group-playoff", json=body, headers=auth_headers)
        assert res.status_code == 200
        return res.json()["id"]

    def test_create_with_club_id_persists_it(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        tid = self._create_gp(client, auth_headers, comm["id"], club_id=club["id"])
        assert _state._tournaments[tid]["club_id"] == club["id"]

    def test_create_with_season_id_backfills_club_id(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        tid = self._create_gp(client, auth_headers, comm["id"], season_id=season["id"])
        assert _state._tournaments[tid]["club_id"] == club["id"]
        assert _state._tournaments[tid]["season_id"] == season["id"]

    def test_set_club_endpoint_assigns_club(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        tid = self._create_gp(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/tournaments/{tid}/club",
            json={"club_id": club["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["club_id"] == club["id"]
        assert _state._tournaments[tid]["club_id"] == club["id"]

    def test_set_club_endpoint_clears_club(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        tid = self._create_gp(client, auth_headers, comm["id"], club_id=club["id"])
        res = client.patch(
            f"/api/tournaments/{tid}/club",
            json={"club_id": None},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["club_id"] is None

    def test_set_club_wrong_community_rejected(self, client, auth_headers) -> None:
        club, _ = _setup_club(client, auth_headers)
        other_comm = _create_community(client, auth_headers, "Other")
        tid = self._create_gp(client, auth_headers, other_comm["id"])
        res = client.patch(
            f"/api/tournaments/{tid}/club",
            json={"club_id": club["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 400

    def test_setting_season_syncs_club_id(self, client, auth_headers) -> None:
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        tid = self._create_gp(client, auth_headers, comm["id"])
        res = client.patch(
            f"/api/tournaments/{tid}/season",
            json={"season_id": season["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["club_id"] == club["id"]
        assert _state._tournaments[tid]["club_id"] == club["id"]

    def test_clearing_season_keeps_club_id(self, client, auth_headers) -> None:
        """Removing season_id should preserve the existing club_id (tournament still belongs to club)."""
        club, comm = _setup_club(client, auth_headers)
        season = _create_season(client, auth_headers, club["id"])
        tid = self._create_gp(client, auth_headers, comm["id"], season_id=season["id"])
        res = client.patch(
            f"/api/tournaments/{tid}/season",
            json={"season_id": None},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["club_id"] == club["id"]

    def test_setting_club_clears_mismatched_season(self, client, auth_headers) -> None:
        """If the existing season belongs to a different club, switching club_id clears season_id."""
        club_a, comm = _setup_club(client, auth_headers)
        club_b = _create_club(client, auth_headers, comm["id"], name="Club B")
        season_a = _create_season(client, auth_headers, club_a["id"])
        tid = self._create_gp(client, auth_headers, comm["id"], season_id=season_a["id"])
        res = client.patch(
            f"/api/tournaments/{tid}/club",
            json={"club_id": club_b["id"]},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["club_id"] == club_b["id"]
        assert res.json()["season_id"] is None
