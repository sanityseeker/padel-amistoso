import type { ReactNode } from 'react';
import classes from './ActionBar.module.css';

/** A bar fixed above the phone tab bar for the page's primary action. Its bottom edge follows
 *  `--app-tabs-height` (set by AppLayout, 0 while the tabs are hidden or absent) plus the safe areas.
 *  The page needs `ActionBarSpacer` at its end so the bar never covers content. */
export function ActionBar({
  children,
  'data-testid': testId,
}: {
  children: ReactNode;
  'data-testid'?: string;
}) {
  return (
    <div className={classes.bar} data-testid={testId}>
      {children}
    </div>
  );
}

export function ActionBarSpacer() {
  return <div className={classes.spacer} aria-hidden />;
}
