import { t as tx, useLocale } from './i18n';
import { Button, Center, Loader } from '@mantine/core';
import { StatusBadge } from './ui';
import { IconAlertCircle } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, formatPhase } from './api';
import type { Club, Community, Lobby, Tournament } from './types';
import { Notice } from './ui/Notice';
export const useTournamentList = (enabled = true) =>
  useQuery({
    queryKey: ['admin', 'tournaments'],
    queryFn: () => api<Tournament[]>('/tournaments'),
    enabled,
  });
export const useLobbyList = (enabled = true) =>
  useQuery({
    queryKey: ['admin', 'lobbies'],
    queryFn: () => api<Lobby[]>('/registrations?include_archived=true'),
    enabled,
    refetchInterval: 30_000,
  });
export function useOverview() {
  const tournaments = useTournamentList();
  const lobbies = useLobbyList();
  const clubs = useQuery({
    queryKey: ['admin', 'clubs'],
    queryFn: () => api<Club[]>('/clubs'),
  });
  const communities = useQuery({
    queryKey: ['admin', 'communities'],
    queryFn: () => api<Community[]>('/communities'),
  });
  return {
    tournaments,
    lobbies,
    clubs,
    communities,
  };
}
export function Loading({ testId }: { testId?: string } = {}) {
  useLocale();
  return (
    <Center mih={240} data-testid={testId}>
      <Loader aria-label={tx('Loading')} />
    </Center>
  );
}
export function ErrorState({ error, retry }: { error: Error | null; retry?: () => void }) {
  useLocale();
  return (
    <Notice tone="danger" icon={<IconAlertCircle size={18} />} title={tx('Something went wrong')}>
      {tx(error?.message || 'Unable to load data.')}
      {retry && (
        <Button variant="subtle" color="red" onClick={retry} mt="sm">
          {tx('Try again')}
        </Button>
      )}
    </Notice>
  );
}
export function PhaseBadge({ phase }: { phase: string }) {
  useLocale();
  return (
    <StatusBadge
      tone={phase === 'finished' ? 'neutral' : phase === 'playoffs' ? 'warning' : 'info'}
    >
      {formatPhase(phase)}
    </StatusBadge>
  );
}
