import { useMemo, type ReactNode } from 'react';
import { Box, Kbd, Text, useMantineColorScheme } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import {
  Spotlight,
  type SpotlightActionData,
  type SpotlightFilterFunction,
} from '@mantine/spotlight';
import {
  IconArrowRight,
  IconBuildingCommunity,
  IconDeviceTv,
  IconDownload,
  IconInfoCircle,
  IconKey,
  IconKeyboard,
  IconListCheck,
  IconLockPassword,
  IconLogout,
  IconMoon,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconSun,
  IconSunMoon,
  IconTable,
  IconTrophy,
  IconUser,
  IconUsersGroup,
  IconWorld,
} from '@tabler/icons-react';
import { matchPath, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth';
import { getClubSubdomain } from '../../club-context';
import {
  LANGUAGES,
  SELECTABLE,
  currentLanguage,
  setLanguage,
  t as tx,
  useLocale,
} from '../../i18n';
import { isDemoInstance, rememberPage } from '../../shell/env';
import { useLayoutMode } from '../../shell/layout';
import { useShellUi } from '../../shell/ShellUi';
import { sportProps } from '../../theme';
import {
  adminDestinations,
  INFO_HREF,
  LOBBIES_HREF,
  NEW_LOBBY_HREF,
  NEW_TOURNAMENT_HREF,
} from './destinations';
import { useOrderedItems, useSwitcherIndex, type IndexEntry } from './entries';
import { modifierLabel } from './hotkeys';
import { openPath } from './openItems';
import { matchScore } from './search';
import { useWorkspaceInfo, workspace } from './workspace';

const RECENT_KEY = 'amistoso-palette-recent';
const RECENT_COUNT = 5;
type SpotlightActions = Parameters<SpotlightFilterFunction>[1][number];

interface Command {
  id: string;
  group: string;
  label: string;
  description?: string;
  icon: ReactNode;
  /** English labels and ids, so muscle memory works in both languages. */
  keywords?: string[];
  hint?: ReactNode;
  run: () => void;
}

const kindIcon = {
  tournament: <IconTrophy size={18} />,
  lobby: <IconUsersGroup size={18} />,
  club: <IconBuildingCommunity size={18} />,
  community: <IconBuildingCommunity size={18} />,
  player: <IconUser size={18} />,
} as const;

// Command palette. Everything it searches is already in memory (the cached lists and the open
// workspace), and anything that changes data only opens the workspace's confirmation modal.
export function Palette() {
  useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const { setColorScheme } = useMantineColorScheme();
  const { install, setPasswordOpen, setShortcutsOpen } = useShellUi();
  const items = useOrderedItems();
  const activeTid = matchPath('/admin/t/:id', pathname)?.params.id;
  const index = useSwitcherIndex(activeTid);
  const info = useWorkspaceInfo();
  const phone = useLayoutMode().mode === 'phone';
  const [recent, setRecent] = useLocalStorage<string[]>({
    key: RECENT_KEY,
    defaultValue: [],
    getInitialValueInEffect: false,
  });

  const commands = useMemo(() => {
    const list: Command[] = [];
    const go = (to: string) => () => navigate(to);
    const isAdmin = user?.role === 'admin';
    const mod = modifierLabel();

    // Jump to: open items first (with their dock slot), then everything else in the cache.
    const openKeys = new Set(items.map((i) => i.kind + i.id));
    items.forEach((item, at) => {
      const entry = index.find((e) => e.kind === item.kind && e.id === item.id);
      list.push({
        id: `jump:${item.kind}:${item.id}`,
        group: tx('Jump to'),
        label: entry?.label ?? item.name,
        description: entry?.description,
        icon: entryIcon(item.kind, entry?.sport),
        keywords: [item.id],
        hint: at < 8 ? <Kbd size="xs">{`${mod}+${at + 1}`}</Kbd> : undefined,
        run: go(openPath(item)),
      });
    });
    for (const entry of index) {
      if (entry.kind === 'player' || openKeys.has(entry.kind + entry.id)) continue;
      list.push(entryCommand(entry, tx('Jump to'), go(entry.path)));
    }

    // In this tournament.
    if (info) {
      const group = tx('In this tournament');
      if (info.canEdit && info.hasPending)
        list.push({
          id: 'ws:score-next',
          group,
          label: tx('Score next match'),
          description: info.name,
          icon: <IconPlayerPlay size={18} />,
          keywords: ['score next match record result'],
          hint: <Kbd size="xs">S</Kbd>,
          run: () => workspace()?.scoreNext(),
        });
      if (info.nextRoundLabel)
        list.push({
          id: 'ws:next-round',
          group,
          label: `${info.nextRoundLabel}...`,
          description: tx('Asks for confirmation'),
          icon: <IconArrowRight size={18} />,
          keywords: ['next round start play-offs advance'],
          run: () => window.setTimeout(() => workspace()?.nextRound(), 50),
        });
      list.push(
        {
          id: 'ws:matches',
          group,
          label: tx('Show matches'),
          icon: <IconListCheck size={18} />,
          keywords: ['matches'],
          run: () => workspace()?.showView('matches'),
        },
        {
          id: 'ws:standings',
          group,
          label: tx('Show standings'),
          icon: <IconTable size={18} />,
          keywords: ['standings'],
          run: () => workspace()?.showView('standings'),
        },
      );
      if (info.canEdit)
        list.push({
          id: 'ws:review',
          group,
          label: tx('Show review queue'),
          description: info.reviewCount ? tx('{n} to review', { n: info.reviewCount }) : undefined,
          icon: <IconListCheck size={18} />,
          keywords: ['review queue disputes'],
          run: () => workspace()?.showView('review'),
        });
      list.push({
        id: 'ws:tv',
        group,
        label: tx('Open TV view'),
        icon: <IconDeviceTv size={18} />,
        keywords: ['tv view spectator'],
        run: () => window.location.assign(`/tv/${info.tid}`),
      });
      for (const entry of index)
        if (entry.kind === 'player')
          list.push({
            id: `player:${entry.id}`,
            group: tx('Players'),
            label: entry.label,
            description: entry.description,
            icon: kindIcon.player,
            keywords: [entry.label],
            run: () =>
              entry.matchId
                ? workspace()?.focusMatch(entry.matchId)
                : workspace()?.showView('standings'),
          });
    }

    // Pages.
    const pages = tx('Go to');
    if (user) {
      for (const d of adminDestinations(isAdmin)) {
        const Icon = d.icon;
        list.push({
          id: `go:${d.key}`,
          group: pages,
          label: d.label,
          icon: <Icon size={18} />,
          keywords: [d.key],
          hint: d.chord ? (
            <>
              <Kbd size="xs">g</Kbd> <Kbd size="xs">{d.chord}</Kbd>
            </>
          ) : undefined,
          run: go(d.to),
        });
      }
      list.push(
        {
          id: 'go:new',
          group: pages,
          label: tx('New tournament'),
          icon: <IconPlus size={18} />,
          keywords: ['create tournament new'],
          hint: (
            <>
              <Kbd size="xs">g</Kbd> <Kbd size="xs">n</Kbd>
            </>
          ),
          run: go(NEW_TOURNAMENT_HREF),
        },
        {
          id: 'go:new-lobby',
          group: pages,
          label: tx('New lobby'),
          icon: <IconPlus size={18} />,
          keywords: ['create lobby registration new'],
          run: go(NEW_LOBBY_HREF),
        },
        {
          id: 'go:lobbies',
          group: pages,
          label: tx('Lobbies'),
          icon: <IconUsersGroup size={18} />,
          keywords: ['lobbies registrations sign-ups'],
          hint: (
            <>
              <Kbd size="xs">g</Kbd> <Kbd size="xs">l</Kbd>
            </>
          ),
          run: go(LOBBIES_HREF),
        },
        {
          id: 'go:info',
          group: pages,
          label: tx('Info'),
          icon: <IconInfoCircle size={18} />,
          keywords: ['info about'],
          run: () => window.location.assign(INFO_HREF),
        },
        {
          id: 'go:shortcuts',
          group: pages,
          label: tx('Keyboard shortcuts'),
          icon: <IconKeyboard size={18} />,
          keywords: ['shortcuts keys help'],
          hint: <Kbd size="xs">?</Kbd>,
          run: () => setShortcutsOpen(true),
        },
      );
    }
    list.push({
      id: 'go:events',
      group: pages,
      label: getClubSubdomain() ? tx('Club') : tx('Events'),
      icon: <IconTrophy size={18} />,
      keywords: ['events directory'],
      run: () => {
        rememberPage('events');
        if (getClubSubdomain()) window.location.assign('/');
        else navigate('/events');
      },
    });
    if (!isDemoInstance())
      list.push({
        id: 'go:hub',
        group: pages,
        label: tx('Player Hub'),
        icon: <IconUser size={18} />,
        keywords: ['player hub my hub'],
        run: () => {
          rememberPage('player');
          navigate('/player');
        },
      });
    if (!user)
      list.push({
        id: 'go:admin-sign-in',
        group: pages,
        label: tx('Admin sign in'),
        icon: <IconKey size={18} />,
        keywords: ['admin login'],
        run: () => {
          rememberPage('admin');
          navigate('/admin');
        },
      });

    // Preferences.
    const prefs = tx('Preferences');
    const languageKeywords: Record<string, string> = {
      en: 'language english idioma',
      es: 'language spanish espanol idioma',
      ru: 'language russian ru russkiy idioma',
    };
    list.push(
      ...LANGUAGES.filter((entry) => SELECTABLE.includes(entry.code)).map((entry) => ({
        id: `pref:lang-${entry.code}`,
        group: prefs,
        label: `${tx('Language')}: ${entry.name}`,
        icon: <IconWorld size={18} />,
        keywords: [languageKeywords[entry.code]],
        description: currentLanguage() === entry.code ? tx('Current') : undefined,
        run: () => void setLanguage(entry.code),
      })),
      {
        id: 'pref:theme-auto',
        group: prefs,
        label: `${tx('Theme')}: ${tx('Auto')}`,
        icon: <IconSunMoon size={18} />,
        keywords: ['theme auto system tema'],
        run: () => setColorScheme('auto'),
      },
      {
        id: 'pref:theme-light',
        group: prefs,
        label: `${tx('Theme')}: ${tx('Light')}`,
        icon: <IconSun size={18} />,
        keywords: ['theme light claro'],
        run: () => setColorScheme('light'),
      },
      {
        id: 'pref:theme-dark',
        group: prefs,
        label: `${tx('Theme')}: ${tx('Dark')}`,
        icon: <IconMoon size={18} />,
        keywords: ['theme dark oscuro'],
        run: () => setColorScheme('dark'),
      },
    );
    if (install.state !== 'hidden')
      list.push({
        id: 'pref:install',
        group: prefs,
        label: tx('Install app'),
        icon: <IconDownload size={18} />,
        keywords: ['install app pwa'],
        run: install.install,
      });

    if (user) {
      const account = tx('Account');
      list.push(
        {
          id: 'account:password',
          group: account,
          label: tx('Change password'),
          icon: <IconLockPassword size={18} />,
          keywords: ['change password account'],
          run: () => window.setTimeout(() => setPasswordOpen(true), 50),
        },
        {
          id: 'account:logout',
          group: account,
          label: tx('Log out'),
          icon: <IconLogout size={18} />,
          keywords: ['log out sign out logout'],
          run: logout,
        },
      );
    }
    return list;
  }, [
    items,
    index,
    info,
    user,
    install.state,
    currentLanguage(),
    navigate,
    logout,
    setColorScheme,
    setPasswordOpen,
    setShortcutsOpen,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => new Map(commands.map((c) => [c.id, c])), [commands]);

  const toAction = (c: Command, idPrefix = ''): SpotlightActionData => ({
    id: idPrefix + c.id,
    label: c.label,
    description: c.description,
    leftSection: c.icon,
    rightSection: c.hint,
    keywords: c.keywords,
    onClick: () => {
      setRecent((previous) =>
        [c.id, ...previous.filter((id) => id !== c.id)].slice(0, RECENT_COUNT),
      );
      c.run();
    },
  });

  // Fuzzy filter over label, description and keywords. Groups keep their order; entries sort by score.
  const filter: SpotlightFilterFunction = (query, groups) => {
    const flat = (groups as SpotlightActions[]).flatMap((g) => ('actions' in g ? g.actions : [g]));
    if (!query.trim()) {
      // Browsing: open items and commands only; the full lists and players appear once you type.
      const openIds = new Set(items.map((i) => `jump:${i.kind}:${i.id}`));
      return (groups as SpotlightActions[])
        .map((g) =>
          'actions' in g
            ? {
                ...g,
                actions: g.actions.filter(
                  (a) =>
                    !a.id.startsWith('player:') && (!a.id.startsWith('jump:') || openIds.has(a.id)),
                ),
              }
            : g,
        )
        .filter((g) => !('actions' in g) || g.actions.length);
    }
    const scored = flat
      .map((action) => ({
        action,
        score: matchScore(
          query,
          [
            action.label ?? '',
            action.description ?? '',
            ...(Array.isArray(action.keywords) ? action.keywords : [action.keywords ?? '']),
          ],
          action.id.split(':').slice(2).join(':') || undefined,
        ),
      }))
      .filter((r) => r.score > 0 && !r.action.id.startsWith('recent:'));
    const order: string[] = [];
    for (const g of groups as SpotlightActions[]) if ('actions' in g) order.push(g.group);
    return order
      .map((group) => ({
        group,
        actions: scored
          .filter((r) => groupOf(groups as SpotlightActions[], r.action.id) === group)
          .sort((a, b) => b.score - a.score)
          .map((r) => r.action),
      }))
      .filter((g) => g.actions.length);
  };

  const actions: SpotlightActions[] = useMemo(() => {
    const groups: SpotlightActions[] = [];
    const recents = recent.map((id) => byId.get(id)).filter((c): c is Command => !!c);
    if (recents.length)
      groups.push({
        group: tx('Recent commands'),
        actions: recents.map((c) => toAction(c, 'recent:')),
      });
    const order: string[] = [];
    for (const c of commands) if (!order.includes(c.group)) order.push(c.group);
    for (const group of order)
      groups.push({
        group,
        actions: commands.filter((c) => c.group === group).map((c) => toAction(c)),
      });
    return groups;
  }, [commands, recent, byId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Spotlight
      actions={actions}
      filter={filter}
      shortcut="mod + K"
      tagsToIgnore={[]}
      limit={30}
      highlightQuery
      scrollable
      maxHeight="min(70dvh, 520px)"
      searchProps={{
        leftSection: <IconSearch size={18} />,
        placeholder: tx('Search or jump...'),
        'aria-label': tx('Search or jump...'),
      }}
      nothingFound={
        <Text c="dimmed" size="sm">
          {tx('Nothing matches.')}
        </Text>
      }
      radius="lg"
      fullScreen={phone}
    />
  );
}

function groupOf(groups: SpotlightActions[], id: string): string | undefined {
  for (const g of groups) if ('actions' in g && g.actions.some((a) => a.id === id)) return g.group;
  return undefined;
}

// Tournaments and lobbies keep their sport color in the palette: blue padel, green tennis.
function entryIcon(kind: keyof typeof kindIcon, sport?: string) {
  return sport ? (
    <Box component="span" display="inline-flex" c="var(--sport-accent)" {...sportProps(sport)}>
      {kindIcon[kind]}
    </Box>
  ) : (
    kindIcon[kind]
  );
}

function entryCommand(entry: IndexEntry, group: string, run: () => void): Command {
  return {
    id: `jump:${entry.kind}:${entry.id}`,
    group,
    label: entry.label,
    description: entry.description,
    icon: entryIcon(entry.kind, entry.sport),
    keywords: entry.keywords,
    run,
  };
}
