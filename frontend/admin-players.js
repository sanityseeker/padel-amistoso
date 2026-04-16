// ─── Players Hub Admin ────────────────────────────────────
// Admin interface for managing Player Hub profiles.
// Uses the same api() helper and auth token as the rest of the admin.

let _phProfiles = [];
let _phCurrentProfileId = null;

/** Search profiles by name or email */
async function phSearch() {
  const input = document.getElementById('ph-search-input');
  const q = (input?.value || '').trim();
  const container = document.getElementById('ph-results');
  if (!container) return;
  container.innerHTML = `<em>${t('txt_ph_searching')}</em>`;
  try {
    const profiles = await api(`/api/admin/player-profiles?q=${encodeURIComponent(q)}`);
    _phProfiles = profiles;
    if (profiles.length === 0) {
      container.innerHTML = q
        ? `<p style="color:var(--text-muted)">${t('txt_ph_no_profiles_matching_q', { q: esc(q) })}</p>`
        : `<p style="color:var(--text-muted)">${t('txt_hub_no_results')}.</p>`;
      return;
    }
    const _phOpen = localStorage.getItem('ph-profiles-open') === '1';
    let html = `<details class="ph-profiles-collapse" id="ph-profiles-details" style="margin-top:0.25rem"${_phOpen ? ' open' : ''}>`;
    html += `<summary style="cursor:pointer;user-select:none;display:flex;align-items:center;gap:0.4rem;list-style:none;font-size:0.95rem;font-weight:700;padding:0.3rem 0">`;
    html += `<span class="tv-chevron" style="font-size:0.65em;color:var(--text-muted)">&#9658;</span>`;
    html += `${t('txt_ph_all_profiles_n', { n: profiles.length })}`;
    html += `</summary>`;
    html += '<div class="player-codes-table-wrap" style="margin-top:0.5rem"><table class="player-codes-table">';
    html += '<thead><tr class="player-codes-head-row">';
    html += `<th class="player-codes-th">${t('txt_ph_name')}</th>`;
    html += `<th class="player-codes-th">${t('txt_txt_email')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_ph_padel_elo')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_ph_tennis_elo')}</th>`;
    html += `<th class="player-codes-th">${t('txt_txt_passphrase')}</th>`;
    html += `<th class="player-codes-th">${t('txt_ph_created')}</th>`;
    html += '<th class="player-codes-th-center"></th>';
    html += '</tr></thead><tbody>';
    for (const p of profiles) {
      const padelElo = p.elo_padel_matches > 0 ? `${Math.round(p.elo_padel)} <span style="font-size:0.75rem;color:var(--text-muted)">(${p.elo_padel_matches})</span>` : '<span style="color:var(--text-muted)">—</span>';
      const tennisElo = p.elo_tennis_matches > 0 ? `${Math.round(p.elo_tennis)} <span style="font-size:0.75rem;color:var(--text-muted)">(${p.elo_tennis_matches})</span>` : '<span style="color:var(--text-muted)">—</span>';
      html += `<tr class="player-codes-row">`;
      html += `<td class="player-codes-name">${esc(p.name || '—')}</td>`;
      html += `<td class="player-codes-cell">${esc(p.email || '—')}</td>`;
      html += `<td class="player-codes-cell-center">${padelElo}</td>`;
      html += `<td class="player-codes-cell-center">${tennisElo}</td>`;
      html += `<td class="player-codes-cell"><code class="player-codes-passphrase" onclick="navigator.clipboard.writeText(this.textContent)" title="${t('txt_txt_click_to_copy')}">${esc(p.passphrase)}</code></td>`;
      html += `<td class="player-codes-cell" style="font-size:0.8rem;color:var(--text-muted)">${_phFormatDate(p.created_at)}</td>`;
      html += `<td class="player-codes-cell-center"><button type="button" class="btn btn-primary btn-sm" onclick="phLoadProfile('${escAttr(p.id)}')">${t('txt_ph_manage')}</button></td>`;
      html += `</tr>`;
    }
    html += '</tbody></table></div></details>';
    container.innerHTML = html;
    const _phDetails = document.getElementById('ph-profiles-details');
    if (_phDetails) _phDetails.addEventListener('toggle', () => localStorage.setItem('ph-profiles-open', _phDetails.open ? '1' : '0'));
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

/** Load and render a single profile detail view */
async function phLoadProfile(profileId) {
  const detail = document.getElementById('ph-detail');
  if (!detail) return;
  _phCurrentProfileId = profileId;
  detail.style.display = '';
  detail.innerHTML = `<div class="card"><em>${t('txt_ph_loading_profile')}</em></div>`;
  try {
    const data = await api(`/api/admin/player-profiles/${profileId}`);
    _phRenderDetail(data);
  } catch (e) {
    detail.innerHTML = `<div class="card"><div class="alert alert-error">${esc(e.message)}</div></div>`;
  }
}

/** Render the full profile detail card */
function _phRenderDetail(data) {
  const detail = document.getElementById('ph-detail');
  if (!detail) return;
  const active = data.participations.filter(p => p.status === 'active');
  const finished = data.participations.filter(p => p.status === 'finished');

  let html = '<div class="card">';
  html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.75rem;flex-wrap:wrap;gap:0.5rem">';
  html += `<h2 style="margin:0">🎾 ${esc(data.name || t('txt_ph_unnamed_profile'))}</h2>`;
  html += `<button type="button" class="btn btn-sm" onclick="phCloseDetail()">✕ ${t('txt_txt_close')}</button>`;
  html += '</div>';

  // Profile info
  html += '<div style="display:grid;grid-template-columns:auto 1fr;gap:0.3rem 1rem;font-size:0.88rem;margin-bottom:1rem">';
  html += `<strong>${t('txt_txt_passphrase')}:</strong><span><code class="player-codes-passphrase" onclick="navigator.clipboard.writeText(this.textContent)" title="${t('txt_txt_click_to_copy')}">${esc(data.passphrase)}</code> <button type="button" class="btn btn-sm btn-muted" onclick="phResetPassphrase('${escAttr(data.id)}')" style="font-size:0.76rem;padding:0.15rem 0.4rem">🔄 ${t('txt_ph_reset')}</button></span>`;
  html += `<strong>${t('txt_txt_email')}:</strong><span style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap"><input type="email" id="ph-email-input" value="${escAttr(data.email || '')}" style="flex:1;min-width:180px;padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)"><button type="button" class="btn btn-sm" onclick="phUpdateEmail('${escAttr(data.id)}')" id="ph-email-save-btn">${t('txt_txt_save')}</button></span>`;
  html += `<strong>${t('txt_txt_contact')}:</strong><span>${esc(data.contact || t('txt_txt_contact_not_set'))}</span>`;
  html += `<strong>${t('txt_ph_created')}:</strong><span>${_phFormatDate(data.created_at)}</span>`;
  html += '</div>';

  // ELO ratings
  html += '<div style="display:flex;gap:1.5rem;flex-wrap:wrap;margin-bottom:1rem">';
  if (data.elo_padel_matches > 0) {
    html += `<div style="padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-size:0.88rem">`;
    html += `<strong>${t('txt_ph_padel_elo')}:</strong> ${Math.round(data.elo_padel)} <span style="color:var(--text-muted)">(${data.elo_padel_matches} ${t('txt_txt_matches').toLowerCase()})</span></div>`;
  }
  if (data.elo_tennis_matches > 0) {
    html += `<div style="padding:0.5rem 0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface);font-size:0.88rem">`;
    html += `<strong>${t('txt_ph_tennis_elo')}:</strong> ${Math.round(data.elo_tennis)} <span style="color:var(--text-muted)">(${data.elo_tennis_matches} ${t('txt_txt_matches').toLowerCase()})</span></div>`;
  }
  if (data.elo_padel_matches === 0 && data.elo_tennis_matches === 0) {
    html += `<span style="color:var(--text-muted);font-size:0.84rem">${t('txt_ph_no_elo')}</span>`;
  }
  html += '</div>';

  // K-factor override
  const kVal = data.k_factor_override != null ? data.k_factor_override : '';
  html += '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;font-size:0.88rem">';
  html += `<strong>${t('txt_ph_kfactor_override')}:</strong>`;
  html += `<input type="number" id="ph-kfactor-input" value="${escAttr(String(kVal))}" placeholder="${t('txt_ph_auto')}" min="1" max="200" style="width:80px;padding:0.3rem 0.5rem;font-size:0.86rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text)">`;
  html += `<button type="button" class="btn btn-sm" onclick="phUpdateKFactor('${escAttr(data.id)}')" id="ph-kfactor-save-btn">${t('txt_txt_save')}</button>`;
  html += `<span style="color:var(--text-muted);font-size:0.8rem">${t('txt_ph_kfactor_auto_help')}</span>`;
  html += '</div>';

  // New passphrase result area
  html += '<div id="ph-passphrase-result"></div>';

  // Active participations
  html += `<h3 style="margin:1rem 0 0.5rem;font-size:0.95rem">${t('txt_ph_active_participations_n', { n: active.length })}</h3>`;
  if (active.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.84rem">${t('txt_ph_no_active_links')}</p>`;
  } else {
    html += _phParticipationTable(active, data.id, false);
  }

  // Finished participations
  html += `<h3 style="margin:1rem 0 0.5rem;font-size:0.95rem">${t('txt_ph_finished_participations_n', { n: finished.length })}</h3>`;
  if (finished.length === 0) {
    html += `<p style="color:var(--text-muted);font-size:0.84rem">${t('txt_ph_no_finished_history')}</p>`;
  } else {
    html += _phParticipationTable(finished, data.id, true);
  }

  // Link new participation
  html += '<div style="margin-top:1rem">';
  html += `<button type="button" class="add-participant-btn" onclick="phStartLink('${escAttr(data.id)}')">＋ ${t('txt_ph_link_participation')}</button>`;
  html += '</div>';
  html += '<div id="ph-link-area"></div>';

  html += '</div>';
  detail.innerHTML = html;
}

/** Render a table of participations */
function _phParticipationTable(participations, profileId, isFinished) {
  let html = '<div class="player-codes-table-wrap"><table class="player-codes-table">';
  html += '<thead><tr class="player-codes-head-row">';
  html += `<th class="player-codes-th">${t('txt_txt_tournament_name')}</th>`;
  html += `<th class="player-codes-th">${t('txt_ph_player_name')}</th>`;
  if (isFinished) {
    html += `<th class="player-codes-th-center">${t('txt_ph_rank')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_ph_wld')}</th>`;
    html += `<th class="player-codes-th-center">${t('txt_ph_pf_pa')}</th>`;
  }
  html += '<th class="player-codes-th-center"></th>';
  html += '</tr></thead><tbody>';
  for (const p of participations) {
    html += '<tr class="player-codes-row">';
    html += `<td class="player-codes-name">${esc(p.tournament_name || p.tournament_id)}</td>`;
    html += `<td class="player-codes-cell">${esc(p.player_name)}</td>`;
    if (isFinished) {
      const rankStr = p.rank != null ? `#${p.rank}/${p.total_players || '?'}` : '—';
      html += `<td class="player-codes-cell-center">${rankStr}</td>`;
      html += `<td class="player-codes-cell-center">${p.wins}/${p.losses}/${p.draws}</td>`;
      html += `<td class="player-codes-cell-center">${p.points_for}/${p.points_against}</td>`;
    }
    const unlinkLabel = isFinished ? `⚠️ ${t('txt_ph_unlink')}` : t('txt_ph_unlink');
    const btnClass = isFinished ? 'btn btn-danger btn-sm' : 'btn btn-sm btn-muted';
    html += `<td class="player-codes-cell-center"><button type="button" class="${btnClass}" onclick="phUnlink('${escAttr(p.tournament_id)}','${escAttr(p.player_id)}',${isFinished})" style="font-size:0.78rem">${unlinkLabel}</button></td>`;
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  return html;
}

/** Close the detail panel */
function phCloseDetail() {
  const detail = document.getElementById('ph-detail');
  if (detail) { detail.style.display = 'none'; detail.innerHTML = ''; }
  _phCurrentProfileId = null;
}

/** Reset a profile's passphrase */
async function phResetPassphrase(profileId) {
  if (!confirm(t('txt_ph_reset_passphrase_confirm'))) return;
  try {
    const result = await api(`/api/admin/player-profiles/${profileId}/reset-passphrase`, { method: 'POST' });
    const area = document.getElementById('ph-passphrase-result');
    if (area) {
      area.innerHTML = `<div class="alert alert-info" style="margin-bottom:0.75rem">${t('txt_ph_new_passphrase')}: <code class="player-codes-passphrase" style="font-size:1.05rem" onclick="navigator.clipboard.writeText(this.textContent)" title="${t('txt_txt_click_to_copy')}">${esc(result.passphrase)}</code></div>`;
    }
    // Refresh the detail to show updated passphrase
    phLoadProfile(profileId);
  } catch (e) {
    alert(t('txt_ph_failed_reset_passphrase_value', { value: e.message }));
  }
}

/** Update a profile's email */
async function phUpdateEmail(profileId) {
  const input = document.getElementById('ph-email-input');
  const btn = document.getElementById('ph-email-save-btn');
  if (!input) return;
  try {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    await api(`/api/admin/player-profiles/${profileId}/email`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: input.value }),
    });
    if (btn) { btn.disabled = false; btn.textContent = `${t('txt_txt_saved')} ✓`; }
    setTimeout(() => { if (btn) btn.textContent = t('txt_txt_save'); }, 1500);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_save'); }
    alert(t('txt_ph_failed_update_email_value', { value: e.message }));
  }
}

