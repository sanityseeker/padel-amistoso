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
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
    dialog = html[html.index('id="auth-dialog"') :]
    dialog = dialog[: dialog.index("<!-- Change Password Modal")]
    after_form = dialog[dialog.index("</form>") :]
    assert "demoView() === 'returning'" in after_form
    assert '@click="startDemo()"' in after_form
    assert "txt_demo_start_new_instead" in after_form


def test_head_redirect_skips_start_demo_hash(client):
    """The pinned-home redirect in <head> must not swallow #start-demo."""
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
    head = html[: html.index("</head>")]
    assert "window.location.hash === '#start-demo'" in head


def test_auth_js_handles_start_demo_hash(client):
    """auth.js auto-mints on #start-demo once per tab and strips the hash."""
    js = client.get("/auth.js", headers={"Accept-Encoding": "identity"}).text
    assert "function maybeAutoStartDemo()" in js
    assert "'#start-demo'" in js
    assert "replaceState" in js
    assert "'padel-demo-autostart'" in js
    # Only the username is remembered, and clearAuth() must not drop it.
    assert "'padel-demo-last'" in js
    clear_auth = js[js.index("function clearAuth()") :]
    clear_auth = clear_auth[: clear_auth.index("\n}\n")]
    assert "DEMO_LAST_KEY" not in clear_auth
    utils = client.get("/admin-utils.js", headers={"Accept-Encoding": "identity"}).text
    assert "maybeAutoStartDemo()" in utils
    assert "configLoaded = true" in utils


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
    html = client.get("/register", headers={"Accept-Encoding": "identity"}).text
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


def test_match_row_emits_format_chip_and_row_toggle(client):
    """matchRow renders the per-match format chip and the client-only Points/Sets toggle."""
    js = client.get("/admin-gp.js", headers={"Accept-Encoding": "identity"}).text
    assert "match-format-btn" in js
    assert "_openMatchFormatPopover(" in js
    assert "function _renderScoreInputs(" in js
    assert "function _renderDisputePanel(" in js
    assert "function _renderCommentBanner(" in js
    assert "function _isSetCtx(" in js
    assert "_renderMatchModeToggle(" in js
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
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
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
    for path in ("/admin-gp.js", "/tv.js", "/player.js", "/club.js", "/admin-mex.js"):
        js = client.get(path, headers={"Accept-Encoding": "identity"}).text
        assert "formatSetScore(" in js, path
        assert "sets.map(s => `${s[0]}-${s[1]}`)" not in js, path


def test_format_popover_has_decider_bindings(client):
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
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
    # Both the submit form and the correction form share the decider-aware rows.
    assert js.count("_tvRenderSetRows(") == 3


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
    html = client.get("/", headers={"Accept-Encoding": "identity"}).text
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
    html = client.get("/register", headers={"Accept-Encoding": "identity"}).text
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
