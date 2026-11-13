import { useEffect, useState } from 'react';
import { Button, Group, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { useClipboard } from '@mantine/hooks';
import { money } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import { AlsoPaidFor, type PayableTeammate } from '../../ui/AlsoPaidFor';
import { Notice } from '../../ui/Notice';
import { ResponsiveSheet } from '../../ui/ResponsiveSheet';
import { paymentHref, type PaymentInfo } from '../register/model';

/** Where the card reads teammates from and sends "I've paid" to: a lobby, a tournament or the Hub. */
export interface PaymentAdapter {
  /** Identifies the player and the event: the teammate list loads again when it changes. */
  key: string;
  loadTeammates: () => Promise<PayableTeammate[]>;
  report: (input: {
    method: string;
    reference?: string;
    also_for?: string[];
  }) => Promise<PaymentInfo>;
}

export const methodLabel = (m: { kind: string; label?: string | null }) => {
  if (m.label) return m.label;
  const labels: Record<string, string> = {
    bizum: tx('Bizum (phone)'),
    iban: tx('Bank transfer (IBAN)'),
    revolut: tx('Revolut link'),
    paypal_me: tx('PayPal'),
    cash: tx('Cash'),
  };
  return labels[m.kind] ?? tx('Other');
};

/** The method kinds a player can pick: the organizer's own methods, or every kind when none is shown. */
const ALL_KINDS = ['bizum', 'iban', 'revolut', 'paypal_me', 'cash', 'other'];
const methodOptions = (methods: PaymentInfo['methods']) => {
  const seen = new Map<string, string>();
  for (const m of methods) if (!seen.has(m.kind)) seen.set(m.kind, methodLabel(m));
  if (!seen.size) for (const kind of ALL_KINDS) seen.set(kind, methodLabel({ kind }));
  return [...seen].map(([value, label]) => ({ value, label }));
};

/** A due date in the reader's language. A plain YYYY-MM-DD is a calendar day, read in local time. */
export const formatDue = (value: string, locale: string) => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = day ? new Date(+day[1], +day[2] - 1, +day[3]) : new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
};

