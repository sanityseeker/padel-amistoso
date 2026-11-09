import { useMemo, useState } from 'react';
import {
  Accordion,
  Group,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconSearch, IconTrophy } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../../i18n';
import type { Entry } from '../../../player/types';
import { StatTile } from '../../../ui';
import {
  bestResults,
  careerStats,
  sortParticipants,
  type CareerStats as Stats,
  type ParticipantRow,
  type ParticipantSort,
  type Ranked,
} from '../stats';

/** "Champion", "3rd Place": the stored play-off stage, in the reader's language. */
export const stageLabel = (stage: string) => tx(stage);

const place = (rank: number) =>
  rank === 1
    ? tx('1st place')
    : rank === 2
      ? tx('2nd place')
      : rank === 3
        ? tx('3rd place')
        : tx('Place {rank}', { rank });

const line = (rows: Ranked[]) => rows.map((r) => `${r.name} ${r.winPct}%`).join(', ');

/** "Best teammates: Ana 100%, Luis 50%. Toughest rivals: ..." (top three of each). */
export function SocialLine({ partners, rivals }: { partners: Ranked[]; rivals: Ranked[] }) {
  useLocale();
  if (!partners.length && !rivals.length) return null;
  return (
    <Text size="sm" c="dimmed" data-testid="social-line">
      {partners.length > 0 && (
        <>
          <b>{tx('Best teammates')}:</b> {line(partners)}
        </>
      )}
      {partners.length > 0 && rivals.length > 0 && ' · '}
      {rivals.length > 0 && (
        <>
          <b>{tx('Toughest rivals')}:</b> {line(rivals)}
        </>
      )}
    </Text>
  );
}

const stat = (games: number, wins: number) =>
  games ? tx('{games} games · {pct}% won', { games, pct: Math.round((wins / games) * 100) }) : '-';

