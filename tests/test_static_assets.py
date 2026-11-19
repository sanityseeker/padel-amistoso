"""Tests for static frontend asset serving: compression, caching, ETags.

These guard the page-load-performance behavior of the static routes
(`/service-worker.js`, `/manifest.json`) — on-the-fly Brotli/gzip compression and ETag-based
304 revalidation. They are format-agnostic: they assert on response
headers and status codes, not on exact byte counts (the TestClient's
httpx transport transparently decodes compressed bodies).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

# The root-level text files served through the compression middleware + ETag helper.
TEXT_ASSETS = ["/service-worker.js", "/manifest.json"]


@pytest.mark.parametrize("path", TEXT_ASSETS)
def test_brotli_compression_when_accepted(client, path):
    """A client advertising `br` gets a Brotli-encoded response."""
    resp = client.get(path, headers={"Accept-Encoding": "br"})
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "br"
    # Shared caches must vary on Accept-Encoding to avoid serving the wrong variant.
    assert "accept-encoding" in resp.headers.get("vary", "").lower()


@pytest.mark.parametrize("path", TEXT_ASSETS)
def test_gzip_fallback_when_brotli_not_accepted(client, path):
    """A gzip-only client falls back to gzip encoding."""
    resp = client.get(path, headers={"Accept-Encoding": "gzip"})
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") == "gzip"


@pytest.mark.parametrize("path", TEXT_ASSETS)
def test_identity_when_no_compression_accepted(client, path):
    """A client accepting no compression gets an uncompressed body."""
    resp = client.get(path, headers={"Accept-Encoding": "identity"})
    assert resp.status_code == 200
    assert resp.headers.get("content-encoding") is None
    assert len(resp.content) > 0


@pytest.mark.parametrize("path", TEXT_ASSETS)
def test_etag_present_and_304_revalidation(client, path):
    """Assets carry an ETag and honor If-None-Match with a 304 (no body)."""
    first = client.get(path, headers={"Accept-Encoding": "identity"})
    etag = first.headers.get("etag")
    assert etag, f"{path} should expose an ETag for revalidation"

    revalidated = client.get(
        path,
        headers={"If-None-Match": etag, "Accept-Encoding": "br"},
    )
    assert revalidated.status_code == 304
    assert revalidated.content == b""


def test_js_content_type_and_cache_control(client):
    """JS is served as application/javascript with a public cache policy."""
    resp = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"})
    assert resp.headers["content-type"].startswith("application/javascript")
    assert "public" in resp.headers.get("cache-control", "")


def _read_frontend(name: str) -> str:
    return (Path(__file__).resolve().parent.parent / "frontend" / name).read_text()


# ── Service worker templating (React build assets + build-hashed cache name) ──


@pytest.fixture
def spa_build(tmp_path, monkeypatch):
    """A fixture Vite build: index.html, hashed chunks and .vite/manifest.json."""
    import json

    import backend.api as api_module

    build = tmp_path / "dist"
    (build / "admin-assets").mkdir(parents=True)
    (build / ".vite").mkdir()
    (build / "index.html").write_text("<html><title>v1</title></html>")
    manifest = {
        "index.html": {
            "file": "admin-assets/index-aaa.js",
            "isEntry": True,
            "css": ["admin-assets/index-bbb.css"],
            "dynamicImports": ["src/pages/Lobbies.tsx"],
        },
        "src/pages/Lobbies.tsx": {"file": "admin-assets/Lobbies-ccc.js", "isDynamicEntry": True},
        "_shared.js": {"file": "admin-assets/shared-ddd.js", "assets": ["admin-assets/font-eee.woff2"]},
        "src/locales/ru.json": {"file": "admin-assets/ru-fff.js", "isDynamicEntry": True},
        "src/locales/es.json": {"file": "admin-assets/es-ggg.js", "isDynamicEntry": True},
    }
    (build / ".vite" / "manifest.json").write_text(json.dumps(manifest))
    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", build)
    return build


def _service_worker(client) -> str:
    return client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text


def test_service_worker_lists_every_react_build_file(client, spa_build):
    sw = _service_worker(client)
    for path in (
        "/admin-assets/index-aaa.js",
        "/admin-assets/index-bbb.css",
        "/admin-assets/Lobbies-ccc.js",
        "/admin-assets/shared-ddd.js",
        "/admin-assets/font-eee.woff2",
    ):
        assert f'"{path}"' in sw
    assert "/*__SPA_ASSETS__*/" not in sw


def test_service_worker_does_not_precache_the_russian_bundle(client, spa_build):
    assert "/admin-assets/ru-fff.js" not in _service_worker(client)


def test_service_worker_precaches_the_spanish_bundle(client, spa_build):
    assert '"/admin-assets/es-ggg.js"' in _service_worker(client)


def _preloaded_language_chunks(html: str) -> dict[str, str]:
    import json

    found = re.search(r"var files = (\{.*?\});", html)
    assert found, "the shell must carry the language-preload script"
    return json.loads(found.group(1))


def test_shell_preloads_the_stored_language_chunk_from_the_manifest(client, spa_build):
    import json

    (spa_build / "index.html").write_text(
        '<html><head><title>v1</title><script type="module" src="/admin-assets/index-aaa.js"></script>'
        "</head><body></body></html>"
    )
    html = client.get("/admin").text
    chunks = _preloaded_language_chunks(html)
    assert chunks == {"es": "/admin-assets/es-ggg.js", "ru": "/admin-assets/ru-fff.js"}
    manifest = json.loads((spa_build / ".vite" / "manifest.json").read_text())
    files = {f"/{entry['file']}" for entry in manifest.values()}
    assert set(chunks.values()) <= files
    # It runs before the entry module so the chunk downloads alongside it.
    assert html.index("var files =") < html.index('<script type="module"')
    # Same detection order as i18n.ts: amistoso-lang, then padel-lang, then the browser.
    assert html.index("'amistoso-lang'") < html.index("'padel-lang'") < html.index("navigator.languages")


def test_shell_without_a_manifest_has_no_language_preload(client, spa_build):
    (spa_build / ".vite" / "manifest.json").unlink()
    (spa_build / "index.html").write_text("<html><head><title>v3</title></head></html>")
    assert "var files =" not in client.get("/admin").text


def test_service_worker_cache_name_follows_the_react_build(client, spa_build):
    first = re.search(r"CACHE_NAME = '(amistoso-v\d+-[0-9a-f]{10})'", _service_worker(client))
    assert first, "cache name must carry a hash of the React index.html"
    (spa_build / "index.html").write_text("<html><title>v2 with different content</title></html>")
    second = re.search(r"CACHE_NAME = '(amistoso-v\d+-[0-9a-f]{10})'", _service_worker(client))
    assert second
    assert first.group(1) != second.group(1)
    # Same content again gives the same name (stable across restarts).
    (spa_build / "index.html").write_text("<html><title>v1</title></html>")
    third = re.search(r"CACHE_NAME = '(amistoso-v\d+-[0-9a-f]{10})'", _service_worker(client))
    assert third and third.group(1) == first.group(1)


def test_service_worker_without_a_build_is_still_valid(client, tmp_path, monkeypatch):
    import backend.api as api_module

    monkeypatch.setattr(api_module, "ADMIN_BUILD_DIR", tmp_path / "missing")
    sw = _service_worker(client)
    assert re.search(r"CACHE_NAME = 'amistoso-v\d+';", sw)
    assert "const SPA_ASSETS = [];" in sw
    assert "/*__SPA_ASSETS__*/" not in sw


def test_service_worker_keeps_etag_and_cache_headers(client, spa_build):
    first = client.get("/service-worker.js")
    assert "max-age=300" in first.headers["cache-control"]
    second = client.get("/service-worker.js", headers={"If-None-Match": first.headers["etag"]})
    assert second.status_code == 304


def test_service_worker_never_caches_api_or_credentialed_pages():
    sw = _read_frontend("service-worker.js")
    assert "url.pathname.startsWith('/api/')) return;" in sw
    for param in ("invite_token", "reset_token", "player_token"):
        assert f"'{param}'" in sw
    assert "!sensitive" in sw
    assert "const SHELL = ['/', '/events', '/player', '/admin'];" in sw
    assert "/admin-assets/" in sw


def test_manifest_has_brand_colours_and_section_shortcuts(client):
    manifest = client.get("/manifest.json").json()
    assert manifest["id"] == "/"
    assert manifest["theme_color"] == "#eff2f6"
    assert manifest["background_color"] == "#eff2f6"
    assert [s["url"] for s in manifest["shortcuts"]] == ["/events", "/player", "/admin"]
