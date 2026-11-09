"""Routing of the React public pages: the spectator screen, sign-up, club landing and 404 page.

Each route serves the React shell when a build exists and falls back to the legacy page (or the legacy 404
page) when there is none. The shell is static: these routes never put tournament, lobby or player data into
the HTML, so private tournaments, unlisted lobbies and player secrets stay behind the API's own checks.
"""

from __future__ import annotations

import re

import pytest
from fastapi.testclient import TestClient

import backend.api as api_module
from backend.api import app

SHELL = (
    '<!doctype html><html lang="en"><head><title>Torneos</title></head><body><div id="react-test"></div></body></html>'
)


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def react_build(tmp_path, monkeypatch):
    build = tmp_path / "react-dist"
    build.mkdir()
    (build / "index.html").write_text(SHELL)
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", build)
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", False)
    return build


@pytest.fixture
def no_build(tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", False)


def _club(client: TestClient, headers: dict[str, str], slug: str) -> str:
    community = client.post("/api/communities", json={"name": "Landing Community"}, headers=headers).json()
    club = client.post("/api/clubs", json={"community_id": community["id"], "name": "Landing Club"}, headers=headers)
    club_id = club.json()["id"]
    assert client.patch(f"/api/clubs/{club_id}/slug", json={"slug": slug}, headers=headers).status_code == 200
    return club_id


# ── With a build ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "path",
    [
        "/tv/some-alias",
        "/tv/some-alias?player_token=abc",
        "/register/some-alias",
        "/register/a?token=b",
        "/club/anything",
    ],
)
def test_public_pages_are_served_by_the_spa(client, react_build, path):
    response = client.get(path)
    assert response.status_code == 200
    assert 'id="react-test"' in response.text
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["etag"]


def test_the_shell_is_revalidated_with_its_etag(client, react_build):
    first = client.get("/tv/some-alias")
    again = client.get("/tv/some-alias", headers={"if-none-match": first.headers["etag"]})
    assert again.status_code == 304


