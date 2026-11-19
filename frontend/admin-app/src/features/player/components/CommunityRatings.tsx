import { useQuery } from '@tanstack/react-query';
import { Skeleton } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import { playerApi } from '../../../player/api';
import type { Space } from '../../../player/types';
import { isMe, useLeaderboard } from './Leaderboard';
import { PlayerCard } from './PlayerCard';
import { sportsOf, type Sport } from '../stats';

// With "All my communities" picked, the Hub shows one rating card per community: each community keeps
// its own rating chain, so one number with changes summed over several chains would mean nothing.
// The query is the one the picker makes for that community, so picking it later is already loaded.
function CommunityCards({
  community,
  sports,
}: {
  community: { id: string; name: string };
  sports: Sport[];
}) {
  const scope = `community:${community.id}`;
  const scopeQuery = `?community_id=${encodeURIComponent(community.id)}`;
  const space = useQuery({
    queryKey: ['player', 'space', scope],
    queryFn: () =>
      playerApi<Space>(
        `/player-profile/space?${new URLSearchParams({ elo_history_limit: '50', community_id: community.id })}`,
      ),
    refetchInterval: 30_000,
  });
  const board = useLeaderboard(scopeQuery);
  if (space.isPending) return <Skeleton h={220} radius="lg" />;
  if (!space.data) return null;
  // Only the sports with a rated match in this community (the profile's counts can fall back to
  // the stored totals of another scope).
  const rated = sportsOf(space.data).filter((s) => space.data.elo_change?.[s] !== undefined);
  return (
    <>
      {sports
        .filter((s) => rated.includes(s))
        .map((s) => (
          <PlayerCard
            key={s}
            space={space.data}
            sport={s}
            rank={board.data?.[s].find((r) => isMe(r, space.data.profile))?.rank ?? null}
            scopeName={community.name}
            showScope
          />
        ))}
    </>
  );
}

export function CommunityRatings({
  communities,
  sports,
}: {
  communities: { id: string; name: string }[];
  sports: Sport[];
}) {
  useLocale();
  // Events with no community of their own count in the built-in open one: it gets a card too, which
  // stays empty when the player has no rated match there.
  const all = [...communities, { id: 'open', name: tx('Open community') }];
  return (
    <>
      {all.map((c) => (
        <CommunityCards key={c.id} community={c} sports={sports} />
      ))}
    </>
  );
}
