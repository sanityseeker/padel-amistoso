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
    Standard interleaved bracket seeding for *n* slots (power of 2).

    Returns a list of length *n* where result[i] is the **input-rank index**
    placed at bracket position *i*.  This produces the classic ATP draw:
    for 8 slots → R1 match-ups are seed1v8, seed4v5, seed2v7, seed3v6.
    """
    if n == 1:
        return [0]
    prev = _make_seed_order(n // 2)
    result: list[int] = []
    for s in prev:
        result.append(s)
        result.append(n - 1 - s)
    return result


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
        self._next_match: dict[str, tuple[str, int]] = {}  # match_id -> (next_match_id, slot 0 or 1)
        self._generate()

    # ------------------------------------------------------------------ #

    def _generate(self):
        teams = self.original_teams
        n = len(teams)
        bracket_size = _next_power_of_two(n)

        # Seed into bracket positions — seed_order[i] gives the input rank
        # placed at bracket position i (same semantics as bracket_schema.py).
        seed_order = _make_seed_order(bracket_size)
        seeded: list[list[Player] | None] = [
            teams[seed_order[i]] if seed_order[i] < n else None for i in range(bracket_size)
        ]

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
                    pair_index=p_idx,
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
        return [m for m in self.matches if m.status != MatchStatus.COMPLETED and m.team1 and m.team2]

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

    The losers bracket is **pre-generated** at construction time with
    properly wired advancement edges.  Losers rounds alternate between:

    * *minor* (odd rounds — LR1, LR3, …): pair teams from the same source
      (WR1 losers for LR1; LR survivors for LR3+).
    * *major* (even rounds — LR2, LR4, …): cross-bracket, pairing an LR
      survivor with a WR dropout from the corresponding winners round.

    Byes in the losers bracket (empty slots due to WR byes) are detected
    after wiring and auto-resolved: the present team advances without
    playing.
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
        # Bye tracking: match_id → set of slots (0 and/or 1) that will
        # never receive a team — used by _try_resolve_bye().
        self._bye_slots: dict[str, set[int]] = {}
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
        seeded: list[list[Player] | None] = [
            teams[seed_order[i]] if seed_order[i] < n else None for i in range(bracket_size)
        ]

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
                    pair_index=p_idx,
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

        # --- Pre-generated losers bracket ---
        #
        # Structure for bracket_size = 2^k  (k = num_rounds_w):
        #   num_losers_rounds = 2 * (k - 1)
        #   Matches per round (full bracket, before byes):
        #     LR1 = LR2 = bracket_size / 4
        #     LR3 = LR4 = bracket_size / 8
        #     LR5 = LR6 = bracket_size / 16  …
        #
        # Pair-index mapping from WR to LR:
        #   WR1  pair p  loser  →  LR1    pair p//2   slot p%2
        #   WR(w+1) pair p loser →  LR(2w) pair p      slot 1
        #
        # Internal LR advancement:
        #   LR_odd  pair p  winner →  LR(odd+1) pair p      slot 0
        #   LR_even pair p  winner →  LR(even+1) pair p//2  slot p%2

        num_lr = 2 * (num_rounds_w - 1) if num_rounds_w > 1 else 0
        l_match_at: list[dict[int, Match]] = [{}]  # 1-indexed; index 0 unused

        if num_lr > 0:
            count = bracket_size // 4
            for lr_idx in range(num_lr):
                lr = lr_idx + 1  # 1-indexed round number
                round_matches: dict[int, Match] = {}
                for p in range(count):
                    m = Match(
                        team1=[],
                        team2=[],
                        court=None,
                        round_number=lr,
                        round_label=f"Losers R{lr}",
                        pair_index=p,
                    )
                    round_matches[p] = m
                    self._match_map[m.id] = m
                    self.losers_matches.append(m)
                l_match_at.append(round_matches)
                # After a major round (even index, 1-based), halve for next minor
                if lr % 2 == 0:
                    count = max(count // 2, 1)

        # Wire WR losers → LR
        if num_lr > 0 and w_match_at:
            # WR1 losers → LR1
            for p, wm in w_match_at[0].items():
                lr_pair = p // 2
                lr_slot = p % 2
                if lr_pair in l_match_at[1]:
                    self._add_advancement(wm.id, l_match_at[1][lr_pair].id, lr_slot, is_loser=True)

            # WR(w+1) losers → LR(2*w)  for w >= 1
            for w in range(1, num_rounds_w):
                lr_round = 2 * w
                if lr_round > num_lr:
                    break
                for p, wm in w_match_at[w].items():
                    if p in l_match_at[lr_round]:
                        self._add_advancement(wm.id, l_match_at[lr_round][p].id, 1, is_loser=True)

        # Wire LR internal advancement
        if num_lr > 0:
            for lr in range(1, num_lr):
                next_lr = lr + 1
                if lr % 2 == 1:
                    # minor → major: same pair index, winner goes to slot 0
                    for p, lm in l_match_at[lr].items():
                        if p in l_match_at[next_lr]:
                            self._add_advancement(lm.id, l_match_at[next_lr][p].id, 0, is_loser=False)
                else:
                    # major → minor: combine pairs (halve), winner goes to slot p%2
                    for p, lm in l_match_at[lr].items():
                        next_pair = p // 2
                        next_slot = p % 2
                        if next_pair in l_match_at[next_lr]:
                            self._add_advancement(lm.id, l_match_at[next_lr][next_pair].id, next_slot, is_loser=False)

        # Grand final placeholder
        self.grand_final = Match(
            team1=[],
            team2=[],
            court=None,
            round_label="Grand Final",
            round_number=num_rounds_w + 1,
        )
        self._match_map[self.grand_final.id] = self.grand_final

        # Wire last WR winner → GF team1
        if w_match_at:
            last_w_round = w_match_at[-1]
            if last_w_round:
                last_wm = list(last_w_round.values())[-1]
                self._add_advancement(last_wm.id, self.grand_final.id, 0, is_loser=False)

        # Wire last LR winner → GF team2  (or WR1 loser → GF team2 for 2 teams)
        if num_lr > 0 and l_match_at[num_lr]:
            last_lm = list(l_match_at[num_lr].values())[0]
            self._add_advancement(last_lm.id, self.grand_final.id, 1, is_loser=False)
        elif num_rounds_w == 1 and w_match_at and 0 in w_match_at[0]:
            # Special case: 2 teams, no losers bracket — WR1 loser → GF team2
            self._add_advancement(w_match_at[0][0].id, self.grand_final.id, 1, is_loser=True)

        # Detect bye slots and resolve immediate byes
        self._detect_and_resolve_byes()

        self._all_matches = list(self.winners_matches) + list(self.losers_matches) + [self.grand_final]

    def _add_advancement(self, from_id: str, to_id: str, slot: int, is_loser: bool):
        self._advancement[from_id].append((to_id, slot, is_loser))

    def _detect_and_resolve_byes(self):
        """Find losers bracket slots that can never be filled and auto-advance."""
        # Build reverse map: (match_id, slot) → has at least one incoming edge
        has_source: set[tuple[str, int]] = set()
        for edges in self._advancement.values():
            for next_id, slot, _is_loser in edges:
                has_source.add((next_id, slot))

        # Detect bye slots: losers match slots with no team AND no incoming edge
        for lm in self.losers_matches:
            empty_slots: set[int] = set()
            for slot in (0, 1):
                team = lm.team1 if slot == 0 else lm.team2
                if not team and (lm.id, slot) not in has_source:
                    empty_slots.add(slot)
            if empty_slots:
                self._bye_slots[lm.id] = empty_slots

        # Resolve byes: iterate until no more can be resolved
        changed = True
        while changed:
            changed = False
            for lm in self.losers_matches:
                if lm.status == MatchStatus.COMPLETED:
                    continue
                if lm.id not in self._bye_slots:
                    continue
                bye_slots = self._bye_slots[lm.id]
                if 0 in bye_slots and 1 in bye_slots:
                    # Both slots are byes — mark completed, no one advances
                    lm.status = MatchStatus.COMPLETED
                    changed = True
                    # Propagate: any match expecting a winner from here is also a bye
                    if lm.id in self._advancement:
                        for next_id, slot, is_loser in self._advancement[lm.id]:
                            if not is_loser:  # winner slot
                                self._bye_slots.setdefault(next_id, set()).add(slot)
                    continue

                # One bye slot — check if the other team is present
                active_slot = 0 if 1 in bye_slots else 1
                active_team = lm.team1 if active_slot == 0 else lm.team2
                if active_team:
                    # Team auto-advances through the bye
                    lm.status = MatchStatus.COMPLETED
                    changed = True
                    if lm.id in self._advancement:
                        for next_id, slot, is_loser in self._advancement[lm.id]:
                            if not is_loser:
                                nm = self._match_map[next_id]
                                if slot == 0:
                                    nm.team1 = active_team
                                else:
                                    nm.team2 = active_team

    def _try_resolve_bye(self, match_id: str):
        """After placing a team via advancement, check if this is a bye match."""
        if match_id not in self._bye_slots:
            return
        m = self._match_map[match_id]
        if m.status == MatchStatus.COMPLETED:
            return
        bye_slots = self._bye_slots[match_id]
        if 0 in bye_slots and 1 in bye_slots:
            m.status = MatchStatus.COMPLETED
            return
        active_slot = 0 if 1 in bye_slots else 1
        active_team = m.team1 if active_slot == 0 else m.team2
        if not active_team:
            return
        # Auto-advance the present team
        m.status = MatchStatus.COMPLETED
        if match_id in self._advancement:
            for next_id, slot, is_loser in self._advancement[match_id]:
                if not is_loser:
                    nm = self._match_map[next_id]
                    if slot == 0:
                        nm.team1 = active_team
                    else:
                        nm.team2 = active_team
                    self._try_resolve_bye(next_id)

    @staticmethod
    def _interleave_key(m: Match) -> tuple[float, int]:
        """Sort key that interleaves losers rounds near the corresponding winners round.

        Losers R*N* is scheduled alongside Winners R*(N+1)*, so:
        - Winners R1 → (1, 0)
        - Losers  R1 → (1.5, 1)   (between Winners R1 and R2)
        - Winners R2 → (2, 0)
        - Losers  R2 → (2.5, 1)
        - Grand Final / Reset → very high
        """
        label = m.round_label or ""
        if label.startswith("Winners"):
            return (float(m.round_number), 0)
        if label.startswith("Losers"):
            return (m.round_number + 0.5, 1)
        if label == "Grand Final":
            return (9998.0, 0)
        if label == "Grand Final Reset":
            return (9999.0, 0)
        return (float(m.round_number), 0)

    @property
    def all_matches(self) -> list[Match]:
        matches = (
            list(self.winners_matches)
            + list(self.losers_matches)
            + ([self.grand_final] if self.grand_final else [])
            + ([self.grand_final_reset] if self.grand_final_reset else [])
        )
        matches.sort(key=self._interleave_key)
        return matches

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

        # Advance winner/loser via pre-wired edges
        if match_id in self._advancement:
            for next_id, slot, is_loser_path in self._advancement[match_id]:
                nm = self._match_map[next_id]
                team_to_place = loser if is_loser_path else winner
                if slot == 0:
                    nm.team1 = team_to_place
                else:
                    nm.team2 = team_to_place
                # Check if the target match is a bye and can be auto-resolved
                self._try_resolve_bye(next_id)

        # Grand final logic
        if match_id == self.grand_final.id:
            winner_key = self._team_key(winner)
            # If the losers-bracket team wins the grand final, play a reset
            if self._losses.get(winner_key, 0) > 0 and self.grand_final_reset is None:
                self.grand_final_reset = Match(
                    team1=winner,
                    team2=loser,
                    court=None,
                    round_label="Grand Final Reset",
                    round_number=m.round_number + 1,
                )
                self._match_map[self.grand_final_reset.id] = self.grand_final_reset

    def pending_matches(self) -> list[Match]:
        return [m for m in self.all_matches if m.status != MatchStatus.COMPLETED and m.team1 and m.team2]

    def champion(self) -> list[Player] | None:
        if self.grand_final_reset and self.grand_final_reset.status == MatchStatus.COMPLETED:
            return self.grand_final_reset.winner_team
        if self.grand_final and self.grand_final.status == MatchStatus.COMPLETED:
            w = self.grand_final.winner_team
            if w:
                wk = self._team_key(w)
                if self._losses.get(wk, 0) == 0:
                    return w
        return None
