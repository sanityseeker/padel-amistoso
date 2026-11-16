import { t as tx, localeTag } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import type { Match, Standing, Score, TournamentStatus, TvSettings } from '../../types';
import { schemaQuery } from '../../bracketSchema';
import { allMatches, formatSets, type TournamentPageData } from './scoring';

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

type Decider = 'full_set' | 'match_tiebreak';
/** A table cell: text (escaped) or ready markup. */
type Cell = string | number | { html: string };

const team = (names: string[]) => names.join(' & ') || tx('To be decided');

/** Score cell: a walkover gets a small label after the score; disputed and unconfirmed scores are flagged. */
function scoreCell(m: Match, decider: Decider): Cell {
  const text = m.sets?.length
    ? formatSets(m.sets as Score[], m.effective_decider ?? decider, ', ')
    : m.score
      ? `${m.score[0]}-${m.score[1]}`
      : '—';
  if (m.walkover) return { html: `${esc(text)}<span class="wo">${esc(tx('Walkover'))}</span>` };
  if (m.disputed) return `${text} (${tx('Disputed')})`;
  if (m.score && m.scored_by && !m.score_confirmed) return `${text} (${tx('Unconfirmed')})`;
  return text;
}

function table(headers: string[], rows: Cell[][], cls = '') {
  const cell = (c: Cell) => (typeof c === 'object' ? c.html : esc(c));
  return `<table${cls ? ` class="${cls}"` : ''}><thead><tr>${headers
    .map((h) => `<th>${esc(h)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${cell(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

interface TableContext {
  comments: boolean;
  /** The entries are teams (a single team entry per side). */
  teams: boolean;
  decider: Decider;
}

/**
 * Whether the entries are teams. A team roster always means teams. In padel `team_mode` means team
 * entries too. In tennis only a play-off's `team_mode` does: tennis Group+Playoff always stores
 * team_mode=true (an individual event just has no roster), and Mexicano's means singles.
 */
export function isTeamEvent(status: TournamentStatus, prefix: string): boolean {
  if (Object.keys(status.team_roster ?? {}).length > 0) return true;
  if (!status.team_mode) return false;
  return (status.sport ?? 'padel') !== 'tennis' || prefix === 'po';
}

/** Side headers read "Player" when every listed match is one player per side. */
function sideHeaders(ms: Match[], teams: boolean): string[] {
  return !teams && ms.length && ms.every((m) => m.team1.length === 1 && m.team2.length === 1)
    ? [tx('Player 1'), tx('Player 2')]
    : [tx('Team 1'), tx('Team 2')];
}

/** A match table. Court and comment columns appear only when a listed match has one. */
function matchTable(matches: Match[], ctx: TableContext, withScore: boolean) {
  const comments = ctx.comments && matches.some((m) => (m.comment ?? '').trim());
  const courts = matches.some((m) => m.court);
  return table(
    [
      tx('Round'),
      ...sideHeaders(matches, ctx.teams),
      ...(withScore ? [tx('Score')] : []),
      ...(courts ? [tx('Court')] : []),
      ...(comments ? [tx('Comment')] : []),
    ],
    matches.map((m) => [
      m.round_label ? formatRoundLabel(m.round_label) : '',
      team(m.team1),
      team(m.team2),
      ...(withScore ? [scoreCell(m, ctx.decider)] : []),
      ...(courts ? [m.court ?? ''] : []),
      ...(comments ? [(m.comment ?? '').trim()] : []),
    ]),
  );
}

const played = (matches: Match[]) => matches.filter((m) => m.status === 'completed');
const count = (matches: Match[]) =>
  tx('{done} of {total} matches played', { done: played(matches).length, total: matches.length });

/** The played matches of one stage as a history table; nothing when there are none. */
function history(heading: string, matches: Match[], ctx: TableContext, level: 2 | 3 = 3) {
  const done = played(matches);
  return done.length ? `<h${level}>${esc(heading)}</h${level}>${matchTable(done, ctx, true)}` : '';
}

/** Not-yet-played matches (court and organizer comment included) of a running tournament. */
function upcomingSection(matches: Match[], ctx: TableContext) {
  const open = matches.filter((m) => m.status !== 'completed');
  return open.length
    ? `<h2>${esc(tx('Upcoming matches'))}</h2>${matchTable(open, ctx, false)}`
    : '';
}

const eloHeader = (status: TournamentStatus) =>
  status.elo_scope === 'club' ? tx('Club ELO') : tx('ELO');
const eloCell = (r: Standing): Cell => (r.elo != null ? String(Math.round(r.elo)) : '—');

/** Group table: record, sets when any were played, points, and the optional ELO column. */
function groupTable(rows: Standing[], status: TournamentStatus, teams: boolean, elo: boolean) {
  const sets = rows.some((r) => (r.sets_won ?? 0) > 0 || (r.sets_lost ?? 0) > 0);
  const games = sets ? { context: 'games' } : undefined;
  return table(
    [
      teams ? tx('Team') : tx('Player'),
      tx('P'),
      tx('W'),
      tx('L'),
      ...(sets ? [tx('SW'), tx('SL'), tx('SD')] : []),
      tx('PF', games),
      tx('PA', games),
      sets ? tx('GD') : tx('PD'),
      ...(elo ? [eloHeader(status)] : []),
    ],
    rows.map((r) => [
      r.withdrawn ? `${r.player} (${tx('Withdrawn')})` : r.player,
      r.played ?? r.matches_played ?? 0,
      r.wins ?? 0,
      r.losses ?? 0,
      ...(sets ? [r.sets_won ?? 0, r.sets_lost ?? 0, r.sets_diff ?? 0] : []),
      r.points_for ?? 0,
      r.points_against ?? 0,
      r.point_diff ?? 0,
      ...(elo ? [eloCell(r)] : []),
    ]),
    'standings',
  );
}

function leaderboardTable(
  rows: Standing[],
  status: TournamentStatus,
  teams: boolean,
  elo: boolean,
) {
  return table(
    [
      tx('Rank'),
      teams ? tx('Team') : tx('Player'),
      tx('Pts'),
      tx('P'),
      tx('W'),
      tx('L'),
      tx('Avg'),
      ...(elo ? [eloHeader(status)] : []),
    ],
    rows.map((r, i) => [
      r.rank ?? i + 1,
      r.player,
      r.total_points ?? 0,
      r.matches_played ?? r.played ?? 0,
      r.wins ?? 0,
      r.losses ?? 0,
      r.avg_points ?? 0,
      ...(elo ? [eloCell(r)] : []),
    ]),
  );
}

// Trophy icon of the champion box. The report loads no stylesheet, so the SVG carries its own size and strokes.
const TROPHY =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#166534" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px" aria-hidden="true"><path d="M6 9H4.5a2.5 2.5 0 010-5H6"/><path d="M18 9h1.5a2.5 2.5 0 000-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0012 0V2z"/></svg>';

function championBox(status: TournamentStatus) {
  if (Array.isArray(status.winners) && status.winners.length > 1)
    return `<div class="champ">${TROPHY} ${esc(tx('Winners'))}: <strong>${status.winners
      .map((w) => esc(w.join(' & ')))
      .join(' · ')}</strong></div>`;
  if (status.champion?.length)
    return `<div class="champ">${TROPHY} ${esc(tx('Champion'))}: <strong>${esc(
      status.champion.join(', '),
    )}</strong></div>`;
  return '';
}

// The report loads no stylesheet: light-mode colours are inlined.
const STYLE = `body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;margin:24px;color:#1f2937}h1{margin:0 0 8px}h2{margin:24px 0 8px;color:#1a5fa3}h3{margin:16px 0 6px}.muted{color:#6b7280;font-size:.92rem;margin-bottom:16px}.champ{margin:12px 0 18px;padding:10px;background:#ecfdf5;border:1px solid #86efac;border-radius:6px}table{width:100%;border-collapse:collapse;margin:10px 0 18px}th,td{border:1px solid #d1d5db;padding:8px;text-align:left;font-size:.9rem}th{background:#f3f4f6}table.standings{table-layout:fixed}table.standings th:first-child{width:28%}.wo{margin-left:6px;padding:0 4px;border:1px solid #b45309;border-radius:4px;color:#92400e;font-size:.75em;font-weight:600;white-space:nowrap}@page{size:A4 landscape}img{width:100%;height:auto}h2,h3{break-after:avoid}tr{break-inside:avoid}`;

export interface BracketImage {
  label: string;
  src: string;
}

/**
 * The bracket images the export can draw. Espejo and double-elimination brackets are two images
 * (winners / losers side); a standalone play-off draws double elimination in one.
 */
export function bracketLabels(page: TournamentPageData): [string, string] | null {
  const { status, prefix } = page;
  const sides = prefix === 'po' ? !!status.espejo : !!status.espejo || !!status.double_elimination;
  if (!sides) return null;
  return status.espejo_split
    ? [tx('Gold'), tx('Silver')]
    : [tx('Winners Bracket'), tx('Losers Bracket')];
}

/** What the export of this page offers: the same rules as the legacy Export tab. */
export function exportParts(page: TournamentPageData) {
  const status = page.status;
  const playoffMatches = page.groupStage ? [] : allMatches(page.data);
  const mexicanoPlayoffs =
    page.prefix === 'mex' && (status.phase === 'playoffs' || playoffMatches.length > 0);
  return {
    hasBracket:
      page.prefix === 'po' ||
      (page.prefix === 'gp' && !page.groupStage) ||
      (page.prefix === 'mex' && mexicanoPlayoffs),
    // Direct Playoffs has no table, so no ELO column to switch on.
    hasStandings: page.prefix !== 'po',
  };
}

export async function bracketImages(
  tid: string,
  prefix: string,
  labels: [string, string] | null,
  settings?: Partial<TvSettings> | null,
): Promise<BracketImage[]> {
  // Reports draw the bracket as an SVG in the app's light colours (the report is a light page meant
  // for printing): sharp at any print size, with the glyphs as paths so no font is needed. A very large
  // drawing falls back to a PNG.
  const MAX_SVG_URI = 2_000_000;
  const fetchUri = async (format: 'svg' | 'png', extra: Record<string, string>) => {
    const res = await fetch(
      `/api/tournaments/${tid}/${prefix}/playoffs-schema?${schemaQuery({ ...(settings ?? {}), schema_format: format }, { ...extra, theme: 'light' })}`,
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };
  const read = async (extra: Record<string, string>): Promise<string | null> => {
    try {
      const svg = await fetchUri('svg', extra);
      if (svg && svg.length <= MAX_SVG_URI) return svg;
      return await fetchUri('png', extra);
    } catch {
      /* A missing diagram never blocks the export. */
      return null;
    }
  };
  if (!labels) {
    const src = await read({});
    return src ? [{ label: '', src }] : [];
  }
  const [winners, losers] = await Promise.all([
    read({ side: 'winners' }),
    read({ side: 'losers' }),
  ]);
  return [
    { label: labels[0], src: winners },
    { label: labels[1], src: losers },
  ].filter((i): i is BracketImage => !!i.src);
}

// A standalone HTML report of the tournament in any phase (the legacy export, built from the
// workspace query). Stage order: champion, upcoming matches (running phase only), play-offs
// (bracket and history), then the earlier stage (group stage or Mexicano rounds) with its table
// and matches. Every stage has its own played count.
export function buildReport(args: {
  name: string;
  page: TournamentPageData;
  options: ExportOptions;
  images: BracketImage[];
  now: Date;
}): { html: string; title: string; filename: string; finished: boolean } {
  const { name, page, options, images, now } = args;
  const { status, prefix } = page;
  const finished = status.phase === 'finished';
  const ctx: TableContext = {
    comments: options.comments,
    teams: isTeamEvent(status, prefix),
    decider: page.settings.set_decider,
  };
  const withElo = options.elo && prefix !== 'po';
  // The live stage keeps `page.data`; the stage before it sits in `page.groups` / `page.rounds`.
  const liveMatches = allMatches(page.data);
  const livePending = page.data.pending ?? liveMatches.filter((m) => m.status !== 'completed');
  let playoffMatches: Match[] = [];
  let playoffPending: Match[] = [];
  let groupMatches: Match[] = [];
  let groupRows: Record<string, Standing[]> = {};
  let roundMatches: Match[] = [];
  let upcoming: Match[] = [];
  let progress: string | null = null;
  if (prefix === 'gp') {
    const groups = page.groupStage ? page.data : page.groups;
    groupMatches = groups ? allMatches(groups) : [];
    groupRows = groups?.standings ?? {};
    if (!page.groupStage) {
      playoffMatches = liveMatches;
      playoffPending = livePending;
    }
    upcoming = page.groupStage ? groupMatches : playoffPending;
    if (page.groupStage) progress = `${tx('Group stage')} · ${count(groupMatches)}`;
    else if (!finished) progress = `${tx('Play-offs')} · ${count(playoffMatches)}`;
  } else if (prefix === 'po') {
    playoffMatches = liveMatches;
    playoffPending = livePending;
    upcoming = playoffPending;
    if (!finished) progress = `${tx('Play-offs')} · ${count(playoffMatches)}`;
  } else {
    const inMexicano = status.phase === 'mexicano';
    if (inMexicano) {
      roundMatches = page.data.all_matches ?? liveMatches;
      upcoming = page.data.current_matches ?? [];
    } else {
      playoffMatches = liveMatches;
      playoffPending = livePending;
      roundMatches = page.rounds ? allMatches(page.rounds) : [];
      upcoming = playoffPending;
    }
    if (!finished) {
      if (!inMexicano) progress = tx('Play-offs');
      else if (status.rolling)
        progress = `${tx('Round {round}', { round: status.current_round ?? 0 })} · ${tx('Rolling')}`;
      else
        progress = tx('Round {round} of {total}', {
          round: status.current_round ?? 0,
          total: status.num_rounds ?? 0,
        });
    }
  }
  const hasPlayoffs =
    prefix === 'po' ||
    (prefix === 'gp' && !page.groupStage) ||
    (prefix === 'mex' && (status.phase === 'playoffs' || playoffMatches.length > 0));

  const heading = finished ? tx('Results') : tx('Standings snapshot');
  let body = `<h1>${esc(name)} — ${esc(heading)}</h1><div class="muted">${esc(
    tx('Generated {value}', { value: now.toLocaleString(localeTag()) }),
  )}${progress ? ` · ${esc(progress)}` : ''}</div>`;
  body += championBox(status);
  if (!finished && options.upcoming) body += upcomingSection(upcoming, ctx);

  // Play-offs: bracket, then their matches.
  if (hasPlayoffs) {
    body += `<h2>${esc(tx('Play-offs'))}</h2><p class="muted">${esc(count(playoffMatches))}</p>`;
    if (options.bracket && images.length) {
      body += `<h3>${esc(tx('Play-off bracket'))}</h3>`;
      for (const img of images) {
        if (img.label) body += `<h4>${esc(img.label)}</h4>`;
        body += `<img src="${img.src}" alt="${esc(img.label || tx('Play-off bracket'))}">`;
      }
    }
    if (options.history) body += history(tx('Match history'), playoffMatches, ctx);
  }

  // The stage before the play-offs (or the only stage, before they start).
  if (prefix === 'gp') {
    body += `<h2>${esc(tx('Group stage'))}</h2><p class="muted">${esc(count(groupMatches))}</p>`;
    for (const [group, rows] of Object.entries(groupRows)) {
      body += `<h3>${esc(tx('Group {name}', { name: group }))}</h3>${groupTable(rows, status, ctx.teams, withElo)}`;
      for (const w of (status.withdrawals ?? []).filter(
        (x) => x.kind === 'annul' && x.group === group,
      ))
        body += `<p>${esc(tx('{names} withdrew; their results in this group were annulled.', { names: w.name }))}</p>`;
    }
    if (options.history) body += history(tx('Match history'), groupMatches, ctx);
  } else if (prefix === 'mex') {
    body += `<h2>${esc(tx('Mexicano rounds'))}</h2><p class="muted">${esc(count(roundMatches))}</p>`;
    body += `<h3>${esc(tx('Leaderboard'))}</h3>${leaderboardTable(status.leaderboard ?? [], status, ctx.teams, withElo)}`;
    if (options.history) body += history(tx('Match history'), roundMatches, ctx);
  }

  const slug =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'tournament';
  const pad = (n: number) => String(n).padStart(2, '0');
  // Local time, as the legacy export named its snapshots.
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return {
    html: `<!doctype html><html lang="${esc(localeTag().slice(0, 2))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(name)} ${esc(heading)}</title><style>${STYLE}</style></head><body>${body}</body></html>`,
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
