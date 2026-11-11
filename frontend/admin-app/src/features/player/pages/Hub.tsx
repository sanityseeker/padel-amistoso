import { useState } from 'react';
import { Anchor, Button, Group, SimpleGrid, Stack, Title, useMatches } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../../i18n';
import { EmptyState, PageHeader } from '../../../ui';
import { ActiveEmpty } from '../components/ActiveEmpty';
import { TournamentNavCard } from '../components/ActiveTournaments';
import { CareerStats } from '../components/CareerStats';
import { useLeaderboard } from '../components/Leaderboard';
import { PastTournaments } from '../components/PastTournaments';
import { PlayerCard } from '../components/PlayerCard';
import { TodoCards } from '../components/TodoCards';
import { usePlayerSpace } from '../context';
import { sportsOf, type Sport } from '../stats';

// The Hub, in the order players asked for: your active tournaments first (each one a link to its
// page, with the match that needs you), then past tournaments, rating and statistics, and the
// to-do cards.
export default function Hub() {
  const gap = useMatches({ base: 'md', sm: 'xl' });
  useLocale();
  const { space, scope, scopeQuery, scopeOptions, liveEntries, setScope, openLink } =
    usePlayerSpace();
  const sports = sportsOf(space);
  const [picked, setPicked] = useState<Sport | null>(null);
  const sport = picked && sports.includes(picked) ? picked : (sports[0] ?? 'padel');
  // Active tournaments ignore the picked scope; Past follows it like the rating and history below.
  const active = liveEntries.filter(
    (e) => e.status === 'active' && e.entity_type === 'tournament' && !e.entity_deleted,
  );
  const board = useLeaderboard(scopeQuery);
  const rank = board.data?.[sport].find((r) => r.name === space.profile.name)?.rank ?? null;
  const scopeName = scopeOptions.find((o) => o.value === scope)?.label ?? tx('All my communities');
  const rated = sports.length > 0;
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
        ) : (
          <ActiveEmpty onLink={openLink} />
        )}
      </Stack>

      <PastTournaments entries={space.entries} />

      <Stack gap="md" component="section" aria-labelledby="hub-rating">
        <Title order={2} id="hub-rating" size="h3">
          {tx('Rating and statistics')}
        </Title>
        {rated ? (
          <PlayerCard
            space={space}
            sport={sport}
            sports={sports}
            onSport={setPicked}
            scope={scope}
            scopeOptions={scopeOptions}
            onScope={setScope}
            rank={rank}
            scopeName={scopeName}
          />
        ) : (
          <EmptyState title={tx('No rating yet')}>
            {tx('Your rated match results will appear here.')}
          </EmptyState>
        )}
        <CareerStats entries={space.entries} />
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
