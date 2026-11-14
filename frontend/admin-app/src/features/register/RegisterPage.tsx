import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Accordion,
  Badge,
  Box,
  Button,
  CopyButton,
  Group,
  Image,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconCopy, IconMail, IconQrcode } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ErrorState, Loading } from '../../components';
import { currentLanguage, t as tx, useLocale } from '../../i18n';
import { isDemoInstance } from '../../shell/env';
import { sportProps } from '../../theme';
import { ConfirmAction, FormActions, QrSheet } from '../../ui';
import { Markdown } from '../public/Markdown';
import {
  FeeNotice,
  IdentityStrip,
  LinkedTournaments,
  NameSearch,
  OrganizerMessage,
  PaymentPanel,
  PlayerChips,
  QuestionField,
  ReturningPlayer,
} from './Parts';
import {
  call,
  clearHub,
  collectAnswers,
  draftValue,
  isEmail,
  isNotFound,
  kindOf,
  lobbyPath,
  readEntryToken,
  readHub,
  saveHub,
  writeEntryToken,
  type Answer,
  type Entry,
  type PublicLobby,
} from './model';
import { Notice } from '../../ui/Notice';
import { PageContainer } from '../../ui/PageContainer';

const draftKey = (rid: string, playerId: string) => `amistoso-reg-draft:${rid}:${playerId}`;

function Heading({ lobby, level = 1 }: { lobby: PublicLobby; level?: 1 | 2 }) {
  const identity =
    lobby.club_name || (lobby.community_id === 'open' ? '' : lobby.community_name) || '';
  return (
    <Stack gap={4}>
      <Group gap="md" wrap="nowrap">
        {lobby.club_logo_url && (
          <Image src={lobby.club_logo_url} alt="" h={56} w="auto" fit="contain" />
        )}
        <Title order={level}>{lobby.name}</Title>
      </Group>
      {identity && (
        <Text c="dimmed" fw={600}>
          {identity}
        </Text>
      )}
    </Stack>
  );
}

// ---- The sign-up form ---------------------------------------------------------------------------------------

