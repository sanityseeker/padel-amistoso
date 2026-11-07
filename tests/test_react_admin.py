"""Routing boundaries between the built React admin and existing public pages."""

import pytest

import backend.api as api_module


@pytest.fixture
def react_build(tmp_path, monkeypatch):
    build = tmp_path / "react-dist"
    build.mkdir()
    (build / "index.html").write_text('<html><title>Torneos</title><div id="react-test"></div></html>')
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", build)
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", False)
    return build


@pytest.mark.parametrize("path", ["/", "/admin"])
def test_built_admin_is_served_without_html_cache(client, react_build, path):
    response = client.get(path)
    assert response.status_code == 200
    assert 'id="react-test"' in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_missing_build_falls_back_to_existing_admin(client, tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
    response = client.get("/admin")
    assert response.status_code == 200
    assert 'id="auth-dialog"' in response.text


def test_built_assets_are_served_with_immutable_cache(client, react_build):
    assets = react_build / "admin-assets"
    assets.mkdir()
    (assets / "app-123.js").write_text("console.log('admin');")
    response = client.get("/admin-assets/app-123.js")
    assert response.status_code == 200
    assert response.text == "console.log('admin');"
    assert "immutable" in response.headers["cache-control"]
    assert client.get("/admin-assets/missing.js").status_code == 404


def test_assets_cannot_escape_build_directory(client, react_build):
    (react_build / "private.txt").write_text("do not serve")
    response = client.get("/admin-assets/%2e%2e/private.txt")
    assert response.status_code == 404


def test_asset_request_without_build_returns_404(client, tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
    assert client.get("/admin-assets/app.js").status_code == 404


@pytest.mark.parametrize("path", ["/legacy-admin", "/admin?invite_token=example", "/?reset_token=example"])
def test_advanced_and_account_recovery_keep_existing_ui(client, react_build, path):
    response = client.get(path)
    assert response.status_code == 200
    assert 'id="auth-dialog"' in response.text
    assert 'id="react-test"' not in response.text


def test_demo_keeps_onboarding(client, react_build, monkeypatch):
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    response = client.get("/admin")
    assert response.status_code == 200
    assert 'id="auth-dialog"' in response.text
    assert 'class="demo-instance"' in response.text


@pytest.mark.parametrize("path", ["/register/some-alias", "/tv/some-alias"])
def test_public_pages_are_not_replaced(client, react_build, path):
    response = client.get(path)
    assert response.status_code == 200
    assert 'id="react-test"' not in response.text


def test_player_hub_uses_shared_react_build(client, react_build):
    response = client.get("/player")
    assert response.status_code == 200
    assert 'id="react-test"' in response.text
    assert response.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("path", ["/events", "/register", "/tv"])
def test_public_directory_uses_shared_react_build(client, react_build, path):
    response = client.get(path)
    assert response.status_code == 200
    assert 'id="react-test"' in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_events_demo_page_keeps_html_class_and_noindex(client, react_build, monkeypatch):
    (react_build / "index.html").write_text('<html lang="en"><div id="react-test"></div></html>')
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    response = client.get("/events")
    assert '<html lang="en" class="demo-instance">' in response.text
    assert 'id="react-test"' in response.text
    assert response.headers["X-Robots-Tag"] == "noindex"


def test_legacy_events_keep_original_template(client, react_build):
    response = client.get("/legacy-events")
    assert response.status_code == 200
    assert 'id="tv-root"' in response.text


@pytest.mark.parametrize("key", ["tid", "t"])
def test_old_tournament_links_reach_tv_and_preserve_player_token(client, key):
    response = client.get(f"/events?{key}=summer-cup&player_token=example&x=1", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/tv/summer-cup?player_token=example&x=1"


def test_detailed_player_tools_keep_existing_ui(client, react_build):
    response = client.get("/legacy-player")
    assert response.status_code == 200
    assert 'id="react-test"' not in response.text
    assert "/player.js" in response.text


def test_player_hub_falls_back_without_build(client, tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
    assert "/player.js" in client.get("/player").text


@pytest.mark.parametrize("path", ["/player", "/legacy-player"])
def test_player_hub_stays_unavailable_on_demo(client, react_build, monkeypatch, path):
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    response = client.get(path, follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/events"
