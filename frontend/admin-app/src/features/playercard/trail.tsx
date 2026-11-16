import { useEffect, useState } from 'react';
import { Button } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { t as tx, useLocale } from '../../i18n';

/**
 * The cards opened from names inside a card, newest last. A new opening (`reset` changes) starts
 * over; Back returns to the card the name was tapped on.
 */
export function useTrail<T>(reset: unknown) {
  const [trail, setTrail] = useState<T[]>([]);
  useEffect(() => setTrail([]), [reset]);
  return {
    items: trail,
    top: trail.length ? trail[trail.length - 1]! : null,
    open: (item: T) => setTrail((t) => [...t, item]),
    back: () => setTrail((t) => t.slice(0, -1)),
  };
}

export function BackButton({ onClick }: { onClick: () => void }) {
  useLocale();
  return (
    <Button
      variant="subtle"
      size="compact-sm"
      leftSection={<IconArrowLeft size={16} />}
      onClick={onClick}
      style={{ alignSelf: 'flex-start' }}
      data-testid="card-back"
    >
      {tx('Back')}
    </Button>
  );
}
