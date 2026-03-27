"""
Group‑stage logic.

Supports variable number of players and groups.

Two match-generation modes:
  * **team_mode** (fixed teams) — ``generate_round_robin()`` creates all
    round-robin matches at once (fast, few matches).
  * **individual mode** — ``generate_next_round()`` creates one round at a
    time, rotating partnerships so every player partners with every other
    player exactly once, and opponents are selected by similar cumulative
    score (Mexicano-style).
"""

from __future__ import annotations

import itertools
import random
import string
from collections import defaultdict

from ..models import Court, GroupStanding, Match, MatchStatus, Player
from . import pairing as pairing_mod


class Group:
    """One group of players playing a round-robin."""

    def __init__(self, name: str, players: list[Player], team_mode: bool = False):
        self.name = name
        self.players = list(players)
        self.team_mode = team_mode
        self.matches: list[Match] = []
        self._standings_cache: list[GroupStanding] | None = None

        # Partnership / opponent tracking for round-by-round generation.
        self._partner_history: dict[str, dict[str, int]] = pairing_mod.make_history(self.players)
        self._opponent_history: dict[str, dict[str, int]] = pairing_mod.make_history(self.players)
        self._used_partnerships: set[frozenset[str]] = set()
        self._round_count: int = 0
        self._sit_out_counts: dict[str, int] = {p.id: 0 for p in self.players}
        self._all_partnerships: set[frozenset[str]] = {
            frozenset([a.id, b.id]) for a, b in itertools.combinations(self.players, 2)
        }

    # ------------------------------------------------------------------ #
    # Match generation
    # ------------------------------------------------------------------ #

    def generate_round_robin(self) -> list[Match]:
        """
        Generate all‑play‑all matches.

        Padel is 2v2, so we generate all possible *team pairings* from the
        group's player pool.  With N players we form every unique pair of
        pairs (teams) ensuring no player appears on both sides.
        """
        players = self.players
        matches: list[Match] = []

        if self.team_mode:
            # Fixed-team mode: each entry is already a full team.
            for t1, t2 in itertools.combinations(players, 2):
                matches.append(
                    Match(
                        team1=[t1],
                        team2=[t2],
                        round_label=f"Group {self.name}",
                    )
                )
        else:
            # All 2‑player combinations (possible teams)
            teams = list(itertools.combinations(players, 2))
            seen: set[frozenset] = set()

            for i, t1 in enumerate(teams):
                for t2 in teams[i + 1 :]:
                    # No overlapping players
                    if set(t1) & set(t2):
                        continue
                    key = frozenset([frozenset(t1), frozenset(t2)])
                    if key in seen:
                        continue
                    seen.add(key)
                    matches.append(
                        Match(
                            team1=list(t1),
                            team2=list(t2),
                            round_label=f"Group {self.name}",
                        )
                    )
        random.shuffle(matches)
        self.matches = matches
        self._standings_cache = None
        return matches

    def generate_next_round(self) -> list[Match]:
        """Generate one round of matches using Mexicano-style pairing.

        Each round:
          1. Rank players by cumulative score.
          2. Choose sit-outs if the group size isn't divisible by 4.
          3. Form groups of 4 from the remaining players.
          4. Use ``best_2v2_split`` to pick the most balanced 2v2
             pairing within each group, minimising score imbalance
             first and partner/opponent repeats second.

        Returns an empty list when all C(N, 2) partnerships have been
        covered.
        """
        if self.team_mode:
            raise RuntimeError("Use generate_round_robin() for team mode")

        if not self.has_more_rounds:
            return []

        # Current per-player scores from standings.
        scores: dict[str, float] = {p.id: 0.0 for p in self.players}
        for row in self.standings():
            scores[row.player.id] = float(row.points_for)

        ranked = sorted(self.players, key=lambda p: -scores[p.id])

        # Sit-outs (group size not divisible by 4).
        num_sit = len(ranked) % 4
        if num_sit:
            sitting = pairing_mod.choose_sit_outs(ranked, self._sit_out_counts, num_sit)
            for p in sitting:
                self._sit_out_counts[p.id] += 1
            sitting_ids = {p.id for p in sitting}
            playing = [p for p in ranked if p.id not in sitting_ids]
        else:
            playing = ranked

        # Form groups of 4 and pick best 2v2 splits.
        groups = [playing[i : i + 4] for i in range(0, len(playing), 4)]
        self._round_count += 1
        new_matches: list[Match] = []
        for group in groups:
            if len(group) < 4:
                continue
            t1, t2 = pairing_mod.best_2v2_split(
                group,
                scores,
                self._partner_history,
                self._opponent_history,
            )
            m = Match(
                team1=t1,
                team2=t2,
                round_number=self._round_count,
                round_label=f"Group {self.name} R{self._round_count}",
            )
            new_matches.append(m)

            for team in [t1, t2]:
                if len(team) == 2:
                    self._used_partnerships.add(frozenset([team[0].id, team[1].id]))
            pairing_mod.update_history(t1, t2, self._partner_history, self._opponent_history)

        self.matches.extend(new_matches)
        self._standings_cache = None
        return new_matches

    @property
    def has_more_rounds(self) -> bool:
        """Whether there are still uncovered partnerships."""
        if self.team_mode:
            return False
        return bool(self._all_partnerships - self._used_partnerships)

    # ------------------------------------------------------------------ #
    # Standings
    # ------------------------------------------------------------------ #

    def standings(self) -> list[GroupStanding]:
        """Compute current standings for this group."""
        table: dict[str, GroupStanding] = {p.id: GroupStanding(player=p) for p in self.players}

        for m in self.matches:
            if m.status != MatchStatus.COMPLETED or m.score is None:
                continue

            if m.sets:
                # Sets format: use actual game totals for points, but
                # determine wins/losses by sets won (not total games).
                games1 = sum(s[0] for s in m.sets)
                games2 = sum(s[1] for s in m.sets)
                sets1 = sum(1 for s in m.sets if s[0] > s[1])
                sets2 = sum(1 for s in m.sets if s[1] > s[0])
                if sets1 > sets2:
                    t1_won: bool | None = True
                elif sets2 > sets1:
                    t1_won = False
                else:
                    t1_won = None
                for p in m.team1:
                    _update_standing(
                        table[p.id],
                        scored=games1,
                        conceded=games2,
                        third_set=m.third_set_loss,
                        won=t1_won,
                    )
                for p in m.team2:
                    _update_standing(
                        table[p.id],
                        scored=games2,
                        conceded=games1,
                        third_set=m.third_set_loss,
                        won=None if t1_won is None else not t1_won,
                    )
            else:
                s1, s2 = m.score
                for p in m.team1:
                    _update_standing(table[p.id], scored=s1, conceded=s2, third_set=m.third_set_loss)
                for p in m.team2:
                    _update_standing(table[p.id], scored=s2, conceded=s1, third_set=m.third_set_loss)

        standings = sorted(table.values(), key=lambda r: r.sort_key(), reverse=True)
        self._standings_cache = standings
        return standings

    def top_players(self, n: int) -> list[Player]:
        """Return the top *n* players by standings."""
        st = self.standings()
        return [row.player for row in st[:n]]


