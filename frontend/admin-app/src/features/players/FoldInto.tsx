import { useState } from 'react';
import { Button, Checkbox, Group, Stack, Text, TextInput } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import { ConfirmAction, FormActions, MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import { StatusBadge } from '../../ui/StatusBadge';

interface Candidate {
  id: string;
  name: string;
  is_ghost?: boolean;
}
interface PastParticipant {
  player_id: string;
  name: string;
  last_tournament_name: string;
}

// Fold past-participant profiles, and players who took part without any profile, into one profile:
// POST /admin/player-profiles/consolidate-ghosts with the target first in `source_ids` and the raw
// players in `source_player_ids`. A Player Hub profile keeps its own name; a past participant is
// merged under its current name.
export function FoldInto({
  id,
  name,
  keepName,
  invalidate,
}: {
  id: string;
  name: string;
  /** `true` for a past-participant target: the merged profile keeps `name`. */
  keepName: boolean;
  invalidate: string[][];
}) {
  useLocale();
  const [q, setQ] = useState('');
  const [debounced] = useDebouncedValue(q, 250);
  const [ghosts, setGhosts] = useState<Record<string, string>>({});
  const [past, setPast] = useState<Record<string, string>>({});
  const [asking, setAsking] = useState(false);
  const suggested = useQuery({
    queryKey: ['admin', 'profile-candidates', id],
    queryFn: () => api<Candidate[]>(`/admin/player-profiles/${id}/merge-candidates`),
  });
  const searched = useQuery({
    queryKey: ['admin', 'fold-search', debounced],
    enabled: debounced.trim().length >= 2,
    queryFn: async () => {
      const query = encodeURIComponent(debounced.trim());
      const [profiles, players] = await Promise.all([
        api<Candidate[]>(`/admin/player-profiles?q=${query}&limit=50`),
        api<PastParticipant[]>(`/admin/player-profiles/past-participants?q=${query}`),
      ]);
      return { profiles: profiles.filter((p) => p.is_ghost && p.id !== id), players };
    },
  });
  const merge = useAdminMutation({
    request: () =>
      write(`/admin/player-profiles/consolidate-ghosts`, {
        source_ids: [id, ...Object.keys(ghosts)],
        source_player_ids: Object.keys(past),
        name: keepName ? name : null,
      }),
    invalidate: [...invalidate, ['admin', 'fold-search'], ['admin', 'profile-candidates', id]],
    success: 'Profiles merged',
    onSuccess: () => {
      setGhosts({});
      setPast({});
      setAsking(false);
    },
  });
  const profiles = new Map<string, string>();
  for (const c of suggested.data ?? []) profiles.set(c.id, c.name);
  for (const c of searched.data?.profiles ?? []) profiles.set(c.id, c.name);
  const count = Object.keys(ghosts).length + Object.keys(past).length;
  const names = [...Object.values(ghosts), ...Object.values(past)].join(', ');
  const toggle = (set: typeof setGhosts, key: string, label: string, on: boolean) =>
    set((cur) => {
      const next = { ...cur };
      if (on) next[key] = label;
      else delete next[key];
      return next;
    });
  return (
    <Stack gap="xs" data-testid="fold-into">
      <Text fw={600}>{tx('Merge past participants into this profile')}</Text>
      <Text size="sm" c="dimmed">
        {tx(
          'Pick past-participant profiles, or players who took part without a profile. Their matches and ratings move here and the old entries are removed.',
        )}
      </Text>
      <TextInput
        aria-label={tx('Search past participants')}
        placeholder={tx('Search past participants')}
        value={q}
        onChange={(e) => setQ(e.currentTarget.value)}
      />
      {profiles.size > 0 && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            {q.trim().length >= 2 ? tx('Past-participant profiles') : tx('Suggested duplicates')}
          </Text>
          {[...profiles.entries()]
            .filter(([pid, label]) =>
              q.trim().length >= 2
                ? (searched.data?.profiles ?? []).some((p) => p.id === pid) ||
                  label.toLowerCase().includes(q.trim().toLowerCase())
                : true,
            )
            .map(([pid, label]) => (
              <Checkbox
                key={pid}
                label={label}
                checked={pid in ghosts}
                onChange={(e) => toggle(setGhosts, pid, label, e.currentTarget.checked)}
              />
            ))}
        </Stack>
      )}
      {!!searched.data?.players.length && (
        <Stack gap={4}>
          <Text size="xs" c="dimmed">
            {tx('Took part without a profile')}
          </Text>
          {searched.data.players.map((p) => (
            <Checkbox
              key={p.player_id}
              label={`${p.name}${p.last_tournament_name ? ` · ${p.last_tournament_name}` : ''}`}
              checked={p.player_id in past}
              onChange={(e) => toggle(setPast, p.player_id, p.name, e.currentTarget.checked)}
            />
          ))}
        </Stack>
      )}
      {count > 0 && (
        <Group gap={4}>
          {[...Object.values(ghosts), ...Object.values(past)].map((label, i) => (
            <StatusBadge key={i}>{label}</StatusBadge>
          ))}
        </Group>
      )}
      <MutationError error={merge.error} />
      <FormActions>
        <Button variant="light" disabled={!count} onClick={() => setAsking(true)}>
          {tx('Merge profiles')}
        </Button>
      </FormActions>
      <ConfirmAction
        opened={asking}
        title={tx('Merge profiles')}
        description={tx('Merge {names} into «{name}»? This cannot be undone.', { names, name })}
        confirmLabel={tx('Merge profiles')}
        color="red"
        loading={merge.isPending}
        error={merge.error}
        onConfirm={() => merge.mutate()}
        onClose={() => setAsking(false)}
      />
    </Stack>
  );
}
