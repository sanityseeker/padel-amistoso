import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Anchor,
  Button,
  CopyButton,
  Divider,
  Group,
  Modal,
  Popover,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core';
import { IconChevronDown, IconKey, IconUser, IconX } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { isDemoInstance } from '../../shell/env';
import { PushToggle, pushSupported } from '../player/components/PushToggle';
import { PLAYER_DATA } from '../../player/api';
import type { useTvPlayer } from './useTvPlayer';

type Player = ReturnType<typeof useTvPlayer>;

function LoginModal({
  opened,
  onClose,
  player,
}: {
  opened: boolean;
  onClose: () => void;
  player: Player;
}) {
  useLocale();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, onFail: (e: Error) => string) => {
    setBusy(true);
    setError('');
    try {
      await action();
      onClose();
    } catch (e) {
      setError(onFail(e as Error));
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const phrase = passphrase.trim();
    if (!phrase) return setError(tx('Enter your passphrase'));
    void run(
      () => player.loginWithPassphrase(phrase),
      (e) => tx(e.message || 'Authentication failed'),
    );
  };
  const hub = () => {
    let hasProfile = false;
    try {
      hasProfile = !!JSON.parse(localStorage.getItem(PLAYER_DATA) || 'null')?.passphrase;
    } catch {
      hasProfile = false;
    }
    if (!hasProfile) {
      setError(tx('No Player Hub profile found — set one up first.'));
      window.setTimeout(() => window.open('/player', '_blank', 'noopener'), 800);
      return;
    }
    void run(
      () => player.loginWithHub(),
      () => tx("Player Hub profile doesn't match this tournament."),
    );
  };
  return (
    <Modal opened={opened} onClose={onClose} title={tx('Player Login')} centered>
      <Stack
        component="form"
        gap="sm"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          submit();
        }}
      >
        <TextInput
          label={tx('Passphrase')}
          placeholder={tx('Enter your passphrase')}
          description={tx('Your 3-word code from the organizer.')}
          autoComplete="off"
          spellCheck={false}
          data-autofocus
          value={passphrase}
          onChange={(e) => setPassphrase(e.currentTarget.value)}
        />
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <Button type="submit" size="touch" loading={busy}>
          {tx('Login')}
        </Button>
        {!isDemoInstance() && (
          <>
            <Divider label={tx('or')} labelPosition="center" />
            <Button
              variant="default"
              size="touch"
              leftSection={<IconUser size={18} />}
              disabled={busy}
              onClick={hub}
            >
              {tx('Log in with Player Hub')}
            </Button>
          </>
        )}
      </Stack>
    </Modal>
  );
}

