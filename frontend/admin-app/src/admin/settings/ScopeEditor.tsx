import { useState } from 'react';
import { Button, Group, Select, Stack } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { api, write } from '../../api';
import { useOverview } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { Season } from '../../types';
import { MutationError } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

export interface Scope {
  community_id: string;
  club_id: string | null;
  season_id?: string | null;
}

// Move a tournament or lobby to another community, club or season. Community changes clear the
// club and season on the server, so the three PATCH calls run in that order and only for changed fields.
export function ScopeEditor({
  base,
  scope,
  withSeason = true,
  canMoveCommunity = true,
  invalidate,
}: {
  /** `/tournaments/{id}` or `/registrations/{id}`. */
  base: string;
  scope: Scope;
  withSeason?: boolean;
  /** The community route is owner/admin-only; co-editors may still change club and season. */
  canMoveCommunity?: boolean;
  invalidate: string[][];
}) {
  useLocale();
  const { communities, clubs } = useOverview();
  const [community, setCommunity] = useState(scope.community_id);
  const [club, setClub] = useState<string | null>(scope.club_id);
  const [season, setSeason] = useState<string | null>(scope.season_id ?? null);
  const seasons = useQuery({
    queryKey: ['admin', 'seasons', club],
    queryFn: () => api<Season[]>(`/clubs/${club}/seasons`),
    enabled: !!club && withSeason,
  });
  const save = useAdminMutation({
    request: async () => {
      if (community !== scope.community_id)
        await write(`${base}/community`, { community_id: community }, 'PATCH');
      const clubNow = community !== scope.community_id ? null : scope.club_id;
      if (club !== clubNow) await write(`${base}/club`, { club_id: club }, 'PATCH');
      if (
        withSeason &&
        (season ?? null) !== (club === scope.club_id ? (scope.season_id ?? null) : null)
      )
        await write(`${base}/season`, { season_id: club ? season : null }, 'PATCH');
    },
    invalidate: [...invalidate, ['admin', 'tournaments'], ['admin', 'lobbies']],
    success: 'Saved',
  });
  const changed =
    community !== scope.community_id ||
    club !== scope.club_id ||
    (withSeason && (season ?? null) !== (scope.season_id ?? null));
  return (
    <Stack gap="sm">
      <Select
        label={tx('Community')}
        allowDeselect={false}
        disabled={!canMoveCommunity}
        data={(communities.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
        value={community}
        onChange={(v) => {
          setCommunity(v ?? community);
          setClub(null);
          setSeason(null);
        }}
      />
      <Select
        label={tx('Club')}
        placeholder={tx('No club')}
        clearable
        data={(clubs.data ?? [])
          .filter((c) => c.community_id === community)
          .map((c) => ({ value: c.id, label: c.name }))}
        value={club}
        onChange={(v) => {
          setClub(v);
          setSeason(null);
        }}
      />
      {withSeason && club && (
        <Select
          label={tx('Season')}
          placeholder={tx('No season')}
          clearable
          data={(seasons.data ?? [])
            .filter((s) => s.active)
            .map((s) => ({ value: s.id, label: s.name }))}
          value={season}
          onChange={setSeason}
        />
      )}
      <MutationError error={save.error} />
      <Group justify="flex-end">
        <Button disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>
          {tx('Save')}
        </Button>
      </Group>
    </Stack>
  );
}
