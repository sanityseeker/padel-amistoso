"""Tests for static frontend asset serving: compression, caching, ETags.

These guard the page-load-performance behavior of the static routes
(`/*.js`, `/*.css`) — on-the-fly Brotli/gzip compression and ETag-based
304 revalidation. They are format-agnostic: they assert on response
headers and status codes, not on exact byte counts (the TestClient's
httpx transport transparently decodes compressed bodies).
"""

from __future__ import annotations

import re
from pathlib import Path

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

PETITE_VUE_PAGES = ["/legacy-admin", "/legacy-player", "/legacy-events", "/tv/some-alias", "/register/some-alias"]


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
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    dialog = html[html.index('id="auth-dialog"') :]
    dialog = dialog[: dialog.index("</form>")]
    assert "v-scope" in dialog
    assert 'v-model="username"' in dialog
    assert 'v-model="password"' in dialog
    assert "@submit.prevent" in dialog
    assert '@keyup.enter="submit()"' in dialog
    assert 'v-text="error"' in dialog
    assert ':disabled="submitting"' in dialog
    # Demo states: core link-out, demo start view, credentials disclosure.
    assert ':href="demoHref()"' in dialog
    assert 'rel="nofollow"' in dialog
    assert "demoView() === 'start'" in dialog
    assert "demoView() === 'minting'" in dialog
    assert "demoView() === 'returning'" in dialog
    assert 'id="auth-demo-start-btn"' in dialog
    assert '@click="startDemo()"' in dialog
    assert 'v-show="!showCredsForm"' in dialog
    assert 'aria-live="polite"' in dialog
    # The form is toggled with v-show (not v-if) so password managers still
    # find the inputs, and #auth-username always stays in the DOM.
    assert 'v-show="credsFormVisible()"' in dialog
    assert 'id="auth-username"' in dialog
    assert "{{ dialogTitle() }}" in dialog


def test_login_dialog_returning_view_offers_new_sandbox(client):
    """The returning-user view (after the form) can still mint a new sandbox."""
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    dialog = html[html.index('id="auth-dialog"') :]
    dialog = dialog[: dialog.index("<!-- Change Password Modal")]
    after_form = dialog[dialog.index("</form>") :]
    assert "demoView() === 'returning'" in after_form
    assert '@click="startDemo()"' in after_form
    assert "txt_demo_start_new_instead" in after_form


def test_auth_js_never_auto_mints_demo(client):
    """Demo sandboxes are only minted by an explicit click, never from a URL hash."""
    js = client.get("/auth.js", headers={"Accept-Encoding": "identity"}).text
    assert "maybeAutoStartDemo" not in js
    assert "start-demo" not in js
    # Only the username is remembered, and clearAuth() must not drop it.
    assert "'padel-demo-last'" in js
    clear_auth = js[js.index("function clearAuth()") :]
    clear_auth = clear_auth[: clear_auth.index("\n}\n")]
    assert "DEMO_LAST_KEY" not in clear_auth
    utils = client.get("/admin-utils.js", headers={"Accept-Encoding": "identity"}).text
    assert "maybeAutoStartDemo" not in utils
    assert "configLoaded = true" in utils


def test_change_pwd_dialog_has_reactive_bindings(client):
    """The change-password dialog is a v-scope island with v-model bindings."""
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
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
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
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
    """public.html (Events page + TV view) ships the directory card template —
    the same club-card markup the club page renders."""
    html = client.get("/legacy-events", headers={"Accept-Encoding": "identity"}).text
    assert 'id="tpl-tv-picker-item"' in html
    assert 'class="club-item-card"' in html
    assert "{{ it.name }}" in html
    assert 'v-for="b in it.badges"' in html
    assert 'class="club-item-origin"' in html
    # Shared card styles come from club.css on both pages.
    assert '<link rel="stylesheet" href="/club.css">' in html


