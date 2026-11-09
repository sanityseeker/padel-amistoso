import { ActionIcon, Box, Button, Group, Kbd, Text, UnstyledButton } from '@mantine/core';
import { spotlight } from '@mantine/spotlight';
import type { ReactNode } from 'react';
import {
  IconArrowLeft,
  IconChevronDown,
  IconDots,
  IconDownload,
  IconKey,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconLockPassword,
  IconLogout,
  IconSearch,
} from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';
import { BrandLogo } from '../BrandLogo';
import { useAuth } from '../auth';
import { usePlayerSession } from '../player/session';
import { useLobbyList, useTournamentList } from '../components';
import { isMac } from '../features/switcher/hotkeys';
import { useOrderedItems } from '../features/switcher/entries';
import { OpenTabs, OPEN_TABS_HEIGHT } from '../features/switcher/OpenTabs';
import { SwipeStrip, STRIP_HEIGHT } from '../features/switcher/SwipeStrip';
import { t as tx, useLocale } from '../i18n';
import { AccountMenu } from './AccountMenu';
import { DisplayButton } from './DisplayMenu';
import { rememberPage } from './env';
import { isAdminPath, useAdminRoute, type LayoutMode } from './layout';
import { usePageTitle } from './pageTitle';
import { OverflowMenu } from '../ui/OverflowMenu';
import { PagesNav } from './PagesNav';
import { useShellUi } from './ShellUi';
import classes from './Shell.module.css';

export const HEADER_HEIGHT = 52;
/** Header height including the phone swipe strip or the tablet and desktop open tabs. */
export const useHeaderHeight = (mode: LayoutMode, adminChrome: boolean) => {
  const route = useAdminRoute();
  const items = useOrderedItems();
  const strip =
    mode === 'phone' &&
    adminChrome &&
    (route.section === 'workspace' || route.section === 'lobby') &&
    items.length >= 2;
  const tabs =
    mode !== 'phone' && adminChrome && (items.length > 0 || route.section === 'workspace');
  return {
    strip,
    tabs,
    height: HEADER_HEIGHT + (strip ? STRIP_HEIGHT : tabs ? OPEN_TABS_HEIGHT : 0),
  };
};

/** Name shown in the header for the open tournament or lobby. */
function useContextTitle(): string {
  const route = useAdminRoute();
  const { user } = useAuth();
  const tournaments = useTournamentList(!!user);
  const lobbies = useLobbyList(!!user);
  if (route.section === 'workspace')
    return tournaments.data?.find((t) => t.id === route.id)?.name ?? tx('Tournament');
  if (route.section === 'lobby')
    return lobbies.data?.find((l) => l.id === route.id)?.name ?? tx('Lobby');
  return route.title;
}

function MoreMenu() {
  useLocale();
  const { pathname } = useLocation();
  const auth = useAuth();
  const hub = usePlayerSession();
  const { install, setPasswordOpen } = useShellUi();
  const onAdmin = isAdminPath(pathname);
  const name = auth.user?.username || auth.username || tx('Admin');
  return (
    <OverflowMenu
      label={tx('More')}
      icon={<IconDots size={20} />}
      items={[
        {
          key: 'install',
          label: tx('Install app'),
          icon: <IconDownload size={18} />,
          onClick: install.install,
          hidden: install.state === 'hidden',
        },
        {
          key: 'hub-logout',
          label: tx('Log out of Player Hub'),
          icon: <IconLogout size={18} />,
          onClick: hub.logout,
          hidden: !(hub.token && pathname.startsWith('/player')),
          divider: install.state !== 'hidden',
        },
        {
          key: 'admin',
          label: tx('Admin sign in'),
          icon: <IconKey size={18} />,
          to: '/admin',
          onClick: () => rememberPage('admin'),
          hidden: auth.hasToken || onAdmin,
        },
        {
          key: 'password',
          label: tx('Change password'),
          icon: <IconLockPassword size={18} />,
          onClick: () => setPasswordOpen(true),
          hidden: !auth.hasToken,
          heading: name,
          divider: true,
        },
        {
          key: 'logout',
          label: tx('Log out'),
          icon: <IconLogout size={18} />,
          onClick: auth.logout,
          hidden: !auth.hasToken,
        },
      ]}
    />
  );
}

function SearchBox({ wide }: { wide: boolean }) {
  const label = tx('Search or jump...');
  return wide ? (
    <UnstyledButton
      className={classes.searchBox}
      onClick={() => spotlight.open()}
      aria-label={label}
    >
      <IconSearch size={16} aria-hidden />
      <span className={classes.searchLabel}>{label}</span>
      <Kbd size="xs">{isMac() ? '⌘ K' : 'Ctrl K'}</Kbd>
    </UnstyledButton>
  ) : (
    <ActionIcon size="lg" aria-label={label} onClick={() => spotlight.open()}>
      <IconSearch size={20} />
    </ActionIcon>
  );
}

