import { useEffect, useRef, useState } from 'react';
import {
  Accordion,
  Alert,
  Avatar,
  Badge,
  Button,
  Checkbox,
  Group,
  NumberInput,
  Paper,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { IconCheck, IconCopy, IconUser } from '@tabler/icons-react';
import { useClipboard } from '@mantine/hooks';
import { Link } from 'react-router-dom';
import { money } from '../../api';
import { localeTag, t as tx, useLocale } from '../../i18n';
import type { Question } from '../../types';
import { Markdown } from '../public/Markdown';
import {
  call,
  isEmail,
  kindOf,
  lobbyPath,
  paymentHref,
  type Answer,
  type PaymentInfo,
  type PublicLobby,
} from './model';

// ---- Small pieces --------------------------------------------------------------------------------------

export function PlayerChips({ lobby, open = true }: { lobby: PublicLobby; open?: boolean }) {
  useLocale();
  const players = lobby.registrants ?? [];
  if (!players.length) return null;
  return (
    <Accordion variant="contained" defaultValue={open ? 'players' : null}>
      <Accordion.Item value="players">
        <Accordion.Control>
          {tx('Registered players')} ({players.length})
        </Accordion.Control>
        <Accordion.Panel>
          <Group gap={6}>
            {players.map((p) => (
              <Badge
                key={p.player_id}
                variant="light"
                color="gray"
                size="lg"
                data-testid="registrant-chip"
              >
                {p.player_name}
              </Badge>
            ))}
          </Group>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}

export function OrganizerMessage({ message }: { message?: string | null }) {
  useLocale();
  if (!message) return null;
  return (
    <Stack gap={4}>
      <Text variant="eyebrow">{tx('Message from organizer')}</Text>
      <Paper p="md" variant="row">
        <Markdown source={message} />
      </Paper>
    </Stack>
  );
}

export function LinkedTournaments({
  lobby,
  entryToken,
}: {
  lobby: PublicLobby;
  entryToken: string | null;
}) {
  useLocale();
  const ids = lobby.converted_to_tids?.length
    ? lobby.converted_to_tids
    : lobby.converted_to_tid
      ? [lobby.converted_to_tid]
      : [];
  const byId = new Map((lobby.linked_tournaments ?? []).map((t) => [t.id, t]));
  const link = (id: string) =>
    `/tv/${encodeURIComponent(id)}${entryToken ? `?player_token=${encodeURIComponent(entryToken)}` : ''}`;
  const known = ids.map((id) => byId.get(id)).filter((t): t is NonNullable<typeof t> => !!t);
  if (!known.length) return null;
  const group = (title: string, list: typeof known) =>
    list.length > 0 && (
      <Stack gap={4}>
        <Text variant="eyebrow">{title}</Text>
        <Group gap="xs">
          {list.map((t) => (
            <Button key={t.id} component={Link} to={link(t.id)} variant="light" size="compact-md">
              {tx('View')} · {t.name}
            </Button>
          ))}
        </Group>
      </Stack>
    );
  return (
    <Stack gap="xs" data-testid="linked-tournaments">
      <Text fw={700}>{tx('Linked Tournaments')}</Text>
      {group(
        tx('Active tournaments'),
        known.filter((t) => !t.finished),
      )}
      {group(
        tx('Finished tournaments'),
        known.filter((t) => t.finished),
      )}
    </Stack>
  );
}

const METHOD_LABEL: Record<string, string> = {
  bizum: 'Bizum (phone)',
  iban: 'Bank transfer (IBAN)',
  revolut: 'Revolut link',
  paypal_me: 'PayPal.me link',
  cash: 'Cash',
  other: 'Other',
};
const methodLabel = (m: { kind: string; label?: string | null }) =>
  m.label || tx(METHOD_LABEL[m.kind] ?? 'Other');

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

/** The entry fee: the public notice before signing up, the full payment panel after. */
export function FeeNotice({ payment }: { payment?: PublicLobby['payment'] }) {
  useLocale();
  if (!payment?.fee_cents) return null;
  return (
    <Paper p="md" data-testid="fee-notice">
      <Stack gap={4}>
        <Group justify="space-between">
          <Text fw={700}>{tx('Entry fee')}</Text>
          <Text variant="score" size="xl">
            {money(payment.fee_cents, payment.currency)}
          </Text>
        </Group>
        {payment.due_at && <Text size="sm">{tx('Due by {date}', { date: payment.due_at })}</Text>}
        {payment.instructions && <Text size="sm">{payment.instructions}</Text>}
        {payment.methods?.length ? (
          payment.methods.map((m, i) => {
            const href = paymentHref(m, payment.fee_cents, payment.currency);
            return (
              <Group key={i} gap="xs">
                <Text size="sm" c="dimmed">
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
              </Group>
            );
          })
        ) : (
          <Text size="sm" c="dimmed">
            {tx('Payment details are shown once you register.')}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

const STATUS_NOTE: Record<string, string> = {
  reported: 'Reported — waiting for the organizer to confirm.',
  paid: 'Payment confirmed by the organizer.',
  waived: 'No payment needed — the organizer waived your fee.',
  refund_due: 'The organizer owes you a refund.',
  refunded: 'Refunded.',
};

export function PaymentPanel({
  rid,
  payment,
  credential,
  onChange,
}: {
  rid: string;
  payment: PaymentInfo;
  credential: { passphrase: string } | { token: string };
  onChange: (next: PaymentInfo) => void;
}) {
  useLocale();
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = payment.status === 'unpaid' || payment.status === 'reported';
  const report = async () => {
    setBusy(true);
    setError('');
    try {
      const body: Record<string, string> = { ...credential };
      if (reference.trim()) body.reference = reference.trim();
      onChange(await call<PaymentInfo>(`${lobbyPath(rid)}/player-payment-report`, body, 'POST'));
      setReference('');
    } catch (e) {
      setError((e as Error).message || tx('Could not update the payment. Try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Paper p="md" data-testid="payment-panel">
      <Stack gap="xs">
        <Group justify="space-between">
          <Text fw={700}>{tx('Entry fee')}</Text>
          <Text variant="score" size="xl">
            {money(payment.amount_cents, payment.currency)}
          </Text>
        </Group>
        {payment.due_at && <Text size="sm">{tx('Due by {date}', { date: payment.due_at })}</Text>}
        {payment.instructions && <Text size="sm">{payment.instructions}</Text>}
        {payment.status !== 'unpaid' && (
          <Alert color={payment.status === 'paid' ? 'green' : 'gray'} role="status">
            {tx(STATUS_NOTE[payment.status] ?? payment.status)}
          </Alert>
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
            {payment.status === 'unpaid' && (
              <Group align="flex-end" wrap="nowrap">
                <TextInput
                  flex={1}
                  maxLength={120}
                  aria-label={tx('Reference or note (optional)')}
                  placeholder={tx('Reference or note (optional)')}
                  value={reference}
                  onChange={(e) => setReference(e.currentTarget.value)}
                />
                <Button loading={busy} onClick={() => void report()}>
                  {tx("I've paid")}
                </Button>
              </Group>
            )}
          </>
        )}
        {error && <Alert color="red">{error}</Alert>}
      </Stack>
    </Paper>
  );
}

// ---- Identity ------------------------------------------------------------------------------------------

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length
    ? ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
    : '';
};

/** Who the visitor is (Player Hub) next to whether they hold an entry here, so "signed in" is never read as "registered". */
export function IdentityStrip({
  name,
  signedIn,
  caption,
  registered,
  onLogout,
}: {
  name: string;
  signedIn: boolean;
  caption?: string;
  registered?: boolean;
  onLogout?: () => void;
}) {
  useLocale();
  return (
    <Paper p="sm" variant="row" data-testid="identity-strip">
      <Group justify="space-between" wrap="wrap" gap="sm">
        <Group gap="sm" wrap="nowrap">
          <Avatar color={signedIn ? 'court' : 'gray'} radius="xl">
            {signedIn && initials(name) ? initials(name) : <IconUser size={18} />}
          </Avatar>
          <Stack gap={0}>
            <Text fw={600}>{signedIn ? name : tx('Guest')}</Text>
            <Text size="xs" c="dimmed">
              {signedIn
                ? (caption ?? tx('Player Hub — signed in'))
                : tx('Not signed in to the Player Hub')}
            </Text>
          </Stack>
        </Group>
        <Group gap="xs">
          {registered === false && (
            <Badge variant="light" color="gray">
              {tx('Not registered yet')}
            </Badge>
          )}
          {signedIn && onLogout && (
            <Button variant="subtle" color="gray" size="compact-md" onClick={onLogout}>
              {tx('Log out')}
            </Button>
          )}
        </Group>
      </Group>
    </Paper>
  );
}

// ---- Questions -----------------------------------------------------------------------------------------

export function QuestionField({
  q,
  value,
  onChange,
}: {
  q: Question;
  value: Answer;
  onChange: (next: Answer) => void;
}) {
  const label = q.required ? q.label : `${q.label} (${tx('optional')})`;
  const kind = kindOf(q);
  if (kind === 'choice')
    return (
      <Select
        label={label}
        required={q.required}
        placeholder={tx('Select…')}
        data={q.choices}
        value={String(value || '') || null}
        onChange={(v) => onChange(v ?? '')}
        clearable={!q.required}
        allowDeselect={!q.required}
      />
    );
  if (kind === 'multi')
    return (
      <Checkbox.Group label={label} value={Array.isArray(value) ? value : []} onChange={onChange}>
        <Stack gap={6} mt={6}>
          {q.choices.map((c) => (
            <Checkbox key={c} value={c} label={c} />
          ))}
        </Stack>
      </Checkbox.Group>
    );
  if (kind === 'number')
    return (
      <NumberInput
        label={label}
        required={q.required}
        value={value === '' || Array.isArray(value) ? '' : Number(value)}
        onChange={(v) => onChange(v === '' ? '' : String(v))}
        allowDecimal
      />
    );
  return (
    <Textarea
      label={label}
      required={q.required}
      maxLength={512}
      autosize
      minRows={1}
      value={Array.isArray(value) ? '' : String(value ?? '')}
      onChange={(e) => onChange(e.currentTarget.value)}
    />
  );
}

// ---- Name search / claim --------------------------------------------------------------------------------

interface NameMatch {
  entity_type: string;
  entity_id: string;
  player_id: string;
  player_name: string;
  entity_name?: string;
  sport?: string;
  event_date?: string;
  already_linked?: boolean;
  ghost_profile_id?: string | null;
}

const eventLine = (m: NameMatch) => {
  const type =
    m.entity_type === 'tournament'
      ? 'Tournament'
      : m.entity_type === 'profile'
        ? 'Player record'
        : 'Registration lobby';
  const parts = [m.entity_name ?? '', tx(type)];
  if (m.sport) parts.push(tx(m.sport === 'tennis' ? 'Tennis' : 'Padel'));
  if (m.event_date) {
    const d = new Date(m.event_date);
    if (!Number.isNaN(d.getTime()))
      parts.push(
        d.toLocaleDateString(localeTag(), {
          year: 'numeric',
          month: 'short',
        }),
      );
  }
  return parts.filter(Boolean).join(' · ');
};

// Past participations by name. The organizer must confirm a claim, so no secret is needed to ask.
export function NameSearch({
  rid,
  profilePassphrase,
}: {
  rid: string;
  profilePassphrase: string | null;
}) {
  useLocale();
  const [name, setName] = useState('');
  const [matches, setMatches] = useState<NameMatch[]>([]);
  const [message, setMessage] = useState<{ text: string; tone: 'error' | 'ok' | 'info' } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const latest = useRef('');
  const search = async (typed: string, manual: boolean) => {
    const wanted = typed.trim();
    if (!wanted) return;
    latest.current = wanted;
    setMessage(null);
    if (manual) {
      setBusy(true);
      setMatches([]);
    }
    try {
      const found = await call<NameMatch[]>(
        `${lobbyPath(rid)}/find-by-name`,
        { player_name: wanted },
        'POST',
      ).catch(() => [] as NameMatch[]);
      if (latest.current !== wanted) return; // a newer search is running
      setMatches(found);
      if (!found.length)
        setMessage({
          text: tx('No matching past registrations found in this club.'),
          tone: 'info',
        });
    } finally {
      if (manual) setBusy(false);
    }
  };
  // Suggest while typing, once there are two letters.
  useEffect(() => {
    if (name.trim().length < 2) {
      setMatches([]);
      setMessage(null);
      return;
    }
    const timer = window.setTimeout(() => void search(name, false), 350);
    return () => window.clearTimeout(timer);
    // `search` only reads refs and `rid`; re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  const claim = async (m: NameMatch) => {
    if (!profilePassphrase) {
      setMessage({
        text: tx(
          'You need a Player Hub profile to claim. Register for this event first, then create your profile from the confirmation screen — or log in with your code.',
        ),
        tone: 'error',
      });
      return;
    }
    // A hit that belongs to a ghost profile claims the whole profile (all its events merge at once).
    const type = m.ghost_profile_id ? 'profile' : m.entity_type;
    const id = m.ghost_profile_id || m.entity_id;
    try {
      await call(
        `${lobbyPath(rid)}/claim-participation`,
        {
          profile_passphrase: profilePassphrase,
          entity_type: type,
          entity_id: id,
          player_id: m.ghost_profile_id || m.player_id,
        },
        'POST',
      );
      setMessage({
        text: tx(
          "Requested — the organizer will confirm it's you. It will then appear in your Player Hub.",
        ),
        tone: 'ok',
      });
    } catch {
      setMessage({ text: tx('Could not request the claim. Please try again.'), tone: 'error' });
    }
  };
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {tx("Find tournaments you played in this club; the organizer confirms it's you.")}
      </Text>
      <Group align="flex-end" wrap="nowrap">
        <TextInput
          flex={1}
          label={tx('Your name')}
          placeholder={tx('Enter your name')}
          maxLength={128}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
        <Button variant="default" loading={busy} onClick={() => void search(name, true)}>
          {tx('Search')}
        </Button>
      </Group>
      {message && (
        <Text
          size="sm"
          c={message.tone === 'error' ? 'red' : message.tone === 'ok' ? 'green' : 'dimmed'}
          role="status"
        >
          {message.text}
        </Text>
      )}
      {matches.map((m) => (
        <Paper key={`${m.entity_type}:${m.entity_id}:${m.player_id}`} p="sm" variant="row">
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={0} miw={0}>
              <Text fw={600}>{m.player_name}</Text>
              <Text size="xs" c="dimmed">
                {eventLine(m)}
              </Text>
            </Stack>
            {m.already_linked ? (
              <Text size="xs" c="dimmed" maw={180}>
                {tx('Already connected to a profile — use your code or the email option.')}
              </Text>
            ) : (
              <Button variant="default" size="compact-md" onClick={() => void claim(m)}>
                {tx('This is me')}
              </Button>
            )}
          </Group>
        </Paper>
      ))}
    </Stack>
  );
}

// ---- Returning player: code / email / name ---------------------------------------------------------------

export function ReturningPlayer({
  rid,
  forceOpen,
  profilePassphrase,
  onEntry,
  onHubLogin,
}: {
  rid: string;
  forceOpen: number;
  profilePassphrase: string | null;
  onEntry: (entry: unknown) => void;
  onHubLogin: (session: { access_token: string; profile: unknown }) => void;
}) {
  useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>('code');
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeBusy, setCodeBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [emailMsg, setEmailMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [emailBusy, setEmailBusy] = useState(false);
  // A 409 on sign-up ("that name is taken") points here: open the section.
  useEffect(() => {
    if (forceOpen) setOpen('returning');
  }, [forceOpen]);
  // 1) the code of an entry in THIS lobby, 2) otherwise a Player Hub passphrase, which prefills the form.
  const login = async () => {
    const passphrase = code.trim();
    if (!passphrase) return;
    setCodeError('');
    setCodeBusy(true);
    try {
      try {
        onEntry(await call(`${lobbyPath(rid)}/player-login`, { passphrase }, 'POST'));
        return;
      } catch {
        /* Not an entry code here: try the Hub. */
      }
      try {
        onHubLogin(await call(`/player-profile/login`, { passphrase }, 'POST'));
        return;
      } catch {
        setCodeError(tx('Passphrase not found. Check and try again.'));
      }
    } finally {
      setCodeBusy(false);
    }
  };
  const recover = async () => {
    if (!isEmail(email)) {
      setEmailMsg({ text: tx('Please enter a valid email address.'), error: true });
      return;
    }
    setEmailBusy(true);
    try {
      await call(`/player-profile/recover-by-participation`, { email: email.trim() }, 'POST');
    } catch {
      /* Always neutral: never reveal whether the address matched. */
    }
    setEmailMsg({
      text: tx(
        "If an account exists for that email, we've sent a login link. Open it, then reopen this page.",
      ),
      error: false,
    });
    setEmailBusy(false);
  };
  return (
    <Accordion variant="contained" value={open} onChange={setOpen}>
      <Accordion.Item value="returning">
        <Accordion.Control>{tx('Returning? Log in to autofill or edit')}</Accordion.Control>
        <Accordion.Panel>
          <Tabs value={tab} onChange={setTab}>
            <Tabs.List mb="sm" grow>
              <Tabs.Tab value="code">{tx('I have my passphrase')}</Tabs.Tab>
              <Tabs.Tab value="email">{tx('Find me by email')}</Tabs.Tab>
              <Tabs.Tab value="name">{tx('No passphrase or email — find me by name')}</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="code">
              <Stack
                gap="sm"
                component="form"
                onSubmit={(e: React.FormEvent) => {
                  e.preventDefault();
                  void login();
                }}
              >
                <Text size="sm" c="dimmed">
                  {tx('Autofill your details — or edit or cancel your existing entry.')}
                </Text>
                <TextInput
                  label={tx('Your passphrase')}
                  placeholder={tx('word-word-word')}
                  maxLength={128}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.currentTarget.value)}
                  error={codeError || undefined}
                />
                <Button type="submit" variant="default" loading={codeBusy}>
                  {tx('Log in')}
                </Button>
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="email">
              <Stack
                gap="sm"
                component="form"
                onSubmit={(e: React.FormEvent) => {
                  e.preventDefault();
                  void recover();
                }}
              >
                <Text size="sm" c="dimmed">
                  {tx("We'll email a login link if we find past registrations.")}
                </Text>
                <TextInput
                  label={tx('Email')}
                  type="email"
                  maxLength={320}
                  placeholder={tx('your@email.com')}
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.currentTarget.value)}
                />
                {emailMsg && (
                  <Text size="sm" c={emailMsg.error ? 'red' : 'green'} role="status">
                    {emailMsg.text}
                  </Text>
                )}
                <Button type="submit" variant="default" loading={emailBusy}>
                  {tx('Email me a login link')}
                </Button>
              </Stack>
            </Tabs.Panel>
            <Tabs.Panel value="name">
              <NameSearch rid={rid} profilePassphrase={profilePassphrase} />
            </Tabs.Panel>
          </Tabs>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
