import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { AppShell, rem } from '@mantine/core';
import { useHeadroom, useLocalStorage } from '@mantine/hooks';
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { ChangePasswordModal } from '../admin/account/ChangePasswordModal';
import { Loading } from '../components';
import { useAuth } from '../auth';
import { useLocale } from '../i18n';
import { TopBarActionContext, TopBarTitleContext } from '../ui/PageHeader';
import { usePageTitle, useRouteTitle } from './pageTitle';
import { useShellHotkeys } from '../features/switcher/hotkeys';
import { Palette } from '../features/switcher/Palette';
import { ShortcutSheet } from '../features/switcher/ShortcutSheet';
import { SwitcherSheet } from '../features/switcher/SwitcherSheet';
import { TournamentDock } from '../features/switcher/TournamentDock';
import { AdminBottomNav } from './BottomNav';
import { ErrorBoundary } from './ErrorBoundary';
import { LiveUpdatesProvider } from './LiveUpdates';
import { MenuSheet } from './MenuSheet';
import { PagesNav } from './PagesNav';
import { rememberPage } from './env';
import { useAdminChrome, useAdminRoute, useLayoutMode } from './layout';
import { ShellUiProvider, useShellUi } from './ShellUi';
import { SupportFooter } from './SupportFooter';
import { TopBar, useHeaderHeight } from './TopBar';
import { WorkspaceAside } from './WorkspaceAside';

const RAIL = 72;
const DOCK = 280;
const ASIDE = 340;
// iPhone safe areas (status bar, notch or Dynamic Island, home indicator, the notch side in
// landscape). index.html sets viewport-fit=cover, so the page runs edge to edge and each fixed bar
// pads itself: the header grows by the top inset, the tab bar by the bottom one, the dock and the
// aside by the side ones. AppShell turns these sizes into its offsets, so sticky elements that use
// --app-shell-header-offset clear the status bar too.
const SAFE_TOP = 'env(safe-area-inset-top, 0px)';
const SAFE_BOTTOM = 'env(safe-area-inset-bottom, 0px)';
const SAFE_LEFT = 'env(safe-area-inset-left, 0px)';
const SAFE_RIGHT = 'env(safe-area-inset-right, 0px)';
// rem() keeps Mantine's interface scaling, as a plain number size would get.
const withInset = (px: number, inset: string) => `calc(${rem(px)} + ${inset})`;
// The tab bar is 64 CSS px (Shell.module.css .bottomNav), so its size stays unscaled.
const TABS_HEIGHT = 64;
const FOOTER = `calc(${TABS_HEIGHT}px + ${SAFE_BOTTOM})`;

