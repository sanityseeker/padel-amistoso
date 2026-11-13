import { useEffect } from 'react';
import { Badge, Card, Group, Skeleton, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { IconChevronRight, IconMessage } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../../i18n';
import { formatType } from '../../../api';
import type { Entry } from '../../../player/types';
import { MatchCard, toPlayerMatchView } from '../../tournaments';
import { StatusBadge } from '../../../ui';
import { isTbd, lifecycleIn, useEventData } from '../eventData';
import { entryPath } from '../context';
import { MatchActions } from '../MatchActions';
import { PaymentBadge, useOpenPayment } from '../payments';
import { sportProps } from '../../../theme';
import classes from '../Player.module.css';

/** "Round 3 of 6", "Group stage", "Play-offs": where the event is, for the card eyebrow. */
export function phaseText(
  status: { phase: string; current_round?: number; num_rounds?: number } | undefined,
): string {
  if (!status) return '';
  if (status.phase === 'finished') return tx('Finished');
  if (status.phase === 'playoffs') return tx('Play-offs');
  if (status.phase === 'groups') return tx('Group stage');
  if (status.current_round)
    return status.num_rounds
      ? tx('Round {round} of {total}', { round: status.current_round, total: status.num_rounds })
      : tx('Round {round}', { round: status.current_round });
  return tx('Ready to start');
}

// One active tournament as a navigation card: the header opens the event page, the body shows the
// match that needs the player (with Enter score, Confirm or Accept correction).
export function TournamentNavCard({ entry }: { entry: Entry }) {
  useLocale();
  const event = useEventData(entry, { poll: 30_000 });
  const data = event.data;
  const pending = data?.pending ?? null;
  const state = pending && data ? lifecycleIn(pending, data, entry.player_id) : null;
  const client = useQueryClient();
  const payment = useOpenPayment(entry);
  const finished = !!data?.finished;
  // Finished while the Hub list still has it as active: refresh so it moves to Past.
  useEffect(() => {
    if (finished && entry.status === 'active')
      void client.invalidateQueries({ queryKey: ['player', 'space'] });
  }, [client, finished, entry.status]);
  // Nothing to score right now: say why in one line (sitting out, or the opponent is not known yet).
  const idle =
    data && !pending && !data.finished && !data.withdrawn
      ? data.sittingOut
        ? tx('You sit out this round')
        : data.schedule.next.some(isTbd)
          ? tx('Waiting for your opponent')
          : null
      : null;
  return (
    <Card
      p={0}
      className={classes.navCard}
      data-testid="active-tournament"
      {...sportProps(entry.sport)}
    >
      <UnstyledButton component={Link} to={entryPath(entry)} className={classes.navCardLink}>
        <Group justify="space-between" wrap="nowrap" gap="sm">
          <Stack gap={4} miw={0}>
            <Text variant="eyebrow">
              {[
                entry.tournament_type ? formatType(entry.tournament_type) : '',
                tx(entry.sport === 'tennis' ? 'Tennis' : 'Padel'),
              ]
                .filter(Boolean)
                .join(' · ')}
            </Text>
            <Title order={3} size="h4">
              {entry.entity_name}
            </Title>
            <Group gap={6}>
              {data ? (
                <StatusBadge tone={data.status.phase === 'finished' ? 'neutral' : 'live'}>
                  {phaseText(data.status)}
                </StatusBadge>
              ) : (
                <Skeleton h={20} w={90} />
              )}
              {state === 'confirm' && (
                <Badge color="yellow" variant="light">
                  {tx('Confirm score')}
                </Badge>
              )}
              {(state === 'correction' || state === 'escalated') && (
                <Badge color="red" variant="light">
                  {tx('Dispute')}
                </Badge>
              )}
            </Group>
          </Stack>
          <IconChevronRight size={20} aria-hidden />
        </Group>
      </UnstyledButton>
      {payment && (
        <div className={classes.navCardBody}>
          <PaymentBadge payment={payment} />
        </div>
      )}
      {idle && (
        <div className={classes.navCardBody}>
          <Text size="sm" c="dimmed" data-testid="active-tournament-idle">
            {idle}
          </Text>
        </div>
      )}
      {pending && data && (
        <div className={classes.navCardBody}>
          <MatchCard
            density="slot"
            testId="player-match"
            courts={data.status.assign_courts !== false}
            match={toPlayerMatchView(pending, {
              decider: pending.effective_decider || data.tv.set_decider || 'full_set',
              expand: data.expand,
              playerId: entry.player_id,
            })}
            footer={<MatchActions match={pending} entry={entry} data={data} token={event.token} />}
          >
            {/* The organizer's note for this match, as on the event page. */}
            {pending.comment && (
              <Text size="sm" c="dimmed" data-testid="match-comment">
                <IconMessage size={13} style={{ verticalAlign: '-2px' }} /> {pending.comment}
              </Text>
            )}
          </MatchCard>
        </div>
      )}
    </Card>
  );
}
