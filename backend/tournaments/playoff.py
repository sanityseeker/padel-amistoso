"""
Play‑off bracket logic — single‑elimination and double‑elimination.

Players are seeded (list order = seed order, index 0 = top seed).
Byes are inserted automatically when the bracket size is not a power of 2.
"""

from __future__ import annotations

import math
from collections import defaultdict

from ..models import Court, Match, MatchStatus, Player

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _next_power_of_two(n: int) -> int:
    return 1 << (n - 1).bit_length()


def _make_seed_order(n: int) -> list[int]:
    """
    Classic bracket seeding for *n* slots (power of 2).
    Returns list of 0‑based indices in match‑up order.
    """
    if n == 1:
        return [0]
    half = _make_seed_order(n // 2)
    return [x * 2 for x in half] + [n - 1 - x * 2 for x in half]


# ────────────────────────────────────────────────────────────────────────────
# Bracket node
# ────────────────────────────────────────────────────────────────────────────


class BracketSlot:
    """
    A slot in the bracket tree.  Either holds a known team (list[Player])
    or is TBD (waiting for a feeder match result).
    """

    def __init__(
        self,
        team: list[Player] | None = None,
        source_match_id: str | None = None,
        use_loser: bool = False,
    ):
        self.team = team
        self.source_match_id = source_match_id  # match whose result feeds here
        self.use_loser = use_loser  # if True, take the loser of source match


# ────────────────────────────────────────────────────────────────────────────
# Single‑elimination bracket
# ────────────────────────────────────────────────────────────────────────────


class SingleEliminationBracket:
    """Generates and manages a single‑elimination bracket."""

    def __init__(self, teams: list[list[Player]]):
        """
        *teams*: list of teams ordered by seed (index 0 = best seed).
        Each team is a list[Player] (length 2 for padel doubles).
        """
        self.original_teams = list(teams)
        self.matches: list[Match] = []
        self._match_map: dict[str, Match] = {}
        self._next_match: dict[
            str, tuple[str, int]
        ] = {}  # match_id -> (next_match_id, slot 0 or 1)
        self._generate()

    # ------------------------------------------------------------------ #

    def _generate(self):
        teams = self.original_teams
        n = len(teams)
        bracket_size = _next_power_of_two(n)

        # Seed into bracket positions
        seed_order = _make_seed_order(bracket_size)
        seeded: list[list[Player] | None] = [None] * bracket_size
        for i, idx in enumerate(seed_order):
            if i < n:
                seeded[idx] = teams[i]

        num_rounds = int(math.log2(bracket_size))
        round_labels = self._round_labels(num_rounds)

        # Track bracket state per round using logical positions.
        # positions[r] = list of teams at each bracket slot
        #   - a team list  → known team (from seeding or bye advancement)
        #   - None          → TBD (waiting for a match result)
        # match_at[r][pair_idx] = the Match object for that pair, if created
        positions: list[list[list[Player] | None]] = [list(seeded)]
        match_at: list[dict[int, Match]] = []

        for r in range(num_rounds):
            curr = positions[-1]
            num_pairs = len(curr) // 2
            next_pos: list[list[Player] | None] = [None] * num_pairs
            round_matches: dict[int, Match] = {}

            for p_idx in range(num_pairs):
                t1, t2 = curr[2 * p_idx], curr[2 * p_idx + 1]

                # Byes only apply in round 0 (the seeding round).
                # In later rounds, None means "TBD from an earlier match",
                # so we must always create a match.
                if r == 0:
                    if t1 is not None and t2 is None:
                        next_pos[p_idx] = t1
                        continue
                    elif t1 is None and t2 is not None:
                        next_pos[p_idx] = t2
                        continue
                    elif t1 is None and t2 is None:
                        # true double-bye — no team here at all
                        continue

                match = Match(
                    team1=t1 or [],
                    team2=t2 or [],
                    round_number=r + 1,
                    round_label=round_labels[r],
                )
                round_matches[p_idx] = match
                self._match_map[match.id] = match
                self.matches.append(match)
                # next_pos[p_idx] stays None → TBD

            match_at.append(round_matches)
            positions.append(next_pos)

        # Build advancement using bracket positions:
        #   Match at pair_idx in round r  →  match at pair_idx//2 in round r+1,
        #   filling slot (pair_idx % 2)  (0 = team1, 1 = team2).
        for r in range(num_rounds - 1):
            for pair_idx, match in match_at[r].items():
                next_pair = pair_idx // 2
                slot = pair_idx % 2
                if next_pair in match_at[r + 1]:
                    next_match = match_at[r + 1][next_pair]
                    self._next_match[match.id] = (next_match.id, slot)

    @staticmethod
    def _round_labels(num_rounds: int) -> list[str]:
        labels: list[str] = []
        for r in range(num_rounds):
            remaining = num_rounds - r
            if remaining == 1:
                labels.append("Final")
            elif remaining == 2:
                labels.append("Semi-Final")
            elif remaining == 3:
                labels.append("Quarter-Final")
            else:
                labels.append(f"Round of {2**remaining}")
        return labels

    # ------------------------------------------------------------------ #
    # Result handling
    # ------------------------------------------------------------------ #

    def record_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
    ):
        m = self._match_map[match_id]
        m.score = score
        m.sets = sets
        m.status = MatchStatus.COMPLETED

        winner = m.winner_team
        if winner is None:
            raise ValueError("Play-off matches cannot end in a draw")

        # Advance winner into next match
        if match_id in self._next_match:
            next_id, slot = self._next_match[match_id]
            nm = self._match_map[next_id]
            if slot == 0:
                nm.team1 = winner
            else:
                nm.team2 = winner

    def pending_matches(self) -> list[Match]:
        """Return matches not yet completed *and* with both teams filled in."""
        return [
            m
            for m in self.matches
            if m.status != MatchStatus.COMPLETED and m.team1 and m.team2
        ]

    def champion(self) -> list[Player] | None:
        if not self.matches:
            return None
        final = self.matches[-1]
        return final.winner_team


