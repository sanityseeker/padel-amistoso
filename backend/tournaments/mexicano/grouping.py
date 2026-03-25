"""Group-formation, optimization, and pairing-selection logic for MexicanoTournament."""

from __future__ import annotations

import itertools
import random

from ...models import Player
from .. import pairing as pairing_mod


class GroupingMixin:
    """Grouping, cross-group optimization, and pairing methods."""

    # Shared pairing schemes — delegated to the pairing module.
    _PAIRING_SCHEMES = pairing_mod.PAIRING_SCHEMES_4

    def _snake_draft_groups(self, playing: list[Player]) -> list[list[Player]]:
        """Split a ranked player list into groups of 4 using a snake draft."""
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

    def _skill_gap_groups(self, playing: list[Player]) -> list[list[Player]]:
        """Form groups of 4 where the absolute estimated-score difference
        between any two players is <= ``skill_gap``."""
        assert self.skill_gap is not None
        est = self._estimated_scores()
        remaining = list(playing)
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
        """Form groups of 2 participants for team mode."""
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
        """Dispatch to the appropriate grouping strategy."""
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
        """Evaluate all 3 possible 2v2 splits for a group of 4 and return the best.

        In team mode, groups have exactly 2 participants (each is a full team),
        so no split evaluation is needed.
        """
        if self.team_mode:
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
        """Minimum achievable score imbalance for a single group."""
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
        """Total score imbalance across all matches if *playing* were paired now."""
        return sum(self._min_group_imbalance(g) for g in self._form_groups(playing))

    def _pairing_diversity_score(self, playing: list[Player]) -> float:
        """Estimate how 'novel' the pairings would be for *playing* players."""
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
        """Hill-climb over the initial grouping by swapping players between
        groups to reduce the total repeat count across the whole round."""
        if len(groups) < 2:
            return groups

        groups = [list(g) for g in groups]
        base_imbalance = self._total_imbalance(groups)
        imbalance_cap = base_imbalance * (1.0 + self.balance_tolerance) + 2

        for _ in range(max_passes):
            improved = False
            cur_repeats = self._total_repeat_count(groups)
            for gi in range(len(groups)):
                for gj in range(gi + 1, len(groups)):
                    for pi in range(len(groups[gi])):
                        for pj in range(len(groups[gj])):
                            groups[gi][pi], groups[gj][pj] = (
                                groups[gj][pj],
                                groups[gi][pi],
                            )
                            new_repeats = self._total_repeat_count(groups)
                            new_imbalance = self._total_imbalance(groups)
                            if new_repeats < cur_repeats and new_imbalance <= imbalance_cap:
                                cur_repeats = new_repeats
                                improved = True
                            else:
                                groups[gi][pi], groups[gj][pj] = (
                                    groups[gj][pj],
                                    groups[gi][pi],
                                )
            if not improved:
                break
        return groups

    def _seeded_group_pairing(
        self,
        group: list[Player],
        *,
        minimize_repeats: bool,
    ) -> tuple[list[Player], list[Player]]:
        """Pick a pairing for a 4-player seeded group."""
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

    def _pairing_repeat_count(self, team1: list[Player], team2: list[Player]) -> int:
        """Total repeat penalty for a match, with a bonus for full-match repeats."""
        return pairing_mod.pairing_repeat_count(team1, team2, self._partner_history, self._opponent_history)
