import { useAuth } from './auth';

/**
 * Demo sandbox accounts cannot use communities, clubs, public addresses, contact details, lobbies or
 * Player Hub links: the server refuses or strips them, and the screens grey the controls out with this hint
 * instead of hiding them.
 */
export function useDemoAccount(): boolean {
  return !!useAuth().user?.is_demo;
}
