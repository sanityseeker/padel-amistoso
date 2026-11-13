import { lazyWithPreload } from './lazyWithPreload';

// The lazy route pages, in one module the router, the shell and the nav links share: the shell warms
// the likely next pages while idle and links warm theirs on hover, focus or touch. Kept apart from
// router.tsx so the shell can import it without an import cycle.

export const EventsApp = lazyWithPreload(() =>
  import('../features/events/EventsPage').then((m) => ({ default: m.EventsPage })),
);
export const PlayerLayout = lazyWithPreload(() =>
  import('../features/player/PlayerLayout').then((m) => ({ default: m.PlayerLayout })),
);
export const Hub = lazyWithPreload(() => import('../features/player/pages/Hub'));
export const PlayerMatches = lazyWithPreload(() => import('../features/player/pages/Matches'));
export const PlayerEvent = lazyWithPreload(() => import('../features/player/pages/Event'));
export const PlayerRatings = lazyWithPreload(() => import('../features/player/pages/Ratings'));
export const PlayerMe = lazyWithPreload(() => import('../features/player/pages/Me'));
export const TournamentsPage = lazyWithPreload(() =>
  import('../features/hub/TournamentsHub').then((m) => ({ default: m.TournamentsHub })),
);
export const NewTournamentPage = lazyWithPreload(() =>
  import('../features/create/NewTournamentPage').then((m) => ({ default: m.NewTournamentPage })),
);
export const TournamentPage = lazyWithPreload(() =>
  import('../features/tournaments/pages/TournamentWorkspace').then((m) => ({
    default: m.TournamentWorkspace,
  })),
);
export const LobbyPage = lazyWithPreload(() =>
  import('../features/lobbies/LobbyPage').then((m) => ({ default: m.LobbyPage })),
);
export const ClubsPage = lazyWithPreload(() =>
  import('../features/organization/OrganizationPage').then((m) => ({
    default: m.OrganizationPage,
  })),
);
export const ClubPage = lazyWithPreload(() =>
  import('../features/organization/ClubPage').then((m) => ({ default: m.ClubPage })),
);
export const UsersPage = lazyWithPreload(() =>
  import('../features/organization/UsersPage').then((m) => ({ default: m.UsersPage })),
);
export const InfoPage = lazyWithPreload(() =>
  import('../features/info/InfoPage').then((m) => ({ default: m.InfoPage })),
);
export const TvPage = lazyWithPreload(() =>
  import('../features/tv/TvPage').then((m) => ({ default: m.TvPage })),
);
export const RegisterPage = lazyWithPreload(() =>
  import('../features/register/RegisterPage').then((m) => ({ default: m.RegisterPage })),
);
export const ClubPathPage = lazyWithPreload(() =>
  import('../features/club/ClubLanding').then((m) => ({ default: m.ClubPathLanding })),
);
export const PlayersPage = lazyWithPreload(() =>
  import('../features/players/AdminPlayers').then((m) => ({ default: m.AdminPlayersPage })),
);

type Preloadable = { preload: () => Promise<unknown> };

// Which pages a path needs, most specific prefix first. A link's hover or focus warms these.
const BY_PREFIX: [prefix: string, pages: Preloadable[]][] = [
  ['/admin/t/', [TournamentPage]],
  ['/admin/new', [NewTournamentPage]],
  ['/admin/lobby/', [LobbyPage]],
  ['/admin/clubs/', [ClubPage]],
  ['/admin/clubs', [ClubsPage]],
  ['/admin/players', [PlayersPage]],
  ['/admin/users', [UsersPage]],
  ['/admin/info', [InfoPage]],
  ['/admin', [TournamentsPage]],
  ['/player/matches/', [PlayerLayout, PlayerEvent]],
  ['/player/matches', [PlayerLayout, PlayerMatches]],
  ['/player/ratings', [PlayerLayout, PlayerRatings]],
  ['/player/me', [PlayerLayout, PlayerMe]],
  ['/player', [PlayerLayout, Hub]],
  ['/events', [EventsApp]],
  ['/tv/', [TvPage]],
  ['/register/', [RegisterPage]],
  ['/club/', [ClubPathPage]],
];

/** Starts loading the chunks of the page at `to` (a path, optionally with a query or hash). */
export function preloadFor(to: string) {
  const path = to.split(/[?#]/)[0];
  const match = BY_PREFIX.find(([prefix]) => path === prefix || path.startsWith(prefix));
  for (const page of match?.[1] ?? []) void page.preload();
}

/** Hover, focus and touch handlers that warm a link's page before the click. */
export const preloadProps = (to: string) => {
  const warm = () => preloadFor(to);
  return { onMouseEnter: warm, onFocus: warm, onTouchStart: warm };
};

// What the shell warms while idle, per section: the pages people open next. Never the Info guide,
// the Ratings page or the chart chunks, which most visits never open.
const IDLE: Record<'admin' | 'player' | 'events', Preloadable[]> = {
  admin: [TournamentPage, NewTournamentPage, LobbyPage, ClubsPage, ClubPage],
  player: [PlayerLayout, Hub, PlayerMatches, PlayerEvent, PlayerMe],
  events: [EventsApp, PlayerEvent],
};

/** Warms the likely next pages of the section `pathname` is in, one after another. */
export function preloadSection(pathname: string) {
  const section = pathname.split('/')[1];
  if (section !== 'admin' && section !== 'player' && section !== 'events') return;
  void IDLE[section].reduce<Promise<unknown>>(
    (previous, page) => previous.then(() => page.preload()),
    Promise.resolve(),
  );
}
