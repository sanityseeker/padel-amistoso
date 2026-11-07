import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { AuthProvider } from './auth';
import { Loading } from './components';
import { theme, cssVariablesResolver, colorSchemeManager } from './theme';
import { ThemeSync } from './ThemeToggle';

const App = lazy(() => import('./App').then((m) => ({ default: m.App })));
const PlayerApp = lazy(() => import('./player/PlayerApp').then((m) => ({ default: m.PlayerApp })));
const EventsApp = lazy(() => import('./events/EventsApp').then((m) => ({ default: m.EventsApp })));
const playerPage = /^\/player\/?$/.test(window.location.pathname);
const eventsPage = /^\/events\/?$/.test(window.location.pathname);

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider
      theme={theme}
      cssVariablesResolver={cssVariablesResolver}
      colorSchemeManager={colorSchemeManager}
      defaultColorScheme="auto"
    >
      <ThemeSync />
      <Notifications position="top-right" />
      <QueryClientProvider client={client}>
        <Suspense fallback={<Loading />}>
          {eventsPage ? (
            <EventsApp />
          ) : playerPage ? (
            <PlayerApp />
          ) : (
            <HashRouter>
              <AuthProvider>
                <App />
              </AuthProvider>
            </HashRouter>
          )}
        </Suspense>
      </QueryClientProvider>
    </MantineProvider>
  </React.StrictMode>,
);
