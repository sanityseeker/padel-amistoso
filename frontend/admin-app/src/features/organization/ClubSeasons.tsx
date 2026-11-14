import { useState } from 'react';
import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Paper,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconArchive, IconChartBar, IconDots, IconPencil, IconTrash } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { ErrorState, Loading } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { Season } from '../../types';
import {
  ConfirmAction,
  EmptyState,
  FormActions,
  MutationError,
  ResponsiveSheet,
  Section,
  StatusBadge,
} from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

interface Standing {
  player_name: string;
  elo_start: number | null;
  elo_end: number | null;
  elo_change: number | null;
  matches_played: number;
  tournaments_played: number;
  best_rank: number | null;
}
interface Standings {
  padel: Standing[];
  tennis: Standing[];
}

function StandingsSheet({ season, onClose }: { season: Season; onClose: () => void }) {
  useLocale();
  const [sport, setSport] = useState('padel');
  const data = useQuery({
    queryKey: ['admin', 'season-standings', season.id],
    queryFn: () => api<Standings>(`/seasons/${season.id}/standings`),
  });
  const rows = data.data?.[sport as 'padel' | 'tennis'] ?? [];
  return (
    <ResponsiveSheet opened onClose={onClose} title={season.name} size="xl">
      <Stack>
        <SegmentedControl
          value={sport}
          onChange={setSport}
          aria-label={tx('Sport')}
          data={[
            { value: 'padel', label: tx('Padel') },
            { value: 'tennis', label: tx('Tennis') },
          ]}
        />
        {data.isPending ? (
          <Loading />
        ) : data.error ? (
          <ErrorState error={data.error} />
        ) : !rows.length ? (
          <Text c="dimmed">{tx('No results yet for this sport.')}</Text>
        ) : (
          <Table.ScrollContainer minWidth={520}>
            <Table verticalSpacing="xs">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tx('Player')}</Table.Th>
                  <Table.Th>{tx('ELO change')}</Table.Th>
                  <Table.Th>{tx('Matches')}</Table.Th>
                  <Table.Th>{tx('Events')}</Table.Th>
                  <Table.Th>{tx('Best rank')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Table.Tr key={r.player_name}>
                    <Table.Td>{r.player_name}</Table.Td>
                    <Table.Td>
                      {r.elo_change == null
                        ? '—'
                        : `${r.elo_change > 0 ? '+' : ''}${Math.round(r.elo_change)}`}
                    </Table.Td>
                    <Table.Td>{r.matches_played}</Table.Td>
                    <Table.Td>{r.tournaments_played}</Table.Td>
                    <Table.Td>{r.best_rank ?? '—'}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
      </Stack>
    </ResponsiveSheet>
  );
}

export function ClubSeasons({ clubId }: { clubId: string }) {
  useLocale();
  const key = ['admin', 'seasons', clubId];
  const seasons = useQuery({
    queryKey: key,
    queryFn: () => api<Season[]>(`/clubs/${clubId}/seasons`),
  });
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<Season | null>(null);
  const [newName, setNewName] = useState('');
  const [deleting, setDeleting] = useState<Season | null>(null);
  const [viewing, setViewing] = useState<Season | null>(null);
  const create = useAdminMutation({
    request: () => write(`/clubs/${clubId}/seasons`, { name }),
    invalidate: [key],
    success: 'Season added',
    onSuccess: () => setName(''),
  });
  const patch = useAdminMutation({
    request: ({ s, body }: { s: Season; body: { name?: string; active?: boolean } }) =>
      write(`/seasons/${s.id}`, body, 'PATCH'),
    invalidate: [key, ['admin', 'season-standings']],
    success: 'Season updated',
    onSuccess: () => setRenaming(null),
  });
  const remove = useAdminMutation({
    request: (s: Season) => write(`/seasons/${s.id}`, undefined, 'DELETE'),
    invalidate: [key, ['admin', 'tournaments']],
    success: 'Season deleted',
    onSuccess: () => setDeleting(null),
  });
  if (seasons.isPending) return <Loading />;
  if (seasons.error) return <ErrorState error={seasons.error} />;
  return (
    <Section title={tx('Seasons')}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Group align="flex-end" maw={480} wrap="nowrap">
          <TextInput
            flex={1}
            label={tx('New season')}
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <Button type="submit" loading={create.isPending}>
            {tx('Add season')}
          </Button>
        </Group>
      </form>
      <MutationError error={create.error ?? patch.error} />
      {!seasons.data.length ? (
        <EmptyState title={tx('No seasons yet.')}>
          {tx('Seasons group tournaments and add up the results across them.')}
        </EmptyState>
      ) : (
        <Stack gap="xs">
          {seasons.data.map((s) => (
            <Paper key={s.id} variant="row" p="sm" data-testid="season-row">
              <Group justify="space-between" wrap="nowrap">
                <Group gap="sm">
                  <Text fw={600}>{s.name}</Text>
                  <StatusBadge tone={s.active ? 'success' : 'neutral'}>
                    {s.active ? tx('Active') : tx('Archived')}
                  </StatusBadge>
                </Group>
                <Menu position="bottom-end" withinPortal>
                  <Menu.Target>
                    <ActionIcon aria-label={tx('Options for {name}', { name: s.name })}>
                      <IconDots size={18} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item
                      leftSection={<IconChartBar size={15} />}
                      onClick={() => setViewing(s)}
                    >
                      {tx('Standings')}
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconPencil size={15} />}
                      onClick={() => {
                        setNewName(s.name);
                        setRenaming(s);
                      }}
                    >
                      {tx('Rename')}
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconArchive size={15} />}
                      onClick={() => patch.mutate({ s, body: { active: !s.active } })}
                    >
                      {s.active ? tx('Archive') : tx('Reactivate')}
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={15} />}
                      onClick={() => {
                        remove.reset();
                        setDeleting(s);
                      }}
                    >
                      {tx('Delete')}
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Paper>
          ))}
        </Stack>
      )}
      {viewing && <StandingsSheet season={viewing} onClose={() => setViewing(null)} />}
      <ResponsiveSheet
        opened={!!renaming}
        onClose={() => setRenaming(null)}
        title={tx('Rename season')}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (renaming) patch.mutate({ s: renaming, body: { name: newName.trim() } });
          }}
        >
          <Stack>
            <TextInput
              label={tx('Name')}
              required
              maxLength={100}
              data-autofocus
              value={newName}
              onChange={(e) => setNewName(e.currentTarget.value)}
            />
            <FormActions onCancel={() => setRenaming(null)}>
              <Button type="submit" loading={patch.isPending}>
                {tx('Save')}
              </Button>
            </FormActions>
          </Stack>
        </form>
      </ResponsiveSheet>
      <ConfirmAction
        opened={!!deleting}
        title={tx('Delete season')}
        description={tx('Delete «{name}»? Its tournaments stay but lose the season.', {
          name: deleting?.name,
        })}
        confirmLabel={tx('Delete')}
        color="red"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </Section>
  );
}