def _update_standing(
    row: GroupStanding,
    scored: int,
    conceded: int,
    third_set: bool,
    won: bool | None = None,
) -> None:
    """Update a single GroupStanding row with one completed match's result.

    Args:
        scored: Points/games scored by this player's team.
        conceded: Points/games conceded.
        third_set: Whether the match was decided in a 3rd set.
        won: Explicit win/loss flag.  When provided (sets format), this
            overrides the ``scored > conceded`` comparison so that the
            winner is always determined by sets won, not by total games.
            ``None`` falls back to the numeric comparison (simple format).
    """
    row.played += 1
    row.points_for += scored
    row.points_against += conceded

    is_win = won if won is not None else (scored > conceded)
    is_loss = (not won) if won is not None else (scored < conceded)

    if is_win:
        row.wins += 1
    elif is_loss:
        if third_set:
            # Consolation point: lost in the deciding 3rd set — counts as a loss but awards 1 pt.
            row.third_set_losses += 1
        else:
            row.losses += 1
    else:
        row.draws += 1


def distribute_players_to_groups(
    players: list[Player],
    num_groups: int,
    shuffle: bool = True,
    team_mode: bool = False,
    group_names: list[str] | None = None,
    snake_draft: bool = False,
) -> list[Group]:
    """
    Distribute *players* as evenly as possible across *num_groups* groups.

    Args:
        group_names: Optional custom names for each group.  Falls back to
            ``A``, ``B``, ``C`` … when not provided or when shorter than
            *num_groups*.
        snake_draft: When True, uses snake-draft ordering (1→A, 2→B, 3→B, 4→A, …)
            to produce balanced groups.  Only meaningful when shuffle is False
            and players are pre-sorted (e.g. by strength).
    """
    if shuffle:
        players = list(players)
        random.shuffle(players)

    if snake_draft and not shuffle:
        # Snake-draft: distribute in zigzag order for balanced groups
        buckets: list[list[Player]] = [[] for _ in range(num_groups)]
        direction = 1
        g_idx = 0
        for p in players:
            buckets[g_idx].append(p)
            next_g = g_idx + direction
            if next_g >= num_groups or next_g < 0:
                direction *= -1
            else:
                g_idx = next_g

        groups: list[Group] = []
        for g in range(num_groups):
            default_name = string.ascii_uppercase[g]
            group_name = (
                group_names[g] if group_names and g < len(group_names) and group_names[g].strip() else default_name
            )
            groups.append(Group(name=group_name, players=buckets[g], team_mode=team_mode))
        return groups

    groups = []
    base_size = len(players) // num_groups
    remainder = len(players) % num_groups

    idx = 0
    for g in range(num_groups):
        size = base_size + (1 if g < remainder else 0)
        default_name = string.ascii_uppercase[g]
        group_name = group_names[g] if group_names and g < len(group_names) and group_names[g].strip() else default_name
        groups.append(Group(name=group_name, players=players[idx : idx + size], team_mode=team_mode))
        idx += size

    return groups


