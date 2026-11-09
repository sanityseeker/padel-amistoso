import type { ReactNode } from 'react';
import { Group, Paper, Stack, Text } from '@mantine/core';
import { Link } from 'react-router-dom';
import { sportProps } from '../theme';
import classes from './EventRow.module.css';

export interface EventRowProps {
  /** Internal route (admin) or external href (public pages). */
  to?: string;
  href?: string;
  title: string;
  /** Second line: club, community, owner. */
  meta?: ReactNode;
  /** Badges and counts under the meta line. */
  badges?: ReactNode;
  /** Right-hand controls (row menu). They must not live inside the link. */
  actions?: ReactNode;
  leading?: ReactNode;
  testId?: string;
  /** Tighter vertical spacing for dense public lists. */
  density?: 'default' | 'compact';
  /** Scopes the sport accent: a 3 px rule on the row's leading edge, blue for padel, green for tennis. */
  sport?: string | null;
}

// The one list row for tournaments, lobbies, clubs, public events and players. The title is the link
// (a real anchor), the actions sit beside it, so keyboard and screen-reader users get one stop per row.
export function EventRow({
  to,
  href,
  title,
  meta,
  badges,
  actions,
  leading,
  testId,
  density = 'default',
  sport,
}: EventRowProps) {
  const link = to
    ? { component: Link, to }
    : href
      ? { component: 'a' as const, href }
      : { component: 'span' as const };
  return (
    <Paper
      variant="row"
      p={density === 'compact' ? 'xs' : 'sm'}
      className={density === 'compact' ? `${classes.row} ${classes.compact}` : classes.row}
      data-testid={testId}
      data-density={density === 'compact' ? 'compact' : undefined}
      {...sportProps(sport)}
    >
      <Group wrap="nowrap" gap={density === 'compact' ? 'xs' : 'sm'} align="flex-start">
        {leading}
        <Stack gap={density === 'compact' ? 2 : 4} flex={1} miw={0}>
          <Text
            {...(link as object)}
            fw={650}
            className={classes.title}
            style={{ overflowWrap: 'anywhere' }}
          >
            {title}
          </Text>
          {meta && (
            <Text size="xs" c="dimmed">
              {meta}
            </Text>
          )}
          {badges && (
            <Group gap={density === 'compact' ? 4 : 6} wrap="wrap">
              {badges}
            </Group>
          )}
        </Stack>
        {actions && <div className={classes.actions}>{actions}</div>}
      </Group>
    </Paper>
  );
}
