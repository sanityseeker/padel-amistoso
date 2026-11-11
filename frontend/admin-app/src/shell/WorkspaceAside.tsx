import { Badge, Button, Group, ScrollArea, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useTournamentList } from '../components';
import { matchDecider, pageMatches, reviewItems } from '../admin/tournament/scoring';
import { prefixOf, workspaceQuery } from '../admin/tournament/query';
import { workspace, useWorkspaceInfo } from '../features/switcher/workspace';
import { t as tx, useLocale } from '../i18n';
import { formatRoundLabel } from '../roundLabel';
import { ActivityList } from './ActivityList';
import classes from './Shell.module.css';

// Wide screens (88em and up): the open workspace's review queue and its latest scores, from the
// workspace's own cached query. It adds no requests.
export function WorkspaceAside({ tid }: { tid: string }) {
  useLocale();
  const info = useWorkspaceInfo();
  const tournaments = useTournamentList();
  const type = tournaments.data?.find((t) => t.id === tid)?.type;
  const { data } = useQuery(workspaceQuery(tid, prefixOf(type), false));
  const matches = data ? pageMatches(data) : [];
  const reviews = data && info?.canEdit ? reviewItems(matches, data.settings) : [];
  return (
    <ScrollArea h="100%" aria-label={tx('Review and activity')}>
      <Stack gap="lg" p="md">
        <Stack gap="xs">
          <Group justify="space-between">
            <Text variant="eyebrow">{tx('Review')}</Text>
            {reviews.length > 0 && (
              <Badge color="red" size="sm" circle>
                {reviews.length}
              </Badge>
            )}
          </Group>
          {reviews.length === 0 ? (
            <Text size="sm" c="dimmed">
              {tx('Nothing waits for review.')}
            </Text>
          ) : (
            <>
              {reviews.slice(0, 5).map(({ match, kind }) => (
                <div key={match.id} className={classes.asideRow}>
                  <Text size="sm" fw={600} lineClamp={2}>
                    {match.team1.join(' & ')} / {match.team2.join(' & ')}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {[match.court, formatRoundLabel(match.round_label)].filter(Boolean).join(' · ')}{' '}
                    · {kind === 'dispute' ? tx('Disputed') : tx('Awaiting confirmation')}
                  </Text>
                </div>
              ))}
              <Button
                variant="light"
                size="compact-md"
                onClick={() => workspace()?.showView('review')}
              >
                {tx('Open review queue')}
              </Button>
            </>
          )}
        </Stack>
        <Stack gap="xs">
          <Text variant="eyebrow">{tx('Activity')}</Text>
          <ActivityList
            matches={matches}
            decider={data ? (m) => matchDecider(m, data.settings) : undefined}
          />
        </Stack>
      </Stack>
    </ScrollArea>
  );
}
