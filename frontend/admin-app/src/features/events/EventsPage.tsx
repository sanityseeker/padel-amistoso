import { useEffect, useMemo, useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { IconRefresh, IconSearch } from '@tabler/icons-react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { formatType } from '../../api';
import { ErrorState, Loading } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import { EmptyState, EventRow, PageHeader, SportMark, StatusBadge } from '../../ui';
import { getClubSubdomain } from '../../club-context';
import { findEvent, publicApi, publicEventUrl, type PublicEvent } from '../../events/api';
import { Notice } from '../../ui/Notice';
import { PageContainer } from '../../ui/PageContainer';

const STATUS_LABEL: Record<PublicEvent['status'], string> = {
  in_progress: 'In progress',
  open_registration: 'Sign-ups open',
  upcoming: 'Upcoming',
  finished: 'Finished',
};

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The choice still applies to this visit. */
  }
}
function recall(key: string, fallback: string) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function Rows({ events }: { events: PublicEvent[] }) {
  useLocale();
  return (
    <Stack gap="xs">
      {events.map((event) => (
        <EventRow
          key={event.kind + ':' + event.id}
          href={publicEventUrl(event)}
          title={event.name}
          meta={event.club_name || event.community_name}
          testId="public-event"
          density="compact"
          sport={event.sport}
          badges={
            <>
              <SportMark sport={event.sport} size="xs" />
              <StatusBadge
                tone={
                  event.status === 'in_progress'
                    ? 'live'
                    : event.status === 'finished'
                      ? 'neutral'
                      : 'info'
                }
                size="sm"
              >
                {tx(STATUS_LABEL[event.status])}
              </StatusBadge>
              <Text size="xs" c="dimmed">
                {event.kind === 'registration'
                  ? tx('{count} registered', { count: event.registrant_count || 0 })
                  : formatType(event.type)}
              </Text>
              {event.join_code_required && (
                <StatusBadge size="xs" variant="outline">
                  {tx('Code required')}
                </StatusBadge>
              )}
            </>
          }
        />
      ))}
    </Stack>
  );
}

// The public directory. Anonymous on purpose: it never sends an organizer or player token, so private
// tournaments and unlisted or closed sign-ups cannot appear. Filters live in the URL (?q=) and storage.
export function EventsPage() {
  useLocale();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState(
    recall('amistoso-events-tab', 'live') === 'finished' ? 'finished' : 'live',
  );
  const [sport, setSport] = useState(recall('amistoso-events-sport', 'all'));
  const [code, setCode] = useState('');
  const q = params.get('q') ?? '';
  const events = useQuery({
    queryKey: ['public', 'events'],
    queryFn: ({ signal }) => publicApi<PublicEvent[]>('/public-events', signal),
  });
  const finder = useMutation({
    mutationFn: () => findEvent(code),
    onSuccess: (url) => window.location.assign(url),
  });
  useEffect(() => {
    store('amistoso-events-tab', view);
    store('amistoso-events-sport', sport);
  }, [view, sport]);
  const { live, finished } = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const data = (events.data ?? []).filter(
      (e) =>
        (sport === 'all' || e.sport === sport) &&
        (!needle ||
          [e.name, e.club_name, e.community_name].join(' ').toLowerCase().includes(needle)),
    );
    return {
      live: data.filter((e) => e.status !== 'finished'),
      finished: data.filter((e) => e.status === 'finished'),
    };
  }, [events.data, sport, q]);
  const tournaments = live.filter((e) => e.kind === 'tournament');
  const signups = live.filter((e) => e.kind === 'registration');
  return (
    <PageContainer size="md">
      <Stack gap="md">
        <PageHeader
          title={tx('Events')}
          description={tx('Tournaments and sign-ups open to everyone.')}
          keepDescription
          // The Events nav item names the page, except on a club subdomain where it reads "Club".
          named={!getClubSubdomain()}
        />
        <Group gap="xs">
          <Group gap="xs" wrap="nowrap" flex={1} miw={240}>
            <TextInput
              flex={1}
              miw={0}
              aria-label={tx('Search events')}
              placeholder={tx('Search events')}
              leftSection={<IconSearch size={16} />}
              value={q}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.currentTarget.value) next.set('q', e.currentTarget.value);
                else next.delete('q');
                setParams(next, { replace: true });
              }}
            />
            <ActionIcon
              size="touch"
              variant="default"
              aria-label={tx('Refresh events')}
              loading={events.isFetching}
              onClick={() => void events.refetch()}
            >
              <IconRefresh size={18} />
            </ActionIcon>
          </Group>
          <SegmentedControl
            value={sport}
            onChange={setSport}
            aria-label={tx('Sport')}
            data={[
              { value: 'all', label: tx('All') },
              { value: 'padel', label: tx('Padel') },
              { value: 'tennis', label: tx('Tennis') },
            ]}
          />
        </Group>
        <Tabs value={view} onChange={(value) => setView(value || 'live')}>
          <Tabs.List mb="sm">
            <Tabs.Tab value="live">
              {tx('Live')} ({live.length})
            </Tabs.Tab>
            <Tabs.Tab value="finished">
              {tx('Finished')} ({finished.length})
            </Tabs.Tab>
          </Tabs.List>
          {events.isPending ? (
            <Loading />
          ) : events.error ? (
            <ErrorState error={events.error} retry={() => void events.refetch()} />
          ) : (
            <>
              <Tabs.Panel value="live">
                <Stack gap="md">
                  {tournaments.length > 0 && (
                    <Stack gap="xs" component="section">
                      {signups.length > 0 ? (
                        <Title order={2}>{tx('Tournaments')}</Title>
                      ) : (
                        <VisuallyHidden>
                          <Title order={2}>{tx('Tournaments')}</Title>
                        </VisuallyHidden>
                      )}
                      <Rows events={tournaments} />
                    </Stack>
                  )}
                  {signups.length > 0 && (
                    <Stack gap="xs" component="section">
                      <Title order={2}>{tx('Sign-ups open')}</Title>
                      <Rows events={signups} />
                    </Stack>
                  )}
                  {!live.length && (
                    <EmptyState title={tx('No events found')}>
                      {tx(
                        'Nothing is live right now. Check the finished tab, or look an event up by its code below.',
                      )}
                    </EmptyState>
                  )}
                </Stack>
              </Tabs.Panel>
              <Tabs.Panel value="finished">
                {finished.length ? (
                  <Rows events={finished} />
                ) : (
                  <EmptyState title={tx('No events found')} />
                )}
              </Tabs.Panel>
            </>
          )}
        </Tabs>
        <Paper
          p="md"
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            finder.mutate();
          }}
        >
          <Stack gap="xs">
            <Title order={2}>{tx('Have an event code?')}</Title>
            <Group align="flex-end" wrap="nowrap">
              <TextInput
                flex={1}
                label={tx('Event ID or alias')}
                placeholder={tx('Event ID or alias')}
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                required
              />
              <Button type="submit" loading={finder.isPending}>
                {tx('Find event')}
              </Button>
            </Group>
            {finder.error && <Notice tone="danger">{tx(finder.error.message)}</Notice>}
          </Stack>
        </Paper>
      </Stack>
    </PageContainer>
  );
}
