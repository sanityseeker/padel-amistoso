import { useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Box,
  Button,
  CopyButton,
  Divider,
  Group,
  Menu,
  Modal,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconCheck, IconCopy, IconLogout, IconUser, IconX } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { isDemoInstance } from '../../shell/env';
import { PushToggle, pushSupported } from '../player/components/PushToggle';
import { PLAYER_DATA } from '../../player/api';
import { profileInitials } from '../../player/session';
import shell from '../../shell/Shell.module.css';
import type { useTvPlayer } from './useTvPlayer';
import { Notice } from '../../ui/Notice';

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
    <Modal opened={opened} onClose={onClose} title={tx('Player Login')}>
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
          <Notice tone="danger" role="alert">
            {error}
          </Notice>
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
        <Button variant="light" size="compact-md" h="var(--tap-md)" onClick={() => setLogin(true)}>
          {tx('Sign in')}
        </Button>
        {player.tokenFailed && (
          <Text size="xs" c="red" role="alert">
            {tx('Login link expired — please enter your passphrase')}
          </Text>
        )}
        <LoginModal opened={login} onClose={() => setLogin(false)} player={player} />
      </Stack>
    );
  const name = session.playerName || session.playerId;
  // Opponents who shared a contact, to arrange the match; the court card already names everyone.
  const reachable = [...byRound].flatMap(([round, list]) =>
    list.filter((o) => o.contact).map((o) => ({ ...o, round })),
  );
  const round = reachable[0]?.round ?? 0;
  return (
    <Menu position="bottom-end" width={280} withinPortal>
      <Menu.Target>
        {/* The same initials as the app header's player menu. */}
        <ActionIcon size="touch" aria-label={tx('Player menu: {name}', { name })} title={name}>
          <span className={shell.avatar} data-size="lg" aria-hidden="true">
            {profileInitials(name)}
          </span>
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown data-testid="tv-player-panel">
        <Menu.Label>{name}</Menu.Label>
        {reachable.length > 0 && (
          <>
            <Menu.Divider />
            <Menu.Label>
              {round > 0 ? tx('Round {n} · your opponents', { n: round }) : tx('Your opponents')}
            </Menu.Label>
            {reachable.map((o) => (
              <CopyButton key={o.match_id + o.player_id} value={o.contact!}>
                {({ copied, copy }) => (
                  <Menu.Item
                    closeMenuOnClick={false}
                    leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    rightSection={
                      <Text size="xs" c="dimmed" ff="monospace">
                        {copied ? tx('Copied') : o.contact}
                      </Text>
                    }
                    onClick={copy}
                    aria-label={tx('Copy the contact of {name}', { name: o.name })}
                  >
                    {o.name}
                  </Menu.Item>
                )}
              </CopyButton>
            ))}
          </>
        )}
        <Menu.Divider />
        {session.hubAccessToken && !isDemoInstance() && (
          <Menu.Item
            component="a"
            href={`/player#token=${encodeURIComponent(session.hubAccessToken)}`}
            leftSection={<IconUser size={16} />}
          >
            {tx('My Player Hub')}
          </Menu.Item>
        )}
        {pushSupported() && (
          <Box px="sm" py={6}>
            <PushToggle tid={tid} token={player.token} />
          </Box>
        )}
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={player.logout}>
          {tx('Log out')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
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
    <Notice data-testid="hub-invite">
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
    </Notice>
  );
}
