import { Button } from '@mantine/core';
import { t as tx, useLocale } from '../../../i18n';
import { EmptyState } from '../../../ui';

export function ActiveEmpty({ onLink }: { onLink: () => void }) {
  useLocale();
  return (
    <EmptyState
      title={tx('No active tournaments')}
      action={
        <Button variant="light" onClick={onLink}>
          {tx('Link an event')}
        </Button>
      }
    >
      {tx('Tournaments you play in appear here with your next match.')}
    </EmptyState>
  );
}
