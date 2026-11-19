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


@pytest.mark.parametrize("path", ["/", "/admin", "/admin/t/x", "/events", "/player", "/tv/x", "/register/x", "/club/x"])
def test_missing_build_serves_the_not_built_notice(client, tmp_path, monkeypatch, path):
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", False)
    response = client.get(path)
    assert response.status_code == 200
    assert "The web app is not built" in response.text
    assert response.headers["cache-control"] == "no-cache"


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
    assert response.headers["cache-control"] == "no-cache"


@pytest.mark.parametrize("path", ["/?reset_token=example", "/admin?invite_token=example"])
def test_demo_recovery_links_are_served_by_the_spa(client, react_build, monkeypatch, path):
    monkeypatch.setattr(api_module.config, "DEMO_INSTANCE", True)
    assert 'id="react-test"' in client.get(path).text


def test_demo_instance_serves_the_spa_with_the_demo_class(client, react_build, monkeypatch):
    # The React login page has the one-click sandbox start.
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


@pytest.mark.parametrize("key", ["tid", "t"])
def test_old_tournament_links_reach_tv_and_preserve_player_token(client, key):
    response = client.get(f"/events?{key}=summer-cup&player_token=example&x=1", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == "/tv/summer-cup?player_token=example&x=1"


@pytest.mark.parametrize("path", ["/player", "/player/anything"])
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


def test_shell_source_keeps_a_demo_injectable_html_tag():
    # Vite copies the <html> tag of the source page into the build unchanged.
    index = api_module.FRONTEND_DIR / "admin-app" / "index.html"
    assert 'class="demo-instance"' in api_module._mark_demo_instance(index.read_text())
