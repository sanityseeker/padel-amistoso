import { Anchor, Button, Group, SimpleGrid, Stack, Title, useMatches } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../../i18n';
import type { Entry } from '../../../player/types';
import { EmptyState, PageHeader } from '../../../ui';
import { ActiveEmpty } from '../components/ActiveEmpty';
import { TournamentNavCard } from '../components/ActiveTournaments';
import { CareerStats } from '../components/CareerStats';
import { isMe, useLeaderboard } from '../components/Leaderboard';
import { PastTournaments } from '../components/PastTournaments';
import { PlayerCard } from '../components/PlayerCard';
import { TodoCards } from '../components/TodoCards';
import { openPaymentOf, usePayments } from '../payments';
import { usePlayerSpace } from '../context';
import { sportsOf, type Sport } from '../stats';

// The Hub, in the order players asked for: your active tournaments first (each one a link to its
// page, with the match that needs you), then past tournaments, rating and statistics, and the
// to-do cards.
export default function Hub() {
  const gap = useMatches({ base: 'md', sm: 'xl' });
  useLocale();
  const { space, scope, scopeQuery, scopeOptions, liveEntries, openLink, sportFilter, setSport } =
    usePlayerSpace();
  // The sport filter narrows every list; All (and a single-sport player) shows everything.
  const inSport = (e: Entry) => sportFilter === 'all' || (e.sport || 'padel') === sportFilter;
  // An event with an open payment stays in view whatever the sport filter says: the badge is the
  // only place the player can pay it.
  const payments = usePayments();
  const inView = (e: Entry) => inSport(e) || !!openPaymentOf(payments.data, e);
  // Active tournaments ignore the picked scope; Past follows it like the rating and history below.
  const activeAll = liveEntries.filter(
    (e) => e.status === 'active' && e.entity_type === 'tournament' && !e.entity_deleted,
  );
  const active = activeAll.filter(inView);
  const board = useLeaderboard(scopeQuery);
  const rankIn = (s: Sport) => board.data?.[s].find((r) => isMe(r, space.profile))?.rank ?? null;
  // Career statistics and past events follow the picked sport; with All, every entry counts.
  const sportEntries = space.entries.filter(inSport);
  const pastEntries = space.entries.filter(inView);
  const scopeName = scopeOptions.find((o) => o.value === scope)?.label ?? tx('All my communities');
  const ratedSports = sportsOf(space);
  const rated = ratedSports.length > 0;
  // One rating card per sport with All, the picked sport otherwise.
  const cardSports = sportFilter === 'all' ? ratedSports : [sportFilter];
  return (
    <Stack gap={gap}>
      <PageHeader title={space.profile.name} />
      <Stack gap="sm" component="section" aria-labelledby="hub-active">
        <Group justify="space-between">
          <Title order={2} id="hub-active" size="h3">
            {tx('Your active tournaments')}
          </Title>
          <Anchor component={Link} to="/player/matches" size="sm">
            {tx('All my events')}
          </Anchor>
        </Group>
        {active.length ? (
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm">
            {active.map((entry) => (
              <TournamentNavCard key={entry.entity_id} entry={entry} />
            ))}
          </SimpleGrid>
        ) : activeAll.length ? (
          <EmptyState
            title={tx('No active tournaments in this sport.')}
            action={
              <Button variant="light" onClick={() => setSport('all')}>
                {tx('Show all sports')}
              </Button>
            }
          />
        ) : (
          <ActiveEmpty onLink={openLink} />
        )}
      </Stack>

      <PastTournaments entries={pastEntries} />

      <Stack gap="md" component="section" aria-labelledby="hub-rating">
        <Title order={2} id="hub-rating" size="h3">
          {tx('Rating and statistics')}
        </Title>
        {rated ? (
          cardSports.map((s) => (
            <PlayerCard key={s} space={space} sport={s} rank={rankIn(s)} scopeName={scopeName} />
          ))
        ) : (
          <EmptyState title={tx('No rating yet')}>
            {tx('Your rated match results will appear here.')}
          </EmptyState>
        )}
        <CareerStats entries={sportEntries} />
        {rated && (
          // Form and the leaderboard live on the Ratings page; the Hub keeps the summary and a link.
          <Button
            component={Link}
            to="/player/ratings"
            variant="light"
            rightSection={<IconArrowRight size={16} />}
            style={{ alignSelf: 'flex-start' }}
          >
            {tx('Form, leaderboard and rating trend')}
          </Button>
        )}
      </Stack>

      <TodoCards profile={space.profile} />
    </Stack>
  );
}
