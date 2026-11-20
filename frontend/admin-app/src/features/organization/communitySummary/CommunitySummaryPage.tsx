import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Box,
  Collapse,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, write } from '../../../api';
import { ErrorState, Loading, useOverview } from '../../../components';
import { t as tx, useLocale } from '../../../i18n';
import type { Season } from '../../../types';
import { sportProps } from '../../../theme/sport';
import {
  DataTable,
  type DataColumn,
  EmptyState,
  MutationError,
  Notice,
  PageHeader,
  Section,
  SportMark,
  StatTile,
} from '../../../ui';
import { useAdminMutation } from '../../../useAdminMutation';
import type {
  ClubEloSummary,
  CommunityEloSummary,
  CrossClubPlayer,
  EloChangeTotals,
} from './types';

const SPORTS = ['padel', 'tennis'] as const;
const sportLabel = (sport: string) => tx(sport === 'tennis' ? 'Tennis' : 'Padel');

/** One decimal, with a sign for movement. */
const fmt = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`;
const tone = (n: number) => (n > 0 ? 'success' : n < 0 ? 'red' : 'dimmed');

/** The day after an ISO date (YYYY-MM-DD): the API's end bound is exclusive, the picker's is inclusive. */
function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function Totals({ totals, sport }: { totals: EloChangeTotals; sport?: string }) {
  return (
    <SimpleGrid cols={{ base: 3, sm: 5 }} spacing="md" {...sportProps(sport)}>
      <StatTile
        label={tx('Points gained')}
        value={
          <Text span c="success" inherit>
            {fmt(totals.gained)}
          </Text>
        }
      />
      <StatTile
        label={tx('Points lost')}
        value={
          <Text span c="red" inherit>
            {fmt(totals.lost)}
          </Text>
        }
      />
      <StatTile label={tx('Net change')} value={fmt(totals.net)} />
      <StatTile label={tx('Matches')} value={totals.matches} />
      <StatTile label={tx('Players')} value={totals.players} />
    </SimpleGrid>
  );
}

interface SummaryRow {
  id: string;
  name: string;
  dim?: boolean;
  gained: number;
  lost: number;
  net: number;
  matches: number;
  elo: number | null;
}

/** Net always shows; the rest drop out by the table's width, so a phone never scrolls sideways. */
const clubColumns = (): DataColumn<SummaryRow>[] => [
  {
    key: 'name',
    label: tx('Player'),
    cell: (r) =>
      r.dim ? (
        <Text span c="dimmed" inherit>
          {r.name}
        </Text>
      ) : (
        r.name
      ),
  },
  {
    key: 'gained',
    label: tx('Points gained'),
    kind: 'num',
    chars: 6,
    minWidth: 520,
    tone: () => 'success',
    cell: (r) => fmt(r.gained),
  },
  {
    key: 'lost',
    label: tx('Points lost'),
    kind: 'num',
    chars: 6,
    minWidth: 520,
    tone: () => 'red',
    cell: (r) => fmt(r.lost),
  },
  {
    key: 'net',
    label: tx('Net change'),
    kind: 'num',
    chars: 6,
    bold: true,
    tone: (r) => tone(r.net),
    cell: (r) => fmt(r.net),
  },
  {
    key: 'matches',
    label: tx('Matches'),
    kind: 'num',
    chars: 3,
    minWidth: 390,
    cell: (r) => r.matches,
  },
  {
    key: 'elo',
    label: tx('Rating now'),
    kind: 'num',
    chars: 4,
    minWidth: 320,
    cell: (r) => (r.elo != null ? Math.round(r.elo) : '-'),
  },
];

interface CrossRow extends CrossClubPlayer {
  id: string;
}

const crossColumns = (): DataColumn<CrossRow>[] => [
  { key: 'name', label: tx('Player'), cell: (r) => r.name },
  { key: 'clubs', label: tx('Clubs'), kind: 'num', chars: 2, minWidth: 440, cell: (r) => r.clubs },
  {
    key: 'gained',
    label: tx('Points gained'),
    kind: 'num',
    chars: 6,
    minWidth: 520,
    tone: () => 'success',
    cell: (r) => fmt(r.gained),
  },
  {
    key: 'lost',
    label: tx('Points lost'),
    kind: 'num',
    chars: 6,
    minWidth: 520,
    tone: () => 'red',
    cell: (r) => fmt(r.lost),
  },
  {
    key: 'net',
    label: tx('Net change'),
    kind: 'num',
    chars: 6,
    bold: true,
    tone: (r) => tone(r.net),
    cell: (r) => fmt(r.net),
  },
  {
    key: 'matches',
    label: tx('Matches'),
    kind: 'num',
    chars: 3,
    minWidth: 390,
    cell: (r) => r.matches,
  },
];

function ClubBlock({ entry }: { entry: ClubEloSummary }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const recalc = useAdminMutation({
    request: () => write(`/clubs/${entry.club_id}/elo/recalculate`),
    invalidate: [['admin', 'community-elo-summary']],
    success: 'Club ratings recalculated',
  });
  const label = tx(open ? 'Hide players' : 'Show players');
  const rows: SummaryRow[] = entry.players.map((p) => ({
    id: String(p.profile_id),
    name: p.name,
    gained: p.gained,
    lost: p.lost,
    net: p.net,
    matches: p.matches,
    elo: p.elo_now ?? null,
  }));
  if (entry.unlinked.players > 0)
    rows.push({
      id: 'unlinked',
      name: `${tx('Unlinked players')} (${entry.unlinked.players})`,
      dim: true,
      gained: entry.unlinked.gained,
      lost: entry.unlinked.lost,
      net: entry.unlinked.net,
      matches: entry.unlinked.matches,
      elo: null,
    });
  return (
    <Paper variant="row" p="md" data-testid="summary-club" {...sportProps(entry.sport)}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Stack gap={0} miw={0}>
            <Text fw={650} truncate>
              {entry.club_name}
            </Text>
            <Text size="xs" c="var(--sport-accent)">
              {sportLabel(entry.sport)}
            </Text>
          </Stack>
          <ActionIcon
            variant="subtle"
            aria-label={`${label}: ${entry.club_name}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}
          </ActionIcon>
        </Group>
        <Totals totals={entry.totals} sport={entry.sport} />
        {entry.unrated_matches > 0 && (
          <Notice tone="warning" data-testid="unrated-hint">
            <Group justify="space-between" align="center" gap="sm">
              <Text size="sm">
                {tx('Matches without club ratings are not counted: {count}', {
                  count: entry.unrated_matches,
                })}
              </Text>
              <Button
                size="xs"
                variant="default"
                loading={recalc.isPending}
                onClick={() => recalc.mutate()}
              >
                {tx('Recalculate club ratings')}
              </Button>
            </Group>
            <MutationError error={recalc.error} />
          </Notice>
        )}
        <Collapse expanded={open}>
          {/* On phones the table uses the card's full width. */}
          <Box mx={{ base: 'calc(var(--mantine-spacing-md) * -1)', sm: 0 }}>
            <DataTable
              columns={clubColumns()}
              rows={rows}
              rowKey={(r) => r.id}
              testId="summary-club-table"
            />
          </Box>
        </Collapse>
      </Stack>
    </Paper>
  );
}

