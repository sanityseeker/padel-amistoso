"""
Play‑off bracket logic — single‑elimination and double‑elimination.

Players are seeded (list order = seed order, index 0 = top seed).
Byes are inserted automatically when the bracket size is not a power of 2.
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field

from ..models import Court, Match, MatchStatus, Player


# ────────────────────────────────────────────────────────────────────────────
# Bracket topology — pure-structural description, no Player objects
# ────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class MatchRef:
    """Lightweight reference to a bracket match (structural info only)."""

    id: str
    round_label: str
    round_number: int
    pair_index: int


@dataclass(frozen=True, slots=True)
class AdvancementEdge:
    """A wired advancement between two bracket matches."""

    from_id: str
    to_id: str
    to_slot: int  # 0 = team1, 1 = team2 of the target match
    is_loser: bool  # True → loser of from_match goes here; False → winner


@dataclass
class BracketTopology:
    """
    Pure-structural description of a double-elimination bracket.

    Carries no ``Player`` objects — only match references and wiring edges.
    The visualisation layer uses this as its single source of truth for
    bracket shape, replacing the previously duplicated layout logic that
    lived in ``bracket_schema.py``.
    """

    bracket_size: int
    winners_rounds: list[list[MatchRef]]  # outer = round index; inner = matches in that round
    losers_rounds: list[list[MatchRef]]  # same layout for the losers bracket
    grand_final: MatchRef
    advancement_edges: list[AdvancementEdge] = field(default_factory=list)


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

    The losers bracket is built **dynamically** at construction time so
    that its structure adapts to the actual number of real matches per
    winners round (i.e. byes are handled correctly).

    Losers rounds follow a pool-based algorithm:

    * **LR1 (minor)**: WR1 losers are paired sequentially among themselves.
    * **Subsequent rounds**: for each WR round, if the WR losers *outnumber*
      the current LR survivor pool, the WR losers first play a preliminary
      minor round among themselves before the cross-bracket major round.
      Otherwise they go directly into the major round.

    This guarantees that same-round losers face each other before meeting
    already-tested LR survivors, and produces correct structure for both
    full power-of-2 brackets and brackets with byes.

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

        # --- Dynamic losers bracket ---
        #
        # Rounds are built sequentially rather than pre-allocated.  WR1 losers
        # are paired together first (minor round), then for each subsequent WR
        # round the losers are:
        #   a) paired among themselves (new minor round) when they outnumber
        #      existing LR survivors — ensures same-round losers meet each other
        #      before facing losers from earlier WR rounds.
        #   b) sent directly to the major cross-round otherwise (standard path).
        # This produces the correct structure for both full brackets (8, 16 teams)
        # and brackets with byes (5, 6, 7 teams).
        last_lr_match = self._fill_losers_bracket(w_match_at)

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

        # Wire LR final winner → GF team2  (or WR1 loser → GF team2 for 2 teams)
        if last_lr_match is not None:
            self._add_advancement(last_lr_match.id, self.grand_final.id, 1, is_loser=False)
        elif num_rounds_w == 1 and w_match_at and 0 in w_match_at[0]:
            # Special case: 2 teams, no losers bracket — WR1 loser → GF team2
            self._add_advancement(w_match_at[0][0].id, self.grand_final.id, 1, is_loser=True)

        # Detect bye slots and resolve immediate byes
        self._detect_and_resolve_byes()

        self._all_matches = list(self.winners_matches) + list(self.losers_matches) + [self.grand_final]

    def _fill_losers_bracket(self, w_match_at: list[dict[int, Match]]) -> Match | None:
        """
        Dynamically build all losers bracket rounds and wire their advancement edges.

        Returns the last LR match (whose winner advances to the Grand Final),
        or ``None`` for the 2-team edge case (no losers bracket).

        Algorithm
        ---------
        Each pool entry is a ``(match_id, is_loser)`` pair:

        * ``is_loser=True``  — the *loser* of that match feeds the next LR slot.
        * ``is_loser=False`` — the *winner* of that match feeds the next LR slot.

        ``_pair_pool`` consumes a pool, creates one new LR round, wires
        advancements, and returns the survivors as a new winner pool.

        The structure follows standard double-elimination alternation:

        1. **LR1 minor** — WR1 losers pair among themselves.
        2. For each subsequent WR round:

           a. **Preliminary minor** (optional) — if the WR round produces more
              losers than there are current LR survivors, the WR losers first
              play each other.  This also fires for *equal* counts after the
              mandatory minor below reduces the LR pool, ensuring WR losers
              of the same round always face each other before meeting
              established LR survivors.
           b. **Major cross-round** — the interleaved WR-loser pool and LR
              survivor pool produce one set of new LR matches.
           c. **Minor round** (after cross) — the LR survivors from the major
              cross pair among themselves, halving the pool before the next WR
              round drops in.  This step is skipped only after the *final* WR
              round's major cross (which feeds directly into the Grand Final).

        This alternation reproduces the standard DE bracket for power-of-2
        sizes (8, 16 teams) unchanged, and correctly handles asymmetric
        brackets with byes (e.g. 10 or 12 teams) so that every cohort of WR
        losers competes among themselves before facing LR survivors.
        """
        num_rounds_w = len(w_match_at)
        if num_rounds_w <= 1:
            return None  # 2-team: WR1 loser wired directly to GF by caller

        lr_round_num = 0
        Pool = list[tuple[str, bool]]

        def _pair_pool(pool: Pool) -> Pool:
            """Pair adjacent pool entries into one new LR round; return winner pool."""
            nonlocal lr_round_num
            if not pool:
                return []
            lr_round_num += 1  # all matches in this call share the same round number
            new_pool: Pool = []
            for i in range(0, len(pool), 2):
                a_id, a_is_loser = pool[i]
                lm = Match(
                    team1=[],
                    team2=[],
                    court=None,
                    round_number=lr_round_num,
                    round_label=f"Losers R{lr_round_num}",
                    pair_index=i // 2,
                )
                self._match_map[lm.id] = lm
                self.losers_matches.append(lm)
                self._add_advancement(a_id, lm.id, 0, is_loser=a_is_loser)
                if i + 1 < len(pool):
                    b_id, b_is_loser = pool[i + 1]
                    self._add_advancement(b_id, lm.id, 1, is_loser=b_is_loser)
                # If i+1 >= len(pool): slot 1 has no source → bye slot,
                # detected and resolved by _detect_and_resolve_byes().
                new_pool.append((lm.id, False))  # winner of this LR match advances
            return new_pool

        # LR1: pair WR1 losers sequentially (not by absolute pair index).
        # Sorting by pair_index gives a stable, deterministic order.
        wr1_losers: Pool = [(m.id, True) for _, m in sorted(w_match_at[0].items())]
        lr_pool: Pool = _pair_pool(wr1_losers) if len(wr1_losers) >= 2 else list(wr1_losers)

        for w in range(1, num_rounds_w):
            wr_losers: Pool = [(m.id, True) for _, m in sorted(w_match_at[w].items())]
            if not wr_losers:
                continue

            # When WR round drops more losers than LR survivors, pair the WR
            # losers among themselves first so they face each other before
            # meeting hardened LR survivors.
            if len(wr_losers) > len(lr_pool) and len(wr_losers) >= 2:
                wr_pool: Pool = _pair_pool(wr_losers)
            else:
                wr_pool = wr_losers

            # Reduce lr_pool until it matches wr_pool count.
            while len(lr_pool) > len(wr_pool) and len(lr_pool) >= 2:
                lr_pool = _pair_pool(lr_pool)

            # Reduce wr_pool until it matches lr_pool count.  This handles
            # the case where the preliminary reduced WR losers to more than
            # the current LR survivors (e.g. 10-team: LR1→1 survivor,
            # WR2 preliminary→2 survivors).  Without this step the cross would
            # produce a bye; pairing the wr_pool extra minor here eliminates
            # the bye and gives every team a real opponent.
            while len(wr_pool) > len(lr_pool) and len(wr_pool) >= 2:
                wr_pool = _pair_pool(wr_pool)

            # Major cross-round: interleave lr survivors with wr survivors.
            interleaved: Pool = []
            for i in range(max(len(lr_pool), len(wr_pool))):
                if i < len(lr_pool):
                    interleaved.append(lr_pool[i])
                if i < len(wr_pool):
                    interleaved.append(wr_pool[i])
            lr_pool = _pair_pool(interleaved)

            # Standard DE alternation: always add a minor round after a major
            # cross so that LR survivors compete among themselves before the
            # next WR round drops in.  This ensures WR losers from the same
            # round face each other (via the preliminary path) rather than
            # being immediately seeded against established LR survivors.
            # Skip only on the final WR round because its loss feeds the Grand
            # Final cross directly (no further LR minor needed there).
            if len(lr_pool) >= 2 and w + 1 < num_rounds_w:
                lr_pool = _pair_pool(lr_pool)

        # Final reduction to a single survivor (handles any residual imbalance).
        while len(lr_pool) > 1:
            lr_pool = _pair_pool(lr_pool)

        if lr_pool:
            last_lr_id, _ = lr_pool[0]
            return self._match_map[last_lr_id]
        return None

    # ------------------------------------------------------------------ #
    # Topology export
    # ------------------------------------------------------------------ #

    def topology(self) -> BracketTopology:
        """
        Return a ``BracketTopology`` describing the bracket structure.

        The topology contains only match references and wiring edges — no
        ``Player`` objects.  It is the single source of truth consumed by
        the visualisation layer (``bracket_schema.py``) so that both the
        game engine and the diagram always agree on the bracket shape.
        """
        by_round: defaultdict[int, list[MatchRef]] = defaultdict(list)
        for m in self.winners_matches:
            by_round[m.round_number].append(MatchRef(m.id, m.round_label, m.round_number, m.pair_index))
        winners_rounds = [sorted(by_round[r], key=lambda x: x.pair_index) for r in sorted(by_round)]

        lr_by_round: defaultdict[int, list[MatchRef]] = defaultdict(list)
        for m in self.losers_matches:
            lr_by_round[m.round_number].append(MatchRef(m.id, m.round_label, m.round_number, m.pair_index))
        losers_rounds = [sorted(lr_by_round[r], key=lambda x: x.pair_index) for r in sorted(lr_by_round)]

        gf = self.grand_final
        gf_ref = MatchRef(gf.id, gf.round_label, gf.round_number, 0)

        edges = [
            AdvancementEdge(from_id, to_id, slot, is_loser)
            for from_id, targets in self._advancement.items()
            for to_id, slot, is_loser in targets
        ]

        return BracketTopology(
            bracket_size=_next_power_of_two(len(self.original_teams)),
            winners_rounds=winners_rounds,
            losers_rounds=losers_rounds,
            grand_final=gf_ref,
            advancement_edges=edges,
        )

    @classmethod
    def for_preview(cls, n: int) -> DoubleEliminationBracket:
        """
        Create a structurally correct bracket for *n* stub teams.

        No real ``Player`` data is needed — this is used by the visualisation
        layer to obtain the bracket topology before any actual players are
        registered.
        """
        stub_teams = [[Player(name=f"S{i}")] for i in range(n)]
        return cls(stub_teams)

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
