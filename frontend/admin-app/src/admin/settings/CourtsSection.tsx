import { useState } from 'react';
import { Button, Group, NumberInput, Stack, Text, Textarea } from '@mantine/core';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import type { TournamentStatus } from '../../types';
import { MutationError, Section } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';
import {
  MexicanoOptionFields,
  type MexicanoOptions,
} from '../../features/mexicano/MexicanoOptions';
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
  const save = useAdminMutation({
    request: () =>
      write(
        `/tournaments/${tid}/${prefix}/courts`,
        {
          court_names: courts
            .split('\n')
            .map((n) => n.trim())
            .filter(Boolean),
        },
        'PATCH',
      ),
    invalidate: [['admin', 'tournament', tid]],
    success: 'Courts updated',
  });
  return (
    <Section
      title={tx('Courts')}
      description={tx('One court per line. Changes apply to the next round and to the bracket.')}
    >
      <Textarea
        aria-label={tx('Courts')}
        autosize
        minRows={3}
        value={courts}
        onChange={(e) => setCourts(e.currentTarget.value)}
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
