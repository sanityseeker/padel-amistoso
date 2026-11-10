import { useState } from 'react';
import { Button, Group, SegmentedControl, Stack, Text } from '@mantine/core';
import { EmptyState } from '../../ui';
import { t as tx, useLocale } from '../../i18n';
import type { Match, Score, TvSettings } from '../../types';

import { MatchCard, MatchListFrame, toMatchView } from '../../features/tournaments';
import { formatScore, matchDecider, scorePayloadOf, type Ctx, type ReviewItem } from './scoring';
import { useReviewActions } from './useScoreActions';

function Line({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <Text span size="xs" c="dimmed">
        {label}
      </Text>{' '}
      <Text span variant="mono" fw={600} size="sm">
        {value}
      </Text>
    </span>
  );
}

// Player-submitted scores that need the organiser: disputes, scores waiting for confirmation and
// scores entered in another format than the match's. Everything comes from the page query, so
// the live-updates provider keeps it fresh.
export function ReviewQueue({
  tid,
  items,
  ctx,
  settings,
  onOverride,
  courts = true,
}: {
  tid: string;
  items: ReviewItem[];
  ctx: Ctx;
  settings: TvSettings;
  onOverride: (match: Match, purpose: 'record' | 'resolve') => void;
  courts?: boolean;
}) {
  useLocale();
  const actions = useReviewActions(tid);
  const [filter, setFilter] = useState<'all' | 'disputes' | 'pending'>('all');
  if (!items.length)
    return (
      <EmptyState title={tx('Nothing to review.')}>
        {tx('Player-submitted scores that need you appear here.')}
      </EmptyState>
    );
  const show = (score: Score | null | undefined, sets: Score[] | null | undefined, m: Match) =>
    formatScore(score ?? null, sets ?? null, matchDecider(m, settings));
  const disputes = items.filter((i) => i.kind === 'dispute').length;
  const pending = items.length - disputes;
  // The filter is only worth a control once both kinds are waiting.
  const filtered = disputes && pending ? filter : 'all';
  const shown = items.filter(
    (i) => filtered === 'all' || (filtered === 'disputes') === (i.kind === 'dispute'),
  );
  return (
    <Stack gap="sm">
      {disputes > 0 && pending > 0 && (
        <SegmentedControl
          size="xs"
          w="fit-content"
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          aria-label={tx('Filter the review queue')}
          data={[
            { value: 'all', label: `${tx('All')} (${items.length})` },
            { value: 'disputes', label: `${tx('Disputes')} (${disputes})` },
            { value: 'pending', label: `${tx('Pending')} (${pending})` },
          ]}
        />
      )}
      <MatchListFrame testId="review-queue">
        {shown.map(({ match: m, kind }) => (
          <MatchCard
            key={m.id}
            testId={null}
            kind={kind}
            courts={courts}
            match={toMatchView(m, settings, ctx)}
            footer={
              <Group gap="xs" pt="sm">
                {kind === 'dispute' && (
                  <>
                    <Button
                      variant="light"
                      size="touch"
                      loading={actions.pending}
                      onClick={() => void actions.resolve(m, { chosen: 'original' })}
                    >
                      {tx('Keep original')}
                    </Button>
                    <Button
                      variant="light"
                      size="touch"
                      loading={actions.pending}
                      onClick={() => void actions.resolve(m, { chosen: 'correction' })}
                    >
                      {tx('Use correction')}
                    </Button>
                  </>
                )}
                {kind === 'format' && (
                  <>
                    <Button
                      size="touch"
                      loading={actions.pending}
                      onClick={() => actions.approve(m)}
                    >
                      {tx('Approve')}
                    </Button>
                    <Button
                      variant="default"
                      size="touch"
                      loading={actions.pending}
                      onClick={() => actions.reject(m)}
                    >
                      {tx('Reject')}
                    </Button>
                  </>
                )}
                {kind === 'pending' && (
                  <>
                    <Button
                      size="touch"
                      loading={actions.pending}
                      onClick={() => {
                        const payload = scorePayloadOf(m.score, m.sets);
                        if (payload) actions.record(m, ctx, payload);
                      }}
                    >
                      {tx('Confirm')}
                    </Button>
                    <Button
                      variant="default"
                      size="touch"
                      loading={actions.pending}
                      onClick={() => actions.clear(m)}
                    >
                      {tx('Reject')}
                    </Button>
                  </>
                )}
                <Button
                  variant="subtle"
                  color="gray"
                  size="touch"
                  onClick={() => onOverride(m, kind === 'dispute' ? 'resolve' : 'record')}
                >
                  {tx('Override')}
                </Button>
              </Group>
            }
          >
            {kind === 'dispute' && m.dispute_escalated && (
              <Text size="sm" c="red" fw={600}>
                {tx('Escalated by a player: only you can settle it.')}
              </Text>
            )}
            {kind === 'dispute' && (
              <Group gap="md">
                <Line label={tx('Original')} value={show(m.score, m.sets, m)} />
                <Line label={tx('Correction')} value={show(m.dispute_score, m.dispute_sets, m)} />
              </Group>
            )}
            {kind === 'format' && (
              <Line label={tx('Submitted')} value={show(m.review_score, m.review_sets, m)} />
            )}
            {kind === 'pending' && (
              <Line label={tx('Submitted')} value={show(m.score, m.sets, m)} />
            )}
          </MatchCard>
        ))}
      </MatchListFrame>
    </Stack>
  );
}
