// ─── Tournament export (HTML / PDF) ──────────────────────
//
// One export for all three formats (Mexicano, Group+Playoff, Direct
// Playoffs), available in every phase: a finished tournament exports its
// results, a running one exports a timestamped standings snapshot. The
// admin picks the sections; the choice is remembered per browser. The UI is
// the Export tab of the Settings card (admin-settings-panel.js).

const _EXPORT_OPTS_KEY = 'amistoso-export-opts';

/** Section toggles and their defaults. Standings are always included. */
const _EXPORT_DEFAULTS = { history: true, bracket: true, upcoming: true, comments: true, elo: false };

function _loadExportOpts() {
  try {
    const saved = JSON.parse(localStorage.getItem(_EXPORT_OPTS_KEY) || '{}');
    return { ..._EXPORT_DEFAULTS, ...saved };
  } catch (_) {
    return { ..._EXPORT_DEFAULTS };
  }
}

function _saveExportOpt(key, value) {
  const opts = _loadExportOpts();
  opts[key] = Boolean(value);
  try { localStorage.setItem(_EXPORT_OPTS_KEY, JSON.stringify(opts)); } catch (_) {}
}

/**
 * Body of the Settings card's Export tab.
 * @param {{finished: boolean, hasStandings?: boolean, hasBracket?: boolean}} ctx
 *   `hasStandings` shows the ELO toggle (Direct Playoffs has no table);
 *   `hasBracket` shows the bracket toggle; the upcoming-matches toggle only
 *   applies while the tournament runs. The comments toggle adds admin match
 *   comments as a column to both match tables.
 */
function _renderExportPanel({ finished, hasStandings = true, hasBracket = false }) {
  const opts = _loadExportOpts();
  const toggle = (key, label) =>
    `<label class="switch-label"><input type="checkbox" data-export-opt="${key}"${opts[key] ? ' checked' : ''}`
    + ` onchange="_saveExportOpt('${key}', this.checked)"><span class="switch-track"></span>${esc(label)}</label>`;

  let h = `<div class="export-options">`;
  h += toggle('history', t('txt_txt_include_match_history'));
  if (hasBracket) h += toggle('bracket', t('txt_export_include_bracket'));
  if (!finished) h += toggle('upcoming', t('txt_export_include_upcoming'));
  h += toggle('comments', t('txt_export_include_comments'));
  if (hasStandings) h += toggle('elo', t('txt_export_include_elo'));
  h += `</div>`;
  h += `<div class="export-actions-row action-row action-row--fill">`;
  h += `<button type="button" class="btn btn-primary" onclick="exportTournamentOutcome('html')">${t('txt_txt_export_html')}</button>`;
  h += `<button type="button" class="btn btn-muted" onclick="exportTournamentOutcome('pdf')">${t('txt_txt_export_pdf')}</button>`;
  h += `</div>`;
  return h;
}

function _format_match_score(m) {
  if (m.sets && m.sets.length > 0) {
    return formatSetScore(m.sets, m.effective_decider, ', ');
  }
  if (m.score && m.score.length === 2) {
    return `${m.score[0]}-${m.score[1]}`;
  }
  return '—';
}

/** Score cell text, flagged when the score is disputed or not yet confirmed. */
function _export_score_cell(m) {
  const score = _format_match_score(m);
  if (m.disputed) return `${score} (${t('txt_export_score_disputed')})`;
  if (m.score && m.scored_by && !m.score_confirmed) return `${score} (${t('txt_export_score_unconfirmed')})`;
  return score;
}

/** Column header of the ELO column: the club's own rating in club tournaments. */
function _exportEloHeader(status) {
  return t(status && status.elo_scope === 'club' ? 'txt_export_col_elo_club' : 'txt_export_col_elo');
}

