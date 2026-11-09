import { useRef, useState } from 'react';
import { ActionIcon, Button, Group, NumberInput } from '@mantine/core';
import { IconAdjustmentsHorizontal, IconCheck } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';
import { validatePoints, type ScorePayload, type SetRow } from '../../admin/tournament/scoring';

// Two score boxes and a Save button inside a pending match row, for matches scored in points
// (desktop). Enter in the first box moves to the second; Enter in the second saves only when both
// boxes hold a valid score, so a stray Enter cannot save half a row. Sets, tie-breaks, per-match
// formats and clearing stay in the full editor behind the options button.
export function QuickScore({
  names,
  total,
  onSave,
  onMore,
}: {
  names: [string, string];
  /** Points must add up to this (0 = no rule). */
  total: number;
  onSave: (payload: ScorePayload) => void;
  onMore: () => void;
}) {
  useLocale();
  const [boxes, setBoxes] = useState<SetRow>(['', '']);
  const [invalid, setInvalid] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (side: 0 | 1, raw: string) => {
    const next: SetRow = [...boxes];
    next[side] = raw;
    if (total > 0 && raw !== '') next[side ? 0 : 1] = String(Math.max(0, total - Number(raw)));
    setBoxes(next);
    setInvalid(false);
  };
  const error = validatePoints(boxes, total);
  const save = () => {
    if (error) {
      setInvalid(true);
      refs.current[boxes[0] === '' ? 0 : 1]?.focus();
      return;
    }
    onSave({ kind: 'points', score: [Number(boxes[0]), Number(boxes[1])] });
  };
  return (
    <Group gap={6} wrap="nowrap" data-testid="quick-score">
      {([0, 1] as const).map((side) => (
        <NumberInput
          key={side}
          ref={(el) => {
            refs.current[side] = el;
          }}
          w={64}
          size="md"
          hideControls
          inputMode="numeric"
          min={0}
          max={99}
          allowDecimal={false}
          allowNegative={false}
          clampBehavior="strict"
          placeholder="0"
          enterKeyHint={side ? 'done' : 'next'}
          aria-label={tx('Score: {name}', { name: names[side] })}
          data-testid={`quick-score-${side + 1}`}
          data-score-action={side === 0 ? '' : undefined}
          error={invalid && (boxes[side] === '' || (total > 0 && !!error))}
          value={boxes[side]}
          onChange={(v) => set(side, v === '' ? '' : String(v))}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (side === 0) refs.current[1]?.focus();
            else save();
          }}
        />
      ))}
      <Button
        size="md"
        variant="light"
        color="court"
        leftSection={<IconCheck size={16} />}
        disabled={!!error}
        data-testid="quick-score-save"
        aria-label={tx('Save result: {names}', { names: names.join(' vs ') })}
        onClick={save}
      >
        {tx('Save')}
      </Button>
      <ActionIcon
        size="lg"
        variant="subtle"
        color="gray"
        aria-label={tx('More scoring options: {names}', { names: names.join(' vs ') })}
        onClick={onMore}
      >
        <IconAdjustmentsHorizontal size={18} />
      </ActionIcon>
    </Group>
  );
}
