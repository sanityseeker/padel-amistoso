"""
Mexicano tournament format.

Rules:
  - Fixed total points per match (e.g. 32 points — first to 16, or timed).
  - After each round, players are re-paired by current rating/ranking.
  - Group formation is controlled by the ``skill_gap`` parameter:
      * ``None`` (default) — snake-draft: high-scorers are spread across
        courts so no single match monopolises the strongest players.
      * Integer (points) — tier grouping: players are only placed in the
        same group if their score difference is ≤ skill_gap.  This keeps
        strong players together and weak players together, while still
        allowing natural mixing once scores converge.
  - Within each group the 2v2 split is chosen to minimise the score difference
    between the two teams (most competitive match), with partner/opponent repeat
    counts used as a secondary tie-breaker to encourage novelty.
  - Each player accumulates the points they scored; overall ranking = total points.
  - If the player count is NOT divisible by 4, some players sit out each round.
    Sit-out selection is fair (fewest sit-outs first) and tie-broken by choosing
    the player(s) whose absence minimises match imbalance, then maximises novelty.
"""

from __future__ import annotations

import itertools
import random
from collections import defaultdict
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ..models import Court, Match, MatchStatus, MexPhase, Player
from . import pairing as pairing_mod

if TYPE_CHECKING:
    from .playoff import DoubleEliminationBracket, SingleEliminationBracket


class MexicanoConfig(BaseModel):
    """Validated scalar configuration for a Mexicano tournament."""

    model_config = ConfigDict(frozen=True)

    total_points_per_match: int = Field(default=32, ge=1)
    num_rounds: int = Field(default=8, ge=0)
    skill_gap: int | None = Field(default=None, ge=0)
    win_bonus: int = Field(default=0, ge=0)
    strength_weight: float = Field(default=0.0, ge=0.0, le=1.0)
    loss_discount: float = Field(default=1.0, ge=0.0, le=1.0)
    balance_tolerance: float = Field(default=0.2, ge=0.0)
    team_mode: bool = False


