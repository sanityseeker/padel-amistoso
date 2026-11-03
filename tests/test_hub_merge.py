"""Merging two registered (Player Hub) profiles into one.

Admins can merge any two Hub profiles; club editors only two members of their
club.  Profiles that both took part in the same tournament are two different
people and must never be merged.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest

import backend.api.db as db_mod
from tests.test_elo_relink import _elo_before, _give_earlier_result, _link, _play_mexicano, _profile_elo

NOW = datetime.now(timezone.utc).isoformat()


def _insert_profile(name: str, email: str = "", *, is_ghost: bool = False, contact: str = "") -> str:
    profile_id = str(uuid.uuid4())
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (profile_id, f"pp-{uuid.uuid4().hex[:12]}", name, email, contact, NOW, int(is_ghost)),
        )
    return profile_id


def _insert_secret(tid: str, player_id: str, profile_id: str, tournament_name: str = "") -> None:
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, profile_id,"
            " tournament_name) VALUES (?, ?, 'P', ?, ?, ?, ?)",
            (tid, player_id, f"ps-{uuid.uuid4().hex[:10]}", uuid.uuid4().hex, profile_id, tournament_name),
        )


def _insert_history(tid: str, player_id: str, profile_id: str, name: str = "Old Cup") -> None:
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO player_history (profile_id, entity_type, entity_id, entity_name, player_id, player_name,"
            " finished_at, sport) VALUES (?, 'tournament', ?, ?, ?, 'P', ?, 'padel')",
            (profile_id, tid, name, player_id, NOW),
        )


def _insert_club(club_id: str = "club-m", created_by: str = "alice") -> str:
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES ('c-m', 'C', 'admin', ?)",
            (NOW,),
        )
        conn.execute(
            "INSERT INTO clubs (id, community_id, name, logo_path, email_settings, created_by, created_at)"
            " VALUES (?, 'c-m', 'Club', NULL, NULL, ?, ?)",
            (club_id, created_by, NOW),
        )
    return club_id


def _add_member(club_id: str, profile_id: str, tier_id: str | None = None) -> None:
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, tier_id)"
            " VALUES (?, ?, 'padel', 1000, 0, ?)",
            (profile_id, club_id, tier_id),
        )


def _exists(profile_id: str) -> bool:
    with db_mod.get_db() as conn:
        return conn.execute("SELECT 1 FROM player_profiles WHERE id = ?", (profile_id,)).fetchone() is not None


def _merge(client, headers, primary: str, secondary: str, club_id: str | None = None):
    base = f"/api/clubs/{club_id}/players" if club_id else "/api/admin/player-profiles"
    return client.post(f"{base}/merge-hub", json={"primary_id": primary, "secondary_id": secondary}, headers=headers)


def _preview(client, headers, primary: str, secondary: str, club_id: str | None = None):
    base = f"/api/clubs/{club_id}/players" if club_id else "/api/admin/player-profiles"
    return client.get(
        f"{base}/merge-hub/preview", params={"primary_id": primary, "secondary_id": secondary}, headers=headers
    )


class TestAdminHubMerge:
    def test_merge_moves_everything_and_deletes_secondary(self, client, auth_headers):
        primary = _insert_profile("Ana", "ana@ex.com")
        secondary = _insert_profile("Ana B", "ana.b@ex.com", contact="+34 600")
        _insert_secret("t-live", "p-live", secondary)
        _insert_history("t-old", "p-old", secondary)
        club = _insert_club()
        _add_member(club, secondary, tier_id="tier-1")
        with db_mod.get_db() as conn:
            conn.execute(
                "INSERT INTO participation_claims (id, profile_id, entity_type, entity_id, player_id, status,"
                " created_at) VALUES ('cl-1', ?, 'tournament', 't-x', 'p-x', 'pending', ?)",
                (secondary, NOW),
            )

        preview = _preview(client, auth_headers, primary, secondary).json()
        assert preview["can_merge"] is True
        assert preview["secondary"]["tournaments"] == 2

        r = _merge(client, auth_headers, primary, secondary)
        assert r.status_code == 200, r.text
        assert r.json() == {"profile_id": primary, "name": "Ana"}

        assert not _exists(secondary)
        with db_mod.get_db() as conn:
            assert conn.execute("SELECT profile_id FROM player_secrets WHERE player_id = 'p-live'").fetchone()[0] == (
                primary
            )
            assert conn.execute("SELECT profile_id FROM player_history WHERE player_id = 'p-old'").fetchone()[0] == (
                primary
            )
            club_row = conn.execute(
                "SELECT tier_id FROM profile_club_elo WHERE profile_id = ? AND club_id = ?", (primary, club)
            ).fetchone()
            assert club_row["tier_id"] == "tier-1"
            assert conn.execute("SELECT profile_id FROM participation_claims WHERE id = 'cl-1'").fetchone()[0] == (
                primary
            )
            prof = conn.execute("SELECT name, email, contact FROM player_profiles WHERE id = ?", (primary,)).fetchone()
        # The primary keeps its own name and email; blanks are filled from the secondary.
        assert (prof["name"], prof["email"], prof["contact"]) == ("Ana", "ana@ex.com", "+34 600")

    def test_shared_tournament_blocks_merge(self, client, auth_headers):
        primary = _insert_profile("Ana")
        secondary = _insert_profile("Ana B")
        _insert_secret("t-both", "p-1", primary, tournament_name="Spring Open")
        _insert_history("t-both", "p-2", secondary, name="Spring Open")

        preview = _preview(client, auth_headers, primary, secondary).json()
        assert preview["can_merge"] is False
        assert preview["shared_tournaments"] == [{"tournament_id": "t-both", "tournament_name": "Spring Open"}]

        r = _merge(client, auth_headers, primary, secondary)
        assert r.status_code == 409
        assert "Spring Open" in r.json()["detail"]
        assert "cannot be merged" in r.json()["detail"]
        assert _exists(secondary)

    @pytest.mark.parametrize("ghost_side", ["primary", "secondary"])
    def test_ghost_profiles_rejected(self, client, auth_headers, ghost_side):
        hub = _insert_profile("Hub")
        ghost = _insert_profile("Ghost", is_ghost=True)
        pair = (ghost, hub) if ghost_side == "primary" else (hub, ghost)
        assert _merge(client, auth_headers, *pair).status_code == 422

    def test_same_profile_rejected(self, client, auth_headers):
        pid = _insert_profile("Ana")
        assert _merge(client, auth_headers, pid, pid).status_code == 422

    def test_requires_admin(self, client, alice_headers):
        a, b = _insert_profile("A"), _insert_profile("B")
        assert _merge(client, alice_headers, a, b).status_code == 403
        assert _preview(client, alice_headers, a, b).status_code == 403

    def test_merge_recalculates_elo_across_the_combined_chain(self, client, auth_headers):
        tid, ids = _play_mexicano(client, auth_headers)
        primary = _insert_profile("Ana")
        _give_earlier_result(primary, elo_after=1300, matches=6)
        secondary = _insert_profile("Ana B")
        _link(client, auth_headers, secondary, tid, ids["Alice"])
        assert _elo_before(tid, ids["Alice"]) == 1000

        assert _merge(client, auth_headers, primary, secondary).status_code == 200

        # The tournament now continues from the primary's earlier result.
        assert _elo_before(tid, ids["Alice"]) == 1300
        with db_mod.get_db() as conn:
            elo_after = conn.execute(
                "SELECT elo_after FROM player_elo WHERE tournament_id = ? AND player_id = ?", (tid, ids["Alice"])
            ).fetchone()[0]
        assert _profile_elo(primary)[0] == elo_after


class TestClubHubMerge:
    def test_club_editor_merges_members(self, client, alice_headers):
        club = _insert_club(created_by="alice")
        primary, secondary = _insert_profile("Ana"), _insert_profile("Ana B")
        _add_member(club, primary)
        _add_member(club, secondary)

        assert _preview(client, alice_headers, primary, secondary, club).json()["can_merge"] is True
        r = _merge(client, alice_headers, primary, secondary, club)
        assert r.status_code == 200, r.text
        assert not _exists(secondary)

    def test_non_member_rejected(self, client, alice_headers):
        club = _insert_club(created_by="alice")
        primary, outsider = _insert_profile("Ana"), _insert_profile("Elsewhere")
        _add_member(club, primary)

        assert _merge(client, alice_headers, primary, outsider, club).status_code == 422
        assert _exists(outsider)

    def test_non_editor_forbidden(self, client, bob_headers):
        club = _insert_club(created_by="alice")
        primary, secondary = _insert_profile("Ana"), _insert_profile("Ana B")
        _add_member(club, primary)
        _add_member(club, secondary)

        assert _merge(client, bob_headers, primary, secondary, club).status_code == 403
        assert _exists(secondary)
