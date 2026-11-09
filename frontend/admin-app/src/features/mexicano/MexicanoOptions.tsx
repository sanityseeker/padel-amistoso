import { NumberInput, SimpleGrid, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';

// Every Mexicano scoring and pairing knob. The create form sends them with the new tournament and the
// settings drawer sends them to PATCH /mex/settings; both use these fields, so the two cannot drift.
export interface MexicanoOptions {
  skill_gap: number | '';
  win_bonus: number;
  strength_weight: number;
  strength_min_matches: number;
  strength_win_factor: number;
  strength_draw_factor: number;
  strength_loss_factor: number;
  loss_discount: number;
  balance_tolerance: number;
  teammate_repeat_weight: number;
  opponent_repeat_weight: number;
  repeat_decay: number;
  partner_balance_weight: number;
}

export const MEXICANO_DEFAULTS: MexicanoOptions = {
  skill_gap: '',
  win_bonus: 0,
  strength_weight: 0,
  strength_min_matches: 4,
  strength_win_factor: 1,
  strength_draw_factor: 0.75,
  strength_loss_factor: 0.5,
  loss_discount: 1,
  balance_tolerance: 0.2,
  teammate_repeat_weight: 2,
  opponent_repeat_weight: 1,
  repeat_decay: 0.5,
  partner_balance_weight: 0,
};

type NumericKey = Exclude<keyof MexicanoOptions, 'skill_gap'>;
interface Field {
  key: NumericKey;
  label: string;
  hint: string;
  min: number;
  max?: number;
  step: number;
}
interface Group {
  title: string;
  fields: Field[];
}

const GROUPS: Group[] = [
  {
    title: 'Scoring',
    fields: [
      {
        key: 'win_bonus',
        label: 'Win bonus',
        hint: 'Extra points for the winner. With 5, winning 20–12 credits 25 points. 0 is off.',
        min: 0,
        step: 1,
      },
      {
        key: 'loss_discount',
        label: 'Loss discount',
        hint: 'Multiplier on the loser’s points. With 0.75, losing 12–20 credits 9 points. 1 is none.',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: 'Rival strength',
    fields: [
      {
        key: 'strength_weight',
        label: 'Rival strength',
        hint: 'Boosts points for beating strong opponents (0 to 1). Higher is a stronger effect.',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        key: 'strength_min_matches',
        label: 'Matches before strength counts',
        hint: 'The bonus starts once all four players have played this many matches.',
        min: 0,
        step: 1,
      },
      {
        key: 'strength_win_factor',
        label: 'Strength factor: win',
        hint: 'Share of the strength bonus the winners get (0 to 1).',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        key: 'strength_draw_factor',
        label: 'Strength factor: draw',
        hint: 'Share applied on a draw (0 to 1).',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        key: 'strength_loss_factor',
        label: 'Strength factor: loss',
        hint: 'Share applied to the losing team (0 to 1).',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: 'Pairing',
    fields: [
      {
        key: 'balance_tolerance',
        label: 'Balance tolerance',
        hint: 'Imbalance the pairing may accept to avoid repeat matchups. 0.2 is 20% looser, 0 is strict.',
        min: 0,
        max: 2,
        step: 0.1,
      },
      {
        key: 'teammate_repeat_weight',
        label: 'Teammate repeat weight',
        hint: 'How strongly repeated partners are penalised. Higher means more varied pairings.',
        min: 0,
        step: 0.1,
      },
      {
        key: 'opponent_repeat_weight',
        label: 'Opponent repeat weight',
        hint: 'How strongly repeated opponents are penalised.',
        min: 0,
        step: 0.1,
      },
      {
        key: 'repeat_decay',
        label: 'Repeat decay',
        hint: 'Old repeats count less than recent ones. Higher fades them faster, 0 is off.',
        min: 0,
        step: 0.1,
      },
      {
        key: 'partner_balance_weight',
        label: 'Partner balance weight',
        hint: 'Penalises partners with very different skill levels. 0 is off.',
        min: 0,
        step: 0.1,
      },
    ],
  },
];

// `fixedTeams` hides the partner balance weight: it only matters when partners are paired every round.
export function MexicanoOptionFields({
  value,
  onChange,
  fixedTeams = false,
}: {
  value: MexicanoOptions;
  onChange: (next: MexicanoOptions) => void;
  fixedTeams?: boolean;
}) {
  useLocale();
  return (
    <Stack gap="lg">
      <NumberInput
        label={tx('Skill gap limit')}
        description={tx(
          'Largest rank distance allowed inside a team. Empty uses a snake draft with no limit.',
        )}
        min={0}
        allowDecimal={false}
        placeholder={tx('No limit')}
        value={value.skill_gap}
        onChange={(v) => onChange({ ...value, skill_gap: v === '' ? '' : Number(v) })}
      />
      {GROUPS.map((group) => (
        <Stack key={group.title} gap="xs">
          <Text variant="eyebrow">{tx(group.title)}</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
            {group.fields
              .filter((f) => !(fixedTeams && f.key === 'partner_balance_weight'))
              .map((f) => (
                <NumberInput
                  key={f.key}
                  label={tx(f.label)}
                  description={tx(f.hint)}
                  min={f.min}
                  max={f.max}
                  step={f.step}
                  value={value[f.key]}
                  onChange={(v) => onChange({ ...value, [f.key]: v === '' ? 0 : Number(v) })}
                />
              ))}
          </SimpleGrid>
        </Stack>
      ))}
    </Stack>
  );
}
