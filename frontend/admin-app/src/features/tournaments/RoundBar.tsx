import { NativeSelect, ScrollArea, SegmentedControl } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';

// Mexicano rounds as one control that is also the round navigation: finished rounds are filled, the
// current round carries a ball-colored ring, and "All" removes the round filter.
export function RoundBar({
  rounds,
  current,
  value,
  onChange,
}: {
  /** Number of rounds that exist so far. */
  rounds: number;
  current: number;
  value: string;
  onChange: (value: string) => void;
}) {
  useLocale();
  if (!rounds) return null;
  const data = [
    { value: 'all', label: tx('All') },
    ...Array.from({ length: rounds }, (_, i) => ({
      value: String(i + 1),
      label: `R${i + 1}`,
    })),
  ];
  // Many rounds collapse into a select; a handful stay one-tap chips.
  if (rounds > 8)
    return (
      <NativeSelect
        size="xs"
        w={96}
        aria-label={tx('Round')}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        data={data.map((d) => ({
          value: d.value,
          label: d.value === String(current) ? `${d.label} •` : d.label,
        }))}
      />
    );
  return (
    <ScrollArea type="never" scrollbars="x" maw="60vw">
      <SegmentedControl
        size="xs"
        value={value}
        onChange={onChange}
        data={data}
        aria-label={tx('Round')}
      />
    </ScrollArea>
  );
}
