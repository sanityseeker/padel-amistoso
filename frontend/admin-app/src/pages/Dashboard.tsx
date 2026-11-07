import { t as tx, useLocale } from '../i18n';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatType, write } from '../api';
import { ErrorState, Loading, PhaseBadge, useOverview } from '../components';
import { CreateTournament } from './forms';
import { CreateLobby } from './Lobbies';
import type { Lobby, Tournament } from '../types';
import { useAuth } from '../auth';
function saved(key: string, fallback: string) {
  return localStorage.getItem('amistoso-home-' + key) || fallback;
}
export function TournamentsPage() {
  useLocale();
  const { user } = useAuth();
  const { tournaments, lobbies } = useOverview();
  const client = useQueryClient();
  const [input, setInput] = useState(() => saved('tournament-search', ''));
  const [search, setSearch] = useState(input);
  const [ownership, setOwnership] = useState(() => saved('filter-ownership', 'mine'));
  const [status, setStatus] = useState(() => saved('filter-status', 'active'));
  const [type, setType] = useState(() => saved('filter-type', 'all'));
  const [deleting, setDeleting] = useState<{ path: string; name: string } | null>(null);
  const mutate = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: unknown; method: string }) =>
      write(path, body, method),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['tournaments'] });
      void client.invalidateQueries({ queryKey: ['lobbies'] });
      setDeleting(null);
    },
  });
  function change(key: string, value: string, setter: (value: string) => void) {
    setter(value);
    localStorage.setItem('amistoso-home-' + key, value);
  }
  const matches = (event: Tournament | Lobby) =>
    (ownership !== 'mine' ||
      user?.role !== 'admin' ||
      event.owner === user.username ||
      event.shared) &&
    [event.name, event.club_name, event.community_name, event.owner]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase());
  const ts = (tournaments.data || []).filter(
    (t) => type !== 'lobby' && matches(t) && (status !== 'active' || t.phase !== 'finished'),
  );
  const ls = (lobbies.data || []).filter(
    (l) => type !== 'tournaments' && matches(l) && (status !== 'active' || (l.open && !l.archived)),
  );
  const rows = (archived: boolean) => (
    <Stack gap="xs">
      {!archived &&
        ts.map((t) => (
          <Paper p="sm" key={t.id}>
            <Group justify="space-between">
              <div>
                <Text component={Link} to={'/tournaments/' + t.id} fw={600} className="text-link">
                  {t.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {t.club_name || t.community_name}
                </Text>
                <Group gap={6} mt={5}>
                  <Badge size="xs" variant="light">
                    {tx(t.sport === 'tennis' ? 'Tennis' : 'Padel')}
                  </Badge>
                  <Text size="xs">{formatType(t.type)}</Text>
                  <PhaseBadge phase={t.phase} />
                  {t.shared && <Badge size="xs">{tx('Shared')}</Badge>}
                </Group>
              </div>
              <Group gap="xs">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={mutate.isPending}
                  onClick={() =>
                    mutate.mutate({
                      path: '/tournaments/' + t.id + '/public',
                      body: { public: !t.public },
                      method: 'PATCH',
                    })
                  }
                >
                  {tx(t.public ? 'Public' : 'Private')}
                </Button>
                {(user?.role === 'admin' || t.owner === user?.username) && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="red"
                    onClick={() => setDeleting({ path: '/tournaments/' + t.id, name: t.name })}
                  >
                    {tx('Delete')}
                  </Button>
                )}
              </Group>
            </Group>
          </Paper>
        ))}
      {ls
        .filter((l) => !!l.archived === archived)
        .map((l) => (
          <Paper p="sm" key={l.id}>
            <Group justify="space-between">
              <div>
                <Text component={Link} to={'/registrations/' + l.id} fw={600} className="text-link">
                  {l.name}
                </Text>
                <Text size="xs" c="dimmed">
                  {l.club_name || l.community_name}
                </Text>
                <Group gap={6} mt={5}>
                  <Badge size="xs" variant="light">
                    {tx(l.sport === 'tennis' ? 'Tennis' : 'Padel')}
                  </Badge>
                  <Badge size="xs" color="gray">
                    {tx(l.archived ? 'Archived' : l.open ? 'Open' : 'Closed')}
                  </Badge>
                  <Text size="xs">{tx('{count} registered', { count: l.registrant_count })}</Text>
                </Group>
              </div>
              <Group gap="xs">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  disabled={mutate.isPending}
                  onClick={() =>
                    mutate.mutate({
                      path: '/registrations/' + l.id,
                      body: { listed: !l.listed },
                      method: 'PATCH',
                    })
                  }
                >
                  {tx(l.listed ? 'Public' : 'Private')}
                </Button>
                {(user?.role === 'admin' || l.owner === user?.username) && (
                  <Button
                    size="compact-xs"
                    color="red"
                    variant="subtle"
                    onClick={() => setDeleting({ path: '/registrations/' + l.id, name: l.name })}
                  >
                    {tx('Delete')}
                  </Button>
                )}
              </Group>
            </Group>
          </Paper>
        ))}
    </Stack>
  );
  return (
    <>
      <Title order={2} mb="md">
        {tx('Tournaments')}
      </Title>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          change('tournament-search', input.trim(), setSearch);
        }}
      >
        <Group mb="sm" gap="xs">
          <TextInput
            flex={1}
            miw={150}
            aria-label={tx('Search tournaments')}
            placeholder={tx('Search tournaments')}
            value={input}
            onChange={(e) => setInput(e.currentTarget.value)}
          />
          <Button type="submit">{tx('Go')}</Button>
          <Button
            variant="default"
            onClick={() => {
              setInput('');
              change('tournament-search', '', setSearch);
            }}
          >
            {tx('Clear')}
          </Button>
        </Group>
      </form>
      <Group gap="xs" mb="md">
        {user?.role === 'admin' && (
          <Select
            label={tx('Ownership')}
            value={ownership}
            allowDeselect={false}
            onChange={(v) => change('filter-ownership', v!, setOwnership)}
            data={[
              { value: 'mine', label: tx('Mine') },
              { value: 'all', label: tx('All') },
            ]}
          />
        )}
        <Select
          label={tx('Status')}
          value={status}
          allowDeselect={false}
          onChange={(v) => change('filter-status', v!, setStatus)}
          data={[
            { value: 'active', label: tx('Active') },
            { value: 'all', label: tx('All') },
          ]}
        />
        <Select
          label={tx('Type')}
          value={type}
          allowDeselect={false}
          onChange={(v) => change('filter-type', v!, setType)}
          data={[
            { value: 'all', label: tx('All') },
            { value: 'tournaments', label: tx('Tournaments') },
            { value: 'lobby', label: tx('Lobby') },
          ]}
        />
      </Group>
      {mutate.error && (
        <Alert color="red" mb="md">
          {mutate.error.message}
        </Alert>
      )}
      {tournaments.isPending || lobbies.isPending ? (
        <Loading />
      ) : tournaments.error || lobbies.error ? (
        <ErrorState error={tournaments.error || lobbies.error} />
      ) : (
        <>
          {rows(false)}
          {!ts.length && !ls.some((l) => !l.archived) && (
            <Text c="dimmed">{tx('No tournaments found')}</Text>
          )}
          {ls.some((l) => l.archived) && (
            <details className="compact-details">
              <summary>{tx('Archived lobbies')}</summary>
              {rows(true)}
            </details>
          )}
        </>
      )}
      <Modal opened={!!deleting} onClose={() => setDeleting(null)} title={tx('Delete')} centered>
        <Text mb="md">{deleting?.name}</Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setDeleting(null)}>
            {tx('Cancel')}
          </Button>
          <Button
            color="red"
            loading={mutate.isPending}
            onClick={() => deleting && mutate.mutate({ path: deleting.path, method: 'DELETE' })}
          >
            {tx('Delete')}
          </Button>
        </Group>
      </Modal>
    </>
  );
}
export function NewTournamentPage() {
  useLocale();
  const [mode, setMode] = useState('group_playoff');
  return (
    <Paper p="md">
      <Title order={2} mb="md">
        {tx('New Tournament')}
      </Title>
      <Tabs value={mode} onChange={(v) => setMode(v!)}>
        <Tabs.List mb="lg">
          <Tabs.Tab value="group_playoff">{tx('Group + Play-off')}</Tabs.Tab>
          <Tabs.Tab value="mexicano">{tx('Mexicano + Play-offs')}</Tabs.Tab>
          <Tabs.Tab value="playoff">{tx('Play-offs')}</Tabs.Tab>
          <Tabs.Tab value="lobby">{tx('Lobby')}</Tabs.Tab>
        </Tabs.List>
      </Tabs>
      {mode === 'lobby' ? (
        <CreateLobby embedded opened close={() => {}} />
      ) : (
        <CreateTournament key={mode} embedded opened initialType={mode} close={() => {}} />
      )}
    </Paper>
  );
}
