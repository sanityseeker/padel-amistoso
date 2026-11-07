import { t as tx, useLocale } from './i18n';
import {
  Alert,
  Badge,
  Button,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconArrowUpRight, IconBallTennis } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api, formatPhase } from './api';
import type { Club, Community, Lobby, Tournament } from './types';
export function useOverview() {
  const tournaments = useQuery({
    queryKey: ['tournaments'],
    queryFn: () => api<Tournament[]>('/tournaments'),
  });
  const lobbies = useQuery({
    queryKey: ['lobbies'],
    queryFn: () => api<Lobby[]>('/registrations?include_archived=true'),
  });
  const clubs = useQuery({
    queryKey: ['clubs'],
    queryFn: () => api<Club[]>('/clubs'),
  });
  const communities = useQuery({
    queryKey: ['communities'],
    queryFn: () => api<Community[]>('/communities'),
  });
  return {
    tournaments,
    lobbies,
    clubs,
    communities,
  };
}
export function useLiveUpdates(tid?: string) {
  const client = useQueryClient();
  useEffect(() => {
    const refresh = () => {
      void client.invalidateQueries({
        queryKey: ['tournaments'],
      });
      if (tid)
        void client.invalidateQueries({
          queryKey: ['tournament', tid],
        });
    };
    const events = new EventSource(tid ? `/api/tournaments/${tid}/events` : '/api/events');
    events.onmessage = refresh;
    // Poll as a fallback for proxies that buffer or interrupt event streams.
    const timer = window.setInterval(refresh, 30_000);
    return () => {
      events.close();
      window.clearInterval(timer);
    };
  }, [client, tid]);
}
export function PageHeading({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  useLocale();
  return (
    <Group justify="space-between" align="flex-end" mb="xl">
      <div>
        <Title order={1}>{title}</Title>
        <Text c="dimmed" mt={8}>
          {description}
        </Text>
      </div>
      {children}
    </Group>
  );
}
export function Loading() {
  useLocale();
  return (
    <Center mih={240}>
      <Loader aria-label={tx('Loading')} />
    </Center>
  );
}
export function ErrorState({ error, retry }: { error: Error | null; retry?: () => void }) {
  useLocale();
  return (
    <Alert color="red" icon={<IconAlertCircle size={18} />} title={tx('Something went wrong')}>
      {tx(error?.message || 'Unable to load data.')}
      {retry && (
        <Button variant="subtle" color="red" onClick={retry} mt="sm">
          {tx('Try again')}
        </Button>
      )}
    </Alert>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  useLocale();
  return (
    <Paper p={40}>
      <Stack align="center">
        <IconBallTennis size={38} stroke={1.3} />
        <Title order={3}>{title}</Title>
        <Text c="dimmed" ta="center">
          {children || tx('Create your first event to get things moving.')}
        </Text>
      </Stack>
    </Paper>
  );
}
export function PhaseBadge({ phase }: { phase: string }) {
  useLocale();
  return (
    <Badge
      variant="light"
      color={phase === 'finished' ? 'gray' : phase === 'playoffs' ? 'orange' : 'court'}
      radius="sm"
    >
      {formatPhase(phase)}
    </Badge>
  );
}
export function LegacyLink() {
  useLocale();
  return (
    <Button
      component="a"
      href="/legacy-admin"
      variant="subtle"
      size="xs"
      rightSection={<IconArrowUpRight size={14} />}
    >
      {tx('Advanced admin')}
    </Button>
  );
}
