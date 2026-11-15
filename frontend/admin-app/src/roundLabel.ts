import { t as tx } from './i18n';

// The engine stores English round names on each match. Each literal stays a tx() call so the
// catalog check sees it. Keep this list in step with backend/tournaments/playoff.py and group_stage.py.
const FIXED: Record<string, () => string> = {
  Final: () => tx('Final'),
  'Semi-Final': () => tx('Semi-Final'),
  'Quarter-Final': () => tx('Quarter-Final'),
  '3rd Place': () => tx('3rd Place'),
  'Grand Final': () => tx('Grand Final'),
  'Grand Final Reset': () => tx('Grand Final Reset'),
  'Super Final': () => tx('Super Final'),
  'Round of 16': () => tx('Round of 16'),
  'Round of 32': () => tx('Round of 32'),
  'Round of 64': () => tx('Round of 64'),
  'Round of 128': () => tx('Round of 128'),
};

/** Display name of an engine round label. Unknown labels are shown unchanged; never use the result as a key. */
export function formatRoundLabel(label: string): string {
  const fixed = FIXED[label];
  if (fixed) return fixed();
  let match = /^Winners R(\d+)$/.exec(label);
  if (match) return tx('Winners R{n}', { n: match[1] });
  match = /^Losers R(\d+)$/.exec(label);
  if (match) return tx('Losers R{n}', { n: match[1] });
  match = /^Round (\d+)$/.exec(label);
  if (match) return tx('Round {round}', { round: match[1] });
  match = /^Group (.+) R(\d+)$/.exec(label);
  if (match) return tx('Group {name} R{n}', { name: match[1], n: match[2] });
  match = /^Group (.+)$/.exec(label);
  if (match) return tx('Group {name}', { name: match[1] });
  return label;
}

/**
 * Label of a match that has no court yet. The court queue does not follow round numbers, so a
 * number (`Group A R3`, `Round 2`, `Winners R1`) would mislead: the group name stays, a bare
 * number gives nothing. Names such as `Semi-Final` carry no order and stay.
 */
export function queueRoundLabel(label: string): string | null {
  const group = /^Group (.+) R\d+$/.exec(label);
  if (group) return tx('Group {name}', { name: group[1] });
  if (/^(Round \d+|Winners R\d+|Losers R\d+)$/.test(label)) return null;
  return formatRoundLabel(label);
}
