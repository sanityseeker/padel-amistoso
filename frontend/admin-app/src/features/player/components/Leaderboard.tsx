import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Text } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import { ErrorState } from '../../../components';
import { playerApi } from '../../../player/api';
import type { Leaderboard as Board } from '../../../player/types';
import { StandingsTable } from '../../tournaments';
import type { Sport } from '../stats';
import { playerCardSource, ProfileCardModal, type ProfileCardTarget } from '../../playercard';

export const useLeaderboard = (scopeQuery: string) =>
  useQuery({
    queryKey: ['player', 'leaderboard', scopeQuery],
    queryFn: () => playerApi<Board>(`/player-profile/leaderboard${scopeQuery}`),
    // Switching community keeps the current table until the new one arrives: no skeleton, no jump.
    placeholderData: (previous) => previous,
    // A club board the viewer may not see stays closed: asking again changes nothing.
    retry: (count, error) => (error as { status?: number }).status !== 403 && count < 3,
  });

export type BoardRow = Board['padel'][number];

/** Top three plus the player (when further down), or the whole board. */
export const isMe = (r: BoardRow, me: { id: string; name: string }) =>
  r.profile_id ? r.profile_id === me.id : r.name === me.name;

/** Top three plus the player (when further down), or the whole board. The player is matched by profile
    id, falling back to the name for rows without one (unlinked participants). */
export function previewRows(
  rows: BoardRow[],
  me: { id: string; name: string },
  full: boolean,
): BoardRow[] {
  if (full || rows.length <= 4) return rows;
  const mine = rows.find((r) => isMe(r, me));
  const top = rows.slice(0, 3);
  return mine && !top.includes(mine) ? [...top, mine] : top;
}

/** The Hub picker's scope (`?club_id=...` / `?community_id=...` or none) plus one sport, as a query. */
export const scopedSportQuery = (scopeQuery: string, sport: Sport) =>
  `${scopeQuery ? `${scopeQuery}&` : '?'}sport=${sport}`;

export function Leaderboard({
  scopeQuery,
  sport,
  me: profile,
  full = false,
}: {
  scopeQuery: string;
  sport: Sport;
  me: { id: string; name: string };
  full?: boolean;
}) {
  useLocale();
  const board = useLeaderboard(scopeQuery);
  // A tap on a row opens that player's card in the board's own scope and sport.
  const [card, setCard] = useState<ProfileCardTarget | null>(null);
  if (board.isPending) return <StandingsTable.Skeleton />;
  // A club board is for the club's members and organizers: not an error, just not theirs to see.
  if ((board.error as { status?: number } | null)?.status === 403)
    return (
      <Text c="dimmed" data-testid="board-members-only">
        {tx("Only club members and the club's organizers can see this board.")}
      </Text>
    );
  if (board.error) return <ErrorState error={board.error} retry={() => void board.refetch()} />;
  const rows = board.data[sport];
  if (!rows.length) return <Text c="dimmed">{tx('No rated players in this scope yet.')}</Text>;
  const shown = previewRows(rows, profile, full);
  const me = rows.find((r) => isMe(r, profile));
  return (
    <>
      <StandingsTable
        preset="leaderboard"
        highlightId={me ? `${me.rank}` : undefined}
        rows={shown.map((r, i) => ({
          id: `${r.rank}`,
          name: r.rank === i + 1 ? r.name : `${r.name} (#${r.rank})`,
          elo: Math.round(r.elo),
          played: r.matches,
          note: r.tier_name ?? undefined,
          // Rows of unlinked participants are grouped by name: there is no profile to open.
          noCard: !r.profile_id,
        }))}
        onSelect={(row) => {
          const found = shown.find((r) => `${r.rank}` === row.id);
          if (found?.profile_id)
            setCard({
              profileId: found.profile_id,
              query: scopedSportQuery(scopeQuery, sport),
            });
        }}
      />
      <ProfileCardModal target={card} source={playerCardSource} onClose={() => setCard(null)} />
    </>
  );
}