def _match_player_ids(m: Match) -> set[str]:
    """Return all player IDs participating in a match."""
    return {p.id for p in m.team1 + m.team2}


def assign_courts(
    matches: list[Match],
    courts: list[Court],
    *,
    court_offset: int = 0,
) -> list[Match]:
    """
    Assign courts to unassigned matches, distributing them across time slots.

    Algorithm
    ---------
    1. Build a compatibility graph (edges between matches that share no
       players and can therefore run simultaneously).
    2. For 2 courts, compute a **maximum matching** (augmenting-path) so
       that as many time slots as possible use both courts.  For ≥ 3 courts
       a greedy independent-set heuristic is used.
    3. Order the resulting slots: fuller slots first, tie-broken by a
       rest heuristic (minimise player overlap between consecutive slots).
    4. Assign physical courts round-robin within each slot, rotated by
       *court_offset*.

    Each assigned match gets ``slot_number`` set to its 0-based slot index.
    Matches that already have a court are left untouched.

    Parameters
    ----------
    court_offset:
        Rotate the court list by this many positions so that successive
        batches of assignments spread across all courts.
    """
    if not courts:
        return matches

    pool: list[Match] = [m for m in matches if m.court is None and m.team1 and m.team2]
    if not pool:
        return matches

    n_courts = len(courts)

    # Phase 1 — partition pool into time-slots.
    slots = _partition_into_slots(pool, n_courts)

    # Phase 2 — order: fuller slots first, rest-aware within same-size tiers.
    slots = _order_slots(slots)

    # Phase 3 — assign courts and slot numbers.
    for slot_idx, group in enumerate(slots):
        for i, m in enumerate(group):
            m.court = courts[(slot_idx + i + court_offset) % n_courts]
            m.slot_number = slot_idx

    return matches


