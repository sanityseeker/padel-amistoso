import { useEffect, useRef } from 'react';
import { write } from '../../api';
import { useAdminMutation } from '../../useAdminMutation';

// Marks a lobby's answer changes seen for this organizer once the changes tab is open. The marker is
// stored on the server, so it holds on every device and separately for each co-editor. It is sent once
// per newest change, so a failed request is not retried in a loop.
export function useMarkAnswerChangesSeen(
  lobbyId: string,
  newestId: number | undefined,
  unseen: number,
  active: boolean,
) {
  const { mutate } = useAdminMutation({
    request: (upTo: number) =>
      write(`/registrations/${lobbyId}/answer-changes/seen`, { up_to_id: upTo }),
    invalidate: [
      ['admin', 'lobbies'],
      ['admin', 'lobby', lobbyId, 'detail'],
    ],
  });
  const sent = useRef<number | null>(null);
  useEffect(() => {
    if (!active || !newestId || !unseen || sent.current === newestId) return;
    sent.current = newestId;
    mutate(newestId);
  }, [active, newestId, unseen, mutate]);
}
