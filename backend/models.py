"""
Core data models for the tournament system.

All tournament types share these building blocks.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import StrEnum

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
    third_set_losses: int = 0
    points_for: int = 0
    points_against: int = 0

    @property
    def match_points(self) -> int:
        """3 pts for win, 1 for draw or 3rd-set loss, 0 for regular loss."""
        return self.wins * 3 + self.draws * 1 + self.third_set_losses * 1

    @property
    def point_diff(self) -> int:
        return self.points_for - self.points_against

    def sort_key(self) -> tuple[int, int, int]:
        """Higher is better."""
        return (self.match_points, self.point_diff, self.points_for)
