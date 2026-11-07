export interface User {
  username: string;
  role: 'admin' | 'user';
  disabled: boolean;
  email: string | null;
  default_community_id: string;
}
export interface Tournament {
  id: string;
  name: string;
  type: 'mexicano' | 'group_playoff' | 'playoff';
  sport: 'padel' | 'tennis';
  phase: string;
  owner: string;
  shared: boolean;
  public: boolean;
  community_id: string;
  club_id: string | null;
  club_name: string | null;
  community_name: string;
  created_at: string;
}
export interface Community {
  id: string;
  name: string;
}
export interface Club extends Community {
  community_id: string;
  description: string | null;
  has_logo: boolean;
}
export interface Season extends Community {
  active: boolean;
}
export interface Lobby extends Community {
  owner: string;
  shared: boolean;
  listed: boolean;
  community_name: string | null;
  open: boolean;
  archived: boolean;
  registrant_count: number;
  sport: string;
  club_name: string | null;
  club_id: string | null;
  community_id: string;
  description: string | null;
}
export interface Registrant {
  player_id: string;
  player_name: string;
  email: string;
  answers: Record<string, string>;
}
export interface Question {
  key: string;
  label: string;
  required: boolean;
  type: string;
  choices: string[];
}
export interface LobbyDetail extends Lobby {
  registrants: Registrant[];
  questions: Question[];
}
export type PaymentStatus = 'unpaid' | 'reported' | 'paid' | 'waived' | 'refund_due' | 'refunded';
export interface PaymentRow {
  player_id: string;
  player_name: string;
  status: PaymentStatus;
  amount_cents: number;
  currency: string;
  method: string | null;
  concept: string;
}
export interface Payments {
  settings: { fee_cents: number; currency: string; instructions: string | null };
  rows: PaymentRow[];
  summary: {
    total: number;
    paid: number;
    unpaid: number;
    reported: number;
    collected_cents: number;
  };
}
export interface Match {
  id: string;
  team1: string[];
  team2: string[];
  court: string | null;
  status: string;
  score: [number, number] | null;
  sets: [number, number][] | null;
  round_label: string;
  effective_points_target?: number;
  disputed?: boolean;
  format_review?: boolean;
}
export interface Standing {
  player: string;
  player_id: string;
  total_points?: number;
  points_for?: number;
  matches_played?: number;
  played?: number;
  wins: number;
  elo?: number;
}
export interface TournamentStatus {
  phase: string;
  current_round?: number;
  num_rounds?: number;
  total_points_per_match?: number;
  champion?: string[] | null;
  leaderboard?: Standing[];
  is_finished?: boolean;
  mexicano_ended?: boolean;
}
export interface MatchData {
  current_matches?: Match[];
  all_matches?: Match[];
  pending?: Match[];
  matches?: Match[] | Record<string, Match[]>;
  standings?: Record<string, Standing[]>;
  has_more_rounds?: boolean;
}
