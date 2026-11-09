import type { ComponentType } from 'react';
import {
  IconBuildingCommunity,
  IconTrophy,
  IconUserSearch,
  IconUserShield,
} from '@tabler/icons-react';
import { t as tx } from '../../i18n';

export interface Destination {
  key: 'tournaments' | 'clubs' | 'players' | 'users';
  to: string;
  label: string;
  icon: ComponentType<{ size?: number }>;
  /** Shortcut chord after "g". */
  chord?: string;
  exact: boolean;
}

/** Where creation and the lobby list live. There is one create flow (`/admin/new`, the tile picks the
 *  kind) and one events hub (`/admin`, `?type=lobby` filters it to lobbies). */
export const NEW_TOURNAMENT_HREF = '/admin/new';
export const NEW_LOBBY_HREF = '/admin/new?type=lobby';
export const LOBBIES_HREF = '/admin?type=lobby';
/** Shortcut chords (after "g") that are not navigation items. */
export const EXTRA_CHORDS: { chord: string; to: string }[] = [
  { chord: 'l', to: LOBBIES_HREF },
  { chord: 'n', to: NEW_TOURNAMENT_HREF },
];

/** The admin sections, in dock and palette order. Users is for admin accounts only. */
export function adminDestinations(isAdmin: boolean): Destination[] {
  const list: Destination[] = [
    {
      key: 'tournaments',
      to: '/admin',
      label: tx('Tournaments'),
      icon: IconTrophy,
      chord: 't',
      exact: true,
    },
    {
      key: 'clubs',
      to: '/admin/clubs',
      label: tx('Clubs & communities'),
      icon: IconBuildingCommunity,
      chord: 'c',
      exact: false,
    },
  ];
  if (isAdmin)
    list.push(
      {
        key: 'players',
        to: '/admin/players',
        label: tx('Player profiles'),
        icon: IconUserSearch,
        chord: 'p',
        exact: false,
      },
      {
        key: 'users',
        to: '/admin/users',
        label: tx('Users'),
        icon: IconUserShield,
        exact: true,
      },
    );
  return list;
}

export const isDestinationActive = (destination: Destination, pathname: string) =>
  destination.exact ? pathname === destination.to : pathname.startsWith(destination.to);

export const INFO_HREF = '/admin/info';
