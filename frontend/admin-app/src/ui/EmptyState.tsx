import type { ReactNode } from 'react';
import { Paper, Stack, Text, Title } from '@mantine/core';
import { useLocale } from '../i18n';

// Replaces the one-line list-row look: a dashed surface, a title, one sentence, at most one action.
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  useLocale();
  return (
    <Paper variant="dashed" p="lg">
      <Stack gap="xs" align="flex-start">
        <Title order={3}>{title}</Title>
        {children && (
          <Text size="sm" c="dimmed" maw="68ch">
            {children}
          </Text>
        )}
        {action}
      </Stack>
    </Paper>
  );
}
