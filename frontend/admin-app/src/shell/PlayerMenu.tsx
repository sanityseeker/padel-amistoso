import { ActionIcon, Button, Menu } from '@mantine/core';
import { IconChevronDown, IconKey, IconLogout, IconSettings } from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth';
import { profileInitials, usePlayerSession } from '../player/session';
import { t as tx, useLocale } from '../i18n';
import { AccountMenu } from './AccountMenu';
import { isDemoInstance, rememberPage } from './env';
import { isAdminPath } from './layout';
import { remember, usePages } from './PagesNav';
import classes from './Shell.module.css';

function AdminSignIn({ compact }: { compact: boolean }) {
  return compact ? (
    <ActionIcon
      component={Link}
      to="/admin"
      size="lg"
      aria-label={tx('Admin sign in')}
      title={tx('Admin sign in')}
      onClick={() => rememberPage('admin')}
    >
      <IconKey size={19} />
    </ActionIcon>
  ) : (
    <Button
      component={Link}
      to="/admin"
      variant="subtle"
      color="gray"
      size="compact-md"
      h="var(--tap-md)"
      leftSection={<IconKey size={16} />}
      aria-label={tx('Admin sign in')}
      onClick={() => rememberPage('admin')}
    >
      <span aria-hidden="true">{tx('Admin')}</span>
    </Button>
  );
}

// The signed-in player: their initials open the same sections as the phone's tab bar (Events, Hub,
// My events, Ratings, Me), the organizer door and Log out, so the header shows one control instead
// of a row of icons.
function PlayerMenu({ compact }: { compact: boolean }) {
  useLocale();
  const hub = usePlayerSession();
  const auth = useAuth();
  const name = hub.profile?.name || tx('Player Hub');
  const pages = usePages(true);
  const avatar = (
    <span className={classes.avatar} data-size="lg" aria-hidden="true">
      {profileInitials(hub.profile?.name)}
    </span>
  );
  return (
    <Menu position="bottom-end" withinPortal>
      <Menu.Target>
        {compact ? (
          <ActionIcon size="touch" aria-label={tx('Player menu')} title={name}>
            {avatar}
          </ActionIcon>
        ) : (
          <Button
            variant="subtle"
            color="gray"
            size="compact-md"
            h="var(--tap-md)"
            leftSection={avatar}
            rightSection={<IconChevronDown size={14} />}
            aria-label={tx('Player menu')}
          >
            {name}
          </Button>
        )}
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{name}</Menu.Label>
        {pages.map((page) => (
          <Menu.Item
            key={page.to}
            component={Link}
            to={page.to}
            leftSection={page.icon}
            color={page.active ? 'court' : undefined}
            aria-current={page.active ? 'page' : undefined}
            onClick={() => remember(page)}
          >
            {page.short}
          </Menu.Item>
        ))}
        <Menu.Divider />
        <Menu.Item
          component={Link}
          to="/admin"
          leftSection={auth.hasToken ? <IconSettings size={16} /> : <IconKey size={16} />}
          onClick={() => rememberPage('admin')}
        >
          {auth.hasToken ? tx('Admin') : tx('Admin sign in')}
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={hub.logout}>
          {tx('Log out of Player Hub')}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

// The header's right corner belongs to players, who are most of the visitors: Sign in, or the signed-in
// player's menu. Organizers come in through that menu, the player login card or /admin itself (the app
// reopens on the section used last). The demo instance has no players, so there it stays the Admin key.
export function AccountSlot({ compact }: { compact: boolean }) {
  useLocale();
  const { pathname } = useLocation();
  const auth = useAuth();
  const hub = usePlayerSession();
  if (isAdminPath(pathname)) return auth.hasToken ? <AccountMenu compact={compact} /> : null;
  if (isDemoInstance())
    return auth.hasToken ? <AccountMenu compact={compact} /> : <AdminSignIn compact={compact} />;
  if (hub.token) return <PlayerMenu compact={compact} />;
  if (auth.hasToken) return <AccountMenu compact={compact} />;
  // On /player the login form is the page itself.
  if (pathname.startsWith('/player')) return null;
  return (
    <Button
      component={Link}
      to="/player"
      variant="light"
      size="compact-md"
      h="var(--tap-md)"
      onClick={() => rememberPage('player')}
    >
      {tx('Sign in')}
    </Button>
  );
}