class MexicanoTournament:
    """
    Manages a Mexicano‑style tournament.

    Parameters
    ----------
    players : list[Player]
        Any number >= 4.  If not divisible by 4 some will sit out each round.
    courts : list[Court]
        Available courts.
    total_points_per_match : int
        Fixed total of points in every match (e.g. 32).
        Both teams' scores must sum to this value.
    num_rounds : int
        How many rounds to play.  ``0`` means **rolling mode** — unlimited
        rounds; the tournament keeps going until you manually start play-offs.
    skill_gap : int | None
        Maximum allowed point difference between any two players in the same
        group of 4.  ``None`` (default) disables the cap and uses a snake-draft
        to spread top players across courts instead.  Set this to a positive
        integer (e.g. 30 or 50) when you want to prevent strong players from
        being paired with much weaker players — they will only be grouped with
        opponents/partners whose accumulated points are within *skill_gap* of
        their own.  If there are not enough players within the gap to form a
        full group of 4, the constraint is relaxed for that group.
    win_bonus : int
        Flat extra leaderboard points awarded to the winning team per match
        (on top of the points they scored).  0 = disabled (default).
        Draws do not trigger the bonus.
    strength_weight : float  (0.0 – 1.0)
        Controls how much the opponent team's absolute estimated score boosts
        the points you earn.  0 = disabled (default, pure raw score).
        Uses estimated scores (extrapolated for sit-out imbalance) so the
        bonus is fair even when players have played different numbers of
        matches.  Returns 0 in the first round (all scores are zero) so
        no artificial bonus is assigned before any matches are played.
        At 1.0 the multiplier ranges from 1.0 (beating the lowest-scoring
        team) to 2.0 (beating the top-scoring team), scaling linearly
        with the opponent team's average estimated points.
    loss_discount : float  (0.0 – 1.0)
        Multiplier applied to the **losing** team's raw score before it is
        added to their leaderboard total.  1.0 = no discount (default).
        0.75 means losers keep only 75 % of the points they scored.
        Draws are not discounted.
    balance_tolerance : float  (>= 0.0)
        How much extra score imbalance the cross-group optimiser may accept
        in exchange for reducing repeat matchups.  Expressed as a fraction
        of the initial total imbalance.  0 = never sacrifice competitiveness;
        0.2 (default) = allow up to 20 % looser balance; higher values
        strongly prefer novelty over even matchups.
    """

    def __init__(
        self,
        players: list[Player],
        courts: list[Court],
        total_points_per_match: int = 32,
        num_rounds: int = 8,
        skill_gap: int | None = None,
        win_bonus: int = 0,
        strength_weight: float = 0.0,
        loss_discount: float = 1.0,
        balance_tolerance: float = 0.2,
        team_mode: bool = False,
    ):
        min_players = 2 if team_mode else 4
        if len(players) < min_players:
            raise ValueError(
                f"Need at least {min_players} {'teams' if team_mode else 'players'} for Mexicano{'team' if team_mode else ''} format"
            )

        try:
            cfg = MexicanoConfig(
                total_points_per_match=total_points_per_match,
                num_rounds=num_rounds,
                skill_gap=skill_gap,
                win_bonus=win_bonus,
                strength_weight=strength_weight,
                loss_discount=loss_discount,
                balance_tolerance=balance_tolerance,
                team_mode=team_mode,
            )
        except ValidationError as exc:
            raise ValueError(str(exc)) from exc

        self.players = list(players)
        self.courts = list(courts)
        self.total_points_per_match = cfg.total_points_per_match
        self.num_rounds = cfg.num_rounds  # 0 = rolling (unlimited)
        self.skill_gap: int | None = cfg.skill_gap
        self.win_bonus: int = cfg.win_bonus
        self.strength_weight: float = cfg.strength_weight
        self.loss_discount: float = cfg.loss_discount
        self.balance_tolerance: float = cfg.balance_tolerance
        self.team_mode: bool = cfg.team_mode

        # In team mode each participant is already a pair, so matches are 1v1 teams.
        # A full match needs 2 participants; in regular mode it needs 4 players.
        self._sit_out_count = len(players) % 2 if self.team_mode else len(players) % 4

        # Cumulative points per player
        self.scores: dict[str, int] = {p.id: 0 for p in players}
        # Matches actually played (excludes sit-outs)
        self._matches_played: dict[str, int] = {p.id: 0 for p in players}
        # Win / Draw / Loss tracking
        self._wins: dict[str, int] = {p.id: 0 for p in players}
        self._draws: dict[str, int] = {p.id: 0 for p in players}
        self._losses: dict[str, int] = {p.id: 0 for p in players}
        self.current_round: int = 0
        self.rounds: list[list[Match]] = []  # rounds[i] = list of matches in round i

        # Sit-out tracking per round: round index → list of Player
        self.sit_outs: list[list[Player]] = []
        # Total sit-out counts per player
        self._sit_out_counts: dict[str, int] = {p.id: 0 for p in players}

        # Track who has played with/against whom to reduce repeats
        self._partner_history: dict[str, dict[str, int]] = {p.id: defaultdict(int) for p in players}
        self._opponent_history: dict[str, dict[str, int]] = {p.id: defaultdict(int) for p in players}

        # Cache for pending pairing proposals (cleared after each round is committed)
        self._pending_proposals: dict[str, dict] = {}

        # Track credited points per match so we can undo on re-record
        # {match_id: {player_id: {raw, strength_mult, loss_disc, win_bonus, final}}}
        self._match_credits: dict[str, dict[str, dict]] = {}

        # Optional play-off bracket (created via start_playoffs)
        self.playoff_bracket: SingleEliminationBracket | DoubleEliminationBracket | None = None
        self._phase: MexPhase = MexPhase.MEXICANO
        self._mexicano_ended: bool = False

        # Forced sit-outs for the next round (set by propose_pairings, cleared after commit)
        self._forced_sit_out_ids: list[str] | None = None

        # Cached lookup — players never change after init
        self._player_map: dict[str, Player] = {p.id: p for p in players}

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    @staticmethod
    def _normalize_credit(detail: dict | int) -> dict:
        """Normalize a credit entry to the full breakdown dict format."""
        if isinstance(detail, dict):
            return detail
        return {
            "raw": detail,
            "strength_mult": 1.0,
            "loss_disc": 1.0,
            "win_bonus": 0,
            "final": detail,
        }

    def _collect_per_person_repeats(
        self,
        t1: list[Player],
        t2: list[Player],
        accumulator: dict[str, dict],
    ) -> None:
        """Populate per-person partner/opponent repeat details for a match.

        Mutates *accumulator* in-place, adding or updating entries keyed
        by player name.
        """
        for team, other_team in [(t1, t2), (t2, t1)]:
            for p in team:
                if p.name not in accumulator:
                    accumulator[p.name] = {
                        "player_id": p.id,
                        "partner_repeats": [],
                        "opponent_repeats": [],
                    }
                detail = accumulator[p.name]
                partner = [x for x in team if x.id != p.id]
                if partner:
                    cnt = self._partner_history[p.id].get(partner[0].id, 0)
                    if cnt > 0:
                        detail["partner_repeats"].append(
                            {
                                "player": partner[0].name,
                                "count": cnt,
                            }
                        )
                for opp in other_team:
                    cnt = self._opponent_history[p.id].get(opp.id, 0)
                    if cnt > 0:
                        detail["opponent_repeats"].append(
                            {
                                "player": opp.name,
                                "count": cnt,
                            }
                        )

    def _find_match_by_id(self, match_id: str) -> Match:
        """Look up a match across all rounds, raising KeyError if not found."""
        for rnd in self.rounds:
            for m in rnd:
                if m.id == match_id:
                    return m
        raise KeyError(f"Match {match_id} not found")

    def _update_wdl(self, team: list[Player], own_score: int, other_score: int, delta: int = 1) -> None:
        """Update win/draw/loss counters for all players in *team*."""
        for p in team:
            if own_score > other_score:
                self._wins[p.id] += delta
            elif own_score < other_score:
                self._losses[p.id] += delta
            else:
                self._draws[p.id] += delta

    # ------------------------------------------------------------------ #
    # Ranking
    # ------------------------------------------------------------------ #

    def leaderboard(self) -> list[dict]:
        """Return sorted leaderboard with total and per-match average points.

        When players have played different numbers of matches (e.g. rolling mode
        with sit-outs), ``avg_points`` becomes the primary sort key so that
        players who sat out aren't unfairly penalised.  Each entry carries a
        ``ranked_by_avg`` boolean so the frontend can highlight the active
        sort column.
        """
        est = self._estimated_scores()
        board = []
        for p in self.players:
            played = self._matches_played[p.id]
            total = self.scores[p.id]
            board.append(
                {
                    "player": p.name,
                    "player_id": p.id,
                    "total_points": total,
                    "estimated_points": round(est[p.id], 2),
                    "matches_played": played,
                    "avg_points": round(total / played, 2) if played > 0 else 0.0,
                    "sat_out": self._sit_out_counts[p.id],
                    "wins": self._wins.get(p.id, 0),
                    "draws": self._draws.get(p.id, 0),
                    "losses": self._losses.get(p.id, 0),
                }
            )

        # Use avg as primary sort when match counts differ; otherwise total
        # (when counts are equal avg ∝ total so the order is identical)
        counts = {e["matches_played"] for e in board}
        ranked_by_avg = len(counts) > 1
        if ranked_by_avg:
            board.sort(key=lambda x: (-x["avg_points"], -x["total_points"]))
        else:
            board.sort(key=lambda x: (-x["total_points"], -x["avg_points"]))

        for i, entry in enumerate(board):
            entry["rank"] = i + 1
            entry["ranked_by_avg"] = ranked_by_avg
        return board

    def player_stats(self) -> dict:
        """
        Return detailed partner/opponent history for each player.

        Used by the frontend to show repeat-match stats.
        """
        stats = {}
        for p in self.players:
            partners = [
                {"player": self._player_by_id(pid).name, "count": cnt}
                for pid, cnt in self._partner_history[p.id].items()
                if cnt > 0
            ]
            opponents = [
                {"player": self._player_by_id(pid).name, "count": cnt}
                for pid, cnt in self._opponent_history[p.id].items()
                if cnt > 0
            ]
            stats[p.name] = {
                "player_id": p.id,
                "partners": sorted(partners, key=lambda x: -x["count"]),
                "opponents": sorted(opponents, key=lambda x: -x["count"]),
                "total_partner_repeats": sum(max(0, c - 1) for c in self._partner_history[p.id].values()),
                "total_opponent_repeats": sum(max(0, c - 1) for c in self._opponent_history[p.id].values()),
            }
        return stats

    def _player_by_id(self, pid: str) -> Player:
        player = self._player_map.get(pid)
        if player is None:
            raise KeyError(pid)
        return player

    def recommend_playoff_teams(self, n_teams: int = 4) -> list[dict]:
        """
        Recommend top N participants from the leaderboard.

        Returns list of dicts with player info, ordered by rank.
        """
        lb = self.leaderboard()
        return lb[:n_teams]

    @staticmethod
    def _pair_playoff_player_ids(player_ids: list[str]) -> list[tuple[str, str]]:
        """Pair seed-ordered player IDs into adjacent teams of two."""
        if len(player_ids) < 2:
            raise RuntimeError("Need at least 2 players to start play-offs")

        if len(player_ids) % 2 == 1:
            player_ids = player_ids[:-1]

        pairs: list[tuple[str, str]] = []
        for idx in range(0, len(player_ids), 2):
            p1 = player_ids[idx]
            p2 = player_ids[idx + 1]
            if p1 == p2:
                raise RuntimeError("Play-off participants must be unique")
            pairs.append((p1, p2))
        return pairs

    @staticmethod
    def _validate_unique_ids(player_ids: list[str]) -> None:
        """Ensure no duplicate player IDs are present in selection."""
        if len(set(player_ids)) != len(player_ids):
            raise RuntimeError("Play-off participants must be unique")

    def _ranked_players(self, pool: list[Player]) -> list[Player]:
        """Players sorted by current score descending."""
        players = list(pool)
        players.sort(key=lambda p: -self.scores[p.id])
        return players

    # ------------------------------------------------------------------ #
    # Sit-out selection
    # ------------------------------------------------------------------ #

    def _choose_sit_outs(self, ranked: list[Player]) -> list[Player]:
        """
        Pick players to sit out this round.

                Strategy:
                    1. Primary criterion  — fewest previous sit-outs (fairness).
                    2. Tie-breaker        — choose the combination whose projected
                         next-round quality is best according to the same objective
                         used for proposal ranking.
        """
        n = self._sit_out_count
        if n == 0:
            return []

        # Sort candidates by sit-out count ascending
        min_sit = min(self._sit_out_counts[p.id] for p in ranked)
        # Eligible = players with the fewest sit-outs
        eligible = [p for p in ranked if self._sit_out_counts[p.id] <= min_sit]

        if len(eligible) <= n:
            # Exactly enough or fewer — they all sit out
            chosen = eligible[:n]
            # If still short (unlikely), add from next tier
            if len(chosen) < n:
                remaining = [p for p in ranked if p not in chosen]
                remaining.sort(key=lambda p: self._sit_out_counts[p.id])
                chosen.extend(remaining[: n - len(chosen)])
            return chosen

        # Multiple candidates — evaluate with proposal-aligned objective.
        best_combo: list[Player] = list(eligible[:n])
        best_score: tuple = (
            float("inf"),
            float("inf"),
            float("inf"),
            float("inf"),
            float("inf"),
        )

        combos = list(itertools.combinations(eligible, n))
        # Cap to prevent combinatorial explosion with many tied players
        if len(combos) > 200:
            random.shuffle(combos)
            combos = combos[:200]

        for combo in combos:
            sitting_ids = {p.id for p in combo}
            playing = [p for p in ranked if p.id not in sitting_ids]
            score = self._projected_round_objective(playing, strategy="balanced")
            if score < best_score:
                best_score = score
                best_combo = list(combo)

        return best_combo

    def _weighted_metrics_score(
        self,
        *,
        strategy: str,
        skill_gap_violations: int,
        exact_prev_round_repeats: int,
        score_imbalance: float,
        repeat_count: int,
    ) -> float:
        """Weighted score used to optimize plans across all metrics."""
        if strategy == "seeded":
            score_weight = 3.0
            repeat_weight = 1.4
            exact_weight = 120.0
        else:
            score_weight = 1.1
            repeat_weight = 3.2
            exact_weight = 150.0

        skill_gap_weight = 10000.0
        return (
            skill_gap_violations * skill_gap_weight
            + exact_prev_round_repeats * exact_weight
            + score_imbalance * score_weight
            + repeat_count * repeat_weight
        )

    def _annotate_weighted_scores(self, proposals: list[dict], strategy: str) -> None:
        """Compute and attach ``weighted_score`` to each proposal in-place."""
        for p in proposals:
            p["weighted_score"] = round(
                self._weighted_metrics_score(
                    strategy=strategy,
                    skill_gap_violations=p.get("skill_gap_violations", 0),
                    exact_prev_round_repeats=p.get("exact_prev_round_repeats", 0),
                    score_imbalance=p["score_imbalance"],
                    repeat_count=p["repeat_count"],
                ),
                4,
            )

    def _projected_round_objective(self, playing: list[Player], *, strategy: str) -> tuple[float, int, int, float, int]:
        """Compute proposal-style objective tuple for a candidate playing set.

        Returns tuple matching weighted ranking semantics:
          (weighted_score, skill_gap_violations,
           exact_prev_round_repeats, score_imbalance, repeat_count)
        """
        groups = self._optimize_groups(self._form_groups(playing))
        est = self._estimated_scores()
        skill_gap_violations, _ = self._skill_gap_violations(groups, est)

        previous = self._previous_round_match_fingerprints()
        exact_prev_round_repeats = 0
        score_imbalance = 0.0
        repeat_count = 0

        for group in groups:
            t1, t2 = self._best_pairing(group)
            score_imbalance += abs(self._team_total(est, t1) - self._team_total(est, t2))
            repeat_count += self._pairing_repeat_count(t1, t2)
            fp = self._match_fingerprint([p.id for p in t1], [p.id for p in t2])
            if fp in previous:
                exact_prev_round_repeats += 1

        weighted_score = self._weighted_metrics_score(
            strategy=strategy,
            skill_gap_violations=skill_gap_violations,
            exact_prev_round_repeats=exact_prev_round_repeats,
            score_imbalance=score_imbalance,
            repeat_count=repeat_count,
        )

        return (
            weighted_score,
            skill_gap_violations,
            exact_prev_round_repeats,
            score_imbalance,
            repeat_count,
        )

    # Shared pairing schemes — delegated to the pairing module.
    _PAIRING_SCHEMES = pairing_mod.PAIRING_SCHEMES_4

    def _snake_draft_groups(self, playing: list[Player]) -> list[list[Player]]:
        """
        Split a ranked player list into groups of 4 using a snake draft.

        For k groups, player at rank-position i is assigned using a snake
        pattern — distributing high-scorers evenly across all groups so
        that no single match concentrates all the strong players.

        Example (8 players, 2 groups)::

            Ranks → groups (snake):  1→G0, 2→G1, 3→G1, 4→G0, 5→G0, 6→G1, 7→G1, 8→G0
            G0 = [rank1, rank4, rank5, rank8],  G1 = [rank2, rank3, rank6, rank7]
        """
        n_groups = len(playing) // 4
        if n_groups <= 1:
            return [list(playing)]
        groups: list[list[Player]] = [[] for _ in range(n_groups)]
        for i, player in enumerate(playing):
            pass_num = i // n_groups
            pos_in_pass = i % n_groups
            group_idx = pos_in_pass if pass_num % 2 == 0 else n_groups - 1 - pos_in_pass
            groups[group_idx].append(player)
        return groups

    def _estimated_scores(self) -> dict[str, float]:
        """Estimate scores normalised to the maximum number of matches played.

        Players who sat out a round have fewer matches.  To make the
        ``skill_gap`` comparison fair we extrapolate their score as if
        they had played as many matches as the most-active player, using
        their per-match average.

        Returns a dict ``{player_id: estimated_score}``.
        """
        max_played = max(self._matches_played.values()) if self._matches_played else 0
        estimated: dict[str, float] = {}
        for pid, raw_score in self.scores.items():
            played = self._matches_played[pid]
            if played > 0 and played < max_played:
                mean_per_match = raw_score / played
                estimated[pid] = raw_score + mean_per_match * (max_played - played)
            else:
                estimated[pid] = float(raw_score)
        return estimated

    def _skill_gap_groups(self, playing: list[Player]) -> list[list[Player]]:
        """
        Form groups of 4 where the absolute estimated-score difference
        between any two players is ≤ ``skill_gap``.

        When some players have played fewer matches (due to sit-outs),
        their scores are extrapolated using their per-match average so
        the comparison is fair.

        Greedy algorithm (players already sorted by score descending):
          1. Anchor on the highest-remaining player.
          2. Collect all remaining players whose estimated score is within
             *skill_gap* of the anchor (absolute difference).
          3. Take the first 4 from that eligible pool (closest in score).
          4. If fewer than 4 are eligible, fall back to the top 4 remaining
             regardless of gap (ensures a full game is always formed).
        """
        assert self.skill_gap is not None
        est = self._estimated_scores()
        remaining = list(playing)  # sorted desc
        groups: list[list[Player]] = []

        while len(remaining) >= 4:
            anchor_est = est[remaining[0].id]
            within_gap = [p for p in remaining if abs(anchor_est - est[p.id]) <= self.skill_gap]
            group = within_gap[:4] if len(within_gap) >= 4 else remaining[:4]
            groups.append(group)
            taken = {p.id for p in group}
            remaining = [p for p in remaining if p.id not in taken]

        return groups

    def _form_team_groups(self, playing: list[Player]) -> list[list[Player]]:
        """
        Form groups of 2 participants for team mode.

        Each "player" object represents a fixed team (pair).  A match needs
        exactly 2 such participants, so groups have size 2.

        * ``skill_gap=None`` → sequential pairing: rank 1 vs rank 2, rank 3 vs rank 4, …
        * ``skill_gap=N``    → anchor-based pairing: each team is paired with the
          closest-ranked team within *skill_gap* estimated points.
        """
        if self.skill_gap is None:
            return [playing[i : i + 2] for i in range(0, len(playing), 2) if i + 1 < len(playing)]

        est = self._estimated_scores()
        remaining = list(playing)
        groups: list[list[Player]] = []
        while len(remaining) >= 2:
            anchor_est = est[remaining[0].id]
            within_gap = [p for p in remaining if abs(anchor_est - est[p.id]) <= self.skill_gap]
            group = within_gap[:2] if len(within_gap) >= 2 else remaining[:2]
            groups.append(group)
            taken = {p.id for p in group}
            remaining = [p for p in remaining if p.id not in taken]
        return groups

    def _form_groups(self, playing: list[Player]) -> list[list[Player]]:
        """
        Dispatch to the appropriate grouping strategy.

        * team_mode=True        → pairs of 2 participants (each is a fixed team)
        * ``skill_gap=None``    → snake-draft (spreads top players across courts)
        * ``skill_gap=N``       → tier grouping (keeps players within N points together)
        """
        if self.team_mode:
            return self._form_team_groups(playing)
        if self.skill_gap is None:
            return self._snake_draft_groups(playing)
        return self._skill_gap_groups(playing)

    def _team_pair_gap_excess(
        self,
        team: list[Player],
        estimated_scores: dict[str, float],
    ) -> float:
        """How much a team pair exceeds configured skill-gap (0 if compliant)."""
        if self.skill_gap is None or len(team) < 2:
            return 0.0
        gap = abs(estimated_scores[team[0].id] - estimated_scores[team[1].id])
        return max(0.0, gap - self.skill_gap)

    @staticmethod
    def _team_total(scores: dict[str, float], team: list[Player]) -> float:
        """Sum score map values for a team."""
        return sum(scores[p.id] for p in team)

    def _best_pairing(self, group: list[Player]) -> tuple[list[Player], list[Player]]:
        """
        Evaluate all 3 possible 2v2 splits for a group of 4 and return the best.

        In team mode, groups have exactly 2 participants (each is a full team),
        so no split evaluation is needed — the pairing is trivially fixed.

        Priority (regular mode):
          1. Minimise partner skill-gap excess (if skill_gap configured).
          2. Minimise score imbalance ``|sum(team1_scores) − sum(team2_scores)|``
             so each match is as competitive as possible.
          3. Minimise partner/opponent repeat count for novelty.
        Ties at both levels are broken randomly.
        """
        if self.team_mode:
            # Each participant IS a team; the match is simply p0 vs p1.
            return [group[0]], [group[1]]
        estimated_scores = self._estimated_scores()
        candidates = []
        for (a, b), (c, d) in self._PAIRING_SCHEMES:
            t1 = [group[a], group[b]]
            t2 = [group[c], group[d]]
            gap_excess = self._team_pair_gap_excess(t1, estimated_scores) + self._team_pair_gap_excess(
                t2, estimated_scores
            )
            imbalance = abs(sum(self.scores[p.id] for p in t1) - sum(self.scores[p.id] for p in t2))
            repeats = self._pairing_repeat_count(t1, t2)
            candidates.append((gap_excess, imbalance, repeats, t1, t2))

        min_excess = min(c[0] for c in candidates)
        filtered = [(imb, rep, t1, t2) for exc, imb, rep, t1, t2 in candidates if exc == min_excess]
        min_imbalance = min(c[0] for c in filtered)
        filtered = [(rep, t1, t2) for imb, rep, t1, t2 in filtered if imb == min_imbalance]
        min_repeats = min(c[0] for c in filtered)
        best = [(t1, t2) for rep, t1, t2 in filtered if rep == min_repeats]
        return random.choice(best)

    def _min_group_imbalance(self, group: list[Player]) -> int:
        """Minimum achievable score imbalance for a single group.

        Handles both group sizes:
          * 2 players (team mode) — only one possible split.
          * 4 players            — minimum over all 3 pairing schemes.
        """
        if len(group) == 2:
            return abs(self.scores[group[0].id] - self.scores[group[1].id])
        return min(
            abs(
                sum(self.scores[p.id] for p in [group[a], group[b]])
                - sum(self.scores[p.id] for p in [group[c], group[d]])
            )
            for (a, b), (c, d) in self._PAIRING_SCHEMES
        )

    def _group_imbalance(self, playing: list[Player]) -> int:
        """
        Total score imbalance across all matches if *playing* were paired now.

        Uses the configured grouping strategy and measures the minimum achievable
        score difference for each group.  Lower = more competitive matches.
        """
        return sum(self._min_group_imbalance(g) for g in self._form_groups(playing))

    def _pairing_diversity_score(self, playing: list[Player]) -> float:
        """
        Estimate how 'novel' the pairings would be for *playing* players.

        Higher = more new match-ups.  Uses snake-draft grouping to mirror
        the actual pairing logic in generate_next_round.
        In team mode there are no partners, only opponents.
        """
        new_interactions = 0
        for group in self._form_groups(playing):
            t1, t2 = self._best_pairing(group)
            if not self.team_mode:
                pairs = [(t1[0], t1[1]), (t2[0], t2[1])]
                for a, b in pairs:
                    if self._partner_history[a.id].get(b.id, 0) == 0:
                        new_interactions += 1
            opponents = list(itertools.product(t1, t2))
            for a, b in opponents:
                if self._opponent_history[a.id].get(b.id, 0) == 0:
                    new_interactions += 1
        return new_interactions

    # ------------------------------------------------------------------ #
    # Cross-group optimisation
    # ------------------------------------------------------------------ #

    def _total_repeat_count(self, groups: list[list[Player]]) -> int:
        """Sum of repeat counts across all groups' best pairings."""
        total = 0
        for group in groups:
            t1, t2 = self._best_pairing(group)
            total += self._pairing_repeat_count(t1, t2)
        return total

    def _total_imbalance(self, groups: list[list[Player]]) -> int:
        """Sum of minimum achievable score imbalance across all groups."""
        return sum(self._min_group_imbalance(g) for g in groups)

    def _skill_gap_violations(
        self,
        groups: list[list[Player]],
        estimated_scores: dict[str, float],
    ) -> tuple[int, float]:
        """Return (violating_group_count, worst_excess_over_gap)."""
        if self.skill_gap is None:
            return 0, 0.0

        violating = 0
        worst_excess = 0.0
        for group in groups:
            if len(group) < 2:
                continue
            values = [estimated_scores[p.id] for p in group]
            spread = max(values) - min(values)
            if spread > self.skill_gap:
                violating += 1
                worst_excess = max(worst_excess, spread - self.skill_gap)
        return violating, worst_excess

    def _optimize_groups(self, groups: list[list[Player]], max_passes: int = 3) -> list[list[Player]]:
        """
        Hill-climb over the initial grouping by swapping players between
        groups to reduce the total repeat count across the whole round.

        For every pair of groups, every pair of players across them is
        tested as a potential swap.  A swap is accepted if it strictly
        reduces the total repeat count **and** does not increase the total
        score imbalance beyond a small tolerance.

        At most *max_passes* full sweeps are performed; typically it
        converges in 1-2 passes.
        """
        if len(groups) < 2:
            return groups

        # Deep copy so we can mutate freely
        groups = [list(g) for g in groups]
        base_imbalance = self._total_imbalance(groups)
        # Allow imbalance to grow by balance_tolerance (+ small constant)
        imbalance_cap = base_imbalance * (1.0 + self.balance_tolerance) + 2

        for _ in range(max_passes):
            improved = False
            cur_repeats = self._total_repeat_count(groups)
            for gi in range(len(groups)):
                for gj in range(gi + 1, len(groups)):
                    for pi in range(len(groups[gi])):
                        for pj in range(len(groups[gj])):
                            # Tentatively swap
                            groups[gi][pi], groups[gj][pj] = (
                                groups[gj][pj],
                                groups[gi][pi],
                            )
                            new_repeats = self._total_repeat_count(groups)
                            new_imbalance = self._total_imbalance(groups)
                            if new_repeats < cur_repeats and new_imbalance <= imbalance_cap:
                                # Accept the swap
                                cur_repeats = new_repeats
                                improved = True
                            else:
                                # Revert
                                groups[gi][pi], groups[gj][pj] = (
                                    groups[gj][pj],
                                    groups[gi][pi],
                                )
            if not improved:
                break
        return groups

    # ------------------------------------------------------------------ #
    # Pairing proposals
    # ------------------------------------------------------------------ #

    def _plan_round(self) -> dict:
        """
        Compute a full round plan **without mutating any state**.

        Returns a dict with all data needed to commit the round later.
        """
        ranked = self._ranked_players(self.players)

        # Use forced sit-outs if set, otherwise auto-select
        if self._forced_sit_out_ids is not None:
            sitting = [self._player_map[pid] for pid in self._forced_sit_out_ids]
        else:
            sitting = self._choose_sit_outs(ranked)  # read-only — does not mutate counters
        sitting_ids = {p.id for p in sitting}
        playing = [p for p in ranked if p.id not in sitting_ids]

        match_plans: list[dict] = []
        per_person_repeats: dict[str, dict] = {}  # player_name -> repeat detail
        groups = self._optimize_groups(self._form_groups(playing))
        est = self._estimated_scores()
        violating_groups, worst_gap_excess = self._skill_gap_violations(groups, est)
        for i, group in enumerate(groups):
            t1, t2 = self._best_pairing(group)
            court = self.courts[i % len(self.courts)] if self.courts else None
            imb = abs(self._team_total(est, t1) - self._team_total(est, t2))
            rep = self._pairing_repeat_count(t1, t2)
            self._collect_per_person_repeats(t1, t2, per_person_repeats)

            match_plans.append(
                {
                    "team1_ids": [p.id for p in t1],
                    "team2_ids": [p.id for p in t2],
                    "team1_names": [p.name for p in t1],
                    "team2_names": [p.name for p in t2],
                    "court_name": court.name if court else None,
                    "score_imbalance": imb,
                    "repeat_count": rep,
                }
            )

        return {
            "sit_out_ids": [p.id for p in sitting],
            "sit_out_names": [p.name for p in sitting],
            "matches": match_plans,
            "score_imbalance": sum(m["score_imbalance"] for m in match_plans),
            "repeat_count": sum(m["repeat_count"] for m in match_plans),
            "per_person_repeats": per_person_repeats,
            "skill_gap_violations": violating_groups,
            "skill_gap_worst_excess": round(worst_gap_excess, 2),
            "exact_prev_round_repeats": self._annotate_exact_previous_round_repeats(match_plans),
            "strategy": "balanced",
        }

    def _seeded_group_pairing(
        self,
        group: list[Player],
        *,
        minimize_repeats: bool,
    ) -> tuple[list[Player], list[Player]]:
        """Pick a pairing for a 4-player seeded group.

        - strict mode: fixed position pairing (1+2 vs 3+4)
        - low-repeat mode: choose scheme minimizing repeats, then imbalance
        """
        estimated_scores = self._estimated_scores()
        candidates: list[tuple[float, int, int, int, list[Player], list[Player]]] = []
        for (a, b), (c, d) in self._PAIRING_SCHEMES:
            t1 = [group[a], group[b]]
            t2 = [group[c], group[d]]
            gap_excess = self._team_pair_gap_excess(t1, estimated_scores) + self._team_pair_gap_excess(
                t2, estimated_scores
            )
            repeats = self._pairing_repeat_count(t1, t2)
            imbalance = abs(self._team_total(estimated_scores, t1) - self._team_total(estimated_scores, t2))
            seed_penalty = 0
            if {a, b} != {0, 1}:
                seed_penalty += 1
            if {c, d} != {2, 3}:
                seed_penalty += 1
            candidates.append((gap_excess, repeats, imbalance, seed_penalty, t1, t2))

        if minimize_repeats:
            candidates.sort(key=lambda x: (x[0], x[1], x[2], x[3]))
        else:
            candidates.sort(key=lambda x: (x[0], x[3], x[1], x[2]))

        best_key = candidates[0][:4]
        best = [(t1, t2) for exc, rep, imb, sp, t1, t2 in candidates if (exc, rep, imb, sp) == best_key]
        return random.choice(best)

    def _plan_round_seeded_position(
        self,
        *,
        minimize_repeats: bool = False,
        swap_variant: int = 0,
    ) -> dict:
        """Plan seeded by leaderboard positions with optional low-repeat pairing."""
        ranked = self._ranked_players(self.players)

        if self._forced_sit_out_ids is not None:
            sitting = [self._player_map[pid] for pid in self._forced_sit_out_ids]
        else:
            sitting = self._choose_sit_outs(ranked)
        sitting_ids = {p.id for p in sitting}
        playing = [p for p in ranked if p.id not in sitting_ids]

        groups = [playing[i : i + 4] for i in range(0, len(playing), 4) if len(playing[i : i + 4]) == 4]
        est = self._estimated_scores()
        per_person_repeats: dict[str, dict] = {}
        match_plans: list[dict] = []
        for i, group in enumerate(groups):
            if swap_variant == 1:
                seeded_group = [group[0], group[2], group[1], group[3]]
            elif swap_variant == 2:
                seeded_group = [group[0], group[3], group[1], group[2]]
            else:
                seeded_group = list(group)

            t1, t2 = self._seeded_group_pairing(seeded_group, minimize_repeats=minimize_repeats)
            court = self.courts[i % len(self.courts)] if self.courts else None
            imb = abs(self._team_total(est, t1) - self._team_total(est, t2))
            rep = self._pairing_repeat_count(t1, t2)
            self._collect_per_person_repeats(t1, t2, per_person_repeats)

            match_plans.append(
                {
                    "team1_ids": [p.id for p in t1],
                    "team2_ids": [p.id for p in t2],
                    "team1_names": [p.name for p in t1],
                    "team2_names": [p.name for p in t2],
                    "court_name": court.name if court else None,
                    "score_imbalance": imb,
                    "repeat_count": rep,
                }
            )

        pair_excesses = []
        for m in match_plans:
            team1 = [self._player_map[pid] for pid in m["team1_ids"]]
            team2 = [self._player_map[pid] for pid in m["team2_ids"]]
            pair_excesses.append(self._team_pair_gap_excess(team1, est))
            pair_excesses.append(self._team_pair_gap_excess(team2, est))
        violating_pairs = sum(1 for x in pair_excesses if x > 0)
        worst_gap_excess = max(pair_excesses, default=0.0)

        variant_name = "base" if swap_variant == 0 else ("swap_a" if swap_variant == 1 else "swap_b")
        return {
            "sit_out_ids": [p.id for p in sitting],
            "sit_out_names": [p.name for p in sitting],
            "matches": match_plans,
            "score_imbalance": sum(m["score_imbalance"] for m in match_plans),
            "repeat_count": sum(m["repeat_count"] for m in match_plans),
            "per_person_repeats": per_person_repeats,
            "skill_gap_violations": violating_pairs,
            "skill_gap_worst_excess": round(worst_gap_excess, 2),
            "exact_prev_round_repeats": self._annotate_exact_previous_round_repeats(match_plans),
            "strategy": "seeded",
            "variant": variant_name,
            "variant_repeats": minimize_repeats,
        }

    def _plan_round_seeded_team(
        self,
        *,
        minimize_repeats: bool = False,
        swap_variant: int = 0,
    ) -> dict:
        """Plan seeded proposals for team mode.

        In team mode every participant is already a full team (1v1 match), so
        there is no inner 2v2 split to optimise.  Instead, variety comes from
        *cross-pairing* within consecutive windows of 4 ranked participants:

        Window [A, B, C, D] (ranks 1-4):
          * variant=0 (base):    A vs B,  C vs D   — sequential
          * variant=1 (cross-a): A vs C,  B vs D   — interleaved
          * variant=2 (cross-b): A vs D,  B vs C   — top-vs-bottom

        When *minimize_repeats* is True, the best cross-pairing scheme is
        chosen per window to minimise opponent repeat count.
        """
        ranked = self._ranked_players(self.players)

        if self._forced_sit_out_ids is not None:
            sitting = [self._player_map[pid] for pid in self._forced_sit_out_ids]
        else:
            sitting = self._choose_sit_outs(ranked)
        sitting_ids = {p.id for p in sitting}
        playing = [p for p in ranked if p.id not in sitting_ids]

        est = self._estimated_scores()
        match_plans: list[dict] = []
        per_person_repeats: dict[str, dict] = {}
        court_idx = 0
        i = 0

        while i < len(playing):
            window = playing[i : i + 4]
            if len(window) < 2:
                break

            if len(window) >= 4 and not minimize_repeats:
                # Apply the chosen swap variant to this 4-window
                if swap_variant == 1:
                    pairs = [(window[0], window[2]), (window[1], window[3])]
                elif swap_variant == 2:
                    pairs = [(window[0], window[3]), (window[1], window[2])]
                else:
                    pairs = [(window[0], window[1]), (window[2], window[3])]
                i += 4
            elif len(window) >= 4 and minimize_repeats:
                # Pick the cross-pairing scheme per window that minimises repeats
                schemes = [
                    [(window[0], window[1]), (window[2], window[3])],
                    [(window[0], window[2]), (window[1], window[3])],
                    [(window[0], window[3]), (window[1], window[2])],
                ]
                best_pairs = min(
                    schemes,
                    key=lambda ps: sum(self._pairing_repeat_count([a], [b]) for a, b in ps),
                )
                pairs = best_pairs
                i += 4
            else:
                # Remaining pair of 2
                pairs = [(window[0], window[1])]
                i += 2

            for t1_p, t2_p in pairs:
                t1, t2 = [t1_p], [t2_p]
                court = self.courts[court_idx % len(self.courts)] if self.courts else None
                court_idx += 1
                imb = abs(self._team_total(est, t1) - self._team_total(est, t2))
                rep = self._pairing_repeat_count(t1, t2)
                self._collect_per_person_repeats(t1, t2, per_person_repeats)
                match_plans.append(
                    {
                        "team1_ids": [t1_p.id],
                        "team2_ids": [t2_p.id],
                        "team1_names": [t1_p.name],
                        "team2_names": [t2_p.name],
                        "court_name": court.name if court else None,
                        "score_imbalance": imb,
                        "repeat_count": rep,
                    }
                )

        variant_name = "base" if swap_variant == 0 else ("swap_a" if swap_variant == 1 else "swap_b")
        return {
            "sit_out_ids": [p.id for p in sitting],
            "sit_out_names": [p.name for p in sitting],
            "matches": match_plans,
            "score_imbalance": sum(m["score_imbalance"] for m in match_plans),
            "repeat_count": sum(m["repeat_count"] for m in match_plans),
            "per_person_repeats": per_person_repeats,
            "skill_gap_violations": 0,
            "skill_gap_worst_excess": 0.0,
            "exact_prev_round_repeats": self._annotate_exact_previous_round_repeats(match_plans),
            "strategy": "seeded",
            "variant": variant_name,
            "variant_repeats": minimize_repeats,
        }

    def _plan_fingerprint(self, plan: dict) -> frozenset:
        """Canonical key used to detect duplicate proposals."""
        return frozenset(frozenset([frozenset(m["team1_ids"]), frozenset(m["team2_ids"])]) for m in plan["matches"])

    @staticmethod
    def _match_fingerprint(team1_ids: list[str], team2_ids: list[str]) -> frozenset[frozenset[str]]:
        """Canonical unordered representation of a 2v2 match."""
        return frozenset([frozenset(team1_ids), frozenset(team2_ids)])

    def _previous_round_match_fingerprints(self) -> set[frozenset[frozenset[str]]]:
        """Fingerprints for matches from the immediately previous round."""
        if not self.rounds:
            return set()

        previous_round = self.rounds[-1]
        fingerprints: set[frozenset[frozenset[str]]] = set()
        for match in previous_round:
            team1_ids = [player.id for player in match.team1]
            team2_ids = [player.id for player in match.team2]
            fingerprints.add(self._match_fingerprint(team1_ids, team2_ids))
        return fingerprints

    def _annotate_exact_previous_round_repeats(self, match_plans: list[dict]) -> int:
        """Annotate each planned match with exact previous-round repeat flag/count."""
        previous = self._previous_round_match_fingerprints()
        exact_count = 0
        for match_plan in match_plans:
            fp = self._match_fingerprint(match_plan["team1_ids"], match_plan["team2_ids"])
            is_exact = fp in previous
            match_plan["exact_prev_round_repeat"] = is_exact
            if is_exact:
                exact_count += 1
        return exact_count

    def propose_pairings(
        self,
        n_options: int = 3,
        forced_sit_out_ids: list[str] | None = None,
    ) -> list[dict]:
        """
        Generate up to *n_options* **distinct** pairing proposals for the next
        round without committing any state.

        Proposals are sorted best-first (lowest score-imbalance, then fewest
        repeats).  The first is marked ``recommended=True``.
        They are cached in ``_pending_proposals``; pass the chosen
        ``option_id`` to ``generate_next_round`` to commit it.

        Parameters
        ----------
        forced_sit_out_ids : list[str] | None
            If provided, these player IDs are forced to sit out instead of
            using the automatic selection.  Must be the exact number of
            players that need to sit out (player_count % 4).
        """
        if self.num_rounds > 0 and self.current_round >= self.num_rounds:
            raise RuntimeError("All rounds have been played")
        if self._mexicano_ended:
            raise RuntimeError("Mexicano phase has ended")
        if self.pending_matches():
            raise RuntimeError("Complete the current round before proposing next pairings")

        # Validate forced sit-outs
        self._forced_sit_out_ids = None
        if forced_sit_out_ids is not None:
            pmap = self._player_map
            for pid in forced_sit_out_ids:
                if pid not in pmap:
                    raise ValueError(f"Unknown player ID: {pid}")
            if len(forced_sit_out_ids) != self._sit_out_count:
                raise ValueError(
                    f"Must specify exactly {self._sit_out_count} sit-out player(s), got {len(forced_sit_out_ids)}"
                )
            self._forced_sit_out_ids = forced_sit_out_ids

        balanced: list[dict] = []
        seeded: list[dict] = []
        seen: set = set()
        target_total = max(6, n_options)
        target_per_strategy = max(3, (target_total + 1) // 2)
        target_balanced = max(target_per_strategy, n_options)

        # _best_pairing breaks ties with random.choice, producing different splits across calls
        for _ in range(target_balanced * 4):
            if len(balanced) >= target_balanced:
                break
            plan = self._plan_round()
            fp = self._plan_fingerprint(plan)
            if fp not in seen:
                seen.add(fp)
                plan["option_id"] = f"prop-{random.randbytes(8).hex()}"
                balanced.append(plan)

        # Seeded proposals: for regular mode use position-based seeding;
        # for team mode use cross-pairing variants (analogous logic, groups of 2).
        seeded_candidates = [
            (False, 0),
            (True, 1),
            (True, 2),
            (True, 0),
            (False, 1),
            (False, 2),
        ]
        seeded_attempts = 0
        while len(seeded) < target_per_strategy and seeded_attempts < 24:
            seeded_attempts += 1
            for minimize_repeats, swap_variant in seeded_candidates:
                if len(seeded) >= target_per_strategy:
                    break
                if self.team_mode:
                    plan = self._plan_round_seeded_team(
                        minimize_repeats=minimize_repeats,
                        swap_variant=swap_variant,
                    )
                else:
                    plan = self._plan_round_seeded_position(
                        minimize_repeats=minimize_repeats,
                        swap_variant=swap_variant,
                    )
                fp = self._plan_fingerprint(plan)
                if fp in seen:
                    continue
                seen.add(fp)
                plan["option_id"] = f"prop-{random.randbytes(8).hex()}"
                seeded.append(plan)

        # If any option violates skill-gap, surface more balanced alternatives.
        # _plan_round() uses random tie-breaking so repeated calls can yield distinct plans.
        if any(p.get("skill_gap_violations", 0) > 0 for p in (balanced + seeded)):
            target_balanced = max(target_balanced, 5)
            for _ in range(15):
                if len(balanced) >= target_balanced:
                    break
                plan = self._plan_round()
                fp = self._plan_fingerprint(plan)
                if fp not in seen:
                    seen.add(fp)
                    plan["option_id"] = f"prop-{random.randbytes(8).hex()}"
                    balanced.append(plan)

        # Keep output compact by default, while allowing larger requested sets.
        self._annotate_weighted_scores(balanced, "balanced")
        self._annotate_weighted_scores(seeded, "seeded")

        balanced.sort(key=lambda p: (p["weighted_score"], p["score_imbalance"], p["repeat_count"]))
        seeded.sort(key=lambda p: (p["weighted_score"], p["score_imbalance"], p["repeat_count"]))

        balanced = balanced[:target_per_strategy]
        seeded = seeded[:target_per_strategy]

        proposals: list[dict] = []
        if target_total > 6:
            bi = 0
            si = 0
            while len(proposals) < target_total and (bi < len(balanced) or si < len(seeded)):
                if bi < len(balanced):
                    proposals.append(balanced[bi])
                    bi += 1
                    if len(proposals) >= target_total:
                        break
                if si < len(seeded):
                    proposals.append(seeded[si])
                    si += 1
        else:
            proposals = balanced + seeded

        # Fallback fill preserving strategy inclusion for expanded requests.
        if len(proposals) < target_total:
            used_ids = {p["option_id"] for p in proposals}
            for candidate in balanced + seeded:
                if len(proposals) >= target_total:
                    break
                if candidate["option_id"] in used_ids:
                    continue
                proposals.append(candidate)
                used_ids.add(candidate["option_id"])

        proposals = proposals[:target_total]

        for p in proposals:
            p["recommended"] = False

        for i, p in enumerate(balanced):
            p["label"] = f"Balanced {i + 1}"

        for i, p in enumerate(seeded):
            p["label"] = f"Seeded {i + 1}"

        if proposals:
            best = min(
                proposals,
                key=lambda p: p.get("weighted_score", float("inf")),
            )
            best["recommended"] = True

        # Cache for later commit
        self._pending_proposals = {p["option_id"]: p for p in proposals}
        self._forced_sit_out_ids = None
        return proposals

    # ------------------------------------------------------------------ #
    # Pairing
    # ------------------------------------------------------------------ #

    def generate_next_round(self, option_id: str | None = None) -> list[Match]:
        """
        Generate pairings for the next round based on current standings.

        If *option_id* is given and matches a cached proposal from
        ``propose_pairings()``, that exact plan is committed.  Otherwise
        a fresh plan is computed.

        Pairing logic (fresh) — regular mode:
          1. Choose sit-outs fairly if player count is not divisible by 4.
          2. Rank remaining players by accumulated points.
          3. Form groups of 4 via the configured grouping strategy.
          4. Optimise groups by swapping players across groups to minimise
             repeat partner/opponent pairings across the whole round.
          5. Within each group pick the 2v2 split that minimises score imbalance.

        Pairing logic (fresh) — team mode:
          1. Choose sit-outs fairly if participant count is not divisible by 2.
          2. Rank remaining participants by accumulated points.
          3. Form groups of 2 (each participant is already a full team).
          4. Optimise groups by swapping participants across groups to minimise
             repeat opponent pairings across the whole round.
          5. Each group becomes a direct 1v1 match (no inner split needed).
        """
        if self.num_rounds > 0 and self.current_round >= self.num_rounds:
            raise RuntimeError("All rounds have been played")
        if self._mexicano_ended:
            raise RuntimeError("Mexicano phase has ended")

        pmap = self._player_map

        # ── Use cached proposal if available ──
        if option_id and option_id in self._pending_proposals:
            plan = self._pending_proposals[option_id]
            self._pending_proposals.clear()

            # Record sit-outs
            sit_out_players = [pmap[pid] for pid in plan["sit_out_ids"]]
            for p in sit_out_players:
                self._sit_out_counts[p.id] += 1
            self.sit_outs.append(sit_out_players)

            matches: list[Match] = []
            for i, mp in enumerate(plan["matches"]):
                court = self.courts[i % len(self.courts)] if self.courts else None
                m = Match(
                    team1=[pmap[pid] for pid in mp["team1_ids"]],
                    team2=[pmap[pid] for pid in mp["team2_ids"]],
                    court=court,
                    round_number=self.current_round + 1,
                    round_label=f"Round {self.current_round + 1}",
                )
                matches.append(m)

            self.rounds.append(matches)
            self.current_round += 1
            return matches

        # ── Fresh plan ──
        self._pending_proposals.clear()
        ranked = self._ranked_players(self.players)

        # Determine sit-outs
        sitting = self._choose_sit_outs(ranked)
        sitting_ids = {p.id for p in sitting}
        for p in sitting:
            self._sit_out_counts[p.id] += 1
        self.sit_outs.append(sitting)

        # Playing pool (preserve ranking order)
        playing = [p for p in ranked if p.id not in sitting_ids]

        matches = []

        # Snake-draft grouping ensures high-scorers are spread across courts.
        # _optimize_groups then swaps players across groups to minimise repeats.
        # Finally _best_pairing picks the most score-balanced 2v2 split.
        groups = self._optimize_groups(self._form_groups(playing))
        for i, group in enumerate(groups):
            team1, team2 = self._best_pairing(group)
            court = self.courts[i % len(self.courts)] if self.courts else None
            m = Match(
                team1=team1,
                team2=team2,
                court=court,
                round_number=self.current_round + 1,
                round_label=f"Round {self.current_round + 1}",
            )
            matches.append(m)

        self.rounds.append(matches)
        self.current_round += 1
        return matches

    def generate_custom_round(
        self,
        match_specs: list[dict],
        sit_out_ids: list[str] | None = None,
    ) -> list[Match]:
        """
        Commit a manually-specified round.

        Parameters
        ----------
        match_specs : list of dicts
            Each dict must contain ``team1_ids`` and ``team2_ids``
            (lists of 2 player IDs each).
        sit_out_ids : list of player IDs (optional)
            Players sitting out this round.  If omitted, any player not
            included in *match_specs* is assumed to be sitting out.

        The method validates that:
          - Every ID refers to a known player.
          - No player appears in more than one match or both teams.
          - Each team has exactly 2 players.
        """
        if self.num_rounds > 0 and self.current_round >= self.num_rounds:
            raise RuntimeError("All rounds have been played")
        if self._mexicano_ended:
            raise RuntimeError("Mexicano phase has ended")

        pmap = self._player_map
        all_player_ids = set(pmap.keys())
        used_ids: set[str] = set()

        matches: list[Match] = []
        for i, spec in enumerate(match_specs):
            t1_ids = spec.get("team1_ids", [])
            t2_ids = spec.get("team2_ids", [])
            if len(t1_ids) != 2 or len(t2_ids) != 2:
                raise ValueError(f"Match {i + 1}: each team must have exactly 2 players")
            for pid in t1_ids + t2_ids:
                if pid not in pmap:
                    raise ValueError(f"Unknown player ID: {pid}")
                if pid in used_ids:
                    raise ValueError(f"Player {pmap[pid].name} appears in multiple matches")
                used_ids.add(pid)

            court = self.courts[i % len(self.courts)] if self.courts else None
            m = Match(
                team1=[pmap[pid] for pid in t1_ids],
                team2=[pmap[pid] for pid in t2_ids],
                court=court,
                round_number=self.current_round + 1,
                round_label=f"Round {self.current_round + 1}",
            )
            matches.append(m)

        # Determine sit-outs
        if sit_out_ids is not None:
            for pid in sit_out_ids:
                if pid not in pmap:
                    raise ValueError(f"Unknown sit-out player ID: {pid}")
            sitting = [pmap[pid] for pid in sit_out_ids]
        else:
            sitting = [pmap[pid] for pid in (all_player_ids - used_ids)]

        for p in sitting:
            self._sit_out_counts[p.id] += 1
        self.sit_outs.append(sitting)

        self._pending_proposals.clear()
        self.rounds.append(matches)
        self.current_round += 1
        return matches

    def _pairing_repeat_count(self, team1: list[Player], team2: list[Player]) -> int:
        """Total repeat penalty for a match, with a bonus for full-match repeats.

        Delegates to the shared pairing module.
        """
        return pairing_mod.pairing_repeat_count(team1, team2, self._partner_history, self._opponent_history)

    # ------------------------------------------------------------------ #
    # Record results
    # ------------------------------------------------------------------ #

    def record_result(self, match_id: str, score: tuple[int, int]):
        """
        Record (or re-record) a match result.

        Both scores should sum to total_points_per_match.  If the match
        was already completed, the previous credits are reversed first
        so that re-recording is safe.
        """
        m = self._find_match_by_id(match_id)
        s1, s2 = score
        if s1 + s2 != self.total_points_per_match:
            raise ValueError(f"Scores must sum to {self.total_points_per_match}, got {s1} + {s2} = {s1 + s2}")

        # ── Undo previous result if re-recording ──
        was_completed = m.status == MatchStatus.COMPLETED
        if was_completed:
            prev_credits = self._match_credits.get(m.id, {})
            for pid, detail in prev_credits.items():
                credited = self._normalize_credit(detail)["final"]
                self.scores[pid] -= credited
            prev_s1, prev_s2 = m.score
            self._update_wdl(m.team1, prev_s1, prev_s2, delta=-1)
            self._update_wdl(m.team2, prev_s2, prev_s1, delta=-1)

        m.score = score
        m.status = MatchStatus.COMPLETED

        # Compute strength multipliers BEFORE updating scores
        if self.strength_weight > 0.0:
            mult1 = 1.0 + self.strength_weight * self._opponent_strength(m.team2)
            mult2 = 1.0 + self.strength_weight * self._opponent_strength(m.team1)
        else:
            mult1 = mult2 = 1.0

        # Win bonus and loss discount (draws unaffected)
        bonus1 = self.win_bonus if s1 > s2 else 0
        bonus2 = self.win_bonus if s2 > s1 else 0
        disc1 = self.loss_discount if s1 < s2 else 1.0
        disc2 = self.loss_discount if s2 < s1 else 1.0

        credits: dict[str, dict] = {}
        self._credit_team(m.team1, s1, mult1, disc1, bonus1, was_completed, credits)
        self._credit_team(m.team2, s2, mult2, disc2, bonus2, was_completed, credits)
        self._match_credits[m.id] = credits

        self._update_wdl(m.team1, s1, s2)
        self._update_wdl(m.team2, s2, s1)

        if not was_completed:
            self._update_history(m.team1, m.team2)

    def _credit_team(
        self,
        team: list[Player],
        raw_score: int,
        strength_mult: float,
        loss_disc: float,
        win_bonus: int,
        was_completed: bool,
        credits: dict[str, dict],
    ) -> None:
        """Apply score credits to a team and record breakdown."""
        for p in team:
            c = round(raw_score * strength_mult * loss_disc) + win_bonus
            self.scores[p.id] += c
            credits[p.id] = {
                "raw": raw_score,
                "strength_mult": round(strength_mult, 4),
                "loss_disc": round(loss_disc, 4),
                "win_bonus": win_bonus,
                "final": c,
            }
            if not was_completed:
                self._matches_played[p.id] += 1

    def _opponent_strength(self, opponent_team: list[Player]) -> float:
        """
        Normalised strength of *opponent_team* based on absolute estimated points.

        Uses ``_estimated_scores()`` so players with fewer matches (sit-outs)
        are fairly compared.  The result is 0.0 when all players have 0 points
        (e.g. round 1), rising linearly so that facing the highest-scoring
        opponent gives close to 1.0.

        Returns a value in [0.0, 1.0]:
          * 0.0 → opponents have 0 estimated points
          * 1.0 → opponents have the maximum estimated score across all players
        """
        est = self._estimated_scores()
        max_est = max(est.values()) if est else 0.0
        if max_est <= 0:
            return 0.0
        avg_est = sum(est[p.id] for p in opponent_team) / len(opponent_team)
        return avg_est / max_est

    def get_match_breakdown(self, match_id: str) -> dict | None:
        """Return detailed score breakdown for a completed match, or None."""
        credits = self._match_credits.get(match_id)
        if not credits:
            return None
        return {pid: self._normalize_credit(detail) for pid, detail in credits.items()}

    def all_match_breakdowns(self) -> dict[str, dict]:
        """Return breakdowns for all recorded matches."""
        return {
            mid: {pid: self._normalize_credit(detail) for pid, detail in credits.items()}
            for mid, credits in self._match_credits.items()
        }

    def _update_history(self, team1: list[Player], team2: list[Player]):
        """Record a played match in partner/opponent history. Delegates to shared module."""
        pairing_mod.update_history(team1, team2, self._partner_history, self._opponent_history)

    # ------------------------------------------------------------------ #
    # Queries
    # ------------------------------------------------------------------ #

    def current_round_matches(self) -> list[Match]:
        if not self.rounds:
            return []
        return self.rounds[-1]

    def pending_matches(self) -> list[Match]:
        if not self.rounds:
            return []
        return [m for m in self.rounds[-1] if m.status != MatchStatus.COMPLETED]

    def all_matches(self) -> list[Match]:
        return [m for rnd in self.rounds for m in rnd]

    @property
    def is_finished(self) -> bool:
        if self._phase == MexPhase.PLAYOFFS:
            return self.playoff_bracket is not None and self.playoff_bracket.champion() is not None
        if self._phase == MexPhase.FINISHED:
            return True
        if self.num_rounds == 0:  # rolling mode — never "done" by round count
            return False
        return self.current_round >= self.num_rounds and not self.pending_matches()

    @property
    def phase(self) -> MexPhase:
        return self._phase

    @property
    def mexicano_ended(self) -> bool:
        return self._mexicano_ended

    def end_mexicano(self) -> None:
        """Close Mexicano rounds and move to decision point before play-offs."""
        if self.pending_matches():
            raise RuntimeError("Complete the current round before ending Mexicano")
        if self._phase == MexPhase.PLAYOFFS:
            raise RuntimeError("Play-offs already started")
        self._mexicano_ended = True

    def finish_without_playoffs(self) -> None:
        """Finish tournament directly without creating a play-off phase."""
        self.end_mexicano()
        self._phase = MexPhase.FINISHED

    # ------------------------------------------------------------------ #
    # Play-off support
    # ------------------------------------------------------------------ #

    def start_playoffs(
        self,
        team_player_ids: list[str] | None = None,
        n_teams: int = 4,
        double_elimination: bool = False,
        extra_participants: list[dict] | None = None,
    ):
        """
        Start a play-off bracket after the Mexicano rounds are complete.

        Parameters
        ----------
        team_player_ids : list[str] | None
            Player/participant IDs to include (seed order).
            *Regular mode*: IDs are paired as (1+2), (3+4), … to form 2-player
            play-off teams.  An odd count drops the last ID.
            *Team mode*: each ID is already a full team — they enter the bracket
            as singleton teams, seeded by their estimated score.
            If ``None``, the top *n_teams* participants from the leaderboard are
            selected automatically.
            May contain placeholder IDs (e.g. ``ext_0``) that map to entries in
            *extra_participants* via ``placeholder_id``.
        n_teams : int
            Number of participants/teams when *team_player_ids* is not given.
        double_elimination : bool
            Use double-elimination bracket instead of single.
        extra_participants : list[dict] | None
            Dicts with ``name``, optional ``score`` (int, default 0) and
            optional ``placeholder_id`` for external participants who did not
            play in the Mexicano rounds.  When a ``placeholder_id`` is present
            the external replaces that placeholder inside *team_player_ids*;
            otherwise it is appended as a singleton team.
        """
        if self.pending_matches():
            raise RuntimeError("Complete the current round before starting play-offs")
        if not self._mexicano_ended:
            raise RuntimeError("End Mexicano first before starting play-offs")
        if self.playoff_bracket is not None:
            raise RuntimeError("Play-offs already started")

        # Import here to avoid circular import
        from .playoff import DoubleEliminationBracket, SingleEliminationBracket

        # Create Player objects for external participants and register them.
        # Build a map from placeholder_id → real player ID so we can swap them
        # in team_player_ids later.
        ext_id_map: dict[str, str] = {}
        extra_singleton_players: list[Player] = []
        if extra_participants:
            for entry in extra_participants:
                p = Player(name=entry["name"])
                self._player_map[p.id] = p
                # Initialise tracking so leaderboard/stats don't KeyError
                self.scores[p.id] = entry.get("score", 0)
                self._matches_played[p.id] = 0
                self._wins[p.id] = 0
                self._draws[p.id] = 0
                self._losses[p.id] = 0
                self._sit_out_counts[p.id] = 0
                self._partner_history[p.id] = defaultdict(int)
                self._opponent_history[p.id] = defaultdict(int)
                placeholder = entry.get("placeholder_id")
                if placeholder:
                    ext_id_map[placeholder] = p.id
                else:
                    extra_singleton_players.append(p)

        # Replace placeholder IDs with real player IDs
        if team_player_ids and ext_id_map:
            team_player_ids = [ext_id_map.get(pid, pid) for pid in team_player_ids]

        # Resolve participants
        if team_player_ids is None:
            lb = self.leaderboard()
            team_player_ids = [e["player_id"] for e in lb[:n_teams]]

        self._validate_unique_ids(team_player_ids)
        est = self._estimated_scores()

        # Inject seed scores for ALL external participants so sorting works
        if extra_participants:
            for entry in extra_participants:
                placeholder = entry.get("placeholder_id")
                real_id = ext_id_map.get(placeholder, "") if placeholder else ""
                if real_id:
                    est[real_id] = float(entry.get("score", 0))
            # Also inject scores for singletons so they can be sorted
            for ep in extra_singleton_players:
                est[ep.id] = float(self.scores[ep.id])

        if self.team_mode:
            # Each participant IS already a full team — wrap as singleton list,
            # sorted by estimated score (best seed first).
            sorted_ids = sorted(team_player_ids, key=lambda pid: est.get(pid, 0.0), reverse=True)
            teams = [[self._player_by_id(pid)] for pid in sorted_ids]
        else:
            # Regular mode: pair consecutive IDs into 2-player teams.
            pairs = self._pair_playoff_player_ids(team_player_ids)
            # Seed teams by combined estimated score so sit-out players aren't
            # unfairly penalised — mirrors the leaderboard ranked_by_avg logic.
            pairs.sort(
                key=lambda pair: est.get(pair[0], 0.0) + est.get(pair[1], 0.0),
                reverse=True,
            )
            teams = [[self._player_by_id(pid1), self._player_by_id(pid2)] for pid1, pid2 in pairs]

        # Append external singleton participants (no placeholder), sorted by
        # score descending so higher-seeded externals appear first.
        extra_singleton_players.sort(
            key=lambda p: est.get(p.id, 0.0),
            reverse=True,
        )
        for ep in extra_singleton_players:
            teams.append([ep])

        if len(teams) < 2:
            raise RuntimeError("Need at least 2 teams to start play-offs")

        if double_elimination:
            self.playoff_bracket = DoubleEliminationBracket(teams, courts=self.courts)
        else:
            self.playoff_bracket = SingleEliminationBracket(teams)

        self._phase = MexPhase.PLAYOFFS

    def playoff_matches(self) -> list[Match]:
        """All play-off matches."""
        if self.playoff_bracket is None:
            return []
        if hasattr(self.playoff_bracket, "all_matches"):
            return self.playoff_bracket.all_matches
        return self.playoff_bracket.matches

    def _assign_courts_to_pending_playoff_matches(self, pending: list[Match]) -> None:
        """Assign courts to pending play-off matches when missing."""
        if not self.courts:
            return
        for idx, match in enumerate(pending):
            if match.court is None:
                match.court = self.courts[idx % len(self.courts)]

    def pending_playoff_matches(self) -> list[Match]:
        """Play-off matches that can be played now."""
        if self.playoff_bracket is None:
            return []
        pending = self.playoff_bracket.pending_matches()
        self._assign_courts_to_pending_playoff_matches(pending)
        return pending

    def record_playoff_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
    ):
        """Record a play-off match result."""
        if self.playoff_bracket is None:
            raise RuntimeError("Play-offs not started")
        self.playoff_bracket.record_result(match_id, score, sets=sets)
        if self.playoff_bracket.champion() is not None:
            self._phase = MexPhase.FINISHED

    def champion(self) -> list[Player] | None:
        """Return the champion, or None if not yet decided.

        When the tournament finishes without play-offs, the leaderboard
        leader is the champion.  Otherwise the play-off bracket decides.
        """
        if self.playoff_bracket is not None:
            return self.playoff_bracket.champion()
        if self._phase == MexPhase.FINISHED:
            lb = self.leaderboard()
            if lb:
                return [self._player_map[lb[0]["player_id"]]]
        return None
