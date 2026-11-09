import { useState } from 'react';
import { Button, Group, Text } from '@mantine/core';
import { write } from '../../api';
import { useAuth } from '../../auth';
import { t as tx, useLocale } from '../../i18n';
import { ConfirmAction, MutationError, Section } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

// Rebuilds the ELO ratings from every completed match. Needed after score corrections made outside
// the normal flow. `all` replays every tournament (site administrators only).
export function RatingSection({ tid }: { tid: string }) {
  useLocale();
  const { user } = useAuth();
  // Only the all-tournaments replay asks first: one event is safe to run again, so it just runs.
  const [pending, setPending] = useState<'all' | null>(null);
  const run = useAdminMutation({
    request: (scope: 'one' | 'all') =>
      scope === 'one'
        ? write<unknown>(`/tournaments/${tid}/elo/recalculate`)
        : write<unknown>('/tournaments/elo/recalculate-all'),
    invalidate: [['admin', 'tournament', tid], ['player'], ['public']],
    success: 'Ratings recalculated',
    onSuccess: () => setPending(null),
  });
  return (
    <Section
      title={tx('Player ratings')}
      description={tx('Replay the ratings from all completed matches. Safe to run again.')}
    >
      <Group justify="space-between" wrap="nowrap">
        <Text size="sm">{tx('This tournament')}</Text>
        <Button
          variant="light"
          loading={run.isPending && !pending}
          onClick={() => run.mutate('one')}
        >
          {tx('Recalculate ELO')}
        </Button>
      </Group>
      {user?.role === 'admin' && (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{tx('Every tournament')}</Text>
          <Button variant="light" color="orange" onClick={() => setPending('all')}>
            {tx('Recalculate all')}
          </Button>
        </Group>
      )}
      {!pending && <MutationError error={run.error} />}
      <ConfirmAction
        opened={!!pending}
        title={tx('Recalculate every tournament?')}
        description={tx('This replays all tournaments in order and can take a while.')}
        loading={run.isPending}
        error={pending ? run.error : null}
        onConfirm={() => run.mutate('all')}
        onClose={() => setPending(null)}
      />
    </Section>
  );
}
