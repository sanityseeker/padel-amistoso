import { lazy, Suspense } from 'react';
import { ActionIcon, Box, Button, Group, Kbd, Text, UnstyledButton } from '@mantine/core';
import {
  IconArrowLeft,
  IconChevronDown,
  IconDownload,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSearch,
} from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';
import { BrandLogo } from '../BrandLogo';
import { useAuth } from '../auth';
import { useLobbyList, useTournamentList } from '../components';
import { isMac } from '../features/switcher/hotkeys';
import { useOrderedItems } from '../features/switcher/entries';
import { OpenTabs, OPEN_TABS_HEIGHT } from '../features/switcher/OpenTabs';
import { STRIP_HEIGHT } from '../features/switcher/constants';
import { openPalette, preloadPalette } from '../features/switcher/paletteOpen';
import { t as tx, useLocale } from '../i18n';
import { DisplayButton } from './DisplayMenu';
import { rememberPage } from './env';
import { isAdminPath, useAdminRoute, type LayoutMode } from './layout';
import { usePageTitle } from './pageTitle';
import { useTopBarAction } from '../ui/PageHeader';
import { PagesNav } from './PagesNav';
import { AccountSlot } from './PlayerMenu';
import { useShellUi } from './ShellUi';
import classes from './Shell.module.css';

// The swipe strip (and its carousel library) loads on a phone workspace only.
const SwipeStrip = lazy(() =>
  import('../features/switcher/SwipeStrip').then((m) => ({ default: m.SwipeStrip })),
);

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

// Install sits in the phone header itself while the browser offers it: a player should not have to
// open a menu to find it.
function PhoneInstall() {
  useLocale();
  const { install } = useShellUi();
  if (install.state === 'hidden') return null;
  return (
    <ActionIcon size="lg" aria-label={tx('Install app')} onClick={install.install}>
      <IconDownload size={19} />
    </ActionIcon>
  );
}

function SearchBox({ wide }: { wide: boolean }) {
  const label = tx('Search or jump...');
  return wide ? (
    <UnstyledButton
      className={classes.searchBox}
      onClick={openPalette}
      onMouseEnter={preloadPalette}
      onFocus={preloadPalette}
      aria-label={label}
    >
      <IconSearch size={16} aria-hidden />
      <span className={classes.searchLabel}>{label}</span>
      <Kbd size="xs">{isMac() ? '⌘ K' : 'Ctrl K'}</Kbd>
    </UnstyledButton>
  ) : (
    <ActionIcon
      size="lg"
      aria-label={label}
      onClick={openPalette}
      onTouchStart={preloadPalette}
      onFocus={preloadPalette}
    >
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
}: {
  mode: LayoutMode;
  adminChrome: boolean;
  dockCollapsed: boolean;
  onToggleDock: () => void;
  strip: boolean;
  tabs: boolean;
}) {
  useLocale();
  const pageAction = useTopBarAction();
  const { pathname } = useLocation();
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
              <>
                <PhoneInstall />
                <DisplayButton compact />
                <AccountSlot compact />
              </>
            )}
          </Group>
        </Group>
        {strip && (
          <Suspense fallback={<Box h={STRIP_HEIGHT} />}>
            <SwipeStrip />
          </Suspense>
        )}
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
          <AccountSlot compact={!desktop} />
        </Group>
      </Group>
      {tabs && <OpenTabs />}
    </>
  );
}
