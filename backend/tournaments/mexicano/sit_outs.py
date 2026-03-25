"""Sit-out selection and weighted scoring for MexicanoTournament."""

from __future__ import annotations

import itertools

from ...models import Player


class SitOutMixin:
    """Methods for choosing which players sit out a round."""

    def _rank_sit_out_combos(self, ranked: list[Player], max_combos: int = 1) -> list[list[Player]]:
        """Return up to *max_combos* sit-out combinations ranked best-first.

        Fairness (fewest prior sit-outs) is the primary gate.  Within that
        pool combinations are scored by the full weighted objective so the
        returned list is ordered from most to least desirable.
        """
        n = self._sit_out_count
        if n == 0:
            return [[]]

        min_sit = min(self._sit_out_counts[p.id] for p in ranked)
        eligible = [p for p in ranked if self._sit_out_counts[p.id] <= min_sit]

        if len(eligible) <= n:
            chosen = eligible[:n]
            if len(chosen) < n:
                remaining = [p for p in ranked if p not in chosen]
                remaining.sort(key=lambda p: self._sit_out_counts[p.id])
                chosen.extend(remaining[: n - len(chosen)])
            return [chosen]

        COMBO_BUDGET = 1000
        all_combos = list(itertools.combinations(eligible, n))

        if len(all_combos) > COMBO_BUDGET:
            est = self._estimated_scores()
            group_size = 2 if self.team_mode else 4

            def _sit_out_heuristic(combo: tuple[Player, ...]) -> float:
                sitting_ids = {p.id for p in combo}
                playing_scores = sorted(
                    (est[p.id] for p in ranked if p.id not in sitting_ids),
                    reverse=True,
                )
                total_imbalance = 0.0
                for i in range(0, len(playing_scores) - group_size + 1, group_size):
                    group_scores = playing_scores[i : i + group_size]
                    total_imbalance += group_scores[0] - group_scores[-1]
                return total_imbalance

            all_combos.sort(key=_sit_out_heuristic)
            all_combos = all_combos[:COMBO_BUDGET]

        scored: list[tuple[tuple, list[Player]]] = []
        for combo in all_combos:
            sitting_ids = {p.id for p in combo}
            playing = [p for p in ranked if p.id not in sitting_ids]
            obj = self._projected_round_objective(playing, strategy="balanced")
            scored.append((obj, list(combo)))

        scored.sort(key=lambda x: x[0])
        return [combo for _, combo in scored[:max_combos]]

    def _choose_sit_outs(self, ranked: list[Player]) -> list[Player]:
        """Pick the single best sit-out combination for this round."""
        return self._rank_sit_out_combos(ranked, max_combos=1)[0]

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

        Returns (weighted_score, skill_gap_violations,
                 exact_prev_round_repeats, score_imbalance, repeat_count).
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