function CrossClub({ rows }: { rows: CrossClubPlayer[] }) {
  return (
    <Section
      title={tx('Players in several clubs')}
      description={tx(
        'Total across the clubs of this community, for players with rated matches in two or more.',
      )}
    >
      <DataTable
        columns={crossColumns()}
        rows={rows.map((p) => ({ ...p, id: `${p.profile_id}:${p.sport}` }))}
        rowKey={(r) => r.id}
        testId="cross-club"
        rowProps={(r) => sportProps(r.sport)}
        sub={(r) => <SportMark sport={r.sport} size="xs" />}
      />
    </Section>
  );
}

/** Route page: `/admin/communities/:id`. */
export function CommunitySummaryPage() {
  const { id = '' } = useParams();
  return <CommunitySummary key={id} communityId={id} />;
}

/** The summary of one community. `fixedClubId` limits it to one club (the club site) and hides the club picker. */
export function CommunitySummary({
  communityId,
  fixedClubId,
}: {
  communityId: string;
  fixedClubId?: string;
}) {
  useLocale();
  const { communities, clubs } = useOverview();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [pickedClub, setPickedClub] = useState<string | null>(null);
  const [season, setSeason] = useState<string | null>(null);
  const club = fixedClubId ?? pickedClub;

  const communityClubs = (clubs.data ?? []).filter((c) => c.community_id === communityId);
  const seasons = useQuery({
    queryKey: ['admin', 'seasons', club],
    queryFn: () => api<Season[]>(`/clubs/${club}/seasons`),
    enabled: !!club,
  });

  const params = new URLSearchParams({ sport: 'all' });
  // A season fixes the club and wins over the dates, so the dates are not sent with it.
  if (season) params.set('season_id', season);
  else if (from) params.set('from', from);
  if (!season && to) params.set('to', nextDay(to));
  if (club) params.set('club_id', club);
  const summary = useQuery({
    queryKey: ['admin', 'community-elo-summary', communityId, from, to, club ?? '', season ?? ''],
    queryFn: () => api<CommunityEloSummary>(`/communities/${communityId}/elo-summary?${params}`),
  });

  const communityName = communities.data?.find((c) => c.id === communityId)?.name;
  const data = summary.data;
  return (
    <Stack gap="lg" data-testid="community-summary">
      {!fixedClubId && (
        <PageHeader
          title={tx('Rating summary')}
          description={communityName}
          keepDescription
          back={{ to: '/admin/clubs', label: tx('Clubs & communities') }}
        />
      )}
      <Paper variant="row" p="md">
        <Stack gap="sm">
          <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
            <TextInput
              type="date"
              label={tx('From')}
              description={season ? tx('A season sets its own dates.') : undefined}
              value={from}
              disabled={!!season}
              onChange={(e) => setFrom(e.currentTarget.value)}
            />
            <TextInput
              type="date"
              label={tx('To')}
              description={season ? tx('A season sets its own dates.') : undefined}
              value={to}
              disabled={!!season}
              onChange={(e) => setTo(e.currentTarget.value)}
            />
            {!fixedClubId && (
              <Select
                label={tx('Club')}
                placeholder={tx('All clubs')}
                clearable
                data={communityClubs.map((c) => ({ value: c.id, label: c.name }))}
                value={pickedClub}
                onChange={(v) => {
                  setPickedClub(v);
                  setSeason(null);
                }}
              />
            )}
            {club && (
              <Select
                label={tx('Season')}
                placeholder={tx('All seasons')}
                clearable
                data={(seasons.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
                value={season}
                onChange={setSeason}
              />
            )}
          </SimpleGrid>
        </Stack>
      </Paper>
      <Text size="sm" c="dimmed" data-testid="summary-note">
        {tx(
          'Only rating changes from played matches count. Ratings set by hand or by tier are not included.',
        )}
      </Text>
      {summary.isPending ? (
        <Loading />
      ) : summary.error ? (
        <ErrorState error={summary.error} retry={() => void summary.refetch()} />
      ) : !data ? null : (
        <>
          {data.clubs_hidden > 0 && (
            <Notice tone="info">
              {tx('Clubs not shown because you cannot edit them: {count}', {
                count: data.clubs_hidden,
              })}
            </Notice>
          )}
          {!data.clubs.length ? (
            <EmptyState title={tx('No rated matches yet.')}>
              {tx(
                'Rating changes appear here once matches are played in the clubs of this community.',
              )}
            </EmptyState>
          ) : (
            <>
              {SPORTS.map((s) => {
                const totals = data.totals[s];
                // With one club the sport total repeats that club's block, which can also list
                // its players, so the total shows only when it adds up several clubs.
                const clubCount = data.clubs.filter((c) => c.sport === s).length;
                if (!totals || clubCount < 2) return null;
                return (
                  <Section key={s} title={sportLabel(s)}>
                    <Totals totals={totals} sport={s} />
                  </Section>
                );
              })}
              <Stack gap="sm" component="section" aria-label={tx('Clubs')}>
                {data.clubs.map((entry) => (
                  <ClubBlock key={`${entry.club_id}:${entry.sport}`} entry={entry} />
                ))}
              </Stack>
              {data.cross_club_players.length > 0 && <CrossClub rows={data.cross_club_players} />}
            </>
          )}
        </>
      )}
    </Stack>
  );
}