// The sign-in control of the TV page. Signed out: a "Player Login" button (and a notice when the QR or
// e-mail link was refused). Signed in: the player's name opens a panel with the people they play with
// (tap a contact to copy it), their Player Hub passphrase, notifications and Log out.
export function TvPlayerBar({ tid, player }: { tid: string; player: Player }) {
  useLocale();
  const [login, setLogin] = useState(false);
  const [panel, setPanel] = useState(false);
  const session = player.session;
  const byRound = new Map<number, typeof player.opponents>();
  for (const o of player.opponents)
    byRound.set(o.round_number > 0 ? o.round_number : 0, [
      ...(byRound.get(o.round_number > 0 ? o.round_number : 0) ?? []),
      o,
    ]);
  if (!session)
    return (
      <Stack gap={4} align="flex-end">
        <Button
          size="tv"
          variant="default"
          leftSection={<IconKey size={18} />}
          onClick={() => setLogin(true)}
        >
          {tx('Player Login')}
        </Button>
        {player.tokenFailed && (
          <Text size="xs" c="red" role="alert">
            {tx('Login link expired — please enter your passphrase')}
          </Text>
        )}
        <LoginModal opened={login} onClose={() => setLogin(false)} player={player} />
      </Stack>
    );
  return (
    <Popover opened={panel} onChange={setPanel} width={340} position="bottom-end" shadow="md">
      <Popover.Target>
        <Button
          size="tv"
          variant="light"
          leftSection={<IconKey size={18} />}
          rightSection={<IconChevronDown size={16} />}
          aria-expanded={panel}
          onClick={() => setPanel((o) => !o)}
        >
          {session.playerName || session.playerId}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm" data-testid="tv-player-panel">
          <Text variant="eyebrow">{tx('You play with')}</Text>
          {player.opponents.length === 0
            ? player.opponentsLoaded && (
                <Text size="sm" c="dimmed">
                  {tx('No upcoming matches yet')}
                </Text>
              )
            : [...byRound].map(([round, list]) => (
                <Stack key={round} gap={4}>
                  {round > 0 && (
                    <Text size="xs" c="dimmed">
                      {tx('Round')} {round}
                    </Text>
                  )}
                  {list.map((o) => (
                    <Group key={o.match_id + o.player_id} justify="space-between" wrap="nowrap">
                      <Text size="sm">{o.name}</Text>
                      {o.contact && (
                        <CopyButton value={o.contact}>
                          {({ copied, copy }) => (
                            <UnstyledButton onClick={copy} title={tx('Click to copy')}>
                              <Text size="sm" c="court" ff="monospace">
                                {copied ? tx('Copied') : o.contact}
                              </Text>
                            </UnstyledButton>
                          )}
                        </CopyButton>
                      )}
                    </Group>
                  ))}
                </Stack>
              ))}
          {session.hubPassphrase && !isDemoInstance() && (
            <Stack gap={4}>
              <Text variant="eyebrow">{tx('Your Player Hub')}</Text>
              <CopyButton value={session.hubPassphrase}>
                {({ copied, copy }) => (
                  <UnstyledButton onClick={copy} title={tx('Click to copy')}>
                    <Text ff="monospace" fw={600}>
                      {copied ? tx('Copied') : session.hubPassphrase}
                    </Text>
                  </UnstyledButton>
                )}
              </CopyButton>
              {session.hubAccessToken && (
                <Anchor
                  href={`/player#token=${encodeURIComponent(session.hubAccessToken)}`}
                  target="_blank"
                  rel="noopener"
                  size="sm"
                >
                  {tx('Open Player Hub')}
                </Anchor>
              )}
            </Stack>
          )}
          {pushSupported() && <PushToggle tid={tid} token={player.token} />}
          <Button variant="default" onClick={player.logout}>
            {tx('Logout')}
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}

const DISMISSED = (tid: string) => `padel-hub-cta-dismissed:${tid}`;

// "Save your stats across tournaments": offered once per tab to a player who signed in with a passphrase
// and has no Player Hub profile on this device. Hidden on the demo instance, which has no Hub.
export function HubInvite({ tid, player }: { tid: string; player: Player }) {
  useLocale();
  const [hidden, setHidden] = useState(() => {
    try {
      return sessionStorage.getItem(DISMISSED(tid)) === '1';
    } catch {
      return false;
    }
  });
  const session = player.session;
  let profile = false;
  try {
    profile = !!localStorage.getItem(PLAYER_DATA);
  } catch {
    profile = false;
  }
  if (
    hidden ||
    isDemoInstance() ||
    !session ||
    session.hasHubProfile !== false ||
    !session.loginPassphrase ||
    profile
  )
    return null;
  return (
    <Alert color="court" variant="light" data-testid="hub-invite">
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="md" wrap="wrap">
          <Text size="sm" fw={600}>
            {tx('Save your stats across tournaments')}
          </Text>
          <Anchor
            size="sm"
            href={`/player#participant_passphrase=${encodeURIComponent(session.loginPassphrase)}`}
            target="_blank"
            rel="noopener"
          >
            {tx('Create your Player Hub')}
          </Anchor>
        </Group>
        <ActionIcon
          aria-label={tx('Dismiss')}
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISSED(tid), '1');
            } catch {
              /* Hidden for this view only. */
            }
            setHidden(true);
          }}
        >
          <IconX size={16} />
        </ActionIcon>
      </Group>
    </Alert>
  );
}