/** Update a profile's K-factor override */
async function phUpdateKFactor(profileId) {
  const input = document.getElementById('ph-kfactor-input');
  const btn = document.getElementById('ph-kfactor-save-btn');
  if (!input) return;
  const raw = input.value.trim();
  const kValue = raw === '' ? null : parseInt(raw, 10);
  if (kValue !== null && (isNaN(kValue) || kValue < 1 || kValue > 200)) {
    alert(t('txt_ph_kfactor_validation'));
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    await api(`/api/admin/player-profiles/${profileId}/k-factor`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ k_factor_override: kValue }),
    });
    if (btn) { btn.disabled = false; btn.textContent = `${t('txt_txt_saved')} ✓`; }
    setTimeout(() => { if (btn) btn.textContent = t('txt_txt_save'); }, 1500);
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = t('txt_txt_save'); }
    alert(t('txt_ph_failed_update_kfactor_value', { value: e.message }));
  }
}

/** Unlink a participation */
async function phUnlink(tid, playerId, isFinished) {
  if (isFinished) {
    if (!confirm(t('txt_ph_unlink_finished_confirm'))) return;
  } else {
    if (!confirm(t('txt_ph_unlink_active_confirm'))) return;
  }
  try {
    await api(`/api/admin/player-profiles/link/${tid}/${playerId}`, { method: 'DELETE' });
    if (_phCurrentProfileId) phLoadProfile(_phCurrentProfileId);
  } catch (e) {
    alert(t('txt_ph_failed_unlink_value', { value: e.message }));
  }
}

