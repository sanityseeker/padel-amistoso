import type { ReactNode } from 'react';
import { Button, Card, Divider, SimpleGrid, Stack, Text } from '@mantine/core';
import { BottomDrawer } from '../ui';
import {
  IconDownload,
  IconInfoCircle,
  IconLockPassword,
  IconLogout,
  IconUserSearch,
  IconUserShield,
} from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { t as tx, useLocale } from '../i18n';
import { INFO_HREF } from '../features/switcher/destinations';
import { DisplayPanel } from './DisplayMenu';
import { PagesNav } from './PagesNav';
import { useShellUi } from './ShellUi';
import classes from './Shell.module.css';

function HubCard({
  to,
  onClick,
  icon,
  title,
  hint,
}: {
  to?: string;
  onClick?: () => void;
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  const content = (
    <Stack gap={6} align="flex-start">
      {icon}
      <Text fw={600} size="sm" ta="left">
        {title}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed" ta="left">
          {hint}
        </Text>
      )}
    </Stack>
  );
  return to ? (
    <Card component={Link} to={to} onClick={onClick} padding="sm" className={classes.hubCard}>
      {content}
    </Card>
  ) : (
    <Card
      component="button"
      type="button"
      onClick={onClick}
      padding="sm"
      className={classes.hubCard}
    >
      {content}
    </Card>
  );
}

// Phone "Menu" sheet: the Pages switch, a grid of the less frequent destinations, quiet links and the account.
export function MenuSheet() {
  useLocale();
  const { menuOpen, setMenuOpen, setPasswordOpen, install } = useShellUi();
  const { user, username, logout } = useAuth();
  const close = () => setMenuOpen(false);
  const cards = [user?.role === 'admin', user?.role === 'admin', install.state !== 'hidden'].filter(
    Boolean,
  );
  return (
    <BottomDrawer opened={menuOpen} onClose={close} title={tx('Menu')}>
      <Stack gap="md">
        <div>
          <Text variant="eyebrow" mb={6}>
            {tx('Pages')}
          </Text>
          <PagesNav variant="list" onNavigate={close} omit={['admin']} />
        </div>
        {cards.length > 0 && (
          <SimpleGrid cols={cards.length === 1 ? 1 : 2} spacing="xs">
            {user?.role === 'admin' && (
              <HubCard
                to="/admin/players"
                onClick={close}
                icon={<IconUserSearch size={22} />}
                title={tx('Player profiles')}
              />
            )}
            {user?.role === 'admin' && (
              <HubCard
                to="/admin/users"
                onClick={close}
                icon={<IconUserShield size={22} />}
                title={tx('Users')}
              />
            )}
            {install.state !== 'hidden' && (
              <HubCard
                onClick={() => {
                  close();
                  install.install();
                }}
                icon={<IconDownload size={22} />}
                title={tx('Install app')}
              />
            )}
          </SimpleGrid>
        )}
        <div>
          <Text variant="eyebrow" mb={6}>
            {tx('Display')}
          </Text>
          <DisplayPanel maxWidth="100%" />
        </div>
        <Stack gap={0}>
          <Button
            component="a"
            href={INFO_HREF}
            variant="subtle"
            color="gray"
            justify="flex-start"
            leftSection={<IconInfoCircle size={16} />}
          >
            {tx('Info')}
          </Button>
        </Stack>
        <Divider />
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {user?.username || username || tx('Admin')}
          </Text>
          <Button
            variant="default"
            leftSection={<IconLockPassword size={16} />}
            onClick={() => {
              close();
              setPasswordOpen(true);
            }}
          >
            {tx('Change password')}
          </Button>
          <Button
            color="red"
            variant="light"
            leftSection={<IconLogout size={16} />}
            onClick={logout}
          >
            {tx('Log out')}
          </Button>
        </Stack>
      </Stack>
    </BottomDrawer>
  );
}