export function TopBar({
  mode,
  adminChrome,
  dockCollapsed,
  onToggleDock,
  strip,
  tabs,
  pageAction,
}: {
  mode: LayoutMode;
  adminChrome: boolean;
  dockCollapsed: boolean;
  onToggleDock: () => void;
  strip: boolean;
  tabs: boolean;
  pageAction: ReactNode;
}) {
  useLocale();
  const { pathname } = useLocation();
  const auth = useAuth();
  const { install, setSwitcherOpen } = useShellUi();
  const route = useAdminRoute();
  const title = useContextTitle();
  const pageTitle = usePageTitle();
  const tvRoute = pathname.startsWith('/tv/');
  const onAdmin = isAdminPath(pathname);
  const section = onAdmin ? '/admin' : pathname.startsWith('/player') ? '/player' : '/events';
  const logo = (
    <Link
      to={section}
      className={classes.logo}
      onClick={() => rememberPage(section.slice(1) as 'events' | 'player' | 'admin')}
    >
      <BrandLogo size={32} />
    </Link>
  );

  if (mode === 'phone')
    return (
      <>
        <Group h={HEADER_HEIGHT} px="xs" gap={4} wrap="nowrap">
          {adminChrome && route.deep ? (
            <ActionIcon
              component={Link}
              to="/admin"
              size="lg"
              aria-label={tx('Back to tournaments')}
            >
              <IconArrowLeft size={20} />
            </ActionIcon>
          ) : (
            logo
          )}
          {adminChrome ? (
            route.section === 'workspace' || route.section === 'lobby' ? (
              <Button
                variant="subtle"
                color="gray"
                className={classes.titleButton}
                rightSection={<IconChevronDown size={15} />}
                aria-label={tx('Switch tournament: {name}', { name: title })}
                onClick={() => setSwitcherOpen(true)}
              >
                <span className={classes.titleText}>{title}</span>
              </Button>
            ) : (
              <Text className={classes.pageTitle}>{title}</Text>
            )
          ) : pageTitle && !tvRoute ? (
            <Text className={classes.pageTitle} component="span" title={pageTitle}>
              {pageTitle}
            </Text>
          ) : null}
          <Group gap={0} ml="auto" wrap="nowrap">
            {adminChrome ? (
              <>
                {pageAction}
                <SearchBox wide={false} />
              </>
            ) : (
              <DisplayButton compact />
            )}
            {/* The admin chrome has the Menu sheet, which holds the same items. */}
            {!adminChrome && <MoreMenu />}
          </Group>
        </Group>
        {strip && <SwipeStrip />}
      </>
    );

  const desktop = mode === 'desktop';
  return (
    <>
      <Group h={HEADER_HEIGHT} px="md" gap="xs" wrap="nowrap">
        {adminChrome && desktop && (
          <ActionIcon
            size="lg"
            aria-label={dockCollapsed ? tx('Expand navigation') : tx('Collapse navigation')}
            aria-pressed={dockCollapsed}
            onClick={onToggleDock}
          >
            {dockCollapsed ? (
              <IconLayoutSidebarLeftExpand size={20} />
            ) : (
              <IconLayoutSidebarLeftCollapse size={20} />
            )}
          </ActionIcon>
        )}
        {logo}
        <PagesNav variant="header" omit={adminChrome ? ['admin'] : undefined} />
        {pageTitle && !tvRoute && !(adminChrome && desktop && !dockCollapsed) ? (
          <Text className={classes.pageTitle} component="span" title={pageTitle}>
            {pageTitle}
          </Text>
        ) : (
          <Box flex={1} />
        )}
        {adminChrome && <SearchBox wide={desktop} />}
        <Group gap={4} wrap="nowrap">
          {install.state !== 'hidden' &&
            (desktop ? (
              <Button
                variant="subtle"
                size="compact-md"
                h="var(--tap-md)"
                leftSection={<IconDownload size={16} />}
                onClick={install.install}
              >
                {tx('Install')}
              </Button>
            ) : (
              <ActionIcon size="lg" aria-label={tx('Install')} onClick={install.install}>
                <IconDownload size={19} />
              </ActionIcon>
            ))}
          <DisplayButton compact={!desktop} />
          {auth.hasToken ? (
            <AccountMenu compact={!desktop} />
          ) : (
            !onAdmin && (
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
            )
          )}
        </Group>
      </Group>
      {tabs && <OpenTabs />}
    </>
  );
}
