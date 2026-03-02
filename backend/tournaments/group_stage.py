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
                row = table[p.id]
                row.played += 1
                row.points_for += s1
                row.points_against += s2
                if s1 > s2:
                    row.wins += 1
                elif s1 < s2:
                    row.losses += 1
                else:
                    row.draws += 1

            for p in m.team2:
                row = table[p.id]
                row.played += 1
                row.points_for += s2
                row.points_against += s1
                if s2 > s1:
                    row.wins += 1
                elif s2 < s1:
                    row.losses += 1
                else:
                    row.draws += 1

        standings = sorted(table.values(), key=lambda r: r.sort_key(), reverse=True)
        self._standings_cache = standings
        return standings

    def top_players(self, n: int) -> list[Player]:
        """Return the top *n* players by standings."""
        st = self.standings()
        return [row.player for row in st[:n]]


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
    Assign courts while balancing participant exposure across all courts.

    Matches that already have a court are left untouched (their assignment
    is tracked for balance calculations).  Matches where either team is
    still TBD (empty roster) are skipped entirely — courts are assigned
    lazily once both teams are known.

    Greedy objective per match, per candidate court:
      1) Minimise the maximum "times this participant has already played on
         this court" among all participants in the match.
      2) Minimise the total such count across participants in the match.
      3) Minimise total court load to keep usage balanced.
      4) Stable tie-break by court order.
    """
    if not courts:
        return matches

    participant_court_count: dict[str, dict[str, int]] = {}
    court_load: dict[str, int] = {c.name: 0 for c in courts}

    for m in matches:
        # Skip matches where teams are not yet determined (TBD)
        if not m.team1 or not m.team2:
            continue

        participants = m.team1 + m.team2

        # Respect existing court assignments — just update tracking
        if m.court is not None:
            c_name = m.court.name
            court_load[c_name] = court_load.get(c_name, 0) + 1
            for p in participants:
                per_court = participant_court_count.setdefault(p.id, {})
                per_court[c_name] = per_court.get(c_name, 0) + 1
            continue

        best_idx = 0
        best_score: tuple[int, int, int, int] | None = None

        for ci, court in enumerate(courts):
            c_name = court.name
            counts = [
                participant_court_count.get(p.id, {}).get(c_name, 0)
                for p in participants
            ]
            score = (
                max(counts) if counts else 0,
                sum(counts),
                court_load[c_name],
                ci,
            )
            if best_score is None or score < best_score:
                best_score = score
                best_idx = ci

        chosen = courts[best_idx]
        m.court = chosen
        court_load[chosen.name] += 1
        for p in participants:
            per_court = participant_court_count.setdefault(p.id, {})
            per_court[chosen.name] = per_court.get(chosen.name, 0) + 1

    return matches
