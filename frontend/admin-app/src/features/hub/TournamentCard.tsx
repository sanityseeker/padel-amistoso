import type { ReactNode } from 'react';
import { Badge, Button, Group, Paper, RingProgress, Stack, Text } from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../i18n';
import { useEntryInfo } from '../switcher';
import { sportProps } from '../../theme';
import { SportMark } from '../../ui';
import type { HubEvent } from './model';
import { sportLabel } from './model';

// A live event on the hub: ring of matches played, the phase, what needs review, one Open button.
// The status request is the same one the dock uses, so it is shared and refreshed once a minute.
export function TournamentCard({ event, menu }: { event: HubEvent; menu: ReactNode }) {
  useLocale();
  const info = useEntryInfo({ id: event.id, kind: event.kind, name: event.name });
  const pct = Math.round((info.progress ?? 0) * 100);
  const sized = info.progress != null;
  return (
    <Paper p="md" data-testid="live-card" {...sportProps(event.sport)}>
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap" align="flex-start">
          <Stack gap={2} miw={0}>
            <Text variant="eyebrow">{info.eyebrow || event.format}</Text>
            <Text
              component={Link}
              to={event.path}
              fw={700}
              fz="lg"
              lh={1.2}
              style={{ overflowWrap: 'anywhere', textDecoration: 'none', color: 'inherit' }}
            >
              {event.name}
            </Text>
            <Text size="xs" c="dimmed">
              {[sportLabel(event.sport), event.scope].filter(Boolean).join(' · ')}
            </Text>
          </Stack>
          {menu}
        </Group>
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            {event.kind === 'tournament' && sized ? (
              <RingProgress
                size={56}
                thickness={6}
                roundCaps
                sections={[{ value: pct, color: 'var(--sport-accent)' }]}
                label={
                  <Text ta="center" size="xs" fw={700}>
                    {info.played != null && info.total ? `${info.played}/${info.total}` : `${pct}%`}
                  </Text>
                }
                aria-label={tx('Matches played')}
              />
            ) : (
              <SportMark sport={event.sport} />
            )}
            <Stack gap={4}>
              {event.kind === 'tournament' && !sized && info.live && (
                <Badge color="live" variant="light">
                  {tx('In progress')}
                </Badge>
              )}
              {info.review > 0 && (
                <Badge color="red" variant="light">
                  {tx('{n} to review', { n: info.review })}
                </Badge>
              )}
            </Stack>
          </Group>
          <Button
            component={Link}
            to={event.path}
            rightSection={<IconArrowRight size={16} />}
            aria-label={`${tx('Open')}: ${event.name}`}
          >
            {tx('Open')}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
