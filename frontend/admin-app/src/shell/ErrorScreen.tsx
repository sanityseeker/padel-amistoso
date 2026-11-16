import type { ReactNode } from 'react';
import { Group, Stack, Title } from '@mantine/core';
import { PageContainer } from '../ui/PageContainer';
import classes from './ErrorScreen.module.css';

// The shared layout of the full-page error screens (not found, crashed page): centered art or icon,
// a headline, a short explanation and the way out.
export function ErrorScreen({
  art,
  icon,
  title,
  children,
  actions,
}: {
  art?: { src: string; alt: string };
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <PageContainer size="sm">
      <Stack className={classes.screen}>
        {art && <img className={classes.art} src={art.src} alt={art.alt} />}
        {icon && (
          <div className={classes.badge} aria-hidden>
            {icon}
          </div>
        )}
        <Title order={2}>{title}</Title>
        <Stack gap={6} align="center" className={classes.text}>
          {children}
        </Stack>
        {actions && <Group className={classes.actions}>{actions}</Group>}
      </Stack>
    </PageContainer>
  );
}

export const errorScreenClasses = classes;
