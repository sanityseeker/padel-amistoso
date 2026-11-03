"""
Standalone play-off tournament.

Skips any group or Mexicano stage and starts directly with the bracket.
Each participant name becomes a single bracket entry (team of one entry).
"""

from __future__ import annotations

from ..models import Court, Match, MatchStatus, POPhase, Player
from .playoff import (
    DoubleEliminationBracket,
    EspejoParallelBracket,
    SingleEliminationBracket,
    bracket_matches,
    validate_num_winners,
)


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
        espejo: bool = False,
        team_mode: bool = True,
        initial_strength: dict[str, float] | None = None,
        num_winners: int = 1,
        third_place: bool = False,
    ):
        # Multi-winner only exists for plain single elimination; third place
        # is allowed for single elimination and Espejo (winners bracket).
        if num_winners != 1 and (double_elimination or espejo):
            raise ValueError("Multiple winners are only supported for single-elimination brackets")
        if third_place and double_elimination and not espejo:
            raise ValueError("A 3rd-place match is not supported for double elimination")
        if num_winners != 1 or third_place:
            validate_num_winners(len(teams), num_winners, third_place)
        self.num_winners = num_winners
        self.third_place = third_place
        self.original_teams = list(teams)
        self.courts = courts or []
        self.double_elimination = double_elimination
        self.espejo = espejo
        self.team_mode = team_mode
        self.initial_strength = initial_strength

        # Sort teams by combined initial strength for proper seeding.
        if initial_strength:
            teams = sorted(
                teams,
                key=lambda t: sum(initial_strength.get(p.id, 0.0) for p in t),
                reverse=True,
            )
            self.original_teams = list(teams)

        # Never pass courts to the bracket — PlayoffTournament owns all
        # court assignment so the bracket never internally pre-assigns anything.
        if espejo:
            self.bracket: SingleEliminationBracket | DoubleEliminationBracket | EspejoParallelBracket = (
                EspejoParallelBracket(teams, third_place=third_place)
            )
        elif double_elimination:
            self.bracket = DoubleEliminationBracket(teams)
        else:
            self.bracket = SingleEliminationBracket(teams, num_winners=num_winners, third_place=third_place)

        self._assign_courts_greedily()

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    @property
    def phase(self) -> POPhase:
        return POPhase.FINISHED if self.winners() is not None else POPhase.PLAYOFFS

    def all_matches(self) -> list[Match]:
        """Return all bracket matches (including future TBD matches)."""
        return bracket_matches(self.bracket)

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

    def winners(self) -> list[list[Player]] | None:
        """All (equal) winners once the whole tournament is complete, else ``None``."""
        if isinstance(self.bracket, SingleEliminationBracket):
            return self.bracket.winners()
        champ = self.bracket.champion()
        return [champ] if champ else None

    def champion(self) -> list[Player] | None:
        """Return the single winning team once the whole tournament is complete, else ``None``.

        For Espejo this is the Winners-Bracket champion, but only after the
        consolation (Losers) bracket has been decided too.  With several
        winners (or a pending 3rd-place match) this stays ``None`` until the
        whole tournament is decided, and is always ``None`` for ``num_winners > 1``.
        """
        if isinstance(self.bracket, SingleEliminationBracket):
            w = self.bracket.winners()
            return w[0] if w and len(w) == 1 else None
        return self.bracket.champion()

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #

    def update_courts(self, courts: list[Court]) -> None:
        """Replace the court list and reassign courts across all pending bracket matches."""
        self.courts = list(courts)
        all_matches = self.all_matches()
        for m in all_matches:
            if m.status != MatchStatus.COMPLETED:
                m.court = None
        self._assign_courts_greedily()

    def _assign_courts_greedily(self) -> None:
        """Assign free courts to ready matches that don't have one yet."""
        if not self.courts:
            return

        all_matches = self.all_matches()

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
