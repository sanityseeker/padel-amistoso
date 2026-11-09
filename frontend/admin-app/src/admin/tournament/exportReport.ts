import { t as tx, localeTag } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import type { Match, Standing, Score } from '../../types';
import { formatSets, type TournamentPageData } from './scoring';

export interface ExportOptions {
  history: boolean;
  upcoming: boolean;
  comments: boolean;
  bracket: boolean;
  elo: boolean;
}
export const EXPORT_KEY = 'amistoso-export-opts';
export const EXPORT_DEFAULTS: ExportOptions = {
  history: true,
  upcoming: true,
  comments: true,
  bracket: true,
  elo: false,
};
export function loadExportOptions(): ExportOptions {
  try {
    return { ...EXPORT_DEFAULTS, ...JSON.parse(localStorage.getItem(EXPORT_KEY) || '{}') };
  } catch {
    return { ...EXPORT_DEFAULTS };
  }
}
export function saveExportOptions(options: ExportOptions) {
  try {
    localStorage.setItem(EXPORT_KEY, JSON.stringify(options));
  } catch {
    /* Remembering the choice is optional. */
  }
}

const esc = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const team = (names: string[]) => names.join(' & ') || tx('To be decided');
function scoreOf(m: Match, decider: 'full_set' | 'match_tiebreak'): string {
  const text = m.sets?.length
    ? formatSets(m.sets as Score[], m.effective_decider ?? decider, ', ')
    : m.score
      ? `${m.score[0]}-${m.score[1]}`
      : '-';
  if (m.walkover) return `${text} (${tx('Walkover')})`;
  if (m.disputed) return `${text} (${tx('Disputed')})`;
  if (m.score && m.scored_by && !m.score_confirmed) return `${text} (${tx('Unconfirmed')})`;
  return text;
}
function table(headers: string[], rows: string[][]) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}
function matchTable(
  matches: Match[],
  options: ExportOptions,
  decider: 'full_set' | 'match_tiebreak',
  withScore: boolean,
) {
  const comments = options.comments && matches.some((m) => (m.comment ?? '').trim());
  const courts = matches.some((m) => m.court);
  const headers = [
    tx('Round'),
    tx('Team 1'),
    tx('Team 2'),
    ...(withScore ? [tx('Score')] : []),
    ...(courts ? [tx('Court')] : []),
    ...(comments ? [tx('Comment')] : []),
  ];
  return table(
    headers,
    matches.map((m) => [
      m.round_label ? formatRoundLabel(m.round_label) : '',
      team(m.team1),
      team(m.team2),
      ...(withScore ? [scoreOf(m, decider)] : []),
      ...(courts ? [m.court ?? ''] : []),
      ...(comments ? [(m.comment ?? '').trim()] : []),
    ]),
  );
}
function standings(rows: Standing[], elo: boolean) {
  const mex = rows.some((r) => r.total_points !== undefined);
  return table(
    [
      '#',
      tx('Player'),
      mex ? tx('Points') : tx('Points for'),
      tx('Played'),
      tx('Wins'),
      ...(elo ? [tx('ELO')] : []),
    ],
    rows.map((r, i) => [
      String(i + 1),
      r.player,
      String(r.total_points ?? r.points_for ?? 0),
      String(r.matches_played ?? r.played ?? 0),
      String(r.wins),
      ...(elo ? [r.elo ? String(Math.round(r.elo)) : '-'] : []),
    ]),
  );
}

const STYLE = `body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#14213d}h1{font-size:22px}h2{font-size:16px;margin-top:24px;border-bottom:1px solid #ccd;padding-bottom:4px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #ccd;padding:4px 8px;text-align:left}th{background:#eef}.muted{color:#667}img{max-width:100%}`;

export async function bracketImages(
  tid: string,
  prefix: string,
  sides: boolean,
): Promise<string[]> {
  const urls = sides ? [`?side=winners`, `?side=losers`] : [''];
  const out: string[] = [];
  for (const q of urls) {
    try {
      const res = await fetch(`/api/tournaments/${tid}/${prefix}/playoffs-schema${q}`);
      if (!res.ok) continue;
      const blob = await res.blob();
      out.push(
        await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }),
      );
    } catch {
      /* A missing diagram never blocks the export. */
    }
  }
  return out;
}

// A standalone HTML report of the tournament as the workspace shows it (the legacy export, built from
// the same read endpoints; the workspace query is the data source).
export function buildReport(args: {
  name: string;
  page: TournamentPageData;
  matches: Match[];
  options: ExportOptions;
  images: string[];
  now: Date;
}): { html: string; title: string; filename: string; finished: boolean } {
  const { name, page, matches, options, images, now } = args;
  const finished = page.status.phase === 'finished';
  const decider = page.settings.set_decider;
  const done = matches.filter((m) => m.status === 'completed');
  const upcoming = matches.filter(
    (m) => m.status !== 'completed' && m.team1.length && m.team2.length,
  );
  const heading = finished ? tx('Results') : tx('Standings snapshot');
  let body = `<h1>${esc(name)} - ${esc(heading)}</h1><p class="muted">${esc(
    tx('Generated {value}', { value: now.toLocaleString(localeTag()) }),
  )} · ${esc(tx('{done} of {total} matches played', { done: done.length, total: matches.length }))}</p>`;
  if (page.status.champion?.length)
    body += `<h2>${esc(tx('Tournament champions'))}</h2><p>${esc(page.status.champion.join(' & '))}</p>`;
  if (!finished && options.upcoming && upcoming.length)
    body += `<h2>${esc(tx('Upcoming matches'))}</h2>${matchTable(upcoming, options, decider, false)}`;
  if (options.bracket && images.length)
    body += `<h2>${esc(tx('Play-off bracket'))}</h2>${images.map((src) => `<img src="${src}" alt="">`).join('')}`;
  if (page.status.leaderboard)
    body += `<h2>${esc(tx('Standings'))}</h2>${standings(page.status.leaderboard, options.elo)}`;
  else if (page.data.standings)
    for (const [group, rows] of Object.entries(page.data.standings))
      body += `<h2>${esc(tx('Group {name}', { name: group }))}</h2>${standings(rows, options.elo)}`;
  if (options.history && done.length)
    body += `<h2>${esc(tx('Match history'))}</h2>${matchTable(done, options, decider, true)}`;
  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'tournament';
  const stamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return {
    html: `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)} ${esc(heading)}</title><style>${STYLE}</style></head><body>${body}</body></html>`,
    title: `${name} ${heading}`,
    filename: finished ? `${slug}-results.html` : `${slug}-standings-${stamp}.html`,
    finished,
  };
}

export function downloadHtml(filename: string, html: string) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function printHtml(win: Window, html: string) {
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  window.setTimeout(() => win.print(), 300);
}
