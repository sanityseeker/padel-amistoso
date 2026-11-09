import { UnstyledButton } from '@mantine/core';
import { IconBuildingCommunity, IconDotsVertical, IconPlus, IconTrophy } from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';
import { t as tx, useLocale } from '../i18n';
import { useShellUi } from './ShellUi';
import classes from './Shell.module.css';

// Phone admin bottom navigation (the Administration landmark). Menu opens the hub sheet;
// the rest are plain links (switching tournaments lives in the top bar).
export function AdminBottomNav() {
  useLocale();
  const { pathname } = useLocation();
  const { setMenuOpen } = useShellUi();
  const link = (
    to: string,
    label: string,
    icon: React.ReactNode,
    active: boolean,
    accent = false,
  ) => (
    <UnstyledButton
      component={Link}
      to={to}
      className={classes.tab}
      data-active={active || undefined}
      data-accent={accent || undefined}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      <span className={classes.tabLabel}>{label}</span>
    </UnstyledButton>
  );
  return (
    <nav aria-label={tx('Administration')} className={classes.bottomNav}>
      {link(
        '/admin',
        tx('Tournaments'),
        <IconTrophy size={21} aria-hidden />,
        pathname === '/admin',
      )}
      {link(
        '/admin/new',
        tx('New'),
        <IconPlus size={21} aria-hidden />,
        pathname === '/admin/new',
        true,
      )}
      {link(
        '/admin/clubs',
        tx('Clubs'),
        <IconBuildingCommunity size={21} aria-hidden />,
        pathname.startsWith('/admin/clubs'),
      )}
      <UnstyledButton className={classes.tab} onClick={() => setMenuOpen(true)}>
        <IconDotsVertical size={21} aria-hidden />
        <span className={classes.tabLabel}>{tx('Menu')}</span>
      </UnstyledButton>
    </nav>
  );
}
