import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Button,
  Group,
  NativeSelect,
  NumberInput,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { api, money, write } from '../../api';
import { ErrorState, Loading } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { PaymentStatus } from '../../types';
import { EmptyState, MutationError, ResponsiveSheet, Section, StatTile } from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

type MethodKind = string;
interface PayMethod {
  kind: MethodKind;
  value: string;
  label?: string | null;
}
interface PaySettings {
  fee_cents: number;
  currency: string;
  due_at?: string | null;
  instructions?: string | null;
  methods?: PayMethod[];
  show_methods?: 'always' | 'after_register';
}
interface PayRow {
  player_id: string;
  player_name: string;
  email?: string;
  status: PaymentStatus;
  amount_cents: number;
  currency: string;
  method?: string | null;
  note?: string | null;
  concept: string;
}
interface PayList {
  settings: PaySettings;
  rows: PayRow[];
  summary: {
    total: number;
    paid: number;
    unpaid: number;
    reported: number;
    waived?: number;
    refund_due?: number;
    refunded?: number;
    collected_cents: number;
  };
}
const STATUSES: PaymentStatus[] = [
  'unpaid',
  'reported',
  'paid',
  'waived',
  'refund_due',
  'refunded',
];
const TONE: Record<PaymentStatus, string> = {
  unpaid: 'gray',
  reported: 'yellow',
  paid: 'green',
  waived: 'blue',
  refund_due: 'orange',
  refunded: 'gray',
};
const METHOD_KINDS = ['bizum', 'paypal', 'iban', 'cash', 'revolut', 'link', 'other'];

function SettingsSheet({
  base,
  data,
  invalidate,
  onClose,
}: {
  base: string;
  data: PaySettings;
  invalidate: string[][];
  onClose: () => void;
}) {
  useLocale();
  const [fee, setFee] = useState<number | string>(data.fee_cents / 100);
  const [currency, setCurrency] = useState(data.currency);
  const [due, setDue] = useState(data.due_at ?? '');
  const [instructions, setInstructions] = useState(data.instructions ?? '');
  const [show, setShow] = useState(data.show_methods ?? 'after_register');
  const [methods, setMethods] = useState<PayMethod[]>(data.methods ?? []);
  const save = useAdminMutation({
    request: () =>
      write(
        `${base}/payment-settings`,
        {
          fee_cents: Math.round(Number(fee) * 100),
          currency: currency.toUpperCase(),
          due_at: due || null,
          instructions,
          methods: methods.filter((m) => m.value.trim() || m.kind === 'cash'),
          show_methods: show,
        },
        'PATCH',
      ),
    invalidate,
    success: 'Payment settings saved',
    onSuccess: onClose,
  });
  return (
    <ResponsiveSheet opened onClose={onClose} title={tx('Payment settings')} size="lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Stack>
          <MutationError error={save.error} />
          <SimpleGrid cols={2}>
            <NumberInput
              label={tx('Fee per player ({value1})', { value1: currency })}
              min={0}
              decimalScale={2}
              value={fee}
              onChange={setFee}
            />
            <TextInput
              label={tx('Currency')}
              maxLength={3}
              value={currency}
              onChange={(e) => setCurrency(e.currentTarget.value)}
            />
          </SimpleGrid>
          <TextInput
            label={tx('Due date')}
            type="date"
            value={due ? due.slice(0, 10) : ''}
            onChange={(e) => setDue(e.currentTarget.value)}
          />
          <Textarea
            label={tx('Instructions')}
            maxLength={2000}
            autosize
            minRows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.currentTarget.value)}
          />
          <NativeSelect
            label={tx('Show payment methods')}
            value={show}
            onChange={(e) => setShow(e.currentTarget.value as 'always' | 'after_register')}
            data={[
              { value: 'after_register', label: tx('After the player registers') },
              { value: 'always', label: tx('Always') },
            ]}
          />
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {tx('Ways to pay')}
            </Text>
            {methods.map((m, i) => (
              <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
                <NativeSelect
                  aria-label={tx('Method')}
                  value={m.kind}
                  data={METHOD_KINDS.map((k) => ({ value: k, label: tx(k) }))}
                  onChange={(e) =>
                    setMethods(
                      methods.map((x, j) => (j === i ? { ...x, kind: e.currentTarget.value } : x)),
                    )
                  }
                />
                <TextInput
                  flex={1}
                  aria-label={tx('Account or link')}
                  placeholder={tx('Account or link')}
                  maxLength={512}
                  value={m.value}
                  onChange={(e) =>
                    setMethods(
                      methods.map((x, j) => (j === i ? { ...x, value: e.currentTarget.value } : x)),
                    )
                  }
                />
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label={tx('Remove method')}
                  onClick={() => setMethods(methods.filter((_, j) => j !== i))}
                >
                  <IconX size={16} />
                </ActionIcon>
              </Group>
            ))}
            {methods.length < 12 && (
              <Button
                variant="subtle"
                size="compact-sm"
                w="fit-content"
                leftSection={<IconPlus size={14} />}
                onClick={() => setMethods([...methods, { kind: 'bizum', value: '' }])}
              >
                {tx('Add a way to pay')}
              </Button>
            )}
          </Stack>
          <Button type="submit" loading={save.isPending}>
            {tx('Save settings')}
          </Button>
        </Stack>
      </form>
    </ResponsiveSheet>
  );
}

