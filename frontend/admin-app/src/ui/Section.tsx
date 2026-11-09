import { createContext, useContext, type ReactNode } from 'react';
import { Group, Paper, Stack, Text, Title } from '@mantine/core';

/** Settings drawers can hide the one-line help of every Section (the "Show help" switch). */
export const SectionHelp = createContext(true);

// A titled block inside a drawer or a page: heading, one line of help, the controls.
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const help = useContext(SectionHelp);
  return (
    <Paper p="md" variant="row">
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2} miw={0}>
            <Title order={3}>{title}</Title>
            {description && help && (
              <Text size="sm" c="dimmed">
                {description}
              </Text>
            )}
          </Stack>
          {actions}
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}
