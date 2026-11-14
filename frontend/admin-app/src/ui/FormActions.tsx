import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { Button } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { t as tx, useLocale } from '../i18n';
import classes from './FormActions.module.css';

/** The one action row under a form or inside a dialog.
 *  - children: the primary button(s), on the right. The first child is the main action: it comes
 *    first in the DOM (Tab goes last field -> Save) and is drawn rightmost.
 *  - onCancel: adds a Cancel button left of the primaries.
 *  - start: a destructive or tertiary action on the left (below the primaries on phones).
 *  - sticky: the row stays in view at the bottom of a scrolling sheet or dialog.
 *  On phones every button is touch-sized and the primaries share the row in equal widths. */
export function FormActions({
  start,
  onCancel,
  cancelLabel,
  cancelDisabled,
  sticky = false,
  children,
  'data-testid': testId,
}: {
  start?: ReactNode;
  onCancel?: () => void;
  cancelLabel?: string;
  cancelDisabled?: boolean;
  sticky?: boolean;
  children?: ReactNode;
  'data-testid'?: string;
}) {
  useLocale();
  const phone = !!useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const size = phone ? 'touch' : undefined;
  const sized = (nodes: ReactNode) =>
    Children.map(nodes, (child) => {
      // Only plain Mantine buttons get the touch size; text and custom controls stay as they are.
      if (!isValidElement(child) || child.type !== Button) return child;
      const element = child as ReactElement<{ size?: string }>;
      return element.props.size === undefined && size ? cloneElement(element, { size }) : element;
    });
  return (
    <div
      className={sticky ? `${classes.root} ${classes.sticky}` : classes.root}
      data-testid={testId}
    >
      {(children || onCancel) && (
        <div className={classes.end}>
          {sized(children)}
          {onCancel && (
            <Button variant="default" size={size} onClick={onCancel} disabled={cancelDisabled}>
              {cancelLabel ?? tx('Cancel')}
            </Button>
          )}
        </div>
      )}
      {start && <div className={classes.start}>{sized(start)}</div>}
    </div>
  );
}
