import type { ReactNode } from 'react';
import { Alert, Button, Stack, Text } from '@mantine/core';
import { t as tx, useLocale } from '../i18n';
import { FormActions } from './FormActions';
import { ResponsiveSheet } from './ResponsiveSheet';

// The one confirmation dialog for state-advancing or destructive actions. Menus, shortcuts and the
// command palette must open this, never run the action directly.
export function ConfirmAction({
  opened,
  title,
  description,
  confirmLabel,
  cancelLabel,
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
  cancelLabel?: string;
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
        <FormActions onCancel={onClose} cancelLabel={cancelLabel}>
          <Button color={color} loading={loading} onClick={onConfirm}>
            {confirmLabel ?? tx('Continue')}
          </Button>
        </FormActions>
      </Stack>
    </ResponsiveSheet>
  );
}
