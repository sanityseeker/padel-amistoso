import { ActionIcon, Button, Menu } from '@mantine/core';
import { IconChevronDown, IconLockPassword, IconLogout, IconUserCircle } from '@tabler/icons-react';
import { useAuth } from '../auth';
import { t as tx, useLocale } from '../i18n';
import { useShellUi } from './ShellUi';

// "Account menu": the signed-in organizer, Change password and Log out. Icon-only on tablets.
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  useLocale();
  const { hasToken, username, user, logout } = useAuth();
  const { setPasswordOpen } = useShellUi();
  if (!hasToken) return null;
  const name = user?.username || username || tx('Admin');
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        {compact ? (
          <ActionIcon size="lg" aria-label={tx('Account menu')} title={name}>
            <IconUserCircle size={20} />
          </ActionIcon>
        ) : (
          <Button
            variant="subtle"
            color="gray"
            size="compact-md"
            h="var(--tap-md)"
            leftSection={<IconUserCircle size={18} />}
            rightSection={<IconChevronDown size={14} />}
            aria-label={tx('Account menu')}
          >
            {name}
          </Button>
        )}
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{name}</Menu.Label>
        <Menu.Item
          leftSection={<IconLockPassword size={16} />}
          onClick={() => setPasswordOpen(true)}
        >
          {tx('Change password')}
        </Menu.Item>
        <Menu.Item leftSection={<IconLogout size={16} />} onClick={logout}>
          {tx('Log out')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
