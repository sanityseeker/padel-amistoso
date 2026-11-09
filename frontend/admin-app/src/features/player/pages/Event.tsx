import { Alert, Anchor, Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconExternalLink } from '@tabler/icons-react';
import { Link, useParams } from 'react-router-dom';
import { t as tx, useLocale } from '../../../i18n';
import { formatType } from '../../../api';
import { ErrorState, Loading } from '../../../components';
import { eventUrl } from '../../../player/api';
import {
  MatchCard,
  MatchListFrame,
  StandingsTable,
  toPlayerMatchView,
  toStandingRows,
} from '../../tournaments';
import { EmptyState, StatusBadge } from '../../../ui';
import { PushToggle } from '../components/PushToggle';
import { TournamentPath } from '../components/TournamentPath';
import { sportProps } from '../../../theme';
import { phaseText } from '../components/ActiveTournaments';
import { usePlayerSpace } from '../context';
import type { PlayerMatch } from '../../../player/types';
import { useEventData } from '../eventData';
import { MatchActions } from '../MatchActions';

// One event, in the order a player needs it: one status banner, your next match (score, confirm,
// correct, escalate), later and played matches, a standings snapshot, your path and notifications.
// Live refresh comes from LiveUpdates (it follows this tournament's stream).
export default function Event() {
  useLocale();
  const { kind, id = '' } = useParams();
  const { space, liveEntries, liveLoading } = usePlayerSpace();
  const entry =
    liveEntries.find((e) => e.entity_type === kind && e.entity_id === id) ??
    space.entries.find((e) => e.entity_type === kind && e.entity_id === id);
  const tournament = entry?.entity_type === 'tournament' && !entry.entity_deleted;
  const event = useEventData(tournament ? entry : undefined);

  if (!entry && liveLoading) return <Loading />;
  if (!entry)
    return (
      <EmptyState
        title={tx('Event not found')}
        action={
          <Button component={Link} to="/player/matches" variant="light">
            {tx('Back to my events')}
          </Button>
        }
      >
        {tx('It is not linked to your profile.')}
      </EmptyState>
    );
  const back = (
    <Anchor component={Link} to="/player/matches" size="sm">
      <Group gap={4}>
        <IconArrowLeft size={14} />
        {tx('My events')}
      </Group>
    </Anchor>
  );
  const head = (
    <Stack gap={4} {...sportProps(entry.sport)}>
      {back}
      <Text variant="eyebrow">
        {[
          entry.tournament_type ? formatType(entry.tournament_type) : tx('Registration lobby'),
          tx(entry.sport === 'tennis' ? 'Tennis' : 'Padel'),
        ].join(' · ')}
      </Text>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Title order={1}>{entry.entity_name}</Title>
        {!entry.entity_deleted && (
          <Button
            component="a"
            href={eventUrl(entry)}
            variant="subtle"
            size="compact-md"
            rightSection={<IconExternalLink size={14} />}
          >
            {tx('Full event view')}
          </Button>
        )}
      </Group>
      {event.data && (
        <Group gap={6}>
          <StatusBadge tone={event.data.status.phase === 'finished' ? 'neutral' : 'live'}>
            {phaseText(event.data.status)}
          </StatusBadge>
        </Group>
      )}
    </Stack>
  );
  if (!tournament)
    return (
      <Stack gap="lg">
        {head}
        <Alert color="gray">
          {entry.entity_deleted
            ? tx('This event was removed by its organizer.')
            : tx('This is a registration lobby. Open the event view to see or change your entry.')}
        </Alert>
      </Stack>
    );
  const data = event.data;
  const failure = event.error;
  const standings = data?.status.leaderboard
    ? [{ name: '', rows: data.status.leaderboard, preset: 'mexicano' as const }]
    : data?.standings
      ? Object.entries(data.standings).map(([name, rows]) => ({
          name,
          rows,
          preset: 'group' as const,
        }))
      : [];
  const card = (m: PlayerMatch, actions: boolean) =>
    data && (
      <MatchCard
        key={m.id}
        match={toPlayerMatchView(m, {
          decider: m.effective_decider || data.tv.set_decider || 'full_set',
          expand: data.expand,
          playerId: entry.player_id,
        })}
        density="card"
        testId="player-match"
        footer={
          actions ? (
            <MatchActions match={m} entry={entry} data={data} token={event.token} />
          ) : undefined
        }
      />
    );
  const section = (title: string, matches: PlayerMatch[], actions: boolean, testId: string) =>
    matches.length > 0 && (
      <Stack gap="sm" data-testid={testId}>
        <Title order={2}>{title}</Title>
        <MatchListFrame>{matches.map((m) => card(m, actions))}</MatchListFrame>
      </Stack>
    );
  // Exactly one banner, most important first.
  const readOnly = !entry.auto_login_token || !!event.tokenError;
  const banner = !data
    ? null
    : data.withdrawn
      ? tx('You are withdrawn from this event.')
      : data.finished
        ? tx('This event is finished. Matches are shown for reference.')
        : data.sittingOut
          ? tx('You sit out this round')
          : !data.tv.allow_player_scoring
            ? tx('Your organizer enters the scores for this event.')
            : readOnly
              ? tx(
                  'Scores cannot be entered from this device. Open the full event view with your player link to score.',
                )
              : null;
  const upNext = data
    ? [...(data.schedule.now ? [data.schedule.now] : []), ...data.schedule.waiting]
    : [];
  const noMatches =
    !!data && !data.matches.length && !data.finished && !data.withdrawn && !data.sittingOut;
  return (
    <Stack gap="xl">
      {head}
      {failure && <ErrorState error={failure} retry={() => void event.refetch()} />}
      {!failure && !data && <Loading />}
      {banner && (
        <Alert color="gray" data-testid="event-banner">
          {banner}
        </Alert>
      )}
      {data && (
        <>
          {section(tx('Up next'), upNext, true, 'event-up-next')}
          {section(tx('Later'), data.schedule.next, true, 'event-later')}
          {section(tx('Played'), data.schedule.played, false, 'event-played')}
          {noMatches && (
            <EmptyState title={tx('Your court is waiting')}>
              {tx('Your organizer will publish pairings here when the next round is ready.')}
            </EmptyState>
          )}
        </>
      )}
      {standings.length > 0 && (
        <Stack gap="sm">
          <Title order={2}>{tx('Standings')}</Title>
          {standings.map((s) => (
            <Paper key={s.name} p="md">
              {s.name && (
                <Text variant="eyebrow" mb="xs">
                  {tx('Group {name}', { name: s.name })}
                </Text>
              )}
              <StandingsTable
                rows={toStandingRows(s.rows)}
                preset={s.preset}
                highlightId={entry.player_id}
              />
            </Paper>
          ))}
        </Stack>
      )}
      {(entry.tournament_type === 'group_playoff' || entry.tournament_type === 'mexicano') && (
        <Stack gap="sm">
          <Title order={2}>{tx('Your path')}</Title>
          <TournamentPath entry={entry} />
        </Stack>
      )}
      <Stack gap="xs">
        <Title order={2}>{tx('Notifications')}</Title>
        <PushToggle tid={id} token={event.token} />
      </Stack>
    </Stack>
  );
}
