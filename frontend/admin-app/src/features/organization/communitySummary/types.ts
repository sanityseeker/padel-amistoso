export interface EloChangeTotals {
  net: number;
  gained: number;
  lost: number;
  matches: number;
  players: number;
}
export interface ClubPlayerChange {
  profile_id: string;
  name: string;
  sport: string;
  net: number;
  gained: number;
  lost: number;
  matches: number;
  elo_now: number | null;
}
export interface ClubEloSummary {
  club_id: string;
  club_name: string;
  sport: string;
  totals: EloChangeTotals;
  unlinked: EloChangeTotals;
  unrated_matches: number;
  players: ClubPlayerChange[];
}
export interface CrossClubPlayer {
  profile_id: string;
  name: string;
  sport: string;
  net: number;
  gained: number;
  lost: number;
  matches: number;
  clubs: number;
}
export interface CommunityEloSummary {
  community_id: string;
  sport: string;
  from_ts: string | null;
  to_ts: string | null;
  totals: Record<string, EloChangeTotals>;
  clubs: ClubEloSummary[];
  clubs_hidden: number;
  cross_club_players: CrossClubPlayer[];
  note: string;
}