# ────────────────────────────────────────────────────────────────────────────
# Double‑elimination bracket
# ────────────────────────────────────────────────────────────────────────────


class DoubleEliminationBracket:
    """
    Double‑elimination: a team must lose twice to be eliminated.

    Internally this manages a *winners bracket* and a *losers bracket*,
    with a grand final (and potential reset if the losers-bracket winner
    beats the winners-bracket winner).
    """

    def __init__(self, teams: list[list[Player]], courts: list[Court] | None = None):
        self.original_teams = list(teams)
        self.courts = list(courts or [])
        self._court_cursor = 0
        self.winners_matches: list[Match] = []
        self.losers_matches: list[Match] = []
        self.grand_final: Match | None = None
        self.grand_final_reset: Match | None = None
        self._match_map: dict[str, Match] = {}
        # Tracking losses: team key -> loss count
        self._losses: dict[str, int] = {}
        self._all_matches: list[Match] = []
        # Advancement bookkeeping
        self._advancement: defaultdict[str, list[tuple[str, int, bool]]] = defaultdict(list)
        self._generate()

    def _next_court(self) -> Court | None:
        """Round-robin court assignment for newly created bracket matches."""
        if not self.courts:
            return None
        court = self.courts[self._court_cursor % len(self.courts)]
        self._court_cursor += 1
        return court

    def _team_key(self, team: list[Player]) -> str:
        return ",".join(sorted(p.id for p in team))

    def _generate(self):
        teams = self.original_teams
        n = len(teams)

        if n < 2:
            return

        bracket_size = _next_power_of_two(n)
        num_rounds_w = int(math.log2(bracket_size))

        # --- Winners bracket (position‑based, same as SingleElim) ---
        seed_order = _make_seed_order(bracket_size)
        seeded: list[list[Player] | None] = [None] * bracket_size
        for i, idx in enumerate(seed_order):
            if i < n:
                seeded[idx] = teams[i]

        w_match_at: list[dict[int, Match]] = []
        positions: list[list[list[Player] | None]] = [list(seeded)]

        for r in range(num_rounds_w):
            curr = positions[-1]
            num_pairs = len(curr) // 2
            next_pos: list[list[Player] | None] = [None] * num_pairs
            round_matches: dict[int, Match] = {}

            for p_idx in range(num_pairs):
                t1, t2 = curr[2 * p_idx], curr[2 * p_idx + 1]

                if r == 0:
                    if t1 is not None and t2 is None:
                        next_pos[p_idx] = t1
                        continue
                    elif t1 is None and t2 is not None:
                        next_pos[p_idx] = t2
                        continue
                    elif t1 is None and t2 is None:
                        continue

                both_known = bool(t1) and bool(t2)
                m = Match(
                    team1=t1 or [],
                    team2=t2 or [],
                    court=self._next_court() if both_known else None,
                    round_number=r + 1,
                    round_label=f"Winners R{r + 1}",
                )
                round_matches[p_idx] = m
                self._match_map[m.id] = m
                self.winners_matches.append(m)

            w_match_at.append(round_matches)
            positions.append(next_pos)

        # Build winners advancement using bracket positions
        for r in range(num_rounds_w - 1):
            for pair_idx, match in w_match_at[r].items():
                next_pair = pair_idx // 2
                slot = pair_idx % 2
                if next_pair in w_match_at[r + 1]:
                    next_match = w_match_at[r + 1][next_pair]
                    self._add_advancement(match.id, next_match.id, slot, is_loser=False)

        # --- Losers bracket ---
        # Simplified: we create placeholder losers-round matches.
        # Losers from winners R1 feed into losers R1, etc.
        # Full double-elim bracket wiring is complex; we use a
        # simplified sequential approach here.
        l_rounds: list[list[Match]] = []

        # We'll pre-create losers matches and wire them as results come in
        # For now, store losers bracket state dynamically
        self._w_match_at = w_match_at
        self._l_rounds = l_rounds
        self._losers_queue: list[list[Player]] = []

        # Grand final placeholder — court assigned lazily when teams are known
        self.grand_final = Match(
            team1=[],
            team2=[],
            court=None,
            round_label="Grand Final",
            round_number=num_rounds_w + 1,
        )
        self._match_map[self.grand_final.id] = self.grand_final

        self._all_matches = (
            list(self.winners_matches) + list(self.losers_matches) + [self.grand_final]
        )

    def _add_advancement(self, from_id: str, to_id: str, slot: int, is_loser: bool):
        self._advancement[from_id].append((to_id, slot, is_loser))

    @property
    def all_matches(self) -> list[Match]:
        return (
            list(self.winners_matches)
            + list(self.losers_matches)
            + ([self.grand_final] if self.grand_final else [])
            + ([self.grand_final_reset] if self.grand_final_reset else [])
        )

    def record_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
    ):
        m = self._match_map[match_id]
        m.score = score
        m.sets = sets
        m.status = MatchStatus.COMPLETED

        winner = m.winner_team
        loser = m.loser_team
        if winner is None or loser is None:
            raise ValueError("Play-off matches cannot end in a draw")

        loser_key = self._team_key(loser)
        self._losses[loser_key] = self._losses.get(loser_key, 0) + 1

        # Advance winner in winners/losers bracket
        if match_id in self._advancement:
            for next_id, slot, is_loser_path in self._advancement[match_id]:
                nm = self._match_map[next_id]
                team_to_place = loser if is_loser_path else winner
                if slot == 0:
                    nm.team1 = team_to_place
                else:
                    nm.team2 = team_to_place

        # If loser has < 2 losses, send to losers bracket queue
        if self._losses[loser_key] < 2 and m.round_label.startswith("Winners"):
            self._losers_queue.append(loser)
            self._try_create_losers_match()

        # If this was a losers match, winner stays in losers bracket queue
        if m.round_label.startswith("Losers"):
            self._losers_queue.append(winner)
            self._try_create_losers_match()

        # Check if we can populate grand final
        self._try_populate_grand_final()

        # Grand final logic
        if match_id == self.grand_final.id:
            winner_key = self._team_key(winner)
            # If the losers-bracket team wins the grand final, play a reset
            if self._losses.get(winner_key, 0) > 0 and self.grand_final_reset is None:
                self.grand_final_reset = Match(
                    team1=winner,
                    team2=loser,
                    court=self._next_court(),
                    round_label="Grand Final Reset",
                    round_number=m.round_number + 1,
                )
                self._match_map[self.grand_final_reset.id] = self.grand_final_reset

    def _try_create_losers_match(self):
        while len(self._losers_queue) >= 2:
            t1 = self._losers_queue.pop(0)
            t2 = self._losers_queue.pop(0)
            r = len(self.losers_matches) + 1
            m = Match(
                team1=t1,
                team2=t2,
                court=self._next_court(),
                round_number=r,
                round_label=f"Losers R{r}",
            )
            self.losers_matches.append(m)
            self._match_map[m.id] = m

    def _try_populate_grand_final(self):
        if self.grand_final is None:
            return
        # Winners bracket champion = winner of the final winners match
        # (the only match in the last round of w_match_at)
        if self._w_match_at:
            last_round = self._w_match_at[-1]
            if last_round:
                last_w = list(last_round.values())[-1]
                if last_w.status == MatchStatus.COMPLETED and last_w.winner_team:
                    self.grand_final.team1 = last_w.winner_team

        # Losers bracket champion = last person standing in losers queue
        # with exactly 1 loss (simplified)
        completed_losers = [
            m for m in self.losers_matches if m.status == MatchStatus.COMPLETED
        ]
        if completed_losers:
            last_l = completed_losers[-1]
            if last_l.winner_team:
                self.grand_final.team2 = last_l.winner_team

    def pending_matches(self) -> list[Match]:
        return [
            m
            for m in self.all_matches
            if m.status != MatchStatus.COMPLETED and m.team1 and m.team2
        ]

    def champion(self) -> list[Player] | None:
        if (
            self.grand_final_reset
            and self.grand_final_reset.status == MatchStatus.COMPLETED
        ):
            return self.grand_final_reset.winner_team
        if self.grand_final and self.grand_final.status == MatchStatus.COMPLETED:
            w = self.grand_final.winner_team
            if w:
                wk = self._team_key(w)
                if self._losses.get(wk, 0) == 0:
                    return w
        return None
