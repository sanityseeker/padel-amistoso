"""Tests for static frontend asset serving: compression, caching, ETags.

These guard the page-load-performance behavior of the static routes
(`/*.js`, `/*.css`) — on-the-fly Brotli/gzip compression and ETag-based
304 revalidation. They are format-agnostic: they assert on response
headers and status codes, not on exact byte counts (the TestClient's
httpx transport transparently decodes compressed bodies).
"""

from __future__ import annotations

import re

import pytest

# Representative text assets served through the compression middleware +
# ETag helper. tv.js is the largest JS bundle; theme.css a large stylesheet.
TEXT_ASSETS = ["/tv.js", "/shared.js", "/player.js", "/admin.css", "/theme.css"]


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
    resp = client.get("/shared.js", headers={"Accept-Encoding": "identity"})
    assert resp.headers["content-type"].startswith("application/javascript")
    assert "public" in resp.headers.get("cache-control", "")


# ── Petite-Vue infrastructure (Phase 0) ─────────────────────────────────────
#
# These guard the reactive-island groundwork: the CDN library must be present
# on every interactive page (with its SRI hash), the shared mount helpers must
# ship in shared.js, and the service worker must cache the new dependency.

PETITE_VUE_SRC = "cdn.jsdelivr.net/npm/petite-vue@0.4.1/dist/petite-vue.iife.js"
PETITE_VUE_SRI = "sha384-G3VE2R9nao/dKH0R46Bvk6qIVBAeImWjeTj+SwWOJzJ4N0vQ2RKWuC/cp36l4Iba"

PETITE_VUE_PAGES = ["/", "/player", "/tv", "/register"]


@pytest.mark.parametrize("path", PETITE_VUE_PAGES)
def test_petite_vue_present_on_page(client, path):
    """Every interactive page loads Petite-Vue with its pinned SRI hash."""
    html = client.get(path, headers={"Accept-Encoding": "identity"}).text
    assert PETITE_VUE_SRC in html, f"{path} is missing the Petite-Vue <script>"
    assert PETITE_VUE_SRI in html, f"{path} is missing the Petite-Vue SRI hash"


def test_mount_helpers_shipped_in_shared_js(client):
    """shared.js exposes the reactive-island mount helpers."""
    js = client.get("/shared.js", headers={"Accept-Encoding": "identity"}).text
    assert "function mountIsland" in js
    assert "function reactiveStore" in js


def test_service_worker_caches_petite_vue(client):
    """The service worker caches Petite-Vue and bumped its cache version."""
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    assert PETITE_VUE_SRC in sw, "Petite-Vue not added to service-worker STATIC_ASSETS"
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version, "service worker must define CACHE_NAME = 'amistoso-vNN'"
    # v30 introduced the Petite-Vue dep; later conversions keep bumping it.
    assert int(version.group(1)) >= 30, "CACHE_NAME must be bumped so the new dep is cached"


# ── Phase 1 pilot: login + change-password dialogs converted to islands ──────
#
# The dialogs live in static index.html markup and mount as Petite-Vue islands
# in auth.js. Verify the reactive bindings are present in the served markup and
# that auth.js wires the mounts (browser behavior is covered manually).


def test_login_dialog_has_reactive_bindings(client):
    """The login dialog is a v-scope island with v-model / @submit bindings."""
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
    dialog = html[html.index('id="auth-dialog"') :]
    dialog = dialog[: dialog.index("</form>")]
    assert "v-scope" in dialog
    assert 'v-model="username"' in dialog
    assert 'v-model="password"' in dialog
    assert "@submit.prevent" in dialog
    assert '@keyup.enter="submit()"' in dialog
    assert 'v-text="error"' in dialog
    assert ':disabled="submitting"' in dialog


def test_change_pwd_dialog_has_reactive_bindings(client):
    """The change-password dialog is a v-scope island with v-model bindings."""
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
    block = html[html.index('id="change-pwd-overlay"') :]
    block = block[: block.index("</form>")]
    assert "v-scope" in block
    assert 'v-model="newPwd"' in block
    assert 'v-model="confirmPwd"' in block
    assert "@submit.prevent" in block
    assert 'v-text="error"' in block
    assert 'v-text="success"' in block
    assert 'v-text="targetLabel"' in block


def test_auth_js_mounts_dialog_islands(client):
    """auth.js builds the stores and mounts both dialog islands."""
    js = client.get("/auth.js", headers={"Accept-Encoding": "identity"}).text
    assert "reactiveStore(" in js
    assert "mountIsland('#auth-dialog'" in js
    assert "mountIsland('#change-pwd-overlay .modal-dialog'" in js
    # The legacy keypress listener was replaced by @keyup.enter in the template.
    assert "addEventListener('keypress'" not in js


def test_mount_island_preserves_store_identity(client):
    """mountIsland must mount the caller's reactive store itself, not a copy.

    Petite-Vue's createApp() reuses an already-reactive scope as-is; copying
    the store into a new object (e.g. via Object.assign) silently disconnects
    external store mutations from the mounted DOM.
    """
    js = client.get("/shared.js", headers={"Accept-Encoding": "identity"}).text
    assert "PetiteVue.createApp(resolved)" in js
    assert "Object.assign(_islandGlobals()" not in js


