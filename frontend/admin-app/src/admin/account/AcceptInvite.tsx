import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Loader, Stack, Text, TextInput } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { api, write } from '../../api';
import { useAuth } from '../../auth';
import { t as tx, useLocale } from '../../i18n';
import { PasswordPair } from './PasswordPair';
import {
  AccountCard,
  accountError,
  ErrorAlert,
  mismatchProblem,
  passwordProblem,
  useUrlToken,
} from './shared';

const USERNAME = /^[a-zA-Z0-9_-]{3,64}$/;
interface Preview {
  email: string;
  role: string;
}

export function AcceptInvitePage() {
  useLocale();
  const token = useUrlToken('invite_token');
  const navigate = useNavigate();
  const { login } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dead, setDead] = useState(!token);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const userRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  // The token only ever goes into the request path, never into a query key or the log.
  useEffect(() => {
    if (!token) return;
    let live = true;
    api<Preview>(`/auth/invite/${encodeURIComponent(token)}`)
      .then((data) => live && setPreview(data))
      .catch(() => live && setDead(true));
    return () => {
      live = false;
    };
  }, [token]);

  if (dead)
    return (
      <AccountCard title={tx('Invite not valid')}>
        <Alert color="red" role="alert">
          {tx('This invite is invalid, expired or already used. Ask the organizer for a new one.')}
        </Alert>
        <Button component={Link} to="/admin">
          {tx('Back to log in')}
        </Button>
      </AccountCard>
    );

  if (!preview)
    return (
      <AccountCard title={tx('Accept your invite')}>
        <Loader size="sm" mx="auto" aria-label={tx('Loading')} />
      </AccountCard>
    );

  const usernameProblem =
    touched && !USERNAME.test(username)
      ? tx('Use 3 to 64 letters, numbers, dashes or underscores.')
      : undefined;

  return (
    <AccountCard
      title={tx('Accept your invite')}
      intro={tx('Create the organizer account for {email}.', { email: preview.email })}
    >
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setTouched(true);
          if (!USERNAME.test(username)) return userRef.current?.focus();
          if (passwordProblem(password) || !password) return passwordRef.current?.focus();
          if (mismatchProblem(password, confirm) || !confirm) return confirmRef.current?.focus();
          setError('');
          setBusy(true);
          try {
            await write(`/auth/invite/${encodeURIComponent(token)}/accept`, { username, password });
          } catch (e) {
            const status = (e as { status?: number }).status;
            if (status === 404) setDead(true);
            else {
              setError(
                accountError(e, { 409: tx('That username is already taken. Pick another.') }),
              );
              if (status === 409) userRef.current?.focus();
            }
            setBusy(false);
            return;
          }
          // The accept endpoint returns no token, so sign in with the credentials just chosen.
          try {
            await login(username, password);
            navigate('/admin', { replace: true });
          } catch {
            navigate('/admin', { replace: true, state: { notice: 'invite' } });
          }
        }}
      >
        <Stack>
          <ErrorAlert error={error} />
          <TextInput
            ref={userRef}
            label={tx('Username')}
            autoComplete="username"
            required
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            onBlur={() => setTouched(true)}
            error={usernameProblem}
          />
          <PasswordPair
            label={tx('Password')}
            password={password}
            confirm={confirm}
            touched={touched}
            onPassword={setPassword}
            onConfirm={setConfirm}
            onTouched={() => setTouched(true)}
            passwordRef={passwordRef}
            confirmRef={confirmRef}
          />
          <Button type="submit" loading={busy} disabled={busy} size="md">
            {tx('Create account')}
          </Button>
          <Text size="sm" ta="center">
            <Link to="/admin">{tx('Back to log in')}</Link>
          </Text>
        </Stack>
      </form>
    </AccountCard>
  );
}
