import { Anchor, Badge, Group, Stack, Text } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { t as tx } from '../../../i18n';
import type { EloMatch } from '../../../player/types';
import { formatSets } from '../../../admin/tournament/scoring';
import type { SetDecider } from '../../../types';

type Side = NonNullable<EloMatch['team1']>;

// "Ana 1043 +4 & Luis 1020 +4": each player with the rating before and the change; the signed-in
// player's change is colored, the others' are dimmed.
function Team({ players, me }: { players: Side; me?: string }) {
  if (!players.length) return <>—</>;
  return (
    <>
      {players.map((p, i) => {
        const before = Math.round(p.elo_before || 0);
        const delta = Math.round(p.elo_after || 0) - before;
        const mine = !!me && p.player_id === me;
        return (
          <span key={p.player_id}>
            {i > 0 && ' & '}
            {p.player_name}{' '}
            <Text span size="xs" c="dimmed">
              {before}
            </Text>{' '}
            <Text span size="xs" fw={650} c={!mine ? 'dimmed' : delta >= 0 ? 'success' : 'danger'}>
              {delta > 0 ? '+' : ''}
              {delta}
            </Text>
          </span>
        );
      })}
    </>
  );
}

export const scoreOf = (m: EloMatch) =>
  m.sets.length
    ? formatSets(m.sets as [number, number][], (m.decider ?? 'full_set') as SetDecider, ', ')
    : m.score.length === 2
      ? `${m.score[0]}-${m.score[1]}`
      : '';

// One rating change: a manual adjustment (who, why) or a match (event, date, order, both teams, score).
export function ResultRow({ m, locale }: { m: EloMatch; locale: string }) {
  const change = m.elo_delta ?? m.elo_after - m.elo_before;
  const color = change >= 0 ? 'success' : 'danger';
  const date = m.updated_at
    ? new Date(m.updated_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })
    : '';
  const transition = (
    <Text span fw={650} c={color}>
      {Math.round(m.elo_before)} → {Math.round(m.elo_after)} ({change > 0 ? '+' : ''}
      {Math.round(change)})
    </Text>
  );
  if (m.is_manual)
    return (
      <Stack gap={2} data-testid="elo-row" data-manual>
        <Group gap="xs">
          <Badge
            variant="light"
            leftSection={<IconSettings size={12} />}
            title={m.adjustment_reason ?? undefined}
          >
            {tx('Manual adjustment')}
          </Badge>
          {m.adjusted_by && (
            <Text size="xs" c="dimmed">
              {tx('Adjusted by')} {m.adjusted_by}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {date}
          </Text>
        </Group>
        <Text size="sm">{transition}</Text>
        {m.adjustment_reason && (
          <Text size="xs" c="dimmed">
            {m.adjustment_reason}
          </Text>
        )}
      </Stack>
    );
  const score = scoreOf(m);
  return (
    <Stack gap={2} data-testid="elo-row">
      <Group gap="xs" wrap="wrap">
        <Anchor
          component={Link}
          to={`/tv/${encodeURIComponent(m.tournament_alias || m.tournament_id)}`}
          fw={650}
          size="sm"
        >
          {m.tournament_name || m.tournament_id}
        </Anchor>
        {!!m.match_order && (
          <Text size="xs" c="dimmed">
            #{m.match_order}
          </Text>
        )}
        <Text size="xs" c="dimmed">
          {date}
        </Text>
      </Group>
      <Text size="sm">{transition}</Text>
      {(m.team1?.length || m.team2?.length) && (
        <Text size="sm">
          <Team players={m.team1 ?? []} me={m.player_id} />{' '}
          <Text span fw={650}>
            {score || tx('vs')}
          </Text>{' '}
          <Team players={m.team2 ?? []} me={m.player_id} />
        </Text>
      )}
      {!(m.team1?.length || m.team2?.length) && score && <Text size="sm">{score}</Text>}
    </Stack>
  );
}
