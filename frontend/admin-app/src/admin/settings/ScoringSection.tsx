import { useState } from 'react';
import {
  Button,
  Group,
  NativeSelect,
  NumberInput,
  SegmentedControl,
  Slider,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { TvSettings } from '../../types';
import { FormActions, MutationError, Section } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import type { Ctx } from '../tournament/scoring';
import type { TournamentPrefix } from '../tournament/query';

const CONTEXTS: Record<TournamentPrefix, { ctx: Ctx; label: string }[]> = {
  gp: [
    { ctx: 'gp-group', label: 'Group stage' },
    { ctx: 'gp-playoff', label: 'Play-offs' },
  ],
  mex: [{ ctx: 'mex-playoff', label: 'Play-offs' }],
  po: [{ ctx: 'po-playoff', label: 'Play-offs' }],
};

// PATCH /tournaments/{id}/tv-settings merges: only the fields sent change.
export function useTvPatch(tid: string) {
  return useAdminMutation({
    request: (
      patch: Partial<Omit<TvSettings, 'score_mode'>> & { score_mode?: Record<string, string> },
    ) => write(`/tournaments/${tid}/tv-settings`, patch, 'PATCH'),
    invalidate: [['admin', 'tournament', tid]],
    success: 'Settings saved',
  });
}

const REFRESH = [
  [-1, 'On every update'],
  [0, 'Never'],
  [5, '5 s'],
  [10, '10 s'],
  [15, '15 s'],
  [30, '30 s'],
  [60, '1 min'],
  [120, '2 min'],
  [300, '5 min'],
] as const;

export function ScoringSection({
  tid,
  prefix,
  settings,
}: {
  tid: string;
  prefix: TournamentPrefix;
  settings: TvSettings;
}) {
  useLocale();
  const patch = useTvPatch(tid);
  return (
    <Stack gap="md">
      <Section
        title={tx('How scores are entered')}
        description={tx(
          'Points or sets for each stage. Individual matches can still override this.',
        )}
      >
        <Stack gap="sm">
          {CONTEXTS[prefix].map(({ ctx, label }) => (
            <Group key={ctx} justify="space-between" wrap="nowrap">
              <Text size="sm">{tx(label)}</Text>
              <SegmentedControl
                size="xs"
                aria-label={tx(label)}
                value={settings.score_mode[ctx] ?? 'points'}
                onChange={(v) => patch.mutate({ score_mode: { [ctx]: v } })}
                data={[
                  { value: 'points', label: tx('Points') },
                  { value: 'sets', label: tx('Sets') },
                ]}
              />
            </Group>
          ))}
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{tx('Deciding set')}</Text>
            <SegmentedControl
              size="xs"
              aria-label={tx('Deciding set')}
              value={settings.set_decider}
              onChange={(v) => patch.mutate({ set_decider: v as TvSettings['set_decider'] })}
              data={[
                { value: 'full_set', label: tx('Full set') },
                { value: 'match_tiebreak', label: tx('Match tie-break') },
              ]}
            />
          </Group>
        </Stack>
      </Section>
      <Section
        title={tx('Player scoring')}
        description={tx(
          'Let players enter scores from their own phone, and decide who has to confirm them.',
        )}
      >
        <Stack gap="sm">
          <Switch
            label={tx('Players can submit scores')}
            checked={settings.allow_player_scoring ?? true}
            onChange={(e) => patch.mutate({ allow_player_scoring: e.currentTarget.checked })}
          />
          <Group justify="space-between" wrap="nowrap">
            <Text size="sm">{tx('Confirmation')}</Text>
            <SegmentedControl
              size="xs"
              aria-label={tx('Confirmation')}
              value={settings.score_confirmation}
              onChange={(v) =>
                patch.mutate({ score_confirmation: v as TvSettings['score_confirmation'] })
              }
              data={[
                { value: 'immediate', label: tx('Counts immediately') },
                { value: 'required', label: tx('Opponent confirms') },
              ]}
            />
          </Group>
          <NumberInput
            label={tx('Correction window (seconds)')}
            description={tx(
              'How long the opposing team can correct a submitted score. 0 means no limit.',
            )}
            min={0}
            max={3600}
            allowDecimal={false}
            defaultValue={settings.correction_window_seconds ?? 0}
            onBlur={(e) => {
              const value = Number(e.currentTarget.value);
              if (Number.isFinite(value) && value !== (settings.correction_window_seconds ?? 0))
                patch.mutate({ correction_window_seconds: value });
            }}
          />
        </Stack>
      </Section>
      <MutationError error={patch.error} />
    </Stack>
  );
}

export function TvSection({
  tid,
  settings,
  hasCourts,
  hasPlayoffs,
  mexicano,
  groups = false,
}: {
  tid: string;
  settings: TvSettings;
  hasCourts: boolean;
  hasPlayoffs: boolean;
  mexicano: boolean;
  /** Group+Playoff: offer how many places each group table marks. */
  groups?: boolean;
}) {
  useLocale();
  const patch = useTvPatch(tid);
  const [banner, setBanner] = useState(settings.banner_text ?? '');
  const [customInfoTitle, setCustomInfoTitle] = useState(settings.custom_info_title ?? '');
  const [customInfoText, setCustomInfoText] = useState(settings.custom_info_text ?? '');
  const toggle = (key: keyof TvSettings, label: string, fallback: boolean, disabled = false) => (
    <Switch
      key={key}
      label={tx(label)}
      disabled={disabled}
      checked={disabled ? false : ((settings[key] as boolean | undefined) ?? fallback)}
      onChange={(e) => patch.mutate({ [key]: e.currentTarget.checked })}
    />
  );
  const slider = (key: keyof TvSettings, label: string, min: number, max: number) => (
    <div key={key}>
      <Text size="sm">{tx(label)}</Text>
      <Slider
        min={min}
        max={max}
        step={0.1}
        defaultValue={(settings[key] as number | undefined) ?? 1}
        onChangeEnd={(v) => patch.mutate({ [key]: v })}
        label={(v) => v.toFixed(1)}
        aria-label={tx(label)}
      />
    </div>
  );
  return (
    <Stack gap="md">
      <Section title={tx('On the TV screen')} description={tx('Choose what spectators see.')}>
        <Stack gap="xs">
          {toggle('show_past_matches', 'Past matches', true)}
          {mexicano && toggle('show_score_breakdown', 'Score breakdowns', false)}
          {toggle('show_standings', 'Standings and leaderboard', true)}
          {toggle('show_bracket', 'Play-off bracket', true)}
          {toggle('show_courts', 'Court assignments', true, !hasCourts)}
          {toggle('show_pending_matches', 'Pending matches', false)}
        </Stack>
        {groups && (
          <NumberInput
            label={tx('Highlighted places in every group')}
            description={tx(
              'Marked in the group standings for players, the TV screen and you. Places 1-3 keep gold, silver and bronze; 0 turns the marks off. Change one group under its table in Standings.',
            )}
            min={0}
            max={32}
            allowDecimal={false}
            allowNegative={false}
            defaultValue={settings.highlight_places ?? 3}
            onBlur={(e) => {
              const value = Number(e.currentTarget.value);
              if (Number.isFinite(value) && value !== (settings.highlight_places ?? 3))
                patch.mutate({ highlight_places: value });
            }}
          />
        )}
        <Textarea
          label={tx('Banner message')}
          description={tx('Shown across the top of the TV screen.')}
          maxLength={5000}
          autosize
          minRows={2}
          value={banner}
          onChange={(e) => setBanner(e.currentTarget.value)}
        />
        <FormActions>
          <Button
            variant="default"
            disabled={banner === (settings.banner_text ?? '')}
            loading={patch.isPending}
            onClick={() => patch.mutate({ banner_text: banner })}
          >
            {tx('Save banner')}
          </Button>
        </FormActions>
        <TextInput
          label={tx('Custom section title')}
          description={tx('Name this optional section on the TV screen.')}
          maxLength={120}
          value={customInfoTitle}
          onChange={(e) => setCustomInfoTitle(e.currentTarget.value)}
        />
        <Textarea
          label={tx('Custom section description')}
          description={tx(
            'Shown on TV when the description is not empty. Markdown formatting is supported.',
          )}
          maxLength={5000}
          autosize
          minRows={2}
          value={customInfoText}
          onChange={(e) => setCustomInfoText(e.currentTarget.value)}
        />
        <FormActions>
          <Button
            variant="default"
            disabled={
              customInfoTitle === (settings.custom_info_title ?? '') &&
              customInfoText === (settings.custom_info_text ?? '')
            }
            loading={patch.isPending}
            onClick={() =>
              patch.mutate({ custom_info_title: customInfoTitle, custom_info_text: customInfoText })
            }
          >
            {tx('Save custom section')}
          </Button>
        </FormActions>
        <NativeSelect
          label={tx('Refresh the TV screen')}
          value={String(settings.refresh_interval ?? 15)}
          onChange={(e) => patch.mutate({ refresh_interval: Number(e.currentTarget.value) })}
          data={REFRESH.map(([value, label]) => ({ value: String(value), label: tx(label) }))}
        />
      </Section>
      {hasPlayoffs && (
        <Section
          title={tx('Bracket diagram')}
          description={tx('Size and image format of the bracket picture.')}
        >
          <Stack gap="sm">
            <NativeSelect
              label={tx('Image format')}
              value={settings.schema_format ?? 'svg'}
              onChange={(e) =>
                patch.mutate({ schema_format: e.currentTarget.value as 'svg' | 'png' })
              }
              data={[
                { value: 'svg', label: 'SVG' },
                { value: 'png', label: 'PNG' },
              ]}
            />
            {slider('schema_box_scale', 'Box size', 0.3, 3)}
            {slider('schema_line_width', 'Line width', 0.3, 5)}
            {slider('schema_arrow_scale', 'Arrow size', 0.3, 5)}
            {slider('schema_title_font_scale', 'Header size', 0.3, 3)}
            {slider('schema_output_scale', 'Output scale', 0.5, 3)}
          </Stack>
        </Section>
      )}
      <MutationError error={patch.error} />
    </Stack>
  );
}
