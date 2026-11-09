import type { ReactNode } from 'react';
import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconCreditCard, IconMail } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { t as tx, useLocale } from '../../../i18n';
import { money } from '../../../api';
import { playerApi } from '../../../player/api';
import type { HubPayment, Profile } from '../../../player/types';
import classes from '../Player.module.css';

// `enabled` is false while there is no session (or the e-mail link is still being exchanged): the call
// needs the profile token and would only come back 401.
export const usePayments = (enabled = true) =>
  useQuery({
    queryKey: ['player', 'payments'],
    queryFn: () => playerApi<HubPayment[]>('/player-profile/payments'),
    refetchInterval: 30_000,
    enabled,
  });

export const dueOf = (payments: HubPayment[] | undefined) =>
  (payments ?? []).filter((p) => p.status === 'unpaid');

function Todo({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  action: ReactNode;
}) {
  return (
    <Card p="sm" className={classes.todoCard} data-testid="todo-card">
      <Stack gap={6} h="100%" justify="space-between">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          {icon}
          <div>
            <Text fw={650} size="sm">
              {title}
            </Text>
            {children && (
              <Text size="xs" c="dimmed">
                {children}
              </Text>
            )}
          </div>
        </Group>
        {action}
      </Stack>
    </Card>
  );
}

// Only things the player can act on appear here: verify the email, pay. Install lives in the top
// bar and the phone More menu. (Linking an event is the empty state of the tournaments section.)
// A pending score to confirm shows on its tournament card instead.
export function TodoCards({ profile }: { profile: Profile }) {
  useLocale();
  const payments = usePayments();
  const due = dueOf(payments.data);
  const verify = useMutation({
    mutationFn: () => playerApi('/player-profile/resend-verification', {}, 'POST'),
    onSuccess: () =>
      notifications.show({
        message: tx('Verification email requested. Check your inbox.'),
        color: 'green',
      }),
  });
  const cards: ReactNode[] = [];
  if (!profile.email_verified)
    cards.push(
      <Todo
        key="verify"
        icon={<IconMail size={20} aria-hidden />}
        title={tx('Verify your email')}
        action={
          <Button
            size="compact-md"
            variant="light"
            loading={verify.isPending}
            onClick={() => verify.mutate()}
          >
            {tx('Resend verification')}
          </Button>
        }
      >
        {tx('Verify your email to connect entries registered with this address.')}
      </Todo>,
    );
  if (due.length)
    cards.push(
      <Todo
        key="pay"
        icon={<IconCreditCard size={20} aria-hidden />}
        title={tx('Payment due')}
        action={
          <Button component={Link} to="/player/me#payments" size="compact-md" variant="light">
            {tx('Pay or report')}
          </Button>
        }
      >
        {due.map((p) => `${p.entity_name}: ${money(p.amount_cents, p.currency)}`).join(' · ')}
      </Todo>,
    );
  if (!cards.length) return null;
  return (
    <Stack gap="xs">
      <Text variant="eyebrow">{tx('To do')}</Text>
      <div className={classes.todoRow}>{cards}</div>
    </Stack>
  );
}