function SignUp({
  lobby,
  rid,
  hubProfile,
  profilePassphrase,
  forceReturning,
  onRegistered,
  onEntry,
  onHubLogin,
  onHubLogout,
}: {
  lobby: PublicLobby;
  rid: string;
  hubProfile: ReturnType<typeof readHub>['profile'];
  profilePassphrase: string | null;
  forceReturning: number;
  onRegistered: (entry: Entry, email: string) => void;
  onEntry: (entry: unknown) => void;
  onHubLogin: (session: { access_token: string; profile: unknown }) => void;
  onHubLogout: () => void;
}) {
  useLocale();
  const questions = lobby.questions ?? [];
  const mode = lobby.email_requirement ?? 'optional';
  const [name, setName] = useState(hubProfile?.name ?? '');
  const [email, setEmail] = useState(hubProfile?.email ?? '');
  const [code, setCode] = useState('');
  const [values, setValues] = useState<Record<string, Answer>>(() =>
    Object.fromEntries(
      questions.map((q) => [
        q.key,
        q.key === 'contact' && hubProfile?.contact ? hubProfile.contact : draftValue(q),
      ]),
    ),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bump, setBump] = useState(0);
  const prefilled = !!(hubProfile?.name || hubProfile?.email);
  const submit = async () => {
    setError('');
    if (!name.trim()) return setError(tx('Please enter your name.'));
    const typed = email.trim();
    if (mode === 'required' && !typed)
      return setError(tx('Email is required for this registration.'));
    if (typed && !isEmail(typed)) return setError(tx('Please enter a valid email address.'));
    if (lobby.join_code_required && !code.trim()) return setError(tx('Join code is required.'));
    const collected = collectAnswers(questions, values);
    if ('missing' in collected) return setError(tx('Please fill in all required fields.'));
    const body: Record<string, unknown> = { player_name: name.trim(), lang: currentLanguage() };
    if (typed && mode !== 'disabled') body.email = typed;
    if (lobby.join_code_required) body.join_code = code.trim();
    if (Object.keys(collected.answers).length) body.answers = collected.answers;
    // A signed-in Player Hub profile is linked to the new entry.
    if (profilePassphrase) body.profile_passphrase = profilePassphrase;
    setBusy(true);
    try {
      const result = await call<Entry>(`${lobbyPath(lobby.id)}/register`, body, 'POST');
      onRegistered({ ...result, answers: collected.answers }, typed);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) {
        setError(
          tx(
            'A player with this name is already registered. If that\'s you, use "Played before?" below to recover your entry.',
          ),
        );
        setBump((n) => n + 1);
      } else setError(tx((e as Error).message) || tx('Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack gap="md">
      <Group gap="xs">
        <Badge variant="light" size="lg" data-testid="registrant-count">
          {lobby.registrant_count}{' '}
          {tx(lobby.registrant_count === 1 ? 'player registered' : 'players registered')}
        </Badge>
      </Group>
      {lobby.description && <Markdown source={lobby.description} />}
      <OrganizerMessage message={lobby.message} />
      <FeeNotice payment={lobby.payment} />
      <PlayerChips lobby={lobby} />
      <LinkedTournaments lobby={lobby} entryToken={readEntryToken([lobby.id, rid])} />
      {!isDemoInstance() && (
        <IdentityStrip
          name={hubProfile?.name || hubProfile?.email || ''}
          signedIn={!!profilePassphrase}
          registered={false}
          onLogout={onHubLogout}
        />
      )}
      {!profilePassphrase && (
        <ReturningPlayer
          rid={rid}
          forceOpen={bump + forceReturning}
          profilePassphrase={profilePassphrase}
          onEntry={onEntry}
          onHubLogin={onHubLogin}
        />
      )}
      <Paper
        p="md"
        component="form"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          void submit();
        }}
        noValidate
      >
        <Stack gap="sm">
          {prefilled && (
            <Text size="sm" c="dimmed">
              {tx('Pre-filled from your player profile')}
            </Text>
          )}
          <TextInput
            label={tx('Your name')}
            placeholder={tx('Enter your name')}
            maxLength={128}
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          {mode !== 'disabled' && (
            <TextInput
              label={mode === 'required' ? tx('Email (required)') : tx('Email (optional)')}
              type="email"
              maxLength={320}
              required={mode === 'required'}
              placeholder={tx('your@email.com')}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
            />
          )}
          {lobby.join_code_required && (
            <TextInput
              label={tx('Join code')}
              placeholder={tx('Enter the join code')}
              maxLength={64}
              required
              value={code}
              onChange={(e) => setCode(e.currentTarget.value)}
            />
          )}
          {questions.map((q) => (
            <QuestionField
              key={q.key}
              q={q}
              value={values[q.key] ?? (kindOf(q) === 'multi' ? [] : '')}
              onChange={(v) => setValues((cur) => ({ ...cur, [q.key]: v }))}
            />
          ))}
          {error && (
            <Notice tone="danger" role="alert" data-testid="register-error">
              {error}
            </Notice>
          )}
          <Button type="submit" size="touch" loading={busy}>
            {tx('Register')}
          </Button>
        </Stack>
      </Paper>
    </Stack>
  );
}

// ---- The visitor's own entry --------------------------------------------------------------------------------

