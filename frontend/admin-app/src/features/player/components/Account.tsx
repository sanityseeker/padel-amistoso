import { t as tx, useLocale } from '../../../i18n';
import { useState } from 'react';
import {
  Button,
  CopyButton,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconCopy, IconMail } from '@tabler/icons-react';
import { playerApi } from '../../../player/api';
import type { Profile } from '../../../player/types';
import { Notice } from '../../../ui/Notice';
export function PlayerAccount({
  profile,
  editing = false,
}: {
  profile: Profile;
  editing?: boolean;
}) {
  useLocale();
  const client = useQueryClient();
  const [name, setName] = useState(profile.name);
  const [email, setEmail] = useState(profile.email);
  const [contact, setContact] = useState(profile.contact);
  const [visible, setVisible] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      playerApi(
        '/player-profile',
        {
          name,
          email,
          contact,
        },
        'PUT',
      ),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ['player', 'space'],
      });
      notifications.show({
        message: tx('Profile updated'),
        color: 'green',
      });
    },
  });
  const verify = useMutation({
    mutationFn: () => playerApi('/player-profile/resend-verification', {}, 'POST'),
    onSuccess: () =>
      notifications.show({
        message: tx('Verification email requested. Check your inbox.'),
        color: 'green',
      }),
  });
  return (
    <Stack>
      {editing ? (
        <Paper p="xl">
          <Title order={3} mb="md">
            {tx('Your profile')}
          </Title>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Stack>
              {save.error && <Notice tone="danger">{tx(save.error.message)}</Notice>}
              <TextInput
                label={tx('Display name')}
                required
                maxLength={128}
                value={name}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <TextInput
                label={tx('Email address')}
                type="email"
                required
                maxLength={256}
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
              <TextInput
                label={tx('Contact details')}
                description={tx('Shared with organizers of your linked events')}
                maxLength={256}
                value={contact}
                onChange={(e) => setContact(e.currentTarget.value)}
              />
              <Button type="submit" loading={save.isPending}>
                {tx('Save profile')}
              </Button>
            </Stack>
          </form>
        </Paper>
      ) : (
        <Stack>
          {!profile.email_verified && (
            <Paper p="md">
              <Title order={3} mb="md">
                {tx('Email verification')}
              </Title>
              <Text size="sm" c="dimmed">
                {profile.email_verified
                  ? tx('Your email is verified and can help connect your event entries.')
                  : tx('Verify your email to connect entries registered with this address.')}
              </Text>
              {!profile.email_verified && (
                <Button
                  variant="light"
                  mt="md"
                  leftSection={<IconMail size={16} />}
                  loading={verify.isPending}
                  onClick={() => verify.mutate()}
                >
                  {tx('Resend verification')}
                </Button>
              )}
              {verify.error && (
                <Notice mt="md" tone="danger">
                  {tx(verify.error.message)}
                </Notice>
              )}
            </Paper>
          )}
          <Paper p="md">
            <Title order={3}>{tx('Your player passphrase')}</Title>
            <Text size="sm" c="dimmed" mt="sm" mb="md">
              {tx('Keep this private. It gives access to your player profile.')}
            </Text>
            {profile.passphrase && (
              <>
                <PasswordInput
                  aria-label={tx('Your player passphrase')}
                  readOnly
                  value={profile.passphrase}
                  visible={visible}
                  onVisibilityChange={setVisible}
                />
                <CopyButton value={profile.passphrase}>
                  {({ copied, copy }) => (
                    <Button
                      variant="subtle"
                      mt="sm"
                      onClick={copy}
                      leftSection={copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
                    >
                      {copied ? tx('Copied') : tx('Copy passphrase')}
                    </Button>
                  )}
                </CopyButton>
              </>
            )}
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
