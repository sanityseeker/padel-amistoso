"""Scoring, leaderboard, and match-recording logic for MexicanoTournament."""

from __future__ import annotations

from ...models import MatchStatus, Player
from .. import pairing as pairing_mod


class ScoringMixin:
    """Scoring, credits, leaderboard, and player stats methods."""

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

    def _find_match_by_id(self, match_id: str):
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
        """Return detailed partner/opponent history for each player."""
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
        """Recommend top N participants from the leaderboard."""
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
        """Players sorted by projected score descending, accounting for sit-outs."""
        est = self._estimated_scores()
        players = list(pool)
        players.sort(key=lambda p: -est[p.id])
        return players

    def _estimated_scores(self) -> dict[str, float]:
        """Estimate scores normalised to the maximum number of matches played.

        Players who sat out a round have fewer matches.  To make the
        ``skill_gap`` comparison fair we extrapolate their score as if
        they had played as many matches as the most-active player, using
        their per-match average.

        When no matches have been played yet (round 0) and
        ``initial_strength`` is set, strength values are returned instead
        so that round-1 grouping and pairing respects pre-assigned
        rankings.

        The result is cached and invalidated by ``record_result`` since scores
        never change during proposal generation — avoiding hundreds of thousands
        of redundant recomputations in ``propose_pairings``.
        """
        if self._est_cache is not None:
            return self._est_cache

        # Use initial strength as proxy when no matches played yet.
        initial = getattr(self, "initial_strength", None)
        max_played = max(self._matches_played.values()) if self._matches_played else 0
        if max_played == 0 and initial:
            estimated = {pid: initial.get(pid, 0.0) for pid in self.scores}
            self._est_cache = estimated
            return estimated

        estimated: dict[str, float] = {}
        for pid, raw_score in self.scores.items():
            played = self._matches_played[pid]
            if played > 0 and played < max_played:
                mean_per_match = raw_score / played
                estimated[pid] = raw_score + mean_per_match * (max_played - played)
            else:
                estimated[pid] = float(raw_score)
        self._est_cache = estimated
        return estimated

    # ------------------------------------------------------------------ #
    # Record results
    # ------------------------------------------------------------------ #

    def record_result(self, match_id: str, score: tuple[int, int]):
        """Record (or re-record) a match result.

        Both scores should sum to total_points_per_match.  If the match
        was already completed, the previous credits are reversed first
        so that re-recording is safe.
        """
        self._est_cache = None  # scores are about to change
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
        """Normalised strength of *opponent_team* based on absolute estimated points.

        Returns a value in [0.0, 1.0].
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
        """Record a played match in partner/opponent history."""
        pairing_mod.update_history(team1, team2, self._partner_history, self._opponent_history)
