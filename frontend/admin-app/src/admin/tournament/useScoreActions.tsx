import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { t as tx } from '../../i18n';
import { write } from '../../api';
import type { Match, ResolveDisputeBody, SetMatchFormatBody } from '../../types';
import {
  mapMatches,
  optimisticMatch,
  recordRequest,
  scorePayloadOf,
  type Ctx,
  type ScorePayload,
  type TournamentPageData,
} from './scoring';

const UNDO_MS = 8000;

function useRefresh(tid: string) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: ['admin', 'tournament', tid] });
    void client.invalidateQueries({ queryKey: ['admin', 'tournaments'] });
  };
}

const fail = (error: Error) =>
  notifications.show({ message: tx(error.message), color: 'red', autoClose: 6000 });

// Records or corrects a score. The list updates at once and rolls back if the server refuses;
// a toast offers Undo instead of a confirm dialog (clear for a first score, re-record for a correction).
export function useRecordScore(tid: string, ctx: Ctx) {
  const client = useQueryClient();
  const refresh = useRefresh(tid);
  const key = ['admin', 'tournament', tid];
  const send = (matchId: string, payload: ScorePayload) => {
    const { path, body } = recordRequest(tid, ctx, matchId, payload);
    return write(path, body);
  };
  return useMutation({
    mutationFn: ({ match, payload }: { match: Match; payload: ScorePayload }) =>
      send(match.id, payload),
    onMutate: async ({ match, payload }) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<TournamentPageData>(key);
      client.setQueryData<TournamentPageData>(key, (old) =>
        old
          ? {
              ...old,
              data: mapMatches(old.data, (m) =>
                m.id === match.id ? optimisticMatch(m, payload) : m,
              ),
            }
          : old,
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      if (context?.previous) client.setQueryData(key, context.previous);
      fail(error);
    },
    onSuccess: (_data, { match, payload }) => {
      const before = scorePayloadOf(match.score, match.sets);
      const hadScore = match.status === 'completed' && !!before;
      // Unique per save: Mantine ignores show() for an id that is still on screen.
      const id = `undo-${match.id}-${Date.now()}`;
      const undo = async () => {
        notifications.hide(id);
        try {
          if (hadScore && before) await send(match.id, before);
          else await write(`/tournaments/${tid}/matches/${match.id}/clear`);
          notifications.show({ message: tx('Score restored'), color: 'gray' });
        } catch (e) {
          fail(e as Error);
        } finally {
          refresh();
        }
      };
      notifications.show({
        id,
        color: 'green',
        autoClose: UNDO_MS,
        message: (
          <Group justify="space-between" wrap="nowrap" gap="md">
            <Text size="sm">
              {payload.kind === 'points'
                ? tx('Saved {score}', { score: payload.score.join('-') })
                : tx('Score saved')}
            </Text>
            <Button size="compact-md" variant="white" onClick={() => void undo()}>
              {tx('Undo')}
            </Button>
          </Group>
        ),
      });
    },
    onSettled: refresh,
  });
}

// Review-queue actions: dispute resolution, parked-score approval, unconfirmed-score rejection.
export function useReviewActions(tid: string) {
  const refresh = useRefresh(tid);
  const base = `/tournaments/${tid}/matches`;
  const run = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => write(path, body),
    onSuccess: () => notifications.show({ message: tx('Done'), color: 'green' }),
    onError: fail,
    onSettled: refresh,
  });
  return {
    pending: run.isPending,
    resolve: async (m: Match, body: ResolveDisputeBody): Promise<void> => {
      await run.mutateAsync({ path: `${base}/${m.id}/resolve-dispute`, body });
    },
    approve: (m: Match) => run.mutate({ path: `${base}/${m.id}/approve-review` }),
    reject: (m: Match) => run.mutate({ path: `${base}/${m.id}/reject-review` }),
    clear: (m: Match) => run.mutate({ path: `${base}/${m.id}/clear` }),
    record: (m: Match, ctx: Ctx, payload: ScorePayload) => {
      const { path, body } = recordRequest(tid, ctx, m.id, payload);
      run.mutate({ path, body });
    },
  };
}

export function useSetFormat(tid: string) {
  const refresh = useRefresh(tid);
  return useMutation({
    mutationFn: ({ match, body }: { match: Match; body: SetMatchFormatBody }) =>
      write(`/tournaments/${tid}/matches/${match.id}/format`, body, 'PATCH'),
    onSuccess: () => notifications.show({ message: tx('Match format updated'), color: 'green' }),
    onSettled: refresh,
  });
}