/** Start the link flow — pick a tournament, then a player */
async function phStartLink(profileId) {
  const area = document.getElementById('ph-link-area');
  if (!area) return;
  area.innerHTML = `<div style="margin-top:0.75rem"><em>${t('txt_ph_loading_tournaments')}</em></div>`;
  try {
    const tournaments = await api('/api/tournaments');
    if (tournaments.length === 0) {
      area.innerHTML = `<div style="margin-top:0.75rem"><p style="color:var(--text-muted)">${t('txt_txt_no_tournaments_available')}.</p></div>`;
      return;
    }
    let html = '<div style="margin-top:0.75rem;padding:0.75rem;border:1px solid var(--border);border-radius:6px;background:var(--surface)">';
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem"><strong style="font-size:0.88rem">${t('txt_ph_link_participation')}</strong>`;
    html += `<button type="button" class="btn btn-sm" onclick="document.getElementById('ph-link-area').innerHTML=''">✕</button></div>`;
    html += '<div style="margin-bottom:0.5rem">';
    html += `<label style="font-size:0.84rem;color:var(--text-muted)">${t('txt_ph_select_tournament')}</label>`;
    html += `<select id="ph-link-tid" style="width:100%;padding:0.35rem 0.5rem;font-size:0.88rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);margin-top:0.25rem" onchange="phLoadUnlinkedPlayers('${escAttr(profileId)}')">`;
    html += `<option value="">${t('txt_ph_choose')}</option>`;
    for (const t of tournaments) {
      html += `<option value="${escAttr(t.id)}">${esc(t.name)} (${esc(t.phase || t.type)})</option>`;
    }
    html += '</select></div>';
    html += '<div id="ph-link-players"></div>';
    html += '</div>';
    area.innerHTML = html;
  } catch (e) {
    area.innerHTML = `<div class="alert alert-error" style="margin-top:0.75rem">${esc(e.message)}</div>`;
  }
}

