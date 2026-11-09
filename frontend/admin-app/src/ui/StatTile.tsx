import type { ReactNode } from 'react';
import { Stack, Text } from '@mantine/core';

// A number with a label. Numbers use the scoreboard face.
export function StatTile({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <Stack gap={2} data-testid={testId}>
      <Text variant="eyebrow">{label}</Text>
      <Text variant="score">{value}</Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Stack>
  );
}
