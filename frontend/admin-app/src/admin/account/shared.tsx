import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Center, Paper, Stack, Text, Title } from '@mantine/core';
import { ApiError } from '../../api';
import { t as tx } from '../../i18n';
import { Notice } from '../../ui/Notice';

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 128;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const looksLikeEmail = (value: string) => EMAIL.test(value.trim());

/** Backend 4xx -> translated text. Never echoes the backend string or any token. */
export function accountError(error: unknown, byStatus: Record<number, string> = {}): string {
  if (error instanceof ApiError) {
    if (byStatus[error.status]) return byStatus[error.status];
    if (error.status === 429) return tx('Too many attempts. Wait a few minutes and try again.');
    if (error.status === 422) return tx('Some of the details are not valid. Check them and retry.');
  }
  return tx('Something went wrong. Try again.');
}

/** Reads a query parameter once, keeps it in state and removes it from the address bar. */
export function useUrlToken(name: string): string {
  const [token] = useState(() => new URLSearchParams(window.location.search).get(name) ?? '');
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(name)) return;
    url.searchParams.delete(name);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  }, [name]);
  return token;
}

/** Focuses the alert whenever a new error appears, so screen readers announce it. */
export function useFocusOnError(error: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return ref;
}

export function ErrorAlert({ error, children }: { error: string; children?: ReactNode }) {
  const ref = useFocusOnError(error);
  if (!error) return null;
  return (
    <Notice tone="danger" role="alert" ref={ref} tabIndex={-1}>
      {error}
      {children}
    </Notice>
  );
}

export function AccountCard({
  title,
  intro,
  children,
}: {
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <Center p="xl">
      <Paper className="login-card" p="xl" w="100%" maw={420}>
        <Title order={2}>{title}</Title>
        {intro && (
          <Text c="dimmed" mt="xs">
            {intro}
          </Text>
        )}
        <Stack mt="xl">{children}</Stack>
      </Paper>
    </Center>
  );
}

export function passwordProblem(password: string): string {
  if (password.length > 0 && password.length < MIN_PASSWORD)
    return tx('Use at least {n} characters.', { n: MIN_PASSWORD });
  if (password.length > MAX_PASSWORD) return tx('Use at most {n} characters.', { n: MAX_PASSWORD });
  return '';
}
export const mismatchProblem = (password: string, confirm: string) =>
  confirm.length > 0 && password !== confirm ? tx('The passwords do not match.') : '';
