import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Menu,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  Tabs,
  Text,
  TextInput,
} from '@mantine/core';
import {
  IconDots,
  IconMailPlus,
  IconPlus,
  IconSearch,
  IconSettings,
  IconTrash,
} from '@tabler/icons-react';
import { useMediaQuery } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { useAuth } from '../../auth';
import { ErrorState, Loading, useOverview } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { User } from '../../types';
import { ConfirmAction, MutationError, PageHeader, ResponsiveSheet } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

const ROLES = () => [
  { value: 'user', label: tx('Organizer') },
  { value: 'admin', label: tx('Administrator') },
];

// Accounts: create one with a temporary password, or e-mail an invitation. Per-user settings set the
// default community and whether the organizer may create clubs.
export function UsersPage() {
  useLocale();
  const { username: me } = useAuth();
  const { communities } = useOverview();
  const [search, setSearch] = useState('');
  const [sheet, setSheet] = useState<'create' | 'invite' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('user');
  const [deleting, setDeleting] = useState<User | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const users = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api<User[]>('/auth/users'),
  });
  const key = [['admin', 'users']];
  const create = useAdminMutation({
    request: () => write('/auth/users', { username, password, role }),
    invalidate: key,
    success: 'User created',
    onSuccess: () => {
      setSheet(null);
      setUsername('');
      setPassword('');
    },
  });
  const invite = useAdminMutation({
    request: () => write('/auth/invite', { email, role }),
    success: 'Invitation sent',
    onSuccess: () => {
      setSheet(null);
      setEmail('');
    },
  });
  const remove = useAdminMutation({
    request: (u: User) =>
      write(`/auth/users/${encodeURIComponent(u.username)}`, undefined, 'DELETE'),
    invalidate: key,
    success: 'User deleted',
    onSuccess: () => setDeleting(null),
  });
  const [community, setCommunity] = useState<string | null>(null);
  const [canClubs, setCanClubs] = useState(false);
  const settings = useAdminMutation({
    request: () =>
      write(
        `/auth/users/${encodeURIComponent(editing!.username)}/settings`,
        { default_community_id: community ?? undefined, can_create_clubs: canClubs },
        'PATCH',
      ),
    invalidate: key,
    success: 'Settings saved',
    onSuccess: () => setEditing(null),
  });
  const rowMenu = (u: User) => (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon aria-label={tx('Options for {name}', { name: u.username })}>
          <IconDots size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<IconSettings size={15} />}
          onClick={() => {
            settings.reset();
            setCommunity(u.default_community_id);
            setCanClubs(!!u.can_create_clubs);
            setEditing(u);
          }}
        >
          {tx('Settings')}
        </Menu.Item>
        <Menu.Item
          color="red"
          disabled={u.username === me}
          leftSection={<IconTrash size={15} />}
          onClick={() => {
            remove.reset();
            setDeleting(u);
          }}
        >
          {tx('Delete')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const shown = (users.data ?? []).filter((u) =>
    u.username.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Stack gap="lg">
      <PageHeader
        title={tx('Users')}
        description={tx('Give your organizing team a place in the club.')}
        actions={
          <Group>
            <Button
              variant="default"
              leftSection={<IconMailPlus size={17} />}
              onClick={() => {
                invite.reset();
                setSheet('invite');
              }}
            >
              {tx('Invite by email')}
            </Button>
            <Button
              leftSection={<IconPlus size={17} />}
              onClick={() => {
                create.reset();
                setSheet('create');
              }}
            >
              {tx('Add user')}
            </Button>
          </Group>
        }
      />
      <TextInput
        maw={380}
        placeholder={tx('Search users')}
        aria-label={tx('Search users')}
        leftSection={<IconSearch size={17} />}
        value={search}
        onChange={(e) => setSearch(e.currentTarget.value)}
      />
      {users.isPending ? (
        <Loading />
      ) : users.error ? (
        <ErrorState error={users.error} retry={() => void users.refetch()} />
      ) : phone ? (
        // Phones: one row per user with the menu on the row, no sideways scrolling to reach it.
        <Paper p={0} variant="row" role="list" style={{ overflow: 'hidden' }}>
          {shown.map((u) => (
            <Group
              key={u.username}
              role="listitem"
              justify="space-between"
              wrap="nowrap"
              p="sm"
              style={{ borderTop: '1px solid var(--app-border)' }}
            >
              <Stack gap={2} miw={0}>
                <Group gap="xs">
                  <Text fw={600} size="sm">
                    {u.username}
                  </Text>
                  <Badge color={u.role === 'admin' ? 'court' : 'gray'} variant="light">
                    {u.role}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {[u.email, u.disabled ? tx('Disabled') : tx('Active')]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </Stack>
              {rowMenu(u)}
            </Group>
          ))}
        </Paper>
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={560}>
            <Table verticalSpacing="md" horizontalSpacing="lg">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tx('Username')}</Table.Th>
                  <Table.Th>{tx('Role')}</Table.Th>
                  <Table.Th>{tx('Email')}</Table.Th>
                  <Table.Th>{tx('Status')}</Table.Th>
                  <Table.Th w={1} aria-label={tx('Actions')} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {shown.map((u) => (
                  <Table.Tr key={u.username}>
                    <Table.Td>
                      <Text fw={600} size="sm">
                        {u.username}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge color={u.role === 'admin' ? 'court' : 'gray'} variant="light">
                        {u.role}
                      </Badge>
                    </Table.Td>
                    <Table.Td>{u.email || '—'}</Table.Td>
                    <Table.Td>{u.disabled ? tx('Disabled') : tx('Active')}</Table.Td>
                    <Table.Td>{rowMenu(u)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      <ResponsiveSheet
        opened={sheet === 'create' || sheet === 'invite'}
        onClose={() => setSheet(null)}
        title={sheet === 'invite' ? tx('Invite by email') : tx('Add user')}
      >
        <Tabs
          value={sheet ?? 'create'}
          onChange={(v) => setSheet((v as 'create' | 'invite') ?? 'create')}
          mb="md"
        >
          <Tabs.List grow>
            <Tabs.Tab value="create">{tx('Create account')}</Tabs.Tab>
            <Tabs.Tab value="invite">{tx('Send invitation')}</Tabs.Tab>
          </Tabs.List>
        </Tabs>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            (sheet === 'invite' ? invite : create).mutate();
          }}
        >
          <Stack>
            <MutationError error={sheet === 'invite' ? invite.error : create.error} />
            {sheet === 'invite' ? (
              <>
                <TextInput
                  label={tx('Email')}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
                <Text size="xs" c="dimmed">
                  {tx('They get a link to choose their own username and password.')}
                </Text>
              </>
            ) : (
              <>
                <TextInput
                  label={tx('Username')}
                  autoComplete="off"
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-zA-Z0-9_\-]+"
                  value={username}
                  onChange={(e) => setUsername(e.currentTarget.value)}
                />
                <TextInput
                  label={tx('Temporary password')}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.currentTarget.value)}
                />
              </>
            )}
            <Select
              label={tx('Role')}
              allowDeselect={false}
              value={role}
              onChange={(v) => setRole(v ?? 'user')}
              data={ROLES()}
            />
            <Button type="submit" loading={create.isPending || invite.isPending}>
              {sheet === 'invite' ? tx('Send invitation') : tx('Create user')}
            </Button>
          </Stack>
        </form>
      </ResponsiveSheet>
      <ResponsiveSheet
        opened={!!editing}
        onClose={() => setEditing(null)}
        title={tx('Settings for {name}', { name: editing?.username })}
      >
        <Stack>
          <MutationError error={settings.error} />
          <Select
            label={tx('Default community')}
            allowDeselect={false}
            data={(communities.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
            value={community}
            onChange={setCommunity}
          />
          <Switch
            label={tx('Can create clubs')}
            checked={canClubs}
            onChange={(e) => setCanClubs(e.currentTarget.checked)}
          />
          <Button loading={settings.isPending} onClick={() => settings.mutate()}>
            {tx('Save')}
          </Button>
        </Stack>
      </ResponsiveSheet>
      <ConfirmAction
        opened={!!deleting}
        title={tx('Delete user')}
        description={tx('Delete «{name}»? Their tournaments stay.', { name: deleting?.username })}
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
