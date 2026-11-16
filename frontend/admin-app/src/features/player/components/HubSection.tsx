import type { ReactNode } from 'react';
import { Box, Collapse, Group, Stack, Title, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import type { OpenState } from '../../tv/TvSection';

/** A section of the Hub event page whose heading folds it away. Open by default; the choice is
 * remembered per tournament (`useOpenState(tid, 'padel-hub-sections')`). `aside` sits at the end of
 * the heading row and stays visible when the section is folded. */
export function HubSection({
  section,
  title,
  state,
  aside,
  order = 2,
  id,
  testId,
  children,
}: {
  section: string;
  title: string;
  state: OpenState;
  aside?: ReactNode;
  order?: 2 | 3;
  id?: string;
  testId?: string;
  children: ReactNode;
}) {
  const open = state.isOpen(section);
  return (
    <Stack gap={0} id={id} component="section" data-section={section} data-testid={testId}>
      <Group justify="space-between" align="center" gap="xs" wrap="nowrap">
        <UnstyledButton aria-expanded={open} onClick={() => state.toggle(section)} flex={1} miw={0}>
          <Group gap={6} wrap="nowrap">
            <IconChevronRight
              size={18}
              style={{
                transform: open ? 'rotate(90deg)' : undefined,
                transition: 'transform 150ms ease',
                flexShrink: 0,
              }}
              aria-hidden
            />
            <Title order={order}>{title}</Title>
          </Group>
        </UnstyledButton>
        {aside}
      </Group>
      <Collapse expanded={open}>
        <Box pt="sm">{children}</Box>
      </Collapse>
    </Stack>
  );
}
