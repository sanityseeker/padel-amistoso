import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Collapse,
  Group,
  Paper,
  Popover,
  Stack,
  Table,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronRight, IconInfoCircle, IconTrophy } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import type { Match, Standing } from '../../types';
import type { PlayerMatch } from '../../player/types';
import type { Ctx } from '../../admin/tournament/scoring';
import { MatchActions } from '../player/MatchActions';
import type { ScoringData } from '../player/eventData';
import { hasDraws, MatchCard, StandingsTable, toMatchView, toStandingRows } from '../tournaments';
import { BracketImage } from './BracketImage';
import { ctxOf, isTbd, sortTbdLast, type Breakdown, type TvLive, type TvMeta } from './model';
import type { useTvPlayer } from './useTvPlayer';
import { Section, type OpenState } from './TvSection';
import classes from './Tv.module.css';
import { Notice } from '../../ui/Notice';

type Player = ReturnType<typeof useTvPlayer>;

const ENDPOINT: Record<Ctx, string> = {
  'gp-group': 'gp/record-group',
  'gp-playoff': 'gp/record-playoff',
  mex: 'mex/record',
  'mex-playoff': 'mex/record-playoff',
  'po-playoff': 'po/record',
};

// ---- Column legend --------------------------------------------------------------------------------------

type LegendRow = [abbrev: string, full: string, context?: string];

