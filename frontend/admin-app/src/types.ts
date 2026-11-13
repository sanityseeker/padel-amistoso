import type { FilterCondition } from './features/lobbies/filter';
export interface User {
  username: string;
  role: 'admin' | 'user';
  disabled: boolean;
  email: string | null;
  default_community_id: string;
  can_create_clubs?: boolean;
  is_demo?: boolean;
  demo_expires_at?: string | null;
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
  alias?: string | null;
  season_id?: string | null;
  team_mode?: boolean;
}
export interface Community {
  id: string;
  name: string;
  created_by?: string | null;
  is_builtin?: boolean;
}
export interface Club extends Community {
  community_id: string;
  description: string | null;
  has_logo: boolean;
  slug?: string | null;
  shared?: boolean;
  created_by?: string;
  email_settings?: { reply_to?: string; sender_name?: string } | null;
  /** Pin keys (`tn:<id>`, `reg:<id>`) in the order shown on the club's public page. */
  pinned_tournament_ids?: string[];
}
export interface Tier {
  id: string;
  club_id: string;
  name: string;
  sport: string;
  base_elo: number;
  position: number;
}
export interface ClubPlayer {
  profile_id: string;
  name: string;
  email: string | null;
  has_hub_profile: boolean;
  elo_padel: number | null;
  elo_tennis: number | null;
  matches_padel: number;
  matches_tennis: number;
  tier_id_padel: string | null;
  tier_name_padel: string | null;
  tier_id_tennis: string | null;
  tier_name_tennis: string | null;
  hidden_padel: boolean;
  hidden_tennis: boolean;
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
  alias?: string | null;
  season_id?: string | null;
  latest_answer_change_id?: number | null;
  /** Answer changes newer than this organizer's seen marker (own and shared lobbies only). */
  unseen_answer_changes?: number;
  converted_to_tids?: string[];
  created_at?: string;
}
export interface Registrant {
  player_id: string;
  player_name: string;
  email: string;
  answers: Record<string, string>;
  passphrase?: string;
  token?: string;
  lang?: string;
  registered_at?: string;
  profile_id?: string | null;
}
export interface Question {
  key: string;
  label: string;
  required: boolean;
  type: string;
  choices: string[];
}
export interface LinkedTournament {
  id: string;
  name: string;
  type?: string | null;
  finished: boolean;
}
export interface LobbyDetail extends Lobby {
  registrants: Registrant[];
  questions: Question[];
  alias?: string | null;
  message?: string | null;
  admin_notes?: string | null;
  join_code?: string | null;
  auto_send_email?: boolean;
  email_requirement?: 'required' | 'optional' | 'disabled';
  converted_to_tids?: string[];
  linked_tournaments?: LinkedTournament[];
  assigned_player_ids?: string[];
  player_tournament_map?: Record<string, string[]>;
  eligible_player_ids?: string[];
  participant_filter?: FilterCondition[];
  /** The newest answer change this organizer has seen. */
  answer_changes_seen_id?: number;
  created_at?: string;
}
export interface RegistrationAnswerChange {
  id: number;
  player_id: string;
  player_name: string;
  changed_at: string;
  changes: {
    question_key: string;
    question_label: string;
    change: 'added' | 'changed' | 'removed';
    previous_answer: string | null;
    new_answer: string | null;
  }[];
}
export interface ParticipationClaim {
  id: string;
  profile_id: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  player_id: string;
  player_name: string;
  claimant_name: string;
  claimant_email: string;
  status: string;
  created_at: string;
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
export type InputFormat = 'points' | 'sets';
export type SetDecider = 'full_set' | 'match_tiebreak';
export type MatchStatus = 'scheduled' | 'in_progress' | 'completed';
export type Score = [number, number];
// Mirrors `_serialize_match` and `_serialize_format_override` in backend/api/helpers.py.
export interface FormatOverride {
  mode: InputFormat | null;
  points_target: number | null;
  decider: SetDecider | null;
}
export interface Match {
  id: string;
  team1: string[];
  team2: string[];
  team1_ids?: string[];
  team2_ids?: string[];
  court: string | null;
  status: MatchStatus | string;
  score: Score | null;
  sets: Score[] | null;
  third_set_loss?: boolean;
  slot_number?: number;
  /** Being played now: the match holds its court. */
  on_court?: boolean;
  round_number?: number;
  round_label: string;
  comment?: string;
  scored_by?: string | null;
  scored_at?: number | null;
  /** Newest score change by anyone, organizers included (seconds). */
  last_activity_at?: number | null;
  score_confirmed?: boolean;
  disputed?: boolean;
  dispute_score?: Score | null;
  dispute_sets?: Score[] | null;
  dispute_by?: string | null;
  dispute_at?: number | null;
  dispute_escalated?: boolean;
  format_review?: boolean;
  review_score?: Score | null;
  review_sets?: Score[] | null;
  review_decider?: SetDecider | null;
  format_override?: FormatOverride | null;
  effective_decider?: SetDecider | null;
  effective_points_target?: number;
  walkover?: boolean;
  bracket_side?: 'winners' | 'losers';
}
// Body of POST /api/tournaments/{tid}/matches/{mid}/resolve-dispute.
export type DisputeChoice = 'original' | 'correction' | 'custom';
export interface ResolveDisputeBody {
  chosen: DisputeChoice;
  score1?: number;
  score2?: number;
  sets?: Score[];
}
// Body of PATCH /api/tournaments/{tid}/matches/{mid}/format.
export interface SetMatchFormatBody {
  override: Partial<FormatOverride> | null;
  score1?: number;
  score2?: number;
  sets?: Score[];
}
// GET /api/tournaments/{tid}/tv-settings (only the fields the admin uses).
export interface TvSettings {
  score_mode: Record<string, InputFormat>;
  set_decider: SetDecider;
  score_confirmation: 'immediate' | 'required';
  show_courts?: boolean;
  show_past_matches?: boolean;
  show_score_breakdown?: boolean;
  show_standings?: boolean;
  show_bracket?: boolean;
  show_pending_matches?: boolean;
  hide_schedule?: boolean;
  /** Places marked in each group's standings (default 3). */
  highlight_places?: number;
  /** Group name -> places for that group; other groups use `highlight_places`. */
  highlight_places_by_group?: Record<string, number>;
  allow_player_scoring?: boolean;
  refresh_interval?: number;
  schema_box_scale?: number;
  schema_line_width?: number;
  schema_arrow_scale?: number;
  schema_title_font_scale?: number;
  schema_output_scale?: number;
  schema_format?: 'svg' | 'png';
  banner_text?: string;
  custom_info_title?: string;
  custom_info_text?: string;
  correction_window_seconds?: number;
}
// One entry of GET /api/tournaments/{tid}/player-secrets (`players` keyed by player id).
export interface PlayerSecret {
  name: string;
  passphrase: string;
  token: string;
  contact: string;
  email: string;
  profile_id: string | null;
  hub_account_linked: boolean;
  lang: string;
}
export interface PlayerSecrets {
  tournament_id: string;
  players: Record<string, PlayerSecret>;
}
// POST /api/tournaments/{tid}/player-secrets/regenerate/{player_id}.
export interface RegeneratedSecret {
  player_id: string;
  passphrase: string;
  token: string;
}
export interface Standing {
  player: string;
  player_id: string;
  total_points?: number;
  points_for?: number;
  matches_played?: number;
  played?: number;
  wins: number;
  losses?: number;
  avg_points?: number;
  buchholz?: number | null;
  rank?: number | null;
  ranked_by_avg?: boolean;
  removed?: boolean;
  withdrawn?: boolean;
  sets_won?: number;
  sets_lost?: number;
  sets_diff?: number;
  points_against?: number;
  point_diff?: number;
  elo?: number;
}
export interface TournamentStatus {
  phase: string;
  current_round?: number;
  num_rounds?: number;
  total_points_per_match?: number;
  /** Matches played in the stage now running; the total is null without a known size. */
  stage_played?: number | null;
  stage_total?: number | null;
  champion?: string[] | null;
  leaderboard?: Standing[];
  is_finished?: boolean;
  mexicano_ended?: boolean;
  rolling?: boolean;
  sit_out_count?: number;
  partner_balance_weight?: number;
  espejo?: boolean;
  double_elimination?: boolean;
  team_mode?: boolean;
  sport?: string;
  sit_outs?: string[][];
  /** Mexicano: games each player has missed (sat out) and played, by player id. */
  missed_games?: Record<string, { name: string; sat_out: number; matches_played: number }>;
  players?: { id: string; name: string }[];
  team_roster?: Record<string, string[]>;
  courts?: { id: string; name: string }[];
  assign_courts?: boolean;
  /** Group+Playoff: group names, in order. */
  group_names?: string[];
  espejo_split?: boolean;
  /** Preferred court names per group (Group+Playoff). */
  group_courts?: Record<string, string[]>;
  /** Preferred court names per Espejo side (`winners` / `losers`). */
  bracket_courts?: Record<string, string[]>;
  skill_gap?: number | null;
  win_bonus?: number;
  strength_weight?: number;
  loss_discount?: number;
  balance_tolerance?: number;
  teammate_repeat_weight?: number;
  opponent_repeat_weight?: number;
  repeat_decay?: number;
  strength_min_matches?: number;
  strength_win_factor?: number;
  strength_draw_factor?: number;
  strength_loss_factor?: number;
  withdrawals?: WithdrawalSummary[];
  withdraw_unavailable_ids?: string[];
}
export type WithdrawalKind = 'annul' | 'walkover' | 'exclude' | 'forfeit';
export interface WithdrawalSummary {
  entry_key: string;
  name: string;
  member_ids: string[];
  member_names: string[];
  kind: WithdrawalKind;
  group: string | null;
  played: number;
  total: number;
  walkovers: number;
  undo_allowed: boolean;
}
export interface WithdrawalMatchItem {
  match_id: string;
  round_label: string;
  court: string | null;
  team1: string[];
  team2: string[];
  opponent: string;
  current_score: string | null;
  resulting_score: string | null;
  mode: InputFormat | null;
  decider: SetDecider | null;
}
export interface WithdrawalPreview {
  entry_key: string;
  entry_name: string;
  member_names: string[];
  kind: WithdrawalKind;
  group: string | null;
  played: number;
  total: number;
  annul_matches: WithdrawalMatchItem[];
  walkover_matches: WithdrawalMatchItem[];
  dropped_match: WithdrawalMatchItem | null;
  sit_out_names: string[];
  pending_forfeit_match: WithdrawalMatchItem | null;
  advance_to: string | null;
  opponent_tbd: boolean;
  modes_needed: InputFormat[];
  walkover_defaults: { points: number[] | null; sets: number[][] | null };
  default_decider: SetDecider;
  deciders_needed: SetDecider[];
  elo_recalc: boolean;
  undo_possible: boolean;
  blockers: {
    match_id: string;
    round_label: string;
    reason: 'pending' | 'disputed' | 'format_review';
  }[];
}
export interface ProposalMatch {
  court_name?: string | null;
  team1_ids: string[];
  team1_names: string[];
  team2_ids: string[];
  team2_names: string[];
  score_imbalance: number;
  repeat_count: number;
}
export interface PairingProposal {
  option_id: string;
  label: string;
  strategy?: string;
  recommended?: boolean;
  matches: ProposalMatch[];
  sit_out_ids: string[];
  sit_out_names: string[];
  score_imbalance: number;
  repeat_count: number;
  exact_prev_round_repeats?: number;
  skill_gap_violations?: number;
  skill_gap_worst_excess?: number;
  /** Per player: who they would partner or face again, and how often. */
  per_person_repeats?: Record<string, RepeatDetail>;
}
export interface RepeatDetail {
  partner_repeats?: { player: string; count: number }[];
  opponent_repeats?: { player: string; count: number }[];
}
export interface RecommendedEntry {
  player_id: string;
  player: string;
  rank?: number;
  total_points?: number;
  /** Mexicano: players with different match counts are ranked by average; this is the points they project to. */
  estimated_points?: number;
  avg_points?: number;
  ranked_by_avg?: boolean;
  wins?: number;
  group?: string;
  group_rank?: number;
  withdrawn?: boolean;
}
export interface ScoreHistoryEntry {
  player_id?: string | null;
  user?: string | null;
  action: string;
  score: Score | null;
  sets: Score[] | null;
  timestamp: number;
}
export interface MatchData {
  current_matches?: Match[];
  all_matches?: Match[];
  pending?: Match[];
  matches?: Match[] | Record<string, Match[]>;
  standings?: Record<string, Standing[]>;
  has_more_rounds?: boolean;
}
