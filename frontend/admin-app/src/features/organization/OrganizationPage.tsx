import { useState } from 'react';
import {
  ActionIcon,
  Avatar,
  Badge,
  Button,
  Group,
  Menu,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from '@mantine/core';
import { IconBuilding, IconDots, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { write } from '../../api';
import { useAuth } from '../../auth';
import { ErrorState, Loading, useOverview } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { Community } from '../../types';
import {
  ConfirmAction,
  EmptyState,
  EventRow,
  MutationError,
  PageHeader,
  ResponsiveSheet,
} from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { DefaultCommunity } from './DefaultCommunity';

type Sheet = { kind: 'club' | 'community' } | { kind: 'rename'; community: Community } | null;

// Clubs (with their landing page and tiers) and the communities they belong to. A club opens its own
// page; communities are renamed and deleted here.
export function OrganizationPage() {
  useLocale();
  const { user } = useAuth();
  const { communities, clubs, tournaments } = useOverview();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [name, setName] = useState('');
  const [community, setCommunity] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Community | null>(null);
  const isAdmin = user?.role === 'admin';
  const invalidate = [
    ['admin', 'clubs'],
    ['admin', 'communities'],
  ];
  const create = useAdminMutation({
    request: () => {
      if (sheet?.kind === 'rename')
        return write(`/communities/${sheet.community.id}`, { name }, 'PUT');
      return write(
        sheet?.kind === 'club' ? '/clubs' : '/communities',
        sheet?.kind === 'club' ? { name, community_id: community } : { name },
      );
    },
    invalidate,
    success: 'Saved',
    onSuccess: () => {
      setSheet(null);
      setName('');
    },
  });
  const remove = useAdminMutation({
    request: (c: Community) => write(`/communities/${c.id}`, undefined, 'DELETE'),
    invalidate,
    success: 'Community deleted',
    onSuccess: () => setDeleting(null),
  });
  const open = (next: Sheet, initial = '') => {
    create.reset();
    setName(initial);
    setSheet(next);
  };
  const canManage = (c: Community) =>
    !c.is_builtin && c.id !== 'open' && (isAdmin || c.created_by === user?.username);
  const title =
    sheet?.kind === 'club'
      ? tx('Create club')
      : sheet?.kind === 'rename'
        ? tx('Rename community')
        : tx('Create community');
  return (
    <Stack gap="xl">
      <PageHeader
        title={tx('Clubs & communities')}
        description={tx('The people and places that make your game.')}
        actions={
          <Group>
            {isAdmin && (
              <Button variant="default" onClick={() => open({ kind: 'community' })}>
                {tx('New community')}
              </Button>
            )}
            <Button leftSection={<IconPlus size={17} />} onClick={() => open({ kind: 'club' })}>
              {tx('Create club')}
            </Button>
          </Group>
        }
      />
      {clubs.isPending || communities.isPending ? (
        <Loading />
      ) : clubs.error || communities.error ? (
        <ErrorState error={clubs.error || communities.error} />
      ) : (
        <>
          <Stack gap="sm" component="section" aria-label={tx('Clubs')}>
            <VisuallyHidden>
              <Title order={2}>{tx('Clubs')}</Title>
            </VisuallyHidden>
            {!clubs.data.length ? (
              <EmptyState title={tx('Your club belongs here')}>
                {tx('A club gets a landing page, skill tiers, seasons and a player roster.')}
              </EmptyState>
            ) : (
              clubs.data.map((c) => (
                <EventRow
                  key={c.id}
                  to={`/admin/clubs/${c.id}`}
                  title={c.name}
                  testId="club-row"
                  leading={
                    <Avatar
                      src={c.has_logo ? `/api/clubs/${c.id}/logo` : undefined}
                      radius="md"
                      size={40}
                    >
                      <IconBuilding size={20} />
                    </Avatar>
                  }
                  meta={communities.data.find((cm) => cm.id === c.community_id)?.name}
                  badges={
                    <Badge size="sm" variant="light">
                      {tx('{n} tournaments', {
                        n: (tournaments.data ?? []).filter((t) => t.club_id === c.id).length,
                      })}
                    </Badge>
                  }
                  actions={
                    <Button component={Link} to={`/admin/clubs/${c.id}`} variant="light">
                      {tx('Manage club')}
                    </Button>
                  }
                />
              ))
            )}
          </Stack>
          <Stack gap="sm" component="section" aria-label={tx('Communities')}>
            <Title order={2}>{tx('Communities')}</Title>
            <Paper>
              <Table.ScrollContainer minWidth={420}>
                <Table verticalSpacing="md" horizontalSpacing="lg">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{tx('Community')}</Table.Th>
                      <Table.Th>{tx('Clubs')}</Table.Th>
                      <Table.Th>{tx('Tournaments')}</Table.Th>
                      <Table.Th w={1} aria-label={tx('Actions')} />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {communities.data.map((c) => (
                      <Table.Tr key={c.id}>
                        <Table.Td>
                          <Text fw={600} size="sm">
                            {c.name}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          {clubs.data.filter((cl) => cl.community_id === c.id).length}
                        </Table.Td>
                        <Table.Td>
                          {(tournaments.data ?? []).filter((t) => t.community_id === c.id).length}
                        </Table.Td>
                        <Table.Td>
                          {canManage(c) && (
                            <Menu position="bottom-end" withinPortal>
                              <Menu.Target>
                                <ActionIcon aria-label={tx('Options for {name}', { name: c.name })}>
                                  <IconDots size={18} />
                                </ActionIcon>
                              </Menu.Target>
                              <Menu.Dropdown>
                                <Menu.Item
                                  leftSection={<IconPencil size={15} />}
                                  onClick={() => open({ kind: 'rename', community: c }, c.name)}
                                >
                                  {tx('Rename')}
                                </Menu.Item>
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconTrash size={15} />}
                                  onClick={() => {
                                    remove.reset();
                                    setDeleting(c);
                                  }}
                                >
                                  {tx('Delete')}
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </Stack>
          <DefaultCommunity communities={communities.data} />
        </>
      )}
      <ResponsiveSheet opened={!!sheet} onClose={() => setSheet(null)} title={title}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Stack>
            <MutationError error={create.error} />
            <TextInput
              label={tx('Name')}
              required
              maxLength={100}
              data-autofocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
            />
            {sheet?.kind === 'club' && (
              <Select
                label={tx('Community')}
                required
                data={(communities.data ?? [])
                  .filter((c) => c.id !== 'open')
                  .map((c) => ({ value: c.id, label: c.name }))}
                value={community}
                onChange={setCommunity}
              />
            )}
            <Button type="submit" loading={create.isPending}>
              {sheet?.kind === 'rename' ? tx('Save') : title}
            </Button>
          </Stack>
        </form>
      </ResponsiveSheet>
      <ConfirmAction
        opened={!!deleting}
        title={tx('Delete community')}
        description={tx(
          'Delete «{name}»? Its tournaments move to the Open community. A community with clubs cannot be deleted.',
          { name: deleting?.name },
        )}
        confirmLabel={tx('Delete')}
        color="red"
        loading={remove.isPending}
        error={remove.error}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      />
    </Stack>
  );
}
