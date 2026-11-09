import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Code,
  Group,
  Popover,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { ClubPlayer } from '../../types';
import { MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

interface Ghost {
  profile_id: string;
  name: string;
  elo_padel: number | null;
  elo_tennis: number | null;
  matches_padel: number | null;
  matches_tennis: number | null;
}

const possibleKey = (clubId: string) => ['admin', 'club-possible-members', clubId];

// Past participants of the club's events who are not on the roster yet (GET .../players/possible-members):
// add one to the roster, give one a Player Hub profile, or fold several into one profile, or into an
// existing registered player (POST .../players/consolidate-ghosts, the target first in `source_ids`).
export function PossibleMembers({
  clubId,
  players,
  sport,
  invalidate,
}: {
  clubId: string;
  players: ClubPlayer[];
  sport: string;
  invalidate: (string | undefined)[][];
}) {
  useLocale();
  const ghosts = useQuery({
    queryKey: possibleKey(clubId),
    queryFn: () => api<Ghost[]>(`/clubs/${clubId}/players/possible-members`),
  });
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [created, setCreated] = useState<{ name: string; passphrase: string } | null>(null);
  const [email, setEmail] = useState('');
  const keys = [possibleKey(clubId), ...invalidate];
  const add = useAdminMutation({
    request: (g: Ghost) => write(`/clubs/${clubId}/players`, { profile_id: g.profile_id }),
    invalidate: keys,
    success: 'Added to the roster',
  });
  const convert = useAdminMutation({
    request: (g: Ghost) =>
      write<{ passphrase: string }>(`/clubs/${clubId}/players/${g.profile_id}/convert-ghost`, {
        name: g.name,
        email: email || null,
        lang: 'en',
      }),
    invalidate: keys,
    onSuccess: (result, g) => {
      setCreated({ name: g.name, passphrase: result.passphrase });
      setEmail('');
    },
  });
  const merge = useAdminMutation({
    request: () =>
      write(`/clubs/${clubId}/players/consolidate-ghosts`, {
        source_ids: target ? [target, ...picked] : picked,
        name: target ? null : name.trim() || null,
      }),
    invalidate: keys,
    success: 'Profiles merged',
    onSuccess: () => {
      setPicked([]);
      setTarget(null);
      setName('');
    },
  });
  const list = (ghosts.data ?? []).filter((g) =>
    `${g.name} ${g.profile_id}`.toLowerCase().includes(filter.trim().toLowerCase()),
  );
  if (!ghosts.data?.length) return null;
  const registered = players.filter((p) => p.has_hub_profile);
  const toggle = (id: string, on: boolean) =>
    setPicked((cur) => (on ? [...cur, id] : cur.filter((x) => x !== id)));
  const canMerge = target ? picked.length >= 1 : picked.length >= 2;
  return (
    <Stack gap="xs" data-testid="possible-members">
      <Text fw={600}>
        {tx('{n} past participants are not on the roster', { n: ghosts.data.length })}
      </Text>
      <Text size="sm" c="dimmed">
        {tx(
          'Past participants not on the roster yet. Merge into an existing player, create a Player Hub profile, or add directly.',
        )}
      </Text>
      <TextInput
        aria-label={tx('Search past participants')}
        placeholder={tx('Search past participants')}
        value={filter}
        onChange={(e) => setFilter(e.currentTarget.value)}
      />
      {created && (
        <Alert color="green" withCloseButton onClose={() => setCreated(null)}>
          {tx('Profile created for {name}. Passphrase:', { name: created.name })}{' '}
          <Code>{created.passphrase}</Code>
        </Alert>
      )}
      <MutationError error={add.error ?? convert.error ?? merge.error} />
      <Table.ScrollContainer minWidth={420}>
        <Table verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={1} />
              <Table.Th>{tx('Player')}</Table.Th>
              <Table.Th>{tx('ELO')}</Table.Th>
              <Table.Th>{tx('Matches')}</Table.Th>
              <Table.Th w={1} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {list.map((g) => {
              const elo = sport === 'padel' ? g.elo_padel : g.elo_tennis;
              const matches = sport === 'padel' ? g.matches_padel : g.matches_tennis;
              return (
                <Table.Tr key={g.profile_id}>
                  <Table.Td>
                    <Checkbox
                      aria-label={tx('Select {name}', { name: g.name })}
                      checked={picked.includes(g.profile_id)}
                      onChange={(e) => toggle(g.profile_id, e.currentTarget.checked)}
                    />
                  </Table.Td>
                  <Table.Td fw={600}>{g.name}</Table.Td>
                  <Table.Td>{elo != null ? Math.round(elo) : '—'}</Table.Td>
                  <Table.Td>{matches ?? '—'}</Table.Td>
                  <Table.Td>
                    <Group gap={6} wrap="nowrap">
                      <Button
                        size="compact-sm"
                        variant="light"
                        loading={add.isPending && add.variables?.profile_id === g.profile_id}
                        onClick={() => add.mutate(g)}
                      >
                        {tx('Add to roster')}
                      </Button>
                      <Popover width={260} withArrow position="bottom-end" shadow="md">
                        <Popover.Target>
                          <Button size="compact-sm" variant="default">
                            {tx('Create Hub profile')}
                          </Button>
                        </Popover.Target>
                        <Popover.Dropdown>
                          <Stack gap="xs">
                            <Text size="sm">
                              {tx(
                                'Generates a passphrase the player can use to log in to the Player Hub. Add an email to send an invite.',
                              )}
                            </Text>
                            <TextInput
                              type="email"
                              aria-label={tx('Email')}
                              placeholder="player@example.com"
                              value={email}
                              onChange={(e) => setEmail(e.currentTarget.value)}
                            />
                            <Button
                              size="compact-md"
                              loading={convert.isPending}
                              onClick={() => convert.mutate(g)}
                            >
                              {tx('Create profile')}
                            </Button>
                          </Stack>
                        </Popover.Dropdown>
                      </Popover>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {!list.length && (
        <Text size="sm" c="dimmed">
          {tx('No players found')}
        </Text>
      )}
      {picked.length > 0 && (
        <Group align="flex-end" gap="xs" data-testid="possible-merge-bar">
          <Text size="sm" fw={600}>
            {tx('{n} selected', { n: picked.length })}
          </Text>
          <Select
            label={tx('Merge into')}
            placeholder={tx('New profile (consolidate)')}
            clearable
            searchable
            value={target}
            onChange={setTarget}
            data={registered.map((p) => ({ value: p.profile_id, label: p.name }))}
          />
          {!target && (
            <TextInput
              label={tx('Name for merged profile')}
              value={name}
              placeholder={ghosts.data.find((g) => g.profile_id === picked[0])?.name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
          )}
          <Button disabled={!canMerge} loading={merge.isPending} onClick={() => merge.mutate()}>
            {target ? tx('Merge into player') : tx('Merge into one')}
          </Button>
          <Button variant="default" onClick={() => setPicked([])}>
            {tx('Clear')}
          </Button>
        </Group>
      )}
    </Stack>
  );
}
