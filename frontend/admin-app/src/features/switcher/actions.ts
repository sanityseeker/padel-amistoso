import { useNavigate, useLocation, matchPath } from 'react-router-dom';
import { notifications } from '@mantine/notifications';
import { t as tx } from '../../i18n';
import { useAuth } from '../../auth';
import { useLobbyList, useTournamentList } from '../../components';
import {
  byRecency,
  closeItem,
  closeItems,
  movePinned,
  openPath,
  togglePin,
  useOpenItems,
  type OpenItem,
} from './openItems';

export const publicLink = (item: Pick<OpenItem, 'id' | 'kind'>) =>
  `${window.location.origin}/${item.kind === 'lobby' ? 'register' : 'tv'}/${item.id}`;

// Everything a dock row, rail tile, switcher card or palette entry can do to an open item. Closing the
// item you are looking at moves you to the most recently visited neighbour instead of a dead page.
export function useItemActions() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = useOpenItems();
  const { user } = useAuth();
  const tournaments = useTournamentList(!!user);
  const lobbies = useLobbyList(!!user);
  const activeId =
    matchPath('/admin/t/:id', pathname)?.params.id ??
    matchPath('/admin/lobby/:id', pathname)?.params.id;

  const leaveIfActive = (closed: OpenItem[]) => {
    if (!closed.some((i) => i.id === activeId)) return;
    const remaining = byRecency(items.filter((i) => !closed.includes(i)));
    navigate(remaining[0] ? openPath(remaining[0]) : '/admin');
  };

  return {
    activeId,
    open: (item: OpenItem) => navigate(openPath(item)),
    openInNewTab: (item: OpenItem) => window.open(openPath(item), '_blank', 'noopener'),
    togglePin: (item: OpenItem) => {
      if (!togglePin(item))
        notifications.show({ message: tx('You can pin up to 8 items.'), color: 'yellow' });
    },
    move: (item: OpenItem, delta: -1 | 1) => movePinned(item, delta),
    copyLink: async (item: OpenItem) => {
      try {
        await navigator.clipboard.writeText(publicLink(item));
        notifications.show({ message: tx('Link copied'), color: 'green' });
      } catch {
        notifications.show({ message: tx('Could not copy the link.'), color: 'red' });
      }
    },
    close: (item: OpenItem) => {
      closeItem(item.id);
      leaveIfActive([item]);
    },
    closeOthers: (keep: OpenItem) => {
      const others = items.filter((i) => i !== keep && !i.pinned);
      closeItems((i) => others.includes(i));
      leaveIfActive(others);
    },
    closeFinished: () => {
      const finished = new Set([
        ...(tournaments.data ?? []).filter((t) => t.phase === 'finished').map((t) => t.id),
        ...(lobbies.data ?? []).filter((l) => l.archived).map((l) => l.id),
      ]);
      const gone = items.filter((i) => finished.has(i.id));
      closeItems((i) => gone.includes(i));
      leaveIfActive(gone);
    },
  };
}
