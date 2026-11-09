import { Badge, type BadgeProps } from '@mantine/core';

export type StatusTone = 'live' | 'info' | 'warning' | 'danger' | 'success' | 'neutral';

const COLORS: Record<StatusTone, string> = {
  // In progress: a pill tinted with the text color (theme color `ink`, defined in the css variable
  // resolver); the status text carries the meaning and no sport hue is borrowed.
  live: 'ink',
  info: 'court',
  warning: 'yellow',
  danger: 'red',
  success: 'green',
  neutral: 'gray',
};

export interface StatusBadgeProps extends Omit<BadgeProps, 'color' | 'variant'> {
  tone?: StatusTone;
  /** `light` (a plain text pill, no dot) for a state, `outline` for an attribute (Walkover, format override). */
  variant?: 'outline' | 'light';
}

// One badge for every state. Sentence case, no uppercase micro-labels.
export function StatusBadge({ tone = 'neutral', variant = 'light', ...props }: StatusBadgeProps) {
  return <Badge color={COLORS[tone]} variant={variant} {...props} />;
}
