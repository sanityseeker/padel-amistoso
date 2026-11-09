import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { ErrorState, Loading } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { ParticipationClaim } from '../../types';
import { CopyField, EmptyState, MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

// Players who say "that earlier result is mine": approve to link it to their profile, reject to dismiss.
export function ClaimsPanel({ lobbyId }: { lobbyId: string }) {
  useLocale();
  const key = ['admin', 'lobby', lobbyId, 'claims'];
  const claims = useQuery({
    queryKey: key,
    queryFn: () => api<ParticipationClaim[]>(`/registrations/${lobbyId}/claims`),
  });
  const resolve = useAdminMutation({
    request: ({ id, approve }: { id: string; approve: boolean }) =>
      write(`/registrations/${lobbyId}/claims/${id}/resolve?approve=${approve}`),
    invalidate: [key],
    success: (_r, v) => (v.approve ? 'Claim approved' : 'Claim rejected'),
  });
  if (claims.isPending) return <Loading />;
  if (claims.error) return <ErrorState error={claims.error} retry={() => void claims.refetch()} />;
  if (!claims.data.length)
    return (
      <EmptyState title={tx('No pending claims')}>
        {tx('When a returning player claims a past result, you approve it here.')}
      </EmptyState>
    );
  return (
    <Stack gap="xs">
      <MutationError error={resolve.error} />
      {claims.data.map((c) => (
        <Paper key={c.id} variant="row" p="sm" data-testid="claim-row">
          <Group justify="space-between" wrap="nowrap" align="flex-start">
            <Stack gap={2} miw={0}>
              <Text fw={650}>
                {c.claimant_name || tx('A player')}{' '}
                <Text span c="dimmed" size="sm">
                  {c.claimant_email}
                </Text>
              </Text>
              <Text size="sm">
                {tx('claims to be {name} in {event}', {
                  name: c.player_name,
                  event: c.entity_name,
                })}
              </Text>
            </Stack>
            <Group gap={6} wrap="nowrap">
              <Button
                size="compact-md"
                variant="light"
                leftSection={<IconCheck size={14} />}
                loading={resolve.isPending && resolve.variables?.id === c.id}
                onClick={() => resolve.mutate({ id: c.id, approve: true })}
              >
                {tx('Approve')}
              </Button>
              <Button
                size="compact-md"
                variant="default"
                leftSection={<IconX size={14} />}
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: c.id, approve: false })}
              >
                {tx('Reject')}
              </Button>
            </Group>
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

interface Secret {
  player_id: string;
  player_name: string;
  passphrase: string;
  token: string;
}

// Passphrases and login links for every registrant, to share or print.
export function CodesPanel({ lobbyId }: { lobbyId: string }) {
  useLocale();
  const secrets = useQuery({
    queryKey: ['admin', 'lobby', lobbyId, 'secrets'],
    queryFn: () => api<Secret[]>(`/registrations/${lobbyId}/secrets`),
  });
  if (secrets.isPending) return <Loading />;
  if (secrets.error)
    return <ErrorState error={secrets.error} retry={() => void secrets.refetch()} />;
  if (!secrets.data.length) return <EmptyState title={tx('No player codes yet.')} />;
  return (
    <Stack gap="xs">
      <Group>
        <Button
          variant="light"
          onClick={() =>
            void navigator.clipboard.writeText(
              secrets.data.map((s) => `${s.player_name}: ${s.passphrase}`).join('\n'),
            )
          }
        >
          {tx('Copy all codes')}
        </Button>
      </Group>
      {secrets.data.map((s) => (
        <Paper key={s.player_id} variant="row" p="sm" data-testid="lobby-code-row">
          <Stack gap={4}>
            <Text fw={650}>{s.player_name}</Text>
            <CopyField value={s.passphrase} label={s.player_name} />
          </Stack>
        </Paper>
      ))}
    </Stack>
  );
}
