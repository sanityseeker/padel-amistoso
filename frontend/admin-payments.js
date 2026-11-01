// ─── Payments panel (Petite-Vue island) ──────────────────────────────────
//
// One shared island for registration lobbies and tournaments: fee settings
// (inline editor), the per-player payments table whose status chip is the editor
// (choosing "paid" asks for the method), an unpaid/reported/all filter, a "Remind unpaid"
// action and a "Refunds pending" section. The lobby settings page reuses the
// settings editor alone (`_renderPaymentSettingsIsland`).
//
// Stores are keyed per `${kind}:${id}` so re-renders of the surrounding
// legacy `innerHTML` views simply remount the island onto the fresh root and
// keep their data (mountIsland guards per element).

const _payStores = {};
const _PAY_KINDS = ['bizum', 'iban', 'revolut', 'paypal_me', 'cash', 'other'];
const _PAY_STATUSES = ['unpaid', 'reported', 'paid', 'waived', 'refund_due', 'refunded'];
const _PAY_QUICK_METHODS = ['cash', 'bizum', 'transfer', 'other'];

function _payStoreKey(kind, id) { return `${kind}:${id}`; }

function _payBaseUrl(kind, id) {
  return `/api/${kind === 'tournament' ? 'tournaments' : 'registrations'}/${encodeURIComponent(id)}`;
}

/** Settings → editable draft (fee as a decimal string for the input). */
function _paySettingsToDraft(s) {
  const settings = s || {};
  return {
    fee: settings.fee_cents ? (settings.fee_cents / 100).toFixed(2) : '',
    currency: settings.currency || 'EUR',
    due_at: settings.due_at || '',
    instructions: settings.instructions || '',
    methods: (settings.methods || []).map(m => ({ kind: m.kind, value: m.value || '', label: m.label || '' })),
    show_methods: settings.show_methods || 'after_register',
  };
}

/** Draft → PATCH body (full object so removed methods are dropped server-side). */
function _payDraftToBody(d) {
  const fee = Math.round(parseFloat(String(d.fee).replace(',', '.')) * 100);
  return {
    fee_cents: Number.isFinite(fee) && fee > 0 ? fee : 0,
    currency: (d.currency || 'EUR').trim().toUpperCase().slice(0, 3) || 'EUR',
    due_at: d.due_at || null,
    instructions: (d.instructions || '').trim() || null,
    methods: d.methods
      .filter(m => _PAY_KINDS.includes(m.kind) && (m.value.trim() || m.kind === 'cash'))
      .map(m => ({ kind: m.kind, value: m.value.trim(), label: m.label.trim() || null })),
    show_methods: d.show_methods === 'always' ? 'always' : 'after_register',
  };
}

