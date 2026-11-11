import { useState } from 'react';
import {
  Button,
  Center,
  Divider,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import { publicApi } from '../events/api';
import { ApiError } from '../api';
import { t as tx, useLocale } from '../i18n';
import { DEMO_LAST_KEY, useAuth } from '../auth';
import { isDemoInstance } from '../shell/env';
import { Notice } from '../ui/Notice';

function lastDemo(): string {
  try {
    const raw = localStorage.getItem(DEMO_LAST_KEY);
    return raw ? ((JSON.parse(raw) as { u?: string }).u ?? '') : '';
  } catch {
    return '';
  }
}

interface PublicConfig {
  demo_url: string | null;
  demo_ttl_days: number;
}

// The demo site's admin page: a bare demo address gets /admin, because its root sends cold starts to /events.
function demoLink(url: string): { href: string; host: string } {
  try {
    const parsed = new URL(url);
    if (parsed.pathname === '/' || parsed.pathname === '') parsed.pathname = '/admin';
    return { href: parsed.href, host: parsed.host };
  } catch {
    return { href: url, host: '' };
  }
}

export function AdminLogin() {
  useLocale();
  const { login, startDemo } = useAuth();
  const demo = isDemoInstance();
  // The main site points at the separate demo site when one is configured (`demo_url`).
  const config = useQuery({
    queryKey: ['public', 'config'],
    queryFn: () => publicApi<PublicConfig>('/config'),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const sandbox = !demo && config.data?.demo_url ? demoLink(config.data.demo_url) : null;
  const returning = demo ? lastDemo() : '';
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  const [username, setUsername] = useState(returning);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  return (
    <Center p="xl">
      <Paper className="login-card" p="xl" w="100%" maw={420}>
        <Title order={2}>{tx('Welcome back')}</Title>
        <Text c="dimmed" mt="xs" mb="xl">
          {tx('Log in to manage your events and club.')}
        </Text>
        {sandbox && (
          <Stack gap="xs" mb="lg" data-testid="demo-link">
            <Notice title={tx('Try the demo sandbox')}>
              {tx('Run a real tournament from start to finish without signing up.')}
            </Notice>
            <Button
              component="a"
              href={sandbox.href}
              rel="nofollow"
              size="md"
              rightSection={<IconArrowRight size={18} />}
            >
              {tx('Open the demo sandbox')}
            </Button>
            {sandbox.host && (
              <Text size="xs" c="dimmed">
                {tx('Opens {host}, a separate practice site. Nothing here is affected.', {
                  host: sandbox.host,
                })}
              </Text>
            )}
            <Divider label={tx('or log in to your account')} labelPosition="center" mt="sm" />
          </Stack>
        )}
        {demo && (
          <Stack gap="xs" mb="lg">
            <Notice title={tx('Try the demo sandbox')}>
              {tx(
                'Start a practice account in one click, with no sign-up. It keeps one tournament at a time and is deleted after a few days.',
              )}
            </Notice>
            <Button
              size="md"
              loading={starting}
              rightSection={<IconArrowRight size={18} />}
              data-testid="start-demo"
              onClick={async () => {
                setError('');
                setStarting(true);
                try {
                  await startDemo();
                } catch (e) {
                  const status = e instanceof ApiError ? e.status : 0;
                  setError(
                    status === 429
                      ? tx(
                          'Too many demo accounts were created from your network. Try again later.',
                        )
                      : status === 404
                        ? tx('The demo is not available here.')
                        : tx('Could not start the demo. Try again in a moment.'),
                  );
                } finally {
                  setStarting(false);
                }
              }}
            >
              {tx('Start the demo')}
            </Button>
            <Divider label={tx('or log in')} labelPosition="center" mt="sm" />
          </Stack>
        )}
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setError('');
            setBusy(true);
            try {
              await login(username, password);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Stack>
            {notice === 'reset' && (
              <Notice tone="success" role="status">
                {tx('Password updated. Log in with your new password.')}
              </Notice>
            )}
            {notice === 'invite' && (
              <Notice tone="success" role="status">
                {tx('Account created. Log in to continue.')}
              </Notice>
            )}
            {returning && (
              <Notice role="status">
                {tx(
                  'Your demo sandbox on this device is {name}. Enter its passphrase to continue.',
                  {
                    name: returning,
                  },
                )}
              </Notice>
            )}
            {error && (
              <Notice tone="danger" role="alert">
                {error}
              </Notice>
            )}
            <TextInput
              label={tx('Username')}
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
            />
            <PasswordInput
              label={tx('Password')}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
            />
            <Button
              type="submit"
              loading={busy}
              size="md"
              rightSection={<IconArrowRight size={18} />}
              mt="sm"
            >
              {tx('Log in')}
            </Button>
            <Button component={Link} to="/events" variant="subtle" color="gray">
              {tx('Explore public events')}
            </Button>
            <Text size="xs" c="dimmed" ta="center">
              <Link to="/admin/account/forgot">{tx('Forgot your password?')}</Link>
            </Text>
          </Stack>
        </form>
      </Paper>
    </Center>
  );
}
