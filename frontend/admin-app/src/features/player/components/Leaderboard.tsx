import { useQuery } from '@tanstack/react-query';
import { Text } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import { ErrorState } from '../../../components';
import { playerApi } from '../../../player/api';
import type { Leaderboard as Board } from '../../../player/types';
import { StandingsTable } from '../../tournaments';
import type { Sport } from '../stats';

export const useLeaderboard = (scopeQuery: string) =>
  useQuery({
    queryKey: ['player', 'leaderboard', scopeQuery],
    queryFn: () => playerApi<Board>(`/player-profile/leaderboard${scopeQuery}`),
    // Switching community keeps the current table until the new one arrives: no skeleton, no jump.
    placeholderData: (previous) => previous,
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
  if (board.isPending) return <StandingsTable.Skeleton />;
  if (board.error) return <ErrorState error={board.error} retry={() => void board.refetch()} />;
  const rows = board.data[sport];
  if (!rows.length) return <Text c="dimmed">{tx('No rated players in this scope yet.')}</Text>;
  const shown = previewRows(rows, profile, full);
  const me = rows.find((r) => isMe(r, profile));
  return (
    <StandingsTable
      preset="leaderboard"
      highlightId={me ? `${me.rank}` : undefined}
      rows={shown.map((r, i) => ({
        id: `${r.rank}`,
        name: r.rank === i + 1 ? r.name : `${r.name} (#${r.rank})`,
        elo: Math.round(r.elo),
        played: r.matches,
        note: r.tier_name ?? undefined,
      }))}
    />
  );
}
