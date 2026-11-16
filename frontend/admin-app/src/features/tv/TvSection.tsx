import { useState, type ReactNode } from 'react';
import { Box, Collapse, Group, Paper, Title, UnstyledButton } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import classes from './Tv.module.css';

// ---- Section open state, remembered per tournament (the legacy `padel-tv-sections-<tid>` key) --------

const readOpen = (key: string): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
};

/** `prefix` names the screen: the TV page keeps `padel-tv-sections`, the Hub event page its own. */
export function useOpenState(tid: string, prefix = 'padel-tv-sections') {
  const key = `${prefix}-${tid}`;
  const [held, setHeld] = useState(() => ({ key, map: readOpen(key) }));
  // The tournament id arrives after the first render: read its stored choices once it is known.
  const state = held.key === key ? held.map : readOpen(key);
  return {
    isOpen: (id: string, fallback = true) => (id in state ? state[id] : fallback),
    toggle: (id: string, fallback = true) =>
      store({ ...state, [id]: !(id in state ? state[id] : fallback) }),
    open: (id: string) => {
      if (state[id] === false) store({ ...state, [id]: true });
    },
  };
  function store(next: Record<string, boolean>) {
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* The choice still applies to this visit. */
    }
    setHeld({ key, map: next });
  }
}
export type OpenState = ReturnType<typeof useOpenState>;

export function Section({
  id,
  title,
  state,
  info,
  children,
  fallback = true,
}: {
  id: string;
  title: string;
  state: OpenState;
  info?: ReactNode;
  children: ReactNode;
  fallback?: boolean;
}) {
  const open = state.isOpen(id, fallback);
  return (
    <Paper
      p={{ base: 'sm', sm: 'lg' }}
      component="section"
      data-testid="tv-section"
      data-section={id}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <UnstyledButton
          aria-expanded={open}
          onClick={() => state.toggle(id, fallback)}
          flex={1}
          miw={0}
        >
          <Group gap="xs" wrap="nowrap">
            <IconChevronRight
              size={20}
              style={{ transform: open ? 'rotate(90deg)' : undefined, flexShrink: 0 }}
              aria-hidden
            />
            <Title order={2} className={classes.sectionTitle}>
              {title}
            </Title>
          </Group>
        </UnstyledButton>
        {info}
      </Group>
      <Collapse expanded={open}>
        <Box pt="md">{children}</Box>
      </Collapse>
    </Paper>
  );
}
