import { Badge, Group, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import type { FormResult } from '../stats';

const BADGE: Record<
  FormResult,
  { color: string; variant: string; name: () => string; letter: () => string }
> = {
  W: {
    color: 'green',
    variant: 'filled',
    name: () => tx('Win'),
    letter: () => tx('W', { context: 'result' }),
  },
  L: {
    color: 'red',
    variant: 'light',
    name: () => tx('Loss'),
    letter: () => tx('L', { context: 'result' }),
  },
  D: { color: 'gray', variant: 'light', name: () => tx('Draw'), letter: () => tx('D') },
};

// The last results as W / L / D badges (the same letters as the Played list). `form` is newest first;
// the badges read oldest to newest, like the rating chart beside them, so the newest sits on the right.
export function FormGuide({ form }: { form: FormResult[] }) {
  useLocale();
  if (!form.length) return null;
  return (
    <Group gap={6} role="list" aria-label={tx('Recent form, oldest to newest')}>
      <Text variant="eyebrow" mr={4}>
        {tx('Form')}
      </Text>
      {form
        .slice()
        .reverse()
        .map((r, i) => (
          <Badge
            key={i}
            role="listitem"
            circle
            size="lg"
            color={BADGE[r].color}
            variant={BADGE[r].variant}
            aria-label={BADGE[r].name()}
          >
            {BADGE[r].letter()}
          </Badge>
        ))}
    </Group>
  );
}
