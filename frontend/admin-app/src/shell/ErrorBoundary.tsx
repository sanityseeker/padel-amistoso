import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Stack, Text, Title } from '@mantine/core';
import { t as tx } from '../i18n';
import { PageContainer } from '../ui/PageContainer';

function Fallback({ message }: { message: string }) {
  return (
    <PageContainer size="sm">
      <Stack align="flex-start" gap="xs">
        <Title order={2}>{tx('Something went wrong')}</Title>
        <Text c="dimmed" size="sm">
          {tx('The page could not be loaded. Reloading usually fixes it.')}
        </Text>
        {message && (
          <Text size="xs" c="dimmed" ff="monospace">
            {message}
          </Text>
        )}
        <Button mt="sm" onClick={() => window.location.reload()}>
          {tx('Reload')}
        </Button>
      </Stack>
    </PageContainer>
  );
}

type Props = {
  children: ReactNode;
  // A new value clears a caught error (the shell passes the pathname), so leaving a broken page
  // recovers without remounting the subtree on every navigation.
  resetKey?: unknown;
};

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }
  componentDidUpdate(prev: Props) {
    if (this.state.error && !Object.is(prev.resetKey, this.props.resetKey)) {
      this.setState({ error: null });
    }
  }
  render() {
    return this.state.error ? <Fallback message={this.state.error.message} /> : this.props.children;
  }
}
