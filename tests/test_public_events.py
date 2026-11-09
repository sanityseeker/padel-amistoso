"""Public Events directory: the ``/events`` page + ``GET /api/public-events``.

Covers the page routes (``/events`` serves public.html, bare ``/tv`` and
``/register`` redirect there, the alias routes are unchanged, club subdomains
collapse the directories onto ``/``) and the API exposure rules: the merged
list must show exactly what the two old public lists showed — no private
tournaments, no closed / unlisted / archived lobbies, never registrant names,
join codes, owners or emails — plus ETag/304 and the stored pin order.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import backend.api as api_module
from backend.api import app


@pytest.fixture()
def client():
    return TestClient(app)


_GP_BODY = {
    "name": "Public Cup",
    "player_names": ["A", "B", "C", "D"],
    "team_mode": False,
    "court_names": ["Court 1"],
    "num_groups": 1,
    "top_per_group": 1,
    "double_elimination": False,
}


def _create_gp(client: TestClient, headers: dict, **over) -> str:
    body = {**_GP_BODY, **over}
    r = client.post("/api/tournaments/group-playoff", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _create_lobby(client: TestClient, headers: dict, **over) -> str:
    body = {"name": "Open lobby", "sport": "padel", "open": True, "listed": True, **over}
    r = client.post("/api/registrations", json=body, headers=headers)
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def _create_club(client: TestClient, headers: dict, slug: str | None = None) -> dict:
    comm = client.post("/api/communities", json={"name": "Events Comm"}, headers=headers)
    assert comm.status_code == 201
    club = client.post("/api/clubs", json={"community_id": comm.json()["id"], "name": "Events Club"}, headers=headers)
    assert club.status_code == 201
    out = club.json()
    out["community_id"] = comm.json()["id"]
    if slug:
        r = client.patch(f"/api/clubs/{out['id']}/slug", json={"slug": slug}, headers=headers)
        assert r.status_code == 200, r.text
    return out


# ── Page routes ──────────────────────────────────────────────────────────────


class TestEventsRoutes:
    def test_events_falls_back_to_public_html_without_build(self, client, monkeypatch, tmp_path):
        import backend.api as api_module

        monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing-build")
        r = client.get("/events")
        assert r.status_code == 200
        assert 'id="tv-root"' in r.text
        assert "/tv.js" in r.text

    @pytest.mark.parametrize("path", ["/tv", "/register"])
    def test_bare_directories_redirect_to_events(self, client, path):
        r = client.get(path, follow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"] == "/events"

    def test_redirect_preserves_query_string(self, client):
        r = client.get("/tv?tid=abc&x=1", follow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"] == "/events?tid=abc&x=1"

    def test_alias_routes_unchanged(self, client, tmp_path, monkeypatch):
        # Without a React build the public pages fall back to the legacy ones (see test_public_spa_routes).
        monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
        tv = client.get("/tv/summer-cup", follow_redirects=False)
        assert tv.status_code == 200
        assert 'id="tv-root"' in tv.text
        reg = client.get("/register/summer-cup", follow_redirects=False)
        assert reg.status_code == 200
        assert 'id="reg-root"' in reg.text

    def test_legacy_short_routes_still_land_on_events(self, client):
        r = client.get("/t", follow_redirects=True)
        assert r.status_code == 200
        assert str(r.url).endswith("/events")

    @pytest.mark.parametrize("path", ["/events", "/tv", "/register"])
    def test_club_subdomain_directories_go_to_club_root(self, client, auth_headers, path):
        _create_club(client, auth_headers, slug="padelclub")
        r = client.get(path, headers={"host": "padelclub.example.com"}, follow_redirects=False)
        assert r.status_code == 302
        assert r.headers["location"] == "/"

    def test_club_subdomain_alias_routes_fall_through(self, client, auth_headers, tmp_path, monkeypatch):
        monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
        _create_club(client, auth_headers, slug="padelclub")
        r = client.get("/tv/some-alias", headers={"host": "padelclub.example.com"}, follow_redirects=False)
        assert r.status_code == 200
        assert 'id="tv-root"' in r.text


# ── GET /api/public-events ───────────────────────────────────────────────────


class TestPublicEventsApi:
    def test_empty(self, client):
        r = client.get("/api/public-events")
        assert r.status_code == 200
        assert r.json() == []

    def test_lists_public_tournaments_and_open_listed_lobbies(self, client, auth_headers):
        tid = _create_gp(client, auth_headers)
        rid = _create_lobby(client, auth_headers, join_code="secret-1")
        items = client.get("/api/public-events").json()
        by_key = {(it["kind"], it["id"]): it for it in items}
        assert ("tournament", tid) in by_key
        assert ("registration", rid) in by_key
        t_item = by_key[("tournament", tid)]
        assert t_item["status"] == "in_progress"  # a fresh GP starts in the groups phase
        assert t_item["type"] == "group_playoff"
        assert t_item["pinned"] is False
        assert t_item["registrant_count"] is None
        r_item = by_key[("registration", rid)]
        assert r_item["status"] == "open_registration"
        assert r_item["join_code_required"] is True
        assert r_item["registrant_count"] == 0
        assert "community_name" in r_item and "club_name" in r_item

    def test_item_shape_matches_club_endpoint(self, client, auth_headers):
        club = _create_club(client, auth_headers)
        tid = _create_gp(client, auth_headers)
        client.patch(
            f"/api/tournaments/{tid}/community", json={"community_id": club["community_id"]}, headers=auth_headers
        )
        client.patch(f"/api/tournaments/{tid}/club", json={"club_id": club["id"]}, headers=auth_headers)
        global_items = client.get("/api/public-events").json()
        club_items = client.get(f"/api/clubs/{club['id']}/public-tournaments").json()
        g = next(it for it in global_items if it["id"] == tid)
        c = next(it for it in club_items if it["id"] == tid)
        assert set(g) == set(c)
        assert g["club_name"] == "Events Club" == c["club_name"]
        assert g["club_id"] == club["id"]

    def test_excludes_private_tournaments(self, client, auth_headers):
        public_tid = _create_gp(client, auth_headers, name="Pub")
        private_tid = _create_gp(client, auth_headers, name="Priv", public=False)
        ids = {it["id"] for it in client.get("/api/public-events").json()}
        assert public_tid in ids
        assert private_tid not in ids

    def test_excludes_closed_unlisted_and_archived_lobbies(self, client, auth_headers):
        open_rid = _create_lobby(client, auth_headers, name="Open")
        closed_rid = _create_lobby(client, auth_headers, name="Closed")
        r = client.patch(f"/api/registrations/{closed_rid}", json={"open": False}, headers=auth_headers)
        assert r.status_code == 200, r.text
        unlisted_rid = _create_lobby(client, auth_headers, name="Unlisted", listed=False)
        archived_rid = _create_lobby(client, auth_headers, name="Archived")
        r = client.patch(f"/api/registrations/{archived_rid}", json={"archived": True}, headers=auth_headers)
        assert r.status_code == 200, r.text
        ids = {it["id"] for it in client.get("/api/public-events").json()}
        assert open_rid in ids
        assert closed_rid not in ids
        assert unlisted_rid not in ids
        assert archived_rid not in ids

    def test_never_leaks_names_codes_owner_or_email(self, client, auth_headers):
        rid = _create_lobby(client, auth_headers, join_code="hush-hush")
        reg = client.post(
            f"/api/registrations/{rid}/register",
            json={"player_name": "Zelda Secretname", "email": "zelda@example.com", "join_code": "hush-hush"},
        )
        assert reg.status_code in (200, 201), reg.text
        _create_gp(client, auth_headers)
        r = client.get("/api/public-events")
        body = r.text
        for forbidden in ("Zelda", "zelda@example.com", "hush-hush", 'join_code"', '"owner"', "registrants", "email"):
            assert forbidden not in body, forbidden
        lobby = next(it for it in r.json() if it["id"] == rid)
        assert lobby["registrant_count"] == 1
        assert lobby["join_code_required"] is True

    def test_etag_and_304(self, client, auth_headers):
        _create_gp(client, auth_headers)
        first = client.get("/api/public-events")
        assert first.status_code == 200
        tag = first.headers.get("etag")
        assert tag
        assert first.headers.get("cache-control") == "public, max-age=15"
        again = client.get("/api/public-events", headers={"If-None-Match": tag})
        assert again.status_code == 304
        assert again.headers.get("etag") == tag
        # A change invalidates the tag.
        _create_gp(client, auth_headers, name="Another")
        changed = client.get("/api/public-events", headers={"If-None-Match": tag})
        assert changed.status_code == 200
        assert changed.headers.get("etag") != tag


class TestClubPinnedOrder:
    def test_pinned_items_follow_stored_order(self, client, auth_headers):
        club = _create_club(client, auth_headers)
        tids = []
        for name in ("One", "Two", "Three"):
            tid = _create_gp(client, auth_headers, name=name)
            client.patch(
                f"/api/tournaments/{tid}/community", json={"community_id": club["community_id"]}, headers=auth_headers
            )
            client.patch(f"/api/tournaments/{tid}/club", json={"club_id": club["id"]}, headers=auth_headers)
            tids.append(tid)
        rid = _create_lobby(client, auth_headers, name="Lobby", community_id=club["community_id"], club_id=club["id"])

        order = [f"tn:{tids[2]}", f"reg:{rid}", f"tn:{tids[0]}"]
        upd = client.patch(
            f"/api/clubs/{club['id']}/landing", json={"pinned_tournament_ids": order}, headers=auth_headers
        )
        assert upd.status_code == 200, upd.text
        assert upd.json()["pinned_tournament_ids"] == order

        items = client.get(f"/api/clubs/{club['id']}/public-tournaments").json()
        assert [it["pin_key"] for it in items[:3]] == order
        assert all(it["pinned"] for it in items[:3])
        assert items[3]["id"] == tids[1]
        assert items[3]["pinned"] is False

        # Moving one id re-orders the public list accordingly.
        moved = [order[1], order[0], order[2]]
        client.patch(f"/api/clubs/{club['id']}/landing", json={"pinned_tournament_ids": moved}, headers=auth_headers)
        items = client.get(f"/api/clubs/{club['id']}/public-tournaments").json()
        assert [it["pin_key"] for it in items[:3]] == moved

    def test_raw_ids_in_pin_list_are_still_ordered(self, client, auth_headers):
        """Legacy pins stored as bare ids (``tn_…``) keep working."""
        club = _create_club(client, auth_headers)
        a = _create_gp(client, auth_headers, name="A")
        b = _create_gp(client, auth_headers, name="B")
        for tid in (a, b):
            client.patch(
                f"/api/tournaments/{tid}/community", json={"community_id": club["community_id"]}, headers=auth_headers
            )
            client.patch(f"/api/tournaments/{tid}/club", json={"club_id": club["id"]}, headers=auth_headers)
        from backend.api.db import get_db
        import json

        with get_db() as conn:
            conn.execute("UPDATE clubs SET pinned_tournament_ids = ? WHERE id = ?", (json.dumps([b, a]), club["id"]))
        items = client.get(f"/api/clubs/{club['id']}/public-tournaments").json()
        assert [it["id"] for it in items] == [b, a]
        assert all(it["pinned"] for it in items)
