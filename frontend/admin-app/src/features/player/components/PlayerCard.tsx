import { lazy, Suspense } from 'react';
import { Avatar, Badge, Group, Paper, Skeleton, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import { profileInitials } from '../../../player/session';
import type { Space } from '../../../player/types';
import { eloOf, historyOf, recentDelta, type Sport } from '../stats';

const PlayerSparkline = lazy(() => import('../charts/PlayerSparkline'));

// The one court-panel surface on the Hub: who you are, your rating, how it moved, where you stand.
export function PlayerCard({
  space,
  sport,
  rank,
  scopeName,
}: {
  space: Space;
  sport: Sport;
  rank: number | null;
  scopeName: string;
}) {
  useLocale();
  const elo = eloOf(space, sport);
  const delta = recentDelta(space, sport);
  const series = historyOf(space, sport)
    .slice(-20)
    .map((m) => Math.round(m.elo_after));
  return (
    <Paper variant="court-panel" p="lg" data-testid="player-card">
      <Stack gap="md">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Group gap="sm" wrap="nowrap" miw={0}>
            <Avatar size={44} radius="xl" color="court" variant="filled" aria-hidden>
              {profileInitials(space.profile.name)}
            </Avatar>
            <Stack gap={0} miw={0}>
              <Text fw={700} truncate>
                {space.profile.name}
              </Text>
              <Text size="xs" opacity={0.75}>
                {tx(sport === 'padel' ? 'Padel' : 'Tennis')} {tx('rating')}
              </Text>
            </Stack>
          </Group>
        </Group>
        <Group align="flex-end" gap="sm">
          <Text variant="score-xl">{elo != null ? Math.round(elo) : '-'}</Text>
          {series.length > 1 && (
            <Badge color={delta >= 0 ? 'success' : 'red'} variant={delta >= 0 ? 'filled' : 'light'}>
              {delta > 0 ? '+' : ''}
              {delta.toFixed(1)}
            </Badge>
          )}
        </Group>
        {series.length > 1 && (
          <Suspense fallback={<Skeleton h={56} />}>
            <PlayerSparkline data={series} label={tx('{value1} ELO trend', { value1: sport })} />
          </Suspense>
        )}
        {rank != null && (
          <Text size="sm">{tx('#{rank} in {scope}', { rank, scope: scopeName })}</Text>
        )}
      </Stack>
    </Paper>
  );
}
