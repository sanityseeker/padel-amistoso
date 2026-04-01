"""
Tests for the registration co-editor sharing feature.

Verifies that:
- The owner can add and remove co-editors.
- Co-editors can perform all editing actions except delete and share management.
- Revoked co-editors immediately lose editing access.
- Shared registrations surface in the co-editor's registration listing.
- Idempotency and edge-case behaviour (nonexistent user, duplicate add, etc.).
"""

from __future__ import annotations


_REG_BODY = {
    "name": "Sharing Test Lobby",
    "sport": "padel",
}


class TestRegistrationSharing:
    """Integration tests for the /api/registrations/{rid}/collaborators endpoints."""

    def _create_registration(self, client, headers: dict) -> str:
        """Create a minimal registration lobby and return its ID."""
        r = client.post("/api/registrations", json=_REG_BODY, headers=headers)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    # ── List collaborators ──────────────────────────────────

    def test_list_collaborators_empty(self, client, alice_headers):
        rid = self._create_registration(client, alice_headers)
        r = client.get(f"/api/registrations/{rid}/collaborators", headers=alice_headers)
        assert r.status_code == 200
        assert r.json()["collaborators"] == []

    def test_list_collaborators_requires_auth(self, client, alice_headers):
        rid = self._create_registration(client, alice_headers)
        r = client.get(f"/api/registrations/{rid}/collaborators")
        assert r.status_code == 401

    def test_list_collaborators_unknown_registration_returns_404(self, client, alice_headers):
        r = client.get("/api/registrations/r9999/collaborators", headers=alice_headers)
        assert r.status_code == 404

    # ── Add collaborator ────────────────────────────────────

    def test_add_collaborator_as_owner_succeeds(self, client, alice_headers):
        rid = self._create_registration(client, alice_headers)
        r = client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        assert r.status_code == 200
        assert "bob" in r.json()["collaborators"]

    def test_add_collaborator_as_non_owner_fails(self, client, alice_headers, bob_headers):
        rid = self._create_registration(client, alice_headers)
        r = client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "admin"},
            headers=bob_headers,
        )
        assert r.status_code == 403

    def test_add_collaborator_nonexistent_user_returns_404(self, client, alice_headers):
        rid = self._create_registration(client, alice_headers)
        r = client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "ghost_user_does_not_exist"},
            headers=alice_headers,
        )
        assert r.status_code == 404

    def test_add_owner_as_collaborator_returns_409(self, client, alice_headers):
        """The owner cannot be added as a co-editor of their own registration."""
        rid = self._create_registration(client, alice_headers)
        r = client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "alice"},
            headers=alice_headers,
        )
        assert r.status_code == 409

    def test_add_collaborator_is_idempotent(self, client, alice_headers):
        """Adding the same user twice should succeed and not duplicate the entry."""
        rid = self._create_registration(client, alice_headers)
        for _ in range(2):
            r = client.post(
                f"/api/registrations/{rid}/collaborators",
                json={"username": "bob"},
                headers=alice_headers,
            )
            assert r.status_code == 200
        assert r.json()["collaborators"].count("bob") == 1

    def test_admin_can_add_collaborator_to_any_registration(self, client, alice_headers, auth_headers):
        """Site admins can manage collaborators for any registration."""
        rid = self._create_registration(client, alice_headers)
        r = client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert "bob" in r.json()["collaborators"]

    # ── Co-editor editing access ────────────────────────────

    def test_collaborator_can_read_registration(self, client, alice_headers, bob_headers):
        """Co-editors should be able to fetch the registration details."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.get(f"/api/registrations/{rid}", headers=bob_headers)
        assert r.status_code == 200

    def test_collaborator_can_update_registration(self, client, alice_headers, bob_headers):
        """Co-editors should be able to edit registration settings."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.patch(
            f"/api/registrations/{rid}",
            json={"name": "Updated by Bob"},
            headers=bob_headers,
        )
        assert r.status_code == 200

    def test_collaborator_can_add_registrant(self, client, alice_headers, bob_headers):
        """Co-editors should be able to add registrants."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.post(
            f"/api/registrations/{rid}/registrant",
            json={"player_name": "Charlie"},
            headers=bob_headers,
        )
        assert r.status_code == 200

    def test_non_collaborator_cannot_read_registration(self, client, alice_headers, bob_headers):
        """Users without access should receive 403 on the admin read endpoint."""
        rid = self._create_registration(client, alice_headers)
        r = client.get(f"/api/registrations/{rid}", headers=bob_headers)
        assert r.status_code == 403

    def test_collaborator_cannot_delete_registration(self, client, alice_headers, bob_headers):
        """Co-editors must not be allowed to delete the registration."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.delete(f"/api/registrations/{rid}", headers=bob_headers)
        assert r.status_code == 403

    def test_collaborator_cannot_add_more_collaborators(self, client, alice_headers, bob_headers):
        """Co-editors must not be allowed to manage the share list."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "admin"},
            headers=bob_headers,
        )
        assert r.status_code == 403

    # ── Revocation ──────────────────────────────────────────

    def test_owner_can_revoke_collaborator(self, client, alice_headers, bob_headers):
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.delete(f"/api/registrations/{rid}/collaborators/bob", headers=alice_headers)
        assert r.status_code == 200
        assert "bob" not in r.json()["collaborators"]

    def test_revoked_collaborator_loses_edit_access(self, client, alice_headers, bob_headers):
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        # Verify bob can edit before revocation
        r = client.patch(
            f"/api/registrations/{rid}",
            json={"name": "Bob's edit"},
            headers=bob_headers,
        )
        assert r.status_code == 200

        # Revoke bob
        client.delete(f"/api/registrations/{rid}/collaborators/bob", headers=alice_headers)

        # Bob should no longer be able to edit
        r = client.patch(
            f"/api/registrations/{rid}",
            json={"name": "After revocation"},
            headers=bob_headers,
        )
        assert r.status_code == 403

    def test_revoke_nonexistent_collaborator_succeeds_silently(self, client, alice_headers):
        """Revoking a user who was never a co-editor should return 200 (idempotent)."""
        rid = self._create_registration(client, alice_headers)
        r = client.delete(f"/api/registrations/{rid}/collaborators/bob", headers=alice_headers)
        assert r.status_code == 200
        assert r.json()["collaborators"] == []

    # ── Registration listing ────────────────────────────────

    def test_shared_registration_appears_in_collaborator_listing(self, client, alice_headers, bob_headers):
        """A registration shared with bob should appear in bob's registration list."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.get("/api/registrations", headers=bob_headers)
        assert r.status_code == 200
        ids = [reg["id"] for reg in r.json()]
        assert rid in ids

    def test_shared_registration_has_shared_true_flag(self, client, alice_headers, bob_headers):
        """The ``shared`` field must be True for a co-editor's listing entry."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.get("/api/registrations", headers=bob_headers)
        entry = next(reg for reg in r.json() if reg["id"] == rid)
        assert entry["shared"] is True

    def test_non_shared_registration_hidden_from_other_user(self, client, alice_headers, bob_headers):
        """A registration not shared with bob should not appear in his listing."""
        rid = self._create_registration(client, alice_headers)
        r = client.get("/api/registrations", headers=bob_headers)
        ids = [reg["id"] for reg in r.json()]
        assert rid not in ids

    def test_own_registration_has_shared_false_in_listing(self, client, alice_headers):
        """Owned registrations should have ``shared=False`` in the owner's listing."""
        self._create_registration(client, alice_headers)
        r = client.get("/api/registrations", headers=alice_headers)
        assert r.status_code == 200
        for entry in r.json():
            assert entry["shared"] is False

    def test_shared_registration_disappears_from_listing_after_revocation(self, client, alice_headers, bob_headers):
        """Once bob is revoked, the registration should no longer appear in his listing."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        client.delete(f"/api/registrations/{rid}/collaborators/bob", headers=alice_headers)
        r = client.get("/api/registrations", headers=bob_headers)
        ids = [reg["id"] for reg in r.json()]
        assert rid not in ids

    def test_co_editor_can_view_collaborator_list(self, client, alice_headers, bob_headers):
        """An existing co-editor may view the collaborator list."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        r = client.get(f"/api/registrations/{rid}/collaborators", headers=bob_headers)
        assert r.status_code == 200
        assert "bob" in r.json()["collaborators"]

    # ── Conversion propagation ──────────────────────────────

    def test_registration_co_editors_become_tournament_co_editors_on_conversion(
        self, client, alice_headers, bob_headers
    ):
        """Converting a shared registration should grant the same co-editors access to the new tournament."""
        rid = self._create_registration(client, alice_headers)
        # Add bob as a co-editor of the registration
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        # Register four players so conversion has enough participants
        for name in ["P1", "P2", "P3", "P4"]:
            client.post(f"/api/registrations/{rid}/register", json={"player_name": name})
        # Convert to a mexicano tournament
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "mexicano",
                "player_names": ["P1", "P2", "P3", "P4"],
            },
            headers=alice_headers,
        )
        assert r.status_code == 200
        tid = r.json()["tournament_id"]

        # Bob should now be a co-editor of the resulting tournament
        r = client.get(f"/api/tournaments/{tid}/collaborators", headers=alice_headers)
        assert r.status_code == 200
        assert "bob" in r.json()["collaborators"]

    def test_tournament_shows_in_co_editor_listing_after_conversion(self, client, alice_headers, bob_headers):
        """The converted tournament should appear in bob's tournament listing immediately."""
        rid = self._create_registration(client, alice_headers)
        client.post(
            f"/api/registrations/{rid}/collaborators",
            json={"username": "bob"},
            headers=alice_headers,
        )
        for name in ["P1", "P2", "P3", "P4"]:
            client.post(f"/api/registrations/{rid}/register", json={"player_name": name})
        r = client.post(
            f"/api/registrations/{rid}/convert",
            json={
                "tournament_type": "mexicano",
                "player_names": ["P1", "P2", "P3", "P4"],
            },
            headers=alice_headers,
        )
        tid = r.json()["tournament_id"]

        r = client.get("/api/tournaments", headers=bob_headers)
        assert r.status_code == 200
        ids = [t["id"] for t in r.json()]
        assert tid in ids