function _report_table(headers, rows, cls = '') {
  const thead = `<tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr>`;
  const tbody = rows.map(row => `<tr>${row.map(c => `<td>${esc(String(c))}</td>`).join('')}</tr>`).join('');
  return `<table${cls ? ` class="${cls}"` : ''}><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

/** The Court column only appears when at least one listed match has a court. */
const _hasCourts = (ms) => ms.some(m => m.court);
const _court_headers = (ms, headers) => (_hasCourts(ms) ? [...headers, t('txt_txt_court')] : headers);
const _with_court = (m, cells, ms) => (_hasCourts(ms) ? [...cells, m.court || ''] : cells);

/**
 * Side headers read "Player" when every listed match is one player per side.
 * In a team event each side is a single team entry, so it stays "Team".
 */
const _side_headers = (ms, teams) => (!teams && ms.length && ms.every(m => (m.team1 || []).length === 1 && (m.team2 || []).length === 1)
  ? [t('txt_export_player_1'), t('txt_export_player_2')]
  : [t('txt_txt_team_1'), t('txt_txt_team_2')]);

const _teamText = (team) => (team || []).join(' & ') || 'TBD';

/**
 * Whether the tournament's entries are teams. A team roster always means
 * teams. In padel, `team_mode` means team entries too. In tennis only a
 * play-off's `team_mode` does: tennis Group+Playoff always stores
 * team_mode=true (an Individual event just has no roster), and Mexicano's
 * means singles.
 */
function _is_team_event(status, kind) {
  if (Object.keys(status.team_roster || {}).length > 0) return true;
  if (!status.team_mode) return false;
  return (status.sport || 'padel') !== 'tennis' || kind === 'po';
}

/** Standings name column. */
const _participant_header = (teams) => (teams ? t('txt_txt_team') : t('txt_txt_player'));

/**
 * The Comment column appears when comments are switched on and at least one
 * listed match has an admin comment.
 */
const _showComments = (on, ms) => on && ms.some(m => (m.comment || '').trim());
const _comment_headers = (show, headers) => (show ? [...headers, t('txt_export_col_comment')] : headers);
const _with_comment = (show, m, cells) => (show ? [...cells, (m.comment || '').trim()] : cells);

/** Completed matches as a history table; empty string when there are none. */
function _report_history(title, matches, { comments, teams }) {
  const done = (matches || []).filter(m => m.status === 'completed');
  if (done.length === 0) return '';
  const show = _showComments(comments, done);
  return `<h2>${esc(title)}</h2>` + _report_table(
    _comment_headers(show, _court_headers(done, [t('txt_txt_round'), ..._side_headers(done, teams), t('txt_txt_score')])),
    done.map(m => _with_comment(show, m, _with_court(m, [m.round_label || '', _teamText(m.team1), _teamText(m.team2), _export_score_cell(m)], done))),
  );
}

/** Not-yet-played matches (with court and admin comment) for a running tournament's snapshot. */
function _report_upcoming(matches, { comments, teams }) {
  const open = (matches || []).filter(m => m.status !== 'completed');
  if (open.length === 0) return '';
  const show = _showComments(comments, open);
  return `<h2>${t('txt_export_upcoming_matches')}</h2>` + _report_table(
    _comment_headers(show, _court_headers(open, [t('txt_txt_round'), ..._side_headers(open, teams)])),
    open.map(m => _with_comment(show, m, _with_court(m, [m.round_label || '', _teamText(m.team1), _teamText(m.team2)], open))),
  );
}

function _report_champion(status) {
  if (Array.isArray(status.winners) && status.winners.length > 1) {
    return `<div class="champ">${_REPORT_TROPHY_SVG} ${t('txt_winners_word')}: <strong>${status.winners.map(w => esc(w.join(' & '))).join(' · ')}</strong></div>`;
  }
  if (status.champion) {
    return `<div class="champ">${_REPORT_TROPHY_SVG} ${t('txt_txt_champion')}: <strong>${esc(status.champion.join(', '))}</strong></div>`;
  }
  return '';
}

/**
 * Bracket image(s) as base64 data URLs. Espejo and double-elimination
 * brackets are two images (`side=winners` / `side=losers`); a side that is
 * not drawable yet (unseeded losers bracket, groups phase) is skipped.
 */
async function _report_bracket_images(apiBase, tvSettings, labels) {
  const url = _adminBracketUrl(apiBase, { ...(tvSettings || {}), schema_format: 'png' });
  if (!labels) {
    const src = await _fetch_image_as_base64(url);
    return src ? [{ label: '', src }] : [];
  }
  const [win, lose] = await Promise.all([
    _fetch_image_as_base64(`${url}&side=winners`),
    _fetch_image_as_base64(`${url}&side=losers`),
  ]);
  return [{ label: labels[0], src: win }, { label: labels[1], src: lose }].filter(i => i.src);
}

function _report_bracket(images) {
  if (images.length === 0) return '';
  let h = `<h2>${t('txt_txt_play_off_bracket')}</h2>`;
  for (const img of images) {
    if (img.label) h += `<h3>${esc(img.label)}</h3>`;
    h += `<img src="${img.src}" alt="${escAttr(img.label || t('txt_txt_play_off_bracket'))}">`;
  }
  return h;
}


/**
 * Trophy icon for the standalone HTML/PDF export. The export document does not
 * load theme.css, so the `.ic` sizing rule is absent: the SVG carries its own
 * width/height, fill and stroke (dark green to match the `.champ` box).
 */
const _REPORT_TROPHY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"'
  + ' fill="none" stroke="#166534" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  + ' style="vertical-align:-3px" aria-hidden="true">'
  + '<path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/>'
  + '<path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>'
  + '<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>'
  + '<path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>';

/**
 * Standalone report document. It loads no stylesheet, so colours are the
 * light-mode theme.css values inlined (court blue `--color-primary`).
 */
function _build_report_document(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="${escAttr(_currentLang || 'en')}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)}</title>
  <style>
    body { font-family: 'Roboto', system-ui, -apple-system, 'Segoe UI', sans-serif; margin: 24px; color: #1f2937; }
    h1 { margin: 0 0 8px; }
    h2 { margin: 24px 0 8px; color: #1a5fa3; }
    h3 { margin: 16px 0 6px; }
    .muted { color: #6b7280; font-size: 0.92rem; margin-bottom: 16px; }
    .champ { margin: 12px 0 18px; padding: 10px; background: #ecfdf5; border: 1px solid #86efac; border-radius: 6px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0 18px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 0.9rem; }
    th { background: #f3f4f6; }
    table.standings { table-layout: fixed; }
    table.standings th:first-child { width: 28%; }
    img { max-width: 100%; height: auto; }
    h2, h3 { break-after: avoid; }
    tr, img { break-inside: avoid; }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

function _download_text_file(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

/**
 * Open a print window for `htmlDoc`. Pass `win` when the window was opened
 * earlier, synchronously inside the click handler: browsers (iOS Safari in
 * particular) block `window.open` once the click's user activation is spent
 * on an `await`.
 */
function _open_printable_pdf(htmlDoc, win = null) {
  const w = win || window.open('', '_blank');
  if (!w) {
    _showToast(t('txt_txt_popup_blocked_allow_popups_to_export_pdf'), 'error');
    return;
  }
  w.document.open();
  w.document.write(htmlDoc);
  w.document.close();
  setTimeout(() => w.print(), 250);
}

async function _fetch_image_as_base64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result); // data:image/png;base64,...
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch { return null; }
}

/** Local `YYYYMMDD-HHMM` stamp for snapshot filenames. */
function _export_file_stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const _played = (matches) => (matches || []).filter(m => m.status === 'completed').length;

async function _build_gp_report(tid, opts, tvSettings) {
  const [status, groups, playoffs] = await Promise.all([
    api(`/api/tournaments/${tid}/gp/status`),
    api(`/api/tournaments/${tid}/gp/groups`),
    api(`/api/tournaments/${tid}/gp/playoffs`).catch(() => ({ matches: [], pending: [] })),
  ]);
  const finished = status.phase === 'finished';
  const tbl = { comments: opts.comments, teams: _is_team_event(status, 'gp') };
  const hasBracket = status.phase !== 'groups';
  const espejo = status.espejo === true;
  const labels = (espejo || status.double_elimination)
    ? (status.espejo_split
      ? [t('txt_txt_espejo_gold_bracket'), t('txt_txt_espejo_silver_bracket')]
      : [t('txt_txt_espejo_winners_bracket'), t('txt_txt_espejo_losers_bracket')])
    : null;
  const images = opts.bracket && hasBracket
    ? await _report_bracket_images(`/api/tournaments/${tid}/gp/playoffs-schema`, tvSettings, labels)
    : [];
  const groupMatches = Object.values(groups.matches || {}).flat();
  const playoffMatches = playoffs?.matches || [];

  let progress;
  if (status.phase === 'groups') {
    progress = `${t('txt_txt_group_stage')} · ${t('txt_export_matches_played', { done: _played(groupMatches), total: groupMatches.length })}`;
  } else if (!finished) {
    progress = `${t('txt_txt_play_offs')} · ${t('txt_export_matches_played', { done: _played(playoffMatches), total: playoffMatches.length })}`;
  }

  let body = _report_champion(status);
  if (!finished && opts.upcoming) {
    body += _report_upcoming(status.phase === 'groups' ? groupMatches : (playoffs?.pending || []), tbl);
  }
  body += _report_bracket(images);
  if (opts.history) body += _report_history(t('txt_txt_play_off_match_history'), playoffMatches, tbl);

  body += `<h2>${t('txt_txt_group_standings')}</h2>`;
  for (const [gName, rows] of Object.entries(groups.standings || {})) {
    body += `<h3>${t('txt_txt_group_name_value', { value: esc(gName) })}</h3>`;
    const hasSets = rows.some(r => r.sets_won > 0 || r.sets_lost > 0);
    const headers = [_participant_header(tbl.teams), t('txt_txt_played_abbrev'), t('txt_txt_w_abbrev'), t('txt_txt_l_abbrev')];
    if (hasSets) headers.push(t('txt_txt_sw_abbrev'), t('txt_txt_sl_abbrev'), t('txt_txt_sd_abbrev'));
    headers.push(t('txt_txt_pf_abbrev'), t('txt_txt_pa_abbrev'), t('txt_txt_diff_abbrev'));
    if (opts.elo) headers.push(_exportEloHeader(status));
    body += _report_table(
      headers,
      rows.map(r => {
        const base = [r.player, r.played, r.wins, r.losses];
        if (hasSets) base.push(r.sets_won, r.sets_lost, r.sets_diff);
        base.push(r.points_for, r.points_against, r.point_diff);
        if (opts.elo) base.push(r.elo ?? '—');
        return base;
      }),
      'standings',
    );
  }
  if (opts.history) body += _report_history(t('txt_txt_group_match_history'), groupMatches, tbl);

  return { body, finished, progress };
}

async function _build_po_report(tid, opts, tvSettings) {
  const [status, playoffs] = await Promise.all([
    api(`/api/tournaments/${tid}/po/status`),
    api(`/api/tournaments/${tid}/po/playoffs`),
  ]);
  const finished = status.phase === 'finished';
  const tbl = { comments: opts.comments, teams: _is_team_event(status, 'po') };
  // Standalone double elimination draws both sides in one image; only
  // Espejo has a separate Silver / Losers bracket to fetch.
  const labels = status.espejo === true
    ? [t('txt_txt_espejo_winners_bracket'), t('txt_txt_espejo_losers_bracket')]
    : null;
  const images = opts.bracket
    ? await _report_bracket_images(`/api/tournaments/${tid}/po/playoffs-schema`, tvSettings, labels)
    : [];
  const matches = playoffs.matches || [];
  const progress = finished
    ? null
    : `${t('txt_txt_play_offs')} · ${t('txt_export_matches_played', { done: _played(matches), total: matches.length })}`;

  let body = _report_champion(status);
  if (!finished && opts.upcoming) body += _report_upcoming(playoffs.pending || [], tbl);
  body += _report_bracket(images);
  if (opts.history) body += _report_history(t('txt_txt_play_off_match_history'), matches, tbl);

  return { body, finished, progress };
}

async function _build_mex_report(tid, opts, tvSettings) {
  const [status, matches, playoffs] = await Promise.all([
    api(`/api/tournaments/${tid}/mex/status`),
    api(`/api/tournaments/${tid}/mex/matches`),
    api(`/api/tournaments/${tid}/mex/playoffs`).catch(() => ({ matches: [], pending: [] })),
  ]);
  const finished = status.phase === 'finished';
  const tbl = { comments: opts.comments, teams: _is_team_event(status, 'mex') };
  const playoffMatches = playoffs?.matches || [];
  const inPlayoffs = status.phase === 'playoffs' || playoffMatches.length > 0;
  const images = opts.bracket && inPlayoffs
    ? await _report_bracket_images(`/api/tournaments/${tid}/mex/playoffs-schema`, tvSettings, null)
    : [];

  let progress = null;
  if (!finished) {
    if (inPlayoffs) progress = t('txt_txt_play_offs');
    else if (status.rolling) progress = `${t('txt_admin_status_round_n', { n: status.current_round })} · ${t('txt_txt_rolling')}`;
    else progress = t('txt_admin_status_round_n_of_m', { n: status.current_round, m: status.num_rounds });
  }

  let body = _report_champion(status);
  if (!finished && opts.upcoming) {
    body += _report_upcoming(inPlayoffs ? (playoffs?.pending || []) : (matches.current_matches || []), tbl);
  }
  body += _report_bracket(images);
  if (opts.history) body += _report_history(t('txt_txt_play_off_match_history'), playoffMatches, tbl);

  const headers = [t('txt_txt_rank'), _participant_header(tbl.teams), t('txt_txt_total_pts'), t('txt_txt_played_abbrev'), t('txt_txt_w_abbrev'), t('txt_txt_l_abbrev'), t('txt_txt_avg_pts')];
  if (opts.elo) headers.push(_exportEloHeader(status));
  body += `<h2>${t('txt_txt_leaderboard')}</h2>`;
  body += _report_table(
    headers,
    (status.leaderboard || []).map(r => {
      const row = [r.rank, r.player, r.total_points, r.matches_played, r.wins || 0, r.losses || 0, r.avg_points];
      if (opts.elo) row.push(r.elo ?? '—');
      return row;
    }),
  );
  if (opts.history) body += _report_history(t('txt_txt_mexicano_round_history'), matches.all_matches, tbl);

  return { body, finished, progress };
}

async function exportTournamentOutcome(format) {
  if (!currentTid || !currentType) return;
  // Open the print window now, while the click still counts as a user
  // gesture; it is filled in once the data has loaded.
  let pdfWin = null;
  if (format === 'pdf') {
    pdfWin = window.open('', '_blank');
    if (!pdfWin) {
      _showToast(t('txt_txt_popup_blocked_allow_popups_to_export_pdf'), 'error');
      return;
    }
    pdfWin.document.write(`<p style="font-family:sans-serif">${esc(t('txt_export_preparing'))}</p>`);
  }

  const opts = _loadExportOpts();
  const now = new Date();
  const name = currentTournamentName || `Tournament ${currentTid}`;

  try {
    const tvSettings = await api(`/api/tournaments/${currentTid}/tv-settings`).catch(() => ({}));
    const builder = currentType === 'group_playoff' ? _build_gp_report
      : currentType === 'playoff' ? _build_po_report
        : _build_mex_report;
    const { body, finished, progress } = await builder(currentTid, opts, tvSettings);

    const heading = finished ? t('txt_txt_results') : t('txt_export_snapshot_title');
    let doc = `<h1>${esc(name)} — ${esc(heading)}</h1>`;
    doc += `<div class="muted">${t('txt_txt_generated_value', { value: esc(now.toLocaleString()) })}`;
    if (progress) doc += ` · ${esc(progress)}`;
    doc += `</div>`;
    doc += body;

    const htmlDoc = _build_report_document(`${name} ${heading}`, doc);
    const slug = String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'tournament';
    const filename = finished ? `${slug}-results.html` : `${slug}-standings-${_export_file_stamp(now)}.html`;

    if (format === 'pdf') {
      _open_printable_pdf(htmlDoc, pdfWin);
    } else {
      _download_text_file(filename, htmlDoc, 'text/html;charset=utf-8');
    }
  } catch (e) {
    if (pdfWin) pdfWin.close();
    _showToast(t('txt_txt_export_failed_value', { value: e.message }), 'error');
  }
}
