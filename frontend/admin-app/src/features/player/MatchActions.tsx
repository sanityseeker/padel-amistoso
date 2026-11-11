import { useEffect, useState } from 'react';
import { Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconCheck } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { playerApi } from '../../player/api';
import type { PlayerMatch } from '../../player/types';
import type { ScoringEntry } from './eventData';
import { formatScore, matchDecider } from '../../admin/tournament/scoring';
import type { Score } from '../../types';
import { lifecycleIn, refreshAfterError, type ScoringData } from './eventData';
import { ScoreSheet } from './ScoreSheet';
import { Notice } from '../../ui/Notice';

const shown = (
  m: PlayerMatch,
  data: ScoringData,
  score: Score | null | undefined,
  sets: Score[] | null | undefined,
) =>
  formatScore(
    score ?? null,
    sets ?? null,
    matchDecider(m, { ...data.tv, score_mode: {}, score_confirmation: 'immediate' }),
  );

// "Correction window: 42s remaining" under a score you submitted, then "closed" once it is over. The
// window is the organizer's setting; the line ticks down once a second until it ends.
export function CorrectionWindow({
  scoredAt,
  seconds,
}: {
  scoredAt: number | null | undefined;
  seconds: number;
}) {
  const left = () => Math.max(0, Math.floor(seconds - (Date.now() / 1000 - (scoredAt ?? 0))));
  const [remaining, setRemaining] = useState(left);
  useEffect(() => {
    setRemaining(left());
    const timer = window.setInterval(() => setRemaining(left()), 1000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoredAt, seconds]);
  if (!(seconds > 0) || !scoredAt) return null;
  return (
    <Text size="sm" c="dimmed" data-testid="correction-window">
      {remaining > 0
        ? tx('Correction window: {n}s remaining', { n: remaining })
        : tx('Correction window closed: the score is now final.')}
    </Text>
  );
}

// What a player can do with one of their matches, by lifecycle state (the legacy TV score panel):
// enter, confirm or correct a score; accept a proposed correction or escalate it to the organizer.
// Every call uses the tournament token from /player-auth.
export function MatchActions({
  match,
  entry,
  data,
  token,
}: {
  match: PlayerMatch;
  entry: ScoringEntry;
  data: ScoringData;
  token: string | null;
}) {
  useLocale();
  const client = useQueryClient();
  const [sheet, setSheet] = useState<'submit' | 'correct' | null>(null);
  const state = lifecycleIn(match, data, entry.player_id);
  const act = useMutation({
    mutationFn: ({
      action,
    }: {
      action: 'accept' | 'accept-correction' | 'escalate-dispute';
      done: string;
    }) =>
      playerApi(`/tournaments/${entry.entity_id}/matches/${match.id}/${action}`, {}, 'POST', token),
    onSuccess: (_r, vars) => {
      void client.invalidateQueries({ queryKey: ['player'] });
      notifications.show({ message: vars.done, color: 'green' });
    },
    // The other side may have acted first: show the card as it is now.
    onError: (error) => refreshAfterError(client, entry.entity_id, error),
  });
  if (!token || !data.tv.allow_player_scoring) return null;
  const error = act.error && <Notice tone="danger">{tx(act.error.message)}</Notice>;
  const original = shown(match, data, match.score, match.sets);
  const proposed = shown(match, data, match.dispute_score, match.dispute_sets);
  const reviewed =
    match.review_score || match.review_sets?.length
      ? formatScore(
          match.review_score ?? null,
          match.review_sets ?? null,
          match.review_decider ??
            matchDecider(match, { ...data.tv, score_mode: {}, score_confirmation: 'immediate' }),
        )
      : '';
  let body = null;
  switch (state) {
    case 'open':
      body = (
        <Button size="touch" variant="light" onClick={() => setSheet('submit')}>
          {tx('Enter score')}
        </Button>
      );
      break;
    case 'confirm':
      body = (
        <Group>
          <Button
            size="touch"
            variant="light"
            leftSection={<IconCheck size={15} />}
            loading={act.isPending}
            onClick={() => act.mutate({ action: 'accept', done: tx('Score confirmed') })}
          >
            {tx('Confirm score')}
          </Button>
          <Button size="touch" variant="default" onClick={() => setSheet('correct')}>
            {tx('Correct score')}
          </Button>
        </Group>
      );
      break;
    case 'waiting':
      body = (
        <Stack gap={2}>
          <Text size="sm" c="dimmed">
            {tx('Score submitted. Waiting for the other side to confirm.')}
          </Text>
          <CorrectionWindow
            scoredAt={match.scored_at}
            seconds={data.tv.correction_window_seconds ?? 0}
          />
        </Stack>
      );
      break;
    case 'correction':
      body = (
        <Stack gap="xs">
          <Text size="sm">
            {tx('The other side proposes {proposed} instead of {original}.', {
              proposed,
              original,
            })}
          </Text>
          <Group>
            <Button
              size="touch"
              variant="light"
              loading={act.isPending}
              onClick={() =>
                act.mutate({ action: 'accept-correction', done: tx('Correction accepted') })
              }
            >
              {tx('Accept correction')}
            </Button>
            <Button
              size="touch"
              variant="default"
              loading={act.isPending}
              onClick={() =>
                act.mutate({ action: 'escalate-dispute', done: tx('Sent to the organizer') })
              }
            >
              {tx('Escalate to the organizer')}
            </Button>
          </Group>
        </Stack>
      );
      break;
    case 'correction-sent':
      body = (
        <Text size="sm" c="dimmed">
          {tx('Correction sent: {proposed}. Waiting for the other side to respond.', { proposed })}
        </Text>
      );
      break;
    case 'escalated':
      body = (
        <Notice tone="warning">
          {tx('The organizer is settling this score: {original} against {proposed}.', {
            original,
            proposed,
          })}
        </Notice>
      );
      break;
    case 'review':
      body = (
        <Notice tone="warning" title={tx('Sent to the organizer for review')}>
          {reviewed && <Text fw={700}>{reviewed}</Text>}
          {tx(
            'Entered in a different format than set for this match. It counts once the organizer approves it.',
          )}
        </Notice>
      );
      break;
    default:
      body = null;
  }
  return (
    <Stack gap="xs" mt="xs">
      {body}
      {error}
      {sheet && (
        <ScoreSheet
          key={sheet}
          mode={sheet}
          match={match}
          entry={entry}
          data={data}
          token={token}
          onClose={() => setSheet(null)}
        />
      )}
    </Stack>
  );
}
