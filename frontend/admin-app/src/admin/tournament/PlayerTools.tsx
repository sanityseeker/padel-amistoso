import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Group,
  NativeSelect,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { PlayerSecret } from '../../types';
import { ConfirmAction, MutationError, ResponsiveSheet } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

const codesKey = (tid: string) => ['admin', 'codes', tid];

interface Added {
  player_id: string;
  player_name: string;
  passphrase: string;
}
interface PastParticipant {
  player_id: string;
  name: string;
  last_tournament_name?: string | null;
}

// Add a player to a running Mexicano or group tournament. A past participant (no Hub profile yet)
// can be picked so their rating history carries over.
export function AddPlayerDialog({
  tid,
  groups,
  onClose,
}: {
  tid: string;
  /** Group names; required for group tournaments. */
  groups: string[];
  onClose: () => void;
}) {
  useLocale();
  const [name, setName] = useState('');
  const [group, setGroup] = useState<string | null>(groups[0] ?? null);
  const [past, setPast] = useState<string | null>(null);
  const [debounced] = useDebouncedValue(name, 250);
  const pastList = useQuery({
    queryKey: ['admin', 'past-participants', debounced],
    queryFn: () =>
      api<PastParticipant[]>(
        `/admin/player-profiles/past-participants?q=${encodeURIComponent(debounced.trim())}`,
      ),
    enabled: debounced.trim().length >= 2,
    retry: false,
  });
  const add = useAdminMutation({
    request: () =>
      write<Added>(`/tournaments/${tid}/players`, {
        name: name.trim(),
        group_name: groups.length ? group : undefined,
        past_player_id: past || undefined,
      }),
    invalidate: [codesKey(tid), ['admin', 'tournament', tid]],
  });
  return (
    <ResponsiveSheet opened onClose={onClose} title={tx('Add a player')}>
      {add.data ? (
        <Stack>
          <Alert color="green">
            {tx('{name} joined. Share this passphrase with them:', { name: add.data.player_name })}
          </Alert>
          <Code fz="xl">{add.data.passphrase}</Code>
          <Button onClick={onClose}>{tx('Done')}</Button>
        </Stack>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Stack>
            <MutationError error={add.error} />
            <TextInput
              label={tx('Player name')}
              required
              maxLength={128}
              data-autofocus
              value={name}
              onChange={(e) => {
                setName(e.currentTarget.value);
                setPast(null);
              }}
            />
            {groups.length > 0 && (
              <NativeSelect
                label={tx('Group')}
                value={group ?? ''}
                onChange={(e) => setGroup(e.currentTarget.value)}
                data={groups.map((g) => ({ value: g, label: tx('Group {name}', { name: g }) }))}
              />
            )}
            {!!pastList.data?.length && (
              <Select
                label={tx('Same person as a past participant?')}
                description={tx('Keeps their rating history. Leave empty for a new player.')}
                placeholder={tx('New player')}
                clearable
                value={past}
                onChange={setPast}
                data={pastList.data.map((p) => ({
                  value: p.player_id,
                  label: p.last_tournament_name ? `${p.name} (${p.last_tournament_name})` : p.name,
                }))}
              />
            )}
            <Button type="submit" loading={add.isPending} disabled={!name.trim()}>
              {tx('Add player')}
            </Button>
          </Stack>
        </form>
      )}
    </ResponsiveSheet>
  );
}

export function RemovePlayerDialog({
  tid,
  playerId,
  name,
  onClose,
}: {
  tid: string;
  playerId: string;
  name: string;
  onClose: () => void;
}) {
  useLocale();
  const remove = useAdminMutation({
    request: () => write(`/tournaments/${tid}/players/${playerId}`, undefined, 'DELETE'),
    invalidate: [codesKey(tid), ['admin', 'tournament', tid]],
    success: 'Player removed',
    onSuccess: onClose,
  });
  return (
    <ConfirmAction
      opened
      title={tx('Remove {name}?', { name })}
      description={tx(
        'They leave future rounds. Results already played stay in the standings. A player in a pending match cannot be removed.',
      )}
      confirmLabel={tx('Remove')}
      color="red"
      loading={remove.isPending}
      error={remove.error}
      onConfirm={() => remove.mutate()}
      onClose={onClose}
    />
  );
}

