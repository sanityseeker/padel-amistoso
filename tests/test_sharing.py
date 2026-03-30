"""
Tests for the tournament co-editor sharing feature.

Verifies that:
- The owner can add and remove co-editors.
- Co-editors can perform all editing actions except delete and share management.
- Revoked co-editors immediately lose editing access.
- Shared tournaments surface in the co-editor's tournament listing.
- Idempotency and edge-case behaviour (nonexistent user, duplicate add, etc.).
"""

from __future__ import annotations


_MEX_BODY = {
    "name": "Sharing Test Cup",
    "player_names": ["A", "B", "C", "D"],
    "court_names": ["Court 1"],
    "num_rounds": 2,
}


class TestTournamentSharing:
    """Integration tests for the /collaborators endpoints and sharing behaviour."""

    def _create_tournament(self, client, headers: dict) -> str:
        """Create a minimal Mexicano tournament and return its ID."""
        r = client.post("/api/tournaments/mexicano", json=_MEX_BODY, headers=headers)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    # ── List collaborators ──────────────────────────────────

    def test_list_collaborators_empty(self, client, alice_headers):
        tid = self._create_tournament(client, alice_headers)
        r = client.get(f"/api/tournaments/{tid}/collaborators", headers=alice_headers)
        assert r.status_code == 200
        assert r.json()["collaborators"] == []

    def test_list_collaborators_requires_auth(self, client, alice_headers):
        tid = self._create_tournament(client, alice_headers)
        r = client.get(f"/api/tournaments/{tid}/collaborators")
        assert r.status_code == 401

    # ── Add collaborator ────────────────────────────────────

    def test_add_collaborator_as_owner_succeeds(self, client, alice_headers):
        tid = self._create_tournament(client, alice_headers)
        r = client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        assert r.status_code == 200
        assert "bob" in r.json()["collaborators"]

    def test_add_collaborator_as_non_owner_fails(self, client, alice_headers, bob_headers):
        tid = self._create_tournament(client, alice_headers)
        r = client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "admin"},
            headers=bob_headers,
        )
        assert r.status_code == 403

    def test_add_collaborator_nonexistent_user_returns_404(self, client, alice_headers):
        tid = self._create_tournament(client, alice_headers)
        r = client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "ghost_user_does_not_exist"},
            headers=alice_headers,
        )
        assert r.status_code == 404

    def test_add_owner_as_collaborator_returns_409(self, client, alice_headers):
        """The owner cannot be added as a co-editor of their own tournament."""
        tid = self._create_tournament(client, alice_headers)
        r = client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "alice"},
            headers=alice_headers,
        )
        assert r.status_code == 409

    def test_add_collaborator_is_idempotent(self, client, alice_headers):
        """Adding the same user twice should succeed and not duplicate the entry."""
        tid = self._create_tournament(client, alice_headers)
        for _ in range(2):
            r = client.post(
                f"/api/tournaments/{tid}/collaborators",
                json={"username": "bob"},
                headers=alice_headers,
            )
            assert r.status_code == 200
        assert r.json()["collaborators"].count("bob") == 1

    def test_admin_can_add_collaborator_to_any_tournament(self, client, alice_headers, auth_headers):
        """Site admins can manage collaborators for any tournament."""
        tid = self._create_tournament(client, alice_headers)
        r = client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert "bob" in r.json()["collaborators"]

    # ── Co-editor editing access ────────────────────────────

    def test_collaborator_can_edit_tv_settings(self, client, alice_headers, bob_headers):
        """Co-editors should be able to perform editing operations."""
        tid = self._create_tournament(client, alice_headers)
        client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"show_timer": True},
            headers=bob_headers,
        )
        assert r.status_code == 200

    def test_non_collaborator_cannot_edit_tournament(self, client, alice_headers, bob_headers):
        """Users without access should receive 403 on editing endpoints."""
        tid = self._create_tournament(client, alice_headers)
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"show_timer": True},
            headers=bob_headers,
        )
        assert r.status_code == 403

    def test_collaborator_cannot_delete_tournament(self, client, alice_headers, bob_headers):
        """Co-editors must not be allowed to delete the tournament."""
        tid = self._create_tournament(client, alice_headers)
        client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.delete(f"/api/tournaments/{tid}", headers=bob_headers)
        assert r.status_code == 403

    def test_collaborator_cannot_add_more_collaborators(self, client, alice_headers, bob_headers):
        """Co-editors must not be allowed to manage the share list."""
        tid = self._create_tournament(client, alice_headers)
        client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "admin"},
            headers=bob_headers,
        )
        assert r.status_code == 403

    # ── Revocation ──────────────────────────────────────────

    def test_owner_can_revoke_collaborator(self, client, alice_headers, bob_headers):
        tid = self._create_tournament(client, alice_headers)
        client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.delete(f"/api/tournaments/{tid}/collaborators/bob", headers=alice_headers)
        assert r.status_code == 200
        assert "bob" not in r.json()["collaborators"]

    def test_revoked_collaborator_loses_edit_access(self, client, alice_headers, bob_headers):
        tid = self._create_tournament(client, alice_headers)
        client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        # Verify bob can edit before revocation
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"show_timer": True},
            headers=bob_headers,
        )
        assert r.status_code == 200

        # Revoke bob
        client.delete(f"/api/tournaments/{tid}/collaborators/bob", headers=alice_headers)

        # Bob should no longer be able to edit
        r = client.patch(
            f"/api/tournaments/{tid}/tv-settings",
            json={"show_timer": False},
            headers=bob_headers,
        )
        assert r.status_code == 403

    def test_revoke_nonexistent_collaborator_succeeds_silently(self, client, alice_headers):
        """Revoking a user who was never a co-editor should return 200 (idempotent)."""
        tid = self._create_tournament(client, alice_headers)
        r = client.delete(f"/api/tournaments/{tid}/collaborators/bob", headers=alice_headers)
        assert r.status_code == 200
        assert r.json()["collaborators"] == []

    # ── Tournament listing ──────────────────────────────────

    def test_shared_tournament_appears_in_collaborator_listing(self, client, alice_headers, bob_headers):
        """A tournament shared with bob should appear in bob's tournament list."""
        tid = self._create_tournament(client, alice_headers)
        client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.get("/api/tournaments", headers=bob_headers)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert tid in ids

    def test_shared_tournament_has_shared_true_flag(self, client, alice_headers, bob_headers):
        """The ``shared`` field must be True for a co-editor's listing entry."""
        tid = self._create_tournament(client, alice_headers)
        client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.get("/api/tournaments", headers=bob_headers)
        entry = next(t for t in r.json() if t["id"] == tid)
        assert entry["shared"] is True

    def test_non_shared_tournament_hidden_from_other_user(self, client, alice_headers, bob_headers):
        """A tournament not shared with bob should not appear in his listing."""
        tid = self._create_tournament(client, alice_headers)
        r = client.get("/api/tournaments", headers=bob_headers)
        ids = [t["id"] for t in r.json()]
        assert tid not in ids

    def test_own_tournament_has_shared_false_in_listing(self, client, alice_headers):
        """Owned tournaments should have ``shared=False`` in the owner's listing."""
        self._create_tournament(client, alice_headers)
        r = client.get("/api/tournaments", headers=alice_headers)
        assert r.status_code == 200
        for entry in r.json():
            assert entry["shared"] is False

    def test_shared_tournament_disappears_from_listing_after_revocation(self, client, alice_headers, bob_headers):
        """Once bob is revoked, the tournament should no longer appear in his listing."""
        tid = self._create_tournament(client, alice_headers)
        client.post(
            f"/api/tournaments/{tid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        client.delete(f"/api/tournaments/{tid}/collaborators/bob", headers=alice_headers)
        r = client.get("/api/tournaments", headers=bob_headers)
        ids = [t["id"] for t in r.json()]
        assert tid not in ids