# ── Phase 2: home tournament list + filter toolbar as a reactive island ─────
#
# The toolbar and card list in index.html are bound to `_homeStore` in
# admin-tournaments.js; card markup lives in <template> defs instantiated via
# v-scope. These guard the served-markup contract (runtime reactivity is
# covered manually).


def test_home_island_has_reactive_bindings(client):
    """The home panel is a v-scope island: v-model search, v-for filters/cards."""
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
    block = html[html.index('id="home-island"') :]
    block = block[: block.index('id="panel-create"')]
    assert 'v-model="searchDraft"' in block
    assert '@click="submitSearch()"' in block
    assert 'v-for="dim in visibleDims"' in block
    assert '@click="setFilter(dim, value)"' in block
    assert 'v-for="entry in mainCards"' in block
    assert 'v-scope="cardTemplate(entry)"' in block
    assert 'id="tpl-home-tourn-card"' in block
    assert 'id="tpl-home-lobby-card"' in block


def test_admin_tournaments_js_mounts_home_island(client):
    """admin-tournaments.js builds the home store and mounts the island."""
    js = client.get("/admin-tournaments.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _homeStore = reactiveStore(" in js
    assert "mountIsland('#home-island', _homeStore)" in js
    # The legacy string-building renderers must be gone.
    assert "_renderHomeTournamentToolbar" not in js
    assert 'onclick="_setHomeFilter' not in js


def test_tv_picker_item_template_shipped(client):
    """public.html (TV view) ships the picker island's per-item card template."""
    html = client.get("/tv", headers={"Accept-Encoding": "identity"}).text
    assert 'id="tpl-tv-picker-item"' in html
    assert 'class="tv-picker-item"' in html
    assert "{{ it.name }}" in html


def test_tv_js_mounts_picker_island(client):
    """tv.js builds the picker store, binds the island shell, mounts it, and no
    longer rebuilds the picker as an HTML string with inline handlers."""
    js = client.get("/tv.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _pickerStore = reactiveStore(" in js
    assert "mountIsland('#tv-picker-island', _pickerStore)" in js
    # Reactive bindings replace the old inline onclick / string list.
    assert '@click="toggleArchive()"' in js
    assert 'v-for="tv in activeTournaments"' in js
    assert "v-scope=\"{ $template: '#tpl-tv-picker-item'" in js
    # Legacy string-builder and its inline handler must be gone.
    assert "function _renderPickerItem" not in js
    assert 'onclick="togglePickerArchive()"' not in js


def test_communities_panel_has_reactive_bindings(client):
    """The communities tab is a v-scope island: v-model inputs, v-for rows."""
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
    block = html[html.index('id="panel-communities"') :]
    block = block[: block.index('id="panel-clubs"')]
    assert "v-scope" in block
    assert 'v-model="newName"' in block
    assert 'v-model="defaultSelection"' in block
    assert '@click="create()"' in block
    assert 'v-for="c in specialized"' in block
    assert 'v-for="tour in sortedTournaments"' in block
    assert 'v-for="r in sortedRegistrations"' in block
    assert '@change="assignTournament(tour.id, $event.target.value)"' in block


def test_admin_communities_js_mounts_island(client):
    """admin-communities.js builds the store, mounts the island, and no longer
    string-builds the panel via the old _commRenderX renderers."""
    js = client.get("/admin-communities.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _commStore = reactiveStore(" in js
    assert "mountIsland('#panel-communities', _commStore)" in js
    # Legacy string-building renderers must be gone.
    assert "function _commRenderList" not in js
    assert "function _commRenderTournaments" not in js
    assert 'onclick="commDelete' not in js


def test_players_hub_search_has_reactive_bindings(client):
    """The Players Hub search/results/merge bar is a v-scope island."""
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
    block = html[html.index('id="panel-players-hub"') :]
    block = block[: block.index('id="ph-detail"')]
    assert 'id="ph-search-island" v-scope' in block
    assert 'v-model="query"' in block
    assert '@click="search()"' in block
    assert 'v-for="p in visibleProfiles"' in block
    assert '@change="toggleGhost(p.id, $event.target.checked)"' in block
    assert '@change="toggleHub(p.id, $event.target.checked)"' in block
    assert '@click="consolidate(' in block


def test_admin_players_js_mounts_search_island(client):
    """admin-players.js builds the search store, mounts the island, and no longer
    string-builds the results list / merge bar via the old renderers."""
    js = client.get("/admin-players.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _phStore = reactiveStore(" in js
    assert "mountIsland('#ph-search-island', _phStore)" in js
    # Legacy list/merge-bar string builders must be gone.
    assert "function _phRenderProfileList" not in js
    assert "function _phUpdateMergeBar" not in js
    assert 'onchange="_phToggleGhostSelect' not in js