function _payCreateStore(kind, id) {
  const S = reactiveStore({
    kind,
    id,
    loaded: false,
    loading: false,
    error: '',
    settings: null,
    rows: [],
    summary: null,
    entityName: '',
    filter: 'all',
    settingsOpen: false,
    draft: _paySettingsToDraft(null),
    savingSettings: false,
    settingsSaved: false,
    markingFor: null,
    busyFor: null,
    reminding: false,
    remindResult: null,
    kinds: _PAY_KINDS,
    statuses: _PAY_STATUSES,
    quickMethods: _PAY_QUICK_METHODS,

    // ── derived ──
    hasFee() { return !!(S.settings && S.settings.fee_cents > 0); },
    fmt(cents, currency) { return formatMoney(cents, currency || (S.settings && S.settings.currency)); },
    statusLabel(status) { return t(`txt_pay_status_${status}`); },
    kindLabel(kind) { return t(`txt_pay_kind_${kind}`); },
    quickMethodLabel(m) { return t(`txt_pay_method_${m}`); },
    summaryText() {
      const s = S.summary || {};
      return t('txt_pay_summary', {
        paid: s.paid || 0,
        total: s.total || 0,
        collected: S.fmt(s.collected_cents || 0),
      });
    },
    activeRows() { return S.rows.filter(r => r.status !== 'refund_due' && r.status !== 'refunded'); },
    visibleRows() {
      const rows = S.activeRows();
      if (S.filter === 'unpaid') return rows.filter(r => r.status === 'unpaid');
      if (S.filter === 'reported') return rows.filter(r => r.status === 'reported');
      return rows;
    },
    refundRows() { return S.rows.filter(r => r.status === 'refund_due' || r.status === 'refunded'); },
    pendingCount() { return S.rows.filter(r => r.status === 'unpaid' || r.status === 'reported').length; },
    fmtDate(iso) {
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleString(_currentLang === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' });
      } catch (_) { return iso; }
    },
    canRemind() { return !!window._emailConfigured && S.hasFee() && S.pendingCount() > 0; },

    // ── data ──
    async load() {
      if (S.loading) return;
      S.loading = true;
      S.error = '';
      try {
        const data = await api(`${_payBaseUrl(S.kind, S.id)}/payments`);
        S.settings = data.settings;
        S.rows = data.rows || [];
        S.summary = data.summary || null;
        S.entityName = data.entity_name || '';
        if (!S.settingsOpen) S.draft = _paySettingsToDraft(data.settings);
        S.loaded = true;
      } catch (e) {
        S.error = e.message || t('txt_pay_error');
      } finally {
        S.loading = false;
      }
    },

    // ── settings editor ──
    openSettings() {
      S.draft = _paySettingsToDraft(S.settings);
      S.settingsOpen = true;
      S.settingsSaved = false;
    },
    cancelSettings() {
      S.settingsOpen = false;
      S.draft = _paySettingsToDraft(S.settings);
    },
    addMethod() { S.draft.methods.push({ kind: 'bizum', value: '', label: '' }); },
    removeMethod(i) { S.draft.methods.splice(i, 1); },
    async saveSettings() {
      if (S.savingSettings) return;
      S.savingSettings = true;
      S.error = '';
      try {
        const saved = await api(`${_payBaseUrl(S.kind, S.id)}/payment-settings`, {
          method: 'PATCH',
          body: JSON.stringify(_payDraftToBody(S.draft)),
        });
        S.settings = saved;
        S.draft = _paySettingsToDraft(saved);
        S.settingsOpen = false;
        S.settingsSaved = true;
        setTimeout(() => { S.settingsSaved = false; }, 2000);
        await S.load();
      } catch (e) {
        S.error = e.message || t('txt_pay_error');
      } finally {
        S.savingSettings = false;
      }
    },

    // ── row actions ──
    // The status chip is the only editor. Choosing "paid" defers the save until a
    // method chip is picked, so every paid row carries how the money arrived.
    changeStatus(pid, status, el) {
      if (status === 'paid') {
        S.markingFor = pid;
        return;
      }
      S.markingFor = null;
      return S.setStatus(pid, status);
    },
    cancelMark() {
      S.markingFor = null;
      S.rows = S.rows.slice(); // re-render so the select snaps back to the stored status
    },
    async setStatus(pid, status, method) {
      if (S.busyFor) return;
      S.busyFor = pid;
      S.error = '';
      const body = { status };
      if (method) body.method = method;
      try {
        const row = await api(`${_payBaseUrl(S.kind, S.id)}/payments/${encodeURIComponent(pid)}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
        const idx = S.rows.findIndex(r => r.player_id === pid);
        if (idx >= 0) S.rows[idx] = row; else S.rows.push(row);
        S.markingFor = null;
        await S.load();
      } catch (e) {
        S.error = e.message || t('txt_pay_error');
      } finally {
        S.busyFor = null;
      }
    },
    markPaid(pid, method) { return S.setStatus(pid, 'paid', method); },
    async remind() {
      if (S.reminding) return;
      if (!confirm(t('txt_pay_remind_confirm'))) return;
      S.reminding = true;
      S.remindResult = null;
      S.error = '';
      try {
        const res = await api(`${_payBaseUrl(S.kind, S.id)}/payments/remind-unpaid`, { method: 'POST', body: '{}' });
        S.remindResult = res;
      } catch (e) {
        S.error = e.message || t('txt_pay_error');
      } finally {
        S.reminding = false;
      }
    },
  });
  return S;
}

function _payGetStore(kind, id) {
  const key = _payStoreKey(kind, id);
  if (!_payStores[key]) _payStores[key] = _payCreateStore(kind, id);
  return _payStores[key];
}

// ─── Templates ────────────────────────────────────────────────────────────

/** Fee settings editor markup (bound to `draft`; used inline and on the lobby settings page). */
function _payRenderSettingsEditor() {
  let html = `<div class="pay-settings-editor">`;
  html += `<p class="settings-help">${t('txt_pay_settings_help')}</p>`;
  html += `<div class="pay-settings-grid">`;
  html += `<label class="pay-field"><span class="settings-label">${t('txt_pay_fee')}</span>`;
  html += `<input type="text" inputmode="decimal" v-model="draft.fee" placeholder="15.00"></label>`;
  html += `<label class="pay-field"><span class="settings-label">${t('txt_pay_currency')}</span>`;
  html += `<input type="text" class="pay-currency-input" maxlength="3" v-model="draft.currency" placeholder="EUR"></label>`;
  html += `<label class="pay-field pay-field--due"><span class="settings-label">${t('txt_pay_due')}</span>`;
  html += `<input type="date" v-model="draft.due_at"></label>`;
  html += `</div>`;
  html += `<label class="pay-field"><span class="settings-label">${t('txt_pay_instructions')}</span>`;
  html += `<textarea rows="2" maxlength="2000" v-model="draft.instructions" placeholder="${escAttr(t('txt_pay_instructions_placeholder'))}"></textarea></label>`;

  html += `<div class="pay-methods-editor">`;
  html += `<span class="settings-label">${t('txt_pay_methods')}</span>`;
  html += `<p class="settings-help pay-visibility-warning">${t('txt_pay_methods_visibility_warning')}</p>`;
  html += `<div class="pay-method-row" v-for="(m, i) in draft.methods" :key="i">`;
  html += `<select v-model="m.kind" :aria-label="t('txt_pay_method_kind')">`;
  html += `<option v-for="k in kinds" :value="k" :selected="k === m.kind">{{ kindLabel(k) }}</option>`;
  html += `</select>`;
  html += `<input type="text" class="pay-method-value" maxlength="512" v-model="m.value" :placeholder="t('txt_pay_method_value')">`;
  html += `<input type="text" class="pay-method-label" maxlength="80" v-model="m.label" :placeholder="t('txt_pay_method_label')">`;
  html += `<button type="button" class="btn btn-sm btn-muted" @click="removeMethod(i)">${t('txt_pay_method_remove')}</button>`;
  html += `</div>`;
  html += `<button type="button" class="btn btn-sm" @click="addMethod()">+ ${t('txt_pay_method_add')}</button>`;
  html += `</div>`;

  // No radio `name`: this editor renders in two places bound to one store, and
  // v-model alone keeps the pair mutually exclusive.
  html += `<fieldset class="pay-show-methods choice-group">`;
  html += `<legend class="settings-label">${t('txt_pay_show_methods')}</legend>`;
  html += `<label class="choice-row"><input type="radio" value="after_register" v-model="draft.show_methods"> <span>${t('txt_pay_show_after_register')}</span></label>`;
  html += `<label class="choice-row"><input type="radio" value="always" v-model="draft.show_methods"> <span>${t('txt_pay_show_always')}</span></label>`;
  html += `</fieldset>`;

  html += `<div class="settings-section-actions pay-settings-actions">`;
  html += `<span class="pay-saved-hint" v-if="settingsSaved">${t('txt_txt_saved')}</span>`;
  html += `<button type="button" class="btn btn-sm btn-muted" v-if="settingsOpen" @click="cancelSettings()">${t('txt_txt_cancel')}</button>`;
  html += `<button type="button" class="btn btn-primary btn-sm" :disabled="savingSettings" @click="saveSettings()">${t('txt_pay_save_settings')}</button>`;
  html += `</div>`;
  html += `</div>`;
  return html;
}

/**
 * Settings-only island (lobby settings page "Payments" sub-tab). Shares the
 * store with the full panel so edits in either place stay in sync.
 */
function _renderPaymentSettingsIsland(kind, id) {
  let html = `<div id="pay-settings-island-${escAttr(kind)}-${escAttr(id)}" class="pay-island" v-scope>`;
  html += `<div class="settings-block">`;
  html += `<label class="settings-label">${t('txt_pay_settings_title')}</label>`;
  html += `<div class="alert alert-error" v-if="error">{{ error }}</div>`;
  html += _payRenderSettingsEditor();
  html += `</div>`;
  html += `</div>`;
  return html;
}

function _payRenderRow() {
  let html = `<tr v-for="r in visibleRows()" :key="r.player_id" :class="'pay-row pay-row-' + r.status">`;
  html += `<td class="pay-cell-player"><strong>{{ r.player_name }}</strong><div class="pay-cell-sub" v-if="r.email">{{ r.email }}</div></td>`;
  html += `<td class="pay-cell-status">`;
  html += `<select :class="'badge pay-chip pay-chip-select pay-chip-' + r.status" :value="r.status" :disabled="busyFor === r.player_id" :aria-label="t('txt_pay_col_status')" @change="changeStatus(r.player_id, $event.target.value, $event.target)">`;
  html += `<option v-for="s in statuses" :value="s" :selected="s === r.status">{{ statusLabel(s) }}</option>`;
  html += `</select>`;
  html += `<div class="pay-quick-methods" v-if="markingFor === r.player_id">`;
  html += `<span class="pay-cell-sub">{{ t('txt_pay_pick_method') }}</span>`;
  html += `<button type="button" class="btn btn-sm pay-quick-chip" v-for="m in quickMethods" :key="m" :disabled="busyFor === r.player_id" @click="markPaid(r.player_id, m)">{{ quickMethodLabel(m) }}</button>`;
  html += `<button type="button" class="btn btn-sm btn-ghost pay-quick-chip" @click="cancelMark()">{{ t('txt_txt_cancel') }}</button>`;
  html += `</div>`;
  html += `</td>`;
  html += `<td class="pay-cell-method">{{ r.method || '—' }}</td>`;
  html += `<td class="pay-cell-amount">{{ fmt(r.amount_cents, r.currency) }}</td>`;
  html += `<td class="pay-cell-ref"><code class="pay-concept">{{ r.concept }}</code><div class="pay-cell-sub" v-if="r.reference">{{ r.reference }}</div><div class="pay-cell-sub" v-if="r.note">{{ r.note }}</div></td>`;
  html += `<td class="pay-cell-updated"><span v-if="r.updated_at">{{ fmtDate(r.updated_at) }}</span><div class="pay-cell-sub" v-if="r.updated_by">{{ t('txt_pay_by', { who: r.updated_by }) }}</div></td>`;
  html += `</tr>`;
  return html;
}

/** Full payments panel island (lobby detail + tournament Settings "Payments" sub-tab). */
function _renderPaymentsIsland(kind, id) {
  let html = `<div id="pay-island-${escAttr(kind)}-${escAttr(id)}" class="pay-island" v-scope>`;

  // Header: summary badge + settings toggle
  html += `<div class="pay-header">`;
  html += `<div class="pay-header-left">`;
  html += `<span class="badge badge-count pay-summary" v-if="hasFee() && summary">{{ summaryText() }}</span>`;
  html += `<span class="settings-help" v-if="loaded && !hasFee()">${t('txt_pay_no_fee')}</span>`;
  html += `</div>`;
  html += `<div class="pay-header-right">`;
  html += `<button type="button" class="btn btn-sm" v-if="!settingsOpen" @click="openSettings()">{{ hasFee() ? t('txt_pay_edit_fee') : t('txt_pay_set_fee') }}</button>`;
  html += `</div>`;
  html += `</div>`;

  html += `<div class="alert alert-error" v-if="error">{{ error }}</div>`;
  html += `<div class="settings-block pay-settings-block" v-if="settingsOpen">${_payRenderSettingsEditor()}</div>`;

  // Toolbar: filter + remind
  html += `<div class="pay-toolbar" v-if="hasFee() && rows.length">`;
  html += `<div class="pay-filter" role="group">`;
  for (const f of ['all', 'unpaid', 'reported']) {
    html += `<button type="button" :class="'btn btn-sm pay-filter-btn' + (filter === '${f}' ? ' active' : '')" @click="filter = '${f}'">{{ t('txt_pay_filter_${f}') }}</button>`;
  }
  html += `</div>`;
  html += `<button type="button" class="btn btn-sm" v-if="canRemind()" :disabled="reminding" @click="remind()">${t('txt_pay_remind_unpaid')} ({{ pendingCount() }})</button>`;
  html += `</div>`;
  html += `<p class="settings-help pay-remind-result" v-if="remindResult">`;
  html += `{{ t('txt_pay_remind_result', { sent: remindResult.sent, failed: remindResult.failed, skipped: remindResult.skipped }) }}`;
  html += `<span v-if="remindResult.unreachable && remindResult.unreachable.length"> {{ t('txt_pay_unreachable', { names: remindResult.unreachable.join(', ') }) }}</span>`;
  html += `</p>`;

  // Table
  html += `<p class="settings-help" v-if="loaded && hasFee() && rows.length === 0">${t('txt_pay_empty')}</p>`;
  html += `<div class="player-codes-table-wrap" v-if="hasFee() && activeRows().length">`;
  html += `<table class="player-codes-table pay-table">`;
  html += `<thead><tr>`;
  for (const c of ['player', 'status', 'method', 'amount', 'reference', 'updated']) {
    html += `<th>${t(`txt_pay_col_${c}`)}</th>`;
  }
  html += `</tr></thead>`;
  html += `<tbody>${_payRenderRow()}</tbody>`;
  html += `</table>`;
  html += `<p class="settings-help" v-if="visibleRows().length === 0">${t('txt_pay_no_match')}</p>`;
  html += `</div>`;

  // Refunds pending
  html += `<div class="pay-refunds" v-if="refundRows().length">`;
  html += `<div class="settings-label">${t('txt_pay_refunds_title')}</div>`;
  html += `<p class="settings-help">${t('txt_pay_refunds_help')}</p>`;
  html += `<div class="pay-refund-row" v-for="r in refundRows()" :key="'rf-' + r.player_id">`;
  html += `<span><strong>{{ r.player_name }}</strong> · {{ fmt(r.amount_cents, r.currency) }}</span>`;
  html += `<span :class="'badge pay-chip pay-chip-' + r.status">{{ statusLabel(r.status) }}</span>`;
  html += `<button type="button" class="btn btn-sm" v-if="r.status === 'refund_due'" :disabled="busyFor === r.player_id" @click="setStatus(r.player_id, 'refunded')">${t('txt_pay_mark_refunded')}</button>`;
  html += `</div>`;
  html += `</div>`;

  html += `</div>`;
  return html;
}

// ─── Mount helpers ────────────────────────────────────────────────────────

/** Mount (or remount after a legacy re-render) the full panel and load data once. */
function _mountPaymentsPanel(kind, id) {
  if (!id) return null;
  const store = _payGetStore(kind, id);
  const root = document.getElementById(`pay-island-${kind}-${id}`);
  if (!root) return null;
  if (!mountIsland(root, store)) return null;
  if (!store.loaded && !store.loading) store.load();
  return store;
}

/** Mount the settings-only island (lobby settings page). */
function _mountPaymentSettingsPanel(kind, id) {
  if (!id) return null;
  const store = _payGetStore(kind, id);
  const root = document.getElementById(`pay-settings-island-${kind}-${id}`);
  if (!root) return null;
  if (!mountIsland(root, store)) return null;
  if (!store.loaded && !store.loading) store.load();
  return store;
}