// Everyone you have played with or against, with the record for each. Searchable, five sort orders.
function Explorer({ rows }: { rows: ParticipantRow[] }) {
  useLocale();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ParticipantSort>('interactions');
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortParticipants(rows, sort).filter((r) => !q || r.name.toLowerCase().includes(q));
  }, [rows, query, sort]);
  if (!rows.length) return null;
  return (
    <Accordion variant="contained" data-testid="participant-explorer">
      <Accordion.Item value="people">
        <Accordion.Control>{tx('Players you have met')}</Accordion.Control>
        <Accordion.Panel>
          <Stack gap="sm">
            <Group align="flex-end" grow preventGrowOverflow={false}>
              <TextInput
                label={tx('Search players')}
                placeholder={tx('Search players')}
                leftSection={<IconSearch size={15} />}
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
              />
              <Select
                label={tx('Sort by')}
                allowDeselect={false}
                value={sort}
                onChange={(v) => v && setSort(v as ParticipantSort)}
                data={[
                  { value: 'interactions', label: tx('Most games') },
                  { value: 'together', label: tx('Most played together') },
                  { value: 'against', label: tx('Most played against') },
                  { value: 'win_rate', label: tx('Highest win rate') },
                  { value: 'name', label: tx('Name') },
                ]}
              />
            </Group>
            {shown.length ? (
              <Table.ScrollContainer minWidth={320}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{tx('Player')}</Table.Th>
                      <Table.Th>{tx('With')}</Table.Th>
                      <Table.Th>{tx('Against')}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {shown.map((r) => (
                      <Table.Tr key={r.name}>
                        <Table.Td fw={600}>{r.name}</Table.Td>
                        <Table.Td>{stat(r.togetherGames, r.togetherWins)}</Table.Td>
                        <Table.Td>{stat(r.againstGames, r.againstWins)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : (
              <Text size="sm" c="dimmed">
                {tx('No players match this search.')}
              </Text>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

function Totals({ stats }: { stats: Stats }) {
  return (
    <SimpleGrid cols={{ base: 2, sm: 4 }}>
      <StatTile label={tx('Completed events')} value={stats.tournaments} />
      <StatTile label={tx('Wins')} value={stats.wins} />
      <StatTile label={tx('Losses')} value={stats.losses} />
      <StatTile label={tx('Win rate')} value={stats.winRate != null ? `${stats.winRate}%` : '-'} />
    </SimpleGrid>
  );
}

// The Hub's career card: totals, best teammates and toughest rivals, and everyone you have met, split by
// sport when you play both. Then the best finishes. Events count when finished or already scored.
export function CareerStats({ entries }: { entries: Entry[] }) {
  useLocale();
  const withStats = entries.filter(
    (e) => e.status === 'finished' || (e.wins || 0) + (e.losses || 0) + (e.draws || 0) > 0,
  );
  const bySport = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of withStats)
      map.set(e.sport || 'padel', [...(map.get(e.sport || 'padel') ?? []), e]);
    return [...map.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);
  const all = useMemo(() => careerStats(withStats), [entries]); // eslint-disable-line react-hooks/exhaustive-deps
  if (all.tournaments === 0) return null;
  const finished = withStats.filter((e) => e.status === 'finished');
  return (
    <Stack gap="md">
      <Paper p="md" data-testid="career-stats">
        <Text variant="eyebrow" mb="xs">
          {tx('Career stats')}
        </Text>
        {bySport.length > 1 ? (
          <Stack gap="lg">
            {bySport.map(([sport, list]) => {
              const stats = careerStats(list);
              if (!stats.tournaments) return null;
              return (
                <Stack key={sport} gap="sm" data-sport={sport}>
                  <Text fw={650}>{tx(sport === 'tennis' ? 'Tennis' : 'Padel')}</Text>
                  <Totals stats={stats} />
                  <SocialLine partners={stats.topPartners} rivals={stats.topRivals} />
                  <Explorer rows={stats.participants} />
                </Stack>
              );
            })}
          </Stack>
        ) : (
          <Stack gap="sm">
            <Totals stats={all} />
            <SocialLine partners={all.topPartners} rivals={all.topRivals} />
            <Explorer rows={all.participants} />
          </Stack>
        )}
      </Paper>
      <BestResults entries={finished} bySport={bySport.length > 1} />
    </Stack>
  );
}

function BestResults({ entries, bySport }: { entries: Entry[]; bySport: boolean }) {
  useLocale();
  const groups = bySport
    ? ['padel', 'tennis']
        .map((s) => [s, entries.filter((e) => (e.sport || 'padel') === s)] as const)
        .filter(([, list]) => list.length)
    : ([['', entries]] as const);
  const rows = groups
    .map(([sport, list]) => ({ sport, best: bestResults(list) }))
    .filter(({ best }) => best.groupRank || best.stage);
  if (!rows.length) return null;
  return (
    <Paper p="md" data-testid="best-results">
      <Text variant="eyebrow" mb="xs">
        {tx('Best results')}
      </Text>
      <Stack gap="sm">
        {rows.map(({ sport, best }) => (
          <Stack key={sport} gap={4}>
            {sport && <Text fw={650}>{tx(sport === 'tennis' ? 'Tennis' : 'Padel')}</Text>}
            {best.groupRank && (
              <Group gap="xs" wrap="nowrap">
                <IconTrophy size={16} aria-hidden />
                <Text size="sm">
                  <b>{place(best.groupRank)}</b>
                  {best.groupRankEvent ? `: ${best.groupRankEvent}` : ''}{' '}
                  <Text span c="dimmed">
                    ({tx('Best group finish')})
                  </Text>
                </Text>
              </Group>
            )}
            {best.stage && (
              <Group gap="xs" wrap="nowrap">
                <IconTrophy size={16} aria-hidden />
                <Text size="sm">
                  <b>{stageLabel(best.stage)}</b>
                  {best.stageEvent ? `: ${best.stageEvent}` : ''}{' '}
                  <Text span c="dimmed">
                    ({tx('Best play-off result')})
                  </Text>
                </Text>
              </Group>
            )}
          </Stack>
        ))}
      </Stack>
    </Paper>
  );
}
