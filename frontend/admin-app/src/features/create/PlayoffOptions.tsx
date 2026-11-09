import { Select, Stack, Switch, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';
import { bracketMatches, winnerOptions, type BracketFormat } from './rules';

export interface PlayoffChoice {
  doubleElimination: boolean;
  espejo: boolean;
  winners: number;
  thirdPlace: boolean;
}
export const PLAYOFF_DEFAULTS: PlayoffChoice = {
  doubleElimination: false,
  espejo: false,
  winners: 1,
  thirdPlace: false,
};

export const formatOf = (c: PlayoffChoice): BracketFormat =>
  c.espejo ? 'espejo' : c.doubleElimination ? 'double' : 'single';

/** The winner and 3rd-place choices that are valid for `n` teams and the chosen format. */
export function effectiveChoice(c: PlayoffChoice, n: number) {
  const format = formatOf(c);
  const single = format === 'single';
  const canThird = (single || format === 'espejo') && n >= 4;
  const options = single ? winnerOptions(n) : winnerOptions(1);
  const winners = single && options.some((o) => o.value === c.winners) ? c.winners : 1;
  const thirdPlace = canThird && (winners === 3 || (winners === 1 && c.thirdPlace));
  return { format, single, canThird, options, winners, thirdPlace };
}

// Bracket shape for a direct play-off (and the play-off of a group stage): double elimination, the
// mirror ("Espejo") bracket, how many winners, and a 3rd-place match. Mirrors the rules the API checks.
export function PlayoffOptions({
  value,
  onChange,
  teams,
  allowDouble = true,
  allowEspejo = true,
}: {
  value: PlayoffChoice;
  onChange: (next: PlayoffChoice) => void;
  /** Number of bracket entries (teams or players). */
  teams: number;
  allowDouble?: boolean;
  allowEspejo?: boolean;
}) {
  useLocale();
  const e = effectiveChoice(value, teams);
  return (
    <Stack gap="sm">
      {allowDouble && (
        <Switch
          label={tx('Double elimination')}
          checked={value.doubleElimination}
          onChange={(ev) =>
            onChange({
              ...value,
              doubleElimination: ev.currentTarget.checked,
              espejo: ev.currentTarget.checked ? false : value.espejo,
            })
          }
        />
      )}
      {allowEspejo && (
        <Switch
          label={tx('Espejo (winners + consolation bracket)')}
          checked={value.espejo}
          onChange={(ev) =>
            onChange({
              ...value,
              espejo: ev.currentTarget.checked,
              doubleElimination: ev.currentTarget.checked ? false : value.doubleElimination,
            })
          }
        />
      )}
      {e.single && (
        <Select
          label={tx('Number of winners')}
          description={tx(
            'Winners share the top result; there is no ranking among them. Single elimination only.',
          )}
          allowDeselect={false}
          data={e.options.map((o) => ({ value: String(o.value), label: o.label }))}
          value={String(e.winners)}
          onChange={(v) => onChange({ ...value, winners: Number(v) || 1 })}
        />
      )}
      {e.canThird && (e.winners === 1 || e.winners === 3) && (
        <Switch
          label={tx('3rd-place match')}
          checked={e.thirdPlace}
          disabled={e.winners === 3}
          onChange={(ev) => onChange({ ...value, thirdPlace: ev.currentTarget.checked })}
        />
      )}
      {teams >= 2 && (
        <Text size="sm" c="dimmed">
          {tx('About {n} matches', {
            n: bracketMatches(teams, e.format, e.winners, e.thirdPlace),
          })}
        </Text>
      )}
    </Stack>
  );
}
