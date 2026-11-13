import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import type { InputFormat, Match, TvSettings } from '../../types';
import { ResponsiveSheet } from '../../ui';
import { ScoreEntry, type ScoreRules } from '../../features/tournaments';
import { MatchFormat } from './MatchFormat';
import {
  canScoreSets,
  matchDecider,
  pointsTarget,
  scorePayloadOf,
  type Ctx,
  type ScorePayload,
} from './scoring';
import { useReviewActions } from './useScoreActions';

export interface AdminScoreProps {
  tid: string;
  match: Match;
  ctx: Ctx;
  settings: TvSettings;
  totalPoints: number;
  /** `record` records or corrects a score; `resolve` overrides a disputed one. */
  purpose: 'record' | 'resolve';
  canClear: boolean;
  onClose: () => void;
  /** Phone: save, then open the next pending match. */
  onNext?: () => void;
  onSubmit: (payload: ScorePayload) => Promise<void> | void;
}

function initialMode(p: AdminScoreProps): InputFormat {
  const { match, ctx, settings, purpose } = p;
  if (!canScoreSets(ctx)) return 'points';
  if (purpose === 'resolve')
    return match.dispute_sets?.length || match.sets?.length ? 'sets' : 'points';
  return (
    match.format_override?.mode ??
    (match.sets?.length ? 'sets' : (settings.score_mode[ctx] ?? 'points'))
  );
}

export const scoreTitle = (purpose: 'record' | 'resolve', completed: boolean) =>
  purpose === 'resolve'
    ? tx('Override score')
    : completed
      ? tx('Edit score')
      : tx('Record match score');

// The organizer's ScoreEntry: wires a Match, its stage context and the per-match format override.
export function AdminScoreEntry(
  props: AdminScoreProps & { surface: 'sheet' | 'inline' | 'dialog' },
) {
  useLocale();
  const {
    tid,
    match,
    ctx,
    settings,
    totalPoints,
    purpose,
    canClear,
    onClose,
    onNext,
    onSubmit,
    surface,
  } = props;
  const review = useReviewActions(tid);
  const resolve = purpose === 'resolve';
  const rules: ScoreRules = {
    modes: canScoreSets(ctx) ? ['points', 'sets'] : ['points'],
    defaultMode: settings.score_mode[ctx] === 'sets' ? 'sets' : 'points',
    total: pointsTarget(match, ctx, totalPoints),
    decider: matchDecider(match, settings),
  };
  return (
    <ScoreEntry
      names={[match.team1.join(' & '), match.team2.join(' & ')]}
      meta={[formatRoundLabel(match.round_label), match.court].filter(Boolean).join(' · ')}
      rules={rules}
      initial={resolve ? null : scorePayloadOf(match.score, match.sets)}
      initialMode={initialMode(props)}
      surface={surface}
      submitLabel={resolve ? tx('Resolve dispute') : tx('Save score')}
      onSubmit={onSubmit}
      onClose={onClose}
      onNext={resolve ? undefined : onNext}
      onClear={!resolve && canClear ? () => review.clear(match) : undefined}
      extra={
        resolve
          ? undefined
          : ({ replacement, setMode }) => (
              <MatchFormat
                tid={tid}
                match={match}
                ctx={ctx}
                totalPoints={totalPoints}
                replacement={replacement}
                onApplied={(o) => {
                  if (o?.mode) setMode(o.mode);
                }}
              />
            )
      }
    />
  );
}

// Phone: bottom sheet. Desktop: dialog (used for overrides and for scores opened from the review queue).
export function AdminScoreDialog(props: AdminScoreProps) {
  const sheet = <AdminScoreEntry {...props} surface="sheet" />;
  return (
    <ResponsiveSheet
      opened
      onClose={props.onClose}
      title={scoreTitle(props.purpose, props.match.status === 'completed')}
    >
      {sheet}
    </ResponsiveSheet>
  );
}