function EntryView({
  lobby,
  rid,
  entry,
  submittedEmail,
  hub,
  onEntry,
  onWithdrawn,
  onHubCreated,
  onHubLogout,
}: {
  lobby: PublicLobby;
  rid: string;
  entry: Entry;
  submittedEmail: string;
  hub: ReturnType<typeof readHub>;
  onEntry: (entry: Entry) => void;
  onWithdrawn: () => void;
  onHubCreated: () => void;
  onHubLogout: () => void;
}) {
  useLocale();
  const questions = lobby.questions ?? [];
  const canManage = !!entry.passphrase && lobby.open;
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [qr, setQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = draftKey(rid, entry.player_id);
  const seed = (useStored: boolean): Record<string, Answer> => {
    let stored: Record<string, Answer> | null = null;
    if (useStored)
      try {
        stored = JSON.parse(sessionStorage.getItem(key) || 'null');
      } catch {
        stored = null;
      }
    return Object.fromEntries(
      questions.map((q) => [
        q.key,
        stored && q.key in stored ? stored[q.key] : draftValue(q, entry.answers[q.key]),
      ]),
    );
  };
  // The draft lives here (and in this tab's storage), so a poll or a language switch never loses typing.
  const [draft, setDraft] = useState(() => seed(true));
  useEffect(() => {
    // New questions appear in the draft; what was typed stays.
    setDraft((cur) => {
      const next = { ...cur };
      for (const q of questions)
        if (!(q.key in next)) next[q.key] = draftValue(q, entry.answers[q.key]);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions.length]);
  const change = (qKey: string, value: Answer) =>
    setDraft((cur) => {
      const next = { ...cur, [qKey]: value };
      try {
        sessionStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* The draft still lives in memory. */
      }
      return next;
    });
  const save = async () => {
    const collected = collectAnswers(questions, draft);
    if ('missing' in collected) return setError(tx('Please fill in all required fields.'));
    setBusy(true);
    setError('');
    try {
      const updated = await call<{ answers: Record<string, string> }>(
        `${lobbyPath(rid)}/player-answers`,
        { passphrase: entry.passphrase, answers: collected.answers },
        'PATCH',
      );
      const saved = updated.answers || {};
      onEntry({ ...entry, answers: saved });
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Nothing stored. */
      }
      setDraft(Object.fromEntries(questions.map((q) => [q.key, draftValue(q, saved[q.key])])));
      setEditing(false);
      notifications.show({ message: tx('Saved'), color: 'green' });
    } catch (e) {
      setError(tx((e as Error).message) || tx('Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async () => {
    setBusy(true);
    setError('');
    try {
      await call(`${lobbyPath(rid)}/player-cancel`, { passphrase: entry.passphrase }, 'POST');
      try {
        sessionStorage.removeItem(key);
      } catch {
        /* Nothing stored. */
      }
      notifications.show({ message: tx("You've withdrawn from this lobby."), color: 'gray' });
      onWithdrawn();
    } catch (e) {
      setError(tx((e as Error).message) || tx('Something went wrong. Please try again.'));
      setBusy(false);
      setConfirming(false);
    }
  };
  const link = `${window.location.origin}/register/${encodeURIComponent(rid)}${entry.token ? `?token=${encodeURIComponent(entry.token)}` : ''}`;
  return (
    <Stack gap="md" data-testid="entry-view">
      <Stack gap={4}>
        <Title order={1}>{tx("You're registered, {name}!", { name: entry.player_name })}</Title>
        <Text c="dimmed" fw={600}>
          {[
            lobby.name,
            lobby.club_name || (lobby.community_id === 'open' ? '' : lobby.community_name),
          ]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </Stack>
      {hub.jwt && !isDemoInstance() && (
        <IdentityStrip
          name={hub.profile?.name || hub.profile?.email || ''}
          signedIn
          caption={entry.profile_linked ? tx('Player Hub · linked to this entry') : undefined}
          onLogout={onHubLogout}
        />
      )}
      <Paper p="md" variant="court-panel">
        <Stack gap="xs">
          <Text variant="eyebrow">{tx('Your passphrase')}</Text>
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text
              ff="monospace"
              fw={700}
              fz="clamp(1.25rem, 5vw, 1.75rem)"
              style={{ overflowWrap: 'anywhere' }}
              data-testid="entry-passphrase"
            >
              {entry.passphrase}
            </Text>
            <Group gap="xs" wrap="nowrap">
              <CopyButton value={entry.passphrase}>
                {({ copied, copy }) => (
                  <Button
                    onClick={copy}
                    leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  >
                    {copied ? tx('Copied') : tx('Copy')}
                  </Button>
                )}
              </CopyButton>
              {entry.token && (
                <Button
                  variant="default"
                  leftSection={<IconQrcode size={16} />}
                  onClick={() => setQr(true)}
                >
                  {tx('QR code')}
                </Button>
              )}
            </Group>
          </Group>
          {entry.passphrase_differs_from_profile && (
            <Text size="sm" c="dimmed">
              {tx(
                'Note: your profile code was already in use in this lobby, so this entry has its own code — use the one shown above here.',
              )}
            </Text>
          )}
          <Text size="sm" c="dimmed">
            {tx("You'll need it to log in and submit scores.")}
          </Text>
        </Stack>
      </Paper>
      {entry.token && (
        <QrSheet
          opened={qr}
          onClose={() => setQr(false)}
          title={tx('Your entry link')}
          caption={tx('Scan to open your entry on another device.')}
          value={link}
          filename="entry-qr.svg"
        />
      )}
      {canManage && (
        <Stack gap="sm">
          <Group justify="space-between">
            {questions.length > 0 ? (
              <Button
                variant="default"
                aria-expanded={editing}
                onClick={() => setEditing((o) => !o)}
              >
                {tx('Edit answers')}
              </Button>
            ) : (
              <span />
            )}
            <Button variant="subtle" color="red" onClick={() => setConfirming(true)}>
              {tx('Withdraw')}
            </Button>
          </Group>
          {editing && (
            <Paper p="md">
              <Stack gap="sm">
                {questions.map((q) => (
                  <QuestionField
                    key={q.key}
                    q={q}
                    value={draft[q.key] ?? (kindOf(q) === 'multi' ? [] : '')}
                    onChange={(v) => change(q.key, v)}
                  />
                ))}
                <FormActions onCancel={() => setEditing(false)}>
                  <Button loading={busy} onClick={() => void save()}>
                    {tx('Save answers')}
                  </Button>
                </FormActions>
              </Stack>
            </Paper>
          )}
          <ConfirmAction
            opened={confirming}
            title={tx('Withdraw')}
            description={tx('Withdraw from this lobby? Your spot will be released.')}
            confirmLabel={tx('Yes, withdraw')}
            cancelLabel={tx('Keep my spot')}
            color="red"
            loading={busy}
            onConfirm={() => void withdraw()}
            onClose={() => setConfirming(false)}
          />
          {error && <Notice tone="danger">{error}</Notice>}
        </Stack>
      )}
      {entry.payment && (
        <PaymentPanel
          rid={rid}
          payment={entry.payment}
          credential={
            entry.passphrase ? { passphrase: entry.passphrase } : { token: entry.token ?? '' }
          }
          onChange={(payment) => onEntry({ ...entry, payment })}
        />
      )}
      <Button component={Link} to="/events" variant="light" w="fit-content">
        {tx('Back to registrations')}
      </Button>
      {lobby.description && <Markdown source={lobby.description} />}
      <OrganizerMessage message={lobby.message} />
      <PlayerChips lobby={lobby} open={false} />
      <LinkedTournaments
        lobby={lobby}
        entryToken={entry.token ?? readEntryToken([lobby.id, rid])}
      />
      {!isDemoInstance() && (
        <HubSections
          entry={entry}
          email={submittedEmail}
          emailSent={!!lobby.auto_send_email}
          lobbyRid={rid}
          hub={hub}
          onCreated={onHubCreated}
        />
      )}
    </Stack>
  );
}

// "Save your player profile" (one passphrase for all events) and, once there is a profile, the finder
// for past participations.
function HubSections({
  entry,
  email,
  emailSent,
  lobbyRid,
  hub,
  onCreated,
}: {
  entry: Entry;
  email: string;
  /** The lobby e-mails a confirmation with a Hub login link to every registrant with an address. */
  emailSent: boolean;
  lobbyRid: string;
  hub: ReturnType<typeof readHub>;
  onCreated: () => void;
}) {
  useLocale();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ passphrase: string; same: boolean } | null>(null);
  const linked = !!entry.profile_linked || !!hub.profile?.passphrase;
  const create = async () => {
    const address = (email || typed).trim();
    if (!isEmail(address)) return setError(tx('Enter your email to create a player profile'));
    setBusy(true);
    setError('');
    try {
      const data = await call<{ access_token: string; profile: { passphrase: string } }>(
        `/player-profile`,
        {
          participant_passphrase: entry.passphrase,
          name: entry.player_name || '',
          email: address,
          contact: entry.answers?.contact ?? '',
          lang: currentLanguage(),
        },
        'POST',
      );
      saveHub(data.access_token, data.profile);
      setCreated({
        passphrase: data.profile.passphrase,
        same: data.profile.passphrase === entry.passphrase,
      });
      onCreated();
    } catch (e) {
      setError(tx((e as Error).message) || tx('Could not create profile. Please try again.'));
    } finally {
      setBusy(false);
    }
  };
  const profilePassphrase = hub.profile?.passphrase ?? created?.passphrase ?? null;
  const signedIn = !!hub.jwt || !!created;
  return (
    <Stack gap="sm">
      {created ? (
        <Notice tone="success" icon={<IconCheck />} title={tx('Player profile created!')}>
          {created.same ? (
            <Text size="sm">{tx('Use the same passphrase as above for your player profile.')}</Text>
          ) : (
            <Stack gap={4}>
              <Text size="sm">{tx('Your player profile passphrase:')}</Text>
              <Text ff="monospace" fw={700}>
                {created.passphrase}
              </Text>
            </Stack>
          )}
        </Notice>
      ) : linked || signedIn ? null : emailSent && isEmail(email) ? (
        <Notice tone="info" icon={<IconMail />} title={tx('Check your email')}>
          <Text size="sm">
            {tx(
              'We sent you a link to your player profile. Open it to see all your events in one place.',
            )}
          </Text>
        </Notice>
      ) : (
        <Accordion variant="contained">
          <Accordion.Item value="profile">
            <Accordion.Control>{tx('Save your player profile')}</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  {tx('One passphrase for all your events.')}
                </Text>
                {!email && (
                  <TextInput
                    type="email"
                    maxLength={320}
                    label={tx('Enter your email to create a player profile')}
                    placeholder={tx('your@email.com')}
                    value={typed}
                    onChange={(e) => setTyped(e.currentTarget.value)}
                  />
                )}
                {error && <Notice tone="danger">{error}</Notice>}
                <Button loading={busy} onClick={() => void create()}>
                  {tx('Save your player profile')}
                </Button>
                <Text size="sm" c="dimmed">
                  {tx('Already have a player profile?')}{' '}
                  <Text component={Link} to="/player" size="sm">
                    {tx('Login with a passphrase')}
                  </Text>
                </Text>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
      {signedIn && (
        <Accordion variant="contained">
          <Accordion.Item value="past">
            <Accordion.Control>
              {tx('Played here before? Find your past participations')}
            </Accordion.Control>
            <Accordion.Panel>
              <NameSearch rid={lobbyRid} profilePassphrase={profilePassphrase} />
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Stack>
  );
}

// ---- The page -----------------------------------------------------------------------------------------------

// `/register/<alias or id>`: the public sign-up. Anonymous. The visitor can sign up, find and edit their
// own entry (by passphrase, by Player Hub login, or by the e-mailed link `?token=`), withdraw, and report
// a payment. Nothing here sends the organizer token.
export function RegisterPage() {
  const { slug = '' } = useParams();
  // Keyed by slug: another lobby's sign-up starts with no entry or form state.
  return <Register key={slug} slug={slug} />;
}

function Register({ slug }: { slug: string }) {
  useLocale();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [hub, setHub] = useState(readHub);
  const [returning, setReturning] = useState(0);
  const [booting, setBooting] = useState(true);
  const handled = useRef(false);
  const redirected = useRef(false);
  const lobbyQuery = useQuery({
    queryKey: ['public', 'registration', slug],
    queryFn: () => call<PublicLobby>(`${lobbyPath(slug)}/public`),
    retry: false,
    // After sign-up the page follows the lobby (new players, a started tournament) every 8 seconds.
    refetchInterval: () => (entry && !document.hidden ? 8000 : false),
    refetchOnWindowFocus: false,
  });
  const lobby = lobbyQuery.data;
  const refreshHub = useCallback(() => setHub(readHub()), []);

  const adopt = useCallback(
    (data: unknown) => {
      const d = data as Entry;
      setEntry({
        player_id: d.player_id,
        player_name: d.player_name,
        passphrase: d.passphrase,
        token: d.token ?? null,
        answers: d.answers || {},
        payment: d.payment ?? null,
        profile_linked: d.profile_linked,
        passphrase_differs_from_profile: d.passphrase_differs_from_profile,
      });
      if (d.token && lobby) writeEntryToken(lobby.id, d.token);
    },
    [lobby],
  );

  // The entry of the Player Hub profile saved in this browser, if it is registered here.
  const findEntry = useCallback(
    async (l: PublicLobby) => {
      if (!l.open) return;
      const { jwt, profile } = readHub();
      if (!jwt && !profile?.passphrase) return;
      // Preferred: the profile token finds the entry through the profile link, even with a stale passphrase.
      try {
        if (jwt) {
          adopt(await call(`${lobbyPath(slug)}/my-entry`, undefined, 'GET', jwt));
          return;
        }
      } catch {
        /* No linked entry, or the token expired. */
      }
      if (profile?.passphrase)
        try {
          adopt(
            await call(
              `${lobbyPath(slug)}/player-login`,
              { passphrase: profile.passphrase },
              'POST',
            ),
          );
        } catch {
          /* The profile is not registered here: show the form. */
        }
    },
    [slug, adopt],
  );

  // First load: the e-mailed entry link (`?token=`), a Hub magic link (`#hub_token=`), then the Hub
  // profile saved in this browser. Credentials are taken out of the address bar before anything else.
  useEffect(() => {
    if (!lobby || handled.current) return;
    handled.current = true;
    const urlToken = params.get('token');
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const hubToken = hash.get('hub_token');
    if (urlToken) {
      const next = new URLSearchParams(params);
      next.delete('token');
      setParams(next, { replace: true });
    }
    if (hubToken) {
      hash.delete('hub_token');
      const rest = hash.toString();
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search + (rest ? `#${rest}` : ''),
      );
    }
    void (async () => {
      try {
        if (hubToken) {
          try {
            const space = await call<{ access_token?: string; profile?: unknown }>(
              '/player-profile/space',
              undefined,
              'GET',
              hubToken,
            );
            if (space.profile) saveHub(space.access_token || hubToken, space.profile);
            // Opening the e-mailed link proves the address: verify it and link this entry, as the Hub does.
            await call('/player-profile/confirm-email-link', {}, 'POST', hubToken).catch(
              () => undefined,
            );
            refreshHub();
          } catch {
            /* An expired link just leaves the visitor anonymous. */
          }
        }
        if (urlToken) {
          try {
            adopt(await call(`${lobbyPath(slug)}/player-login`, { token: urlToken }, 'POST'));
            return;
          } catch {
            /* An invalid or expired link falls through to the normal page. */
          }
        }
        await findEntry(lobby);
      } finally {
        setBooting(false);
      }
    })();
  }, [lobby, params, setParams, slug, adopt, refreshHub, findEntry]);

  // The lobby closed while the visitor was looking: a started tournament takes them to it.
  useEffect(() => {
    if (!lobby || !entry || redirected.current) return;
    const tids = lobby.converted_to_tids?.length
      ? lobby.converted_to_tids
      : lobby.converted_to_tid
        ? [lobby.converted_to_tid]
        : [];
    if (!tids.length || lobby.open) return;
    redirected.current = true;
    notifications.show({ message: tx('Tournament started! Redirecting…'), color: 'green' });
    const token = entry.token ?? readEntryToken([lobby.id, slug]);
    const timer = window.setTimeout(
      () =>
        navigate(
          `/tv/${encodeURIComponent(tids[tids.length - 1])}${token ? `?player_token=${encodeURIComponent(token)}` : ''}`,
        ),
      2000,
    );
    return () => window.clearTimeout(timer);
  }, [lobby, entry, slug, navigate]);

  const profilePassphrase = hub.jwt ? (hub.profile?.passphrase ?? null) : null;
  const onHubLogin = useCallback(
    (session: { access_token: string; profile: unknown }) => {
      if (session.access_token) saveHub(session.access_token, session.profile);
      refreshHub();
      // A registered Hub player lands on their entry, not on the form.
      if (lobby) void findEntry(lobby);
    },
    [lobby, refreshHub, findEntry],
  );

  if (lobbyQuery.error) {
    if (isNotFound(lobbyQuery.error)) {
      const to = new URLSearchParams({
        m: tx(
          'Registration data not found. The link may be wrong or the registration may have been deleted.',
        ),
        to: '/events',
      });
      return <Navigate to={`/404?${to}`} replace />;
    }
    return (
      <PageContainer size="sm">
        <Notice tone="danger" title={tx('Something went wrong. Please try again.')}>
          <Button variant="subtle" color="red" onClick={() => void lobbyQuery.refetch()}>
            {tx('Try again')}
          </Button>
        </Notice>
      </PageContainer>
    );
  }
  if (!lobby) return lobbyQuery.isPending ? <Loading /> : <ErrorState error={null} />;
  if (booting && lobby.open) return <Loading />;

  let body;
  if (entry) {
    body = (
      <EntryView
        lobby={lobby}
        rid={slug}
        entry={entry}
        submittedEmail={submittedEmail}
        hub={hub}
        onEntry={setEntry}
        onWithdrawn={() => {
          setEntry(null);
          void client.invalidateQueries({ queryKey: ['public', 'registration', slug] });
        }}
        onHubCreated={refreshHub}
        onHubLogout={() => {
          clearHub();
          refreshHub();
        }}
      />
    );
  } else if (!lobby.open) {
    body = (
      <Stack gap="md">
        <Heading lobby={lobby} level={1} />
        {lobby.description && <Markdown source={lobby.description} />}
        <OrganizerMessage message={lobby.message} />
        <PlayerChips lobby={lobby} />
        {lobby.converted ? (
          <>
            <Badge size="lg" color="ball" variant="filled" w="fit-content">
              {tx('Tournament started')}
            </Badge>
            <Text>{tx('This registration has been converted to a tournament.')}</Text>
            <LinkedTournaments lobby={lobby} entryToken={readEntryToken([lobby.id, slug])} />
          </>
        ) : (
          <Notice tone="neutral">{tx('Registration is closed.')}</Notice>
        )}
      </Stack>
    );
  } else {
    body = (
      <Stack gap="md">
        <Heading lobby={lobby} />
        <SignUp
          key={`${hub.jwt ?? ''}`}
          lobby={lobby}
          rid={slug}
          hubProfile={hub.profile}
          profilePassphrase={profilePassphrase}
          forceReturning={returning}
          onRegistered={(result, email) => {
            setSubmittedEmail(email);
            setReturning(0);
            setEntry(result);
            if (result.token) writeEntryToken(lobby.id, result.token);
            lobby.registrant_count += 1;
          }}
          onEntry={(data) => {
            adopt(data);
            setBooting(false);
          }}
          onHubLogin={onHubLogin}
          onHubLogout={() => {
            clearHub();
            refreshHub();
          }}
        />
      </Stack>
    );
  }
  return (
    <PageContainer size="sm" {...sportProps(lobby.sport)}>
      <Box data-testid="register-page">{body}</Box>
    </PageContainer>
  );
}
