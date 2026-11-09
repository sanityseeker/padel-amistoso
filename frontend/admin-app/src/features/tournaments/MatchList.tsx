import type { ReactNode } from 'react';
import { Button, Group, Paper, Text } from '@mantine/core';
import { IconCheck, IconMessage, IconPencil } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import type { Match, TvSettings } from '../../types';
import {
  inputFormat,
  pointsTarget,
  type Ctx,
  type ScorePayload,
} from '../../admin/tournament/scoring';
import { QuickScore } from './QuickScore';
import { toMatchView } from './adapters';
import { MatchCard } from './MatchCard';
import classes from './MatchCard.module.css';

// A bordered list of match rows: one frame, hairlines between rows, no nested boxes.
export function MatchListFrame({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <Paper p={0} className={classes.list} role="list" data-testid={testId}>
      {children}
    </Paper>
  );
}

// Admin match centre. A row whose editor is open shows `renderEditor(match)` in place of its action.
export function MatchList({
  matches,
  ctx,
  settings,
  canEdit,
  editingId,
  selectedId,
  onScore,
  renderEditor,
  renderMenu,
  quick,
}: {
  matches: Match[];
  ctx: Ctx;
  settings: TvSettings;
  canEdit: boolean;
  editingId?: string | null;
  /** Keyboard selection (j / k): the row gets a visible marker. */
  selectedId?: string | null;
  onScore: (match: Match) => void;
  renderEditor?: (match: Match) => ReactNode;
  /** Overflow menu beside the score button (comment, history). */
  renderMenu?: (match: Match) => ReactNode;
  /** Desktop: pending points matches show their score boxes in the row (no Score button first). */
  quick?: { totalPoints: number; onSave: (match: Match, payload: ScorePayload) => void };
}) {
  useLocale();
  const showQuick = (m: Match) => inputFormat(m, ctx, settings) === 'points';
  return (
    <MatchListFrame>
      {matches.map((m) => {
        const view = toMatchView(m, settings, ctx);
        const done = m.status === 'completed';
        const names = `${m.team1.join(' & ')} vs ${m.team2.join(' & ')}`;
        const inline = !!(canEdit && view.ready && !m.walkover && quick && !done && showQuick(m));
        return (
          <MatchCard
            key={m.id}
            match={view}
            selected={selectedId === m.id}
            editor={editingId === m.id ? renderEditor?.(m) : undefined}
            actions={
              <Group gap={4} wrap="nowrap">
                {canEdit && view.ready && !m.walkover && !inline && (
                  <Button
                    size="touch"
                    variant={done ? 'subtle' : 'light'}
                    color={done ? 'gray' : 'court'}
                    leftSection={done ? <IconPencil size={16} /> : <IconCheck size={16} />}
                    aria-label={`${done ? tx('Edit score') : tx('Record score')}: ${names}`}
                    data-score-action
                    onClick={() => onScore(m)}
                  >
                    {done ? tx('Edit') : tx('Set score')}
                  </Button>
                )}
                {canEdit && view.ready && renderMenu?.(m)}
              </Group>
            }
          >
            {(inline || m.comment) && (
              <>
                {inline && quick && (
                  <QuickScore
                    names={[m.team1.join(' & '), m.team2.join(' & ')]}
                    total={pointsTarget(m, ctx, quick.totalPoints)}
                    onSave={(payload) => quick.onSave(m, payload)}
                    onMore={() => onScore(m)}
                  />
                )}
                {m.comment && (
                  <Text size="sm" c="dimmed" data-testid="match-comment">
                    <IconMessage size={13} style={{ verticalAlign: '-2px' }} /> {m.comment}
                  </Text>
                )}
              </>
            )}
          </MatchCard>
        );
      })}
    </MatchListFrame>
  );
}
