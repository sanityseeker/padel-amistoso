import type { ReactNode } from 'react';
import { Button, Container, Group, Menu, Text } from '@mantine/core';
import { IconChevronDown } from '@tabler/icons-react';
import { BrandLogo } from './BrandLogo';
import { ThemeToggle } from './ThemeToggle';
import { t as tx, useLocale } from './i18n';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from './events/api';
export function PublicHeader({
  current,
  actions,
}: {
  current: 'events' | 'player' | 'admin';
  actions?: ReactNode;
}) {
  useLocale();
  const config = useQuery({
    queryKey: ['public-site-config'],
    queryFn: ({ signal }) => publicApi<{ demo_instance: boolean }>('/config', signal),
    staleTime: 60_000,
  });
  return (
    <header className="compact-public-header">
      <Container size="lg">
        <div className="compact-header-row">
          <ThemeToggle />
          <Menu position="bottom" withinPortal>
            <Menu.Target>
              <Button
                variant="subtle"
                color="gray"
                className="page-switcher"
                leftSection={<BrandLogo size={32} />}
                rightSection={<IconChevronDown size={14} />}
              >
                {tx(
                  current === 'events'
                    ? 'Events'
                    : current === 'player'
                      ? 'Player Hub'
                      : 'Administration',
                )}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item component="a" href="/events">
                {tx('Events')}
              </Menu.Item>
              {config.data?.demo_instance === false && (
                <Menu.Item component="a" href="/player">
                  {tx('Player Hub')}
                </Menu.Item>
              )}
              <Menu.Item component="a" href="/admin">
                {tx('Administration')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Group gap="xs" justify="flex-end">
            {actions ||
              (current !== 'admin' && (
                <Button component="a" href="/admin" variant="subtle" size="compact-xs">
                  {tx('Log in')}
                </Button>
              ))}
          </Group>
        </div>
      </Container>
    </header>
  );
}

export function SupportLinks() {
  useLocale();
  return (
    <Group justify="center" gap="md" py="xl">
      <Text
        component="a"
        href="https://ko-fi.com/torneosamistosos"
        target="_blank"
        rel="noopener"
        size="xs"
        c="dimmed"
      >
        {tx('Buy me a coffee')}
      </Text>
      <Text
        component="a"
        href="https://github.com/sanityseeker/padel-amistoso"
        target="_blank"
        rel="noopener"
        size="xs"
        c="dimmed"
      >
        GitHub
      </Text>
    </Group>
  );
}
