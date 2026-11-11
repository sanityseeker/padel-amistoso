import { Group, Stack, Text } from '@mantine/core';
import type { Match, SetDecider } from '../types';
import { formatScore } from '../admin/tournament/scoring';
import { t as tx, useLocale, localeTag } from '../i18n';
import { formatRoundLabel } from '../roundLabel';
import classes from './Shell.module.css';

/** When a score last changed, in seconds. Organizer scores carry no `scored_at`, so the match's
    newest score-history stamp (`last_activity_at`) counts too. */
const stampOf = (m: Match) => m.last_activity_at ?? m.scored_at ?? null;

// The latest saved scores, newest first, whoever entered them. Shared by the wide-screen aside and
// the "Recent activity" sheet of smaller screens.
export function ActivityList({
  matches,
  limit = 6,
  decider,
}: {
  matches: Match[];
  limit?: number;
  /** The deciding format of a match (tournament default included). */
  decider?: (m: Match) => SetDecider;
}) {
  useLocale();
  const activity = matches
    .filter((m) => m.status === 'completed' && stampOf(m) != null)
    .sort((a, b) => (stampOf(b) ?? 0) - (stampOf(a) ?? 0))
    .slice(0, limit);
  const time = (seconds: number) =>
    new Date(seconds > 1e12 ? seconds : seconds * 1000).toLocaleTimeString(localeTag(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  if (!activity.length)
    return (
      <Text size="sm" c="dimmed">
        {tx('No scores yet.')}
      </Text>
    );
  return (
    <Stack gap="xs" data-testid="activity-list">
      {activity.map((m) => (
        <div key={m.id} className={classes.asideRow}>
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text size="sm" lineClamp={1}>
              {[m.court, formatRoundLabel(m.round_label)].filter(Boolean).join(' · ') ||
                tx('Match')}
            </Text>
            <Text size="xs" c="dimmed">
              {time(stampOf(m)!)}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {m.team1.join(' & ')} {tx('vs')} {m.team2.join(' & ')}
          </Text>
          <Text size="xs" c="dimmed">
            {formatScore(
              m.score ?? null,
              m.sets ?? null,
              decider?.(m) ?? m.effective_decider ?? 'full_set',
            )}
          </Text>
        </div>
      ))}
    </Stack>
  );
}
