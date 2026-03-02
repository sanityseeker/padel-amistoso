"""
Group‑stage logic.

Supports variable number of players and groups.
Generates round‑robin matches inside each group and computes standings.
"""

from __future__ import annotations

import itertools
import random

from ..models import Court, GroupStanding, Match, MatchStatus, Player


class Group:
    """One group of players playing a round-robin."""

    def __init__(self, name: str, players: list[Player], team_mode: bool = False):
        self.name = name
        self.players = list(players)
        self.team_mode = team_mode
        self.matches: list[Match] = []
        self._standings_cache: list[GroupStanding] | None = None

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

    # ------------------------------------------------------------------ #
    # Standings
    # ------------------------------------------------------------------ #

    def standings(self) -> list[GroupStanding]:
        """Compute current standings for this group."""
        table: dict[str, GroupStanding] = {p.id: GroupStanding(player=p) for p in self.players}

        for m in self.matches:
            if m.status != MatchStatus.COMPLETED or m.score is None:
                continue
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


def _update_standing(row: GroupStanding, scored: int, conceded: int, third_set: bool) -> None:
    """Update a single GroupStanding row with one completed match's result."""
    row.played += 1
    row.points_for += scored
    row.points_against += conceded
    if scored > conceded:
        row.wins += 1
    elif scored < conceded:
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
) -> list[Group]:
    """
    Distribute *players* as evenly as possible across *num_groups* groups.
    """
    if shuffle:
        players = list(players)
        random.shuffle(players)

    groups: list[Group] = []
    base_size = len(players) // num_groups
    remainder = len(players) % num_groups

    idx = 0
    for g in range(num_groups):
        size = base_size + (1 if g < remainder else 0)
        group_name = chr(ord("A") + g)
        groups.append(Group(name=group_name, players=players[idx : idx + size], team_mode=team_mode))
        idx += size

    return groups


def _match_player_ids(m: Match) -> set[str]:
    """Return all player IDs participating in a match."""
    return {p.id for p in m.team1 + m.team2}


def assign_courts(matches: list[Match], courts: list[Court]) -> list[Match]:
    """
    Assign courts to unassigned matches, distributing them across time slots.

    Algorithm
    ---------
    Build a pool of unassigned matches.  For each slot, cycle through courts
    (rotated by *slot index* so the starting court advances each slot) and
    for each court:

    1. Collect candidate matches whose players are all free this slot.
    2. Prefer matches whose players were NOT in the previous slot (rest).
    3. Pick a random candidate and assign it.

    If no candidate fits any court in a slot, the court stays empty.
    If an entire slot produces zero assignments but the pool is non-empty,
    remaining matches are force-assigned one per slot to guarantee termination.

    Each assigned match gets ``slot_number`` set to its 0-based slot index.
    Matches that already have a court are left untouched.
    """
    if not courts:
        return matches

    pool: list[Match] = [m for m in matches if m.court is None and m.team1 and m.team2]
    if not pool:
        return matches

    n_courts = len(courts)
    previous_slot_players: set[str] = set()
    current_slot = 0

    while pool:
        slot_busy: set[str] = set()
        assigned_any = False

        for i in range(n_courts):
            court = courts[(current_slot + i) % n_courts]

            candidates = [m for m in pool if not (_match_player_ids(m) & slot_busy)]
            if not candidates:
                continue

            preferred = [m for m in candidates if not (_match_player_ids(m) & previous_slot_players)]
            chosen = random.choice(preferred if preferred else candidates)

            chosen.court = court
            chosen.slot_number = current_slot
            slot_busy |= _match_player_ids(chosen)
            pool.remove(chosen)
            assigned_any = True

        if not assigned_any:
            # Safety: every remaining match conflicts — force-assign one per slot.
            court_cycle = itertools.cycle(courts)
            for m in pool:
                m.court = next(court_cycle)
                m.slot_number = current_slot
                current_slot += 1
            pool.clear()
            break

        previous_slot_players = slot_busy
        current_slot += 1

    return matches
