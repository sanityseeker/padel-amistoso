import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Group, Loader, Paper, Stack, Text, Timeline } from '@mantine/core';
import { IconArrowDownRight, IconArrowUpRight, IconEqual } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../../i18n';
import { formatRoundLabel } from '../../../roundLabel';
import { playerApi } from '../../../player/api';
import type { Entry, PathRound, TournamentPath as Path } from '../../../player/types';

const signed = (n: number | null) => (n == null ? '0' : n > 0 ? `+${n}` : String(n));

function RoundItem({ row, trend }: { row: PathRound; trend: number | null }) {
  const tennis = row.score_mode === 'tennis';
  const delta = row.round_points_delta;
  return (
    <Timeline.Item
      title={
        <Group gap={6}>
          <Text fw={600}>
            {row.round_label
              ? formatRoundLabel(row.round_label)
              : `${tx('Round', row.stage === 'playoff' ? { context: 'knockout' } : undefined)} ${row.round_number}`}
          </Text>
          {row.eliminated && (
            <Badge size="xs" color="red" variant="light">
              {tx('Eliminated')}
            </Badge>
          )}
          {row.walkover && (
            <Badge size="xs" variant="outline" color="gray">
              {tx('Walkover')}
            </Badge>
          )}
        </Group>
      }
      bullet={
        trend == null ? undefined : trend < 0 ? (
          <IconArrowUpRight size={12} />
        ) : trend > 0 ? (
          <IconArrowDownRight size={12} />
        ) : (
          <IconEqual size={12} />
        )
      }
    >
      <Group gap="xs" mt={2}>
        {row.stage !== 'playoff' && row.rank != null && (
          <Badge size="sm" variant="light" color="gray">
            {tx('Rank')} #{row.rank}/{row.total_players}
          </Badge>
        )}
        {tennis ? (
          <Badge size="sm" variant="light" color="gray">
            {tx('Sets')} {signed(row.cumulative_sets_diff)} · {tx('Games')}{' '}
            {signed(row.cumulative_games_diff)}
          </Badge>
        ) : (
          <Badge size="sm" variant="light" color="gray">
            {tx('Points')} {row.cumulative_points}
            {row.played && delta && delta > 0 ? ` (+${delta})` : ''}
          </Badge>
        )}
      </Group>
      <Text size="sm" mt={4}>
        {row.played ? (
          <>
            {row.partners.length ? `${tx('With')} ${row.partners.join(' & ')} · ` : ''}
            {tx('vs')} {row.opponents.join(' & ') || '-'}
            {row.score ? ` · ${row.score}` : ''}
          </>
        ) : (
          <Text span c="dimmed">
            {tx('Sat out')}
          </Text>
        )}
      </Text>
    </Timeline.Item>
  );
}

// Round-by-round path of one entry: rank movement, points or set/game difference, partners and
// opponents. GET /player-profile/tournament-path/{entity}/{player} with the profile token.
export function TournamentPath({ entry }: { entry: Entry }) {
  useLocale();
  const path = useQuery({
    queryKey: ['player', 'path', entry.entity_id, entry.player_id],
    queryFn: () =>
      playerApi<Path>(
        `/player-profile/tournament-path/${encodeURIComponent(entry.entity_id)}/${encodeURIComponent(entry.player_id)}`,
      ),
  });
  if (path.isPending) return <Loader size="sm" />;
  if (path.error) return <Alert color="red">{tx(path.error.message)}</Alert>;
  const rows = path.data.rounds;
  if (!path.data.available || !rows.length)
    return (
      <Paper variant="dashed" p="md">
        <Text size="sm" c="dimmed">
          {path.data.available
            ? tx('Your path appears after the first round.')
            : tx('A round-by-round path is not available for this event.')}
        </Text>
      </Paper>
    );
  const ranked = rows.filter((r) => r.played && r.rank != null && r.stage !== 'playoff');
  let previous: number | null = null;
  return (
    <Stack gap="sm" data-testid="tournament-path">
      {ranked.length >= 2 && (
        <Text size="sm">
          #{ranked[0]!.rank} → #{ranked[ranked.length - 1]!.rank} {tx('of')}{' '}
          {ranked[ranked.length - 1]!.total_players}
        </Text>
      )}
      <Timeline bulletSize={20} lineWidth={2} active={rows.length}>
        {rows.map((row) => {
          const tracked = row.stage !== 'playoff' && row.played && row.rank != null;
          const trend = tracked && previous != null ? row.rank! - previous : null;
          if (tracked) previous = row.rank;
          return (
            <RoundItem
              key={`${row.stage}-${row.round_number}-${row.round_label}`}
              row={row}
              trend={trend}
            />
          );
        })}
      </Timeline>
    </Stack>
  );
}
