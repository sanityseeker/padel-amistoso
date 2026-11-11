import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Card,
  Group,
  SegmentedControl,
  Stack,
  Text,
  useMatches,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconExternalLink, IconLinkOff, IconPlus } from '@tabler/icons-react';
import { Link, useSearchParams } from 'react-router-dom';
import { localeTag, t as tx, useLocale } from '../../../i18n';
import { formatType } from '../../../api';
import { eventUrl, playerApi } from '../../../player/api';
import type { Entry } from '../../../player/types';
import { ConfirmAction, EmptyState, OverflowMenu, PageHeader } from '../../../ui';
import { SocialLine, stageLabel } from '../components/CareerStats';
import { entryPath, usePlayerSpace } from '../context';
import { entrySummary, rankedOf } from '../stats';
import { sportProps } from '../../../theme';
import classes from '../Player.module.css';
import { Notice } from '../../../ui/Notice';
import { StatusBadge } from '../../../ui/StatusBadge';

interface UnlinkResult {
  ok: boolean;
  status: string;
  warning: string | null;
}

function EntryCard({ entry, onUnlink }: { entry: Entry; onUnlink: (entry: Entry) => void }) {
  useLocale();
  const tournament = entry.entity_type === 'tournament' && !entry.entity_deleted;
  const summary = entrySummary(entry);
  return (
    <Card
      p="md"
      data-testid="event-card"
      className={classes.sportCard}
      {...sportProps(entry.sport)}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={4} miw={0}>
          {entry.entity_deleted ? (
            <Text fw={650}>{entry.entity_name}</Text>
          ) : tournament ? (
            <Text component={Link} to={entryPath(entry)} fw={650} className={classes.textLink}>
              {entry.entity_name}
            </Text>
          ) : (
            <Text component="a" href={eventUrl(entry)} fw={650} className={classes.textLink}>
              {entry.entity_name}
            </Text>
          )}
          <Text size="xs" c="dimmed">
            {entry.player_name}
          </Text>
        </Stack>
        <OverflowMenu
          label={`${tx('Event options')}: ${entry.entity_name}`}
          size="md"
          items={[
            {
              key: 'view',
              label: tx('Full event view'),
              icon: <IconExternalLink size={16} />,
              href: eventUrl(entry),
              hidden: !!entry.entity_deleted,
            },
            {
              key: 'unlink',
              label: tx('Unlink from my profile'),
              icon: <IconLinkOff size={16} />,
              color: 'red',
              onClick: () => onUnlink(entry),
            },
          ]}
        />
      </Group>
      <Group gap={6} mt="xs">
        <Badge size="sm" variant="light">
          {tx(entry.sport === 'tennis' ? 'Tennis' : 'Padel')}
        </Badge>
        <Text size="xs" c="dimmed">
          {entry.tournament_type ? formatType(entry.tournament_type) : tx('Registration lobby')}
        </Text>
        {entry.rank && <StatusBadge size="sm">#{entry.rank}</StatusBadge>}
        {entry.status === 'finished' && entry.finished_at && (
          <StatusBadge size="sm" variant="outline">
            {new Date(entry.finished_at).toLocaleDateString(localeTag())}
          </StatusBadge>
        )}
      </Group>
      {(entry.status === 'finished' || summary.record || summary.place) && (
        <Text size="xs" mt="xs" data-testid="entry-stats">
          {[
            summary.place
              ? entry.total_players
                ? tx('{place} of {total}', { place: summary.place, total: entry.total_players })
                : summary.place
              : entry.playoff_stage
                ? stageLabel(entry.playoff_stage)
                : null,
            summary.record,
            entry.elo_after !== null ? Math.round(entry.elo_after) + ' ELO' : null,
            summary.elo !== null
              ? tx('{n} ELO', { n: (summary.elo >= 0 ? '+' : '') + summary.elo })
              : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}
      {entry.status === 'finished' && (
        <Stack mt={4}>
          <SocialLine partners={rankedOf(entry.top_partners)} rivals={rankedOf(entry.top_rivals)} />
        </Stack>
      )}
      {tournament && (
        <Button component={Link} to={entryPath(entry)} variant="light" size="compact-md" mt="sm">
          {tx('My matches')}
        </Button>
      )}
    </Card>
  );
}

// My events: Active and Finished, link a new one, or unlink one (DELETE /player-profile/unlink).
export default function Matches() {
  const gap = useMatches({ base: 'md', sm: 'lg' });
  useLocale();
  const client = useQueryClient();
  const { space, liveEntries, openLink } = usePlayerSpace();
  const [params] = useSearchParams();
  const [which, setWhich] = useState<'active' | 'finished'>(
    params.get('tab') === 'finished' ? 'finished' : 'active',
  );
  const [unlinking, setUnlinking] = useState<Entry | null>(null);
  const unlink = useMutation({
    mutationFn: (entry: Entry) =>
      playerApi<UnlinkResult>(
        '/player-profile/unlink',
        { entity_type: entry.entity_type, entity_id: entry.entity_id },
        'DELETE',
      ),
    onSuccess: (result) => {
      setUnlinking(null);
      void client.invalidateQueries({ queryKey: ['player'] });
      notifications.show({
        message: result.warning ? tx(result.warning) : tx('Event unlinked from your profile'),
        color: result.warning ? 'yellow' : 'green',
      });
    },
  });
  const active = liveEntries.filter((e) => e.status === 'active');
  const finished = space.entries.filter((e) => e.status === 'finished');
  const list = which === 'active' ? active : finished;
  return (
    <Stack gap={gap}>
      <PageHeader
        title={tx('My events')}
        dense
        actions={
          <>
            <ActionIcon
              variant="light"
              size="lg"
              hiddenFrom="sm"
              aria-label={tx('Link event')}
              onClick={openLink}
            >
              <IconPlus size={18} />
            </ActionIcon>
            <Button
              leftSection={<IconPlus size={16} />}
              variant="light"
              visibleFrom="sm"
              onClick={openLink}
            >
              {tx('Link event')}
            </Button>
          </>
        }
      />
      <SegmentedControl
        w="fit-content"
        value={which}
        onChange={(v) => setWhich(v as 'active' | 'finished')}
        aria-label={tx('Events')}
        data={[
          { value: 'active', label: `${tx('Active')} (${active.length})` },
          { value: 'finished', label: `${tx('Finished')} (${finished.length})` },
        ]}
      />
      {list.length ? (
        <Stack gap="sm">
          {list.map((entry) => (
            <EntryCard
              key={`${entry.entity_type}:${entry.entity_id}`}
              entry={entry}
              onUnlink={(e) => {
                unlink.reset();
                setUnlinking(e);
              }}
            />
          ))}
        </Stack>
      ) : (
        <EmptyState
          title={which === 'active' ? tx('No active events') : tx('No finished events yet')}
          action={
            which === 'active' ? (
              <Button variant="light" onClick={openLink}>
                {tx('Link an event')}
              </Button>
            ) : undefined
          }
        >
          {tx(
            'Use your event passphrase to connect an existing registration or tournament to your profile.',
          )}
        </EmptyState>
      )}
      <ConfirmAction
        opened={!!unlinking}
        title={tx('Unlink this event?')}
        description={
          unlinking?.status === 'finished'
            ? tx(
                'Its results and rating changes leave your profile. An organizer can link it again.',
              )
            : tx('It leaves your hub. You can link it again with its passphrase.')
        }
        confirmLabel={tx('Unlink')}
        color="red"
        loading={unlink.isPending}
        error={unlink.error}
        onConfirm={() => unlinking && unlink.mutate(unlinking)}
        onClose={() => setUnlinking(null)}
      />
      {unlink.error && !unlinking && <Notice tone="danger">{tx(unlink.error.message)}</Notice>}
    </Stack>
  );
}
