import { Alert, type AlertProps } from '@mantine/core';
import type { StatusTone } from './StatusBadge';

export type NoticeTone = Exclude<StatusTone, 'live'>;

const COLORS: Record<NoticeTone, string> = {
  info: 'court',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  neutral: 'gray',
};

export interface NoticeProps extends Omit<AlertProps, 'color' | 'variant'> {
  tone?: NoticeTone;
}

// One notice for every inline message, with the same fixed tones as StatusBadge. Use it for text
// that needs attention or action; a repeated state belongs in a StatusBadge instead.
export function Notice({ tone = 'info', ...props }: NoticeProps) {
  return <Alert color={COLORS[tone]} {...props} />;
}