function Copy({ value }: { value: string }) {
  const clipboard = useClipboard({ timeout: 1800 });
  return (
    <Button
      size="compact-sm"
      variant="default"
      leftSection={clipboard.copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
      onClick={() => clipboard.copy(value)}
    >
      {clipboard.copied ? tx('Copied') : tx('Copy')}
    </Button>
  );
}

const statusNote = (status: string) => {
  const notes: Record<string, string> = {
    reported: tx('Reported. Waiting for the organizer to confirm.'),
    paid: tx('Payment confirmed by the organizer.'),
    waived: tx('No charge. The organizer set your entry as free.'),
    refund_due: tx('The organizer owes you a refund.'),
    refunded: tx('Refunded.'),
  };
  return notes[status] ?? status;
};

/** The player's own entry fee: amount, how to pay, the transfer concept and "I've paid". Own row only. */
export function OwnPaymentCard({
  payment,
  adapter,
  onChange,
  inSheet = false,
}: {
  payment: PaymentInfo;
  adapter: PaymentAdapter;
  onChange: (next: PaymentInfo) => void;
  /** Inside the sheet the sheet's own title already says "Entry fee". */
  inSheet?: boolean;
}) {
  const locale = useLocale();
  const options = methodOptions(payment.methods);
  const [method, setMethod] = useState<string | null>(
    options.length === 1 ? options[0].value : null,
  );
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [others, setOthers] = useState<PayableTeammate[]>([]);
  const [alsoFor, setAlsoFor] = useState<string[]>([]);
  const pending = payment.status === 'unpaid' || payment.status === 'reported';
  const unpaid = payment.status === 'unpaid';
  const { key, loadTeammates, report: send } = adapter;
  useEffect(() => {
    if (!unpaid) return;
    let live = true;
    loadTeammates()
      .then((list) => live && setOthers(list))
      .catch(() => live && setOthers([]));
    return () => {
      live = false;
    };
    // The adapter object is rebuilt on every render; its key identifies the player and the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, unpaid]);
  const report = async () => {
    if (!method) return;
    setBusy(true);
    setError('');
    try {
      onChange(
        await send({
          method,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
          ...(alsoFor.length ? { also_for: alsoFor } : {}),
        }),
      );
      setReference('');
      setAlsoFor([]);
    } catch (e) {
      setError((e as Error).message || tx('Could not update the payment. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Paper p="md" data-testid="payment-panel">
      <Stack gap="xs">
        <Group justify={inSheet ? 'flex-start' : 'space-between'}>
          {!inSheet && <Text fw={700}>{tx('Entry fee')}</Text>}
          <Text variant="score" size="xl">
            {money(payment.amount_cents, payment.currency)}
          </Text>
        </Group>
        {payment.due_at && (
          <Text size="sm">{tx('Due by {date}', { date: formatDue(payment.due_at, locale) })}</Text>
        )}
        {payment.instructions && <Text size="sm">{payment.instructions}</Text>}
        {payment.status !== 'unpaid' && (
          <Notice tone={payment.status === 'paid' ? 'success' : 'neutral'} role="status">
            {statusNote(payment.status)}
          </Notice>
        )}
        {pending && (
          <>
            {payment.methods.map((m, i) => {
              const href = paymentHref(m, payment.amount_cents, payment.currency);
              return (
                <Group key={i} gap="xs" justify="space-between" wrap="nowrap">
                  <Stack gap={0} miw={0}>
                    <Text size="xs" c="dimmed">
                      {methodLabel(m)}
                    </Text>
                    {href ? (
                      <Text
                        component="a"
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        size="sm"
                      >
                        {m.value}
                      </Text>
                    ) : (
                      <Text size="sm">{m.value}</Text>
                    )}
                  </Stack>
                  {m.value && <Copy value={m.value} />}
                </Group>
              );
            })}
            <Group gap="xs" justify="space-between" wrap="nowrap">
              <Stack gap={0} miw={0}>
                <Text size="xs" c="dimmed">
                  {tx('Concept for the transfer')}
                </Text>
                <Text ff="monospace" size="sm">
                  {payment.concept}
                </Text>
              </Stack>
              <Copy value={payment.concept} />
            </Group>
            {unpaid && <AlsoPaidFor players={others} value={alsoFor} onChange={setAlsoFor} />}
            {unpaid && (
              <Select
                label={tx('Payment method')}
                placeholder={tx('Choose how you paid')}
                required
                data={options}
                value={method}
                onChange={setMethod}
                allowDeselect={false}
                comboboxProps={{ withinPortal: true }}
              />
            )}
            {unpaid && (
              <Group align="flex-end" wrap="nowrap">
                <TextInput
                  flex={1}
                  maxLength={120}
                  aria-label={tx('Reference or note')}
                  placeholder={tx('Reference or note')}
                  value={reference}
                  onChange={(e) => setReference(e.currentTarget.value)}
                />
                <Button loading={busy} disabled={!method} onClick={() => void report()}>
                  {tx("I've paid")}
                </Button>
              </Group>
            )}
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
      </Stack>
    </Paper>
  );
}

/** The card in a sheet (bottom sheet on phones, dialog from tablet up). */
export function PaymentSheet({
  opened,
  onClose,
  payment,
  adapter,
  onChange,
}: {
  opened: boolean;
  onClose: () => void;
  payment: PaymentInfo;
  adapter: PaymentAdapter;
  onChange: (next: PaymentInfo) => void;
}) {
  useLocale();
  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title={tx('Entry fee')}>
      <OwnPaymentCard payment={payment} adapter={adapter} onChange={onChange} inSheet />
    </ResponsiveSheet>
  );
}
