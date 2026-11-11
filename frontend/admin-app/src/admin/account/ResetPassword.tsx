import { useRef, useState } from 'react';
import { Button, Stack, Text } from '@mantine/core';
import { Link, useNavigate } from 'react-router-dom';
import { write } from '../../api';
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
import { Notice } from '../../ui/Notice';

export function ResetPasswordPage() {
  useLocale();
  const token = useUrlToken('reset_token');
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [dead, setDead] = useState(!token);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  if (done)
    return (
      <AccountCard title={tx('Password updated')}>
        <Notice tone="success" role="status">
          {tx('Your password has been changed. Log in with the new password.')}
        </Notice>
        <Button
          onClick={() => navigate('/admin', { replace: true, state: { notice: 'reset' } })}
          autoFocus
        >
          {tx('Go to log in')}
        </Button>
      </AccountCard>
    );

  if (dead)
    return (
      <AccountCard title={tx('Reset link not valid')}>
        <Notice tone="danger" role="alert">
          {tx('This reset link is invalid, expired or already used.')}
        </Notice>
        <Button component={Link} to="/admin/account/forgot">
          {tx('Request a new link')}
        </Button>
      </AccountCard>
    );

  return (
    <AccountCard title={tx('Choose a new password')}>
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setTouched(true);
          if (passwordProblem(password) || !password) return passwordRef.current?.focus();
          if (mismatchProblem(password, confirm) || !confirm) return confirmRef.current?.focus();
          setError('');
          setBusy(true);
          try {
            await write(`/auth/reset-password/${encodeURIComponent(token)}`, {
              new_password: password,
            });
            setDone(true);
          } catch (e) {
            const message = accountError(e, {
              404: tx('This reset link is invalid, expired or already used.'),
            });
            if ((e as { status?: number }).status === 404) setDead(true);
            else setError(message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Stack>
          <ErrorAlert error={error} />
          <PasswordPair
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
            {tx('Update password')}
          </Button>
          <Text size="sm" ta="center">
            <Link to="/admin">{tx('Back to log in')}</Link>
          </Text>
        </Stack>
      </form>
    </AccountCard>
  );
}
