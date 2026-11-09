import { useState } from 'react';
import { Alert, Button, Stack, Text, TextInput } from '@mantine/core';
import { Link } from 'react-router-dom';
import { write } from '../../api';
import { t as tx, useLocale } from '../../i18n';
import { AccountCard, accountError, ErrorAlert, looksLikeEmail } from './shared';

export function ForgotPasswordPage() {
  useLocale();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const invalid =
    touched && !looksLikeEmail(email) ? tx('Enter a valid email address.') : undefined;

  if (sent)
    return (
      <AccountCard title={tx('Check your email')}>
        <Alert color="green" role="status">
          {tx(
            'If an account exists for that email, we have sent a link to reset the password. The link expires after a short time.',
          )}
        </Alert>
        <Button component={Link} to="/admin" variant="light">
          {tx('Back to log in')}
        </Button>
      </AccountCard>
    );

  return (
    <AccountCard
      title={tx('Forgot your password?')}
      intro={tx(
        'Enter the email address of your organizer account and we will send you a reset link.',
      )}
    >
      <form
        noValidate
        onSubmit={async (event) => {
          event.preventDefault();
          setTouched(true);
          if (!looksLikeEmail(email)) return;
          setError('');
          setBusy(true);
          try {
            await write('/auth/forgot-password', { email: email.trim() });
            setSent(true);
          } catch (e) {
            setError(
              accountError(e, {
                503: tx(
                  'Password reset by email is not available here. Ask an organizer to reset it.',
                ),
              }),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <Stack>
          <ErrorAlert error={error} />
          <TextInput
            label={tx('Email')}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            onBlur={() => setTouched(true)}
            error={invalid}
          />
          <Button type="submit" loading={busy} disabled={busy} size="md">
            {tx('Send reset link')}
          </Button>
          <Text size="sm" ta="center">
            <Link to="/admin">{tx('Back to log in')}</Link>
          </Text>
        </Stack>
      </form>
    </AccountCard>
  );
}
