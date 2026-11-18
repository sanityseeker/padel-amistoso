import type { ReactNode } from 'react';
import { SelfIdsProvider } from '../../ui';
import type { EventData } from './eventData';

/** Marks the viewer's own ids in one event: their player id and every team id they belong to (in team
    mode a match side holds the team id, not the member id), so their own name is not a link. */
export function EventSelfIds({
  data,
  playerId,
  children,
}: {
  data: EventData | undefined;
  playerId: string;
  children: ReactNode;
}) {
  const teams = new Set<string>();
  for (const m of data?.matches ?? [])
    for (const id of [...(m.team1_ids ?? []), ...(m.team2_ids ?? [])])
      if (id !== playerId && data!.expand([id]).includes(playerId)) teams.add(id);
  return <SelfIdsProvider ids={[playerId, ...teams]}>{children}</SelfIdsProvider>;
}