/** Load unlinked players for a tournament */
async function phLoadUnlinkedPlayers(profileId) {
  const select = document.getElementById('ph-link-tid');
  const container = document.getElementById('ph-link-players');
  if (!select || !container) return;
  const tid = select.value;
  if (!tid) { container.innerHTML = ''; return; }
  container.innerHTML = `<em>${t('txt_ph_loading_players')}</em>`;
  try {
    const players = await api(`/api/admin/player-profiles/unlinked/${tid}`);
    if (players.length === 0) {
      container.innerHTML = `<p style="color:var(--text-muted);font-size:0.84rem">${t('txt_ph_all_players_already_linked')}</p>`;
      return;
    }
    let html = `<label style="font-size:0.84rem;color:var(--text-muted)">${t('txt_ph_select_player')}</label>`;
    html += `<select id="ph-link-pid" style="width:100%;padding:0.35rem 0.5rem;font-size:0.88rem;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);margin:0.25rem 0 0.5rem">`;
    for (const p of players) {
      html += `<option value="${escAttr(p.player_id)}">${esc(p.player_name)} (${esc(p.player_id.slice(0, 6))}…)</option>`;
    }
    html += '</select>';
    html += `<button type="button" class="btn btn-primary btn-sm" onclick="phSubmitLink('${escAttr(profileId)}')">${t('txt_ph_link')}</button>`;
    container.innerHTML = html;
  } catch (e) {
    container.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

/** Submit the link */
async function phSubmitLink(profileId) {
  const tidSelect = document.getElementById('ph-link-tid');
  const pidSelect = document.getElementById('ph-link-pid');
  if (!tidSelect || !pidSelect) return;
  const tid = tidSelect.value;
  const pid = pidSelect.value;
  if (!tid || !pid) return;
  try {
    await api(`/api/admin/player-profiles/${profileId}/link/${tid}/${pid}`, { method: 'POST' });
    document.getElementById('ph-link-area').innerHTML = '';
    phLoadProfile(profileId);
  } catch (e) {
    alert(t('txt_ph_failed_link_value', { value: e.message }));
  }
}

/** Format an ISO date string for display */
function _phFormatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return isoStr; }
}

// Wire up Enter key on search input
document.addEventListener('DOMContentLoaded', () => {
  const input = document.getElementById('ph-search-input');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') phSearch();
    });
  }
});
