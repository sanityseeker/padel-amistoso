import { useState } from 'react';
import { Button, Group, Select, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { useTournamentList } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import { ConfirmAction, MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

interface Participant {
  player_id: string;
  player_name: string;
  profile_id: string | null;
  profile_name: string | null;
  is_ghost: boolean;
}

// Link a profile to a player of one tournament: GET /admin/player-profiles/participants/{tid} lists them
// (linked ones too, so a link can be moved), POST /admin/player-profiles/{id}/link/{tid}/{pid} links.
// A profile is one participant per tournament, so an existing link there is replaced after a confirmation.
export function LinkParticipation({
  profileId,
  invalidate,
}: {
  profileId: string;
  invalidate: string[][];
}) {
  useLocale();
  const tournaments = useTournamentList();
  const [open, setOpen] = useState(false);
  const [tid, setTid] = useState<string | null>(null);
  const [pid, setPid] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const participants = useQuery({
    queryKey: ['admin', 'link-participants', tid],
    enabled: !!tid,
    queryFn: () => api<Participant[]>(`/admin/player-profiles/participants/${tid}`),
  });
  const rows = participants.data ?? [];
  const own = rows.find((r) => r.profile_id === profileId) ?? null;
  const others = rows.filter((r) => r.profile_id !== profileId);
  const chosen = others.find((r) => r.player_id === pid) ?? null;
  const link = useAdminMutation({
    request: () => write(`/admin/player-profiles/${profileId}/link/${tid}/${pid}`),
    invalidate,
    success: 'Participation linked',
    onSuccess: () => {
      setAsking(false);
      setOpen(false);
      setTid(null);
      setPid(null);
    },
  });
  const needsConfirm = !!(own || (chosen?.profile_id && !chosen.is_ghost));
  const submit = () => (needsConfirm ? setAsking(true) : link.mutate());
  if (!open)
    return (
      <Button variant="default" w="fit-content" onClick={() => setOpen(true)}>
        {tx('Link a participation')}
      </Button>
    );
  return (
    <Stack gap="xs" data-testid="link-participation">
      <Text fw={600}>{tx('Link tournament participation')}</Text>
      <Select
        searchable
        label={tx('Tournament')}
        placeholder={tx('Choose a tournament')}
        data={(tournaments.data ?? []).map((t) => ({
          value: t.id,
          label: `${t.name} (${t.phase || t.type})`,
        }))}
        nothingFoundMessage={tx('No tournaments available')}
        value={tid}
        onChange={(v) => {
          setTid(v);
          setPid(null);
        }}
      />
      {tid && (
        <Select
          searchable
          label={tx('Player')}
          placeholder={tx('Select a player')}
          disabled={participants.isPending}
          nothingFoundMessage={tx(
            'Every player in this tournament is already linked to this profile.',
          )}
          data={others.map((r) => ({
            value: r.player_id,
            label: r.profile_id
              ? `${r.player_name} — ${tx(r.is_ghost ? 'linked to past participant {value}' : 'linked to {value}', { value: r.profile_name || r.profile_id })}`
              : r.player_name,
          }))}
          value={pid}
          onChange={setPid}
        />
      )}
      <MutationError error={participants.error ?? link.error} />
      <Group justify="flex-end">
        <Button variant="default" onClick={() => setOpen(false)}>
          {tx('Cancel')}
        </Button>
        <Button disabled={!tid || !pid} loading={link.isPending} onClick={submit}>
          {tx('Link')}
        </Button>
      </Group>
      <ConfirmAction
        opened={asking}
        title={tx('Move the link?')}
        description={[
          chosen?.profile_id && !chosen.is_ghost
            ? tx(
                'This player is linked to {value}. Move the link to this profile? It will be removed from {value}.',
                {
                  value: chosen.profile_name || chosen.profile_id,
                },
              )
            : '',
          own
            ? tx(
                'This profile is already linked to {value} in this tournament. That link will be removed. Continue?',
                {
                  value: own.player_name,
                },
              )
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
        confirmLabel={tx('Link')}
        loading={link.isPending}
        error={link.error}
        onConfirm={() => link.mutate()}
        onClose={() => setAsking(false)}
      />
    </Stack>
  );
}
