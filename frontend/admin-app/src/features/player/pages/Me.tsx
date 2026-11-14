import { useState } from 'react';
import { Button, Group, Paper, Stack, Text, Title, useMatches } from '@mantine/core';
import { IconLogout, IconSettings } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../../i18n';
import { useAuth } from '../../../auth';
import type { Entry } from '../../../player/types';
import { usePlayerSession } from '../../../player/session';
import { PlayerAccount } from '../components/Account';
import { PushToggle } from '../components/PushToggle';
import { PageHeader, StatusBadge } from '../../../ui';
import { usePlayerSpace } from '../context';
import { usePlayerToken } from '../eventData';

function EntryPush({ entry }: { entry: Entry }) {
  const { token } = usePlayerToken(entry);
  return <PushToggle tid={entry.entity_id} token={token} label={entry.entity_name} />;
}

// Me: profile, email verification, passphrase, notifications and the advanced tools.
// Install, language and theme live in the top bar, not here. Log out of the Player Hub lives here and
// in the header's player menu.
export default function Me() {
  const gap = useMatches({ base: 'md', sm: 'lg' });
  useLocale();
  const { space, liveEntries } = usePlayerSpace();
  const { logout } = usePlayerSession();
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const profile = space.profile;
  // Every tournament in progress, whatever community is picked: the scope narrows ratings and
  // history, never which tournaments can notify you.
  const live = liveEntries.filter(
    (e) =>
      e.status === 'active' &&
      e.entity_type === 'tournament' &&
      !e.entity_deleted &&
      !!e.auto_login_token,
  );
  return (
    <Stack gap={gap}>
      <PageHeader
        title={profile.name}
        description={profile.email}
        keepDescription
        meta={
          <StatusBadge tone={profile.email_verified ? 'success' : 'warning'}>
            {tx(profile.email_verified ? 'Verified' : 'Pending')}
          </StatusBadge>
        }
        actions={
          editing ? undefined : (
            <Button size="xs" variant="default" onClick={() => setEditing(true)}>
              {tx('Edit')}
            </Button>
          )
        }
      />
      <PlayerAccount
        key={profile.id + profile.name + profile.email + profile.contact + String(editing)}
        profile={profile}
        editing={editing}
        onDone={() => setEditing(false)}
      />
      {live.length > 0 && (
        <Paper p="md">
          <Title order={2} size="h3" mb="xs">
            {tx('Notifications')}
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            {tx('Get a push message when your next match is ready.')}
          </Text>
          <Stack gap="xs">
            {live.map((entry) => (
              <EntryPush key={entry.entity_id} entry={entry} />
            ))}
          </Stack>
        </Paper>
      )}
      <Group justify="space-between">
        {auth.hasToken ? (
          <Button
            component={Link}
            to="/admin"
            variant="subtle"
            leftSection={<IconSettings size={16} />}
          >
            {tx('Admin')}
          </Button>
        ) : (
          <span />
        )}
        <Button
          color="red"
          variant="light"
          leftSection={<IconLogout size={16} />}
          aria-label={tx('Log out of Player Hub')}
          onClick={logout}
        >
          {tx('Log out')}
        </Button>
      </Group>
    </Stack>
  );
}
