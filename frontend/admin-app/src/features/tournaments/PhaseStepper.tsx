import { Group, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../i18n';

export type PhaseKind = 'mexicano' | 'group_playoff' | 'playoff';

export const PHASE_STEPS: Record<PhaseKind, string[]> = {
  mexicano: ['Rounds', 'Play-offs', 'Finished'],
  group_playoff: ['Group stage', 'Play-offs', 'Finished'],
  playoff: ['Play-offs', 'Finished'],
};

/** Index of the step a phase belongs to (`finished` is always the last step). */
export function phaseIndex(type: PhaseKind, phase: string): number {
  const steps = PHASE_STEPS[type];
  if (phase === 'finished') return steps.length - 1;
  if (phase === 'playoffs') return type === 'playoff' ? 0 : 1;
  return 0;
}

// Where a tournament is, as one inline line: "Groups > Play-offs > Finished" with the current step bold.
export function PhaseStepper({ type, phase }: { type: PhaseKind; phase: string }) {
  useLocale();
  const steps = PHASE_STEPS[type];
  const active = phaseIndex(type, phase);
  return (
    <Group gap={6} wrap="nowrap" role="list" aria-label={tx('Tournament phase')}>
      {steps.map((label, i) => (
        <Group key={label} gap={6} wrap="nowrap" role="listitem">
          {i > 0 && (
            <Text span c="dimmed" size="xs" aria-hidden>
              →
            </Text>
          )}
          <Text
            span
            size="xs"
            fw={i === active ? 800 : 500}
            c={i === active ? undefined : 'dimmed'}
            aria-current={i === active ? 'step' : undefined}
            style={{ whiteSpace: 'nowrap' }}
          >
            {tx(label)}
          </Text>
        </Group>
      ))}
    </Group>
  );
}
