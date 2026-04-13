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
    POINTS = "points"
    TENNIS = "tennis"


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
    GF_RESET = "gf_reset"


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
    # Append-only audit log; each entry is a plain dict with keys:
    # player_id, action, score, sets, timestamp.
    score_history: list[dict[str, Any]] = field(default_factory=list)

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
        state.setdefault("score_history", [])
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
