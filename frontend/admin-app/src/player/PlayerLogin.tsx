import { t as tx, useLocale, currentLanguage } from '../i18n';
import { useState } from 'react';
import {
  Alert,
  Anchor,
  Button,
  Center,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { rememberPage } from '../shell/env';
import { useMutation } from '@tanstack/react-query';
import { playerApi } from './api';
import type { Resolution, Session, Space } from './types';
export function PlayerLogin({
  initialPassphrase,
  onSession,
}: {
  initialPassphrase: string;
  onSession: (session: Session) => void;
}) {
  useLocale();
  const [passphrase, setPassphrase] = useState(initialPassphrase);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [recovering, setRecovering] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const resolve = useMutation({
    mutationFn: async () => {
      const result = await playerApi<Resolution>(
        '/player-profile/resolve',
        {
          passphrase: passphrase.trim(),
        },
        'POST',
        null,
      );
      if (result.type === 'not_found')
        throw new Error(
          'Passphrase not recognised. Check the code from your organizer or join an event first.',
        );
      if (result.type === 'profile')
        onSession(
          await playerApi<Session>(
            '/player-profile/login',
            {
              passphrase: passphrase.trim(),
            },
            'POST',
            null,
          ),
        );
      else {
        setResolution(result);
        setName(result.matches[0]?.player_name || '');
      }
    },
  });
  const create = useMutation({
    mutationFn: () =>
      playerApi<Space>(
        '/player-profile',
        {
          participant_passphrase: passphrase.trim(),
          name,
          email,
          lang: currentLanguage(),
        },
        'POST',
        null,
      ),
    onSuccess: onSession,
  });
  const recover = useMutation({
    mutationFn: () =>
      playerApi(
        '/player-profile/recover',
        {
          email,
        },
        'POST',
        null,
      ),
    onSuccess: () => setRecovered(true),
  });
  // Returning players who took part in an event but never made a profile: the server finds their
  // participations by email and mails a sign-in link. It always answers ok, so nothing leaks.
  const recoverByParticipation = useMutation({
    mutationFn: () =>
      playerApi('/player-profile/recover-by-participation', { email }, 'POST', null),
    onSuccess: () => setRecovered(true),
  });
  const error = resolve.error || create.error || recover.error || recoverByParticipation.error;
  return (
    <>
      <Center p="xl">
        <Paper p="xl" maw={440} w="100%" className="login-card">
          <Group justify="space-between" wrap="nowrap">
            <Title order={2}>
              {recovering
                ? tx('Recover passphrase')
                : resolution
                  ? tx('Create player profile')
                  : tx('Player Hub')}
            </Title>
          </Group>
          <Text c="dimmed" mt="xs" mb="xl">
            {recovering
              ? tx('Enter the email linked to your Player Hub profile.')
              : resolution
                ? tx('Create your player profile using your event passphrase.')
                : tx('Enter your player or event passphrase to continue.')}
          </Text>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (recovering) recover.mutate();
              else if (resolution) create.mutate();
              else resolve.mutate();
            }}
          >
            <Stack>
              {error && <Alert color="red">{tx(error.message)}</Alert>}
              {recovered && (
                <Alert color="court">
                  {tx(
                    'If a matching profile exists, recovery instructions will be sent to that email.',
                  )}
                </Alert>
              )}
              {!recovering && !resolution && (
                <PasswordInput
                  label={tx('Player passphrase')}
                  placeholder={tx('e.g. brave-little-tiger')}
                  autoComplete="current-password"
                  required
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.currentTarget.value)}
                />
              )}
              {resolution && (
                <>
                  <Alert color="court">
                    {tx('We found you in {events}.', {
                      events: resolution.matches.map((m) => m.entity_name).join(', '),
                    })}
                  </Alert>
                  <TextInput
                    label={tx('Your name')}
                    required
                    maxLength={128}
                    value={name}
                    onChange={(e) => setName(e.currentTarget.value)}
                  />
                </>
              )}
              {(recovering || resolution) && (
                <TextInput
                  label={tx('Email address')}
                  type="email"
                  required
                  maxLength={256}
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
              )}
              <Button
                type="submit"
                loading={resolve.isPending || create.isPending || recover.isPending}
                disabled={recovering && recovered}
                rightSection={<IconArrowRight size={16} />}
              >
                {recovering
                  ? tx('Send recovery email')
                  : resolution
                    ? tx('Create player profile')
                    : tx('Continue')}
              </Button>
              {recovering && (
                <Button
                  variant="light"
                  loading={recoverByParticipation.isPending}
                  disabled={recovered || !email}
                  onClick={() => recoverByParticipation.mutate()}
                >
                  {tx('I played in an event but have no profile')}
                </Button>
              )}
              <Button
                variant="subtle"
                color="gray"
                onClick={() => {
                  resolve.reset();
                  recoverByParticipation.reset();
                  create.reset();
                  recover.reset();
                  if (resolution || recovering) {
                    setResolution(null);
                    setRecovering(false);
                    setRecovered(false);
                  } else setRecovering(true);
                }}
              >
                {resolution || recovering ? tx('Back to login') : tx('Forgot your passphrase?')}
              </Button>
              <Button component="a" href="/events" variant="default">
                {tx('Explore public events')}
              </Button>
              <Text c="dimmed" size="xs" ta="center">
                {tx('New here? Join an event to get your first player passphrase.')}
              </Text>
              {/* The organizer door: the header's corner is the players'. */}
              <Text c="dimmed" size="xs" ta="center">
                {tx('Organizing tournaments?')}{' '}
                <Anchor
                  component={Link}
                  to="/admin"
                  size="xs"
                  onClick={() => rememberPage('admin')}
                >
                  {tx('Admin sign in')}
                </Anchor>
              </Text>
            </Stack>
          </form>
        </Paper>
      </Center>
    </>
  );
}