// `sets`: the table counts games (PF/PA read as games won/lost) and ranks by game difference, so the
// legend names the same columns the table shows. `draws`: the phone record column reads W–L–D.
function Legend({
  kind,
  sets = false,
  draws = false,
}: {
  kind: 'standings' | 'leaderboard' | 'double';
  sets?: boolean;
  draws?: boolean;
}) {
  useLocale();
  // A phone shows one W–L record column instead of W and L; it is listed at every width, since the
  // popover cannot tell which columns the table shows.
  const record: LegendRow[] = [
    ['P', 'Matches played'],
    ['W', 'Matches won'],
    ['L', 'Matches lost'],
    draws ? ['W–L–D', 'Wins, losses and draws'] : ['W–L', 'Wins and losses'],
  ];
  const scoring: LegendRow[] = sets
    ? [
        ['SW', 'Sets won'],
        ['SL', 'Sets lost'],
        ['SD', 'Set difference'],
        ['PF', 'Points for', 'games'],
        ['PA', 'Points against', 'games'],
        ['GD', 'Game difference'],
      ]
    : [
        ['PF', 'Points for'],
        ['PA', 'Points against'],
        ['PD', 'Point difference'],
      ];
  const rows: LegendRow[] =
    kind === 'standings'
      ? [...record, ...scoring]
      : [
          ['Pts', 'Total points'],
          ...record,
          ['Avg', 'Average points per match'],
          ['Bh', 'Buchholz tie-break'],
        ];
  return (
    <Popover width={320} position="bottom-end" shadow="md" withinPortal>
      <Popover.Target>
        <ActionIcon
          aria-label={kind === 'double' ? tx('About double elimination') : tx('Column legend')}
          size="lg"
        >
          <IconInfoCircle size={20} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        {kind === 'double' ? (
          <Stack gap={4}>
            <Text fw={700}>{tx('Double Elimination')}</Text>
            <Text size="sm">
              {tx('Everyone gets a second chance: you need to lose twice to be knocked out.')}
            </Text>
            <Text size="sm">
              {tx(
                'Lost a match? You move to the Losers Bracket and still have a shot at the final.',
              )}
            </Text>
            <Text size="xs" c="dimmed">
              <Text span c="orange" fw={700}>
                {tx('Orange')}
              </Text>
              {` = ${tx('Winners Bracket')} · `}
              <Text span c="red" fw={700}>
                {tx('Red')}
              </Text>
              {` = ${tx('Losers Bracket')}`}
            </Text>
          </Stack>
        ) : (
          <Stack gap="xs">
            <Table withRowBorders={false} verticalSpacing={2}>
              <Table.Tbody>
                {rows.map(([abbrev, full, context]) => (
                  <Table.Tr key={abbrev}>
                    <Table.Td fw={700}>{tx(abbrev, { context })}</Table.Td>
                    {/* `abbr` descriptions start with the abbreviation's letter; most keys have none. */}
                    <Table.Td>{tx(full, { context: context ?? 'abbr' })}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Text size="xs" c="dimmed">
              <b>{tx('Tiebreaker order')}</b>
              <br />
              {kind === 'standings'
                ? tx('1. Wins  2. Sets diff (sets scoring)  3. Point diff  4. Points for')
                : tx('1. Total points  2. Buchholz (opponent strength)')}
            </Text>
          </Stack>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}

// ---- Matches --------------------------------------------------------------------------------------------

const trl = formatRoundLabel;

/** Round title naming the Espejo bracket: "Semi-Final (Gold)". Both brackets reuse the round names. */
function roundTitle(m: Pick<Match, 'bracket_side'>, base: string, split: boolean) {
  const round = trl(base);
  const side = m.bracket_side;
  if (!side || !round) return round;
  return `${round} (${
    split
      ? tx(side === 'losers' ? 'Silver' : 'Gold')
      : tx(side === 'losers' ? 'Losers Bracket' : 'Winners Bracket')
  })`;
}

interface Scope {
  tid: string;
  live: TvLive;
  player: Player;
  split: boolean;
  scoring: (ctx: Ctx) => ScoringData;
  onCard: (id: string) => void;
}

function TvMatch({
  m,
  ctx,
  scope,
  pending = false,
  court = false,
  groupedRound = false,
  base,
  breakdown,
  playerMap,
}: {
  m: Match;
  ctx: Ctx;
  scope: Scope;
  pending?: boolean;
  court?: boolean;
  groupedRound?: boolean;
  base?: string;
  breakdown?: Record<string, Breakdown>;
  playerMap?: Record<string, string>;
}) {
  useLocale();
  const { live, player } = scope;
  const view = {
    ...toMatchView(m, live.settings, ctx),
    roundLabel: groupedRound ? null : roundTitle(m, base ?? m.round_label, scope.split) || null,
  };
  const data = scope.scoring(ctx);
  const ids = [...(m.team1_ids ?? []), ...(m.team2_ids ?? [])];
  const playing = !!player.session && data.expand(ids).includes(player.session.playerId);
  const mine = playing && !isTbd(m);
  const footer =
    mine && !m.walkover && player.session ? (
      <MatchActions
        match={m as PlayerMatch}
        entry={{ entity_id: scope.tid, player_id: player.session.playerId }}
        data={data}
        token={player.token}
      />
    ) : undefined;
  return (
    <MatchCard
      match={view}
      density="tv"
      testId="tv-match"
      hideScores={pending}
      showCourt={!court && live.status.assign_courts !== false}
      yours={playing && pending && !court}
      footer={
        <>
          {footer}
          {m.comment && (
            <Text size="sm" c="dimmed" mt={4} data-testid="match-comment">
              {m.comment}
            </Text>
          )}
          {breakdown && Object.keys(breakdown).length > 0 && (
            <ScoreBreakdown
              data={breakdown}
              playerMap={playerMap ?? {}}
              weight={live.status.strength_weight ?? 0}
            />
          )}
        </>
      }
    />
  );
}

function ScoreBreakdown({
  data,
  playerMap,
  weight,
}: {
  data: Record<string, Breakdown>;
  playerMap: Record<string, string>;
  weight: number;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  return (
    <Box mt="xs">
      <UnstyledButton onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Text size="sm" c="court" fw={600}>
          {tx('Score breakdown')}
        </Text>
      </UnstyledButton>
      <Collapse expanded={open}>
        <Table.ScrollContainer minWidth={0}>
          <Table verticalSpacing={4} fz="sm">
            <Table.Thead>
              <Table.Tr>
                {[
                  'Player',
                  'Raw',
                  'Rel. str.',
                  'Weight',
                  'Multiplier',
                  'Loss disc ×',
                  'Win bonus',
                  'Final',
                ].map((h) => (
                  <Table.Th key={h}>{tx(h)}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {Object.entries(data).map(([pid, d]) => {
                const rs = d.relative_strength || 0;
                return (
                  <Table.Tr key={pid}>
                    <Table.Td>{playerMap[pid] || pid}</Table.Td>
                    <Table.Td>{d.raw}</Table.Td>
                    <Table.Td>{rs > 0 ? rs.toFixed(3) : '—'}</Table.Td>
                    <Table.Td>{weight > 0 ? `×${weight}` : '—'}</Table.Td>
                    <Table.Td>
                      {d.strength_mult !== 1 ? `×${d.strength_mult.toFixed(2)}` : '—'}
                    </Table.Td>
                    <Table.Td>{d.loss_disc !== 1 ? `×${d.loss_disc.toFixed(2)}` : '—'}</Table.Td>
                    <Table.Td>{d.win_bonus > 0 ? `+${d.win_bonus}` : '—'}</Table.Td>
                    <Table.Td fw={700}>{d.final}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Collapse>
    </Box>
  );
}

/** Matches grouped by the round title they show, in first-seen order, with undecided matches last. */
function byRound(matches: Match[], split: boolean, insideGroup = false) {
  const groups = new Map<string, Match[]>();
  for (const m of matches) {
    const groupRound = insideGroup ? /^Group .+ R(\d+)$/.exec(m.round_label) : null;
    const key = groupRound
      ? tx('Round {round}', { round: groupRound[1] })
      : roundTitle(m, m.round_label, split);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  for (const [key, list] of groups) groups.set(key, sortTbdLast(list));
  return groups;
}

function PendingList({
  matches,
  ctx,
  scope,
  grouped,
  state,
}: {
  matches: Match[];
  ctx: Ctx;
  scope: Scope;
  grouped: Record<string, Match[]> | null;
  state: OpenState;
}) {
  const block = (rounds: Map<string, Match[]>) =>
    [...rounds].map(([title, list]) => (
      <Stack key={title} gap="xs">
        {title && (
          <Text variant="eyebrow" className={classes.small}>
            {title}
          </Text>
        )}
        <div className={classes.courts}>
          {list.map((m) => (
            <TvMatch key={m.id} m={m} ctx={ctx} scope={scope} pending groupedRound />
          ))}
        </div>
      </Stack>
    ));
  if (grouped)
    return (
      <Stack gap="md">
        {Object.entries(grouped).map(([name, list]) => {
          const id = `pending-group-${name}`;
          const open = state.isOpen(id);
          return (
            <Box key={name}>
              <UnstyledButton aria-expanded={open} onClick={() => state.toggle(id)}>
                <Group gap="xs">
                  <IconChevronRight
                    size={18}
                    style={{ transform: open ? 'rotate(90deg)' : undefined }}
                    aria-hidden
                  />
                  <Text fw={700} className={classes.text}>
                    {name}
                  </Text>
                </Group>
              </UnstyledButton>
              <Collapse expanded={open}>
                <Stack gap="md" pt="xs">
                  {block(
                    new Map(
                      [...byRound(list, scope.split, true)].map(
                        ([k, v]) => [k, v] as [string, Match[]],
                      ),
                    ),
                  )}
                </Stack>
              </Collapse>
            </Box>
          );
        })}
      </Stack>
    );
  return <Stack gap="md">{block(byRound(matches, scope.split))}</Stack>;
}

/** Each court shows only its next match (the lowest slot number). */
function currentByCourt(matches: Match[]) {
  const current = new Map<string, Match>();
  for (const m of matches) {
    if (!m.court) continue;
    const slot = m.slot_number ?? 0;
    const have = current.get(m.court);
    if (!have || slot < (have.slot_number ?? 0)) current.set(m.court, m);
  }
  return current;
}

/**
 * The signed-in player's own scheduled matches, for when the organizer keeps the full pending list
 * off. A match already on a court card is not repeated.
 */
function YourMatches({
  matches,
  onCourt,
  ctx,
  scope,
  state,
}: {
  matches: Match[];
  onCourt: Match[];
  ctx: Ctx;
  scope: Scope;
  state: OpenState;
}) {
  useLocale();
  const sid = scope.player.session?.playerId;
  if (!sid) return null;
  const { expand } = scope.scoring(ctx);
  const shown = new Set(onCourt.map((m) => m.id));
  const mine = matches.filter(
    (m) =>
      !shown.has(m.id) && expand([...(m.team1_ids ?? []), ...(m.team2_ids ?? [])]).includes(sid),
  );
  if (mine.length === 0) return null;
  return (
    <Section id="your-matches" title={tx('Your matches')} state={state}>
      <PendingList matches={mine} ctx={ctx} scope={scope} grouped={null} state={state} />
    </Section>
  );
}

function Courts({
  title,
  matches,
  ctx,
  scope,
  assignCourts,
  showPending,
  grouped,
  state,
}: {
  title: string;
  matches: Match[];
  ctx: Ctx;
  scope: Scope;
  assignCourts: boolean;
  showPending: boolean;
  grouped: Record<string, Match[]> | null;
  state: OpenState;
}) {
  useLocale();
  if (!assignCourts && !showPending) return null;
  const pending = (
    <Section id="pending" title={tx('Pending matches')} state={state}>
      {matches.length === 0 ? (
        <Text c="dimmed">{tx('No pending court assignments')}</Text>
      ) : (
        <PendingList matches={matches} ctx={ctx} scope={scope} grouped={grouped} state={state} />
      )}
    </Section>
  );
  if (!assignCourts) return pending;
  const current = currentByCourt(matches);
  const names = [...current.keys()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
  const sid = scope.player.session?.playerId;
  return (
    <>
      <Section id="courts" title={title} state={state}>
        {names.length === 0 ? (
          <Text c="dimmed">{tx('No pending court assignments')}</Text>
        ) : (
          <div className={classes.courts} data-testid="tv-courts">
            {names.map((name) => {
              const m = current.get(name)!;
              const yours =
                !!sid &&
                !isTbd(m) &&
                scope
                  .scoring(ctx)
                  .expand([...(m.team1_ids ?? []), ...(m.team2_ids ?? [])])
                  .includes(sid);
              return (
                <Paper
                  key={name}
                  p="sm"
                  className={classes.court}
                  data-yours={yours ? '' : undefined}
                  data-testid="tv-court"
                >
                  <Group justify="space-between" mb="xs">
                    <Text className={classes.courtName}>{name}</Text>
                    {yours && (
                      <Badge color="court" size="lg">
                        {tx('Your match')}
                      </Badge>
                    )}
                  </Group>
                  <TvMatch m={m} ctx={ctx} scope={scope} pending court />
                </Paper>
              );
            })}
          </div>
        )}
      </Section>
      {showPending && pending}
    </>
  );
}

function PastMatches({
  id,
  title,
  matches,
  ctx,
  scope,
  state,
  mexicano,
}: {
  id: string;
  title: string;
  matches: Match[];
  ctx: Ctx;
  scope: Scope;
  state: OpenState;
  mexicano?: boolean;
}) {
  useLocale();
  if (!matches.length) return null;
  // Rounds newest first; a round is named by its label (or its number) and, for Espejo, its side.
  const rounds = new Map<string, Match[]>();
  for (const m of matches) {
    const base = m.round_label || `Round ${m.round_number ?? 0}`;
    const key = m.bracket_side ? `${m.bracket_side}|${base}` : base;
    rounds.set(key, [...(rounds.get(key) ?? []), m]);
  }
  const keys = [...rounds.keys()].reverse();
  const { settings } = scope.live;
  const playerMap = Object.fromEntries(
    (scope.live.status.players ?? []).map((p) => [p.id, p.name]),
  );
  return (
    <Section id={id} title={title} state={state}>
      <Stack gap="md">
        {keys.map((key, index) => {
          const list = rounds.get(key)!;
          const sep = key.indexOf('|');
          const heading = sep > 0 ? roundTitle(list[0], key.slice(sep + 1), scope.split) : trl(key);
          const rid = `${id}-${key}`;
          const open = state.isOpen(rid, index === 0);
          return (
            <Box key={key}>
              <UnstyledButton aria-expanded={open} onClick={() => state.toggle(rid, index === 0)}>
                <Group gap="xs">
                  <IconChevronRight
                    size={18}
                    style={{ transform: open ? 'rotate(90deg)' : undefined }}
                    aria-hidden
                  />
                  <Text fw={700} className={classes.text}>
                    {heading} — {list.length} {list.length > 1 ? tx('matches') : tx('match')}
                  </Text>
                </Group>
              </UnstyledButton>
              <Collapse expanded={open}>
                <div className={classes.courts} style={{ paddingTop: 8 }}>
                  {list.map((m) => (
                    <TvMatch
                      key={m.id}
                      m={m}
                      ctx={ctx}
                      scope={scope}
                      base={m.round_label || `Round ${m.round_number ?? 0}`}
                      breakdown={
                        mexicano && settings.show_score_breakdown
                          ? scope.live.rounds?.breakdowns?.[m.id]
                          : undefined
                      }
                      playerMap={playerMap}
                    />
                  ))}
                </div>
              </Collapse>
            </Box>
          );
        })}
      </Stack>
    </Section>
  );
}

// ---- Standings ------------------------------------------------------------------------------------------

function standingsRows(rows: Standing[]) {
  return toStandingRows(rows);
}

function GroupStandings({
  live,
  meta,
  scope,
  state,
  highlight,
}: {
  live: TvLive;
  meta: TvMeta;
  scope: Scope;
  state: OpenState;
  highlight?: string;
}) {
  useLocale();
  const status = live.status;
  const teams = Object.keys(status.team_roster ?? {}).length > 0;
  const groups = Object.entries(live.groups?.standings ?? {});
  const all = groups.flatMap(([, rows]) => standingsRows(rows));
  const setsMode = live.settings.score_mode?.['gp-group'] === 'sets';
  // The same test StandingsTable uses to switch to set columns.
  const sets = setsMode || all.some((r) => (r.setsWon ?? 0) > 0 || (r.setsLost ?? 0) > 0);
  return (
    <Section
      id="standings"
      title={tx('Group standings')}
      state={state}
      info={<Legend kind="standings" sets={sets} draws={hasDraws(all)} />}
    >
      <div className={classes.groups}>
        {groups.map(([name, rows]) => (
          <Stack key={name} gap="xs">
            <Title order={3} className={classes.text}>
              {tx('Group {value}', { value: name })}
            </Title>
            <StandingsTable
              rows={standingsRows(rows)}
              preset="group"
              density="tv"
              sets={setsMode}
              highlightId={highlight}
              nameLabel={teams ? tx('Team') : undefined}
              eloLabel={meta && status.elo_scope === 'club' ? tx('Club ELO') : undefined}
              onSelect={(row) => scope.onCard(row.id)}
            />
            {(status.withdrawals ?? [])
              .filter((w) => w.kind === 'annul' && w.group === name)
              .map((w) => (
                <Text key={w.entry_key} size="sm" c="dimmed">
                  {tx('{names} withdrew; their results in this group were annulled.', {
                    names: w.name,
                  })}
                </Text>
              ))}
          </Stack>
        ))}
      </div>
    </Section>
  );
}

function Leaderboard({
  live,
  scope,
  state,
  highlight,
}: {
  live: TvLive;
  scope: Scope;
  state: OpenState;
  highlight?: string;
}) {
  useLocale();
  const status = live.status;
  const teams = Object.keys(status.team_roster ?? {}).length > 0;
  const rows = standingsRows(status.leaderboard ?? []);
  return (
    <Section
      id="standings"
      title={tx('Leaderboard')}
      state={state}
      info={<Legend kind="leaderboard" draws={hasDraws(rows)} />}
    >
      <StandingsTable
        rows={rows}
        preset="mexicano"
        density="tv"
        highlightId={highlight}
        nameLabel={teams ? tx('Team') : undefined}
        eloLabel={status.elo_scope === 'club' ? tx('Club ELO') : undefined}
        onSelect={(row) => scope.onCard(row.id)}
      />
    </Section>
  );
}

// ---- Champions ------------------------------------------------------------------------------------------

function Champions({ live }: { live: TvLive }) {
  useLocale();
  const s = live.status;
  const espejo = s.espejo === true;
  const superFinal = espejo && s.espejo_super_final === true;
  const champion = s.champion || (espejo && !superFinal ? s.winners_champion : null);
  const consolation = espejo && !superFinal ? s.losers_champion : null;
  if (Array.isArray(s.winners) && s.winners.length > 1)
    return (
      <Notice icon={<IconTrophy />} title={tx('Winners')} data-testid="tv-champion">
        <Text className={classes.banner}>{s.winners.map((w) => w.join(' & ')).join(' · ')}</Text>
      </Notice>
    );
  return (
    <>
      {champion && (
        <Notice icon={<IconTrophy />} title={tx('Champion')} data-testid="tv-champion">
          <Text className={classes.banner} fw={700}>
            {champion.join(' & ')}
          </Text>
        </Notice>
      )}
      {consolation && (
        <Notice
          tone="neutral"
          icon={<IconTrophy />}
          title={tx(s.espejo_split ? 'Silver bracket winner' : 'Consolation winner')}
        >
          <Text className={classes.banner} fw={700}>
            {consolation.join(' & ')}
          </Text>
        </Notice>
      )}
    </>
  );
}

// ---- The board ------------------------------------------------------------------------------------------

export interface TvSectionInfo {
  key: string;
  label: string;
}

/** The sections a tournament shows right now, for the presentation cycle. */
export function sectionKeys(live: TvLive): TvSectionInfo[] {
  const s = live.settings;
  const phase = live.status.phase || '';
  const out: TvSectionInfo[] = [];
  const hasCourts = live.status.assign_courts !== false;
  if ((hasCourts && s.show_courts !== false) || s.show_pending_matches === true)
    out.push({ key: 'courts', label: tx('Court assignments') });
  if (s.show_standings && live.kind !== 'playoff' && phase !== 'playoffs' && phase !== 'finished')
    out.push({ key: 'standings', label: tx('Standings') });
  if (
    s.show_bracket &&
    live.kind !== 'mexicano' &&
    (phase === 'playoffs' || phase === 'finished' || live.kind === 'playoff')
  )
    out.push({ key: 'bracket', label: tx('Play off bracket') });
  // A Mexicano that ended without play-offs has no bracket to show.
  if (
    s.show_bracket &&
    live.kind === 'mexicano' &&
    (phase === 'playoffs' || phase === 'finished') &&
    live.playoffs.matches.length > 0
  )
    out.push({ key: 'bracket', label: tx('Play off bracket') });
  if (
    (phase === 'playoffs' || phase === 'finished') &&
    s.show_standings &&
    live.kind === 'mexicano'
  )
    out.push({ key: 'standings', label: tx('Standings') });
  if (s.show_past_matches) out.push({ key: 'past', label: tx('Past matches') });
  return [...new Map(out.map((o) => [o.key, o])).values()];
}

export function TvBoard({
  tid,
  meta,
  live,
  player,
  onCard,
  only,
  state,
}: {
  tid: string;
  /** Open/closed state of the sections, shared with the page's own sections. */
  state: OpenState;
  meta: TvMeta;
  live: TvLive;
  player: Player;
  onCard: (id: string) => void;
  /** Presentation mode shows one section at a time. */
  only?: string;
}) {
  useLocale();
  const { settings, status, playoffs } = live;
  const phase = status.phase || '';
  const playoffPhase = phase === 'playoffs' || phase === 'finished';
  const split = status.espejo_split === true;
  const roster = status.team_roster ?? {};
  const scoring = (ctx: Ctx): ScoringData => ({
    tv: {
      allow_player_scoring: settings.allow_player_scoring !== false,
      score_mode: settings.score_mode ?? {},
      set_decider: settings.set_decider ?? 'full_set',
      score_confirmation: settings.score_confirmation ?? 'immediate',
      correction_window_seconds: settings.correction_window_seconds ?? 0,
    },
    expand: (ids) => ids.flatMap((x) => [x, ...(roster[x] || [])]),
    endpoint: ENDPOINT[ctx],
    context: ctx,
    setsAvailable: ctx !== 'mex',
    historyIds: new Set<string>(),
  });
  const scope: Scope = { tid, live, player, split, scoring, onCard };
  const hasCourts = status.assign_courts !== false;
  const showCourts = hasCourts && settings.show_courts !== false;
  const sid = player.session?.playerId;
  const show = (key: string) => !only || only === key;

  let pendingMatches: Match[] = [];
  let grouped: Record<string, Match[]> | null = null;
  const courtTitle = tx('Court assignments');
  const kind = live.kind;
  const ctx = ctxOf(kind, playoffPhase);
  if (kind === 'group_playoff') {
    const all = Object.entries(live.groups?.matches ?? {});
    pendingMatches = playoffPhase
      ? sortTbdLast(playoffs.pending.filter((m) => m.status !== 'completed'))
      : sortTbdLast(all.flatMap(([, list]) => list).filter((m) => m.status !== 'completed'));
    if (!playoffPhase) {
      const by: Record<string, Match[]> = {};
      for (const [name, list] of all) {
        const open = sortTbdLast(list.filter((m) => m.status !== 'completed'));
        if (open.length) by[name] = open;
      }
      grouped = Object.keys(by).length ? by : null;
    }
  } else if (kind === 'playoff') {
    pendingMatches = sortTbdLast(playoffs.pending.filter((m) => m.status !== 'completed'));
  } else {
    pendingMatches = sortTbdLast(
      (playoffPhase ? playoffs.pending : (live.rounds?.current_matches ?? [])).filter(
        (m) => m.status !== 'completed',
      ),
    );
  }

  const hasBracket = kind !== 'mexicano' || playoffs.matches.length > 0;
  const bracket = settings.show_bracket && (kind === 'playoff' || (playoffPhase && hasBracket)) && (
    <Section
      id="bracket"
      title={tx('Play off bracket')}
      state={state}
      info={status.double_elimination && !status.espejo ? <Legend kind="double" /> : undefined}
    >
      <BracketImage
        tid={tid}
        kind={kind}
        settings={settings}
        playoffs={playoffs}
        doubleElimination={status.double_elimination === true && status.espejo !== true}
        espejo={status.espejo === true}
        split={split}
      />
    </Section>
  );
  const playoffPast = playoffs.matches.filter((m) => m.status === 'completed');
  const playoffCtx =
    kind === 'playoff' ? 'po-playoff' : kind === 'group_playoff' ? 'gp-playoff' : 'mex-playoff';
  const past = (id: string, title: string, list: Match[], c: Ctx, mexicano?: boolean) =>
    settings.show_past_matches && (
      <PastMatches
        id={id}
        title={title}
        matches={list.filter((m) => m.status === 'completed')}
        ctx={c}
        scope={scope}
        state={state}
        mexicano={mexicano}
      />
    );
  const standings =
    settings.show_standings &&
    (kind === 'group_playoff' && !playoffPhase ? (
      <GroupStandings live={live} meta={meta} scope={scope} state={state} highlight={sid} />
    ) : kind === 'mexicano' ? (
      <Leaderboard live={live} scope={scope} state={state} highlight={sid} />
    ) : null);

  return (
    <Stack gap="lg">
      {show('courts') && (
        <Courts
          title={courtTitle}
          matches={pendingMatches}
          ctx={ctx}
          scope={scope}
          assignCourts={showCourts}
          showPending={settings.show_pending_matches === true}
          grouped={grouped}
          state={state}
        />
      )}
      {!only && settings.show_pending_matches !== true && (
        <YourMatches
          matches={pendingMatches}
          onCourt={showCourts ? [...currentByCourt(pendingMatches).values()] : []}
          ctx={ctx}
          scope={scope}
          state={state}
        />
      )}
      {kind === 'group_playoff' && playoffPhase && (
        <>
          {show('past') && past('past-playoffs', tx('Play off matches'), playoffPast, playoffCtx)}
          {show('bracket') && bracket}
          {show('past') &&
            past(
              'past-groups',
              tx('Group stage matches'),
              Object.values(live.groups?.matches ?? {}).flat(),
              'gp-group',
            )}
        </>
      )}
      {kind === 'group_playoff' && !playoffPhase && (
        <>
          {show('standings') && standings}
          {show('past') &&
            past(
              'past-groups',
              tx('Group stage matches'),
              Object.values(live.groups?.matches ?? {}).flat(),
              'gp-group',
            )}
        </>
      )}
      {kind === 'playoff' && (
        <>
          {show('bracket') && bracket}
          {show('past') && past('past-playoffs', tx('Play off matches'), playoffPast, 'po-playoff')}
        </>
      )}
      {kind === 'mexicano' && (
        <>
          {playoffPhase &&
            show('past') &&
            past('past-playoffs', tx('Play off matches'), playoffPast, 'mex-playoff')}
          {playoffPhase && hasBracket && show('bracket') && bracket}
          {show('standings') && standings}
          {show('past') &&
            past(
              'past-mexicano',
              tx('Mexicano rounds'),
              live.rounds?.all_matches ?? [],
              'mex',
              true,
            )}
        </>
      )}
    </Stack>
  );
}

export { Champions };
