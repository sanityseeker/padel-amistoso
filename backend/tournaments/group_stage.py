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
        table: dict[str, GroupStanding] = {
            p.id: GroupStanding(player=p) for p in self.players
        }

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
        groups.append(
            Group(
                name=group_name, players=players[idx : idx + size], team_mode=team_mode
            )
        )
        idx += size

    return groups


def assign_courts(matches: list[Match], courts: list[Court]) -> list[Match]:
    """
    Assign courts greedily slot by slot, court by court.

    Algorithm
    ---------
    Maintain a pool of all unassigned matches.  For each time slot, iterate
    through courts in order:

    * Collect *candidates* — matches in the pool whose participants are not
      yet busy in this slot.
    * If no candidates exist for a court, leave it empty this slot.
    * Otherwise pick the candidate that best balances participant exposure on
      this specific court:
        a) Minimise the maximum number of times any participant has already
           played on *this* court.
        b) Minimise the total such count (secondary).
        c) Stable tie-break by original pool order (first in wins).
    * Assign the chosen match to the court, mark its participants as busy,
      remove it from the pool, and proceed to the next court.

    Move to the next slot once all courts have been visited; repeat until
    the pool is empty.

    Each assigned match gets ``slot_number`` set to its 0-based slot index.
    Courts skipped within a slot produce no match entry; the frontend uses
    ``slot_number`` to detect these gaps and renders them as "(empty)"
    placeholders.

    Matches that already have a court are absorbed into the balance-tracking
    state but otherwise left untouched.  Matches with an empty roster are
    skipped entirely.
    """
    if not courts:
        return matches

    participant_court_count: dict[str, dict[str, int]] = {}
    court_load: dict[str, int] = {c.name: 0 for c in courts}

    # Absorb already-assigned matches into tracking state.
    for m in matches:
        if not m.team1 or not m.team2 or m.court is None:
            continue
        c_name = m.court.name
        court_load[c_name] = court_load.get(c_name, 0) + 1
        for p in m.team1 + m.team2:
            per_court = participant_court_count.setdefault(p.id, {})
            per_court[c_name] = per_court.get(c_name, 0) + 1

    # Pool of unassigned matches with known teams (preserves input order).
    pool: list[Match] = [m for m in matches if m.court is None and m.team1 and m.team2]

    current_slot = 0
    while pool:
        slot_busy: set[str] = set()  # participant IDs committed this slot
        assigned_this_slot = False

        # Visit courts in ascending load order so that when only one match
        # can be assigned per slot (few players), the load spreads evenly.
        courts_this_slot = sorted(courts, key=lambda c: court_load[c.name])

        for court in courts_this_slot:
            # Candidates: pool matches whose players are all free this slot.
            candidates = [
                m for m in pool
                if not ({p.id for p in m.team1 + m.team2} & slot_busy)
            ]
            if not candidates:
                continue  # no valid match for this court — leave it empty

            # Pick the candidate that balances participant exposure on this court.
            # Among tied candidates, pick randomly to avoid group-ordering bias.
            c_name = court.name
            best_score: tuple[int, int] | None = None
            best_tied: list[Match] = []
            for m in candidates:
                participants = m.team1 + m.team2
                counts = [participant_court_count.get(p.id, {}).get(c_name, 0) for p in participants]
                score: tuple[int, int] = (max(counts, default=0), sum(counts))
                if best_score is None or score < best_score:
                    best_score = score
                    best_tied = [m]
                elif score == best_score:
                    best_tied.append(m)
            best_match = random.choice(best_tied)

            # Commit the assignment.
            best_match.court = court
            best_match.slot_number = current_slot
            pool = [m for m in pool if m is not best_match]
            participants = best_match.team1 + best_match.team2
            slot_busy |= {p.id for p in participants}
            court_load[c_name] += 1
            for p in participants:
                per_court = participant_court_count.setdefault(p.id, {})
                per_court[c_name] = per_court.get(c_name, 0) + 1
            assigned_this_slot = True

        if not assigned_this_slot:
            # Safety valve: every remaining match conflicts with every court
            # in this slot (circular dependency — should not occur with valid
            # round-robin input).  Force-assign to avoid an infinite loop.
            for m in pool:
                participants = m.team1 + m.team2
                best_court = courts[0]
                best_force_score: tuple[int, int, int] = (
                    max(
                        (participant_court_count.get(p.id, {}).get(courts[0].name, 0) for p in participants),
                        default=0,
                    ),
                    sum(participant_court_count.get(p.id, {}).get(courts[0].name, 0) for p in participants),
                    court_load[courts[0].name],
                )
                for court in courts[1:]:
                    c_name = court.name
                    counts = [participant_court_count.get(p.id, {}).get(c_name, 0) for p in participants]
                    force_score: tuple[int, int, int] = (max(counts, default=0), sum(counts), court_load[c_name])
                    if force_score < best_force_score:
                        best_force_score = force_score
                        best_court = court
                m.court = best_court
                m.slot_number = current_slot
                court_load[best_court.name] += 1
                for p in participants:
                    per_court = participant_court_count.setdefault(p.id, {})
                    per_court[best_court.name] = per_court.get(best_court.name, 0) + 1
                current_slot += 1
            break

        current_slot += 1

    return matches
