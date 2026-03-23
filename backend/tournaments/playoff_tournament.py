"""
Standalone play-off tournament.

Skips any group or Mexicano stage and starts directly with the bracket.
Each participant name becomes a single bracket entry (team of one entry).
"""

from __future__ import annotations

from ..models import Court, Match, MatchStatus, POPhase, Player
from .playoff import DoubleEliminationBracket, SingleEliminationBracket


class PlayoffTournament:
    """Tournament that begins immediately in the play-off bracket.

    Parameters
    ----------
    teams:
        Ordered list of teams, each team being a ``list[Player]``.
        Index 0 is the top seed.
    courts:
        Courts to assign to matches.
    double_elimination:
        Use a double-elimination bracket instead of single.
    team_mode:
        Cosmetic flag — *True* when each entry represents a pre-formed pair
        (e.g. "Alice & Bob"), *False* for individual players.  Does not
        affect bracket logic.
    """

    def __init__(
        self,
        teams: list[list[Player]],
        courts: list[Court] | None = None,
        double_elimination: bool = False,
        team_mode: bool = True,
    ):
        self.original_teams = list(teams)
        self.courts = courts or []
        self.double_elimination = double_elimination
        self.team_mode = team_mode

        # Never pass courts to the bracket — PlayoffTournament owns all
        # court assignment so the bracket never internally pre-assigns anything.
        if double_elimination:
            self.bracket: SingleEliminationBracket | DoubleEliminationBracket = DoubleEliminationBracket(teams)
        else:
            self.bracket = SingleEliminationBracket(teams)

        self._assign_courts_greedily()

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    @property
    def phase(self) -> POPhase:
        return POPhase.FINISHED if self.champion() is not None else POPhase.PLAYOFFS

    def all_matches(self) -> list[Match]:
        """Return all bracket matches (including future TBD matches)."""
        if self.double_elimination:
            return self.bracket.all_matches  # type: ignore[return-value]
        return list(self.bracket.matches)

    def pending_matches(self) -> list[Match]:
        """Return matches that are ready to be played (both teams known, not yet completed)."""
        return self.bracket.pending_matches()

    def record_result(
        self,
        match_id: str,
        score: tuple[int, int],
        sets: list[tuple[int, int]] | None = None,
    ) -> None:
        """Record the result of a bracket match."""
        self.bracket.record_result(match_id, score, sets=sets)
        # The completed match frees its court; new matches may have unlocked.
        # Greedily fill every free court with an unassigned ready match.
        self._assign_courts_greedily()

    def champion(self) -> list[Player] | None:
        """Return the winning team once the bracket is complete, else ``None``."""
        return self.bracket.champion()

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def _assign_courts_greedily(self) -> None:
        """Assign free courts to ready matches that don't have one yet.

        A court is *free* if it is not currently assigned to an active
        (not-yet-completed) match.  Called after construction and after
        every recorded result so every court stays occupied as long as
        there are matches waiting.
        """
        if not self.courts:
            return

        all_matches = self.bracket.all_matches if self.double_elimination else list(self.bracket.matches)

        occupied_court_ids: set[str] = {
            m.court.id for m in all_matches if m.court is not None and m.status != MatchStatus.COMPLETED
        }

        free_courts = [c for c in self.courts if c.id not in occupied_court_ids]
        if not free_courts:
            return

        needs_court = [
            m for m in all_matches if m.court is None and m.team1 and m.team2 and m.status != MatchStatus.COMPLETED
        ]

        for court, match in zip(free_courts, needs_court):
            match.court = court
