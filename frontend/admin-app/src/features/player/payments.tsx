import { useState } from 'react';
import { Text, UnstyledButton } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import { playerApi } from '../../player/api';
import type { Entry, HubPayment } from '../../player/types';
import { PaymentSheet, type PaymentAdapter } from '../payments/OwnPaymentCard';
import type { PayableTeammate } from '../../ui/AlsoPaidFor';
import { StatusBadge } from '../../ui/StatusBadge';

// `enabled` is false while there is no session (or the e-mail link is still being exchanged): the call
// needs the profile token and would only come back 401.
// `only` (on a club subdomain, the club's own entries) keeps the payments of those events alone:
// the endpoint lists every event of the profile.
// The list holds the open payments only: unpaid, reported and refund due.
export const usePayments = (enabled = true, only?: Entry[] | null) => {
  const query = useQuery({
    queryKey: ['player', 'payments'],
    queryFn: () => playerApi<HubPayment[]>('/player-profile/payments'),
    refetchInterval: 30_000,
    enabled,
  });
  if (!only || !query.data) return query;
  const keep = new Set(only.map((e) => `${e.entity_type}:${e.entity_id}`));
  return {
    ...query,
    data: query.data.filter((p) => keep.has(`${p.entity_type}:${p.entity_id}`)),
  } as typeof query;
};

/** The Hub key of one entry's payment (`t:<tournament>:<player>` or `r:<lobby>:<player>`). */
export const paymentKey = (entry: Pick<Entry, 'entity_type' | 'entity_id' | 'player_id'>) =>
  `${entry.entity_type === 'tournament' ? 't' : 'r'}:${entry.entity_id}:${entry.player_id}`;

/**
 * The open payment an entry shows. A lobby converted into several tournaments has one fee per
 * player, listed once: its `entry_keys` name every entry that shows it. The entry's own name is
 * used, so each card badges the same single debt under its own title.
 */
export const openPaymentOf = (
  payments: HubPayment[] | undefined,
  entry: Pick<Entry, 'entity_type' | 'entity_id' | 'player_id' | 'entity_name'>,
): HubPayment | undefined => {
  const key = paymentKey(entry);
  const found = payments?.find((p) => p.key === key || p.entry_keys?.includes(key));
  return found && found.key !== key ? { ...found, entity_name: entry.entity_name } : found;
};

/** The entry's payment while it is open (unpaid, reported or refund due); `undefined` otherwise. */
export const useOpenPayment = (entry: Entry): HubPayment | undefined => {
  const payments = usePayments(!entry.entity_deleted);
  return openPaymentOf(payments.data, entry);
};

const enc = encodeURIComponent;

/** One payment in any status, `null` when the entry owes nothing (no fee). Only asked once the open list lacks it. */
const useSettledPayment = (entry: Entry, enabled: boolean) =>
  useQuery({
    queryKey: ['player', 'payment', paymentKey(entry)],
    enabled: enabled && !entry.entity_deleted,
    retry: false,
    queryFn: async () => {
      try {
        return await playerApi<HubPayment>(`/player-profile/payments/${enc(paymentKey(entry))}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });

/** The badge of an open payment. It opens the payment sheet; a reported payment updates the badge at once. */
export function PaymentBadge({ payment }: { payment: HubPayment }) {
  useLocale();
  const client = useQueryClient();
  const [opened, setOpened] = useState(false);
  const label =
    payment.status === 'unpaid'
      ? tx('Payment due')
      : payment.status === 'reported'
        ? tx('Payment reported')
        : tx('Refund owed to you');
  const tone =
    payment.status === 'unpaid' ? 'warning' : payment.status === 'reported' ? 'neutral' : 'info';
  const path = `/player-profile/payments/${enc(payment.key)}`;
  const adapter: PaymentAdapter = {
    key: payment.key,
    loadTeammates: () => playerApi<PayableTeammate[]>(`${path}/teammates`),
    report: async (input) => {
      await playerApi(`${path}/report`, input, 'POST');
      return playerApi<HubPayment>(path);
    },
  };
  return (
    <>
      <UnstyledButton
        onClick={() => setOpened(true)}
        aria-label={`${label}: ${payment.entity_name}`}
        data-testid="payment-badge"
        data-status={payment.status}
      >
        <StatusBadge tone={tone} size="sm" style={{ cursor: 'pointer' }}>
          {label}
        </StatusBadge>
      </UnstyledButton>
      <PaymentSheet
        opened={opened}
        onClose={() => setOpened(false)}
        payment={payment}
        adapter={adapter}
        onChange={(next) => {
          // The badge follows the new status straight away; the refetch confirms it.
          client.setQueryData<HubPayment[]>(['player', 'payments'], (old) =>
            old?.map((p) =>
              p.key === payment.key
                ? { ...p, status: next.status, reference: next.reference ?? p.reference }
                : p,
            ),
          );
          // Every badge of this fee (a lobby's other tournaments too) refreshes from the list.
          void client.invalidateQueries({ queryKey: ['player', 'payments'] });
          void client.invalidateQueries({ queryKey: ['player', 'payment'] });
          if (next.status === 'reported')
            notifications.show({
              message: tx('Payment reported. Your organizer will confirm it.'),
              color: 'green',
            });
        }}
      />
    </>
  );
}

/** The badge of an entry with an open payment, nothing otherwise. */
export function EntryPaymentBadge({ entry }: { entry: Entry }) {
  const payment = useOpenPayment(entry);
  return payment ? <PaymentBadge payment={payment} /> : null;
}

/** Event page: the badge while the payment is open, one line of text once it is settled. */
export function EntryPaymentStatus({ entry }: { entry: Entry }) {
  useLocale();
  const open = useOpenPayment(entry);
  const payments = usePayments(!entry.entity_deleted);
  const settled = useSettledPayment(entry, payments.isSuccess && !open);
  if (open) return <PaymentBadge payment={open} />;
  const status = settled.data?.status;
  const text =
    status === 'paid'
      ? tx('Entry fee: paid')
      : status === 'waived'
        ? tx('Entry fee: waived')
        : status === 'refunded'
          ? tx('Entry fee: refunded')
          : null;
  return text ? (
    <Text size="sm" c="dimmed" data-testid="payment-settled">
      {text}
    </Text>
  ) : null;
}
