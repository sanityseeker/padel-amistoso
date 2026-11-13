"""
Standalone play-off tournament.

Skips any group or Mexicano stage and starts directly with the bracket.
Each participant name becomes a single bracket entry (team of one entry).
"""

from __future__ import annotations

import time

from ..models import Court, Match, POPhase, Player
from . import live_courts
from . import withdrawal as wd
from .court_preferences import CourtPlan, clean_preferences, espejo_scope_of
from .errors import MatchClearBlocked, WithdrawalBlocked
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
    bracket_courts:
        Espejo only: preferred court names per side (``"winners"`` /
        ``"losers"``).
    """

    # Class default covers older pickles; always replace, never mutate.
    bracket_courts: dict[str, list[str]] = {}

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
        bracket_courts: dict[str, list[str]] | None = None,
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
        self.bracket_courts = clean_preferences(bracket_courts, self.courts)
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
        # Withdrawals (bracket forfeits) by entry key, in the order they happened.
        self.withdrawals: dict[str, wd.WithdrawalRecord] = {}

    def __getstate__(self) -> dict:
        return self.__dict__.copy()

    def __setstate__(self, state: dict) -> None:
        # Tournaments pickled before withdrawals existed.
        state.setdefault("withdrawals", {})
        self.__dict__.update(state)

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
        """Record the result of a bracket match (then any walkovers it makes due)."""
        m = wd.bracket_match(self.bracket, match_id)
        if m is not None and m.walkover:
            raise ValueError("This result is a walkover and cannot be edited")
        unwind = m is not None and wd.has_forfeits(self.withdrawals) and wd.winner_changes(m, score)
        snapshot = wd.snapshot_bracket(self.bracket) if unwind else None
        try:
            if unwind:
                wd.forget_walkovers(self.withdrawals, wd.unwind_downstream_walkovers(self.bracket, match_id))
            self.bracket.record_result(match_id, score, sets=sets)
        except Exception:
            if snapshot is not None:
                self.bracket = snapshot
            raise
        self.resolve_forfeits()

    def resolve_forfeits(self) -> list[Match]:
        """Create the walkovers owed by withdrawn entries, then fill free courts."""
        created = wd.resolve_bracket_forfeits(self.bracket, self.withdrawals)
        # The completed match frees its court; new matches may have unlocked.
        # Greedily fill every free court with an unassigned ready match.
        self._assign_courts_greedily()
        return created

    def clear_result(self, match_id: str) -> None:
        """Revert a bracket match to unplayed (refused once the tournament is finished)."""
        if self.phase == POPhase.FINISHED:
            raise MatchClearBlocked("Finished tournaments cannot be reopened; edit the score instead")
        m = wd.bracket_match(self.bracket, match_id)
        if m is not None and m.walkover:
            raise MatchClearBlocked("This result is a walkover; clear the match that fed it instead")
        if m is not None:
            # It goes back to the queue; its old court may be in use by now.
            m.court = None
            m.on_court = False
        if wd.has_forfeits(self.withdrawals):
            snapshot = wd.snapshot_bracket(self.bracket)
            try:
                wd.forget_walkovers(self.withdrawals, wd.unwind_downstream_walkovers(self.bracket, match_id))
                self.bracket.clear_result(match_id)
            except Exception:
                self.bracket = snapshot
                raise
            self.resolve_forfeits()
            return
        self.bracket.clear_result(match_id)
        self._assign_courts_greedily()

    # ------------------------------------------------------------------ #
    # Withdrawals (bracket forfeit only)
    # ------------------------------------------------------------------ #

    def withdrawal_record_for(self, person_id: str) -> wd.WithdrawalRecord | None:
        """The withdrawal covering *person_id*, if any."""
        return next((r for r in self.withdrawals.values() if person_id in r.member_ids), None)

    def plan_withdrawal(self, person_id: str) -> wd.WithdrawalPlan:
        """Dry run of :meth:`withdraw`."""
        if self.phase == POPhase.FINISHED:
            raise WithdrawalBlocked("The tournament is finished")
        if self.withdrawal_record_for(person_id) is not None:
            raise WithdrawalBlocked("This participant has already withdrawn")
        team = wd.find_bracket_entry(self.bracket, person_id)
        if team is None:
            raise KeyError(f"Player {person_id} not found in tournament")
        return wd.plan_bracket_forfeit(self.bracket, team, self.withdrawals)

    def withdraw(
        self,
        person_id: str,
        *,
        template: wd.WalkoverTemplate | None = None,
        expected_kind: wd.WithdrawalKind | None = None,
        by: str | None = None,
        at: float | None = None,
    ) -> tuple[wd.WithdrawalRecord, list[Match]]:
        """Forfeit the entry of *person_id*: its bracket matches become walkovers."""
        at = time.time() if at is None else at
        plan = self.plan_withdrawal(person_id)
        if expected_kind is not None and plan.kind != expected_kind:
            raise WithdrawalBlocked("The withdrawal outcome changed; review it again")
        if plan.blockers:
            raise WithdrawalBlocked("Settle the pending, disputed or under-review scores first")
        snapshot = wd.snapshot_bracket(self.bracket)
        try:
            record, created = wd.apply_bracket_forfeit(
                self.bracket,
                plan.entry,
                self.withdrawals,
                template,
                member_ids=wd.entry_member_ids(plan.entry),
                by=by,
                at=at,
            )
        except Exception:
            self.bracket = snapshot
            self.withdrawals.pop(plan.entry_key, None)
            raise
        self.resolve_forfeits()
        return record, created

    def undo_block_reason(self, entry_key: str) -> str | None:
        """Play-off forfeits are never undone."""
        return "Play-off withdrawals cannot be undone" if entry_key in self.withdrawals else "No such withdrawal"

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
        self.bracket_courts = clean_preferences(self.bracket_courts, self.courts)
        self._reassign_pending_courts()

    def set_court_preferences(self, bracket_courts: dict[str, list[str]] | None) -> None:
        """Replace the preferred courts per Espejo side and reassign pending matches."""
        self.bracket_courts = clean_preferences(bracket_courts, self.courts)
        self._reassign_pending_courts()

    def _reassign_pending_courts(self) -> None:
        matches = self.all_matches()
        live_courts.remap_courts(matches, self.courts)
        if live_courts.nothing_played(matches):
            # Nothing played yet: plan again from scratch (new courts / preferences).
            live_courts.clear_plan(matches)
        self._assign_courts_greedily()

    def _assign_courts_greedily(self) -> None:
        """Fill every free court with a ready match; waiting matches get no court yet.

        Matches on court keep it; among the waiting ones the most rested
        players go first (see ``live_courts``).
        """
        if not self.courts:
            return
        plan = CourtPlan(self.courts, self.bracket_courts, espejo_scope_of(self.bracket))
        live_courts.refill_courts(self.all_matches(), self.courts, plan)
