import { Alert, type AlertProps } from '@mantine/core';
import { IconAlertCircle, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import type { StatusTone } from './StatusBadge';

export type NoticeTone = Exclude<StatusTone, 'live'>;

const COLORS: Record<NoticeTone, string> = {
  info: 'court',
  success: 'green',
  warning: 'yellow',
  danger: 'red',
  neutral: 'gray',
};

// Tones that carry meaning get an icon, so the state reads without color. Info and neutral stay
// plain; a caller's own `icon` always wins, and `icon={null}` drops it.
const ICONS: Partial<Record<NoticeTone, ReactNode>> = {
  success: <IconCircleCheck size={18} />,
  warning: <IconAlertTriangle size={18} />,
  danger: <IconAlertCircle size={18} />,
};

export interface NoticeProps extends Omit<AlertProps, 'color' | 'variant'> {
  tone?: NoticeTone;
}

// One notice for every inline message, with the same fixed tones as StatusBadge. Use it for text
// that needs attention or action; a repeated state belongs in a StatusBadge instead.
export function Notice({ tone = 'info', icon, ...props }: NoticeProps) {
  return (
    <Alert
      color={COLORS[tone]}
      icon={icon === undefined ? ICONS[tone] : (icon ?? undefined)}
      role={tone === 'danger' ? 'alert' : undefined}
      data-tone={tone}
      {...props}
    />
  );
}
