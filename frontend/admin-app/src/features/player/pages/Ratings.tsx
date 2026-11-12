import { lazy, Suspense, useState } from 'react';
import {
  Group,
  Paper,
  SimpleGrid,
  Skeleton,
  Stack,
  Select,
  Text,
  Title,
  useMatches,
} from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import { EmptyState, PageHeader } from '../../../ui';
import { FormGuide } from '../components/FormGuide';
import { EloInfoButton } from '../../info/EloInfo';
import { Leaderboard } from '../components/Leaderboard';
import { ResultRow, scoreOf } from '../components/ResultRow';
import { usePlayerSpace } from '../context';
import { formOf, historyOf, opponentsOf } from '../stats';

const EloChart = lazy(() => import('../charts/EloChart'));

// Ratings: the ELO chart, recent results, and the full leaderboard of the chosen scope.
export default function Ratings() {
  const gap = useMatches({ base: 'md', sm: 'xl' });
  const locale = useLocale();
  const { space, scopeQuery, sport } = usePlayerSpace();
  const history = historyOf(space, sport);
  const [shown, setShown] = useState(10);
  const recent = history.slice().reverse();
  const now = history.length ? history[history.length - 1].elo_after : 0;
  const change = history.length ? Math.round(now - history[0].elo_before) : 0;
  const visible = recent.slice(0, shown);
  return (
    <Stack gap={gap}>
      <PageHeader
        title={tx('Ratings')}
        // The Hub navigation (sidebar, tabs or bottom tabs) shows this name.
        named
        dense
        actions={<EloInfoButton />}
      />
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl" style={{ alignItems: 'start' }}>
        <Stack gap="xl">
          {history.length > 1 ? (
            <Paper p="lg">
              <Group justify="space-between" align="flex-start" mb="sm">
                <Stack gap={2}>
                  <Title order={3}>{tx('Recent rating trend')}</Title>
                  {/* The line's end value: where the rating is now and how far it moved. */}
                  <Group gap={8} align="baseline" data-testid="rating-trend-now">
                    <Text fw={700} size="lg" ff="var(--font-display)">
                      {Math.round(now)}
                    </Text>
                    <Text size="sm" fw={650} c={change >= 0 ? 'success' : 'danger'}>
                      {change > 0 ? '+' : ''}
                      {change}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {tx('over {n} rating changes', { n: history.length })}
                    </Text>
                  </Group>
                </Stack>
                <FormGuide form={formOf(space, sport)} />
              </Group>
              <Suspense fallback={<Skeleton h={240} />}>
                <EloChart
                  label={tx('{value1} ELO trend', { value1: sport })}
                  data={history.map((m, i) => {
                    const opponents = opponentsOf(m);
                    return {
                      match: String(i + 1),
                      elo: Math.round(m.elo_after),
                      delta: Math.round(m.elo_delta ?? m.elo_after - m.elo_before),
                      title: m.is_manual
                        ? tx('Manual adjustment')
                        : m.tournament_name || m.tournament_id,
                      score: m.is_manual ? '' : scoreOf(m),
                      opponent: opponents.length ? `${tx('vs')} ${opponents.join(' & ')}` : '',
                    };
                  })}
                />
              </Suspense>
              <Text size="xs" c="dimmed" mt="md">
                {tx('Oldest to newest · Up to 50 recent rating changes across sports')}
              </Text>
            </Paper>
          ) : (
            <EmptyState title={tx('No rating trend yet')}>
              {tx('Your rated match results will appear here.')}
            </EmptyState>
          )}
          <Paper p="lg">
            <Title order={3} mb="md">
              {tx('Community leaderboard')}
            </Title>
            <Leaderboard scopeQuery={scopeQuery} sport={sport} me={space.profile} full />
          </Paper>
        </Stack>
        {recent.length > 0 && (
          <Paper p="lg">
            <Group justify="space-between" align="flex-end" mb="md">
              <Title order={3}>{tx('Recent results')}</Title>
              <Select
                label={tx('Show last')}
                w={110}
                allowDeselect={false}
                value={String(shown)}
                onChange={(v) => v && setShown(Number(v))}
                data={['5', '10', '20', '50']}
                data-testid="elo-limit"
              />
            </Group>
            <Stack gap="sm">
              {visible.map((m, i) => (
                <ResultRow key={`${m.match_id}:${i}`} m={m} locale={locale} />
              ))}
            </Stack>
            {shown < recent.length && (
              <Text size="xs" c="dimmed" mt="sm">
                {tx('{n} older results are not shown.', { n: recent.length - shown })}
              </Text>
            )}
          </Paper>
        )}
      </SimpleGrid>
    </Stack>
  );
}
