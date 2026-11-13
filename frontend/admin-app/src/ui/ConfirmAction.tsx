import type { ReactNode } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../i18n';
import { ResponsiveSheet } from './ResponsiveSheet';

// The one confirmation dialog for state-advancing or destructive actions. Menus, shortcuts and the
// command palette must open this, never run the action directly.
export function ConfirmAction({
  opened,
  title,
  description,
  confirmLabel,
  color,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  opened: boolean;
  title?: string;
  description?: ReactNode;
  confirmLabel?: string;
  color?: string;
  loading?: boolean;
  error?: Error | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useLocale();
  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={title ?? ''}>
      <Stack>
        {error && <Alert color="red">{tx(error.message)}</Alert>}
        {description && (
          <Text size="sm" component="div">
            {description}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" size="touch" onClick={onClose}>
            {tx('Cancel')}
          </Button>
          <Button size="touch" color={color} loading={loading} onClick={onConfirm}>
            {confirmLabel ?? tx('Continue')}
          </Button>
        </Group>
      </Stack>
    </ResponsiveSheet>
  );
}