// The one shell for every audience. Admin gets the Courtside Console (dock or rail, bottom tabs on
// phones, review aside on wide screens); Events and the Player Hub get the header and, on phones,
// a Pages tab bar. One navigation renderer is mounted per breakpoint.
function Layout() {
  const locale = useLocale();
  const { pathname } = useLocation();
  const { mode, wide } = useLayoutMode();
  const adminChrome = useAdminChrome();
  const route = useAdminRoute();
  const { user } = useAuth();
  const { passwordOpen, setPasswordOpen } = useShellUi();
  const [collapsed, setCollapsed] = useLocalStorage<boolean>({
    key: 'amistoso-dock-collapsed',
    defaultValue: false,
    getInitialValueInEffect: false,
  });
  const toggleDock = () => setCollapsed((c) => !c);
  const header = useHeaderHeight(mode, adminChrome);
  const pinned = useHeadroom({ fixedAt: 120 });
  const workspaceRoute = route.section === 'workspace' || route.section === 'lobby';

  const routeTitle = useRouteTitle();
  const barTitle = usePageTitle();
  const [topBarAction, setTopBarAction] = useState<ReactNode>(null);
  useEffect(() => {
    document.title = (routeTitle ? routeTitle + ' · ' : '') + 'Torneos Amistosos';
  }, [routeTitle, locale]);
  useEffect(() => {
    const section = pathname.split('/')[1];
    if (section === 'events' || section === 'player' || section === 'admin') rememberPage(section);
  }, [pathname]);

  useShellHotkeys({ enabled: adminChrome, toggleDock });

  const rail = mode === 'tablet' || collapsed;
  const showDock = adminChrome && mode !== 'phone';
  const showAside = adminChrome && mode === 'desktop' && wide && route.section === 'workspace';
  // The spectator screen is a full-screen display with its own slim bar, so the app header and the
  // phone tab bar stay out of the way (the support footer stays, as on the legacy TV page).
  const tvChrome = pathname.startsWith('/tv/');
  const showTabs = mode === 'phone' && !tvChrome;
  // The tab bar slides away while scrolling down inside a workspace; the page keeps its bottom padding.
  const hideTabs = showTabs && adminChrome && workspaceRoute && !pinned;

  return (
    <TopBarTitleContext.Provider value={!!barTitle && !pathname.startsWith('/tv/')}>
      <AppShell
        className="app-shell"
        // One source for the tab bar height: fixed action bars (ui/ActionBar) sit above it.
        style={{ '--app-tabs-height': showTabs && !hideTabs ? `${TABS_HEIGHT}px` : '0px' }}
        bg="var(--color-bg)"
        header={tvChrome ? undefined : { height: withInset(header.height, SAFE_TOP) }}
        navbar={
          showDock ? { width: withInset(rail ? RAIL : DOCK, SAFE_LEFT), breakpoint: 0 } : undefined
        }
        aside={showAside ? { width: withInset(ASIDE, SAFE_RIGHT), breakpoint: 0 } : undefined}
        footer={showTabs ? { height: FOOTER, collapsed: hideTabs, offset: false } : undefined}
        padding={0}
        withBorder
        transitionDuration={180}
      >
        {!tvChrome && (
          <AppShell.Header className="app-header" pt={SAFE_TOP} pl={SAFE_LEFT} pr={SAFE_RIGHT}>
            <TopBar
              mode={mode}
              adminChrome={adminChrome}
              dockCollapsed={collapsed}
              onToggleDock={toggleDock}
              strip={header.strip}
              tabs={header.tabs}
              pageAction={topBarAction}
            />
          </AppShell.Header>
        )}
        {showDock && (
          <AppShell.Navbar component="div" pl={SAFE_LEFT}>
            <TournamentDock rail={rail} />
          </AppShell.Navbar>
        )}
        <AppShell.Main
          miw={0}
          pb={showTabs ? FOOTER : SAFE_BOTTOM}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          {/* Landscape: keep page content out of the notch side unless the dock or aside covers it. */}
          <div
            style={{
              width: '100%',
              minWidth: 0,
              paddingLeft: showDock ? undefined : SAFE_LEFT,
              paddingRight: showAside ? undefined : SAFE_RIGHT,
            }}
          >
            <TopBarActionContext.Provider
              value={{ action: topBarAction, setAction: setTopBarAction }}
            >
              <ErrorBoundary resetKey={pathname}>
                <Suspense fallback={<Loading testId="route-loading" />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </TopBarActionContext.Provider>
          </div>
          <SupportFooter />
        </AppShell.Main>
        {showAside && route.id && (
          <AppShell.Aside pr={SAFE_RIGHT}>
            <WorkspaceAside tid={route.id} />
          </AppShell.Aside>
        )}
        {showTabs && (
          <AppShell.Footer className="app-tabs" pb={SAFE_BOTTOM} pl={SAFE_LEFT} pr={SAFE_RIGHT}>
            {adminChrome ? <AdminBottomNav /> : <PagesNav variant="bottom" />}
          </AppShell.Footer>
        )}
        <Palette />
        {adminChrome && (
          <>
            <ShortcutSheet />
            {mode === 'phone' && (
              <>
                <SwitcherSheet />
                <MenuSheet />
              </>
            )}
          </>
        )}
        {user && (
          <ChangePasswordModal opened={passwordOpen} onClose={() => setPasswordOpen(false)} />
        )}
        <ScrollRestoration getKey={(location) => location.pathname} />
      </AppShell>
    </TopBarTitleContext.Provider>
  );
}

export function AppLayout() {
  return (
    <LiveUpdatesProvider>
      <ShellUiProvider>
        <Layout />
      </ShellUiProvider>
    </LiveUpdatesProvider>
  );
}
