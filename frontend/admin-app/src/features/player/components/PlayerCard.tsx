import { lazy, Suspense } from 'react';
import { Avatar, Badge, Group, Paper, Skeleton, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import { profileInitials } from '../../../player/session';
import type { Space } from '../../../player/types';
import { eloOf, matchHistoryOf, scopeDelta, type Sport } from '../stats';

const PlayerSparkline = lazy(() => import('../charts/PlayerSparkline'));

// The one court-panel surface on the Hub: who you are, your rating, how it moved, where you stand.
export function PlayerCard({
  space,
  sport,
  rank,
  scopeName,
  showScope = false,
}: {
  space: Space;
  sport: Sport;
  rank: number | null;
  scopeName: string;
  /** Name the community under the sport (several community cards side by side). */
  showScope?: boolean;
}) {
  useLocale();
  const elo = eloOf(space, sport);
  const delta = scopeDelta(space, sport);
  // The rating before the first shown match comes first, so two matches plot as three points.
  // Manual club ratings are left out, like in the badge: they are not results.
  const shownHistory = matchHistoryOf(space, sport).slice(-20);
  const series = shownHistory.length
    ? [shownHistory[0].elo_before, ...shownHistory.map((m) => m.elo_after)].map((v) =>
        Math.round(v),
      )
    : [];
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
                {showScope ? ` · ${scopeName}` : ''}
              </Text>
            </Stack>
          </Group>
        </Group>
        <Group align="flex-end" gap="sm">
          <Text variant="score-xl">{elo != null ? Math.round(elo) : '-'}</Text>
          {series.length > 1 && (
            <Badge
              color={delta >= 0 ? 'success' : 'red'}
              variant={delta >= 0 ? 'filled' : 'light'}
              title={tx('All rated matches')}
              aria-label={`${tx('All rated matches')}: ${delta > 0 ? '+' : ''}${delta.toFixed(1)}`}
            >
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
