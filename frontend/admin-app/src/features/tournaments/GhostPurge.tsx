import { useEffect, useState } from 'react';
import { Badge, Checkbox, Group, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api';
import { t as tx, useLocale } from '../../i18n';

interface GhostProfiles {
  count: number;
  profiles: { id: string; name: string }[];
}

// Deleting a tournament can also delete the ghost (past-participant) profiles that only existed for it:
// GET /tournaments/{tid}/ghost-profiles lists them, DELETE /tournaments/{tid}?purge_ghosts=true wipes them
// together with their match history and club / community ratings. Real Player Hub profiles are untouched.
export function useGhostPurge(tid: string | undefined) {
  const query = useQuery({
    queryKey: ['admin', 'ghost-profiles', tid],
    enabled: !!tid,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => api<GhostProfiles>(`/tournaments/${tid}/ghost-profiles`),
  });
  const [purge, setPurge] = useState(false);
  useEffect(() => setPurge(false), [tid]);
  return { ghosts: query.data?.profiles ?? [], purge, setPurge };
}

/** Query string for the DELETE call. */
export const purgeQuery = (purge: boolean) => (purge ? '?purge_ghosts=true' : '');

export function GhostPurgeField({
  ghosts,
  purge,
  onChange,
}: {
  ghosts: { id: string; name: string }[];
  purge: boolean;
  onChange: (purge: boolean) => void;
}) {
  useLocale();
  if (!ghosts.length) return null;
  const shown = ghosts.slice(0, 5);
  return (
    <Stack gap={6} mt="sm" data-testid="ghost-purge">
      <Checkbox
        checked={purge}
        onChange={(e) => onChange(e.currentTarget.checked)}
        label={tx('Also permanently delete {count} ghost profile(s) used here', {
          count: ghosts.length,
        })}
        description={tx(
          'Wipes their match history and any club/community ELO. Real profiles are not affected.',
        )}
      />
      <Group gap={4}>
        {shown.map((g) => (
          <Badge key={g.id} variant="light" color="gray" tt="none">
            {g.name || g.id}
          </Badge>
        ))}
        {ghosts.length > shown.length && (
          <Text size="xs" c="dimmed">
            +{ghosts.length - shown.length}
          </Text>
        )}
      </Group>
    </Stack>
  );
}
