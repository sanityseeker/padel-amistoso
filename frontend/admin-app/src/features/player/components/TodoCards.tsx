import type { ReactNode } from 'react';
import { Button, Card, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation } from '@tanstack/react-query';
import { IconMail } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../../i18n';
import { playerApi } from '../../../player/api';
import type { Profile } from '../../../player/types';
import classes from '../Player.module.css';

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

// Only things the player can act on appear here: verify the email. Payments show as a badge on the
// event they belong to. Install lives in the top
// bar and the phone More menu. (Linking an event is the empty state of the tournaments section.)
// A pending score to confirm shows on its tournament card instead.
export function TodoCards({ profile }: { profile: Profile }) {
  useLocale();
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
  if (!cards.length) return null;
  return (
    <Stack gap="xs">
      <Text variant="eyebrow">{tx('To do')}</Text>
      <div className={classes.todoRow}>{cards}</div>
    </Stack>
  );
}
