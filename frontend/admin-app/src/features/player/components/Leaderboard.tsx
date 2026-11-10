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
export function previewRows(rows: BoardRow[], name: string, full: boolean): BoardRow[] {
  if (full || rows.length <= 4) return rows;
  const me = rows.find((r) => r.name === name);
  const top = rows.slice(0, 3);
  return me && !top.includes(me) ? [...top, me] : top;
}

export function Leaderboard({
  scopeQuery,
  sport,
  name,
  full = false,
}: {
  scopeQuery: string;
  sport: Sport;
  name: string;
  full?: boolean;
}) {
  useLocale();
  const board = useLeaderboard(scopeQuery);
  if (board.isPending) return <StandingsTable.Skeleton />;
  if (board.error) return <ErrorState error={board.error} retry={() => void board.refetch()} />;
  const rows = board.data[sport];
  if (!rows.length) return <Text c="dimmed">{tx('No rated players in this scope yet.')}</Text>;
  const shown = previewRows(rows, name, full);
  const me = rows.find((r) => r.name === name);
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
