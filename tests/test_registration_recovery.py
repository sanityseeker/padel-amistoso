"""Tests for returning-player recovery flows on registration lobbies.

Covers three additions:
- ``profile_linked`` flag on the public register response (verified-email auto-link).
- ``POST /api/player-profile/recover-by-participation`` (email → find-or-create
  profile + sweep participations + magic link; enumeration-safe).
- Name-based discovery + organizer-approved claims (``find-by-name``,
  ``claim-participation``, ``claims``, ``claims/{id}/resolve``).
"""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi.testclient import TestClient

import backend.api.db as db_mod


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _make_lobby(
    client: TestClient,
    auth_headers: dict,
    *,
    name: str = "Lobby",
    community_id: str = "open",
    club_id: str | None = None,
) -> str:
    body: dict = {"name": name, "community_id": community_id}
    if club_id is not None:
        body["club_id"] = club_id
    r = client.post("/api/registrations", json=body, headers=auth_headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _register(client: TestClient, rid: str, name: str, email: str = "") -> dict:
    body: dict = {"player_name": name}
    if email:
        body["email"] = email
    r = client.post(f"/api/registrations/{rid}/register", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _create_profile(client: TestClient, name: str, email: str, participant_passphrase: str) -> dict:
    r = client.post(
        "/api/player-profile",
        json={"name": name, "email": email, "participant_passphrase": participant_passphrase},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _profile_passphrase(profile_id: str) -> str:
    with db_mod.get_db() as conn:
        row = conn.execute("SELECT passphrase FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
    return row["passphrase"]


def _verify_email(profile_id: str) -> None:
    now = datetime.now(timezone.utc).isoformat()
    with db_mod.get_db() as conn:
        conn.execute("UPDATE player_profiles SET email_verified_at = ? WHERE id = ?", (now, profile_id))


def _insert_community(cid: str, name: str) -> None:
    with db_mod.get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO communities (id, name, created_by, created_at) VALUES (?, ?, 'admin', datetime('now'))",
            (cid, name),
        )


def _insert_club(club_id: str, community_id: str, name: str) -> None:
    with db_mod.get_db() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO clubs (id, community_id, name, logo_path, email_settings, created_by, created_at)
               VALUES (?, ?, ?, NULL, NULL, 'admin', datetime('now'))""",
            (club_id, community_id, name),
        )


def _registrant_profile_id(rid: str, player_id: str) -> str | None:
    with db_mod.get_db() as conn:
        row = conn.execute(
            "SELECT profile_id FROM registrants WHERE registration_id = ? AND player_id = ?",
            (rid, player_id),
        ).fetchone()
    return row["profile_id"] if row else None


# ────────────────────────────────────────────────────────────────────────────
# profile_linked flag on register response
# ────────────────────────────────────────────────────────────────────────────


class TestProfileLinkedFlag:
    def test_unlinked_registration_reports_false(self, client, auth_headers):
        rid = _make_lobby(client, auth_headers)
        res = _register(client, rid, "Solo Player", email="solo@example.com")
        assert res["profile_linked"] is False

    def test_verified_email_autolink_reports_true(self, client, auth_headers):
        # A verified profile exists for this email.
        rid0 = _make_lobby(client, auth_headers, name="Seed")
        seed = _register(client, rid0, "Returning Rita", email="rita@example.com")
        prof = _create_profile(client, "Returning Rita", "rita@example.com", seed["passphrase"])
        _verify_email(prof["profile"]["id"])

        # Registering again with the same email auto-links and reports it.
        rid = _make_lobby(client, auth_headers, name="New")
        res = _register(client, rid, "Returning Rita 2", email="rita@example.com")
        assert res["profile_linked"] is True
        assert _registrant_profile_id(rid, res["player_id"]) == prof["profile"]["id"]

    def test_explicit_passphrase_link_reports_true(self, client, auth_headers):
        rid0 = _make_lobby(client, auth_headers, name="Seed2")
        seed = _register(client, rid0, "Coded Carl", email="carl@example.com")
        prof = _create_profile(client, "Coded Carl", "carl@example.com", seed["passphrase"])
        pp = _profile_passphrase(prof["profile"]["id"])

        rid = _make_lobby(client, auth_headers, name="New2")
        r = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Coded Carl", "profile_passphrase": pp},
        )
        assert r.status_code == 200, r.text
        assert r.json()["profile_linked"] is True


# ────────────────────────────────────────────────────────────────────────────
# recover-by-participation
# ────────────────────────────────────────────────────────────────────────────


class TestRecoverByParticipation:
    def test_unknown_email_returns_ok_and_creates_nothing(self, client, auth_headers):
        r = client.post("/api/player-profile/recover-by-participation", json={"email": "nobody@example.com"})
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        with db_mod.get_db() as conn:
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM player_profiles WHERE LOWER(email) = 'nobody@example.com'"
            ).fetchone()["n"]
        assert n == 0

    def test_matching_email_creates_profile_and_links(self, client, auth_headers):
        rid = _make_lobby(client, auth_headers)
        reg = _register(client, rid, "Forgot Fiona", email="fiona@example.com")

        # No profile yet.
        assert _registrant_profile_id(rid, reg["player_id"]) is None

        r = client.post("/api/player-profile/recover-by-participation", json={"email": "fiona@example.com"})
        assert r.status_code == 200
        assert r.json() == {"ok": True}

        # A profile now exists for the email and the participation is linked.
        with db_mod.get_db() as conn:
            prof = conn.execute(
                "SELECT id FROM player_profiles WHERE LOWER(email) = 'fiona@example.com' AND is_ghost = 0"
            ).fetchone()
        assert prof is not None
        assert _registrant_profile_id(rid, reg["player_id"]) == prof["id"]

    def test_invalid_email_is_noop(self, client):
        r = client.post("/api/player-profile/recover-by-participation", json={"email": "not-an-email"})
        assert r.status_code == 200
        assert r.json() == {"ok": True}


# ────────────────────────────────────────────────────────────────────────────
# Name discovery + organizer-approved claims
# ────────────────────────────────────────────────────────────────────────────


class TestNameClaims:
    def _setup_scope(self):
        _insert_community("c-alpha", "Alpha")
        _insert_community("c-beta", "Beta")
        _insert_club("club-a", "c-alpha", "Club A")
        _insert_club("club-b", "c-beta", "Club B")

    def test_find_by_name_scoped_to_club(self, client, auth_headers):
        self._setup_scope()
        # Past lobby in club A with "Nadia".
        past = _make_lobby(client, auth_headers, name="Past A", community_id="c-alpha", club_id="club-a")
        _register(client, past, "Nadia Name", email="")
        # Unrelated lobby in club B, also with a "Nadia".
        other = _make_lobby(client, auth_headers, name="Other B", community_id="c-beta", club_id="club-b")
        _register(client, other, "Nadia Name", email="")

        # Current lobby in club A.
        cur = _make_lobby(client, auth_headers, name="Current A", community_id="c-alpha", club_id="club-a")
        r = client.post(f"/api/registrations/{cur}/find-by-name", json={"player_name": "nadia name"})
        assert r.status_code == 200, r.text
        results = r.json()
        # Only the club-A past lobby is returned; the club-B one is out of scope.
        assert len(results) == 1
        assert results[0]["entity_id"] == past
        assert results[0]["entity_type"] == "registration"

    def test_find_by_name_excludes_current_lobby(self, client, auth_headers):
        self._setup_scope()
        cur = _make_lobby(client, auth_headers, name="Current", community_id="c-alpha", club_id="club-a")
        _register(client, cur, "Self Same")
        r = client.post(f"/api/registrations/{cur}/find-by-name", json={"player_name": "Self Same"})
        assert r.status_code == 200
        assert r.json() == []

    def test_claim_and_organizer_approve_links(self, client, auth_headers):
        self._setup_scope()
        past = _make_lobby(client, auth_headers, name="Past", community_id="c-alpha", club_id="club-a")
        past_reg = _register(client, past, "Claimy Clara")

        # Clara has a profile from some other participation.
        seed_lobby = _make_lobby(client, auth_headers, name="Seed", community_id="c-alpha", club_id="club-a")
        seed = _register(client, seed_lobby, "Claimy Clara Seed", email="clara@example.com")
        prof = _create_profile(client, "Claimy Clara", "clara@example.com", seed["passphrase"])
        pp = _profile_passphrase(prof["profile"]["id"])

        cur = _make_lobby(client, auth_headers, name="Current", community_id="c-alpha", club_id="club-a")

        # Raise a claim on the past participation.
        r = client.post(
            f"/api/registrations/{cur}/claim-participation",
            json={
                "profile_passphrase": pp,
                "entity_type": "registration",
                "entity_id": past,
                "player_id": past_reg["player_id"],
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending"
        # Not linked yet.
        assert _registrant_profile_id(past, past_reg["player_id"]) is None

        # Organizer sees the pending claim.
        r = client.get(f"/api/registrations/{cur}/claims", headers=auth_headers)
        assert r.status_code == 200, r.text
        claims = r.json()
        assert len(claims) == 1
        claim_id = claims[0]["id"]
        assert claims[0]["entity_id"] == past

        # Approve → participation linked to the profile.
        r = client.post(
            f"/api/registrations/{cur}/claims/{claim_id}/resolve",
            params={"approve": True},
            headers=auth_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "approved"
        assert _registrant_profile_id(past, past_reg["player_id"]) == prof["profile"]["id"]

    def test_claim_reject_does_not_link(self, client, auth_headers):
        self._setup_scope()
        past = _make_lobby(client, auth_headers, name="Past", community_id="c-alpha", club_id="club-a")
        past_reg = _register(client, past, "Reject Ron")
        seed_lobby = _make_lobby(client, auth_headers, name="Seed", community_id="c-alpha", club_id="club-a")
        seed = _register(client, seed_lobby, "Reject Ron Seed", email="ron@example.com")
        prof = _create_profile(client, "Reject Ron", "ron@example.com", seed["passphrase"])
        pp = _profile_passphrase(prof["profile"]["id"])
        cur = _make_lobby(client, auth_headers, name="Current", community_id="c-alpha", club_id="club-a")

        client.post(
            f"/api/registrations/{cur}/claim-participation",
            json={
                "profile_passphrase": pp,
                "entity_type": "registration",
                "entity_id": past,
                "player_id": past_reg["player_id"],
            },
        )
        claim_id = client.get(f"/api/registrations/{cur}/claims", headers=auth_headers).json()[0]["id"]
        r = client.post(
            f"/api/registrations/{cur}/claims/{claim_id}/resolve",
            params={"approve": False},
            headers=auth_headers,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        assert _registrant_profile_id(past, past_reg["player_id"]) is None

    def test_claim_requires_known_profile(self, client, auth_headers):
        self._setup_scope()
        past = _make_lobby(client, auth_headers, name="Past", community_id="c-alpha", club_id="club-a")
        past_reg = _register(client, past, "Ghost Gary")
        cur = _make_lobby(client, auth_headers, name="Current", community_id="c-alpha", club_id="club-a")
        r = client.post(
            f"/api/registrations/{cur}/claim-participation",
            json={
                "profile_passphrase": "made up words here",
                "entity_type": "registration",
                "entity_id": past,
                "player_id": past_reg["player_id"],
            },
        )
        assert r.status_code == 401

    def test_claims_list_requires_organizer(self, client, auth_headers, alice_headers):
        rid = _make_lobby(client, auth_headers, name="Owned by admin")
        # alice is not the owner / co-editor.
        r = client.get(f"/api/registrations/{rid}/claims", headers=alice_headers)
        assert r.status_code == 403


# ────────────────────────────────────────────────────────────────────────────
# Email convergence: confirmation link carries #hub_token
# ────────────────────────────────────────────────────────────────────────────


class TestEmailHubTokenConvergence:
    def test_autosend_confirmation_includes_hub_token(self, client, auth_headers, monkeypatch):
        import backend.api.routes_registration as reg_mod
        import backend.email as email_mod

        # The link (and thus #hub_token) is only built when a site URL is set.
        monkeypatch.setattr(email_mod, "SITE_URL", "https://example.test")

        captured: list[tuple] = []
        monkeypatch.setattr(
            reg_mod,
            "send_email_background",
            lambda *a, **k: captured.append((a, k)),
        )

        r = client.post(
            "/api/registrations",
            json={"name": "AutoSend", "auto_send_email": True, "email_requirement": "required"},
            headers=auth_headers,
        )
        rid = r.json()["id"]

        res = _register(client, rid, "Emailed Emma", email="emma@example.com")
        assert res["profile_linked"] is False  # no verified profile existed beforehand

        assert captured, "confirmation email should have been queued"
        body = captured[0][0][2]  # send_email_background(email, subject, body, ...)
        assert "#hub_token=" in body

        # A Hub profile was bootstrapped for the email and the participation linked.
        with db_mod.get_db() as conn:
            prof = conn.execute(
                "SELECT id FROM player_profiles WHERE LOWER(email) = 'emma@example.com' AND is_ghost = 0"
            ).fetchone()
        assert prof is not None
        assert _registrant_profile_id(rid, res["player_id"]) == prof["id"]


# ────────────────────────────────────────────────────────────────────────────
# Autosuggest matching semantics + already_linked flag on find-by-name
# ────────────────────────────────────────────────────────────────────────────


class TestFindByNameMatching:
    def _setup_scope(self):
        _insert_community("c-alpha", "Alpha")
        _insert_club("club-a", "c-alpha", "Club A")

    def _lobby_pair(self, client, auth_headers) -> tuple[str, str]:
        """A past lobby and the current lobby, both in club A."""
        past = _make_lobby(client, auth_headers, name="Past A", community_id="c-alpha", club_id="club-a")
        cur = _make_lobby(client, auth_headers, name="Current A", community_id="c-alpha", club_id="club-a")
        return past, cur

    def _search(self, client, rid: str, query: str) -> list[dict]:
        r = client.post(f"/api/registrations/{rid}/find-by-name", json={"player_name": query})
        assert r.status_code == 200, r.text
        return r.json()

    def test_token_prefix_matching(self, client, auth_headers):
        self._setup_scope()
        past, cur = self._lobby_pair(client, auth_headers)
        _register(client, past, "Denis Belyakov")

        for query in ("den", "den bel", "belya", "DENIS BELYAKOV"):
            names = [m["player_name"] for m in self._search(client, cur, query)]
            assert "Denis Belyakov" in names, f"query {query!r} should match"

        assert self._search(client, cur, "denisx") == []
        assert self._search(client, cur, "den bez") == []

    def test_accent_insensitive(self, client, auth_headers):
        self._setup_scope()
        past, cur = self._lobby_pair(client, auth_headers)
        _register(client, past, "José García")

        assert self._search(client, cur, "jose garcia") != []
        assert self._search(client, cur, "josé") != []

    def test_min_query_length(self, client, auth_headers):
        self._setup_scope()
        past, cur = self._lobby_pair(client, auth_headers)
        _register(client, past, "Denis Belyakov")
        assert self._search(client, cur, "d") == []

    def test_already_linked_included_and_flagged(self, client, auth_headers):
        self._setup_scope()
        past, cur = self._lobby_pair(client, auth_headers)
        linked = _register(client, past, "Linked Lena", email="lena@example.com")
        _create_profile(client, "Linked Lena", "lena@example.com", linked["passphrase"])

        [match] = self._search(client, cur, "linked lena")
        assert match["already_linked"] is True

        # Claiming a linked participation is still rejected server-side.
        pp = _profile_passphrase(_registrant_profile_id(past, linked["player_id"]))
        r = client.post(
            f"/api/registrations/{cur}/claim-participation",
            json={
                "profile_passphrase": pp,
                "entity_type": "registration",
                "entity_id": past,
                "player_id": linked["player_id"],
            },
        )
        assert r.status_code == 409

    def test_exact_matches_sort_first(self, client, auth_headers):
        self._setup_scope()
        past, cur = self._lobby_pair(client, auth_headers)
        _register(client, past, "Ana Torres Marino")
        _register(client, past, "Ana Torres")

        results = self._search(client, cur, "ana torres")
        assert results[0]["player_name"] == "Ana Torres"


# ────────────────────────────────────────────────────────────────────────────
# GET /{rid}/my-entry — JWT-based "am I registered here?" check
# ────────────────────────────────────────────────────────────────────────────


class TestMyEntry:
    def _profile_token(self, client, passphrase: str) -> str:
        r = client.post("/api/player-profile/login", json={"passphrase": passphrase})
        assert r.status_code == 200, r.text
        return r.json()["access_token"]

    def test_requires_profile_auth(self, client, auth_headers):
        rid = _make_lobby(client, auth_headers)
        r = client.get(f"/api/registrations/{rid}/my-entry")
        assert r.status_code == 401

    def test_404_when_not_registered(self, client, auth_headers):
        seed_lobby = _make_lobby(client, auth_headers, name="Seed")
        seed = _register(client, seed_lobby, "Elsewhere Eva", email="eva@example.com")
        prof = _create_profile(client, "Elsewhere Eva", "eva@example.com", seed["passphrase"])
        token = self._profile_token(client, _profile_passphrase(prof["profile"]["id"]))

        other = _make_lobby(client, auth_headers, name="Other")
        r = client.get(f"/api/registrations/{other}/my-entry", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 404

    def test_finds_profile_linked_entry(self, client, auth_headers):
        seed_lobby = _make_lobby(client, auth_headers, name="Seed")
        seed = _register(client, seed_lobby, "Hub Hanna", email="hanna@example.com")
        prof = _create_profile(client, "Hub Hanna", "hanna@example.com", seed["passphrase"])
        pp = _profile_passphrase(prof["profile"]["id"])
        token = self._profile_token(client, pp)

        rid = _make_lobby(client, auth_headers, name="Target")
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Hub Hanna", "profile_passphrase": pp},
        ).json()

        r = client.get(f"/api/registrations/{rid}/my-entry", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        assert r.json()["player_id"] == reg["player_id"]
        assert r.json()["player_name"] == "Hub Hanna"

    def test_falls_back_to_profile_passphrase_match(self, client, auth_headers):
        seed_lobby = _make_lobby(client, auth_headers, name="Seed")
        seed = _register(client, seed_lobby, "Fallback Fay", email="fay@example.com")
        prof = _create_profile(client, "Fallback Fay", "fay@example.com", seed["passphrase"])
        pid = prof["profile"]["id"]
        token = self._profile_token(client, _profile_passphrase(pid))

        # The seed registrant shares the profile passphrase; sever the explicit
        # link to exercise the passphrase fallback.
        with db_mod.get_db() as conn:
            conn.execute(
                "UPDATE registrants SET profile_id = NULL WHERE registration_id = ? AND player_id = ?",
                (seed_lobby, seed["player_id"]),
            )

        r = client.get(f"/api/registrations/{seed_lobby}/my-entry", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 200, r.text
        assert r.json()["player_id"] == seed["player_id"]
