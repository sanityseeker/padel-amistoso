import { useEffect, useState } from 'react';
import { Button, Group, Image, Stack, Text, Title } from '@mantine/core';
import { Link, useSearchParams } from 'react-router-dom';
import { t as tx, useLocale } from '../i18n';
import { readMeta } from '../features/public/meta';
import { PageContainer } from '../ui/PageContainer';

const SECONDS = 5;

// A same-site path (never `//host`) or an absolute http(s) URL the server wrote into the page.
const samePath = (value: string | null) =>
  value && value.startsWith('/') && !value.startsWith('//') ? value : null;
const serverHome = () => {
  const home = readMeta('amistoso-home');
  return home && /^https?:\/\//.test(home) ? home : null;
};

// The not-found page. The server serves the app shell with a 404 status for unknown addresses and
// tells it where home is (a club subdomain goes back to its landing page, anything else to the apex).
// `?m=` carries a reason (a deleted event) and `?to=` a same-site path to go to; with either known
// destination the page counts down and leaves, like the legacy page did.
export function NotFound() {
  useLocale();
  const [params] = useSearchParams();
  const message = params.get('m');
  const target = samePath(params.get('to')) ?? serverHome();
  const here = window.location.origin + window.location.pathname;
  const leaves = !!target && new URL(target, window.location.origin).href !== here;
  const [left, setLeft] = useState(SECONDS);
  useEffect(() => {
    if (!leaves || !target) return;
    const timer = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => window.clearInterval(timer);
  }, [leaves, target]);
  useEffect(() => {
    if (leaves && target && left <= 0) window.location.replace(target);
  }, [left, leaves, target]);
  return (
    <PageContainer size="sm">
      <Stack align="flex-start" gap="sm">
        <Image
          src="/404.png"
          alt={tx('404: page not found')}
          maw={320}
          w="100%"
          fit="contain"
          fallbackSrc="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=="
        />
        <Title order={1}>{tx('Page not found')}</Title>
        <Text c="dimmed">{tx('This address does not exist.')}</Text>
        {message && <Text data-testid="not-found-reason">{message}</Text>}
        {leaves && (
          <Text c="dimmed" size="sm" role="status">
            {tx('Redirecting in {seconds} seconds...', { seconds: Math.max(left, 0) })}
          </Text>
        )}
        <Group mt="xs">
          <Button component="a" href={target ?? '/events'}>
            {tx('Go home now')}
          </Button>
          <Button component={Link} to="/events" variant="default">
            {tx('Events')}
          </Button>
        </Group>
      </Stack>
    </PageContainer>
  );
}
