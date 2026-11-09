import { Badge, Group, Text } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';

// The last results as W / L badges, newest first.
export function FormGuide({ form }: { form: ('W' | 'L')[] }) {
  useLocale();
  if (!form.length) return null;
  return (
    <Group gap={6} role="list" aria-label={tx('Recent form')}>
      <Text variant="eyebrow" mr={4}>
        {tx('Form')}
      </Text>
      {form.map((r, i) => (
        <Badge
          key={i}
          role="listitem"
          circle
          size="lg"
          color={r === 'W' ? 'green' : 'red'}
          variant={r === 'W' ? 'filled' : 'light'}
          aria-label={r === 'W' ? tx('Win') : tx('Loss')}
        >
          {r === 'W' ? tx('W') : tx('L')}
        </Badge>
      ))}
    </Group>
  );
}
