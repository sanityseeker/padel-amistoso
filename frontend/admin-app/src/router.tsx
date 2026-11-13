import type { ReactNode } from 'react';
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

// Read before the router exists, so email-link credentials survive any redirect.
import './features/player/linkParams';
import {
  ClubPage,
  ClubPathPage,
  ClubsPage,
  EventsApp,
  Hub,
  InfoPage,
  LobbyPage,
  NewTournamentPage,
  PlayerEvent,
  PlayerLayout,
  PlayerMatches,
  PlayerMe,
  PlayerRatings,
  PlayersPage,
  RegisterPage,
  TournamentPage,
  TournamentsPage,
  TvPage,
  UsersPage,
} from './app/routes';

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
