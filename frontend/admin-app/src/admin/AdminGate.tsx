import { useEffect, useState } from 'react';
import { Alert, Box, CloseButton, Group, Text } from '@mantine/core';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { DEMO_PASSPHRASE_KEY, useAuth } from '../auth';
import { CopyField } from '../ui';
import { t as tx, useLocale, localeTag } from '../i18n';
import { Loading } from '../components';
import { useOpenItemsSync } from '../features/switcher/useOpenItemsSync';
import { AdminLogin } from './AdminLogin';

// Keeps the open-items list in step with the route and the server. Mounted only for signed-in sessions.
function OpenItemsSync() {
  useOpenItemsSync();
  return null;
}

// The demo sandbox's passphrase is the account password and is shown once; save it to sign in again.
function DemoBanner({
  username,
  expires,
}: {
  username: string;
  expires: string | null | undefined;
}) {
  useLocale();
  const [phrase, setPhrase] = useState(() => {
    try {
      return sessionStorage.getItem(DEMO_PASSPHRASE_KEY);
    } catch {
      return null;
    }
  });
  const until = expires ? new Date(expires) : null;
  return (
    <Alert color="yellow" variant="light" mb="md" data-testid="demo-banner">
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Text size="sm" fw={600}>
          {tx('Demo sandbox')}: {username}
          {until && !Number.isNaN(until.getTime())
            ? ` · ${tx('deleted on {date}', { date: until.toLocaleDateString(localeTag()) })}`
            : ''}
        </Text>
        {phrase && (
          <CloseButton
            aria-label={tx('Dismiss')}
            onClick={() => {
              try {
                sessionStorage.removeItem(DEMO_PASSPHRASE_KEY);
              } catch {
                /* Dismissal is cosmetic. */
              }
              setPhrase(null);
            }}
          />
        )}
      </Group>
      {phrase && (
        <>
          <Text size="sm" mt={4}>
            {tx(
              'Your passphrase is the account password. Save it to log in again from any device.',
            )}
          </Text>
          <CopyField value={phrase} label={tx('Passphrase')} />
        </>
      )}
    </Alert>
  );
}

// Guards every /admin/* route. Without a session the login form renders in place and
// the URL is kept, so a deep link (/admin/t/<id>) resumes right after sign-in. Navigation
// (dock, tabs, switcher) belongs to the app shell; this renders the page body only.
export function AdminGate() {
  const { user, loading, hasToken, validate } = useAuth();
  const { search } = useLocation();
  useEffect(() => {
    if (hasToken && !user) validate();
  }, [hasToken, user, validate]);
  // Emailed links land on /admin?invite_token=...; the account pages read and strip the token.
  const params = new URLSearchParams(search);
  if (params.has('reset_token')) return <Navigate to={`/admin/account/reset${search}`} replace />;
  if (params.has('invite_token')) return <Navigate to={`/admin/account/invite${search}`} replace />;
  if (loading) return <Loading />;
  if (!user) return <AdminLogin />;
  return (
    <>
      <OpenItemsSync />
      <Box maw={1100} mx="auto" px={{ base: 'sm', sm: 'md' }} py="md">
        {user.is_demo && <DemoBanner username={user.username} expires={user.demo_expires_at} />}
        <Outlet />
      </Box>
    </>
  );
}
