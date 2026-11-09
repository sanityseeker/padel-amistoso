import { ApiError } from '../api';

export interface PublicEvent {
  id: string;
  name: string;
  alias: string | null;
  status: 'in_progress' | 'open_registration' | 'upcoming' | 'finished';
  kind: 'tournament' | 'registration';
  sport: 'padel' | 'tennis';
  type: string;
  club_id: string | null;
  club_name: string | null;
  club_logo_url: string | null;
  community_id: string;
  community_name: string | null;
  registrant_count: number | null;
  join_code_required: boolean;
}

// Public listings always use the anonymous API, regardless of any organizer or
// player session saved in this browser. Private events must not enter this list.
export async function publicApi<T>(path: string, signal?: AbortSignal): Promise<T> {
  // Revalidate even inside the endpoint's short HTTP cache window, otherwise
  // an SSE-triggered refresh can keep showing the previous visibility/state.
  const response = await fetch(`/api${path}`, { signal, credentials: 'omit', cache: 'no-cache' });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      typeof body?.detail === 'string' ? body.detail : `Unable to load events (${response.status})`,
      response.status,
    );
  }
  return body as T;
}

export function publicEventUrl(event: PublicEvent): string {
  return `/${event.kind === 'registration' ? 'register' : 'tv'}/${encodeURIComponent(event.alias || event.id)}`;
}

export async function findEvent(value: string): Promise<string> {
  const slug = encodeURIComponent(value.trim());
  if (!slug) throw new Error('Enter an event ID or alias.');
  for (const path of [`/tournaments/resolve-alias/${slug}`, `/tournaments/${slug}/meta`]) {
    try {
      await publicApi(path);
      return `/tv/${slug}`;
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  }
  try {
    await publicApi(`/registrations/${slug}/public`);
    return `/register/${slug}`;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404)
      throw new Error('No event found with that ID or alias. Check the code from your organizer.');
    throw error;
  }
}
