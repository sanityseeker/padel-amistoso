import type { ReactNode } from 'react';
import { Button, Group, Stack, UnstyledButton } from '@mantine/core';
import {
  IconBuildingCommunity,
  IconChartLine,
  IconHome,
  IconListCheck,
  IconSettings,
  IconTrophy,
  IconUser,
} from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';
import { t as tx, useLocale } from '../i18n';
import { getClubSubdomain } from '../club-context';
import { usePlayerSession } from '../player/session';
import { useAuth } from '../auth';
import { isDemoInstance, rememberPage } from './env';
import classes from './Shell.module.css';

interface Page {
  key: 'club' | 'events' | 'player' | 'admin';
  to: string;
  label: string;
  short: string;
  icon: ReactNode;
  active: boolean;
}

// Events (or Club), Player Hub (My Hub when signed in), Admin (only with a session or on /admin).
// On the demo instance there is no Hub item. Every in-app switch is a client-side Link, so the
// document, caches and both sessions stay alive.
export function usePages(playerTabs = false): Page[] {
  useLocale();
  const { pathname } = useLocation();
  const auth = useAuth();
  const hub = usePlayerSession();
  const onAdmin = pathname === '/admin' || pathname.startsWith('/admin/');
  const pages: Page[] = [];
  if (getClubSubdomain())
    pages.push({
      key: 'club',
      to: '/',
      label: tx('Club'),
      short: tx('Club'),
      icon: <IconBuildingCommunity size={18} aria-hidden />,
      active: pathname === '/',
    });
  else
    pages.push({
      key: 'events',
      to: '/events',
      label: tx('Events'),
      short: tx('Events'),
      icon: <IconTrophy size={18} aria-hidden />,
      active: pathname.startsWith('/events'),
    });
  if (!isDemoInstance())
    pages.push({
      key: 'player',
      to: '/player',
      label: tx(hub.token ? 'My Hub' : 'Player Hub'),
      short: tx(hub.token ? 'My Hub' : 'Hub'),
      // Signed in, the initials are the header's player menu; the Hub itself is home.
      icon: hub.token ? <IconHome size={18} aria-hidden /> : <IconUser size={18} aria-hidden />,
      active: pathname.startsWith('/player'),
    });
  if (playerTabs && hub.token) {
    // Signed in on the phone: the Hub's own sections replace Admin (Admin stays in Me).
    const hubPage = pages.find((p) => p.key === 'player');
    if (hubPage) {
      hubPage.to = '/player';
      hubPage.label = tx('My Hub');
      hubPage.short = tx('Hub');
      hubPage.active = pathname === '/player';
    }
    const extra = (to: string, label: string, icon: ReactNode): Page => ({
      key: 'player',
      to,
      label,
      short: label,
      icon,
      active: pathname.startsWith(to),
    });
    pages.push(
      extra('/player/matches', tx('My events'), <IconListCheck size={18} aria-hidden />),
      extra('/player/ratings', tx('Ratings'), <IconChartLine size={18} aria-hidden />),
      extra('/player/me', tx('Profile'), <IconUser size={18} aria-hidden />),
    );
    return pages;
  }
  if (auth.hasToken || onAdmin)
    pages.push({
      key: 'admin',
      to: '/admin',
      label: tx('Admin'),
      short: tx('Admin'),
      icon: <IconSettings size={18} aria-hidden />,
      active: onAdmin,
    });
  return pages;
}

export const remember = (page: Page) =>
  page.key !== 'club' && rememberPage(page.key as 'events' | 'player' | 'admin');

/** `header`: segmented links for tablet and desktop. `bottom`: the phone tab bar (public and player).
    `list`: stacked links inside the phone Menu sheet. Only one is ever mounted. */
export function PagesNav({
  variant,
  onNavigate,
  omit,
}: {
  variant: 'header' | 'bottom' | 'list';
  onNavigate?: () => void;
  /** Pages the surrounding chrome already links to (the admin dock and Menu tab own "Admin"). */
  omit?: Page['key'][];
}) {
  const { pathname } = useLocation();
  const pages = usePages(variant === 'bottom' && pathname.startsWith('/player')).filter(
    (page) => !omit?.includes(page.key),
  );
  const label = tx('Pages');
  const go = (page: Page) => () => {
    remember(page);
    onNavigate?.();
  };
  if (variant === 'bottom')
    return (
      <nav aria-label={label} className={classes.bottomNav}>
        {pages.map((page) => {
          const common = {
            className: classes.tab,
            'data-active': page.active || undefined,
            'aria-current': page.active ? ('page' as const) : undefined,
            onClick: go(page),
          };
          const inner = (
            <>
              {page.icon}
              <span className={classes.tabLabel}>{page.short}</span>
            </>
          );
          return (
            <UnstyledButton key={page.to} component={Link} to={page.to} {...common}>
              {inner}
            </UnstyledButton>
          );
        })}
      </nav>
    );
  const Wrapper = variant === 'list' ? Stack : Group;
  return (
    <nav aria-label={label}>
      <Wrapper gap={variant === 'list' ? 4 : 2} wrap="nowrap">
        {pages.map((page) => {
          const common = {
            variant: page.active ? ('light' as const) : ('subtle' as const),
            color: page.active ? 'court' : 'gray',
            size: 'compact-md' as const,
            h: 'var(--tap-md)',
            justify: variant === 'list' ? ('flex-start' as const) : ('center' as const),
            leftSection: page.icon,
            'aria-current': page.active ? ('page' as const) : undefined,
            onClick: go(page),
          };
          return (
            <Button key={page.to} component={Link} to={page.to} {...common}>
              {page.label}
            </Button>
          );
        })}
      </Wrapper>
    </nav>
  );
}
