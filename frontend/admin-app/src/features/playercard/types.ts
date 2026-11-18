import type { Score, SetDecider } from '../../types';

/** The stage of the table a card was opened from; absent when the opener has no stage. */
export type CardStage = 'group' | 'rounds';
export type MatchStage = CardStage | 'playoff';

export type ScopeKind = 'event' | 'club' | 'season' | 'community' | 'all';
export interface ScopeOption {
  kind: ScopeKind;
  id: string | null;
  label: string;
}

/** One match as the card's player saw it (`side` is their side). */
export interface CardMatch {
  stage?: MatchStage;
  walkover?: boolean;
  round_label?: string;
  round_number?: number | null;
  team1: string[];
  team2: string[];
  side?: 1 | 2 | null;
  score?: Score | null;
  sets?: Score[] | null;
  decider?: SetDecider | null;
  elo_delta: number | null;
  /** Wider scopes: the event's name and the names on both sides of the card's player. */
  tournament_name?: string | null;
  partners?: string[];
  opponents?: string[];
  /** Wider scopes: the linked profile of each partner / opponent (null: none). */
  partner_profiles?: (string | null)[];
  opponent_profiles?: (string | null)[];
  /** The event card: this event's player ids, in the order of `team1` / `team2`. */
  team1_ids?: string[];
  team2_ids?: string[];
}

interface StageStats {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  elo_delta: number | null;
}
interface EventMember {
  player_id: string;
  name: string;
  /** Whether this player has a profile (a wider team card needs both). */
  has_profile?: boolean;
  elo: number | null;
  /** Rating change per scope: `all` or a stage. */
  elo_delta: Record<string, number | null>;
}
/** GET /tournaments/{tid}/players/{pid}/public-card: anonymous, this event only. */
export interface EventCard {
  player_name: string;
  is_team?: boolean;
  members?: EventMember[];
  stages?: MatchStage[];
  stats?: Record<string, StageStats>;
  elo: number | null;
  elo_delta_total: number | null;
  elo_scope?: string;
  matches: number;
  wins: number;
  draws?: number;
  losses: number;
  recent_matches?: CardMatch[];
  /** Matches there are to list (the list holds the newest `limit` of them). */
  recent_total?: number;
  /** A wider card can exist; which scopes this viewer may open comes from `/card-scopes`. */
  has_profile?: boolean;
}

export interface SportStats {
  sport: string;
  elo: number | null;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  elo_history: number[];
  rank?: number | null;
  tier_name?: string | null;
}
export interface Counterpart {
  name: string;
  profile_id: string | null;
  matches: number;
  wins: number;
}
/** GET /tournaments/{tid}/players/{pid}/card and /player-cards/{profile}: signed-in viewers. */
export interface ScopedCard {
  profile_id: string | null;
  name: string;
  scope: ScopeOption;
  sport: string | null;
  is_team: boolean;
  /** A pair card also carries each member's own rating in the scope. */
  members: { player_id: string; name: string; has_profile: boolean; elo?: number | null }[];
  stats: SportStats[];
  top_partners: Counterpart[];
  top_opponents: Counterpart[];
  recent_matches: CardMatch[];
  /** Matches there are to list (the list holds the newest `limit` of them). */
  recent_total: number;
  unlisted_matches: number;
  /** A team whose members both have profiles: `stats`, `top_opponents` and `recent_matches` are the pair's record together. */
  pair?: boolean;
}
