import { useState } from 'react';
import { Button, Group, NumberInput, Stack, Text } from '@mantine/core';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { TournamentStatus } from '../../types';
import { MutationError, Section } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import {
  MexicanoOptionFields,
  type MexicanoOptions,
} from '../../features/mexicano/MexicanoOptions';
import { NameListField } from '../../features/create/NameListField';
import {
  CourtPreferencesFields,
  cleanPreferences,
  espejoScopes,
  type CourtPreferences,
} from '../../features/create/CourtPreferencesFields';
import type { TournamentPrefix } from '../tournament/query';

export function CourtsSection({
  tid,
  prefix,
  status,
}: {
  tid: string;
  prefix: TournamentPrefix;
  status: TournamentStatus;
}) {
  useLocale();
  const [courts, setCourts] = useState((status.courts ?? []).map((c) => c.name).join('\n'));
  const courtNames = courts
    .split('\n')
    .map((n) => n.trim())
    .filter(Boolean);
  // Group+Playoff: one scope per group, plus the two Espejo brackets once the play-offs run as Espejo.
  // Direct play-offs: the two Espejo brackets. Mexicano play-offs have no Espejo, so no scopes.
  // Keys are prefixed in the form so a group called "winners" never meets the Espejo side.
  const groupScopes =
    prefix === 'gp'
      ? (status.group_names ?? []).map((g) => ({ key: `g:${g}`, label: tx('Group {name}', { name: g }) }))
      : [];
  const bracketScopes =
    prefix !== 'mex' && status.espejo
      ? espejoScopes().map((s) => ({ ...s, key: `b:${s.key}` }))
      : [];
  const scopes = [...groupScopes, ...bracketScopes];
  const [prefs, setPrefs] = useState<CourtPreferences>(() => ({
    ...withPrefix('g:', status.group_courts),
    ...withPrefix('b:', status.bracket_courts),
  }));
  const [perScope, setPerScope] = useState(Object.keys(prefs).length > 0);
  const save = useAdminMutation({
    request: async () => {
      await write(`/tournaments/${tid}/${prefix}/courts`, { court_names: courtNames }, 'PATCH');
      if (!scopes.length) return;
      await write(
        `/tournaments/${tid}/${prefix}/court-preferences`,
        {
          group_courts: perScope ? withoutPrefix('g:', cleanPreferences(prefs, groupScopes, courtNames)) : {},
          bracket_courts: perScope ? withoutPrefix('b:', cleanPreferences(prefs, bracketScopes, courtNames)) : {},
        },
        'PATCH',
      );
    },
    invalidate: [['admin', 'tournament', tid]],
    success: 'Courts updated',
  });
  return (
    <Section
      title={tx('Courts')}
      description={tx('One court per line. Changes apply to the next round and to the bracket.')}
    >
      <NameListField
        label={tx('Courts')}
        hideLabel
        required={false}
        value={courts}
        onChange={setCourts}
        itemLabel={(n) => tx('Court {n}', { n })}
        itemPlaceholder={(n) => tx('Court {n}', { n })}
        removeLabel={(n) => tx('Remove court {n}', { n })}
        addLabel={tx('Add court')}
      />
      <CourtPreferencesFields
        enabled={perScope}
        onEnabledChange={setPerScope}
        scopes={scopes}
        courtNames={courtNames}
        value={prefs}
        onChange={setPrefs}
      />
      <MutationError error={save.error} />
      <Group justify="flex-end">
        <Button loading={save.isPending} onClick={() => save.mutate()}>
          {tx('Save courts')}
        </Button>
      </Group>
    </Section>
  );
}

const withPrefix = (p: string, prefs: CourtPreferences | undefined): CourtPreferences =>
  Object.fromEntries(Object.entries(prefs ?? {}).map(([k, v]) => [p + k, v]));
const withoutPrefix = (p: string, prefs: CourtPreferences): CourtPreferences =>
  Object.fromEntries(Object.entries(prefs).map(([k, v]) => [k.slice(p.length), v]));

interface MexForm extends MexicanoOptions {
  num_rounds: number;
}

// PATCH /mex/settings replaces every value, so the form starts from the live status and sends all of them.
export function MexicanoSettings({ tid, status }: { tid: string; status: TournamentStatus }) {
  useLocale();
  const [form, setForm] = useState<MexForm>({
    num_rounds: status.num_rounds ?? 0,
    skill_gap: status.skill_gap ?? '',
    win_bonus: status.win_bonus ?? 0,
    strength_weight: status.strength_weight ?? 0,
    loss_discount: status.loss_discount ?? 0,
    balance_tolerance: status.balance_tolerance ?? 0,
    teammate_repeat_weight: status.teammate_repeat_weight ?? 0,
    opponent_repeat_weight: status.opponent_repeat_weight ?? 0,
    repeat_decay: status.repeat_decay ?? 0,
    partner_balance_weight: status.partner_balance_weight ?? 0,
    strength_min_matches: status.strength_min_matches ?? 4,
    strength_win_factor: status.strength_win_factor ?? 1,
    strength_draw_factor: status.strength_draw_factor ?? 0.75,
    strength_loss_factor: status.strength_loss_factor ?? 0.5,
  });
  const save = useAdminMutation({
    request: () =>
      write(
        `/tournaments/${tid}/mex/settings`,
        { ...form, skill_gap: form.skill_gap === '' ? null : form.skill_gap },
        'PATCH',
      ),
    invalidate: [['admin', 'tournament', tid]],
    success: 'Mexicano settings saved',
  });
  return (
    <Section
      title={tx('Mexicano tuning')}
      description={tx('Pairing and scoring weights. They apply from the next round.')}
    >
      <Stack gap="sm">
        <NumberInput
          label={tx('Rounds')}
          description={tx('0 plays rolling rounds until you end them.')}
          min={0}
          allowDecimal={false}
          value={form.num_rounds}
          onChange={(v) => setForm({ ...form, num_rounds: Number(v) || 0 })}
        />
        <MexicanoOptionFields
          value={form}
          onChange={(next) => setForm({ ...form, ...next })}
          fixedTeams={!!status.team_mode}
        />
        <Text size="xs" c="dimmed">
          {tx('Defaults suit most events. Change one value at a time.')}
        </Text>
        <MutationError error={save.error} />
        <Group justify="flex-end">
          <Button loading={save.isPending} onClick={() => save.mutate()}>
            {tx('Save Mexicano settings')}
          </Button>
        </Group>
      </Stack>
    </Section>
  );
}
