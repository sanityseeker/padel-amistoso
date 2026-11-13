import { notifications } from '@mantine/notifications';
import { useQueryClient } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import { formatRoundLabel } from '../../roundLabel';
import { playerApi } from '../../player/api';
import type { PlayerMatch } from '../../player/types';
import type { ScoringEntry } from './eventData';
import type { InputFormat } from '../../types';
import { ScoreEntry } from '../tournaments';
import { formatKeyOf, formatScore, type ScorePayload } from '../../admin/tournament/scoring';
import { ResponsiveSheet } from '../../ui';
import { refreshAfterError, type ScoringData } from './eventData';

// "Submit your score" and "Correct the score": the shared ScoreEntry on the player surface. Same
// endpoints, payloads and tournament token as the legacy TV page; only the form is new.
export function ScoreSheet({
  mode,
  match,
  entry,
  data,
  token,
  onClose,
}: {
  mode: 'submit' | 'correct';
  match: PlayerMatch;
  entry: ScoringEntry;
  data: ScoringData;
  token: string;
  onClose: () => void;
}) {
  useLocale();
  const client = useQueryClient();
  const decider = match.effective_decider || data.tv.set_decider || 'full_set';
  const defaultMode: InputFormat =
    (match.format_override?.mode || data.tv.score_mode[data.context]) === 'sets' &&
    data.setsAvailable
      ? 'sets'
      : 'points';
  // A correction starts from the score the other side submitted, in the format it was entered in.
  const submittedSets = mode === 'correct' && match.sets?.length ? match.sets : null;
  const initial: ScorePayload | null =
    mode !== 'correct'
      ? null
      : submittedSets
        ? { kind: 'sets', sets: submittedSets }
        : match.score
          ? { kind: 'points', score: match.score }
          : null;
  const initialMode: InputFormat = initial?.kind === 'sets' ? 'sets' : defaultMode;
  const submittedText =
    mode === 'correct' && initial
      ? tx('Submitted score: {score}', {
          score: formatScore(match.score ?? null, match.sets ?? null, decider),
        })
      : '';
  const defaultKey = formatKeyOf(defaultMode, decider);
  const defaultFormatLabel =
    defaultKey === 'points'
      ? tx('Points')
      : defaultKey === 'sets_tb'
        ? tx('Sets + match tie-break')
        : tx('Sets');
  const submit = async (payload: ScorePayload) => {
    try {
      await send(payload);
    } catch (error) {
      refreshAfterError(client, entry.entity_id, error);
      throw error;
    }
  };
  const send = async (payload: ScorePayload) => {
    const base = `/tournaments/${entry.entity_id}`;
    if (mode === 'correct') {
      await playerApi(
        `${base}/matches/${match.id}/${payload.kind === 'sets' ? 'correct-tennis' : 'correct'}`,
        payload.kind === 'sets'
          ? { match_id: match.id, sets: payload.sets }
          : { match_id: match.id, score1: payload.score[0], score2: payload.score[1] },
        'POST',
        token,
      );
      void client.invalidateQueries({ queryKey: ['player'] });
      void client.invalidateQueries({ queryKey: ['public', 'tv', entry.entity_id] });
      notifications.show({ message: tx('Correction sent to the other side.'), color: 'green' });
      return;
    }
    const result = await playerApi<{ review?: boolean }>(
      `${base}/${payload.kind === 'sets' ? `${data.endpoint}-tennis` : data.endpoint}`,
      payload.kind === 'sets'
        ? { match_id: match.id, sets: payload.sets, decider: payload.decider ?? decider }
        : { match_id: match.id, score1: payload.score[0], score2: payload.score[1] },
      'POST',
      token,
    );
    void client.invalidateQueries({ queryKey: ['player'] });
    void client.invalidateQueries({ queryKey: ['public', 'tv', entry.entity_id] });
    notifications.show({
      message: tx(
        result.review
          ? 'Score sent to the organizer for review.'
          : 'Score submitted. Your event’s confirmation rules apply.',
      ),
      color: 'green',
    });
  };
  return (
    <ResponsiveSheet
      opened
      onClose={onClose}
      title={mode === 'correct' ? tx('Correct the score') : tx('Submit your score')}
    >
      <ScoreEntry
        names={[match.team1.join(' & '), match.team2.join(' & ')]}
        meta={[formatRoundLabel(match.round_label), match.court, submittedText]
          .filter(Boolean)
          .join(' · ')}
        rules={{
          modes: data.setsAvailable ? ['points', 'sets'] : ['points'],
          defaultMode,
          total: match.effective_points_target ?? 0,
          decider,
        }}
        initial={initial}
        initialMode={initialMode}
        surface="sheet"
        fieldNames="sides"
        submitLabel={mode === 'correct' ? tx('Send correction') : tx('Submit score')}
        formatChoice={mode === 'submit' && data.setsAvailable}
        confirmStep={mode === 'submit'}
        formatNotice={
          mode === 'submit'
            ? tx(
                'This match is set to {format}. A score in another format goes to the organizer for review and only counts once approved.',
                { format: defaultFormatLabel },
              )
            : undefined
        }
        onSubmit={submit}
        onClose={onClose}
      />
    </ResponsiveSheet>
  );
}
