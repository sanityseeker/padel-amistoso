import { Fragment, useState, type CSSProperties } from 'react';
import { ActionIcon, Skeleton, Stack, Table, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { useElementSize } from '@mantine/hooks';
import { IconChevronDown, IconId, IconUserMinus } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import classes from './StandingsTable.module.css';
import { StatusBadge } from '../../ui/StatusBadge';

export interface StandingRow {
  id: string;
  name: string;
  played?: number;
  wins?: number;
  losses?: number;
  points?: number;
  elo?: number | null;
  /** Mexicano: average points per match and the Buchholz tie-break. */
  avg?: number;
  buchholz?: number | null;
  /** Position given by the backend. It is `null` for removed players. */
  rank?: number | null;
  /** The backend ranks by `avg` instead of total points when match counts differ. */
  rankedByAvg?: boolean;
  removed?: boolean;
  withdrawn?: boolean;
  setsWon?: number;
  setsLost?: number;
  setsDiff?: number;
  pointsFor?: number;
  pointsAgainst?: number;
  pointDiff?: number;
  /** Extra line shown in the expanded row (for example a tier name). */
  note?: string;
}

export interface StandingsTableProps {
  rows: StandingRow[];
  /** `group` and `mexicano` rank by points; `leaderboard` ranks by ELO (Player Hub, club page). */
  preset: 'group' | 'mexicano' | 'leaderboard';
  /** The signed-in player's row gets a rule and a tint. */
  highlightId?: string;
  /** The first N rows qualify; a dashed line closes them. */
  qualifyCount?: number;
  density?: 'md' | 'compact' | 'tv';
  /** Header of the name column; teams are "Team". */
  nameLabel?: string;
  /** Label of the rating column ("Club ELO" in club tournaments). */
  eloLabel?: string;
  /** Spectator pages: a small button beside each name opens that player's card. */
  onSelect?: (row: StandingRow) => void;
  /** The tournament scores these matches in sets (its score mode). Sets in the rows also count. */
  sets?: boolean;
}

type NumKey =
  | 'played'
  | 'elo'
  | 'buchholz'
  | 'setsWon'
  | 'setsLost'
  | 'setsDiff'
  | 'pointsAgainst'
  | 'pointDiff';
interface Column {
  key: string;
  label: string;
  title?: string;
  /** Value used for display and for sorting. */
  get: (r: StandingRow) => number | null | undefined;
  digits?: number;
  /** Narrowest container width (px) that still shows the column; narrower ones move to the expanded row. */
  min?: number;
  score?: boolean;
}
const num =
  (k: NumKey) =>
  (r: StandingRow): number | null | undefined =>
    r[k] as number | null | undefined;

function columnsFor(
  preset: StandingsTableProps['preset'],
  rows: StandingRow[],
  eloLabel: string,
  setsMode = false,
): Column[] {
  const elo: Column = { key: 'elo', label: eloLabel, get: num('elo'), min: 620 };
  if (preset === 'leaderboard')
    return [
      { key: 'elo', label: eloLabel, get: num('elo'), score: true },
      { key: 'played', label: tx('Matches'), get: num('played') },
    ];
  const played: Column = {
    key: 'played',
    label: tx('P'),
    title: tx('Matches played'),
    get: (r) => r.played ?? 0,
  };
  const wins: Column = {
    key: 'wins',
    label: tx('W'),
    title: tx('Wins'),
    get: (r) => r.wins ?? 0,
  };
  const losses: Column = {
    key: 'losses',
    label: tx('L'),
    title: tx('Losses'),
    get: (r) => r.losses ?? 0,
    min: 460,
  };
  if (preset === 'mexicano')
    return [
      {
        key: 'points',
        label: tx('Pts'),
        title: tx('Total points'),
        get: (r) => r.points ?? 0,
        score: true,
      },
      played,
      wins,
      losses,
      {
        key: 'avg',
        label: tx('Avg'),
        title: tx('Average points per match'),
        get: (r) => r.avg ?? 0,
        digits: 2,
        // The Avg column stays when it decides the rank.
        min: rows[0]?.rankedByAvg ? 0 : 340,
      },
      {
        key: 'buchholz',
        label: tx('Bh'),
        title: tx('Buchholz tie-break'),
        get: num('buchholz'),
        digits: 2,
        min: 560,
      },
      elo,
    ];
  const sets = setsMode || rows.some((r) => (r.setsWon ?? 0) > 0 || (r.setsLost ?? 0) > 0);
  // These columns count games when matches are scored in sets, points otherwise.
  const games = sets ? { context: 'games' } : undefined;
  // The difference decides the table, so it is the bold column and never leaves the row.
  const diff: Column = sets
    ? {
        key: 'diff',
        label: tx('GD'),
        title: tx('Game difference'),
        get: num('pointDiff'),
        score: true,
      }
    : {
        key: 'diff',
        label: tx('PD'),
        title: tx('Point difference'),
        get: num('pointDiff'),
        score: true,
      };
  return [
    played,
    wins,
    losses,
    ...(sets
      ? [
          { key: 'setsWon', label: tx('SW'), title: tx('Sets won'), get: num('setsWon'), min: 600 },
          {
            key: 'setsLost',
            label: tx('SL'),
            title: tx('Sets lost'),
            get: num('setsLost'),
            min: 600,
          },
          {
            key: 'setsDiff',
            label: tx('SD'),
            title: tx('Set difference'),
            get: num('setsDiff'),
            min: 600,
          },
        ]
      : []),
    {
      key: 'pf',
      label: tx('PF', games),
      title: tx('Points for', games),
      get: (r) => r.pointsFor ?? r.points ?? 0,
      min: 520,
    },
    {
      key: 'pa',
      label: tx('PA', games),
      title: tx('Points against', games),
      get: num('pointsAgainst'),
      min: 520,
    },
    diff,
    elo,
  ];
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

// Phones show rank, name and the key columns; tapping a row reveals the rest. Wider screens show
// every column. Column headers sort (default order is the backend ranking). Gold, silver and bronze
// mark the podium; the column that decides the Mexicano rank is bold.
export function StandingsTable({
  rows,
  preset,
  highlightId,
  qualifyCount,
  density = 'md',
  nameLabel,
  eloLabel,
  onSelect,
  sets,
}: StandingsTableProps) {
  useLocale();
  // Columns drop out by the table's own width (a narrow side pane, a phone), not the viewport's.
  const { ref: boxRef, width } = useElementSize<HTMLDivElement>();
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>(null);
  const board = preset === 'leaderboard';
  const all = columnsFor(preset, rows, eloLabel ?? tx('ELO'), sets);
  const columns = all.filter((c) => !c.min || width >= c.min);
  // Hide columns nobody has data for (ELO off, no Buchholz).
  const visible = columns.filter(
    (c) => c.key !== 'elo' || board || rows.some((r) => r.elo != null),
  );
  const hidden = all.filter((c) => !visible.includes(c));
  const hasDetail = (r: StandingRow) =>
    !board && (hidden.some((c) => c.get(r) != null) || !!r.note);
  const deciding =
    preset === 'mexicano' && !sort ? (rows[0]?.rankedByAvg ? 'avg' : 'points') : undefined;
  // One bold column: the sorted one, else the one that decides the rank, else the main score.
  const strong = sort?.key ?? deciding ?? all.find((c) => c.score)?.key;
  const sorted = sort
    ? [...rows].sort((a, b) => {
        const col = all.find((c) => c.key === sort.key);
        const va = col?.get(a) ?? -Infinity;
        const vb = col?.get(b) ?? -Infinity;
        return sort.dir === 'desc' ? vb - va : va - vb;
      })
    : rows;
  const ranked = sorted.filter((r) => !r.removed);
  const toggle = (key: string) =>
    setSort((cur) =>
      !cur || cur.key !== key
        ? { key, dir: 'desc' }
        : cur.dir === 'desc'
          ? { key, dir: 'asc' }
          : null,
    );
  const colSpan = visible.length + 2;
  const narrow = width < 400;
  const legend =
    !board && density !== 'tv' && width < 520
      ? visible
          .filter((c) => c.title && c.title !== c.label)
          .map((c) => `${c.label} ${c.title}`)
          .join(' · ')
      : '';
  const fmt = (c: Column, r: StandingRow) => {
    const v = c.get(r);
    return v == null ? '—' : c.digits ? v.toFixed(c.digits) : v;
  };
  // A number column is as wide as its longest value or its header (plus the sort arrow), so the
  // name keeps the rest of the row.
  const chars = (c: Column) =>
    Math.max(c.label.length * 0.8 + 1.2, ...rows.map((r) => String(fmt(c, r)).length));
  return (
    <Stack gap="xs" ref={boxRef} className={classes.box}>
      <Table.ScrollContainer minWidth={0}>
        <Table
          verticalSpacing={density === 'compact' ? 'xs' : 'sm'}
          className={classes.table}
          data-density={density}
          data-narrow={narrow ? '' : undefined}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th className={classes.rank}>#</Table.Th>
              <Table.Th className={classes.name}>{nameLabel ?? tx('Player')}</Table.Th>
              {visible.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <Table.Th
                    key={c.key}
                    className={classes.num}
                    style={{ '--chars': chars(c) } as CSSProperties}
                    title={c.title}
                    aria-sort={
                      active ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined
                    }
                    data-deciding={strong === c.key ? '' : undefined}
                  >
                    {board ? (
                      c.label
                    ) : (
                      <UnstyledButton
                        className={classes.sort}
                        onClick={() => toggle(c.key)}
                        aria-label={c.title ?? c.label}
                      >
                        {c.label}
                        <span aria-hidden className={classes.arrow}>
                          {active
                            ? sort.dir === 'desc'
                              ? '↓'
                              : '↑'
                            : deciding === c.key
                              ? '↓'
                              : ''}
                        </span>
                      </UnstyledButton>
                    )}
                  </Table.Th>
                );
              })}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {sorted.map((r) => {
              const i = ranked.indexOf(r);
              const expandable = hasDetail(r);
              const place = r.removed ? null : (r.rank ?? i + 1);
              return (
                <Fragment key={r.id}>
                  <Table.Tr
                    className={classes.row}
                    data-self={r.id === highlightId ? '' : undefined}
                    data-removed={r.removed ? '' : undefined}
                    data-open={expandable && open === r.id ? '' : undefined}
                    data-cut={!sort && qualifyCount && i === qualifyCount - 1 ? '' : undefined}
                  >
                    <Table.Td className={classes.rank}>
                      <span
                        className={classes.mark}
                        data-rank={place != null && place <= 3 && !sort ? place : undefined}
                      >
                        {place ?? '—'}
                      </span>
                    </Table.Td>
                    <Table.Td className={classes.name}>
                      <div className={classes.nameLine}>
                        {expandable ? (
                          <UnstyledButton
                            className={classes.toggle}
                            aria-expanded={open === r.id}
                            title={r.name}
                            onClick={() => setOpen(open === r.id ? null : r.id)}
                          >
                            <span className={classes.nameText}>{r.name}</span>
                            <IconChevronDown
                              size={14}
                              className={classes.chevron}
                              data-open={open === r.id ? '' : undefined}
                              aria-hidden
                            />
                          </UnstyledButton>
                        ) : (
                          <span
                            className={classes.nameText}
                            title={r.name}
                            data-withdrawn={r.withdrawn ? '' : undefined}
                          >
                            {r.name}
                          </span>
                        )}
                        {onSelect && !r.removed && (
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            aria-label={tx('Open profile for {name}', { name: r.name })}
                            onClick={() => onSelect(r)}
                          >
                            <IconId size={16} />
                          </ActionIcon>
                        )}
                        {r.removed && (
                          <StatusBadge size="xs" variant="outline">
                            {tx('Removed')}
                          </StatusBadge>
                        )}
                        {r.withdrawn && narrow && (
                          <Tooltip label={tx('Withdrawn')}>
                            <IconUserMinus
                              size={14}
                              color="var(--mantine-color-orange-6)"
                              aria-label={tx('Withdrawn')}
                              role="img"
                              style={{ flexShrink: 0 }}
                            />
                          </Tooltip>
                        )}
                        {r.withdrawn && !narrow && (
                          <StatusBadge size="xs" tone="warning">
                            {tx('Withdrawn')}
                          </StatusBadge>
                        )}
                      </div>
                    </Table.Td>
                    {visible.map((c) => (
                      <Table.Td
                        key={c.key}
                        className={classes.num}
                        data-deciding={strong === c.key ? '' : undefined}
                      >
                        {fmt(c, r)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                  {expandable && open === r.id && (
                    <Table.Tr
                      className={classes.detailRow}
                      data-self={r.id === highlightId ? '' : undefined}
                    >
                      <Table.Td colSpan={colSpan} className={classes.detail}>
                        <dl className={classes.stats}>
                          {hidden
                            .filter((c) => c.get(r) != null)
                            .map((c) => (
                              <div key={c.key}>
                                <dt>{c.title ?? c.label}</dt>
                                <dd>{fmt(c, r)}</dd>
                              </div>
                            ))}
                        </dl>
                        {r.note && (
                          <Text size="sm" c="dimmed" mt="xs">
                            {r.note}
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {legend && (
        <Text size="xs" c="dimmed" data-testid="standings-legend">
          {legend}
        </Text>
      )}
      {!!qualifyCount && qualifyCount < rows.length && (
        <Text size="xs" c="dimmed">
          {tx('Above the dashed line: top {n} qualify.', { n: qualifyCount })}
        </Text>
      )}
    </Stack>
  );
}

StandingsTable.Skeleton = function StandingsSkeleton() {
  return (
    <Stack gap={8} aria-busy="true" aria-label={tx('Loading')}>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={28} />
      ))}
    </Stack>
  );
};
