import { useState } from 'react';
import { Button, Group } from '@mantine/core';
import { IconCreditCard } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { t as tx, useLocale } from '../../i18n';
import { playerApi } from '../../player/api';
import { PaymentSheet, type PaymentAdapter } from '../payments/OwnPaymentCard';
import type { PaymentInfo } from '../register/model';
import type { PayableTeammate } from '../../ui/AlsoPaidFor';
import type { TvSession } from './useTvPlayer';

/** The signed-in player's own payment (the tournament token only, never the organizer or Hub token). */
export function useTvPayment(tid: string | undefined, session: TvSession | null) {
  return useQuery({
    queryKey: ['player', 'tv-payment', tid, session?.playerId],
    enabled: !!tid && !!session,
    retry: false,
    queryFn: () =>
      playerApi<PaymentInfo | null>(
        `/tournaments/${encodeURIComponent(tid!)}/player/payment`,
        undefined,
        'GET',
        session!.jwt,
      ),
  });
}

// A small button for a signed-in player whose entry fee is open (unpaid or reported). It opens the
// payment sheet. Paid, waived, refunded, no fee and spectators: nothing at all.
export function TvPaymentButton({ tid, session }: { tid: string; session: TvSession | null }) {
  useLocale();
  const client = useQueryClient();
  const [opened, setOpened] = useState(false);
  const payment = useTvPayment(tid, session);
  const data = payment.data;
  if (!session || !data || (data.status !== 'unpaid' && data.status !== 'reported')) return null;
  const path = `/tournaments/${encodeURIComponent(tid)}/player/payment`;
  const adapter: PaymentAdapter = {
    key: `${tid}:${session.playerId}`,
    loadTeammates: () =>
      playerApi<PayableTeammate[]>(`${path}/teammates`, undefined, 'GET', session.jwt),
    report: (input) => playerApi<PaymentInfo>(`${path}/report`, input, 'POST', session.jwt),
  };
  return (
    <Group justify="center">
      <Button
        variant="light"
        color={data.status === 'unpaid' ? 'yellow' : 'gray'}
        size="compact-md"
        leftSection={<IconCreditCard size={16} aria-hidden />}
        onClick={() => setOpened(true)}
        data-testid="tv-payment-button"
        data-status={data.status}
      >
        {data.status === 'unpaid' ? tx('Entry fee: pay') : tx('Payment reported')}
      </Button>
      <PaymentSheet
        opened={opened}
        onClose={() => setOpened(false)}
        payment={data}
        adapter={adapter}
        onChange={(next) =>
          client.setQueryData(['player', 'tv-payment', tid, session.playerId], next)
        }
      />
    </Group>
  );
}
