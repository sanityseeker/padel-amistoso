import type { Match } from '../types';

export interface Profile {
  id: string;
  name: string;
  email: string;
  email_verified: boolean;
  contact: string;
  passphrase: string | null;
  elo_padel: number | null;
  elo_tennis: number | null;
  elo_padel_matches: number;
  elo_tennis_matches: number;
}
export interface Entry {
  entity_type: 'tournament' | 'registration';
  entity_id: string;
  entity_name: string;
  player_id: string;
  player_name: string;
  status: 'active' | 'finished';
  alias: string | null;
  auto_login_token: string | null;
  sport: string;
  tournament_type: string | null;
  entity_deleted: boolean;
  rank: number | null;
  total_players: number | null;
  wins: number;
  losses: number;
  draws: number;
  elo_before: number | null;
  elo_after: number | null;
  community_id: string | null;
  club_id: string | null;
}
export interface EloMatch {
  tournament_id: string;
  tournament_name: string;
  match_id: string;
  sport: string;
  updated_at: string;
  elo_before: number;
  elo_after: number;
  elo_delta: number;
  score: number[];
  sets: number[][];
  is_manual: boolean;
  adjustment_reason: string | null;
}
export interface Space {
  profile: Profile;
  access_token: string;
  entries: Entry[];
  elo_history: EloMatch[];
  player_communities: { id: string; name: string }[];
  player_clubs: { id: string; name: string; community_id: string }[];
}
export interface Session {
  profile: Profile;
  access_token: string;
}
export interface Resolution {
  type: 'profile' | 'participation' | 'not_found';
  matches: {
    entity_type: 'tournament' | 'registration';
    entity_id: string;
    entity_name: string;
    player_name: string;
  }[];
}
export interface PlayerMatch extends Match {
  team1_ids: string[];
  team2_ids: string[];
  scored_by: string | null;
  score_confirmed: boolean;
  format_override?: { mode?: string } | null;
  effective_decider?: 'full_set' | 'match_tiebreak' | null;
}
export interface HubPayment {
  key: string;
  entity_name: string;
  status: string;
  amount_cents: number;
  currency: string;
  instructions: string | null;
  concept: string;
  methods: { kind: string; label: string | null; value: string }[];
}
export interface Leaderboard {
  padel: { rank: number; name: string; elo: number; matches: number; tier_name: string | null }[];
  tennis: { rank: number; name: string; elo: number; matches: number; tier_name: string | null }[];
}
