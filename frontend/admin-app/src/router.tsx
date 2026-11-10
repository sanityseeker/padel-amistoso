import { lazy, type ReactNode } from 'react';
import { Box } from '@mantine/core';
import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { AdminGate } from './admin/AdminGate';
import { AcceptInvitePage } from './admin/account/AcceptInvite';
import { ForgotPasswordPage } from './admin/account/ForgotPassword';
import { ResetPasswordPage } from './admin/account/ResetPassword';
import { useAuth } from './auth';
import { NotFound } from './shell/NotFound';
import { RootRedirect } from './shell/RootRedirect';
import { AppLayout } from './shell/AppLayout';

const EventsApp = lazy(() =>
  import('./features/events/EventsPage').then((m) => ({ default: m.EventsPage })),
);
// Read before the router exists, so email-link credentials survive any redirect.
import './features/player/linkParams';
const PlayerLayout = lazy(() =>
  import('./features/player/PlayerLayout').then((m) => ({ default: m.PlayerLayout })),
);
const Hub = lazy(() => import('./features/player/pages/Hub'));
const PlayerMatches = lazy(() => import('./features/player/pages/Matches'));
const PlayerEvent = lazy(() => import('./features/player/pages/Event'));
const PlayerRatings = lazy(() => import('./features/player/pages/Ratings'));
const PlayerMe = lazy(() => import('./features/player/pages/Me'));
const TournamentsPage = lazy(() =>
  import('./features/hub/TournamentsHub').then((m) => ({ default: m.TournamentsHub })),
);
const NewTournamentPage = lazy(() =>
  import('./features/create/NewTournamentPage').then((m) => ({ default: m.NewTournamentPage })),
);
const TournamentPage = lazy(() =>
  import('./features/tournaments/pages/TournamentWorkspace').then((m) => ({
    default: m.TournamentWorkspace,
  })),
);
const LobbyPage = lazy(() =>
  import('./features/lobbies/LobbyPage').then((m) => ({ default: m.LobbyPage })),
);
const ClubsPage = lazy(() =>
  import('./features/organization/OrganizationPage').then((m) => ({ default: m.OrganizationPage })),
);
const ClubPage = lazy(() =>
  import('./features/organization/ClubPage').then((m) => ({ default: m.ClubPage })),
);
const UsersPage = lazy(() =>
  import('./features/organization/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const InfoPage = lazy(() =>
  import('./features/info/InfoPage').then((m) => ({ default: m.InfoPage })),
);
const TvPage = lazy(() => import('./features/tv/TvPage').then((m) => ({ default: m.TvPage })));
const RegisterPage = lazy(() =>
  import('./features/register/RegisterPage').then((m) => ({ default: m.RegisterPage })),
);
const ClubPathPage = lazy(() =>
  import('./features/club/ClubLanding').then((m) => ({ default: m.ClubPathLanding })),
);
const PlayersPage = lazy(() =>
  import('./features/players/AdminPlayers').then((m) => ({ default: m.AdminPlayersPage })),
);

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  return user?.role === 'admin' ? children : <Navigate to="/admin" replace />;
}
// Old hash-less links such as /admin/tournaments/<id> keep working.
function RedirectTournament() {
  const { id = '' } = useParams();
  return <Navigate to={`/admin/t/${id}`} replace />;
}

// Created after the hash migration in main.tsx, because the browser router reads
// the location when it is constructed.
export const createAppRouter = () =>
  createBrowserRouter([
    {
      element: <AppLayout />,
      children: [
        { path: '/', element: <RootRedirect /> },
        { path: '/events', element: <EventsApp />, handle: { title: 'Events' } },
        // Public pages (anonymous): the spectator screen, sign-up, and a club's landing page.
        { path: '/tv/:slug', element: <TvPage />, handle: { title: 'Tournament' } },
        { path: '/register/:slug', element: <RegisterPage />, handle: { title: 'Sign-up' } },
        { path: '/club/:slug', element: <ClubPathPage />, handle: { title: 'Club' } },
        { path: '/404', element: <NotFound />, handle: { title: 'Page not found' } },
        {
          path: '/player',
          element: <PlayerLayout />,
          handle: { title: 'Player Hub' },
          children: [
            { index: true, element: <Hub />, handle: { title: 'Hub' } },
            { path: 'matches', element: <PlayerMatches />, handle: { title: 'My events' } },
            { path: 'matches/:kind/:id', element: <PlayerEvent />, handle: { title: 'Event' } },
            { path: 'ratings', element: <PlayerRatings />, handle: { title: 'Ratings' } },
            { path: 'me', element: <PlayerMe />, handle: { title: 'Profile' } },
            { path: '*', element: <NotFound /> },
          ],
        },
        // Account recovery works without a session, so it sits outside the admin gate.
        {
          path: '/admin/account/forgot',
          element: <ForgotPasswordPage />,
          handle: { title: 'Forgot password' },
        },
        {
          path: '/admin/account/reset',
          element: <ResetPasswordPage />,
          handle: { title: 'Reset password' },
        },
        {
          path: '/admin/account/invite',
          element: <AcceptInvitePage />,
          handle: { title: 'Accept invite' },
        },
        // What the app does: public, like the account pages, so a visitor can read it before logging in.
        {
          path: '/admin/info',
          element: (
            <Box maw={900} mx="auto" px={{ base: 'sm', sm: 'md' }} py="md">
              <InfoPage />
            </Box>
          ),
          handle: { title: 'Info' },
        },
        {
          path: '/admin',
          element: <AdminGate />,
          handle: { title: 'Administration' },
          children: [
            { index: true, element: <TournamentsPage /> },
            { path: 'new', element: <NewTournamentPage />, handle: { title: 'New tournament' } },
            { path: 't/:id', element: <TournamentPage /> },
            { path: 'tournaments/:id', element: <RedirectTournament /> },
            // The lobby list is the events hub filtered to lobbies; old links and bookmarks land there.
            { path: 'lobbies', element: <Navigate to="/admin?type=lobby" replace /> },
            { path: 'lobby/:id', element: <LobbyPage /> },
            { path: 'clubs', element: <ClubsPage /> },
            { path: 'clubs/:id', element: <ClubPage /> },
            {
              path: 'players',
              element: (
                <AdminOnly>
                  <PlayersPage />
                </AdminOnly>
              ),
            },
            {
              path: 'users',
              element: (
                <AdminOnly>
                  <UsersPage />
                </AdminOnly>
              ),
            },
            { path: '*', element: <Navigate to="/admin" replace /> },
          ],
        },
        { path: '*', element: <NotFound />, handle: { title: 'Page not found' } },
      ],
    },
  ]);
