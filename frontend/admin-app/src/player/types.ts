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
/** A partner or rival in one tournament, as `/player-profile/space` reports it. */
export interface Counterpart {
  id?: string;
  name: string;
  /** The name the person has now (a profile may have been renamed since the event). */
  current_name?: string;
  profile_id?: string;
  games: number;
  wins: number;
  win_pct?: number;
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
  finished_at?: string | null;
  /** Play-off result ("Champion", "Final", "Semi-Final" ...) and its order (1 = best). */
  playoff_stage?: string | null;
  playoff_stage_rank?: number | null;
  top_partners?: Counterpart[];
  top_rivals?: Counterpart[];
  all_partners?: Counterpart[];
  all_rivals?: Counterpart[];
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
  adjusted_by?: string | null;
  tournament_alias?: string | null;
  match_order?: number;
  player_id?: string;
  decider?: string | null;
  team1?: { player_id: string; player_name: string; elo_before: number; elo_after: number }[];
  team2?: { player_id: string; player_name: string; elo_before: number; elo_after: number }[];
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
  effective_decider?: 'full_set' | 'match_tiebreak' | null;
}
export interface HubPayment {
  key: string;
  entity_type: 'tournament' | 'registration';
  entity_id: string;
  entity_name: string;
  player_id?: string;
  status: 'unpaid' | 'reported' | 'paid' | 'waived' | 'refund_due' | 'refunded';
  amount_cents: number;
  currency: string;
  due_at: string | null;
  instructions: string | null;
  concept: string;
  reference: string | null;
  methods: { kind: string; label: string | null; value: string }[];
  /** Keys of every entry that shows this one fee (a lobby converted into several tournaments). */
  entry_keys?: string[];
}
export interface Leaderboard {
  padel: {
    rank: number;
    name: string;
    elo: number;
    matches: number;
    tier_name: string | null;
    profile_id?: string | null;
  }[];
  tennis: {
    rank: number;
    name: string;
    elo: number;
    matches: number;
    tier_name: string | null;
    profile_id?: string | null;
  }[];
}

export interface TvPlayerSettings {
  /** The organizer hides unplayed matches, groups and the bracket from players. */
  hide_schedule?: boolean;
  /** Places marked in each group's standings (default 3). */
  highlight_places?: number;
  /** Group name -> places for that group; other groups use `highlight_places`. */
  highlight_places_by_group?: Record<string, number>;
  allow_player_scoring: boolean;
  score_mode: Record<string, string>;
  set_decider: 'full_set' | 'match_tiebreak';
  score_confirmation?: 'immediate' | 'required';
  /** Seconds the submitter may still correct a score nobody has confirmed yet (0 = no window). */
  correction_window_seconds?: number;
}
export interface PathRound {
  round_number: number;
  round_label: string;
  cumulative_points: number;
  rank: number | null;
  total_players: number;
  partners: string[];
  opponents: string[];
  played: boolean;
  score: string | null;
  score_mode: 'points' | 'tennis';
  round_points_delta: number | null;
  round_sets_diff_delta: number | null;
  round_games_diff_delta: number | null;
  cumulative_sets_diff: number | null;
  cumulative_games_diff: number | null;
  eliminated: boolean;
  stage: string;
  walkover: boolean;
  walkover_lost: boolean;
}
export interface TournamentPath {
  entity_id: string;
  player_id: string;
  tournament_type: string | null;
  available: boolean;
  reason: string | null;
  rounds: PathRound[];
}
