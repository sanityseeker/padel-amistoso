import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Drawer,
  Group,
  Loader,
  Menu,
  Modal,
  Stack,
  Text,
  Textarea,
  Timeline,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IconDots, IconHistory, IconMessage } from '@tabler/icons-react';
import classes from './MatchTools.module.css';
import { t as tx, useLocale } from '../../i18n';
import { api, write } from '../../api';
import type { Match, Score, ScoreHistoryEntry } from '../../types';

const ACTIONS: Record<string, string> = {
  record: 'Score recorded',
  accept: 'Score accepted',
  correct: 'Correction proposed',
  accept_correction: 'Correction accepted',
  escalate: 'Escalated to the organizer',
  resolve_dispute: 'Dispute resolved',
  admin_clear: 'Result cleared',
  reject_review: 'Score rejected',
  format_override: 'Format changed',
  approve_review: 'Score approved',
};
const actionLabel = (action: string) => (ACTIONS[action] ? tx(ACTIONS[action]) : action);

const scoreText = (score: Score | null, sets: Score[] | null) =>
  sets?.length ? sets.map((s) => s.join('-')).join(' ') : score ? score.join('-') : '';
const when = (seconds: number, locale: string) =>
  new Date(seconds > 1e12 ? seconds : seconds * 1000).toLocaleString(locale, {
    dateStyle: 'short',
    timeStyle: 'short',
  });

// The per-match overflow menu: comment and score history. Scoring itself stays on the row's button.
export function MatchMenu({
  match,
  onComment,
  onHistory,
}: {
  match: Match;
  onComment: (match: Match) => void;
  onHistory: (match: Match) => void;
}) {
  useLocale();
  const names = `${match.team1.join(' & ')} vs ${match.team2.join(' & ')}`;
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon size="touch" aria-label={`${tx('Match options')}: ${names}`}>
          <IconDots size={18} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<IconMessage size={16} />} onClick={() => onComment(match)}>
          {match.comment ? tx('Edit comment') : tx('Add comment')}
        </Menu.Item>
        <Menu.Item leftSection={<IconHistory size={16} />} onClick={() => onHistory(match)}>
          {tx('Score history')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

// Comment and score history as their own buttons beside the row's Score button when the card is
// wide enough; on narrow cards the same two actions live in the overflow menu (CSS decides which).
export function MatchTools({
  match,
  onComment,
  onHistory,
}: {
  match: Match;
  onComment: (match: Match) => void;
  onHistory: (match: Match) => void;
}) {
  useLocale();
  return (
    <>
      <div className={classes.inline}>
        <Group gap={4} wrap="nowrap">
          <Button
            size="touch"
            variant="subtle"
            color="gray"
            leftSection={<IconMessage size={16} />}
            onClick={() => onComment(match)}
          >
            {match.comment ? tx('Edit comment') : tx('Add comment')}
          </Button>
          <Button
            size="touch"
            variant="subtle"
            color="gray"
            leftSection={<IconHistory size={16} />}
            onClick={() => onHistory(match)}
          >
            {tx('Score history')}
          </Button>
        </Group>
      </div>
      <div className={classes.menu}>
        <MatchMenu match={match} onComment={onComment} onHistory={onHistory} />
      </div>
    </>
  );
}

// PATCH /tournaments/{tid}/match-comment, as the legacy admin does (an empty text clears it).
export function CommentDialog({
  tid,
  match,
  onClose,
}: {
  tid: string;
  match: Match;
  onClose: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const [text, setText] = useState(match.comment ?? '');
  const save = useMutation({
    mutationFn: (comment: string) =>
      write(`/tournaments/${tid}/match-comment`, { match_id: match.id, comment }, 'PATCH'),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['admin', 'tournament', tid] });
      notifications.show({ message: tx('Comment saved'), color: 'green' });
      onClose();
    },
  });
  return (
    <Modal opened onClose={onClose} title={tx('Match comment')} centered>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(text.trim());
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {match.team1.join(' & ')} / {match.team2.join(' & ')}
          </Text>
          {save.error && <Alert color="red">{tx(save.error.message)}</Alert>}
          <Textarea
            label={tx('Comment')}
            description={tx('Shown on the match for players and on the TV view.')}
            maxLength={500}
            autosize
            minRows={2}
            data-autofocus
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <Group justify="space-between">
            <Button
              variant="subtle"
              color="gray"
              disabled={!match.comment}
              loading={save.isPending}
              onClick={() => save.mutate('')}
            >
              {tx('Remove comment')}
            </Button>
            <Group>
              <Button variant="default" onClick={onClose}>
                {tx('Cancel')}
              </Button>
              <Button type="submit" loading={save.isPending}>
                {tx('Save comment')}
              </Button>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// GET /tournaments/{tid}/matches/{mid}/history: who changed the score and when (organizer only).
export function HistoryDrawer({
  tid,
  match,
  onClose,
}: {
  tid: string;
  match: Match;
  onClose: () => void;
}) {
  const locale = useLocale();
  const history = useQuery({
    queryKey: ['admin', 'match-history', tid, match.id],
    queryFn: () =>
      api<{ history: ScoreHistoryEntry[] }>(`/tournaments/${tid}/matches/${match.id}/history`),
  });
  const items = (history.data?.history ?? []).slice().reverse();
  return (
    <Drawer opened onClose={onClose} position="right" title={tx('Score history')} size="sm">
      <Stack>
        <Text size="sm" c="dimmed">
          {match.team1.join(' & ')} / {match.team2.join(' & ')}
        </Text>
        {history.isPending ? (
          <Loader size="sm" />
        ) : history.error ? (
          <Alert color="red">{tx(history.error.message)}</Alert>
        ) : !items.length ? (
          <Text c="dimmed" data-testid="history-empty">
            {tx('No score changes recorded yet.')}
          </Text>
        ) : (
          <Timeline bulletSize={14} lineWidth={2} data-testid="history-list">
            {items.map((h, i) => (
              <Timeline.Item key={i} title={actionLabel(h.action)}>
                {scoreText(h.score, h.sets) && (
                  <Text variant="mono" size="sm">
                    {scoreText(h.score, h.sets)}
                  </Text>
                )}
                <Text size="xs" c="dimmed">
                  {when(h.timestamp, locale)}
                  {h.user ? ` · ${h.user}` : h.player_id ? ` · ${tx('Player')}` : ''}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </Stack>
    </Drawer>
  );
}