// Contact line, email (a matching Player Hub profile is linked automatically) and email language.
export function ContactSheet({
  tid,
  playerId,
  player,
  onClose,
}: {
  tid: string;
  playerId: string;
  player: PlayerSecret;
  onClose: () => void;
}) {
  useLocale();
  const [contact, setContact] = useState(player.contact ?? '');
  const [email, setEmail] = useState(player.email ?? '');
  const [lang, setLang] = useState(player.lang || 'en');
  const base = `/tournaments/${tid}/player-secrets/${playerId}`;
  const save = useAdminMutation({
    request: async () => {
      if (contact !== (player.contact ?? '')) await write(`${base}/contact`, { contact }, 'PUT');
      if (email !== (player.email ?? ''))
        await write<{ profile_linked?: boolean }>(`${base}/email`, { email }, 'PUT');
      if (lang !== (player.lang || 'en')) await write(`${base}/lang`, { lang }, 'PUT');
    },
    invalidate: [codesKey(tid)],
    success: 'Player details saved',
    onSuccess: onClose,
  });
  return (
    <ResponsiveSheet opened onClose={onClose} title={player.name}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Stack>
          <MutationError error={save.error} />
          <TextInput
            label={tx('Contact details')}
            description={tx('Phone or any note for the organizer. Players do not see it.')}
            maxLength={256}
            value={contact}
            onChange={(e) => setContact(e.currentTarget.value)}
          />
          <TextInput
            label={tx('Email')}
            description={tx('If it matches a Player Hub profile, the event appears in their hub.')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <NativeSelect
            label={tx('Email language')}
            value={lang}
            onChange={(e) => setLang(e.currentTarget.value)}
            data={[
              { value: 'en', label: 'English' },
              { value: 'es', label: 'Español' },
              { value: 'ru', label: 'Русский' },
            ]}
          />
          <Button type="submit" loading={save.isPending}>
            {tx('Save')}
          </Button>
        </Stack>
      </form>
    </ResponsiveSheet>
  );
}

interface ProfileSummary {
  id: string;
  name: string;
  email: string;
  is_ghost: boolean;
}

// Link a tournament participant to a Player Hub profile (site administrators), or unlink.
export function LinkProfileSheet({
  tid,
  playerId,
  player,
  onClose,
}: {
  tid: string;
  playerId: string;
  player: PlayerSecret;
  onClose: () => void;
}) {
  useLocale();
  const [q, setQ] = useState(player.name);
  const [debounced] = useDebouncedValue(q, 250);
  const profiles = useQuery({
    queryKey: ['admin', 'profiles', debounced],
    queryFn: () =>
      api<ProfileSummary[]>(
        `/admin/player-profiles?q=${encodeURIComponent(debounced.trim())}&limit=20`,
      ),
    enabled: debounced.trim().length >= 2,
  });
  const invalidate = [codesKey(tid), ['admin', 'profile']];
  const link = useAdminMutation({
    request: (profileId: string) =>
      write(`/admin/player-profiles/${profileId}/link/${tid}/${playerId}`),
    invalidate,
    success: 'Linked to the profile',
    onSuccess: onClose,
  });
  const unlink = useAdminMutation({
    request: () => write(`/admin/player-profiles/link/${tid}/${playerId}`, undefined, 'DELETE'),
    invalidate,
    success: 'Profile unlinked',
    onSuccess: onClose,
  });
  return (
    <ResponsiveSheet opened onClose={onClose} title={tx('Player Hub profile')} size="lg">
      <Stack>
        <Text size="sm" c="dimmed">
          {player.profile_id
            ? tx('{name} is linked to a Player Hub profile.', { name: player.name })
            : tx('Link {name} to a Player Hub profile so the event counts for their rating.', {
                name: player.name,
              })}
        </Text>
        <MutationError error={link.error ?? unlink.error} />
        <TextInput
          label={tx('Search profiles')}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
        />
        <Stack gap={4}>
          {(profiles.data ?? []).map((p) => (
            <Group key={p.id} justify="space-between" wrap="nowrap">
              <div>
                <Text fw={600} size="sm">
                  {p.name}{' '}
                  {p.is_ghost && (
                    <Badge size="xs" variant="outline" color="gray">
                      {tx('Past participant')}
                    </Badge>
                  )}
                </Text>
                <Text size="xs" c="dimmed">
                  {p.email || '—'}
                </Text>
              </div>
              <Button
                size="compact-md"
                variant="light"
                loading={link.isPending && link.variables === p.id}
                onClick={() => link.mutate(p.id)}
              >
                {player.profile_id ? tx('Relink') : tx('Link')}
              </Button>
            </Group>
          ))}
          {profiles.data && !profiles.data.length && (
            <Text size="sm" c="dimmed">
              {tx('No profiles found')}
            </Text>
          )}
        </Stack>
        {player.profile_id && (
          <Button
            variant="default"
            color="red"
            loading={unlink.isPending}
            onClick={() => unlink.mutate()}
          >
            {tx('Unlink profile')}
          </Button>
        )}
      </Stack>
    </ResponsiveSheet>
  );
}
