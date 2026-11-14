import { useMemo, useState } from 'react';
import { Button, Checkbox, Group, ScrollArea, Stack, Tabs, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { useAuth } from '../../auth';
import { t as tx, useLocale } from '../../i18n';
import { FormActions, ResponsiveSheet } from '../../ui';
import { StatusBadge } from '../../ui/StatusBadge';

export interface PickedPlayer {
  name: string;
  email?: string;
  profile_id?: string;
}
interface Candidate extends PickedPlayer {
  key: string;
  note?: string;
}
interface ClubPlayer {
  profile_id: string;
  name: string;
  email: string | null;
  has_hub_profile: boolean;
  elo_padel: number | null;
  elo_tennis: number | null;
}
interface Profile {
  id: string;
  name: string;
  email: string;
  is_ghost: boolean;
}
interface Past {
  player_id: string;
  name: string;
  last_tournament_name?: string | null;
}

// Add players from what the system already knows: a club roster, Player Hub profiles (site
// administrators) and past participants without a profile. Returns names plus the profile id and
// email, which the create request carries as player_profile_ids and player_emails.
export function RosterPicker({
  clubId,
  sport,
  taken,
  onAdd,
  onClose,
}: {
  clubId: string | null;
  sport: string;
  taken: Set<string>;
  onAdd: (players: PickedPlayer[]) => void;
  onClose: () => void;
}) {
  useLocale();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<string>(clubId ? 'club' : isAdmin ? 'profiles' : 'club');
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 250);
  const [picked, setPicked] = useState<Record<string, Candidate>>({});
  const needle = debounced.trim();

  const club = useQuery({
    queryKey: ['admin', 'club-roster', clubId, sport],
    queryFn: () => api<ClubPlayer[]>(`/clubs/${clubId}/players?sport=${sport}`),
    enabled: !!clubId,
  });
  const profiles = useQuery({
    queryKey: ['admin', 'profiles', needle],
    queryFn: () =>
      api<Profile[]>(`/admin/player-profiles?q=${encodeURIComponent(needle)}&limit=60`),
    enabled: isAdmin && tab === 'profiles',
  });
  const past = useQuery({
    queryKey: ['admin', 'past', clubId, isAdmin, needle],
    queryFn: () =>
      api<Past[]>(
        clubId
          ? `/clubs/${clubId}/players/past-participants?q=${encodeURIComponent(needle)}`
          : `/admin/player-profiles/past-participants?q=${encodeURIComponent(needle)}`,
      ),
    enabled: tab === 'past' && (!!clubId || isAdmin),
  });

  const list: Candidate[] = useMemo(() => {
    const match = (name: string, email?: string | null) =>
      !needle || `${name} ${email ?? ''}`.toLowerCase().includes(needle.toLowerCase());
    if (tab === 'club')
      return (club.data ?? [])
        .filter((p) => match(p.name, p.email))
        .map((p) => ({
          key: `club:${p.profile_id}`,
          name: p.name,
          email: p.email ?? undefined,
          profile_id: p.has_hub_profile ? p.profile_id : undefined,
          note: p.email ?? undefined,
        }));
    if (tab === 'profiles')
      return (profiles.data ?? [])
        .filter((p) => !p.is_ghost)
        .map((p) => ({
          key: `profile:${p.id}`,
          name: p.name,
          email: p.email || undefined,
          profile_id: p.id,
          note: p.email || undefined,
        }));
    return (past.data ?? []).map((p) => ({
      key: `past:${p.player_id}`,
      name: p.name,
      note: p.last_tournament_name || undefined,
    }));
  }, [tab, club.data, profiles.data, past.data, needle]);

  const loading =
    (tab === 'club' && club.isPending && !!clubId) ||
    (tab === 'profiles' && profiles.isPending) ||
    (tab === 'past' && past.isPending);
  const chosen = Object.values(picked);
  return (
    <ResponsiveSheet opened onClose={onClose} title={tx('Add known players')} size="lg">
      <Stack>
        <Tabs value={tab} onChange={(v) => setTab(v ?? 'club')}>
          <Tabs.List>
            <Tabs.Tab value="club" disabled={!clubId}>
              {tx('Club roster')}
            </Tabs.Tab>
            {isAdmin && <Tabs.Tab value="profiles">{tx('Player profiles')}</Tabs.Tab>}
            <Tabs.Tab value="past" disabled={!clubId && !isAdmin}>
              {tx('Past participants')}
            </Tabs.Tab>
          </Tabs.List>
        </Tabs>
        {!clubId && (
          <Text size="xs" c="dimmed">
            {tx('Choose a club to use its roster.')}
          </Text>
        )}
        <TextInput
          label={tx('Search')}
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          data-autofocus
        />
        <ScrollArea.Autosize mah={320}>
          <Stack gap={6} aria-busy={loading}>
            {list.map((c) => {
              const used = taken.has(c.name.toLowerCase());
              return (
                <Checkbox
                  key={c.key}
                  disabled={used}
                  checked={used || !!picked[c.key]}
                  onChange={(e) => {
                    const on = e.currentTarget.checked;
                    setPicked((cur) => {
                      const next = { ...cur };
                      if (on) next[c.key] = c;
                      else delete next[c.key];
                      return next;
                    });
                  }}
                  label={
                    <Group gap={6}>
                      <Text size="sm">{c.name}</Text>
                      {c.note && (
                        <Text size="xs" c="dimmed">
                          {c.note}
                        </Text>
                      )}
                      {used && (
                        <StatusBadge size="xs" variant="outline">
                          {tx('Already added')}
                        </StatusBadge>
                      )}
                    </Group>
                  }
                />
              );
            })}
            {!loading && !list.length && (
              <Text size="sm" c="dimmed">
                {tx('No players found')}
              </Text>
            )}
          </Stack>
        </ScrollArea.Autosize>
        <FormActions
          onCancel={onClose}
          start={
            <Text size="sm" c="dimmed">
              {tx('{n} selected', { n: chosen.length })}
            </Text>
          }
        >
          <Button
            disabled={!chosen.length}
            onClick={() => {
              onAdd(chosen.map(({ name, email, profile_id }) => ({ name, email, profile_id })));
              onClose();
            }}
          >
            {tx('Add selected')}
          </Button>
        </FormActions>
      </Stack>
    </ResponsiveSheet>
  );
}
