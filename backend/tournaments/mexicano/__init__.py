"""
Mexicano tournament format.

Rules:
  - Fixed total points per match (e.g. 32 points — first to 16, or timed).
  - After each round, players are re-paired by current rating/ranking.
  - Group formation is controlled by the ``skill_gap`` parameter:
      * ``None`` (default) — snake-draft: high-scorers are spread across
        courts so no single match monopolises the strongest players.
      * Integer (points) — tier grouping: players are only placed in the
        same group if their score difference is ≤ skill_gap.
  - Within each group the 2v2 split is chosen to minimise the score difference
    between the two teams (most competitive match), with partner/opponent repeat
    counts used as a secondary tie-breaker to encourage novelty.
  - Each player accumulates the points they scored; overall ranking = total points.
  - If the player count is NOT divisible by 4, some players sit out each round.
    Sit-out selection is fair (fewest sit-outs first) and tie-broken by choosing
    the player(s) whose absence minimises match imbalance, then maximises novelty.
"""

from __future__ import annotations

import random
from collections import defaultdict
from typing import TYPE_CHECKING

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from ...models import Court, Match, MatchStatus, MexPhase, Player
from .grouping import GroupingMixin
from .scoring import ScoringMixin
from .sit_outs import SitOutMixin

if TYPE_CHECKING:
    from ..playoff import DoubleEliminationBracket, SingleEliminationBracket


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