def test_tv_js_mounts_picker_island(client):
    """tv.js builds the Events store, binds the island shell (header, chips,
    sport pills, groups, find box) and mounts it."""
    js = client.get("/tv.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _pickerStore = reactiveStore(" in js
    assert "mountIsland('#tv-picker-island', _pickerStore)" in js
    assert "api('/api/public-events')" in js
    assert '<div v-html="headerHtml"></div>' in js
    assert "buildPublicHeaderHtml('events')" in js
    assert "@click=\"setTab('live')\"" in js
    assert "@click=\"toggleSport('padel')\"" in js
    assert 'v-for="g in groups"' in js
    assert "v-scope=\"{ $template: '#tpl-tv-picker-item'" in js
    assert 'v-model="findValue"' in js
    # v-for + external $template must sit inside <div>, never <template v-else>.
    assert "<template v-else" not in js
    # The old picker (archive toggle, subdomain banner, page selector) is gone.
    assert "toggleArchive" not in js
    assert "buildPageSelectorHtml" not in js
    assert "player-subdomain-banner" not in js
    assert "localStorage.setItem('amistoso-last-page', 'events')" in js


# ── Shared public header ─────────────────────────────────────────────────────


def test_shared_public_header_shipped(client):
    """shared.js ships the public header (page dropdown, Admin entry only with an
    organizer session) plus the language/theme button + sheet; the home-page pin is gone."""
    js = client.get("/shared.js", headers={"Accept-Encoding": "identity"}).text
    assert "function buildPublicHeaderHtml(current)" in js
    assert "function togglePublicPageMenu(open)" in js
    assert 'aria-haspopup="true" aria-expanded="false" aria-controls="public-page-menu"' in js
    pages = js[js.index("function _publicHeaderPages(current)") :]
    pages = pages[: pages.index("\n}\n")]
    assert "if (current === 'admin' || hasAdminSession()) {\n    pages.push({ key: 'admin'" in pages
    assert "function buildDisplayButtonHtml()" in js
    assert 'class="public-display-btn" aria-haspopup="dialog" aria-expanded="${open ? ' in js
    assert "mountDisplayFooter" not in js
    assert "public-footer" not in js
    assert "function openDisplaySheet(" in js
    assert "function setDisplayTheme(mode)" in js
    assert "localStorage.removeItem(THEME_KEY)" in js  # Auto theme clears the saved key
    assert 'role="radiogroup"' in js
    assert 'aria-current="page"' in js
    assert "function hubProfileInitials()" in js
    for gone in (
        "buildPageSelectorHtml",
        "toggleHomePage",
        "getHomePage",
        "setHomePage",
        "clearHomePage",
        "amistoso-home-page",
    ):
        assert gone not in js, gone


def test_admin_sign_in_is_a_header_link(client):
    """Visitors see only Club/Events + Player Hub in the header dropdown; the
    admin sign-in is a low-emphasis key + "Admin" link at the right end of
    the header row, hidden once an organizer session exists on the origin (the
    dropdown then shows the Admin entry instead). The language/theme button sits
    at the opposite (left) end of the same row."""
    js = client.get("/shared.js", headers={"Accept-Encoding": "identity"}).text
    assert "function hasAdminSession()" in js
    assert "localStorage.getItem('padel-auth-token')" in js
    gate = js[js.index("function _showHeaderAdminSignIn()") :]
    gate = gate[: gate.index("\n}\n")]
    assert "getClubSubdomain()" not in gate
    assert "_publicHeaderCurrent !== 'admin'" in gate
    assert "!hasAdminSession()" in gate
    header = js[js.index("function buildPublicHeaderHtml(current)") :]
    header = header[: header.index("\n}\n")]
    assert "if (_showHeaderAdminSignIn())" in header
    assert 'class="public-admin-link" href="/admin"' in header
    assert "_ic('key')" in header
    assert "t('txt_nav_admin')" in header
    assert "t('txt_nav_admin_sign_in')" in header
    assert header.index("public-admin-link") < header.index("</header>")
    assert header.index("html += buildDisplayButtonHtml();") < header.index('<nav class="public-page-selector"')
    button = js[js.index("function buildDisplayButtonHtml()") :]
    button = button[: button.index("\n}\n")]
    assert "public-admin-link" not in button
    assert "aria-label=" in button
    css = client.get("/theme.css", headers={"Accept-Encoding": "identity"}).text
    assert ".public-admin-link {" in css
    display_rule = css[css.index(".public-display-btn {") :]
    display_rule = display_rule[: display_rule.index("}")]
    assert "position: absolute;" in display_rule and "left: 0;" in display_rule


def test_buttons_and_fields_share_one_base_in_theme(client):
    """.btn and its shared variants plus the field base live in theme.css; page
    sheets keep only page-specific overrides."""
    css = client.get("/theme.css", headers={"Accept-Encoding": "identity"}).text
    for rule in (
        ".btn {",
        ".btn-primary {",
        ".btn-secondary {",
        ".btn-sm {",
        ".btn-outline {",
        ".btn-danger {",
        ".btn-danger-outline {",
        'input:where(:not([type="radio"], [type="checkbox"])), select, textarea {',
    ):
        assert rule in css, rule
    for path in ("/player.css", "/register.css", "/club.css"):
        page = client.get(path, headers={"Accept-Encoding": "identity"}).text
        assert "\n.btn {" not in page, path
        assert "\n.btn-secondary {" not in page, path
    for path in ("/admin.css", "/tv.css"):
        page = client.get(path, headers={"Accept-Encoding": "identity"}).text
        assert "body {\n  font-family: var(--font-body);" in page, path


@pytest.mark.parametrize("page", ["index.html", "player.html", "register.html", "club.html", "public.html", "404.html"])
def test_fontshare_loads_one_family_per_request(page):
    """The Fontshare API returns only the first family of a combined f[] query,
    which silently dropped Cabinet Grotesk (--font-body) on every page."""
    html = Path("frontend", page).read_text(encoding="utf-8")
    assert "f[]=clash-display@400,500,600,700&display=swap" in html
    assert "f[]=cabinet-grotesk@400,500,700,800&display=swap" in html
    assert "&f[]=" not in html


def test_public_pages_share_one_content_width(client):
    for path, rule in (
        ("/player.css", ".container { max-width: var(--content-public);"),
        ("/register.css", ".container { max-width: var(--content-public);"),
        ("/club.css", "max-width: var(--content-public);"),
    ):
        css = client.get(path, headers={"Accept-Encoding": "identity"}).text
        assert rule in css, path


@pytest.mark.parametrize("path", ["/player.js", "/register.js", "/club.js"])
def test_public_pages_use_shared_header(client, path):
    js = client.get(path, headers={"Accept-Encoding": "identity"}).text
    assert "buildPublicHeaderHtml(" in js
    assert "buildPageSelectorHtml" not in js


def test_tv_live_board_has_display_button_without_tab_bar(client):
    js = client.get("/tv.js", headers={"Accept-Encoding": "identity"}).text
    header = js[js.index("function _buildHeader(name, phase, champion)") :]
    header = header[: header.index("\n}\n")]
    assert "${buildDisplayButtonHtml()}" in header
    assert "mountDisplayFooter" not in js
    assert "_toggleLanguage" not in js
    assert "_toggleTheme" not in js
    assert "buildPublicHeaderHtml" not in header


def test_admin_uses_header_display_button_instead_of_toggles(client):
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    assert 'id="lang-toggle-btn"' not in html
    assert 'id="theme-toggle-btn"' not in html
    js = client.get("/admin-utils.js", headers={"Accept-Encoding": "identity"}).text
    assert "mountDisplayFooter" not in js
    assert "buildPublicHeaderHtml('admin')" in js  # the header carries the button
    assert "document.addEventListener('app-language-changed'" in js
    css = client.get("/theme.css", headers={"Accept-Encoding": "identity"}).text
    assert ".public-footer" not in css
    assert ".public-page-btn {" in css
    tv_css = client.get("/tv.css", headers={"Accept-Encoding": "identity"}).text
    assert ".public-page-btn {" not in tv_css
    assert ".display-sheet {" in css


@pytest.mark.parametrize("page", ["index.html", "player.html", "register.html", "public.html", "club.html"])
def test_every_page_has_support_links_footer(page):
    html = (Path(__file__).parent.parent / "frontend" / page).read_text(encoding="utf-8")
    assert '<div class="support-links' in html
    assert "https://ko-fi.com/torneosamistosos" in html
    assert "https://github.com/sanityseeker/padel-amistoso" in html


def test_admin_header_has_single_events_link_and_no_pin(client):
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    assert 'id="admin-public-header"' in html
    assert "page-selector" not in html
    assert "page-selector" not in client.get("/admin.css", headers={"Accept-Encoding": "identity"}).text
    js = client.get("/admin-utils.js", headers={"Accept-Encoding": "identity"}).text
    assert "buildPublicHeaderHtml('admin')" in js
    assert 'data-page="tv"' not in html
    assert 'data-page="register"' not in html
    assert "toggleHomePin" not in html
    assert "amistoso-home-page" not in html
    # Root redirect: anonymous visitors go to /player or /events, organizers stay.
    assert "localStorage.getItem('padel-auth-token')" in html
    assert "last === 'player' && !demo ? '/player' : '/events'" in html


def test_club_page_has_header_slot_logo_above_name_and_no_login_section(client):
    html = client.get("/", headers={"host": "myclub.example.com", "Accept-Encoding": "identity"})
    # Unknown slug → 404 page; the club.html asset itself is read from disk.
    assert html.status_code == 404
    club_html = Path("frontend/club.html").read_text(encoding="utf-8")
    assert 'id="club-public-header"' in club_html
    assert "club-login" not in club_html
    assert club_html.index('id="club-logo"') < club_html.index('id="club-name"')
    assert 'data-i18n="txt_club_items_title">Events<' in club_html
    club_js = client.get("/club.js", headers={"Accept-Encoding": "identity"}).text
    assert "_clubRenderLeaderboardLoginPrompt" not in club_js
    assert "publicEventGroups(" in club_js
    css = client.get("/club.css", headers={"Accept-Encoding": "identity"}).text
    assert "club-leaderboard-locked" not in css
    assert "club-login-section" not in css


def test_player_hub_locks_scope_on_club_subdomain(client):
    js = client.get("/player.js", headers={"Accept-Encoding": "identity"}).text
    for gone in ("_buildSubdomainBanner", "_clearSubdomainScope", "player-subdomain-override"):
        assert gone not in js, gone
    assert "if (_subdomainClub) return '';" in js  # scope selector hidden
    assert "txt_player_club_no_matches" in js


def test_register_directory_removed(client):
    js = client.get("/register.js", headers={"Accept-Encoding": "identity"}).text
    for gone in ("_showDirectory", "_renderDirectory", "_goToLobby", "state-directory"):
        assert gone not in js, gone
    assert "location.replace('/events')" in js


def test_public_header_i18n_keys_in_both_languages(client):
    js = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    keys = [
        "txt_display_label",
        "txt_display_btn_aria",
        "txt_display_theme",
        "txt_display_theme_light",
        "txt_display_theme_dark",
        "txt_display_theme_auto",
        "txt_nav_pages",
        "txt_nav_events",
        "txt_nav_club",
        "txt_nav_sign_in",
        "txt_nav_my_hub",
        "txt_nav_admin_sign_in",
        "txt_club_group_tournaments",
        "txt_club_group_signups",
        "txt_club_status_not_started",
        "txt_club_signed_up_one",
        "txt_club_signed_up_many",
        "txt_player_club_no_matches",
        "txt_events_title",
        "txt_events_find_label",
        "txt_events_find_placeholder",
        "txt_events_not_found",
        "txt_events_empty_live",
        "txt_events_empty_finished",
    ]
    for key in keys:
        assert js.count(f'"{key}"') == 2, key
    for gone in (
        "txt_nav_set_home",
        "txt_nav_tv_view",
        "txt_nav_registrations",
        "txt_club_login_admin",
        "txt_club_leaderboard_login_required",
        "txt_player_subdomain_banner",
        "txt_picker_subdomain_banner",
    ):
        assert f'"{gone}"' not in js, gone


def test_service_worker_caches_events_shell_and_bumped(client):
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    assert "'/events'" in sw
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version and int(version.group(1)) >= 69


# ── Club admin Events card ───────────────────────────────────────────────────


def test_club_events_row_template_shipped(client):
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    block = html[html.index('<template id="tpl-club-event-row">') :]
    block = block[: block.index("</template>")]
    assert "{{ row.name }}" in block
    assert '@click="mainAction(row).run()"' in block
    assert '@click="togglePin(row)"' in block
    assert '@change="setSeason(row, $event.target.value)"' in block
    assert '@click="movePin(row, -1)"' in block
    assert '@click="removeFromClub(row)"' in block
    assert "v-html=\"_ic('star')\"" in block  # SVG pin icon, not an emoji
    assert 'id="view-club-return"' in html


def test_admin_clubs_js_mounts_events_island(client):
    js = client.get("/admin-clubs.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _clubEventsStore = reactiveStore(" in js
    assert "mountIsland('#club-events-island', _clubEventsStore)" in js
    assert "deriveEventRows(_clubsTournaments, _clubsRegistrations, {" in js
    assert "apiAuth('/api/registrations?include_archived=1')" in js
    assert "v-scope=\"{ $template: '#tpl-club-event-row', row }\"" in js
    assert "<template v-else" not in js
    # Card order: Events slot before Players; Players collapsed by default.
    assert js.index('id="club-events-slot"') < js.index('id="clubs-players-card"')
    assert '<details class="card" open id="clubs-players-card">' not in js
    assert '<details class="card" id="clubs-players-card">' in js
    # Removed legacy blocks.
    for gone in (
        "_clubsRenderSeasonAssignment",
        "_clubsRenderLandingPinnedList",
        "clubsSavePinnedTournaments",
        "clubsToggleTournamentClub",
        "clubsAssignTournamentSeason",
    ):
        assert gone not in js, gone
    assert "uiConfirm(" in js
    utils = client.get("/admin-utils.js", headers={"Accept-Encoding": "identity"}).text
    assert "function deriveEventRows(tournaments, registrations, opts = {})" in utils


def test_club_events_attach_panel_is_collapsible_with_dismiss(client):
    """Attach suggestions: collapsible summary, Dismiss / Restore / Show dismissed,
    candidate filtering in a pure helper."""
    js = client.get("/admin-clubs.js", headers={"Accept-Encoding": "identity"}).text
    assert 'class="player-codes-summary club-events-attach-summary"' in js
    assert "txt_club_events_attach_suggestions', { n: attachSection.length }" in js
    assert '@click="dismiss(item)"' in js
    assert '@click="restore(item)"' in js
    assert '@click="toggleShowDismissed()"' in js
    assert 'id="club-events-attach-search"' in js
    assert "sessionStorage.setItem(`${_CLUB_EVENTS_ATTACH_OPEN_KEY}:${this.clubId}`" in js
    assert "'amistoso-club-attach-dismissed'" in js
    assert "deriveAttachCandidates(_clubsTournaments, _clubsRegistrations, {" in js
    utils = client.get("/admin-utils.js", headers={"Accept-Encoding": "identity"}).text
    assert "function deriveAttachCandidates(tournaments, registrations, opts = {})" in utils
    assert "if (!t || t.club_id || !inClubCommunity(t)) continue;" in utils
    i18n = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    for key in (
        "txt_club_events_attach_suggestions",
        "txt_club_events_attach_dismiss",
        "txt_club_events_attach_restore",
        "txt_club_events_attach_show_dismissed",
        "txt_club_events_attach_hide_dismissed",
    ):
        assert i18n.count(f'"{key}"') == 2, key


def test_club_past_participants_can_merge_into_existing_player(client):
    """Each past-participant row offers "Merge into player" (fold the ghost into an
    existing Hub profile) alongside "Convert to Hub"."""
    js = client.get("/admin-clubs.js", headers={"Accept-Encoding": "identity"}).text
    assert "onclick=\"clubsShowMergeGhostForm('${escAttr(p.profile_id)}', '${escAttr(p.name)}')\"" in js
    assert "body: JSON.stringify({ source_ids: [targetId, ghostId], name: null })," in js
    assert "/players/candidates?q=${encodeURIComponent(q)}" in js
    i18n = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    for key in (
        "txt_clubs_merge_ghost",
        "txt_clubs_merge_ghost_hint",
        "txt_clubs_merge_ghost_title",
        "txt_clubs_merge_ghost_help",
        "txt_clubs_merge_ghost_search_placeholder",
        "txt_clubs_merge_ghost_pick_target",
    ):
        assert i18n.count(f'"{key}"') == 2, key


def test_club_settings_assignments_subtab_removed(client):
    js = client.get("/admin-clubs-settings-panel.js", headers={"Accept-Encoding": "identity"}).text
    assert "'assignments'" not in js
    assert "_renderClubAssignmentsBody" not in js
    assert "clubs-landing-pinned-list" not in js
    assert "txt_clubs_landing_pinned_moved" in js
    create = client.get("/admin-create.js", headers={"Accept-Encoding": "identity"}).text
    assert "function _applyCreateClubPreset(clubId, opts = {})" in create


def test_club_events_i18n_keys_in_both_languages(client):
    js = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    keys = [
        "txt_club_events_title",
        "txt_club_events_new",
        "txt_club_events_attach",
        "txt_club_events_pinned_group",
        "txt_club_events_state_live",
        "txt_club_events_state_ready",
        "txt_club_events_state_open",
        "txt_club_events_from_lobby",
        "txt_club_events_action_run",
        "txt_club_events_action_manage",
        "txt_club_events_action_convert",
        "txt_club_events_action_results",
        "txt_club_events_view",
        "txt_club_events_more",
        "txt_club_events_public_view",
        "txt_club_events_copy_link",
        "txt_club_events_move_up",
        "txt_club_events_move_down",
        "txt_club_events_pin",
        "txt_club_events_unpin",
        "txt_club_events_create_season",
        "txt_club_events_remove_confirm",
        "txt_club_events_empty_active",
        "txt_club_events_empty_finished",
        "txt_club_events_empty_archived",
        "txt_club_events_empty_readonly",
        "txt_club_events_back_to_club",
        "txt_clubs_landing_pinned_moved",
        "txt_club_events_tab_archived",
        "txt_club_events_state_closed",
    ]
    for key in keys:
        assert js.count(f'"{key}"') == 2, key
    assert '"txt_club_settings_tab_assignments"' not in js


def test_communities_panel_has_reactive_bindings(client):
    """The communities tab is a v-scope island: v-model inputs, v-for rows."""
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    block = html[html.index('id="panel-communities"') :]
    block = block[: block.index('id="panel-clubs"')]
    assert "v-scope" in block
    assert 'v-model="newName"' in block
    assert 'v-model="defaultSelection"' in block
    assert '@click="create()"' in block
    assert 'v-for="c in specialized"' in block
    assert 'v-for="tour in sortedTournaments"' in block
    assert 'v-for="r in sortedRegistrations"' in block
    assert '@change="assignTournament(tour.id, $event.target.value, $event.target)"' in block


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
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
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


def test_form_control_baseline_guards(client):
    """Radios/checkboxes must not inherit the admin text-input box styling, and the
    shared theme keeps its form baseline (font inheritance + .choice-row)."""
    admin = client.get("/admin.css", headers={"Accept-Encoding": "identity"}).text
    scoped = 'input:where(:not([type="radio"], [type="checkbox"])), select, textarea {'
    assert scoped in admin
    assert "\ninput, select, textarea {" not in admin
    assert "\n  input, select, textarea {" not in admin
    theme = client.get("/theme.css", headers={"Accept-Encoding": "identity"}).text
    assert ".choice-row" in theme
    assert ".choice-group" in theme
    assert "font-family: inherit" in theme


def test_flash_success_is_pulse_only(client):
    """flashSuccess pulses the control (no label swap) and the CSS never animates the background."""
    js = client.get("/shared.js", headers={"Accept-Encoding": "identity"}).text
    assert "function flashSuccess(target, announce)" in js
    assert "tempLabel" not in js
    assert "copyTournamentUrl" not in js
    css = client.get("/theme.css", headers={"Accept-Encoding": "identity"}).text
    block = css[css.index("@keyframes flash-success-ring") : css.index(".sr-only")]
    assert "background" not in block
    assert ".sr-only" in css


def test_register_success_view_is_island(client):
    """The registration success card is a v-scope island: v-model draft answers,
    v-if edit panel / withdraw strip, v-for player chips, mounted once."""
    html = client.get("/register/some-alias", headers={"Accept-Encoding": "identity"}).text
    block = html[html.index('<template id="tpl-success">') :]
    block = block[: block.index("</template>\n<div")]
    # Ids that handlers/tests rely on survive the conversion.
    for dom_id in ("reg-edit-btn", "reg-withdraw-btn", "reg-passphrase-box", "reg-copy-btn", "reg-edit-panel"):
        assert f'id="{dom_id}"' in block
    assert 'id="reg-ps-host" v-pre' in block  # Player Hub sections stay legacy
    # Answers are bound to the store-held draft, never read back from the DOM.
    assert block.count('v-model="draft[q.key]"') == 4  # select, checkbox, number, textarea
    assert 'v-if="hasQuestions() && editOpen"' in block
    assert 'v-if="confirmingWithdraw"' in block
    assert '@click="toggleEdit()"' in block
    assert '@click="askWithdraw()"' in block
    assert '@click="withdraw()"' in block
    assert '@click="save()"' in block
    assert 'v-for="p in lobby.registrants"' in block
    assert ':open="playersOpen"' in block
    assert "onclick=" not in block

    js = client.get("/register.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _successStore = reactiveStore(" in js
    assert "mountIsland('#state-success', _successStore)" in js
    assert 'id="state-success" class="card success-card reg-hidden" v-scope' in js
    # Legacy string-built entry actions are gone.
    for gone in (
        "function _renderEntryActions",
        "function _syncEntryActions",
        "_succEditOpen",
        "_saveReturningAnswers",
    ):
        assert gone not in js
    # Lobby polls patch the store instead of re-rendering the card.
    poll = js[js.index("async function _pollLobby") : js.index("function _showRedirectToast")]
    assert "_successStore.setLobby(" in poll
    assert "_showSuccess()" not in poll


def test_register_success_draft_is_preserved(client):
    """Typed answers live in the store (seeded once, reset only on save/withdraw)."""
    js = client.get("/register.js", headers={"Accept-Encoding": "identity"}).text
    assert "sessionStorage.setItem(_draftStorageKey(" in js
    assert "if (S.draftFor !== result.player_id) S.seedDraft(true);" in js
    # Failed saves keep the draft: only the success path re-seeds it.
    save = js[js.index("async save()") : js.index("async withdraw()")]
    assert save.count("S.seedDraft(false)") == 1
    assert save.index("if (!res.ok)") < save.index("S.seedDraft(false)")


def test_admin_registration_js_ships_notes_and_multichoice_filter(client):
    """The lobby detail script contains the notepad autosave and multi-select choice filter."""
    resp = client.get("/admin-registration.js", headers={"Accept-Encoding": "identity"})
    assert resp.status_code == 200
    assert "_regNotesFlush" in resp.text
    assert "data-choices" in resp.text


def test_match_row_emits_single_format_button(client):
    """Each score form has one format button; Points/Sets lives in its popover."""
    js = client.get("/admin-gp.js", headers={"Accept-Encoding": "identity"}).text
    assert "match-format-btn" in js
    assert "_openMatchFormatPopover(" in js
    assert "function _renderScoreInputs(" in js
    assert "function _renderDisputePanel(" in js
    assert "function _renderCommentBanner(" in js
    assert "function _isSetCtx(" in js
    assert "_renderMatchModeToggle(" not in js
    assert "match-format-mode" in js
    assert "data-mode-key" in js
    dispute = js[js.index("function _renderDisputePanel(") : js.index("function _renderBreakdown(")]
    assert "modeKey: `dr-${m.id}`" in dispute
    # Edit and dispute forms follow the stored format, not only the stage default.
    edit = js[js.index("function _renderEditForm(") : js.index("function _renderDisputePanel(")]
    assert "m.sets && m.sets.length > 0 ? 'sets' : 'points'" in edit
    # Keyboard flow and non-blocking errors on the score paths.
    assert "function _scoreKeydown(event)" in js
    submit = js[js.index("async function submitScore(") : js.index("// ─── GP Playoff Configuration")]
    assert "alert(" not in submit
    assert "_showToast(e.message, 'error')" in submit


def test_match_format_popover_is_island(client):
    """index.html carries the popover island outside #view-content, bound to _mfStore."""
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    assert 'id="match-format-popover" class="match-format-popover" v-scope' in html
    popover = html[html.index('id="match-format-popover"') :]
    popover = popover[: popover.index("</div>\n\n\n<script")]
    assert 'v-model="draft.points_target"' in popover
    assert '@click="apply()"' in popover
    assert '@click="reset()"' in popover
    assert '@keydown="onKeydown($event)"' in popover
    # Outside the view container that re-renders on every update.
    view = html[html.index('<div id="view-content">') : html.index('<div id="view-content">') + 40]
    assert "match-format-popover" not in view
    assert html.index('id="match-format-popover"') > html.index('id="view-content"')


def test_admin_gp_js_mounts_format_popover(client):
    js = client.get("/admin-gp.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _mfStore = reactiveStore(" in js
    assert "mountIsland('#match-format-popover', _mfStore)" in js


def test_tv_js_reads_format_override(client):
    js = client.get("/tv.js", headers={"Accept-Encoding": "identity"}).text
    assert "format_override" in js
    assert "effective_points_target" in js
    assert "txt_match_format_played_to" in js


def test_match_format_i18n_keys_in_both_languages(client):
    js = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    keys = [
        "txt_match_format_btn_label",
        "txt_match_format_default_value",
        "txt_match_format_overridden",
        "txt_match_format_reset",
        "txt_match_format_points_target",
        "txt_match_format_scaled_note",
        "txt_match_format_completed_needs_score",
        "txt_match_format_disputed",
        "txt_match_format_played_to",
        "txt_match_format_apply",
    ]
    for key in keys:
        assert js.count(f'"{key}"') == 2, key


def test_cache_name_bumped_for_match_format_override(client):
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version and int(version.group(1)) >= 56


# ── Match tie-break decider (phase 2) ────────────────────────────────────────


def test_shared_js_has_single_set_score_formatter(client):
    """One shared formatter brackets a match tie-break; pages reuse it instead of mapping sets."""
    shared = client.get("/shared.js", headers={"Accept-Encoding": "identity"}).text
    assert "function formatSetScore(sets, decider, sep" in shared
    assert "function isMatchTiebreakSet(sets, index, decider)" in shared
    # The mini-card match-history helper formats through the shared formatter too.
    helper = shared[shared.index("function eloScoreSepHtml(m)") :]
    assert "formatSetScore(m.sets, m.decider" in helper[: helper.index("\n}\n")]
    for path in ("/admin-gp.js", "/tv.js", "/player.js", "/club.js", "/admin-export.js"):
        js = client.get(path, headers={"Accept-Encoding": "identity"}).text
        assert "formatSetScore(" in js or "eloScoreSepHtml(" in js, path
        assert "sets.map(s => `${s[0]}-${s[1]}`)" not in js, path


def test_format_popover_has_decider_bindings(client):
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    popover = html[html.index('id="match-format-popover"') :]
    popover = popover[: popover.index("</div>\n\n\n<script")]
    assert "@click=\"setDecider('full_set')\"" in popover
    assert "@click=\"setDecider('match_tiebreak')\"" in popover
    assert 'v-if="needsSets"' in popover
    assert "setSetScore(i, 0, $event.target.value)" in popover
    assert "txt_match_format_decider_label" in popover


def test_admin_gp_js_resolves_decider(client):
    js = client.get("/admin-gp.js", headers={"Accept-Encoding": "identity"}).text
    assert "function _matchDecider(m)" in js
    assert "m.effective_decider" in js
    assert "tvSettings.set_decider" in js
    assert "function _renderTennisSetInputs(matchId, numSets, decider" in js
    assert "txt_match_tb_label" in js
    assert "async function _setDefaultDecider(decider)" in js
    assert "get needsSets()" in js


def test_admin_scoring_settings_has_decider_toggle(client):
    js = client.get("/admin-tv-email.js", headers={"Accept-Encoding": "identity"}).text
    assert 'id="set-decider-toggle"' in js
    assert "_setDefaultDecider('match_tiebreak')" in js
    assert "txt_admin_settings_decider_help" in js


def test_tv_js_labels_match_tiebreak(client):
    js = client.get("/tv.js", headers={"Accept-Encoding": "identity"}).text
    assert "tvSettings.set_decider" in js
    assert "function _tvMatchDecider(m)" in js
    assert "txt_match_tb_label" in js
    # The submit form, the correction form and the submit form's format switch
    # (rebuilding the rows for the chosen decider) share the decider-aware rows.
    assert js.count("_tvRenderSetRows(") == 4


def test_decider_i18n_keys_in_both_languages(client):
    js = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    keys = [
        "txt_match_format_decider_label",
        "txt_match_format_decider_full_set",
        "txt_match_format_decider_tiebreak",
        "txt_match_format_completed_needs_sets",
        "txt_match_tb_label",
        "txt_match_tb_rule",
        "txt_admin_settings_decider",
        "txt_admin_settings_decider_help",
    ]
    for key in keys:
        assert js.count(f'"{key}"') == 2, key


def test_cache_name_bumped_for_decider(client):
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version and int(version.group(1)) >= 57


# ── Payments: shared admin island + register / Player Hub payment blocks ────


def test_admin_payments_js_served_and_cached(client):
    """New frontend file: hardcoded route, index.html script tag, service worker entry + bump."""
    r = client.get("/admin-payments.js", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert "javascript" in r.headers["content-type"]
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    assert '<script src="/admin-payments.js" defer></script>' in html
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    assert "'/admin-payments.js'" in sw
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version and int(version.group(1)) >= 58


def test_admin_payments_island_is_reactive_and_mounted(client):
    """admin-payments.js renders a v-scope island bound to a per-entity store and the
    lobby/tournament views mount it after their legacy innerHTML swap."""
    js = client.get("/admin-payments.js", headers={"Accept-Encoding": "identity"}).text
    assert "function _payCreateStore" in js and "reactiveStore(" in js
    assert "v-scope>" in js
    for binding in (
        'v-for="r in visibleRows()"',
        'v-model="draft.fee"',
        '@click="markPaid(r.player_id, m)"',
        '@change="changeStatus(r.player_id, $event.target.value, $event.target)"',
        '@click="remind()"',
        'v-if="refundRows().length"',
    ):
        assert binding in js, binding
    assert "onclick=" not in js
    assert "txt_pay_col_actions" not in js  # status chip is the only editor
    assert "mountIsland(root, store)" in js
    reg = client.get("/admin-registration.js", headers={"Accept-Encoding": "identity"}).text
    assert "_renderPaymentsIsland('registration', rid)" in reg
    assert "_mountPaymentsPanel('registration', rid)" in reg
    assert "_mountPaymentSettingsPanel('registration', rid)" in reg
    lobby = client.get("/admin-lobby-settings-panel.js", headers={"Accept-Encoding": "identity"}).text
    assert "_renderPaymentSettingsIsland('registration', rid)" in lobby
    settings = client.get("/admin-settings-panel.js", headers={"Accept-Encoding": "identity"}).text
    assert "_renderPaymentsIsland('tournament', currentTid)" in settings
    for path in ("/admin-gp.js", "/admin-mex.js"):
        assert (
            "_mountPaymentsPanel('tournament', currentTid)"
            in client.get(path, headers={"Accept-Encoding": "identity"}).text
        )


def test_register_success_template_has_payment_block(client):
    html = client.get("/register/some-alias", headers={"Accept-Encoding": "identity"}).text
    block = html[html.index('<template id="tpl-success">') :]
    block = block[: block.index("</template>\n<div")]
    assert 'id="reg-pay-block" v-if="result.payment"' in block
    assert '@click="reportPayment()"' in block
    assert 'v-model="payReference"' in block
    assert 'v-for="(m, i) in result.payment.methods"' in block
    js = client.get("/register.js", headers={"Accept-Encoding": "identity"}).text
    assert "async reportPayment()" in js
    assert "player-payment-report" in js
    assert "function _renderFeeNotice" in js


def test_player_hub_pending_payments_island(client):
    js = client.get("/player.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _payHubStore = reactiveStore(" in js
    assert 'id="player-payments-island" v-scope' in js
    assert "mountIsland(root, _payHubStore)" in js
    assert '@click="report(row)"' in js
    shared = client.get("/shared.js", headers={"Accept-Encoding": "identity"}).text
    for fn in (
        "function formatMoney",
        "function paymentMethodLabel",
        "function paymentMethodHref",
        "function copyTextToClipboard",
    ):
        assert fn in shared, fn


def test_payment_i18n_keys_in_both_languages(client):
    js = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    for key in (
        "txt_pay_tab",
        "txt_pay_settings_help",
        "txt_pay_methods_visibility_warning",
        "txt_pay_summary",
        "txt_pay_remind_unpaid",
        "txt_pay_refunds_title",
        "txt_pay_player_i_paid",
        "txt_pay_player_reported",
        "txt_pay_hub_title",
        "txt_admin_settings_help_payments",
    ):
        assert js.count(f'"{key}"') == 2, key


def _read_frontend(name: str) -> str:
    return (Path(__file__).resolve().parent.parent / "frontend" / name).read_text()


def test_demo_instance_hides_community_and_club_ui():
    """Demo instance: community/club surfaces are tagged core-only (hidden via
    theme.css) or skipped in JS through isDemoInstance()."""
    theme = _read_frontend("theme.css")
    assert ".demo-instance .core-only" in theme
    assert "html:not(.demo-instance) .demo-only" in theme

    html = _read_frontend("index.html")
    assert html.count('class="create-meta-row core-only') == 4
    assert html.count('class="paste-list-btn core-only" onclick="addPlayersFromClub(') == 3
    assert '<div class="card core-only" id="info-communities-clubs">' in html
    assert '<li class="core-only"><a href="#info-communities-clubs"' in html
    assert 'class="demo-only" data-i18n-html="txt_txt_info_demo_sandbox_desc_instance"' in html

    assert "function isDemoInstance()" in _read_frontend("shared.js")
    assert "_demoInstance" in _read_frontend("auth.js")
    assert "isDemoInstance()) ? '' : _renderScopeGroup()" in _read_frontend("admin-tv-email.js")


def test_tv_double_elim_explainer_behind_info_button(client):
    """The double-elimination explainer opens from an info button, not inline."""
    js = client.get("/tv.js", headers={"Accept-Encoding": "identity"}).text
    assert "showAbbrevPopup(event,'double_elim')" in js
    assert "double-elim-explainer" not in js


def test_espejo_has_no_super_final_in_setup_and_shows_consolation_winner():
    """Espejo = Winners bracket + consolation bracket: no Super Final option, consolation winner shown."""
    html = _read_frontend("index.html")
    assert "po-espejo-super-final" not in html
    for name in ("admin-create.js", "admin-gp.js"):
        js = _read_frontend(name)
        assert "espejo_super_final:" not in js, f"{name} still sends espejo_super_final"
        assert "getElementById('po-espejo-super-final')" not in js
        assert "getElementById('gp-espejo-super-final')" not in js

    i18n = _read_frontend("i18n.js")
    assert i18n.count('"txt_txt_consolation_winner"') == 2  # en + es
    # Both GP and standalone play-off admin views and the TV share the consolation banner.
    assert "_renderChampionAlerts(status)" in _read_frontend("admin-gp.js")
    assert "_buildChampionBanners(status)" in _read_frontend("tv.js")


def test_gp_views_are_espejo_aware():
    """GP admin + TV pass isEspejo to the bracket card and score Losers matches through GP endpoints."""
    admin_gp = _read_frontend("admin-gp.js")
    assert "isEspejo: gpEspejo" in admin_gp
    assert "'gp-espejo-losers':{ points: 'gp/record-playoff'" in admin_gp
    assert "'gp-espejo-losers'" in _read_frontend("admin-tournaments.js")
    assert "status.espejo === true)" in _read_frontend("tv.js")


def test_gp_espejo_split_oro_plata_frontend():
    """The Oro / Plata editor sends the split payload and every new i18n key exists in en + es."""
    admin_gp = _read_frontend("admin-gp.js")
    for field in ("espejo_split: true", "oro_player_ids:", "plata_player_ids:", "plata_third_place:"):
        assert field in admin_gp, field
    assert "advancing_player_ids" in admin_gp  # the regular path is unchanged
    # Oro / Plata replaces classic Espejo in the GP editor (Direct Playoffs keeps it).
    assert "['espejo', 'txt_txt_espejo_format']" not in admin_gp
    assert 'id="po-espejo"' in _read_frontend("index.html")
    assert "isSplit: gpSplit" in admin_gp
    assert "status.espejo_split" in admin_gp
    assert "isSplit" in _read_frontend("admin-utils.js")
    tv = _read_frontend("tv.js")
    assert "status.espejo_split === true" in tv
    assert "m.bracket_side" in tv

    i18n = _read_frontend("i18n.js")
    keys = (
        "txt_txt_espejo_split_format",
        "txt_txt_espejo_gold_bracket",
        "txt_txt_espejo_silver_bracket",
        "txt_txt_silver_winner",
        "txt_split_intro",
        "txt_split_cutoff",
        "txt_split_cutoff_hint",
        "txt_split_gold",
        "txt_split_silver",
        "txt_split_out",
        "txt_split_count",
        "txt_split_warn_min",
        "txt_split_warn_odd",
        "txt_split_warn_third",
        "txt_split_gold_third_place",
        "txt_split_silver_third_place",
    )
    for key in keys:
        assert i18n.count(f'"{key}"') == 2, key  # en + es
        assert f"'{key}'" in admin_gp or f"'{key}'" in tv or f"'{key}'" in _read_frontend("admin-utils.js"), (
            f"{key} is defined but unused"
        )


# ── Admin mobile polish: icons, header row, Create format strip ─────────────

# Pictographic emoji (colour glyphs that render differently per platform).
# Text dingbats such as ✓ ✕ ★ ▸ stay allowed.
_EMOJI_RE = re.compile(
    "[\U0001f300-\U0001faff\U0001f1e6-\U0001f1ff☀-☄☆-⛿ℹ✅⏳⭐]"
    "|✏️"
    r"|\\u[dD]83[cdeCDE]|&#x1F[0-9A-Fa-f]{3};"
)
_EMOJI_FREE_FILES = [
    "index.html",
    "admin.css",
    "player.js",
    "tv.js",
    "i18n.js",
    "admin-utils.js",
    "admin-mex.js",
    "admin-export.js",
    "admin-gp.js",
    "admin-players.js",
    "admin-convert.js",
    "admin-settings-panel.js",
    "admin-lobby-settings-panel.js",
    "admin-clubs.js",
    "admin-clubs-settings-panel.js",
]


@pytest.mark.parametrize("name", _EMOJI_FREE_FILES)
def test_ui_uses_svg_icons_not_emoji(name):
    """Admin, Player Hub and TV views draw icons with _ic(), not emoji
    (including the exported HTML/PDF results document built in admin-export.js)."""
    offenders = [line.strip()[:80] for line in _read_frontend(name).splitlines() if _EMOJI_RE.search(line)]
    assert offenders == []


def test_icon_helper_shared_by_every_page():
    shared = _read_frontend("shared.js")
    assert "function _ic(name)" in shared
    assert "function _ic(name)" not in _read_frontend("admin-utils.js")
    for icon in ("sun:", "moon:", "trophy:", "bench:", "court:", "medal:", "bell:", "belloff:", "alert:", "clock:"):
        assert f"    {icon}" in shared, icon
    for icon in ("help:", "search:", "calendar:", "zap:", "archive:", "refresh:", "login:"):
        assert f"    {icon}" in shared, icon
    # Admin moved from the filled Ant icon set to the shared stroke _ic() set.
    assert "_antIc" not in _read_frontend("admin-utils.js")
    for name in ("index.html", "auth.js", "admin-gp.js", "admin-mex.js"):
        assert "_antIc" not in _read_frontend(name), name


def test_admin_header_row_and_create_strip_fit_phones(client):
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    assert '<div class="page-header-row page-header-row--nav">' in html
    assert '<span class="tab-btn-label" data-i18n="txt_txt_info">Info</span>' in html
    assert '<div class="create-mode-strip d-flex' in html
    css = _read_frontend("admin.css")
    assert ".page-header-row--nav .tab-btn-label { display: none; }" in css
    assert ".create-mode-strip > .subtabs { display: contents; }" in css
    assert ".participant-entry input { min-height: 44px !important; }" in css
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version and int(version.group(1)) >= 70


def test_unused_reg_manage_key_removed():
    assert '"txt_reg_manage"' not in _read_frontend("i18n.js")


# ── Admin pass 3: sticky offsets, tab strips, stacked tables, export, TV ────


def test_sticky_status_bars_publish_their_height_for_in_page_jumps():
    """Jumps (club settings gear, season -> leaderboard, GP/Mexicano shortcuts)
    land below the pinned status bar: JS measures it, CSS pads the scroller."""
    utils = _read_frontend("admin-utils.js")
    assert "const _ADMIN_STICKY_BAR_SELECTOR = '.club-status-bar, #mex-ops-header, .group-nav-bar';" in utils
    assert "function _syncAdminStickyOffset()" in utils
    assert "rootStyle.setProperty('--admin-sticky-offset'" in utils
    assert "new MutationObserver(" in utils and "new ResizeObserver(schedule)" in utils
    css = _read_frontend("admin.css")
    assert "html { scroll-padding-top: calc(var(--admin-sticky-offset, 0px) + 0.5rem); }" in css
    assert ".group-nav-bar { top: var(--admin-sticky-top, 0px); }" in css
    assert ".settings-subtabs { top: var(--admin-sticky-offset, 0px); }" in css


def _phone_block(css: str, marker: str) -> str:
    start = css.index(marker)
    return css[start : css.index("\n}\n", start)]


def test_settings_subtab_strips_show_short_labels_under_icons():
    """Club / tournament / lobby settings tabs: icon over a one-word label, the
    tab-name heading is gone, and tabs/panels are linked for accessibility."""
    css = _read_frontend("admin.css")
    block = _phone_block(css, "@media (max-width: 720px) {\n  /* Phones: the sub-tab strip")
    assert "overflow-x" not in block and "nowrap" not in block
    assert ".settings-subtab-label { display: none; }" not in block
    assert "settings-subpanel-title" not in css
    base = css[css.index(".settings-subtab-btn {") :]
    base = base[: base.index("}")]
    assert "flex-direction: column;" in base
    assert "flex: 1 1 0;" in base and "min-width: 44px;" in base
    assert ".settings-help-master-label { display: none; }" in block
    assert "#admin-settings-card:not(.is-help-on) .settings-help--explain { display: none; }" in block
    i18n = _read_frontend("i18n.js")
    for name in ("admin-clubs-settings-panel.js", "admin-settings-panel.js", "admin-lobby-settings-panel.js"):
        js = _read_frontend(name)
        assert '<div class="settings-subtabs" role="tablist"' in js, name
        assert '<span class="settings-subtab-label">${esc(st.short)}</span>' in js, name
        assert "settings-subpanel-title" not in js, name
        assert "aria-labelledby=" in js and "aria-controls=" in js, name
        assert "icon: '€'" not in js, name
        for key in re.findall(r"txt_settings_tab_\w+_short", js):
            assert i18n.count(f'"{key}"') == 2, (name, key)


def test_settings_help_toggle_is_icon_only_and_hides_explanations():
    """The Settings help toggle keeps its label as the accessible name, persists
    per tab session, and drives the phone-only explanatory paragraphs."""
    js = _read_frontend("admin-settings-panel.js")
    toggle = js[js.index("function _renderSettingsHelpToggle(") :]
    toggle = toggle[: toggle.index("\n}\n")]
    assert 'aria-label="${label}" title="${label}"' in toggle
    assert "_ic('info')" in toggle
    flip = js[js.index("function _toggleSettingsHelp(") :]
    flip = flip[: flip.index("\n}\n")]
    assert "card.classList.toggle('is-help-on', willShow)" in flip
    assert "_setSettingsHelpOn(willShow)" in flip
    assert "btn.setAttribute('aria-label', t(key))" in flip
    assert "sessionStorage.getItem(_SETTINGS_HELP_STORAGE_KEY)" in js
    assert "_renderSettingsHelpBlock" not in js
    tv_email = _read_frontend("admin-tv-email.js")
    assert tv_email.count("settings-help--explain") == 14
    # Empty states stay visible on phones.
    assert "<p class=\"settings-help\">${t('txt_comm_no_communities')}</p>" in tv_email
    for name in ("admin-payments.js", "admin-collaborators.js", "admin-player-codes.js"):
        assert "settings-help--explain" in _read_frontend(name), name
    i18n = _read_frontend("i18n.js")
    for gone in ("txt_admin_settings_help_title", "txt_admin_settings_help_intro"):
        assert f'"{gone}"' not in i18n, gone


def test_tournament_status_bar_is_one_slim_row():
    """GP / Play-off / Mexicano status bar: match progress, review chip and an
    icon-only Settings gear; no Status heading or Next action shortcut."""
    utils = _read_frontend("admin-utils.js")
    assert "function _buildOpsStats(matches)" in utils
    bar = utils[utils.index("function _renderTournamentStatusBar(") :]
    bar = bar[: bar.index("\n}\n")]
    assert (
        "t('txt_admin_status_matches_short', { done: completed, total })"
        in utils[utils.index("function _renderOpsBarProgress(") :]
    )
    assert "_renderOpsBarProgress(completed, total)" in bar
    assert "if (review > 0)" in bar and "txt_admin_status_attention" in bar
    assert 'aria-label="${settingsLabel}" title="${settingsLabel}">${_ic(\'settings\')}</button>' in bar
    assert "_renderStatusBarStats" not in utils
    gp = _read_frontend("admin-gp.js")
    mex = _read_frontend("admin-mex.js")
    assert "_renderTournamentStatusBar({\n      id: 'gp-ops-header'," in gp
    assert "_renderTournamentStatusBar({\n      id: 'po-ops-header'," in gp
    assert "_renderTournamentStatusBar({\n      id: 'mex-ops-header'," in mex
    for js in (gp, mex):
        for gone in (
            "FocusNextAction",
            "OpsHeader(",
            "_buildGpOpsStats",
            "_buildMexOpsStats",
            "txt_admin_status_phase",
        ):
            assert gone not in js, gone
    i18n = _read_frontend("i18n.js")
    for key in ("txt_admin_status_matches_short", "txt_admin_status_matches_unit"):
        assert i18n.count(f'"{key}"') == 2, key
    for gone in ("txt_admin_status_phase", "txt_txt_next_action", "txt_txt_escalated"):
        assert f'"{gone}"' not in i18n, gone
    css = _read_frontend("admin.css")
    assert ".card.ops-bar {" in css
    assert ".gp-ops-stat-pill" not in css


def test_tournament_status_bar_carries_phase_and_empty_state():
    """The bar names the phase (replacing the separate round / play-offs
    alerts), says "No matches yet" before any exist, has no progress meter
    (the count says it), and on touch widths is no taller than its 44px gear."""
    utils = _read_frontend("admin-utils.js")
    bar = utils[utils.index("function _renderTournamentStatusBar(") :]
    bar = bar[: bar.index("\n}\n")]
    assert "phase = ''" in bar
    assert '<span class="ops-bar-phase">${esc(phase)}</span>' in bar
    assert "t('txt_admin_status_no_matches')" in bar
    assert "btn-muted" not in bar
    mex = _read_frontend("admin-mex.js")
    gp = _read_frontend("admin-gp.js")
    assert "phase: mexPhaseLabel" in mex
    assert "txt_admin_status_round_n_of_m" in mex and "txt_admin_status_round_n'" in mex
    assert "txt_txt_mexicano_round_n" not in mex
    assert "phase: gpPhaseLabel" in gp
    for js in (gp, mex):
        assert "${t('txt_txt_phase')}:" not in js
    i18n = _read_frontend("i18n.js")
    for key in ("txt_admin_status_no_matches", "txt_admin_status_round_n", "txt_admin_status_round_n_of_m"):
        assert i18n.count(f'"{key}"') == 2, key
    for gone in ("txt_txt_mexicano_round_n", "txt_txt_mexicano_round_n_of_m"):
        assert f'"{gone}"' not in i18n, gone
    css = _read_frontend("admin.css")
    assert "ops-bar-meter" not in css and "ops-bar-meter" not in utils
    assert 'role="progressbar"' not in utils[utils.index("function _renderOpsBarProgress(") :][:1500]
    assert "  .card.ops-bar,\n  #mex-ops-header {\n    min-height: 44px;\n    padding-top: 0;" in css


def test_player_mini_card_locks_page_scroll():
    """Opening a leaderboard player card freezes the page behind it (iOS-safe
    position:fixed lock), the back gesture closes it, and the card itself
    contains its scroll."""
    js = _read_frontend("shared.js")
    assert "function lockPageScroll()" in js and "function unlockPageScroll()" in js
    show = js[js.index("function showMiniCardOverlay(overlay)") :]
    show = show[: show.index("\n}\n")]
    assert "lockPageScroll();" in show and "history.pushState({ miniCard: overlay.id }" in show
    hide = js[js.index("function hideMiniCardOverlay(overlay)") :]
    hide = hide[: hide.index("\n}\n")]
    assert "if (!overlay || overlay.hidden) return;" in hide
    assert "unlockPageScroll();" in hide and "history.back()" in hide
    assert "html.scroll-locked { overflow: hidden; }" in _read_frontend("theme.css")
    for name, rule in (("tv.css", ".tv-player-card {"), ("club.css", ".club-mini-card {")):
        css = _read_frontend(name)
        block = css[css.index(rule) :]
        block = block[: block.index("}")]
        assert "overscroll-behavior: contain;" in block, name
        assert "max-height: 90dvh;" in block, name


def test_admin_player_tables_stack_into_cards_on_phones():
    """Club Players (+ hidden-from-sport, possible members) and the Players Hub
    list render as stacked rows on phones via data-label cells."""
    css = _read_frontend("admin.css")
    block = _phone_block(css, "@media (max-width: 600px) {\n  .table-stack,")
    assert ".table-stack thead { display: none; }" in block
    assert ".table-stack td[data-label]::before {" in block and "content: attr(data-label);" in block
    assert ".table-stack .stack-actions {" in block
    clubs = _read_frontend("admin-clubs.js")
    assert clubs.count('<table class="player-codes-table table-stack">') == 3
    assert 'class="player-codes-cell stack-pri" data-label="${escAttr(t(\'txt_clubs_hub_status\'))}"' in clubs
    assert clubs.count('class="row-actions stack-actions"') == 3
    # Player-row buttons are quiet outlines/tints, not filled per-row colour.
    assert "btn btn-sm btn-row btn-row--accent" in clubs and "btn-row--danger player-codes-icon-btn" in clubs
    assert ".btn-row--accent {" in css and ".btn-row--danger:hover {" in css
    assert "&#x2715;" not in clubs and "&#x2296;" not in clubs and "&#x2295;" not in clubs
    assert "${_ic('eyeoff')}" in clubs and "${_ic('eye')}" in clubs
    shared = _read_frontend("shared.js")
    assert "    eye:" in shared and "    eyeoff:" in shared
    html = _read_frontend("index.html")
    assert (
        '<div v-if="visibleProfiles.length" class="player-codes-table-wrap mt-2"><table class="player-codes-table table-stack">'
        in html
    )
    # Ghost profiles start hidden; a search matching only ghosts says so.
    assert "localStorage.getItem('ph-show-ghosts') === '1'" in _read_frontend("admin-players.js")
    assert "t('txt_ph_only_ghosts_hidden', { n: ghostCount })" in html
    assert ":data-label=\"t('txt_ph_padel_elo')\"" in html
    assert '<td class="row-actions stack-actions">' in html
    assert 'class="btn btn-sm btn-row btn-row--accent" @click="showConvert(p.id)"' in html
    assert 'class="btn btn-sm btn-row" @click="manage(p.id)"' in html
    assert "    userplus:" in shared


def test_results_export_trophy_is_self_sized_svg():
    """The standalone HTML/PDF export has no theme.css, so the trophy SVG sizes
    and colours itself instead of relying on the `.ic` rule."""
    export = _read_frontend("admin-export.js")
    assert "\U0001f3c6" not in export
    assert export.count("<div class=\"champ\">${_REPORT_TROPHY_SVG} ${t('txt_txt_champion')}") == 1
    start = export.index("const _REPORT_TROPHY_SVG")
    svg = export[start : export.index("</svg>';", start)]
    for attr in ('width="18"', 'height="18"', 'viewBox="0 0 24 24"', 'fill="none"', 'stroke="#166534"'):
        assert attr in svg, attr
    assert 'class="ic"' not in svg


def test_tournament_export_lives_in_shared_module(client):
    """The HTML/PDF export is one module, reached from an Export tab in each
    view's Settings card (out of the match-management flow), in every phase:
    results once finished, a snapshot while running."""
    resp = client.get("/admin-export.js")
    assert resp.status_code == 200
    export = _read_frontend("admin-export.js")
    assert "async function exportTournamentOutcome(format)" in export
    assert "function _renderExportPanel({ finished, hasStandings = true, hasBracket = false })" in export
    panel = _read_frontend("admin-settings-panel.js")
    assert "'access', 'export'];" in panel
    assert "body: exportPanel ? _renderExportPanel(exportPanel) : ''" in panel
    assert "export: 'txt_admin_settings_help_export'," in panel
    assert "    download: `" in _read_frontend("shared.js")
    mex = _read_frontend("admin-mex.js")
    gp = _read_frontend("admin-gp.js")
    for js in (mex, gp):
        assert "function exportTournamentOutcome" not in js
        assert "export-include-history" not in js
        assert "_renderExportCard" not in js
    assert "exportPanel: { finished: isFinished, hasBracket: isPlayoffs || hasPlayoffBracket }," in mex
    assert "exportPanel: { finished: status.phase === 'finished', hasBracket: status.phase !== 'groups' }," in gp
    assert "exportPanel: { finished: status.phase === 'finished', hasStandings: false, hasBracket: true }," in gp
    # admin-player-codes.js reuses the print helper, so it loads first.
    html = _read_frontend("index.html")
    assert html.index('src="/admin-export.js"') < html.index('src="/admin-player-codes.js"')
    sw = _read_frontend("service-worker.js")
    assert "'/admin-export.js'" in sw


def test_tournament_export_options_are_remembered():
    """Section choices persist per browser; standings are always included."""
    export = _read_frontend("admin-export.js")
    assert "const _EXPORT_OPTS_KEY = 'amistoso-export-opts';" in export
    assert "{ history: true, bracket: true, upcoming: true, comments: true, elo: false }" in export
    assert "localStorage.setItem(_EXPORT_OPTS_KEY, JSON.stringify(opts))" in export
    assert "onchange=\"_saveExportOpt('${key}', this.checked)\"" in export
    for key in ("elo", "upcoming", "bracket", "history"):
        assert f"opts.{key}" in export, key
    i18n = _read_frontend("i18n.js")
    for key in (
        "txt_export_include_bracket",
        "txt_export_include_upcoming",
        "txt_export_include_elo",
        "txt_admin_settings_tab_export",
        "txt_admin_settings_help_export",
        "txt_export_snapshot_title",
        "txt_export_matches_played",
        "txt_export_upcoming_matches",
        "txt_export_col_elo",
        "txt_export_col_comment",
        "txt_export_include_comments",
        "txt_export_score_disputed",
        "txt_export_score_unconfirmed",
        "txt_export_preparing",
    ):
        assert i18n.count(f'"{key}"') == 2, key


def test_tournament_export_match_tables_show_comments():
    """Admin match comments get their own column in the upcoming and history
    tables, behind a remembered toggle, and only when a listed match has one."""
    export = _read_frontend("admin-export.js")
    assert "const _showComments = (on, ms) => on && ms.some(m => (m.comment || '').trim());" in export
    assert "h += toggle('comments', t('txt_export_include_comments'));" in export
    for fn in (
        "function _report_history(title, matches, { comments, teams })",
        "function _report_upcoming(matches, { comments, teams })",
    ):
        body = export[export.index(fn) :]
        body = body[: body.index("\n}\n")]
        assert "_comment_headers(show, _court_headers(" in body, fn
        assert "_with_comment(show, m, _with_court(" in body, fn
    calls = [
        line
        for line in export.splitlines()
        if "body += _report_history(" in line or "body += _report_upcoming(" in line
    ]
    assert len(calls) == 8 and all(line.endswith(", tbl);") for line in calls)


def test_tournament_export_names_teams_and_players():
    """Team events say "Team" in standings and match tables (a team is one
    entry per side, so the one-per-side "Player" rule must not apply to them).
    Tennis Individual events say "Player": tennis Group+Playoff always stores
    team_mode=true and Mexicano tennis team_mode is singles, so in tennis only
    a roster or a play-off's team_mode means teams."""
    export = _read_frontend("admin-export.js")
    rule = export[export.index("function _is_team_event(status, kind)") :]
    rule = rule[: rule.index("\n}\n")]
    assert "if (Object.keys(status.team_roster || {}).length > 0) return true;" in rule
    assert "return (status.sport || 'padel') !== 'tennis' || kind === 'po';" in rule
    assert "const _side_headers = (ms, teams) => (!teams && ms.length" in export
    assert "teams: _is_team_event(status, 'gp') };" in export
    assert "teams: _is_team_event(status, 'po') };" in export
    assert "teams: _is_team_event(status, 'mex') };" in export
    assert export.count("_participant_header(tbl.teams)") == 2
    assert "[t('txt_export_player_1'), t('txt_export_player_2')]" in export


def test_tournament_export_pdf_window_opens_before_any_await():
    """The print window opens inside the click gesture (iOS Safari blocks a
    window.open after an await) and Espejo exports fetch both brackets."""
    export = _read_frontend("admin-export.js")
    body = export[export.index("async function exportTournamentOutcome(format)") :]
    assert body.index("pdfWin = window.open('', '_blank');") < body.index("await ")
    assert "_open_printable_pdf(htmlDoc, pdfWin);" in body
    assert "function _open_printable_pdf(htmlDoc, win = null)" in export
    assert "`${url}&side=winners`" in export and "`${url}&side=losers`" in export
    assert "#1d4ed8" not in export and "Arial" not in export
    assert "<html lang=\"${escAttr(_currentLang || 'en')}\">" in export


def test_tv_profile_auto_login_checks_participation_first():
    """A Hub player opening a TV page they don't play in sends no player-auth
    request (no 401 console noise, no rate-limit strike)."""
    tv = _read_frontend("tv.js")
    start = tv.index("async function _tryProfileAutoLogin()")
    body = tv[start : tv.index("\n}\n", start)]
    assert "if (!(await _hubSessionInTournament())) return;" in body
    assert body.index("_hubSessionInTournament") < body.index("_playerAuth(profile.passphrase, null)")
    assert "fetch(`${API}/api/player-profile/space`" in tv
    assert "function _jwtStillValid(token)" in tv


def test_service_worker_cache_bumped_for_pass_three(client):
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version and int(version.group(1)) >= 71


# ── Admin light revamp: shared chips, ghost nav, stroke icons, labels ───────


def test_home_filter_chips_defined_once_in_theme():
    theme = _read_frontend("theme.css")
    for sel in (".home-filter-row {", ".home-filter-chip {", ".home-filter-chip-count {"):
        assert theme.count("\n" + sel) == 1, sel
        assert ("\n" + sel) not in _read_frontend("admin.css"), sel
        assert ("\n" + sel) not in _read_frontend("club.css"), sel


def test_admin_info_button_uses_stroke_icon():
    html = _read_frontend("index.html")
    start = html.index('class="tab-btn tab-btn--info"')
    button = html[start : html.index("</button>", start)]
    assert 'viewBox="0 0 24 24"' in button and 'stroke="currentColor"' in button
    assert "64 64 896 896" not in html


def test_status_bar_shows_each_bracket_current_round():
    """Play-offs: the bar lists the current round of each running bracket
    (Espejo via bracket_side, double elimination via "Winners/Losers Rn"),
    short round names on phones, and the text below does not repeat it."""
    utils = _read_frontend("admin-utils.js")
    helper = utils[utils.index("function _buildBracketRounds(") :]
    helper = helper[: helper.index("\n}\n")]
    assert "m.bracket_side === 'winners' || m.bracket_side === 'losers'" in helper
    assert "/^(Winners|Losers) (R\\d+)$/" in helper
    assert "if (split.length) return split;" in helper
    assert "function _shortRoundLabel(round)" in utils
    gp = _read_frontend("admin-gp.js")
    mex = _read_frontend("admin-mex.js")
    assert "rounds: status.phase === 'playoffs' ? _buildBracketRounds(allPlayoffMatches) : []," in gp
    assert "rounds: status.phase === 'finished' ? [] : _buildBracketRounds(poMatches)," in gp
    assert "rounds: isPlayoffs ? _buildBracketRounds(playoffMatches) : []," in mex
    assert "const showRound = new Set(" in mex
    assert '<div class="card mex-current-round">' in mex
    assert "match-round-badge" in gp
    assert "nav-btn-round-count" not in gp and "nav-btn-round-count" not in _read_frontend("admin.css")
    i18n = _read_frontend("i18n.js")
    for key in (
        "txt_admin_status_bracket_winners",
        "txt_admin_status_bracket_losers",
        "txt_admin_round_short_quarter",
        "txt_admin_round_short_semi",
        "txt_admin_round_short_third",
        "txt_admin_round_short_of_n",
    ):
        assert i18n.count(f'"{key}"') == 2, key
    assert "Court assignments Play-offs" not in i18n
    css = _read_frontend("admin.css")
    assert ".mex-current-round .match-round-badge { display: none; }" in css
    assert ".ops-bar-round ~ .ops-bar-count .ops-bar-unit { display: none; }" in css


def test_admin_header_nav_holds_tournaments_and_new():
    """Tournaments / New tournament live in header row 2 beside Info as icon +
    label buttons; the chip row below only holds open tournaments + refresh."""
    html = _read_frontend("index.html")
    nav_start = html.index('<div class="page-header-row page-header-row--nav">')
    nav = html[nav_start : html.index('<div id="auth-status"', nav_start)]
    for tab, key in (("home", "txt_txt_tournaments"), ("create", "txt_txt_create")):
        start = nav.index(f'data-tab="{tab}"')
        button = nav[nav.rindex("<button", 0, start) : nav.index("</button>", start)]
        assert 'role="tab"' in button and 'class="tab-btn tab-btn--nav' in button, tab
        assert f'data-i18n-aria-label="{key}"' in button, tab
        assert 'viewBox="0 0 24 24"' in button and 'stroke="currentColor"' in button, tab
        assert f'<span class="tab-btn-label" data-i18n="{key}">' in button, tab
    # Chip row: collapsed by default, no nav tabs, refresh right after the chips.
    row_start = html.index('<div class="tabs tournament-tabs hidden" id="tournament-tabs">')
    row = html[row_start : html.index("<!-- ─── HOME", row_start)]
    assert "data-tab=" not in row
    assert row.index('id="tournament-chips"') < row.index('id="admin-refresh-btn"')
    assert "compact-controls" not in html
    assert "active-tournament-indicator" not in html
    js = _read_frontend("admin-tournaments.js")
    assert "active-tournament-indicator" not in js
    assert "row.classList.toggle('hidden', _openTournaments.length === 0)" in js
    # × is a sibling button of the chip, not a span nested inside it.
    assert '<button type="button" class="chip-close"' in js
    assert '<span class="chip-close"' not in js
    assert "_scrollActiveChipIntoView(row)" in js
    css = _read_frontend("admin.css")
    assert "max-width: 18rem;" in css
    assert ".chip-close { min-width: 44px; min-height: 44px; }" in css
    # Phones: Tournaments / New stay icon-only squares on the same row as the
    # labelled account buttons (see test_phone_header_is_one_labelled_row).
    assert ".page-header-row--nav .tab-btn-label { display: none; }" in css
    assert ".page-header-row--nav .tab-btn--nav { min-width: 40px; min-height: 48px; }" in css


def test_admin_players_nav_label_key_exists():
    i18n = _read_frontend("i18n.js")
    assert '"txt_admin_nav_players": "Players"' in i18n
    assert '"txt_admin_nav_players": "Jugadores"' in i18n
    # the shared public header keeps the Player Hub wording
    assert '"txt_nav_player_space": "Player Hub"' in i18n
    assert "txt_admin_nav_players" in _read_frontend("auth.js")


def test_admin_css_uses_tokens_not_off_palette_hues():
    css = _read_frontend("admin.css")
    for legacy in ("#3b82f6", "#2563eb", "#d97706", "#f59e0b", "#10b981", "rgba(34,197,94", "rgba(239,68,68"):
        assert legacy not in css, legacy
    assert "color: #fff" not in css
    assert "var(--accent)" not in css and "var(--surface2)" not in css
    assert "#3b82f6" not in _read_frontend("register.html")


def test_admin_rerenders_preserve_view_position():
    """Filter chips and full re-renders keep the admin's view anchored to the
    element they were looking at instead of restoring a raw scrollY."""
    utils = _read_frontend("admin-utils.js")
    assert "function _preserveScrollPosition(" in utils
    assert "_preserveScrollPosition(() => _applyMatchFilter(" in utils

    gp = _read_frontend("admin-gp.js")
    start = gp.index("async function _rerenderCurrentViewPreserveDrafts(")
    rerender = gp[start : gp.index("\n}\n", start)]
    assert "_preserveScrollPosition(" in rerender
    assert "window.scrollTo" not in rerender

    reg = _read_frontend("admin-registration.js")
    assert "const scrollY = window.scrollY" not in reg
    assert reg.count("_preserveScrollPosition(") == 2


def test_tournament_chip_has_no_tick():
    js = _read_frontend("admin-tournaments.js")
    css = _read_frontend("admin.css")
    assert "chip-check" not in js and "chip-check" not in css
    assert ".tournament-chip.active .chip-name { font-weight: 700; }" in css


def test_clear_result_button_lives_in_edit_form():
    js = _read_frontend("admin-gp.js")
    form = js[js.index("function _renderEditForm") : js.index("function _canClearMatchResult")]
    assert "_clearMatchResult('${m.id}')" in form and "txt_match_clear_btn" in form
    assert "/matches/${mid}/clear" in js
    assert "if (phase === 'finished') return false;" in js


def test_standings_tables_drop_draws_and_use_one_letter_played_header():
    i18n = _read_frontend("i18n.js")
    assert '"txt_txt_p_abbrev": "P"' in i18n and '"txt_txt_p_abbrev": "J"' in i18n
    assert '"txt_txt_played_abbrev": "P"' in i18n and '"txt_txt_played_abbrev": "J"' in i18n
    assert "txt_txt_d_abbrev" not in i18n and "txt_txt_abbrev_d_full" not in i18n
    for name in ("admin-gp.js", "admin-mex.js", "admin-export.js", "admin-utils.js", "tv.js"):
        js = _read_frontend(name)
        assert "txt_txt_d_abbrev" not in js, name
        assert "r.draws" not in js, name
    # The played header keeps its meaning discoverable (title on the one-letter header).
    assert "txt_txt_abbrev_mp_full" in _read_frontend("tv.js")
    assert "txt_txt_abbrev_mp_full" in _read_frontend("admin-gp.js")
    assert "txt_txt_played'" not in _read_frontend("admin-export.js")
    assert not re.search(r"\.col-d\b(?!iff)", _read_frontend("tv.css"))


def test_elo_scope_labels_exist_and_are_used():
    i18n = _read_frontend("i18n.js")
    for key in ("txt_elo_club_label", "txt_export_col_elo_club", "txt_player_entry_elo_delta"):
        assert i18n.count(f'"{key}"') == 2, key
    assert "elo_scope" in _read_frontend("tv.js")
    assert "elo_scope" in _read_frontend("admin-export.js")
    assert "txt_player_entry_elo_delta" in _read_frontend("player.js")
    assert "`ELO ${sign}${delta}`" not in _read_frontend("player.js")


# ── Admin on phones (360-430px): control sizes, score rows, nav, tables ────


def _touch_block(css: str) -> str:
    """The late `(max-width: 900px)` block that owns admin control sizing."""
    return _phone_block(css, "@media (max-width: 900px) {\n  .btn { min-height: var(--tap-md); }")


def test_admin_touch_sizes_come_from_one_tap_scale():
    theme = _read_frontend("theme.css")
    for token in ("--tap-lg: 44px;", "--tap-md: 40px;", "--tap-sm: 36px;"):
        assert token in theme, token
    css = _read_frontend("admin.css")
    block = _touch_block(css)
    small = block[: block.index("{ min-height: var(--tap-sm); }")]
    for sel in (".btn-sm,", ".match-filter-toggle button,", ".group-nav-btn,", ".match-edit-btn,", ".btn-ghost,"):
        assert sel in small, sel
    assert "[data-score-save],\n  .btn-lg-action { min-height: var(--tap-lg); }" in block
    # The early phone block no longer re-declares button heights.
    early = _phone_block(css, "@media (max-width: 600px) {\n  body { padding: 0.5rem; }")
    for gone in (
        "\n  .btn { min-height",
        "\n  .btn-sm { min-height",
        ".match-edit-btn { min-height",
        ".group-nav-btn { min-height",
    ):
        assert gone not in early, gone
    assert ".btn-sm { padding: 0.35rem 0.7rem; font-size: var(--fs-sm); }" in css


def test_points_score_row_is_one_aligned_line_on_phones():
    css = _read_frontend("admin.css")
    early = _phone_block(css, "@media (max-width: 600px) {\n  body { padding: 0.5rem; }")
    assert ".match-actions { width: 100%; flex-wrap: nowrap; gap: var(--space-2); }" in early
    assert ".match-actions > .score-entry:not(.score-entry-sets) { flex: 1 1 auto; display: flex;" in early
    assert ".match-actions .score-input-narrow { flex: 1 1 0; max-width: 4.5rem; }" in early
    assert ".match-actions [data-score-save] { margin-left: auto; }" in early
    assert ".match-actions:has(> .score-entry-sets:not(.hidden))," in early
    assert (
        ".match-tbd-disabled .match-actions,\n  .match-tbd-disabled .match-comment-banner { display: none; }" in early
    )
    # One shared renderer still draws every format's score inputs.
    gp = _read_frontend("admin-gp.js")
    assert gp.count("function _renderScoreInputs(") == 1


def test_long_settings_tab_strip_is_a_four_column_grid_on_narrow_phones():
    css = _read_frontend("admin.css")
    block = _phone_block(css, "@media (max-width: 420px) {\n  /* Narrow phones: a strip with six or more tabs")
    assert ".settings-subtabs:has(> .settings-subtab-btn:nth-child(6)) {" in block
    assert "grid-template-columns: repeat(4, minmax(0, 1fr));" in block
    assert "overflow-x" not in block and "nowrap" not in block


def test_action_rows_share_one_pattern():
    css = _read_frontend("admin.css")
    assert ".action-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }" in css
    assert ".action-row--split > :first-child:not(:only-child) { margin-right: auto; }" in css
    touch = _touch_block(css)
    assert ".action-row--end { justify-content: flex-end; }" in touch
    assert ".court-chip-delete { width: var(--tap-sm); height: var(--tap-sm);" in touch
    assert ".action-row--fill > * { flex: 1 1 0; min-width: 0; }" in css
    assert ".action-row--stack { flex-direction: column; align-items: stretch; }" in css
    assert ".courts-editor-input { flex: 1 1 auto; width: auto; min-width: 6rem; }" in css
    tv = _read_frontend("admin-tv-email.js")
    assert tv.count("action-row action-row--end") == 4
    assert tv.count("action-row action-row--stack") == 2
    # Banner: secondary (Remove) first, primary (Save) last.
    banner = tv[tv.index("mt-1-5 action-row action-row--end") :]
    assert banner.index("_clearTournamentBanner()") < banner.index("_setTournamentBanner()")
    mex = _read_frontend("admin-mex.js")
    assert '<div class="advanced-save-row action-row action-row--end">' in mex
    courts = mex[mex.index('<div class="courts-editor-actions action-row action-row--split">') :]
    assert courts.index("_addEditorCourt(") < courts.index("_cancelCourtEditor()") < courts.index("_saveCourtEditor(")
    assert 'aria-label="Remove">&times;' not in mex
    assert '<div class="export-actions-row action-row action-row--fill">' in _read_frontend("admin-export.js")
    shared = _read_frontend("shared.js")
    for icon in ("    x:", "    flag:", "    arrowleft:", "    arrowright:"):
        assert icon in shared, icon


def test_secondary_actions_are_quiet_and_use_stroke_icons():
    gp = _read_frontend("admin-gp.js")
    form = gp[gp.index("function _renderEditForm") : gp.index("function _canClearMatchResult")]
    assert '<div class="action-row action-row--split">' in form
    assert 'btn btn-sm btn-outline-danger" onclick="_clearMatchResult(\'${m.id}\')"' in form
    assert (
        "class=\"btn btn-sm btn-outline\" onclick=\"_cancelEditMatch('${m.id}')\">${t('txt_txt_cancel')}</button>"
        in form
    )
    assert "✕" not in form and 'btn-danger"' not in form
    edit = gp[gp.index("const editBtn = () => {") : gp.index("if (m.status === 'completed')")]
    assert "${_ic('edit')}</button>" in edit and 'aria-label="${label}" title="${label}"' in edit
    assert "${t('txt_txt_start_playoffs')} ${_ic('arrowright')}" in gp
    mex = _read_frontend("admin-mex.js")
    assert "&#9632;" not in mex and "${_ic('flag')} ${t('txt_txt_end_mexicano')}" in mex
    assert "${_ic('check')} ${t('txt_txt_finish_as_is')}" in mex
    assert "${_ic('arrowleft')} ${t('txt_txt_back_to_mexicano')}" in mex
    utils = _read_frontend("admin-utils.js")
    assert "aria-label=\"${escAttr(t('txt_admin_bracket_tune_btn'))}\"" in utils
    assert "<span class=\"btn-label\">${esc(t('txt_admin_bracket_tune_btn'))}</span>" in utils
    css = _read_frontend("admin.css")
    assert ".admin-bracket-tune-btn .btn-label { display: none; }" in css
    assert ".settings-help-master-toggle { background: transparent; border-color: transparent;" in _touch_block(css)


def test_match_card_has_meta_teams_actions_lines_on_phones():
    gp = _read_frontend("admin-gp.js")
    banner = gp[gp.index("function _renderCommentBanner(") : gp.index("function _renderScoreDisplay(")]
    assert "match-comment-banner--empty" in banner
    assert '<button type="button" class="match-comment-add"' in banner
    assert 'aria-label="${addLabel}"' in banner and "const addLabel = escAttr(t('txt_match_add_comment'));" in banner
    assert '<span class="match-comment-add"' not in banner
    assert '<div class="card po-round-card" id="po-round-card-${escAttr(key)}">' in gp
    css = _read_frontend("admin.css")
    early = _phone_block(css, "@media (max-width: 600px) {\n  body { padding: 0.5rem; }")
    assert ".match-card-wrap > .match-round-badge { order: 1;" in early
    assert ".match-card-wrap > .match-court { order: 2;" in early
    assert ".match-card-wrap > .match-comment-banner--empty { order: 3;" in early
    assert ".match-card-wrap > .match-teams { order: 4; }" in early
    assert ".match-card-wrap > .match-edit-btn { order: 6; margin-left: auto; }" in early
    # The generic banner order is declared before the empty-banner override.
    assert early.index(".match-card-wrap > .match-comment-banner { order: 8; }") < early.index(
        ".match-card-wrap > .match-comment-banner--empty { order: 3;"
    )
    assert ".po-round-card .match-round-badge { display: none; }" in early


def _css_rule(css: str, selector: str) -> str:
    """Body of the first `selector { ... }` rule in css."""
    start = css.index(selector + " {")
    return css[start : css.index("}", start)]


def test_sticky_nav_is_one_row():
    gp = _read_frontend("admin-gp.js")
    assert gp.count('<div class="group-nav-chips">') == 2
    for bar_id in ("gp-group-nav", "po-round-nav"):
        start = gp.index(f'<div class="group-nav-bar" id="{bar_id}">`;')
        chunk = gp[start : start + 1200]
        assert (
            chunk.index('<div class="group-nav-chips">')
            < chunk.index("group-nav-btn")
            < chunk.index('<span class="group-nav-sep"')
        ), bar_id
    css = _read_frontend("admin.css")
    assert ".group-nav-chips { display: contents; }" not in css
    chips = _css_rule(css, ".group-nav-chips")
    assert "flex: 1 1 0;" in chips and "min-width: 0;" in chips and "overflow-x: auto;" in chips
    bar = _css_rule(css, ".group-nav-bar")
    assert "flex-wrap: nowrap;" in bar and "overflow-x" not in bar
    assert "#mex-ops-header ~ .group-nav-bar { position: static; }" in css
    early = _phone_block(css, "@media (max-width: 600px) {\n  body { padding: 0.5rem; }")
    assert "flex-wrap: wrap" not in early[early.index("  .group-nav-bar {") :][:200]
    assert ".group-nav-bar .match-filter-toggle { display: none; }" in early
    assert "min-height: var(--tap-sm);" in early[early.index(".group-nav-bar .match-filter-select") :][:200]
    # The bar stays the sticky element and the offset is measured, not assumed.
    utils = _read_frontend("admin-utils.js")
    assert "return el.getBoundingClientRect().height;" in utils
    assert 'aria-label="Match filter"' not in utils
    assert 'aria-label="${label}"' in utils
    assert "const label = escAttr(t('txt_admin_match_filter_label'));" in utils
    assert _read_frontend("i18n.js").count('"txt_admin_match_filter_label"') == 2
    # Edge fades follow the chip strip's scroll state.
    assert "function _syncNavChipsOverflow(el)" in utils
    assert '.group-nav-chips[data-overflow="both"]' in css


def test_match_filter_has_phone_select_synced_with_toggle():
    utils = _read_frontend("admin-utils.js")
    assert '<select class="match-filter-select' in utils
    assert 'onchange="_preserveScrollPosition(() => _applyMatchFilter(this.value))"' in utils
    assert 'role="group"' in utils and 'role="tablist"' not in utils
    gp = _read_frontend("admin-gp.js")
    assert "root.querySelectorAll('.match-filter-select')" in gp
    assert "sel.value = filter;" in gp


def test_group_chip_shows_bare_name_with_full_label_in_title():
    gp = _read_frontend("admin-gp.js")
    assert "const full = t('txt_txt_group_name_value', { value: gName });" in gp
    assert 'title="${escAttr(full)}" aria-label="${escAttr(full)}"' in gp
    assert ">${esc(gName)}</button>" in gp


def test_player_codes_table_stacks_into_cards_on_phones():
    js = _read_frontend("admin-player-codes.js")
    assert '<table class="player-codes-table table-stack">' in js
    assert '<td class="player-codes-name stack-title" id="pc-name-${pid}">' in js
    assert '<td class="player-codes-cell stack-pri" data-label="${lblPass}">' in js
    assert '<td class="player-codes-cell stack-full" data-label="${lblContact}">' in js
    assert js.count("stack-act") == 4
    # Handlers are untouched.
    for handler in (
        "_savePlayerContact('${pid}')",
        "_hubOpenSearch(",
        "_showPlayerQr(",
        "_regeneratePlayerCode('${pid}')",
    ):
        assert handler in js, handler
    css = _read_frontend("admin.css")
    assert ".player-codes-table.table-stack td.stack-act { order: 3; flex: 0 0 auto; }" in css
    # The shared stacked-table block is reused unchanged (clubs still uses it three times).
    assert _read_frontend("admin-clubs.js").count('<table class="player-codes-table table-stack">') == 3


def test_decision_zone_groups_courts_and_decisions():
    gp = _read_frontend("admin-gp.js")
    mex = _read_frontend("admin-mex.js")
    for js, section in ((gp, '<div id="gp-playoffs-section">'), (mex, '<div id="mex-next-section">')):
        start = js.index(section)
        zone = js[start : start + 1400]
        assert '<div class="decision-zone">' in zone
        assert (
            zone.index('<div class="decision-zone">')
            < zone.index("_renderCourtsSection(")
            < zone.index('<div class="decision-actions-row">')
        )
    # End Mexicano is a quiet secondary under the primary decision.
    nxt = mex[mex.index('<div id="mex-next-section">') :]
    nxt = nxt[: nxt.index("// decision-zone")]
    assert '<div class="action-row action-row--fill decision-secondary">' in nxt
    assert 'class="btn btn-outline btn-lg-action"${_decisionDisabledAttrs(endReason)}' in nxt
    assert "btn btn-primary btn-lg-action" not in nxt
    assert '<div id="mex-playoffs-section" class="card decision-zone">' in mex
    for label in ("txt_txt_finish_as_is", "txt_txt_back_to_mexicano"):
        line = next(ln for ln in mex.splitlines() if f"t('{label}')" in ln and "<button" in ln)
        assert "btn btn-outline btn-lg-action" in line, label
    # Play-offs: the courts strip moved down into the same slot.
    po = gp[gp.index("async function renderPO(") :]
    po = po[: po.index("_renderSettingsCard(")]
    assert po.index("_renderPlayoffMatchesByRound(") < po.index('<div class="decision-zone">${_renderCourtsSection(')
    css = _read_frontend("admin.css")
    assert ".btn-lg-action { padding: 0.6rem 1rem; font-size: 1rem; }" in css
    touch = _touch_block(css)
    assert ".decision-zone {" in touch and ".card-title {" in touch


def test_card_headers_share_one_title_style():
    gp = _read_frontend("admin-gp.js")
    mex = _read_frontend("admin-mex.js")
    utils = _read_frontend("admin-utils.js")
    assert "<h3 class=\"card-heading-row card-title\">${t('txt_txt_group_name_value'" in gp
    assert gp.count('<div class="gp-review-queue-head card-heading-row">') == 2
    assert '<div class="gp-review-queue-head card-heading-row">' in mex
    assert '<div class="court-board-header card-heading-row"><h3 class="card-title">' in mex
    assert '<div class="current-round-header card-heading-row">' in mex
    assert "<h2 class=\"card-heading-row card-title\">${t('txt_txt_leaderboard')}" in mex
    assert "<h3 class=\"card-heading-row card-title\">${t('txt_txt_previous_rounds')}</h3>" in mex
    assert '<div class="admin-bracket-header card-heading-row">' in utils
    # Old header classes stay as aliases for their existing styles.
    css = _read_frontend("admin.css")
    for alias in (".court-board-header {", ".admin-bracket-card .admin-bracket-header {", ".current-round-header {"):
        assert alias in css, alias


def test_mexicano_advanced_summary_is_plain_and_translated():
    mex = _read_frontend("admin-mex.js")
    section = mex[mex.index("function _renderMexSettingsSection(") :]
    section = section[: section.index('let html = `<details class="advanced-section">`;')]
    for gone in ("gap: ${", "bonus: ${", "str: ${", "disc: ${"):
        assert gone not in section, gone
    for key in (
        "txt_mex_adv_summary_rounds",
        "txt_mex_adv_summary_rounds_unlimited",
        "txt_mex_adv_summary_scoring_default",
        "txt_mex_adv_summary_scoring_custom",
    ):
        assert f"'{key}'" in section, key
        assert _read_frontend("i18n.js").count(f'"{key}"') == 2, key


def test_service_worker_cache_bumped_for_admin_phone_pass(client):
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version and int(version.group(1)) >= 107


def test_phone_header_is_one_labelled_row():
    """Phones: Tournaments / New (icon-only) and the account buttons share one
    row; each account button shows a one-word label under its icon, Logout
    included, with the full name as title / aria-label."""
    auth = _read_frontend("auth.js")
    ui = auth[auth.index("function updateAuthUI(") :]
    ui = ui[: ui.index("\n}\n")]
    assert '<span class="nav-btn-short" aria-hidden="true">${esc(short)}</span>' in ui
    assert 'title="${escAttr(full)}" aria-label="${escAttr(full)}"' in ui
    assert "t('txt_admin_nav_short_communities')" in ui and "t('txt_admin_nav_short_password')" in ui
    assert "<span class=\"nav-btn-phone-ic\">${_ic('logout')}</span>" in ui
    assert 'title="Communities"' not in ui
    assert "    logout:" in _read_frontend("shared.js")
    i18n = _read_frontend("i18n.js")
    for key in ("txt_admin_nav_short_communities", "txt_admin_nav_short_password"):
        assert i18n.count(f'"{key}"') == 2, key
    css = _read_frontend("admin.css")
    assert ".nav-btn-short,\n.nav-btn-phone-ic { display: none; }" in css
    phone = css[css.index("  /* Phone header, two lines:") :]
    phone = phone[: phone.index("  /* Create: the four format tabs")]
    assert ".page-header-row--nav { flex-wrap: nowrap;" in phone
    assert ".auth-nav-icons { display: contents; }" in phone
    btn = phone[phone.index("  #auth-status .btn.auth-nav-btn {") :]
    btn = btn[: btn.index("}")]
    assert "flex-direction: column;" in btn and "max-width: 4.5rem;" in btn
    assert "#auth-status .nav-btn-short {" in phone and "text-overflow: ellipsis;" in phone
    assert "#auth-status .nav-btn-label { display: none; }" in phone
    # The old three-line layout (centred icon line, Logout ordered last) is gone.
    assert "flex: 1 0 100%;" not in phone and "order: 3" not in phone
    # Header nav keeps the 44px target on tablets.
    assert ".auth-nav-btn { min-height: var(--tap-lg); }" in _touch_block(css)


_GLYPH_ICON_RE = re.compile(
    r">\s*[✓✔✕✖✗×←→↻■▶]"  # glyph as the first thing inside an element
    r"|[✓✔✕✖✗←↻■▶] \$\{"  # glyph prefixing a translated label
    r"|textContent = '[✓✔✕✖✗×]'"
    r"|\? '[✓✔✕✖✗]'"
    r"|&times;|&#10003;|&#10005;|&#215;|&#9632;|&#9654;|&rarr;|&larr;"
)


@pytest.mark.parametrize(
    "name",
    sorted(p.name for p in (Path(__file__).parent.parent / "frontend").glob("admin-*.js")) + ["auth.js", "index.html"],
)
def test_admin_buttons_use_svg_icons_not_text_glyphs(name):
    """Ticks, crosses and arrows on admin buttons and badges are _ic() / inline
    stroke SVGs. Content stays: multipliers ("×1.2", "2×4"), bracket sequences
    and "→ Group" select options, and arrows inside translated sentences."""
    offenders = []
    for line in _read_frontend(name).splitlines():
        if line.strip().startswith(("//", "*", "/*", "<!--")):
            continue
        # Content, not icons: "2×4" presets, "→ Group B" <option> text.
        if 'class="schema-preset-btn"' in line or "<option value=" in line:
            continue
        if _GLYPH_ICON_RE.search(line):
            offenders.append(line.strip()[:100])
    assert offenders == []


def test_glyph_replacement_icons_exist():
    shared = _read_frontend("shared.js")
    for icon in ("    x:", "    check:", "    chevright:", "    arrowleft:", "    refresh:"):
        assert icon in shared, icon


# ── Participant withdrawal (Settings → Players) ─────────────────────────────


def test_withdraw_dialog_island_markup_and_mount(client):
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    assert '<div id="withdraw-overlay" class="modal-overlay">' in html
    island = html.split('id="withdraw-overlay"', 1)[1].split("<!-- Forgot Password Modal -->", 1)[0]
    assert "v-scope" in island
    assert '@click="confirm()"' in island and ':disabled="!canConfirm"' in island
    assert 'v-model.number="points[0]"' in island and 'v-model.number="row[0]"' in island
    js = client.get("/admin-player-codes.js", headers={"Accept-Encoding": "identity"}).text
    assert "const _wdStore = reactiveStore(" in js
    assert "mountIsland('#withdraw-overlay .modal-dialog', _wdStore)" in js
    assert "/withdrawals/preview?player_id=" in js


def test_players_tab_uses_users_icon():
    js = _read_frontend("admin-settings-panel.js")
    assert (
        "key: 'codes',   short: t('txt_settings_tab_codes_short'), label: t('txt_admin_settings_tab_codes'),   icon: _ic('users')"
        in js
    )


def test_walkover_rendering_in_views():
    assert "m.walkover" in _read_frontend("admin-gp.js")
    assert "history-badge-walkover" in _read_frontend("tv.js")
    assert "row.walkover" in _read_frontend("player.js")
    assert "txt_export_score_walkover" in _read_frontend("admin-export.js")


def test_walkover_label_has_its_own_slot_left_of_the_score():
    # The W/O label comes before the score in a reserved slot, so walkover scores
    # line up with the other rows in every view.
    assert '<span class="history-wo-cell">${walkoverBadge}${scoreHtml}</span>' in _read_frontend("tv.js")
    assert ".history-wo-cell { position: relative; display: inline-flex; padding-left: var(--space-12); }" in (
        _read_frontend("tv.css")
    )
    gp = _read_frontend("admin-gp.js")
    assert '<span class="match-wo-cell">${_renderWalkoverBadge(loser)}<span class="${disp.cls}"' in gp
    assert 'class="match-edit-btn match-slot-reserve" tabindex="-1" aria-hidden="true" disabled' in gp
    admin_css = _read_frontend("admin.css")
    assert (
        "padding-left: var(--space-12); }" in admin_css and ".match-slot-reserve { visibility: hidden; }" in admin_css
    )
    assert '<div class="entry-path-score-center entry-path-score-center--wo"><span class="badge badge-walkover"' in (
        _read_frontend("player.js")
    )
    assert ".entry-path-score-center--wo { position: relative; padding-inline: var(--space-12); }" in (
        _read_frontend("player.css")
    )
    export = _read_frontend("admin-export.js")
    assert "_wo_headers" not in export and "_wo_cells" not in export
    assert "(${t('txt_export_score_walkover')})" not in export


def test_hub_walkover_tip_names_the_side_that_withdrew():
    # The tip must name the player's own side when they are the one who withdrew.
    assert "(row.walkover_lost ? playerTeamNames : opponentNames)" in _read_frontend("player.js")


def test_tv_withdrawn_name_strikes_through_the_name_button():
    # The TV name is an inline-block button: text-decoration does not reach it from the span.
    assert ".withdrawn-name .tv-name-btn { text-decoration: line-through; }" in _read_frontend("tv.css")


def test_withdraw_error_text_checks_eliminated_before_finished():
    # The server's "already eliminated or has finished its bracket" message also matches /finished/.
    body = _read_frontend("admin-player-codes.js").split("function _wdErrorText(", 1)[1].split("\n}\n", 1)[0]
    assert body.index("/eliminated|not in the play-offs/i") < body.index("/finished/i")


def test_withdrawal_i18n_keys_in_both_languages(client):
    js = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    keys = [
        "txt_withdraw_btn",
        "txt_withdraw_team_btn",
        "txt_withdraw_title",
        "txt_withdraw_partner_note",
        "txt_withdraw_played",
        "txt_withdraw_rule_annul",
        "txt_withdraw_results_stand",
        "txt_withdraw_remaining_wo",
        "txt_withdraw_rule_exclude",
        "txt_withdraw_dropped_match",
        "txt_withdraw_group_too_small",
        "txt_withdraw_rule_forfeit",
        "txt_withdraw_forfeit_now",
        "txt_withdraw_forfeit_tbd",
        "txt_withdraw_lb_note",
        "txt_withdraw_third_place_note",
        "txt_withdraw_walkover_score",
        "txt_withdraw_score_invalid",
        "txt_withdraw_elo_note",
        "txt_withdraw_blocked",
        "txt_withdraw_blocker_pending",
        "txt_withdraw_blocker_disputed",
        "txt_withdraw_blocker_format_review",
        "txt_withdraw_no_undo",
        "txt_withdraw_confirm_annul",
        "txt_withdraw_confirm_walkover",
        "txt_withdraw_confirm_exclude",
        "txt_withdraw_confirm_forfeit",
        "txt_withdrawn_badge",
        "txt_withdrawn_annulled_note",
        "txt_withdraw_undo",
        "txt_withdraw_undo_confirm",
        "txt_walkover_short",
        "txt_walkover_tip",
        "txt_export_score_walkover",
        "txt_withdraw_unavailable_finished",
        "txt_withdraw_unavailable_eliminated",
        "txt_mex_use_withdraw_in_playoffs",
        "txt_withdraw_err_tiebreak",
        "txt_withdraw_err_winner_sets",
        "txt_withdraw_err_winner_points",
        "txt_withdraw_err_set_tied",
        "txt_withdraw_err_score",
        "txt_withdraw_mixed_deciders",
        "txt_rnd_to_final",
        "txt_rnd_to_other",
        "txt_rnd_m_final",
        "txt_rnd_m_other",
    ]
    for key in keys:
        assert js.count(f'"{key}"') == 2, key
    assert '"txt_settings_tab_codes_short": "Jugadores"' in js
    assert "Player Codes panel" not in js


def test_withdraw_dialog_labels_and_validates_set_3_from_the_matches_deciders(client):
    js = _read_frontend("admin-player-codes.js")
    # One editor, driven by the deciders the preview lists for the affected matches.
    assert "get thirdSetDecider()" in js and "deciders_needed" in js
    assert "needed.includes('match_tiebreak')" in js
    assert "isMatchTiebreakSet(rows, 2, this.thirdSetDecider)" in js
    assert "i === 2 && this.thirdSetDecider === 'match_tiebreak'" in js
    # Each match's walkover score is bracketed by its own decider.
    assert "formatSetScore(this.setRows, m.decider || this.p?.default_decider, ' ')" in js
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    assert "v-if=\"hasMode('sets') && mixedDeciders\"" in html


def test_withdraw_422_messages_are_translated():
    body = _read_frontend("admin-player-codes.js").split("function _wdErrorText(", 1)[1].split("\n}\n", 1)[0]
    for key in ("tiebreak", "winner_sets", "winner_points", "set_tied", "score"):
        assert f"txt_withdraw_err_{key}" in body


def test_withdraw_button_hidden_when_the_bracket_is_over():
    js = _read_frontend("admin-player-codes.js")
    assert "status?.withdraw_unavailable_ids" in js
    cell = js.split("function _renderWithdrawCell(", 1)[1].split("\n}\n", 1)[0]
    assert "_wdUnavailableIds.has(pid)" in cell
    assert cell.index("_wdUnavailableIds.has(pid)") < cell.index("_openWithdrawDialog(")


def test_playoff_picker_greys_out_withdrawn_entries():
    gp = _read_frontend("admin-gp.js")
    # Kept in the list (not filtered out), disabled, badged.
    assert "_gpRecommended = data.recommended_participants || [];" in gp
    assert "filter(r => !r.withdrawn)" in gp
    assert "gp-advancing-cb\"${checked}${wd ? ' disabled' : ''}" in gp
    assert "gp-player-row--withdrawn" in gp and "badge-withdrawn" in gp
    assert "data-split-pid" in gp and "${wd ? ' disabled' : ''} onchange=\"_gpSplitSet" in gp
    assert ".gp-player-row--withdrawn { opacity: 0.6; cursor: not-allowed; }" in _read_frontend("admin.css")


def test_spanish_round_names_get_articles():
    js = _read_frontend("i18n.js")
    for key, es in (
        ("final", "a la final"),
        ("semi", "a la semifinal"),
        ("third", "al tercer puesto"),
        ("quarter", "a los cuartos de final"),
    ):
        assert f'"txt_rnd_to_{key}": "{es}"' in js
    assert '"txt_rnd_m_final": "la final"' in js and '"txt_rnd_m_third": "el tercer puesto"' in js
    assert '"{opponent} pasa {round} por W.O."' in js and '"{opponent} gana {round} por W.O."' in js
    # English keeps the bare engine label.
    assert '"txt_rnd_to_final": "Final"' in js and '"txt_rnd_m_semi": "Semi-Final"' in js
    codes = _read_frontend("admin-player-codes.js")
    assert "this.roundPhrase(this.p.advance_to, 'to')" in codes
    assert "this.roundPhrase(m.round_label, 'match')" in codes
    assert "function trlPhrase(label, kind)" in _read_frontend("shared.js")


def test_mobile_walkover_label_moves_to_the_meta_line():
    gp = _read_frontend("admin-gp.js")
    # The head copy sits right after the court, before the score cell.
    assert gp.index('<span class="match-wo-head">') < gp.index('<span class="match-wo-cell">')
    css = _read_frontend("admin.css")
    assert ".match-wo-head { display: none; }" in css  # desktop keeps the slot left of the score
    block = css.split("/* Three-line card: the label leaves", 1)[1].split("\n}\n", 1)[0]
    assert ".match-wo-cell > .badge-walkover { display: none; }" in block
    assert ".match-card-wrap > .match-wo-head { display: inline-flex; align-items: center; order: 2; }" in css
    assert ".match-card-wrap > .match-round-badge ~ .match-wo-head::before" in css
    assert ".po-round-card .match-card-wrap > .match-wo-head::before" in css


def test_withdraw_counts_have_singular_variants(client):
    js = client.get("/i18n.js", headers={"Accept-Encoding": "identity"}).text
    assert '"txt_withdraw_remaining_wo_one": "el partido restante se da por W.O."' in js
    assert '"txt_withdraw_remaining_wo_one": "1 remaining match becomes a walkover (W/O)."' in js
    for key in (
        "txt_withdraw_played_one",
        "txt_withdraw_rule_annul_one",
        "txt_withdraw_results_stand_one",
        "txt_withdraw_group_too_small_one",
    ):
        assert js.count(f'"{key}"') == 2, key
    codes = _read_frontend("admin-player-codes.js")
    assert "n === 1 ? 'txt_withdraw_remaining_wo_one'" in codes
    assert "n === 1 ? 'txt_withdraw_rule_annul_one'" in codes
    html = client.get("/legacy-admin", headers={"Accept-Encoding": "identity"}).text
    assert "txt_withdraw_played_one" in html and "txt_withdraw_group_too_small_one" in html


def test_export_walkover_label_sits_in_the_score_cell():
    export = _read_frontend("admin-export.js")
    assert """<span class="wo">${esc(t('txt_export_score_walkover'))}</span>""" in export
    assert "c && typeof c === 'object' && 'html' in c ? c.html : esc(String(c))" in export
    assert "    .wo { margin-left: 6px;" in export


def test_walkover_loser_is_struck_through_in_html_views():
    tv = _read_frontend("tv.js")
    assert "const woLoser = m.walkover && m.score ? (m.score[0] > m.score[1] ? 2 : 1) : 0;" in tv
    assert """`<span class="withdrawn-name">${esc(name)}</span>`""" in tv
    hub = _read_frontend("player.js")
    assert (
        "entry-path-team-name--withdrawn" in hub
        and "wdCls(row.walkover_lost)" in hub
        and "wdCls(!row.walkover_lost)" in hub
    )
    assert ".entry-path-team-name--withdrawn { text-decoration: line-through;" in _read_frontend("player.css")
    # Admin rows already strike only the loser.
    gp = _read_frontend("admin-gp.js")
    assert (
        "w1 ? 'team-winner' : 'team-loser withdrawn-name'" in gp
        and "w1 ? 'team-loser withdrawn-name' : 'team-winner'" in gp
    )


def test_cache_name_bumped_for_withdrawals(client):
    sw = client.get("/service-worker.js", headers={"Accept-Encoding": "identity"}).text
    version = re.search(r"CACHE_NAME = 'amistoso-v(\d+)'", sw)
    assert version and int(version.group(1)) >= 113
