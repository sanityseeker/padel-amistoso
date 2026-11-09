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


def test_advanced_view_keeps_existing_ui(client, react_build):
    response = client.get("/legacy/admin")
    assert response.status_code == 200
    assert 'id="auth-dialog"' in response.text
    assert 'id="react-test"' not in response.text


@pytest.mark.parametrize(
    "path",
    [
        "/admin?invite_token=example",
        "/?reset_token=example",
        "/?invite_token=example",
        "/admin/account/reset?reset_token=example",
        "/admin/account/invite?invite_token=example",
        "/admin/account/forgot",
    ],
)
def test_account_recovery_is_served_by_the_spa(client, react_build, path):
    response = client.get(path)
    assert response.status_code == 200
    assert 'id="react-test"' in response.text
    assert 'id="auth-dialog"' not in response.text
    assert response.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("path", ["/?reset_token=example", "/admin?invite_token=example"])
def test_demo_recovery_links_are_served_by_the_spa(client, react_build, monkeypatch, path):
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    assert 'id="react-test"' in client.get(path).text


def test_demo_instance_serves_the_spa_with_the_demo_class(client, react_build, monkeypatch):
    # The React login page has the one-click sandbox start, so the demo no longer needs the legacy page.
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    for path in ("/admin", "/admin/new"):
        response = client.get(path)
        assert response.status_code == 200
        assert 'id="react-test"' in response.text
        assert 'class="demo-instance"' in response.text


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
    response = client.get("/legacy/events")
    assert response.status_code == 200
    assert 'id="tv-root"' in response.text


@pytest.mark.parametrize("key", ["tid", "t"])
def test_old_tournament_links_reach_tv_and_preserve_player_token(client, key):
    response = client.get(f"/events?{key}=summer-cup&player_token=example&x=1", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/tv/summer-cup?player_token=example&x=1"


def test_detailed_player_tools_keep_existing_ui(client, react_build):
    response = client.get("/legacy/player")
    assert response.status_code == 200
    assert 'id="react-test"' not in response.text
    assert "/player.js" in response.text


def test_player_hub_falls_back_without_build(client, tmp_path, monkeypatch):
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
    assert "/player.js" in client.get("/player").text


@pytest.mark.parametrize("path", ["/player", "/legacy/player"])
def test_player_hub_stays_unavailable_on_demo(client, react_build, monkeypatch, path):
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    response = client.get(path, follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/events"


@pytest.mark.parametrize(
    "path",
    [
        "/admin/t/some-id",
        "/admin/lobby/x",
        "/admin/clubs",
        "/admin/account/reset?reset_token=x",
        "/player/anything",
        "/events/x/y",
    ],
)
def test_nested_spa_paths_serve_the_react_shell(client, react_build, path):
    response = client.get(path)
    assert response.status_code == 200
    assert 'id="react-test"' in response.text
    assert response.headers["cache-control"] == "no-cache"


def test_spa_shell_supports_conditional_requests(client, react_build):
    first = client.get("/events")
    etag = first.headers["etag"]
    second = client.get("/events", headers={"If-None-Match": etag})
    assert second.status_code == 304
    assert second.headers["cache-control"] == "no-cache"
    (react_build / "index.html").write_text('<html><div id="react-test-2"></div></html>')
    third = client.get("/events", headers={"If-None-Match": etag})
    assert third.status_code == 200
    assert "react-test-2" in third.text


def test_path_traversal_under_admin_never_reads_files(client, react_build):
    (react_build / "private.txt").write_text("do not serve")
    response = client.get("/admin/%2e%2e/private.txt")
    assert "do not serve" not in response.text


@pytest.mark.parametrize(
    ("source", "expected"),
    [
        ('<html lang="en">', '<html lang="en" class="demo-instance">'),
        ("<html>", '<html class="demo-instance">'),
        ('<html class="x" lang="en">', '<html class="x demo-instance" lang="en">'),
        ("<html lang='en' class='x'>", "<html lang='en' class='x demo-instance'>"),
        ('<HTML lang="en">', '<html lang="en" class="demo-instance">'),
    ],
)
def test_demo_class_injection_is_attribute_order_agnostic(source, expected):
    assert api_module._mark_demo_instance(source + "<body></body>").startswith(expected)


def test_demo_class_is_injected_on_nested_spa_paths(client, react_build, monkeypatch):
    (react_build / "index.html").write_text('<html lang="en"><div id="react-test"></div></html>')
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    assert 'class="demo-instance"' in client.get("/events/anything").text
    response = client.get("/player/anything", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/events"
    assert 'class="demo-instance"' in client.get("/admin/t/x").text


def test_real_build_keeps_a_demo_injectable_html_tag():
    index = api_module.ADMIN_BUILD_DIR / "index.html"
    if not index.is_file():
        pytest.skip("frontend/admin-app has not been built")
    assert 'class="demo-instance"' in api_module._mark_demo_instance(index.read_text())


# ── /legacy/* consolidation ─────────────────────────────────────────────────


def test_legacy_root_redirects_to_legacy_admin(client):
    response = client.get("/legacy", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/legacy/admin"


@pytest.mark.parametrize(
    ("old", "new"),
    [
        ("/legacy-admin", "/legacy/admin"),
        ("/legacy-events", "/legacy/events"),
        ("/legacy-player", "/legacy/player"),
    ],
)
def test_old_legacy_paths_redirect_permanently(client, old, new):
    response = client.get(old, follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == new


def test_old_legacy_redirect_preserves_the_query_string(client):
    response = client.get("/legacy-admin?tab=info&invite_token=abc%20def", follow_redirects=False)
    assert response.status_code == 308
    assert response.headers["location"] == "/legacy/admin?tab=info&invite_token=abc%20def"


@pytest.mark.parametrize("old", ["/legacy-admin", "/legacy-events", "/legacy-player"])
def test_old_legacy_redirect_cannot_be_pointed_elsewhere(client, old):
    # The target is a fixed path plus the query, so a crafted query or Host never changes the destination.
    response = client.get(old + "?next=https://evil.example/&//evil.example", follow_redirects=False)
    assert response.headers["location"].startswith("/legacy/")
    assert not response.headers["location"].startswith("//")


def test_legacy_pages_are_served_unchanged_by_the_react_build(client, react_build):
    assert 'id="auth-dialog"' in client.get("/legacy/admin").text
    assert 'id="tv-root"' in client.get("/legacy/events").text
    assert "/player.js" in client.get("/legacy/player").text


def test_demo_legacy_player_redirects_to_events(client, react_build, monkeypatch):
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    response = client.get("/legacy/player", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/events"
    old = client.get("/legacy-player", follow_redirects=False)
    assert old.status_code == 308
    assert old.headers["location"] == "/legacy/player"


@pytest.mark.parametrize("page", ["/legacy/admin", "/legacy/events", "/legacy/player"])
def test_legacy_pages_keep_the_support_footer(client, react_build, page):
    html = client.get(page).text
    assert 'class="support-links' in html
    assert "https://ko-fi.com/torneosamistosos" in html
    assert "https://github.com/sanityseeker/padel-amistoso" in html


def test_legacy_admin_skips_the_cold_start_redirect(client, react_build):
    html = client.get("/legacy/admin").text
    assert "window.location.pathname.indexOf('/legacy') === 0" in html


def test_legacy_header_tags_itself():
    from pathlib import Path

    shared = (Path(api_module.FRONTEND_DIR) / "shared.js").read_text()
    assert "window.location.pathname.indexOf('/legacy/') === 0" in shared
    assert 'class="badge public-legacy-badge"' in shared