# ── Slot partitioning helpers ─────────────────────────────


def _partition_into_slots(pool: list[Match], n_courts: int) -> list[list[Match]]:
    """Split *pool* into groups of up to *n_courts* compatible matches.

    For ≤ 2 courts the result is optimal (maximum-matching).
    For more courts a greedy heuristic is used.
    """
    if n_courts <= 1 or not pool:
        return [[m] for m in pool]

    ps: dict[int, set[str]] = {id(m): _match_player_ids(m) for m in pool}

    # Build compatibility adjacency.
    compat: dict[int, set[int]] = {id(m): set() for m in pool}
    for i, m1 in enumerate(pool):
        for m2 in pool[i + 1 :]:
            if not (ps[id(m1)] & ps[id(m2)]):
                compat[id(m1)].add(id(m2))
                compat[id(m2)].add(id(m1))

    if n_courts == 2:
        return _matching_slots(pool, compat)

    # Greedy for n_courts ≥ 3.
    remaining = list(pool)
    random.shuffle(remaining)
    slots: list[list[Match]] = []
    used: set[int] = set()
    while len(used) < len(pool):
        group: list[Match] = []
        gp: set[str] = set()
        for m in remaining:
            if id(m) in used:
                continue
            if not (ps[id(m)] & gp):
                group.append(m)
                gp |= ps[id(m)]
                used.add(id(m))
                if len(group) >= n_courts:
                    break
        if not group:
            break
        slots.append(group)
    return slots


def _matching_slots(pool: list[Match], compat: dict[int, set[int]]) -> list[list[Match]]:
    """Maximum-matching on the compatibility graph → paired + singleton slots.

    Enumerates all compatible pairs and uses randomised greedy selection
    with restarts to find the largest set of non-overlapping pairs.
    Reliable for the small graph sizes typical of tournament scheduling.
    """
    by_id: dict[int, Match] = {id(m): m for m in pool}

    # Collect every compatible pair.
    all_pairs: list[tuple[int, int]] = []
    for i, m1 in enumerate(pool):
        mid1 = id(m1)
        for m2 in pool[i + 1 :]:
            mid2 = id(m2)
            if mid2 in compat.get(mid1, ()):
                all_pairs.append((mid1, mid2))

    best_matching: list[tuple[int, int]] = []
    max_possible = len(pool) // 2

    for _attempt in range(50):
        random.shuffle(all_pairs)
        used: set[int] = set()
        matching: list[tuple[int, int]] = []
        for a, b in all_pairs:
            if a not in used and b not in used:
                matching.append((a, b))
                used.add(a)
                used.add(b)
        if len(matching) > len(best_matching):
            best_matching = matching
        if len(best_matching) >= max_possible:
            break

    paired_ids: set[int] = set()
    slots: list[list[Match]] = []
    for a, b in best_matching:
        slots.append([by_id[a], by_id[b]])
        paired_ids.add(a)
        paired_ids.add(b)
    for m in pool:
        if id(m) not in paired_ids:
            slots.append([m])
    return slots


def _order_slots(slots: list[list[Match]]) -> list[list[Match]]:
    """Order slots: fuller first; within same-size tiers, minimise overlap."""
    if len(slots) <= 1:
        return slots

    tiers: defaultdict[int, list[list[Match]]] = defaultdict(list)
    for s in slots:
        tiers[len(s)].append(s)

    result: list[list[Match]] = []
    prev_players: set[str] = set()

    for size in sorted(tiers, reverse=True):
        remaining = list(tiers[size])
        while remaining:
            best_idx = 0
            best_overlap = float("inf")
            for i, slot in enumerate(remaining):
                overlap = sum(1 for m in slot for p in m.team1 + m.team2 if p.id in prev_players)
                if overlap < best_overlap:
                    best_overlap = overlap
                    best_idx = i
            chosen = remaining.pop(best_idx)
            result.append(chosen)
            prev_players = set()
            for m in chosen:
                prev_players |= _match_player_ids(m)

    return result
