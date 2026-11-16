import { useCallback, useEffect, useState } from 'react';
import {
  ActionIcon,
  Anchor,
  Card,
  Group,
  Skeleton,
  Stack,
  Text,
  Title,
  UnstyledButton,
} from '@mantine/core';
import { IconCheck, IconChevronRight, IconMessage } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../../i18n';
import { formatType } from '../../../api';
import type { Entry } from '../../../player/types';
import { MatchCard, toPlayerMatchView } from '../../tournaments';
import { StatusBadge } from '../../../ui';
import { isTbd, lifecycleIn, useEventData, usesCourts } from '../eventData';
import { entryPath } from '../context';
import { MatchActions } from '../MatchActions';
import { MatchContacts, useMatchContacts } from '../MatchContacts';
import {
  ANNOUNCEMENTS_ANCHOR,
  announcementsOf,
  INFO_ANCHOR,
  infoTextOf,
  newestAnnouncementAt,
} from '../../public/OrganizerNotes';
import { useAnnouncementSeen } from '../../public/announcementSeen';
import { PaymentBadge, useOpenPayment } from '../payments';
import { sportProps } from '../../../theme';
import { PlayerCardModal, playerCardSource } from '../../playercard';
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
  // A tap on a name in the match opens that player's card (scouting the next opponents).
  const [cardId, setCardId] = useState<string | null>(null);
  const closeCard = useCallback(() => setCardId(null), []);
  const contacts = useMatchContacts(entry.entity_id, event.token, pending ? [pending.id] : []);
  const payment = useOpenPayment(entry);
  const finished = !!data?.finished;
  // Finished while the Hub list still has it as active: refresh so it moves to Past.
  useEffect(() => {
    if (finished && entry.status === 'active')
      void client.invalidateQueries({ queryKey: ['player', 'space'] });
  }, [client, finished, entry.status]);
  // Nothing to score right now: say why in one line (sitting out, the next match waits in the
  // court queue, or the opponent is not known yet).
  const queued = data?.schedule.next.find((m) => !isTbd(m) && m.status === 'scheduled');
  const idle =
    data && !pending && !data.finished && !data.withdrawn
      ? data.sittingOut
        ? tx('You sit out this round')
        : queued && usesCourts(data.status)
          ? queued.waiting_for_players
            ? tx('Waiting for players to finish')
            : tx('Waiting for a court')
          : data.schedule.next.some(isTbd)
            ? tx('Waiting for your opponent')
            : null
      : null;
  // The organizer's notes: the card only points at them, the event page shows the text.
  const announcement = announcementsOf(data?.tv).length > 0;
  const hasInfo = !!infoTextOf(data?.tv);
  // "New": an announcement posted after the player last opened this event page (this browser only).
  const seen = useAnnouncementSeen(entry.entity_id, newestAnnouncementAt(data?.tv));
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
                <StatusBadge tone="warning" variant="light">
                  {tx('Confirm score', { context: 'badge' })}
                </StatusBadge>
              )}
              {(state === 'correction' || state === 'escalated') && (
                <StatusBadge tone="danger" variant="light">
                  {tx('Dispute')}
                </StatusBadge>
              )}
            </Group>
          </Stack>
          <IconChevronRight size={20} aria-hidden />
        </Group>
      </UnstyledButton>
      {(payment || announcement || hasInfo) && (
        <Group gap="xs" className={classes.navCardBody}>
          {payment && <PaymentBadge payment={payment} />}
          {announcement && (
            <UnstyledButton
              component={Link}
              to={`${entryPath(entry)}#${ANNOUNCEMENTS_ANCHOR}`}
              data-testid="active-tournament-announcement"
              data-new={seen.isNew || undefined}
            >
              <StatusBadge
                tone={seen.isNew ? 'warning' : 'info'}
                variant={seen.isNew ? 'outline' : 'light'}
                style={{ cursor: 'pointer' }}
              >
                {seen.isNew ? tx('New announcement') : tx('Announcement')}
              </StatusBadge>
            </UnstyledButton>
          )}
          {seen.isNew && (
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={seen.markSeen}
              aria-label={tx('Mark announcements as seen')}
              data-testid="active-tournament-announcement-seen"
            >
              <IconCheck size={14} aria-hidden />
            </ActionIcon>
          )}
          {hasInfo && (
            <Anchor
              component={Link}
              to={`${entryPath(entry)}#${INFO_ANCHOR}`}
              size="xs"
              data-testid="active-tournament-info"
            >
              {tx('Information')}
            </Anchor>
          )}
        </Group>
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
            courts={usesCourts(data.status)}
            queueLabels
            onPlayer={setCardId}
            match={toPlayerMatchView(pending, {
              decider: pending.effective_decider || data.tv.set_decider || 'full_set',
              expand: data.expand,
              playerId: entry.player_id,
            })}
            actions={
              <MatchContacts
                match={pending}
                people={contacts.get(pending.id)}
                expand={data.expand}
                playerId={entry.player_id}
              />
            }
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
      <PlayerCardModal
        tid={entry.entity_id}
        playerId={cardId}
        onClose={closeCard}
        autoClose={false}
        source={playerCardSource}
      />
    </Card>
  );
}
