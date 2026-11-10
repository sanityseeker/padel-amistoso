import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { AppShell } from '@mantine/core';
import { useHeadroom, useLocalStorage } from '@mantine/hooks';
import { Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { ChangePasswordModal } from '../admin/account/ChangePasswordModal';
import { Loading } from '../components';
import { useAuth } from '../auth';
import { useLocale } from '../i18n';
import { TopBarActionContext, TopBarTitleContext } from '../ui/PageHeader';
import { usePageTitle, useRouteTitle } from './pageTitle';
import { useShellHotkeys } from '../features/switcher/hotkeys';
import { SubdomainBanner } from './SubdomainBanner';
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
const FOOTER = 'calc(64px + env(safe-area-inset-bottom, 0px))';

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
        bg="var(--color-bg)"
        header={tvChrome ? undefined : { height: header.height }}
        navbar={showDock ? { width: rail ? RAIL : DOCK, breakpoint: 0 } : undefined}
        aside={showAside ? { width: ASIDE, breakpoint: 0 } : undefined}
        footer={showTabs ? { height: FOOTER, collapsed: hideTabs, offset: false } : undefined}
        padding={0}
        withBorder
        transitionDuration={180}
      >
        {!tvChrome && (
          <AppShell.Header className="app-header">
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
          <AppShell.Navbar component="div">
            <TournamentDock rail={rail} />
          </AppShell.Navbar>
        )}
        <AppShell.Main
          miw={0}
          pb={showTabs ? FOOTER : undefined}
          style={{ display: 'flex', flexDirection: 'column' }}
        >
          <div style={{ width: '100%', minWidth: 0 }}>
            <TopBarActionContext.Provider
              value={{ action: topBarAction, setAction: setTopBarAction }}
            >
              <ErrorBoundary key={pathname}>
                {adminChrome && <SubdomainBanner />}
                <Suspense fallback={<Loading />}>
                  <Outlet />
                </Suspense>
              </ErrorBoundary>
            </TopBarActionContext.Provider>
          </div>
          <SupportFooter />
        </AppShell.Main>
        {showAside && route.id && (
          <AppShell.Aside>
            <WorkspaceAside tid={route.id} />
          </AppShell.Aside>
        )}
        {showTabs && (
          <AppShell.Footer className="app-tabs" pb="env(safe-area-inset-bottom, 0px)">
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
