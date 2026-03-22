"""
Standalone play-off tournament.

Skips any group or Mexicano stage and starts directly with the bracket.
Each participant name becomes a single bracket entry (team of one entry).
"""

from __future__ import annotations

from ..models import Court, Match, POPhase, Player
from .group_stage import assign_courts
from .playoff import DoubleEliminationBracket, SingleEliminationBracket


class PlayoffTournament:
    """Tournament that begins immediately in the play-off bracket.

    Parameters
    ----------
    teams:
        Ordered list of teams, each team being a ``list[Player]``.
        Index 0 is the top seed.
    courts:
        Courts to assign to initial matches.
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

        if double_elimination:
            self.bracket: SingleEliminationBracket | DoubleEliminationBracket = (
                DoubleEliminationBracket(teams, courts=self.courts)
            )
        else:
            self.bracket = SingleEliminationBracket(teams)
            if self.courts:
                assign_courts(self.bracket.matches, self.courts)

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
        # Lazily assign courts to any match that just became playable
        if self.courts:
            all_matches = self.bracket.all_matches if self.double_elimination else list(self.bracket.matches)
            assign_courts(all_matches, self.courts)

    def champion(self) -> list[Player] | None:
        """Return the winning team once the bracket is complete, else ``None``."""
        return self.bracket.champion()
