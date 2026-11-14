import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Select, SimpleGrid } from '@mantine/core';
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
  locked = true,
  communityDisabled = false,
}: {
  community: string;
  setCommunity: (value: string) => void;
  club: string | null;
  setClub: (value: string | null) => void;
  season?: string | null;
  setSeason?: (value: string | null) => void;
  /** New events: demo accounts and club subdomains lock the scope. Moving an existing one does not. */
  locked?: boolean;
  /** The community route is owner/admin-only; co-editors may still change club and season. */
  communityDisabled?: boolean;
}) {
  useLocale();
  const demoAccount = useDemoAccount();
  const subdomain = useSubdomainClub();
  const demo = locked && demoAccount;
  const host = locked ? subdomain : null;
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
  const showSeason = !!setSeason && !!club;
  return (
    <SimpleGrid cols={{ base: 1, sm: showSeason ? 3 : 2 }}>
      <Select
        label={tx('Community')}
        disabled={demo || !!host || communityDisabled}
        allowDeselect={false}
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
      {showSeason && (
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
    </SimpleGrid>
  );
}
