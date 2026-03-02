"""
Combined Group‑Stage → Play‑Off tournament.

Orchestrates:
  1. Group stage (round‑robin within groups)
  2. Play‑off bracket (single or double elimination)

Usage:
    t = GroupPlayoffTournament(players, num_groups=2, courts=courts,
                               top_per_group=2, double_elimination=False)
    t.generate()               # creates group matches
    t.record_group_result(...)  # record scores
    t.start_playoffs()          # auto‑seeds from group standings
    t.record_playoff_result(...)
"""

from __future__ import annotations

from ..models import Court, GPPhase, Match, MatchStatus, Player
from .group_stage import Group, assign_courts, distribute_players_to_groups
from .playoff import DoubleEliminationBracket, SingleEliminationBracket


class GroupPlayoffTournament:
    def __init__(
        self,
        players: list[Player],
        num_groups: int = 2,
        courts: list[Court] | None = None,
        top_per_group: int = 2,
        double_elimination: bool = False,
        team_mode: bool = False,
    ):
        self.players = list(players)
        self.num_groups = num_groups
        self.courts = courts or []
        self.top_per_group = top_per_group
        self.double_elimination = double_elimination
        self.team_mode = team_mode

        self.groups: list[Group] = []
        self.playoff_bracket: (
            SingleEliminationBracket | DoubleEliminationBracket | None
        ) = None

        self._phase: GPPhase = GPPhase.SETUP

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    @property
    def phase(self) -> GPPhase:
        return self._phase

    def generate(self):
        """Create groups and generate round‑robin matches."""
        self.groups = distribute_players_to_groups(
            self.players,
            self.num_groups,
            team_mode=self.team_mode,
        )
        for g in self.groups:
            g.generate_round_robin()
        if self.courts:
            self._assign_group_courts()
        self._phase = GPPhase.GROUPS

    def _assign_group_courts(self) -> None:
        """Assign courts across all group matches using the global greedy algorithm.

        All group-stage matches are pooled together and assigned via
        ``assign_courts``, which greedily fills every available court in each
        time slot while ensuring no participant plays two matches
        simultaneously and balancing court exposure across participants.
        """
        assign_courts(self.all_group_matches(), self.courts)

    def all_group_matches(self) -> list[Match]:
        matches: list[Match] = []
        for g in self.groups:
            matches.extend(g.matches)
        return matches

    def pending_group_matches(self) -> list[Match]:
        return [
            m for m in self.all_group_matches() if m.status != MatchStatus.COMPLETED
        ]

    def record_group_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
        third_set_loss: bool = False,
    ):
        for g in self.groups:
            for m in g.matches:
                if m.id == match_id:
                    m.score = score
                    m.sets = sets
                    m.third_set_loss = third_set_loss
                    m.status = MatchStatus.COMPLETED
                    return
        raise KeyError(f"Match {match_id} not found in any group")

    def group_standings(self) -> dict[str, list]:
        """Return standings per group as serialisable dicts."""
        result = {}
        for g in self.groups:
            standings = g.standings()
            result[g.name] = [
                {
                    "player": s.player.name,
                    "player_id": s.player.id,
                    "played": s.played,
                    "wins": s.wins,
                    "draws": s.draws,
                    "losses": s.losses,
                    "third_set_losses": s.third_set_losses,
                    "points_for": s.points_for,
                    "points_against": s.points_against,
                    "match_points": s.match_points,
                    "point_diff": s.point_diff,
                }
                for s in standings
            ]
        return result

    def start_playoffs(self):
        """Seed the play‑off bracket from group results."""
        if self._phase != GPPhase.GROUPS:
            raise RuntimeError("Must be in group phase to start play‑offs")
        if self.pending_group_matches():
            raise RuntimeError("All group matches must be completed first")

        # Collect top players from each group
        advancing: list[Player] = []
        for g in self.groups:
            advancing.extend(g.top_players(self.top_per_group))

        # Build teams of 2 for play‑offs from the advancing players
        # Simple approach: pair them up as seeded (best from each group together)
        # Or alternatively, each player forms a new pair — configurable later.
        # For now, each advancing player is treated as a "single‑player team"
        # wrapped in a list for API consistency.
        teams = [[p] for p in advancing]

        if self.double_elimination:
            self.playoff_bracket = DoubleEliminationBracket(teams, courts=self.courts)
        else:
            self.playoff_bracket = SingleEliminationBracket(teams)

        if self.courts:
            all_matches = (
                self.playoff_bracket.all_matches
                if isinstance(self.playoff_bracket, DoubleEliminationBracket)
                else self.playoff_bracket.matches
            )
            assign_courts(all_matches, self.courts)

        self._phase = GPPhase.PLAYOFFS

    def playoff_matches(self) -> list[Match]:
        if self.playoff_bracket is None:
            return []
        if isinstance(self.playoff_bracket, DoubleEliminationBracket):
            return self.playoff_bracket.all_matches
        return self.playoff_bracket.matches

    def pending_playoff_matches(self) -> list[Match]:
        if self.playoff_bracket is None:
            return []
        pending = self.playoff_bracket.pending_matches()
        # Lazy court assignment for matches that just became ready
        if self.courts:
            needs_court = [m for m in pending if m.court is None]
            if needs_court:
                assign_courts(needs_court, self.courts)
        return pending

    def record_playoff_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
    ):
        if self.playoff_bracket is None:
            raise RuntimeError("Play‑offs have not started")
        self.playoff_bracket.record_result(match_id, score, sets=sets)

        # Check for champion
        champ = self.playoff_bracket.champion()
        if champ is not None:
            self._phase = GPPhase.FINISHED

    def champion(self) -> list[Player] | None:
        if self.playoff_bracket is None:
            return None
        return self.playoff_bracket.champion()
