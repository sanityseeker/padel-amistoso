import { Button, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconExternalLink, IconInfoCircle, IconMessage } from '@tabler/icons-react';
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
import { EmptyState, PageHeader, PageLink, StatusBadge } from '../../../ui';
import { PlayedList, resultOf } from '../components/PlayedList';
import { PushToggle } from '../components/PushToggle';
import { playedPath, TournamentPath, useTournamentPath } from '../components/TournamentPath';
import { sportProps } from '../../../theme';
import { phaseText } from '../components/ActiveTournaments';
import { usePlayerSpace } from '../context';
import type { PathRound, PlayerMatch } from '../../../player/types';
import { useEventData } from '../eventData';
import { MatchActions } from '../MatchActions';
import { Notice } from '../../../ui/Notice';

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
  const ranked =
    tournament &&
    (entry.tournament_type === 'group_playoff' || entry.tournament_type === 'mexicano');
  // One request: the summary card draws it, the Played rows take each round's rank from it.
  const path = useTournamentPath(ranked ? entry : undefined);

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
  // The shared page header: back to My events, format and sport, the name, then the status badge as
  // the only meta item. "Full event view" is a secondary link at the end of the page.
  const status = event.data && (
    <StatusBadge
      data-testid="event-status"
      tone={event.data.status.phase === 'finished' ? 'neutral' : 'live'}
    >
      {phaseText(event.data.status)}
    </StatusBadge>
  );
  const fullView = !entry.entity_deleted && (
    <PageLink href={eventUrl(entry)} rightIcon={<IconExternalLink size={14} aria-hidden />}>
      {tx('Full event view')}
    </PageLink>
  );
  const head = (
    <PageHeader
      dense
      back={{ to: '/player/matches', label: tx('My events') }}
      eyebrow={[
        entry.tournament_type ? formatType(entry.tournament_type) : tx('Registration lobby'),
        tx(entry.sport === 'tennis' ? 'Tennis' : 'Padel'),
      ].join(' · ')}
      title={entry.entity_name}
      meta={status}
    />
  );
  // A notice sits right under the header, so the two read as one block.
  const notice = (text: string, testId?: string) => (
    <Notice icon={<IconInfoCircle size={18} />} data-testid={testId}>
      {text}
    </Notice>
  );
  if (!tournament)
    return (
      <Stack gap="md" {...sportProps(entry.sport)}>
        {head}
        {notice(
          entry.entity_deleted
            ? tx('This event was removed by its organizer.')
            : tx('This is a registration lobby. Open the event view to see or change your entry.'),
        )}
        {fullView}
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
  const viewOf = (m: PlayerMatch) =>
    toPlayerMatchView(m, {
      decider: m.effective_decider || data?.tv.set_decider || 'full_set',
      expand: data?.expand ?? ((ids) => ids),
      playerId: entry.player_id,
    });
  // Rows inside one frame (the frame draws the border, hairlines split the rows).
  const card = (m: PlayerMatch, actions: boolean) =>
    data && (
      <MatchCard
        key={m.id}
        match={viewOf(m)}
        density="row"
        testId="player-match"
        courts={data.status.assign_courts !== false}
        footer={
          actions ? (
            <MatchActions match={m} entry={entry} data={data} token={event.token} />
          ) : undefined
        }
      >
        {/* The organizer's note for this match (court change, delay, rules) is for players too. */}
        {m.comment && (
          <Text size="sm" c="dimmed" data-testid="match-comment">
            <Group gap={4} wrap="nowrap" align="flex-start" component="span">
              <IconMessage size={13} style={{ flexShrink: 0, marginTop: 4 }} aria-hidden />
              <span>{m.comment}</span>
            </Group>
          </Text>
        )}
      </MatchCard>
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
    : data.finished && !data.withdrawn
      ? null
      : data.withdrawn
        ? tx('You are withdrawn from this event.')
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
  const inProgress = !!data && !data.finished && !data.sittingOut && !data.withdrawn;
  const pathRounds =
    path.data?.available && path.data.rounds.length
      ? playedPath(path.data.rounds, inProgress)
      : undefined;
  const played = (data?.schedule.played ?? []).map((m) => ({
    view: viewOf(m),
    comment: m.comment,
  }));
  const results = Object.fromEntries(
    played.map((p) => [p.view.roundLabel ?? '', resultOf(p.view)]),
  );
  // Once the event is over the final table is the result, so it leads the page; while it runs, Up
  // next leads and the table sits under your own rounds, a tap away from the overview.
  const standingsBlock = standings.length > 0 && (
    <Stack gap="sm" data-testid="event-standings">
      <Title order={2}>{tx(data?.finished ? 'Final standings' : 'Standings')}</Title>
      {standings.map((s) => (
        <Paper key={s.name} p={{ base: 'xs', sm: 'md' }}>
          {s.name && (
            <Text variant="eyebrow" mb="xs">
              {tx('Group {name}', { name: s.name })}
            </Text>
          )}
          <StandingsTable
            rows={toStandingRows(s.rows)}
            preset={s.preset}
            highlightId={entry.player_id}
            sets={s.preset === 'group' && data?.tv.score_mode['gp-group'] === 'sets'}
          />
        </Paper>
      ))}
    </Stack>
  );
  // Bring an element into view and mark it for a moment (a row the overview points at).
  const flash = (el: HTMLElement | null) => {
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.removeAttribute('data-flash');
    void el.offsetWidth;
    el.setAttribute('data-flash', '');
    window.setTimeout(() => el.removeAttribute('data-flash'), 1700);
  };
  const showStandings = () => {
    const section = document.querySelector<HTMLElement>('[data-testid="event-standings"]');
    flash(section?.querySelector<HTMLElement>('tr[data-self]') ?? section ?? null);
  };
  // A tap on the rank chart brings that round's row into view and marks it for a moment.
  const showRound = (row: PathRound) =>
    flash(
      document.querySelector<HTMLElement>(
        `[data-testid="event-played"] [data-round="${CSS.escape(row.round_label)}"]`,
      ),
    );
  return (
    <Stack gap="xl" {...sportProps(entry.sport)}>
      {/* Header, then the one notice that needs attention (none once the event is finished: the
          status badge says so). */}
      <Stack gap="md">
        {head}
        {banner && notice(banner, 'event-banner')}
      </Stack>
      {failure && <ErrorState error={failure} retry={() => void event.refetch()} />}
      {!failure && !data && <Loading />}
      {data && (
        <>
          {data.finished && standingsBlock}
          {section(tx('Up next'), upNext, true, 'event-up-next')}
          {section(tx('Later'), data.schedule.next, true, 'event-later')}
          {/* Overview first: where you stand. Then each round's story in Played. */}
          {ranked && (
            <Stack gap="sm">
              <Title order={2}>{tx('Your tournament')}</Title>
              <TournamentPath
                entry={entry}
                inProgress={inProgress}
                results={results}
                onSelect={showRound}
                onShowStandings={standings.length > 0 ? showStandings : undefined}
              />
            </Stack>
          )}
          {played.length > 0 && (
            <Stack gap="sm">
              <PlayedList testId="event-played" items={played} path={pathRounds} />
            </Stack>
          )}
          {noMatches &&
            (data?.tv.hide_schedule ? (
              <EmptyState title={tx('The organizer has not published the schedule yet.')} />
            ) : (
              <EmptyState title={tx('Your court is waiting')}>
                {tx('Your organizer will publish pairings here when the next round is ready.')}
              </EmptyState>
            ))}
        </>
      )}
      {!data?.finished && standingsBlock}
      {!data?.finished && (
        <Stack gap="xs">
          <Title order={2}>{tx('Notifications')}</Title>
          <PushToggle tid={id} token={event.token} />
        </Stack>
      )}
      {fullView}
    </Stack>
  );
}