@pytest.mark.parametrize("path", ["/tv/", "/register/", "/club/"])
def test_an_empty_slug_goes_to_the_events_directory(client, react_build, path):
    response = client.get(path, follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/events"


def test_the_shell_never_carries_event_data(client, react_build, auth_headers):
    """A private tournament, an unlisted lobby and a player secret are not in the page: only the API has them."""
    created = client.post(
        "/api/tournaments/mexicano",
        json={"name": "Secret Cup", "player_names": ["A", "B", "C", "D"], "public": False},
        headers=auth_headers,
    )
    assert created.status_code in (200, 201), created.text
    tid = created.json()["id"]
    secrets = client.get(f"/api/tournaments/{tid}/player-secrets", headers=auth_headers).json()["players"]
    passphrase = next(iter(secrets.values()))["passphrase"]
    for path in (f"/tv/{tid}", f"/register/{tid}", f"/club/{tid}"):
        html = client.get(path).text
        assert "Secret Cup" not in html
        assert passphrase not in html
        assert tid not in html.replace(path, "")
    # The directory feed still hides it, and the secrets still need the organizer.
    assert all(item["id"] != tid for item in client.get("/api/public-events").json())
    assert client.get(f"/api/tournaments/{tid}/player-secrets").status_code in (401, 403)


def test_the_public_pages_do_not_touch_the_admin_token():
    """No public page reads the organizer token (it lives in `padel-auth-token`)."""
    from pathlib import Path

    root = Path(__file__).resolve().parent.parent / "frontend" / "admin-app" / "src" / "features"
    for folder in ("tv", "register", "club", "public"):
        for path in (root / folder).rglob("*.ts*"):
            source = path.read_text()
            assert "padel-auth-token" not in source, path
            assert "TOKEN_KEY" not in source, path
            assert not re.search(r"\bapi<|\bwrite<|\bupload<", source), path


def test_legacy_pages_stay_reachable_with_a_build(client, react_build):
    assert 'id="tv-root"' in client.get("/legacy/tv/some-alias").text
    assert 'id="reg-root"' in client.get("/legacy/register/some-alias").text
    assert 'id="club-root"' in client.get("/legacy/club").text


# ── Without a build ─────────────────────────────────────────────────────────


def test_missing_build_falls_back_to_the_legacy_public_pages(client, no_build):
    assert 'id="tv-root"' in client.get("/tv/some-alias").text
    assert 'id="reg-root"' in client.get("/register/some-alias").text
    assert 'id="club-root"' in client.get("/legacy/club").text


def test_club_path_route_without_a_build_is_a_404(client, no_build):
    # The legacy landing page reads the club from the hostname, so it has no path form.
    response = client.get("/club/anything")
    assert response.status_code == 404


def test_missing_build_serves_the_legacy_404_page(client, no_build):
    response = client.get("/no/such/page")
    assert response.status_code == 404
    assert "404" in response.text and 'id="react-test"' not in response.text


# ── The 404 page ────────────────────────────────────────────────────────────


def test_unknown_paths_get_the_shell_with_a_404_status_and_the_home_url(client, react_build):
    response = client.get("/no/such/page", headers={"host": "example.com"})
    assert response.status_code == 404
    assert 'id="react-test"' in response.text
    home = re.search(r'<meta name="amistoso-home" content="([^"]*)"', response.text)
    assert home and home.group(1) == "http://example.com/"


def test_api_paths_still_404_as_json(client, react_build):
    response = client.get("/api/nope")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not found"}


# ── Club subdomains ─────────────────────────────────────────────────────────


def test_known_club_subdomain_serves_the_shell_with_the_slug(client, react_build, auth_headers):
    _club(client, auth_headers, "myclub")
    response = client.get("/", headers={"host": "myclub.example.com"})
    assert response.status_code == 200
    assert 'id="react-test"' in response.text
    assert '<meta name="amistoso-club" content="myclub">' in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_club_subdomain_without_a_build_serves_the_legacy_landing_page(client, no_build, auth_headers):
    _club(client, auth_headers, "myclub")
    response = client.get("/", headers={"host": "myclub.example.com"})
    assert response.status_code == 200
    assert 'id="club-root"' in response.text


def test_unknown_club_subdomain_is_the_404_shell_pointing_at_the_apex(client, react_build):
    response = client.get("/", headers={"host": "nosuchclub.example.com"})
    assert response.status_code == 404
    assert 'name="amistoso-club"' not in response.text
    home = re.search(r'<meta name="amistoso-home" content="([^"]*)"', response.text)
    assert home and home.group(1) == "http://example.com/"


def test_other_paths_on_a_club_subdomain_still_reach_the_spa_routes(client, react_build, auth_headers):
    _club(client, auth_headers, "myclub")
    for path in ("/tv/some-alias", "/register/some-alias"):
        response = client.get(path, headers={"host": "myclub.example.com"}, follow_redirects=False)
        assert response.status_code == 200
        assert 'id="react-test"' in response.text
        # Only the club landing carries the slug.
        assert 'name="amistoso-club"' not in response.text


def test_club_directories_collapse_onto_the_landing_page(client, react_build, auth_headers):
    _club(client, auth_headers, "myclub")
    for path in ("/events", "/tv", "/register"):
        response = client.get(path, headers={"host": "myclub.example.com"}, follow_redirects=False)
        assert response.status_code == 302
        assert response.headers["location"] == "/"


def test_demo_instance_refuses_club_subdomains(client, react_build, monkeypatch):
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    response = client.get("/", headers={"host": "myclub.example.com"}, follow_redirects=False)
    assert response.status_code == 302


# ── The service worker ──────────────────────────────────────────────────────


def test_service_worker_treats_the_public_pages_as_spa_routes(client):
    source = client.get("/service-worker.js").text
    assert "SPA_PREFIXES" in source
    for prefix in ("'/tv'", "'/register'", "'/club'"):
        assert prefix in source
    # The entry link of a lobby carries a credential: never cached.
    assert "'token'" in source and "'player_token'" in source