// Fee, who paid, reminders. The same panel serves a lobby (`/registrations/{id}`) and a running
// tournament (`/tournaments/{id}`): both expose the same payment routes.
export function PaymentsPanel({ base, scope }: { base: string; scope: 'lobby' | 'tournament' }) {
  useLocale();
  const key = ['admin', 'payments', base];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<PayList>(`${base}/payments`),
    refetchInterval: 30_000,
  });
  const [editing, setEditing] = useState(false);
  const change = useAdminMutation({
    request: ({ player, status }: { player: string; status: PaymentStatus }) =>
      write(`${base}/payments/${player}`, { status }, 'PATCH'),
    invalidate: [key, ['admin', 'lobby']],
    success: 'Payment status updated',
  });
  const remind = useAdminMutation({
    request: () =>
      write<{ sent: number; failed: number; skipped: number }>(
        `${base}/payments/remind-unpaid`,
        {},
      ),
    success: (r) => tx('Reminders sent: {sent}, skipped {skipped}, failed {failed}', r),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const { settings, rows, summary } = query.data;
  return (
    <Stack gap="md">
      <Paper p="md" variant="row">
        <SimpleGrid cols={{ base: 2, sm: 4 }}>
          <StatTile
            testId="stat-collected"
            label={tx('Collected')}
            value={money(summary.collected_cents, settings.currency)}
          />
          <StatTile label={tx('Paid')} value={summary.paid} />
          <StatTile label={tx('Reported')} value={summary.reported} />
          <StatTile label={tx('Unpaid')} value={summary.unpaid} />
        </SimpleGrid>
      </Paper>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {settings.fee_cents
            ? tx('Fee {amount} per player', {
                amount: money(settings.fee_cents, settings.currency),
              })
            : tx('No fee set')}
        </Text>
        <Group gap="xs">
          <Button
            variant="default"
            loading={remind.isPending}
            disabled={!summary.unpaid}
            onClick={() => remind.mutate()}
          >
            {tx('Remind unpaid players')}
          </Button>
          <Button variant="default" onClick={() => setEditing(true)}>
            {tx('Payment settings')}
          </Button>
        </Group>
      </Group>
      <MutationError error={change.error ?? remind.error} />
      {!rows.length ? (
        <EmptyState title={tx('No payments to track yet')}>
          {scope === 'lobby'
            ? tx('Payments appear here as players register.')
            : tx('Payments appear here once players are in the event.')}
        </EmptyState>
      ) : (
        <Paper>
          <Table.ScrollContainer minWidth={560}>
            <Table verticalSpacing="sm" horizontalSpacing="md" stickyHeader>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{tx('Player')}</Table.Th>
                  <Table.Th>{tx('Amount')}</Table.Th>
                  <Table.Th>{tx('Reference')}</Table.Th>
                  <Table.Th>{tx('Status')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((p) => (
                  <Table.Tr key={p.player_id}>
                    <Table.Td>
                      <Text fw={600} size="sm">
                        {p.player_name}
                      </Text>
                    </Table.Td>
                    <Table.Td>{money(p.amount_cents, p.currency)}</Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {p.concept}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Group gap="xs" wrap="nowrap">
                        <Badge color={TONE[p.status]} variant="light" size="sm">
                          {tx(p.status.replace('_', ' '))}
                        </Badge>
                        <NativeSelect
                          size="xs"
                          w={130}
                          aria-label={tx('Payment status for {value1}', { value1: p.player_name })}
                          value={p.status}
                          disabled={change.isPending}
                          data={STATUSES.map((v) => ({ value: v, label: tx(v.replace('_', ' ')) }))}
                          onChange={(e) =>
                            change.mutate({
                              player: p.player_id,
                              status: e.currentTarget.value as PaymentStatus,
                            })
                          }
                        />
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      {editing && (
        <SettingsSheet
          base={base}
          data={settings}
          invalidate={[key]}
          onClose={() => setEditing(false)}
        />
      )}
    </Stack>
  );
}

export { Section };
