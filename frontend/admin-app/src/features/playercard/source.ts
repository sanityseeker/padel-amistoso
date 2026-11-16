import { playerApi } from '../../player/api';

/**
 * Who asks for a wider card, and with which session. The card itself never picks a token: the Hub
 * passes the profile session, the admin workspace its organizer session; the TV page passes none
 * (it shows this event only). Query keys start with the realm, so signing out of one session drops
 * only its own cards.
 */
export interface CardSource {
  realm: 'player' | 'admin';
  fetch: <T>(path: string) => Promise<T>;
}

/** The Player Hub's profile session (the stored profile JWT). */
export const playerCardSource: CardSource = {
  realm: 'player',
  fetch: <T>(path: string) => playerApi<T>(path),
};

/** A page that holds the profile JWT itself (the club landing passes it explicitly). */
export const profileCardSource = (token: () => string | null): CardSource => ({
  realm: 'player',
  fetch: <T>(path: string) => playerApi<T>(path, undefined, 'GET', token()),
});
