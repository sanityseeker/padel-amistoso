import React, { type ReactNode } from 'react';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '../theme/fonts.css';
import '../theme/sport.css';
import '../app.css';
import { AuthProvider } from '../auth';
import { PlayerSessionProvider } from '../player/session';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import { ThemeSync } from '../shell/ThemeSync';
import { colorSchemeManager, cssVariablesResolver, theme } from '../theme';

const client = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: true },
    mutations: { retry: false },
  },
});

// Every context the app needs, in one place: Mantine (theme, color scheme), toasts, React Query and
// the two independent sessions (admin and Player Hub).
export function Providers({ children }: { children: ReactNode }) {
  return (
    <React.StrictMode>
      <ErrorBoundary>
        <MantineProvider
          theme={theme}
          cssVariablesResolver={cssVariablesResolver}
          colorSchemeManager={colorSchemeManager}
          defaultColorScheme="auto"
        >
          <ThemeSync />
          <Notifications position="top-right" />
          <QueryClientProvider client={client}>
            <AuthProvider>
              <PlayerSessionProvider>{children}</PlayerSessionProvider>
            </AuthProvider>
          </QueryClientProvider>
        </MantineProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