class MexicanoTournament(GroupingMixin, ScoringMixin, SitOutMixin):
    """
    Manages a Mexicano-style tournament.

    Parameters
    ----------
    players : list[Player]
        Any number >= 4.  If not divisible by 4 some will sit out each round.
    courts : list[Court]
        Available courts.
    total_points_per_match : int
        Fixed total of points in every match (e.g. 25).
    num_rounds : int
        How many rounds to play.  ``0`` means rolling mode (unlimited).
    skill_gap : int | None
        Maximum allowed point difference between players in the same group.
    win_bonus : int
        Flat extra leaderboard points for the winning team per match.
    strength_weight : float  (0.0 – 1.0)
        Controls how much opponent strength boosts earned points.
    loss_discount : float  (0.0 – 1.0)
        Multiplier applied to the losing team's raw score.
    balance_tolerance : float  (>= 0.0)
        How much extra imbalance the optimiser may accept for novelty.
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
        initial_strength: dict[str, float] | None = None,
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
        self.num_rounds = cfg.num_rounds
        self.skill_gap: int | None = cfg.skill_gap
        self.win_bonus: int = cfg.win_bonus
        self.strength_weight: float = cfg.strength_weight
        self.loss_discount: float = cfg.loss_discount
        self.balance_tolerance: float = cfg.balance_tolerance
        self.team_mode: bool = cfg.team_mode

        self.scores: dict[str, int] = {p.id: 0 for p in players}
        self._matches_played: dict[str, int] = {p.id: 0 for p in players}
        self._wins: dict[str, int] = {p.id: 0 for p in players}
        self._draws: dict[str, int] = {p.id: 0 for p in players}
        self._losses: dict[str, int] = {p.id: 0 for p in players}
        self.current_round: int = 0
        self.rounds: list[list[Match]] = []

        self.sit_outs: list[list[Player]] = []
        self._sit_out_counts: dict[str, int] = {p.id: 0 for p in players}

        self._partner_history: dict[str, dict[str, int]] = {p.id: defaultdict(int) for p in players}
        self._opponent_history: dict[str, dict[str, int]] = {p.id: defaultdict(int) for p in players}

        self._pending_proposals: dict[str, dict] = {}
        self._match_credits: dict[str, dict[str, dict]] = {}
        self._est_cache: dict[str, float] | None = None

        self.playoff_bracket: SingleEliminationBracket | DoubleEliminationBracket | None = None
        self._phase: MexPhase = MexPhase.MEXICANO
        self._mexicano_ended: bool = False
        self._forced_sit_out_ids: list[str] | None = None
        self._player_map: dict[str, Player] = {p.id: p for p in players}
        self.initial_strength: dict[str, float] | None = initial_strength
        self._removed_players: list[Player] = []

    def __getattr__(self, name: str) -> object:
        """Provide defaults for attributes missing from older pickled instances."""
        defaults: dict[str, object] = {
            "_est_cache": None,
            "_match_credits": {},
            "_forced_sit_out_ids": None,
            "initial_strength": None,
            "_removed_players": [],
        }
        if name in defaults:
            value = defaults[name]
            object.__setattr__(self, name, value)
            return value
        raise AttributeError(f"'{type(self).__name__}' object has no attribute '{name}'")

    # ------------------------------------------------------------------ #
    # Round planning
    # Sit-out count
    # ------------------------------------------------------------------ #

    @property
    def _sit_out_count(self) -> int:
        """Number of players who must sit out each round.

        Determined by whichever constraint is tighter: the player count not
        being divisible by the group size, or the number of available courts
        being fewer than the maximum possible simultaneous matches.
        """
        unit = 2 if self.team_mode else 4
        max_by_players = len(self.players) // unit
        n_matches = min(len(self.courts), max_by_players) if self.courts else max_by_players
        return len(self.players) - n_matches * unit

    # ------------------------------------------------------------------ #
    # ------------------------------------------------------------------ #

    def _plan_round(self) -> dict:
        """Compute a full round plan without mutating any state."""
        ranked = self._ranked_players(self.players)

        if self._forced_sit_out_ids is not None:
            sitting = [self._player_map[pid] for pid in self._forced_sit_out_ids]
        else:
            sitting = self._choose_sit_outs(ranked)
        sitting_ids = {p.id for p in sitting}
        playing = [p for p in ranked if p.id not in sitting_ids]

        match_plans: list[dict] = []
        per_person_repeats: dict[str, dict] = {}
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
        """Plan seeded proposals for team mode."""
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
                if swap_variant == 1:
                    pairs = [(window[0], window[2]), (window[1], window[3])]
                elif swap_variant == 2:
                    pairs = [(window[0], window[3]), (window[1], window[2])]
                else:
                    pairs = [(window[0], window[1]), (window[2], window[3])]
                i += 4
            elif len(window) >= 4 and minimize_repeats:
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

    # ------------------------------------------------------------------ #
    # Fingerprinting (duplicate detection)
    # ------------------------------------------------------------------ #

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

    # ------------------------------------------------------------------ #
    # Pairing proposals
    # ------------------------------------------------------------------ #

    def propose_pairings(
        self,
        n_options: int = 3,
        forced_sit_out_ids: list[str] | None = None,
    ) -> list[dict]:
        """Generate up to *n_options* distinct pairing proposals for the next
        round without committing any state.

        Proposals are sorted best-first (lowest score-imbalance, then fewest
        repeats).  The first is marked ``recommended=True``.
        They are cached in ``_pending_proposals``; pass the chosen
        ``option_id`` to ``generate_next_round`` to commit it.
        """
        if self.num_rounds > 0 and self.current_round >= self.num_rounds:
            raise RuntimeError("All rounds have been played")
        if self._mexicano_ended:
            raise RuntimeError("Mexicano phase has ended")
        if self.pending_matches():
            raise RuntimeError("Complete the current round before proposing next pairings")

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

        if self._forced_sit_out_ids is None and self._sit_out_count > 0:
            _ranked_all = self._ranked_players(self.players)
            n_sit_variants = max(2, min(n_options, 8))
            _sit_variants: list[list[str] | None] = [
                [p.id for p in combo] for combo in self._rank_sit_out_combos(_ranked_all, max_combos=n_sit_variants)
            ]
        else:
            _sit_variants = [self._forced_sit_out_ids]

        for attempt in range(target_balanced * 4):
            if len(balanced) >= target_balanced:
                break
            self._forced_sit_out_ids = _sit_variants[attempt % len(_sit_variants)]
            plan = self._plan_round()
            fp = self._plan_fingerprint(plan)
            if fp not in seen:
                seen.add(fp)
                plan["option_id"] = f"prop-{random.randbytes(8).hex()}"
                balanced.append(plan)

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
            for sit_variant_idx, (minimize_repeats, swap_variant) in enumerate(seeded_candidates * 2):
                if len(seeded) >= target_per_strategy:
                    break
                self._forced_sit_out_ids = _sit_variants[sit_variant_idx % len(_sit_variants)]
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

        if any(p.get("skill_gap_violations", 0) > 0 for p in (balanced + seeded)):
            target_balanced = max(target_balanced, 5)
            for attempt in range(15):
                if len(balanced) >= target_balanced:
                    break
                self._forced_sit_out_ids = _sit_variants[attempt % len(_sit_variants)]
                plan = self._plan_round()
                fp = self._plan_fingerprint(plan)
                if fp not in seen:
                    seen.add(fp)
                    plan["option_id"] = f"prop-{random.randbytes(8).hex()}"
                    balanced.append(plan)

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

        self._pending_proposals = {p["option_id"]: p for p in proposals}
        self._forced_sit_out_ids = None
        return proposals

    # ------------------------------------------------------------------ #
    # Round generation
    # ------------------------------------------------------------------ #

    def generate_next_round(self, option_id: str | None = None) -> list[Match]:
        """Generate pairings for the next round based on current standings.

        If *option_id* matches a cached proposal, that plan is committed.
        Otherwise a fresh plan is computed.
        """
        if self.num_rounds > 0 and self.current_round >= self.num_rounds:
            raise RuntimeError("All rounds have been played")
        if self._mexicano_ended:
            raise RuntimeError("Mexicano phase has ended")

        pmap = self._player_map

        if option_id and option_id in self._pending_proposals:
            plan = self._pending_proposals[option_id]
            self._pending_proposals.clear()

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

        self._pending_proposals.clear()
        ranked = self._ranked_players(self.players)

        sitting = self._choose_sit_outs(ranked)
        sitting_ids = {p.id for p in sitting}
        for p in sitting:
            self._sit_out_counts[p.id] += 1
        self.sit_outs.append(sitting)

        playing = [p for p in ranked if p.id not in sitting_ids]

        matches = []
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
        """Commit a manually-specified round.

        Parameters
        ----------
        match_specs : list of dicts
            Each dict must contain ``team1_ids`` and ``team2_ids``.
        sit_out_ids : list of player IDs (optional)
            Players sitting out this round.
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
        if self.num_rounds == 0:
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

    def update_courts(self, courts: list[Court]) -> None:
        """Replace the court list used for future round generation."""
        self.courts = list(courts)

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
        """Start a play-off bracket after the Mexicano rounds are complete."""
        if self.pending_matches():
            raise RuntimeError("Complete the current round before starting play-offs")
        if not self._mexicano_ended:
            raise RuntimeError("End Mexicano first before starting play-offs")
        if self.playoff_bracket is not None:
            raise RuntimeError("Play-offs already started")

        from ..playoff import DoubleEliminationBracket, SingleEliminationBracket

        ext_id_map: dict[str, str] = {}
        extra_singleton_players: list[Player] = []
        if extra_participants:
            for entry in extra_participants:
                p = Player(name=entry["name"])
                self._player_map[p.id] = p
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

        if team_player_ids and ext_id_map:
            team_player_ids = [ext_id_map.get(pid, pid) for pid in team_player_ids]

        if team_player_ids is None:
            lb = self.leaderboard()
            team_player_ids = [e["player_id"] for e in lb[:n_teams]]

        self._validate_unique_ids(team_player_ids)
        est = self._estimated_scores()

        if extra_participants:
            for entry in extra_participants:
                placeholder = entry.get("placeholder_id")
                real_id = ext_id_map.get(placeholder, "") if placeholder else ""
                if real_id:
                    est[real_id] = float(entry.get("score", 0))
            for ep in extra_singleton_players:
                est[ep.id] = float(self.scores[ep.id])

        if self.team_mode:
            sorted_ids = sorted(team_player_ids, key=lambda pid: est.get(pid, 0.0), reverse=True)
            teams = [[self._player_by_id(pid)] for pid in sorted_ids]
        else:
            pairs = self._pair_playoff_player_ids(team_player_ids)
            pairs.sort(
                key=lambda pair: est.get(pair[0], 0.0) + est.get(pair[1], 0.0),
                reverse=True,
            )
            teams = [[self._player_by_id(pid1), self._player_by_id(pid2)] for pid1, pid2 in pairs]

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
        """Return the champion, or None if not yet decided."""
        if self.playoff_bracket is not None:
            return self.playoff_bracket.champion()
        if self._phase == MexPhase.FINISHED:
            lb = self.leaderboard()
            if lb:
                return [self._player_map[lb[0]["player_id"]]]
        return None
