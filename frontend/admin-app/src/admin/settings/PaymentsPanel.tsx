import { useState } from 'react';
import { useMediaQuery } from '@mantine/hooks';
import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Chip,
  Collapse,
  Group,
  Menu,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
  VisuallyHidden,
} from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconDots, IconPlus, IconX } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, money, write } from '../../api';
import { ErrorState, Loading } from '../../components';
import { t as tx, useLocale } from '../../i18n';
import type { PaymentStatus } from '../../types';
import {
  ConfirmAction,
  EmptyState,
  MutationError,
  Notice,
  ResponsiveSheet,
  Section,
  StatTile,
} from '../../ui';
import { useAdminMutation } from '../../useAdminMutation';

interface PayMethod {
  kind: string;
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
  reference?: string | null;
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
/** A tournament created from this lobby, where the payment settings are edited from then on. */
export interface PayTournamentLink {
  id: string;
  name: string;
}

const TONE: Record<PaymentStatus, string> = {
  unpaid: 'gray',
  reported: 'yellow',
  paid: 'green',
  waived: 'blue',
  refund_due: 'orange',
  refunded: 'gray',
};
// The kinds the API accepts (PaymentMethodKind in backend/api/schemas.py).
// The server writes "Paid by <name>" in English when one player reports for others.
const PAID_BY = /^Paid by (.+)$/;
const noteText = (note: string) => {
  const m = PAID_BY.exec(note);
  return m ? tx('Paid by {name}', { name: m[1] }) : note;
};

const METHOD_KINDS = ['bizum', 'iban', 'revolut', 'paypal_me', 'cash', 'other'];
const CURRENCIES = [
  'EUR',
  'USD',
  'GBP',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'MXN',
  'ARS',
  'BRL',
];

function statusLabel(status: PaymentStatus): string {
  switch (status) {
    case 'unpaid':
      return tx('Unpaid');
    case 'reported':
      return tx('Reported');
    case 'paid':
      return tx('Paid');
    case 'waived':
      return tx('No charge');
    case 'refund_due':
      return tx('Refund due');
    default:
      return tx('Refunded');
  }
}

function kindLabel(kind: string): string {
  switch (kind) {
    case 'bizum':
      return tx('Bizum');
    case 'iban':
      return tx('IBAN');
    case 'revolut':
      return tx('Revolut');
    case 'paypal_me':
      return tx('PayPal');
    case 'cash':
      return tx('Cash');
    case 'other':
      return tx('Other');
    default:
      return kind;
  }
}

function SettingsSheet({
  base,
  scope,
  data,
  invalidate,
  onClose,
}: {
  base: string;
  scope: 'lobby' | 'tournament';
  data: PaySettings;
  invalidate: string[][];
  onClose: () => void;
}) {
  useLocale();
  const [fee, setFee] = useState<number | string>(data.fee_cents / 100);
  const [currency, setCurrency] = useState(data.currency);
  const [due, setDue] = useState(data.due_at ?? '');
  const [instructions, setInstructions] = useState(data.instructions ?? '');
  const [show, setShow] = useState<'always' | 'after_register'>(
    data.show_methods ?? 'after_register',
  );
  const [methods, setMethods] = useState<PayMethod[]>(data.methods ?? []);
  const [advanced, setAdvanced] = useState(
    () =>
      data.currency !== 'EUR' ||
      !!data.due_at ||
      data.show_methods === 'always' ||
      (data.methods ?? []).some((m) => m.label),
  );
  const currencies = CURRENCIES.includes(data.currency)
    ? CURRENCIES
    : [data.currency, ...CURRENCIES];
  const save = useAdminMutation({
    request: () =>
      write(
        `${base}/payment-settings`,
        {
          fee_cents: Math.round(Number(fee) * 100),
          currency: currency.toUpperCase(),
          due_at: due || null,
          instructions,
          methods: methods
            .filter((m) => m.value.trim() || m.kind === 'cash')
            .map((m) => ({ kind: m.kind, value: m.value, label: m.label?.trim() || null })),
          show_methods: show,
        },
        'PATCH',
      ),
    invalidate,
    success: 'Payment settings saved',
    onSuccess: onClose,
  });
  const patchMethod = (i: number, change: Partial<PayMethod>) =>
    setMethods(methods.map((x, j) => (j === i ? { ...x, ...change } : x)));
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
          <NumberInput
            label={tx('Fee per player ({value1})', { value1: currency })}
            min={0}
            decimalScale={2}
            value={fee}
            onChange={setFee}
          />
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              {tx('Ways to pay')}
            </Text>
            {methods.map((m, i) => (
              <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
                <Select
                  aria-label={tx('Method')}
                  allowDeselect={false}
                  w={{ base: 112, xs: 140 }}
                  value={m.kind}
                  data={METHOD_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
                  onChange={(v) => v && patchMethod(i, { kind: v })}
                />
                <TextInput
                  flex={1}
                  aria-label={tx('Account or link')}
                  placeholder={tx('Account or link')}
                  maxLength={512}
                  value={m.value}
                  onChange={(e) => patchMethod(i, { value: e.currentTarget.value })}
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
          <Textarea
            label={tx('Instructions')}
            maxLength={2000}
            autosize
            minRows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.currentTarget.value)}
          />
          <Button
            variant="subtle"
            size="compact-sm"
            w="fit-content"
            aria-expanded={advanced}
            leftSection={advanced ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            onClick={() => setAdvanced(!advanced)}
          >
            {tx('Advanced')}
          </Button>
          <Collapse expanded={advanced}>
            <Stack>
              <Select
                label={tx('Currency')}
                allowDeselect={false}
                data={currencies}
                value={currency}
                onChange={(v) => v && setCurrency(v)}
              />
              <TextInput
                label={tx('Due date (shown to players only)')}
                type="date"
                value={due ? due.slice(0, 10) : ''}
                onChange={(e) => setDue(e.currentTarget.value)}
              />
              {methods.length > 0 && (
                <Stack gap="xs">
                  <Text size="sm" fw={600}>
                    {tx('Payment options')}
                  </Text>
                  {methods.map((m, i) => (
                    <TextInput
                      key={i}
                      aria-label={tx('Label for {value1}', { value1: kindLabel(m.kind) })}
                      placeholder={kindLabel(m.kind)}
                      maxLength={80}
                      value={m.label ?? ''}
                      onChange={(e) => patchMethod(i, { label: e.currentTarget.value })}
                    />
                  ))}
                </Stack>
              )}
              {scope === 'lobby' && (
                <Stack gap={4}>
                  <Checkbox
                    label={tx('Show payment details on the public sign-up page')}
                    checked={show === 'always'}
                    onChange={(e) => setShow(e.currentTarget.checked ? 'always' : 'after_register')}
                  />
                  <Text size="xs" c="dimmed">
                    {tx(
                      'Anyone with the sign-up link sees these details, also before they register. If this is off, players see them after they register.',
                    )}
                  </Text>
                </Stack>
              )}
            </Stack>
          </Collapse>
          <Button type="submit" loading={save.isPending}>
            {tx('Save settings')}
          </Button>
        </Stack>
      </form>
    </ResponsiveSheet>
  );
}

// "Mark paid" asks how the money arrived, so every paid row carries a method.
function MarkPaidSheet({
  row,
  methods,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  row: PayRow;
  methods: PayMethod[];
  loading: boolean;
  error: Error | null;
  onConfirm: (method: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const [method, setMethod] = useState(
    row.method && METHOD_KINDS.includes(row.method)
      ? row.method
      : (methods.find((m) => METHOD_KINDS.includes(m.kind))?.kind ?? 'cash'),
  );
  return (
    <ResponsiveSheet
      opened
      onClose={onClose}
      title={tx('How did {name} pay?', { name: row.player_name })}
    >
      <Stack>
        <MutationError error={error} />
        <Chip.Group multiple={false} value={method} onChange={(v) => setMethod(v)}>
          <Group gap="xs">
            {METHOD_KINDS.map((k) => (
              <Chip key={k} value={k}>
                {kindLabel(k)}
              </Chip>
            ))}
          </Group>
        </Chip.Group>
        <Button loading={loading} onClick={() => onConfirm(method)}>
          {tx('Mark paid')}
        </Button>
      </Stack>
    </ResponsiveSheet>
  );
}

function EditRowSheet({
  row,
  loading,
  error,
  onSave,
  onClose,
}: {
  row: PayRow;
  loading: boolean;
  error: Error | null;
  onSave: (amountCents: number, note: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const [amount, setAmount] = useState<number | string>(row.amount_cents / 100);
  const [note, setNote] = useState(row.note ?? '');
  return (
    <ResponsiveSheet
      opened
      onClose={onClose}
      title={tx('Amount and note for {name}', { name: row.player_name })}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(Math.round(Number(amount) * 100), note);
        }}
      >
        <Stack>
          <MutationError error={error} />
          <NumberInput
            label={tx('Amount ({value1})', { value1: row.currency })}
            min={0}
            decimalScale={2}
            value={amount}
            onChange={setAmount}
          />
          <Textarea
            label={tx('Note')}
            maxLength={500}
            autosize
            minRows={2}
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
          />
          <Button type="submit" loading={loading}>
            {tx('Save')}
          </Button>
        </Stack>
      </form>
    </ResponsiveSheet>
  );
}

// One action per status, the rest in the "..." menu. The organizer never sets "reported": only the
// player does that. Every status stays reachable: unpaid -> paid -> refund due -> refunded, with
// Waive and Undo (back to unpaid) in the menu.
function RowActions({
  row,
  busy,
  onMarkPaid,
  onSet,
  onEdit,
}: {
  row: PayRow;
  busy: boolean;
  onMarkPaid: () => void;
  onSet: (status: PaymentStatus) => void;
  onEdit: () => void;
}) {
  const s = row.status;
  return (
    <Group gap="xs" wrap="nowrap" justify="flex-end">
      {(s === 'unpaid' || s === 'reported') && (
        <Button size="compact-sm" disabled={busy} onClick={onMarkPaid}>
          {tx('Mark paid')}
        </Button>
      )}
      {s === 'paid' && (
        <Button
          size="compact-sm"
          variant="default"
          disabled={busy}
          onClick={() => onSet('refund_due')}
        >
          {tx('Mark refund due')}
        </Button>
      )}
      {s === 'refund_due' && (
        <Button size="compact-sm" disabled={busy} onClick={() => onSet('refunded')}>
          {tx('Mark refunded')}
        </Button>
      )}
      <Menu position="bottom-end" withinPortal>
        <Menu.Target>
          <ActionIcon
            variant="subtle"
            color="gray"
            disabled={busy}
            aria-label={tx('More actions for {name}', { name: row.player_name })}
          >
            <IconDots size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          {(s === 'unpaid' || s === 'reported') && (
            <Menu.Item onClick={() => onSet('waived')}>{tx('No charge')}</Menu.Item>
          )}
          {s !== 'unpaid' && <Menu.Item onClick={() => onSet('unpaid')}>{tx('Undo')}</Menu.Item>}
          <Menu.Item onClick={onEdit}>{tx('Edit amount and note')}</Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  );
}

function StatusChip({ status }: { status: PaymentStatus }) {
  return (
    // Mantine clips the label (overflow: hidden), which lets the table shrink the Status column
    // to nothing and cut the word. Status words are short: show them whole.
    <Badge
      color={TONE[status]}
      variant="light"
      size="sm"
      styles={{ label: { overflow: 'visible' } }}
    >
      {statusLabel(status)}
    </Badge>
  );
}

function RowDetails({ p }: { p: PayRow }) {
  return (
    <Stack gap={2}>
      {p.method && (
        <Text size="sm">{METHOD_KINDS.includes(p.method) ? kindLabel(p.method) : p.method}</Text>
      )}
      {p.reference && (
        <Text size="xs">
          {tx('Payment reference')}: {p.reference}
        </Text>
      )}
      {p.note && (
        <Text size="xs">
          {tx('Note')}: {noteText(p.note)}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {p.concept}
      </Text>
    </Stack>
  );
}

// The settings of a converted lobby are edited in its tournament; here they are only shown.
function ReadOnlySettings({
  settings,
  tournaments,
}: {
  settings: PaySettings;
  tournaments: PayTournamentLink[];
}) {
  const methods = settings.methods ?? [];
  return (
    <Notice title={tx('Payment settings are edited in the tournament')}>
      <Stack gap="xs">
        <Text size="sm">
          {tx('This lobby became a tournament. Change the fee and the ways to pay there.')}
        </Text>
        <Group gap="md">
          {tournaments.map((tn) => (
            <Anchor
              key={tn.id}
              component={Link}
              to={`/admin/t/${tn.id}?settings=payments`}
              size="sm"
            >
              {tx('Edit in {name}', { name: tn.name })}
            </Anchor>
          ))}
        </Group>
        {methods.length > 0 && (
          <Stack gap={2}>
            {methods.map((m, i) => (
              <Text key={i} size="xs" c="dimmed">
                {m.label || kindLabel(m.kind)}
                {m.value ? `: ${m.value}` : ''}
              </Text>
            ))}
          </Stack>
        )}
        {settings.instructions && (
          <Text size="xs" c="dimmed">
            {settings.instructions}
          </Text>
        )}
      </Stack>
    </Notice>
  );
}

// Fee, who paid, reminders. The same panel serves a lobby (`/registrations/{id}`) and a running
// tournament (`/tournaments/{id}`): both expose the same payment routes. A converted lobby passes
// the tournaments it became, and its settings turn read-only (rows stay editable).
export function PaymentsPanel({
  base,
  scope,
  convertedTo = [],
}: {
  base: string;
  scope: 'lobby' | 'tournament';
  convertedTo?: PayTournamentLink[];
}) {
  useLocale();
  const key = ['admin', 'payments', base];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<PayList>(`${base}/payments`),
    refetchInterval: 30_000,
  });
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('all');
  const phone = useMediaQuery('(max-width: 767px)', false, { getInitialValueInEffect: false });
  const [confirmRemind, setConfirmRemind] = useState(false);
  const [marking, setMarking] = useState<PayRow | null>(null);
  const [editingRow, setEditingRow] = useState<PayRow | null>(null);
  const change = useAdminMutation({
    request: ({
      player,
      ...body
    }: {
      player: string;
      status: PaymentStatus;
      method?: string;
      amount_cents?: number;
      note?: string;
    }) => write(`${base}/payments/${player}`, body, 'PATCH'),
    invalidate: [key, ['admin', 'lobby']],
    success: 'Payment status updated',
    onSuccess: () => {
      setMarking(null);
      setEditingRow(null);
    },
  });
  const remind = useAdminMutation({
    request: () =>
      write<{
        sent: number;
        pushed?: number;
        failed: number;
        skipped: number;
        unreachable?: string[];
      }>(`${base}/payments/remind-unpaid`, {}),
    success: (r) => {
      const summary = r.pushed
        ? tx(
            'Reminders: emails {sent}, notifications {pushed}, skipped {skipped}, failed {failed}',
            {
              ...r,
              pushed: r.pushed,
            },
          )
        : tx('Reminders sent: {sent}, skipped {skipped}, failed {failed}', r);
      return r.unreachable?.length
        ? `${summary}. ${tx('Without an e-mail address: {names}', { names: r.unreachable.join(', ') })}`
        : summary;
    },
    onSuccess: () => setConfirmRemind(false),
  });
  if (query.isPending) return <Loading />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  const { settings, rows, summary } = query.data;
  const readOnly = scope === 'lobby' && convertedTo.length > 0;
  const toRemind = summary.unpaid + summary.reported;
  const active = rows.filter((r) => r.status !== 'refund_due' && r.status !== 'refunded');
  const refunds = rows.filter((r) => r.status === 'refund_due' || r.status === 'refunded');
  const visible = active.filter((r) => filter === 'all' || r.status === filter);
  const expected = rows
    .filter((r) => r.status === 'unpaid' || r.status === 'reported' || r.status === 'paid')
    .reduce((sum, r) => sum + r.amount_cents, 0);
  const actionsFor = (p: PayRow) => (
    <RowActions
      row={p}
      busy={change.isPending}
      onMarkPaid={() => setMarking(p)}
      onSet={(status) => change.mutate({ player: p.player_id, status })}
      onEdit={() => setEditingRow(p)}
    />
  );
  return (
    <Stack gap="md">
      <Paper p="md" variant="row">
        <SimpleGrid cols={{ base: 2, sm: summary.refund_due ? 4 : 3 }}>
          <StatTile
            testId="stat-collected"
            label={tx('Collected')}
            value={money(summary.collected_cents, settings.currency)}
            hint={tx('of {total}', { total: money(expected, settings.currency) })}
          />
          <StatTile label={tx('Unpaid')} value={summary.unpaid} />
          <StatTile label={tx('To confirm')} value={summary.reported} />
          {!!summary.refund_due && <StatTile label={tx('Refunds')} value={summary.refund_due} />}
        </SimpleGrid>
      </Paper>
      {readOnly && <ReadOnlySettings settings={settings} tournaments={convertedTo} />}
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          {settings.fee_cents
            ? tx('Fee {amount} per player', {
                amount: money(settings.fee_cents, settings.currency),
              })
            : tx('No fee set')}
        </Text>
        <Group gap="xs">
          <Button variant="default" disabled={!toRemind} onClick={() => setConfirmRemind(true)}>
            {tx('Remind unpaid players')}
          </Button>
          {!readOnly && (
            <Button variant="default" onClick={() => setEditing(true)}>
              {tx('Payment settings')}
            </Button>
          )}
        </Group>
      </Group>
      <MutationError error={editingRow || marking ? null : change.error} />
      {!rows.length ? (
        <EmptyState title={tx('No payments to track yet')}>
          {scope === 'lobby'
            ? tx('Payments appear here as players register.')
            : tx('Payments appear here once players are in the event.')}
        </EmptyState>
      ) : (
        <>
          {active.length > 0 && (
            <Stack gap="xs">
              <SegmentedControl
                size="xs"
                w="fit-content"
                value={filter}
                onChange={setFilter}
                data={[
                  { value: 'all', label: tx('All') },
                  { value: 'unpaid', label: tx('Unpaid') },
                  { value: 'reported', label: tx('To confirm') },
                ]}
              />
              {visible.length === 0 ? (
                <Text size="sm" c="dimmed">
                  {tx('No players match this filter.')}
                </Text>
              ) : phone ? (
                <Stack gap="xs">
                  {visible.map((p) => (
                    <Paper key={p.player_id} p="sm" variant="row" data-testid="payment-row">
                      <Stack gap={6}>
                        <Group justify="space-between" wrap="wrap" gap="xs">
                          <Group gap="sm">
                            <Text fw={600} size="sm">
                              {p.player_name}
                            </Text>
                            <Text size="sm">{money(p.amount_cents, p.currency)}</Text>
                          </Group>
                          <StatusChip status={p.status} />
                        </Group>
                        {p.email && (
                          <Text size="xs" c="dimmed">
                            {p.email}
                          </Text>
                        )}
                        <RowDetails p={p} />
                        {actionsFor(p)}
                      </Stack>
                    </Paper>
                  ))}
                </Stack>
              ) : (
                <Paper>
                  <Table.ScrollContainer minWidth={640}>
                    <Table verticalSpacing="sm" horizontalSpacing="md" stickyHeader>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th>{tx('Player')}</Table.Th>
                          <Table.Th>{tx('Amount')}</Table.Th>
                          <Table.Th>{tx('Details')}</Table.Th>
                          <Table.Th>{tx('Status')}</Table.Th>
                          <Table.Th>
                            <VisuallyHidden>{tx('Actions')}</VisuallyHidden>
                          </Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {visible.map((p) => (
                          <Table.Tr key={p.player_id}>
                            <Table.Td>
                              <Text fw={600} size="sm">
                                {p.player_name}
                              </Text>
                              {p.email && (
                                <Text size="xs" c="dimmed">
                                  {p.email}
                                </Text>
                              )}
                            </Table.Td>
                            <Table.Td>{money(p.amount_cents, p.currency)}</Table.Td>
                            <Table.Td>
                              <RowDetails p={p} />
                            </Table.Td>
                            <Table.Td>
                              <StatusChip status={p.status} />
                            </Table.Td>
                            <Table.Td>{actionsFor(p)}</Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Paper>
              )}
            </Stack>
          )}
          {refunds.length > 0 && (
            <Stack gap="xs" data-testid="payment-refunds">
              <Text fw={600}>{tx('Refunds')}</Text>
              <Text size="sm" c="dimmed">
                {tx('These players paid and then left. Pay the money back, then mark it refunded.')}
              </Text>
              {refunds.map((p) => (
                <Paper key={p.player_id} p="sm" variant="row">
                  <Group justify="space-between" wrap="wrap">
                    <Group gap="sm">
                      <Text fw={600} size="sm">
                        {p.player_name}
                      </Text>
                      <Text size="sm">{money(p.amount_cents, p.currency)}</Text>
                      <StatusChip status={p.status} />
                    </Group>
                    {actionsFor(p)}
                  </Group>
                </Paper>
              ))}
            </Stack>
          )}
        </>
      )}
      {editing && (
        <SettingsSheet
          base={base}
          scope={scope}
          data={settings}
          invalidate={[key]}
          onClose={() => setEditing(false)}
        />
      )}
      {marking && (
        <MarkPaidSheet
          row={marking}
          methods={settings.methods ?? []}
          loading={change.isPending}
          error={change.error}
          onConfirm={(method) =>
            change.mutate({ player: marking.player_id, status: 'paid', method })
          }
          onClose={() => setMarking(null)}
        />
      )}
      {editingRow && (
        <EditRowSheet
          row={editingRow}
          loading={change.isPending}
          error={change.error}
          onSave={(amount_cents, note) =>
            change.mutate({
              player: editingRow.player_id,
              status: editingRow.status,
              amount_cents,
              note,
            })
          }
          onClose={() => setEditingRow(null)}
        />
      )}
      <ConfirmAction
        opened={confirmRemind}
        title={tx('Remind unpaid players?')}
        description={tx(
          'Sends an e-mail to {value1} players who have not paid or whose payment is not confirmed yet.',
          { value1: toRemind },
        )}
        confirmLabel={tx('Send reminders')}
        loading={remind.isPending}
        error={remind.error}
        onConfirm={() => remind.mutate()}
        onClose={() => setConfirmRemind(false)}
      />
    </Stack>
  );
}

export { Section };
