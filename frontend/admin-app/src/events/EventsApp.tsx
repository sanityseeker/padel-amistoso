import { t as tx, useLocale } from '../i18n';
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Container,
  Group,
  Paper,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconRefresh } from '@tabler/icons-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatType } from '../api';
import { PublicHeader, SupportLinks } from '../PublicHeader';
import { ErrorState, Loading } from '../components';
import { findEvent, publicApi, publicEventUrl, type PublicEvent } from './api';
function EventRows({ events }: { events: PublicEvent[] }) {
  useLocale();
  return (
    <Stack gap="xs">
      {events.map((event) => (
        <Paper
          component="a"
          key={event.kind + ':' + event.id}
          href={publicEventUrl(event)}
          className="compact-event-row"
          p="sm"
        >
          <Text fw={600}>{event.name}</Text>
          {(event.club_name || event.community_name) && (
            <Text size="xs" c="dimmed">
              {event.club_name || event.community_name}
            </Text>
          )}
          <Group gap={6} mt={6}>
            <Badge size="xs" variant="light">
              {tx(event.sport === 'tennis' ? 'Tennis' : 'Padel')}
            </Badge>
            <Text size="xs" c="dimmed">
              {event.kind === 'registration'
                ? tx('{count} registered', { count: event.registrant_count || 0 })
                : formatType(event.type)}
            </Text>
            {event.join_code_required && (
              <Badge size="xs" color="gray">
                {tx('Code required')}
              </Badge>
            )}
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}
export function EventsApp() {
  useLocale();
  const client = useQueryClient();
  const [view, setView] = useState(
    localStorage.getItem('amistoso-events-tab') === 'finished' ? 'finished' : 'live',
  );
  const [sport, setSport] = useState(localStorage.getItem('amistoso-events-sport') || 'all');
  const [code, setCode] = useState('');
  const events = useQuery({
    queryKey: ['public-events'],
    queryFn: ({ signal }) => publicApi<PublicEvent[]>('/public-events', signal),
    refetchInterval: 30_000,
  });
  const finder = useMutation({
    mutationFn: () => findEvent(code),
    onSuccess: (url) => window.location.assign(url),
  });
  useEffect(() => {
    localStorage.setItem('amistoso-last-page', 'events');
    const stream = new EventSource('/api/events');
    stream.onmessage = () => {
      void client.invalidateQueries({ queryKey: ['public-events'] });
    };
    return () => stream.close();
  }, [client]);
  useEffect(() => {
    localStorage.setItem('amistoso-events-tab', view);
    localStorage.setItem('amistoso-events-sport', sport);
  }, [view, sport]);
  const data = (events.data || []).filter((e) => sport === 'all' || e.sport === sport);
  const live = data.filter((e) => e.status !== 'finished');
  const finished = data.filter((e) => e.status === 'finished');
  return (
    <div className="events-workspace">
      <PublicHeader current="events" />
      <Container size="md" className="compact-main" py="lg">
        <h1 className="sr-only">{tx('Events')}</h1>
        <Group justify="space-between" mb="md">
          <Group gap="xs">
            {(['padel', 'tennis'] as const).map((value) => (
              <Button
                key={value}
                size="xs"
                variant={sport === 'all' || sport === value ? 'filled' : 'default'}
                aria-pressed={sport === 'all' || sport === value}
                onClick={() => setSport(sport === value ? 'all' : value)}
              >
                {tx(value === 'padel' ? 'Padel' : 'Tennis')}
              </Button>
            ))}
          </Group>
          <Button
            variant="subtle"
            size="xs"
            aria-label={tx('Refresh events')}
            loading={events.isFetching}
            onClick={() => void events.refetch()}
          >
            <IconRefresh size={17} />
          </Button>
        </Group>
        <Paper p="md">
          <Tabs value={view} onChange={(value) => setView(value || 'live')}>
            <Tabs.List mb="md">
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
                  <Stack gap="lg">
                    {live.some((e) => e.kind === 'tournament') && (
                      <section>
                        <Title order={3} mb="sm">
                          {tx('Tournaments')}
                        </Title>
                        <EventRows events={live.filter((e) => e.kind === 'tournament')} />
                      </section>
                    )}
                    {live.some((e) => e.kind === 'registration') && (
                      <section>
                        <Title order={3} mb="sm">
                          {tx('Sign-ups open')}
                        </Title>
                        <EventRows events={live.filter((e) => e.kind === 'registration')} />
                      </section>
                    )}
                    {!live.length && <Text c="dimmed">{tx('No events found')}</Text>}
                  </Stack>
                </Tabs.Panel>
                <Tabs.Panel value="finished">
                  <EventRows events={finished} />
                  {!finished.length && <Text c="dimmed">{tx('No events found')}</Text>}
                </Tabs.Panel>
              </>
            )}
          </Tabs>
        </Paper>
        <form
          className="compact-code-form"
          onSubmit={(e) => {
            e.preventDefault();
            finder.mutate();
          }}
        >
          <Group align="flex-end" mt="lg" wrap="nowrap">
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
          {finder.error && (
            <Alert mt="sm" color="red">
              {tx(finder.error.message)}
            </Alert>
          )}
        </form>
        <SupportLinks />{' '}
      </Container>
    </div>
  );
}
