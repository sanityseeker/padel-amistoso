import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select } from '@mantine/core';
import { api } from '../../api';
import { useOverview } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { Season } from '../../types';
import { useSubdomainClub } from '../../shell/subdomainClub';
import { useDemoAccount } from '../../useDemoAccount';

export function ScopeFields({
  community,
  setCommunity,
  club,
  setClub,
  season,
  setSeason,
}: {
  community: string;
  setCommunity: (value: string) => void;
  club: string | null;
  setClub: (value: string | null) => void;
  season?: string | null;
  setSeason?: (value: string | null) => void;
}) {
  useLocale();
  const demo = useDemoAccount();
  const host = useSubdomainClub();
  const { communities, clubs } = useOverview();
  // On a club subdomain the form is locked to that club and its community (client-side only).
  const lockedClub = host?.club.club_id;
  const lockedCommunity = host?.club.community_id;
  useEffect(() => {
    if (!lockedClub || !lockedCommunity) return;
    if (community !== lockedCommunity) setCommunity(lockedCommunity);
    if (club !== lockedClub) setClub(lockedClub);
  }, [lockedClub, lockedCommunity, community, club, setCommunity, setClub]);
  const lockHint = host ? tx('Locked to {club}', { club: host.club.name }) : undefined;
  const seasons = useQuery({
    queryKey: ['admin', 'seasons', club],
    queryFn: () => api<Season[]>(`/clubs/${club}/seasons`),
    enabled: !!club,
  });
  return (
    <>
      <Select
        label={tx('Community')}
        disabled={demo || !!host}
        description={demo ? tx('Not available in demo mode') : lockHint}
        required
        data={(communities.data || []).map((c) => ({
          value: c.id,
          label: c.name,
        }))}
        value={community}
        onChange={(v) => {
          setCommunity(v || 'open');
          setClub(null);
          setSeason?.(null);
        }}
      />
      <Select
        label={tx('Club')}
        disabled={demo || !!host}
        description={demo ? tx('Not available in demo mode') : lockHint}
        placeholder={tx('No club')}
        clearable={!host}
        data={(clubs.data || [])
          .filter((c) => c.community_id === community)
          .map((c) => ({
            value: c.id,
            label: c.name,
          }))}
        value={club}
        onChange={(v) => {
          setClub(v);
          setSeason?.(null);
        }}
      />
      {setSeason && club && (
        <Select
          label={tx('Season')}
          placeholder={tx('No season')}
          clearable
          data={(seasons.data || [])
            .filter((s) => s.active)
            .map((s) => ({
              value: s.id,
              label: s.name,
            }))}
          value={season}
          onChange={setSeason}
        />
      )}
    </>
  );
}
