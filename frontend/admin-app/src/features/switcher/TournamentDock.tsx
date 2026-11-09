import {
  AppShell,
  Button,
  Divider,
  NavLink,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconDots, IconKeyboard, IconInfoCircle } from '@tabler/icons-react';
import { Link, useLocation } from 'react-router-dom';
import { Menu } from '@mantine/core';
import { useAuth } from '../../auth';
import { t as tx, useLocale } from '../../i18n';
import { useShellUi } from '../../shell/ShellUi';
import { NewMenu } from '../create/NewMenu';
import { adminDestinations, INFO_HREF, isDestinationActive } from './destinations';
import classes from './Dock.module.css';

// The organizer's navigation: the admin destinations, then quiet links. Open tournaments are tabs in
// the header (OpenTabs). `rail` is the 72 px version used on tablets and when the desktop dock is
// collapsed: icons with tooltips, same links and the same menus.
export function TournamentDock({ rail }: { rail: boolean }) {
  useLocale();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const { setShortcutsOpen } = useShellUi();
  const destinations = adminDestinations(user?.role === 'admin');

  return (
    <>
      <AppShell.Section className={classes.section} pt="sm" px={rail ? 'xs' : 'sm'}>
        <NewMenu rail={rail} />
      </AppShell.Section>
      <AppShell.Section
        component="nav"
        aria-label={tx('Administration')}
        className={classes.section}
        pt="xs"
      >
        {!rail && (
          <Text variant="eyebrow" className={classes.sectionTitle}>
            {tx('Administration')}
          </Text>
        )}
        <Stack gap={2}>
          {destinations.map((d) => {
            const active = isDestinationActive(d, pathname);
            const Icon = d.icon;
            return rail ? (
              <Tooltip key={d.key} label={d.label} position="right" openDelay={300}>
                <UnstyledButton
                  component={Link}
                  to={d.to}
                  className={classes.tile}
                  data-active={active || undefined}
                  aria-label={d.label}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={21} />
                </UnstyledButton>
              </Tooltip>
            ) : (
              <NavLink
                key={d.key}
                component={Link}
                to={d.to}
                active={active}
                label={d.label}
                aria-current={active ? 'page' : undefined}
                leftSection={<Icon size={19} />}
                variant="light"
              />
            );
          })}
        </Stack>
      </AppShell.Section>
      <AppShell.Section grow />
      <Divider />
      <AppShell.Section className={classes.section} py="xs">
        {rail ? (
          <Menu position="right-end" withinPortal width={220}>
            <Menu.Target>
              <Tooltip label={tx('More')} position="right" openDelay={300}>
                <UnstyledButton className={classes.railIcon} aria-label={tx('Navigation menu')}>
                  <IconDots size={21} />
                </UnstyledButton>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item
                leftSection={<IconKeyboard size={16} />}
                onClick={() => setShortcutsOpen(true)}
              >
                {tx('Shortcuts')}
              </Menu.Item>
              <Menu.Item component="a" href={INFO_HREF} leftSection={<IconInfoCircle size={16} />}>
                {tx('Info')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        ) : (
          <Stack gap={0}>
            <Button
              variant="subtle"
              color="gray"
              justify="flex-start"
              size="compact-sm"
              fw={500}
              leftSection={<IconKeyboard size={16} />}
              onClick={() => setShortcutsOpen(true)}
            >
              {tx('Shortcuts')}
            </Button>
            <Button
              component="a"
              href={INFO_HREF}
              variant="subtle"
              color="gray"
              justify="flex-start"
              size="compact-sm"
              fw={500}
              leftSection={<IconInfoCircle size={16} />}
            >
              {tx('Info')}
            </Button>
          </Stack>
        )}
      </AppShell.Section>
    </>
  );
}
