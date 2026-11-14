import { useState } from 'react';
import { Button, Stack } from '@mantine/core';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import { ScopeFields } from '../../features/create/ScopeFields';
import { FormActions, MutationError } from '../../ui';
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
  const [community, setCommunity] = useState(scope.community_id);
  const [club, setClub] = useState<string | null>(scope.club_id);
  const [season, setSeason] = useState<string | null>(scope.season_id ?? null);
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
      <ScopeFields
        community={community}
        setCommunity={setCommunity}
        club={club}
        setClub={setClub}
        season={season}
        setSeason={withSeason ? setSeason : undefined}
        locked={false}
        communityDisabled={!canMoveCommunity}
      />
      <MutationError error={save.error} />
      <FormActions>
        <Button disabled={!changed} loading={save.isPending} onClick={() => save.mutate()}>
          {tx('Save')}
        </Button>
      </FormActions>
    </Stack>
  );
}
