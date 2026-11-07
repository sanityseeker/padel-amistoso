import { t as tx, useLocale } from './i18n';
import { lazy, Suspense, useState } from 'react';
import {
  Alert,
  Button,
  Center,
  Container,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { IconArrowRight } from '@tabler/icons-react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { PublicHeader, SupportLinks } from './PublicHeader';
import { Loading, useLiveUpdates } from './components';
const TournamentsPage = lazy(() =>
  import('./pages/Dashboard').then((m) => ({ default: m.TournamentsPage })),
);
const NewTournamentPage = lazy(() =>
  import('./pages/Dashboard').then((m) => ({ default: m.NewTournamentPage })),
);
const TournamentPage = lazy(() =>
  import('./pages/Tournament').then((m) => ({ default: m.TournamentPage })),
);
const LobbiesPage = lazy(() => import('./pages/Lobbies').then((m) => ({ default: m.LobbiesPage })));
const LobbyPage = lazy(() => import('./pages/Lobbies').then((m) => ({ default: m.LobbyPage })));
const ClubsPage = lazy(() =>
  import('./pages/Organization').then((m) => ({ default: m.ClubsPage })),
);
const UsersPage = lazy(() =>
  import('./pages/Organization').then((m) => ({ default: m.UsersPage })),
);
function Login() {
  useLocale();
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <PublicHeader current="admin" />
      <Center p="xl">
        <Paper className="login-card" p="xl" w="100%" maw={420}>
          <Group justify="space-between">
            <Title order={2}>{tx('Welcome back')}</Title>
          </Group>
          <Text c="dimmed" mt="xs" mb="xl">
            {tx('Log in to manage your events and club.')}
          </Text>
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
              {error && <Alert color="red">{error}</Alert>}
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
              <Button component="a" href="/events" variant="subtle" color="gray">
                {tx('Explore public events')}
              </Button>
              <Text size="xs" c="dimmed" ta="center">
                {tx('Need an invite or password reset?')}
                <a href="/legacy-admin">{tx('Account help')}</a>
              </Text>
            </Stack>
          </form>
        </Paper>
      </Center>
    </>
  );
}

function Workspace() {
  useLocale();
  const { user, logout } = useAuth();
  const location = useLocation();
  useLiveUpdates();
  return (
    <>
      <PublicHeader current="admin" />
      <Container size="lg" py="md">
        <Group justify="space-between" gap="sm" mb="lg" className="compact-admin-nav">
          <Group gap={4} component="nav" aria-label={tx('Administration')}>
            <Button component="a" href="/legacy-admin?tab=info" variant="subtle" size="sm">
              {tx('Info')}
            </Button>
            <Button
              component={Link}
              to="/"
              variant={
                location.pathname === '/' || location.pathname === '/tournaments'
                  ? 'light'
                  : 'subtle'
              }
              size="sm"
            >
              {tx('Tournaments')}
            </Button>
            <Button
              component={Link}
              to="/create"
              variant={location.pathname === '/create' ? 'light' : 'subtle'}
              size="sm"
            >
              {tx('New Tournament')}
            </Button>
          </Group>
          <Group gap="xs">
            <Button component={Link} to="/clubs" variant="subtle" size="compact-xs">
              {tx('Clubs & communities')}
            </Button>
            {user?.role === 'admin' && (
              <Button component={Link} to="/users" variant="subtle" size="compact-xs">
                {tx('Users')}
              </Button>
            )}
            <Button component="a" href="/legacy-admin" variant="subtle" size="compact-xs">
              {tx('Advanced admin')}
            </Button>
            <Text size="xs" c="dimmed">
              {user?.username}
            </Text>
            <Button variant="subtle" size="compact-xs" onClick={logout}>
              {tx('Log out')}
            </Button>
          </Group>
        </Group>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<TournamentsPage />} />
            <Route path="/tournaments" element={<TournamentsPage />} />
            <Route path="/create" element={<NewTournamentPage />} />
            <Route path="/tournaments/:id" element={<TournamentPage />} />
            <Route path="/registrations" element={<LobbiesPage />} />
            <Route path="/registrations/:id" element={<LobbyPage />} />
            <Route path="/clubs" element={<ClubsPage />} />
            <Route
              path="/users"
              element={user?.role === 'admin' ? <UsersPage /> : <Navigate to="/" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
        <SupportLinks />{' '}
      </Container>
    </>
  );
}
export function App() {
  const { user, loading } = useAuth();
  if (loading) return <Loading />;
  return user ? <Workspace /> : <Login />;
}
