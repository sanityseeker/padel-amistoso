"""
Core data models for the tournament system.

All tournament types share these building blocks.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class MatchStatus(StrEnum):
    SCHEDULED = "scheduled"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class Sport(StrEnum):
    PADEL = "padel"
    TENNIS = "tennis"


class TournamentType(StrEnum):
    GROUP_PLAYOFF = "group_playoff"
    MEXICANO = "mexicano"
    PLAYOFF = "playoff"


class GPPhase(StrEnum):
    """Phases of a Group+Playoff tournament."""

    SETUP = "setup"
    GROUPS = "groups"
    PLAYOFFS = "playoffs"
    FINISHED = "finished"


class MexPhase(StrEnum):
    """Phases of a Mexicano tournament."""

    MEXICANO = "mexicano"
    PLAYOFFS = "playoffs"
    FINISHED = "finished"


class POPhase(StrEnum):
    """Phases of a standalone Play-off tournament."""

    PLAYOFFS = "playoffs"
    FINISHED = "finished"


class EliminationType(StrEnum):
    SINGLE = "single"
    DOUBLE = "double"


class ScoreMode(StrEnum):
    # Note: ``TENNIS`` is stored as ``"sets"`` in ``tv_settings.score_mode`` and
    # on the frontend.  Per-match overrides use ``InputFormat`` (``"sets"``) so
    # they compare directly against the stored global without translation.
    POINTS = "points"
    TENNIS = "tennis"


class InputFormat(StrEnum):
    """Score input format; values match ``tv_settings.score_mode``."""

    POINTS = "points"
    SETS = "sets"


class SetDecider(StrEnum):
    """How a deciding third set is played.

    ``MATCH_TIEBREAK`` (super tie-break to 10, win by 2, entered in the
    third-set boxes) counts as one game wherever games are summed — see
    ``backend/tournaments/set_format.py``.
    """

    FULL_SET = "full_set"
    MATCH_TIEBREAK = "match_tiebreak"


class ScoreConfirmation(StrEnum):
    IMMEDIATE = "immediate"
    REQUIRED = "required"


class EntityType(StrEnum):
    TOURNAMENT = "tournament"
    REGISTRATION = "registration"


class ParticipationStatus(StrEnum):
    ACTIVE = "active"
    FINISHED = "finished"


class TokenType(StrEnum):
    PLAYER = "player"
    PROFILE = "profile"
    PROFILE_EMAIL_VERIFY = "profile_email_verify"


class DisputeChoice(StrEnum):
    ORIGINAL = "original"
    CORRECTION = "correction"
    CUSTOM = "custom"


class QuestionType(StrEnum):
    TEXT = "text"
    CHOICE = "choice"
    MULTICHOICE = "multichoice"
    NUMBER = "number"


class SitOutStrategy(StrEnum):
    SEEDED = "seeded"
    BALANCED = "balanced"


class BracketNodeKind(StrEnum):
    CHAMPION = "champion"
    ADVANCE = "advance"
    BYE = "bye"
    GROUP = "group"
    MATCH = "match"
    WINNERS_MATCH = "winners_match"
    LOSERS_MATCH = "losers_match"
    LOSERS_BLOCK = "losers_block"
    GRAND_FINAL = "grand_final"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class Player:
    name: str
    id: str = field(default="")

    def __post_init__(self) -> None:
        if not self.id:
            self.id = uuid.uuid4().hex[:8]

    def __hash__(self) -> int:
        return hash(self.id)

    def __eq__(self, other: object) -> bool:
        if isinstance(other, Player):
            return self.id == other.id
        return NotImplemented


@dataclass
class Court:
    name: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])


@dataclass
class MatchFormatOverride:
    """Organiser-set scoring format for one match.

    Every field is optional; ``None`` means "inherit the tournament setting".
    An override with every format field ``None`` is never stored: the match's
    ``format_override`` is set to ``None`` instead.
    """

    # Input mode (points / sets).  ``None`` = inherit the stage's score mode.
    mode: InputFormat | None = None
    # Points per match for Mexicano round matches.  ``None`` = tournament total.
    points_target: int | None = None
    # Third-set decider.  ``None`` = inherit ``tv_settings.set_decider``.
    decider: SetDecider | None = None
    # Audit only; never serialised to public payloads.
    set_by: str | None = None
    set_at: float | None = None

    def is_empty(self) -> bool:
        """Return True when no format field is set."""
        return self.mode is None and self.points_target is None and self.decider is None

    def __getstate__(self) -> dict:
        return self.__dict__.copy()

    def __setstate__(self, state: dict) -> None:
        state.setdefault("mode", None)
        state.setdefault("points_target", None)
        state.setdefault("decider", None)
        state.setdefault("set_by", None)
        state.setdefault("set_at", None)
        self.__dict__.update(state)


@dataclass
class Match:
    """
    A single padel match between two teams (each team = 2 players).

    team1 / team2 are lists of Player (length 2 for padel).
    score is stored as a tuple (team1_score, team2_score) once completed.
    """

    team1: list[Player]
    team2: list[Player]
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    court: Court | None = None
    status: MatchStatus = MatchStatus.SCHEDULED
    score: tuple[int, int] | None = None
    sets: list[tuple[int, int]] | None = None  # Tennis format: [(6,4),(3,6),(7,5)]
    # True when total games were tied and the 3rd set decided the winner.
    # In group stage standings the losing team receives 1 consolation match point.
    third_set_loss: bool = False
    # Index of the concurrent "time slot" this match belongs to (0-based).
    # Matches sharing the same slot_number are played simultaneously on different courts.
    slot_number: int = 0
    round_number: int = 0
    round_label: str = ""
    # Pair position within the round (0-based bracket index, including bye slots).
    # Set by playoff bracket generators; -1 means "not a bracket match".
    pair_index: int = -1
    # Optional admin comment shown to players alongside the match.
    comment: str = ""

    # ── Score lifecycle fields ──────────────────────────────────────────────
    # Set when a *player* submits a score; None when an admin/organiser records.
    scored_by: str | None = None
    # Unix timestamp (float) of when the score was first submitted.
    scored_at: float | None = None
    # True once the score is accepted by the opposing team, auto-finalised after
    # the undo window, or recorded directly by an admin/organiser.
    score_confirmed: bool = False
    # True when the opposing team has submitted a correction that differs from
    # the original score.  Cleared once an admin resolves the dispute.
    disputed: bool = False
    # The score proposed by the opposing team as a correction.
    dispute_score: tuple[int, int] | None = None
    # The sets proposed by the opposing team (tennis mode).
    dispute_sets: list[tuple[int, int]] | None = None
    # Player ID of the person who submitted the correction.
    dispute_by: str | None = None
    # Unix timestamp of when the correction was submitted.
    dispute_at: float | None = None
    # True when the original submitter has explicitly rejected the correction
    # and wants the organiser/admin to decide.  While False, the original
    # submitter can still accept the correction themselves.
    dispute_escalated: bool = False
    # True when a player submitted a score in a different input format than
    # the one the organiser set for this match.  The score is parked in
    # ``review_score`` / ``review_sets`` (not applied to the engine) until an
    # organiser approves or rejects it.
    format_review: bool = False
    review_score: tuple[int, int] | None = None
    review_sets: list[tuple[int, int]] | None = None
    # Decider a parked set score was entered under (validated against it).
    review_decider: SetDecider | None = None
    # Append-only audit log; each entry is a plain dict with keys:
    # player_id, action, score, sets, timestamp.
    score_history: list[dict[str, Any]] = field(default_factory=list)
    # Organiser-set per-match scoring format; ``None`` = tournament defaults.
    format_override: MatchFormatOverride | None = None
    # Decider the stored set score was recorded under (stamped by the API from
    # ``format_override.decider`` or the tournament setting at record time).
    # ``None`` for points scores and for legacy set scores (= full set).
    decider: SetDecider | None = None

    def __getstate__(self) -> dict:
        return self.__dict__.copy()

    def __setstate__(self, state: dict) -> None:
        # Provide safe defaults for score lifecycle fields missing in old pickles.
        state.setdefault("scored_by", None)
        state.setdefault("scored_at", None)
        state.setdefault("score_confirmed", False)
        state.setdefault("disputed", False)
        state.setdefault("dispute_score", None)
        state.setdefault("dispute_sets", None)
        state.setdefault("dispute_by", None)
        state.setdefault("dispute_at", None)
        state.setdefault("dispute_escalated", False)
        state.setdefault("format_review", False)
        state.setdefault("review_score", None)
        state.setdefault("review_sets", None)
        state.setdefault("review_decider", None)
        state.setdefault("score_history", [])
        state.setdefault("format_override", None)
        state.setdefault("decider", None)
        self.__dict__.update(state)

    @property
    def winner_team(self) -> list[Player] | None:
        if self.score is None:
            return None
        if self.score[0] > self.score[1]:
            return self.team1
        elif self.score[1] > self.score[0]:
            return self.team2
        return None  # draw

    @property
    def loser_team(self) -> list[Player] | None:
        if self.score is None:
            return None
        if self.score[0] > self.score[1]:
            return self.team2
        elif self.score[1] > self.score[0]:
            return self.team1
        return None


@dataclass
class GroupStanding:
    """Row in a group table."""

    player: Player
    played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    sets_won: int = 0
    sets_lost: int = 0
    points_for: int = 0
    points_against: int = 0

    @property
    def sets_diff(self) -> int:
        return self.sets_won - self.sets_lost

    @property
    def point_diff(self) -> int:
        return self.points_for - self.points_against

    def sort_key(self, *, uses_sets: bool = False) -> tuple[int, ...]:
        """Higher is better.

        When *uses_sets* is ``True`` (sets scoring detected), the sort order is:
        wins → sets difference → games difference → games scored.

        Otherwise (points scoring): wins → score difference → score total.
        """
        if uses_sets:
            return (self.wins, self.sets_diff, self.point_diff, self.points_for)
        return (self.wins, self.point_diff, self.points_for)

    # -- Pickle compatibility for tournaments serialised before this change --

    def __getstate__(self) -> dict:
        return self.__dict__.copy()

    def __setstate__(self, state: dict) -> None:
        # Drop removed fields from old pickles.
        state.pop("third_set_losses", None)
        state.pop("match_points", None)
        # Add new fields missing in old pickles.
        state.setdefault("sets_won", 0)
        state.setdefault("sets_lost", 0)
        self.__dict__.update(state)


def reset_match_result(m: Match) -> None:
    """Return *m* to the unplayed state.

    Clears the score, sets and every score-lifecycle / review field, and sets the
    status to SCHEDULED.  Keeps the comment, format override, court and
    ``score_history`` (the audit log).
    """
    m.score = None
    m.sets = None
    m.third_set_loss = False
    m.decider = None
    m.status = MatchStatus.SCHEDULED
    m.scored_by = None
    m.scored_at = None
    m.score_confirmed = False
    m.disputed = False
    m.dispute_score = None
    m.dispute_sets = None
    m.dispute_by = None
    m.dispute_at = None
    m.dispute_escalated = False
    m.format_review = False
    m.review_score = None
    m.review_sets = None
    m.review_decider = None
