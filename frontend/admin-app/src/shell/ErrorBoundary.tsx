import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Text } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { t as tx } from '../i18n';
import { ErrorScreen, errorScreenClasses } from './ErrorScreen';

function Fallback({ message }: { message: string }) {
  return (
    <ErrorScreen
      icon={<IconAlertTriangle size={34} stroke={1.6} />}
      title={tx('Something went wrong')}
      actions={<Button onClick={() => window.location.reload()}>{tx('Reload')}</Button>}
    >
      <Text c="dimmed">{tx('The page could not be loaded. Reloading usually fixes it.')}</Text>
      {message && (
        <Text size="xs" c="dimmed" ff="monospace" className={errorScreenClasses.detail}>
          {message}
        </Text>
      )}
    </ErrorScreen>
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
