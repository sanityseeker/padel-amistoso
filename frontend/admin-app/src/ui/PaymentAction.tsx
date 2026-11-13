import { Button } from '@mantine/core';
import { IconChevronRight, IconCreditCard } from '@tabler/icons-react';
import classes from './PaymentAction.module.css';

export type PaymentTone = 'due' | 'waiting' | 'refund';

const COLOR: Record<PaymentTone, string> = { due: 'yellow', waiting: 'gray', refund: 'court' };

export interface PaymentActionProps {
  tone: PaymentTone;
  label: string;
  onClick: () => void;
  size?: 'compact-sm' | 'compact-md' | 'md';
  fullWidth?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
  'data-status'?: string;
}

/** The control that opens a payment sheet: a button with a card icon and a chevron, so it reads as tappable. */
export function PaymentAction({
  tone,
  label,
  onClick,
  size = 'compact-sm',
  fullWidth,
  ...rest
}: PaymentActionProps) {
  return (
    <Button
      {...rest}
      variant="light"
      radius="xl"
      color={COLOR[tone]}
      size={size}
      fullWidth={fullWidth}
      className={classes.action}
      leftSection={<IconCreditCard size={16} aria-hidden />}
      rightSection={<IconChevronRight size={14} aria-hidden />}
      aria-haspopup="dialog"
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
