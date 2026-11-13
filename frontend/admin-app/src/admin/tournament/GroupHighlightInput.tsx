import { NumberInput, Stack } from '@mantine/core';
import { useDebouncedCallback } from '@mantine/hooks';
import { t as tx, useLocale } from '../../i18n';
import { MutationError } from '../../ui';
import { useTvPatch } from '../settings/ScoringSection';

// How many places one group's table marks, set under that group's standings. Groups of different
// sizes can mark different counts; a group without its own value uses the tournament default.
export function GroupHighlightInput({
  tid,
  group,
  value,
}: {
  tid: string;
  group: string;
  value: number;
}) {
  useLocale();
  const patch = useTvPatch(tid);
  const save = useDebouncedCallback((next: number) => {
    if (next !== value) patch.mutate({ highlight_places_by_group: { [group]: next } });
  }, 500);
  return (
    <Stack gap={4}>
      <NumberInput
        size="xs"
        w={180}
        label={tx('Highlighted places in this group')}
        min={0}
        max={32}
        allowDecimal={false}
        allowNegative={false}
        clampBehavior="strict"
        defaultValue={value}
        onChange={(v) => {
          if (typeof v === 'number') save(v);
        }}
      />
      <MutationError error={patch.error} />
    </Stack>
  );
}
