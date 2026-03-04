"""
Pydantic request / response schemas for the REST API.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


class CreateGroupPlayoffRequest(BaseModel):
    name: str = "My Tournament"
    player_names: list[str]
    team_mode: bool = False
    court_names: list[str] = ["Court 1"]
    num_groups: int = Field(default=2, ge=1)
    top_per_group: int = Field(default=2, ge=1)
    double_elimination: bool = False

    @field_validator("player_names")
    @classmethod
    def at_least_two_players(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 players")
        return v

    @field_validator("court_names")
    @classmethod
    def at_least_one_court(cls, v: list[str]) -> list[str]:
        if len(v) < 1:
            raise ValueError("Need at least 1 court")
        return v


class CreateMexicanoRequest(BaseModel):
    name: str = "My Mexicano"
    player_names: list[str]
    court_names: list[str] = ["Court 1"]
    team_mode: bool = False
    total_points_per_match: int = Field(default=32, ge=1)
    num_rounds: int = Field(default=8, ge=0)
    skill_gap: int | None = Field(default=None, ge=0)
    win_bonus: int = Field(default=0, ge=0)
    strength_weight: float = Field(default=0.0, ge=0.0, le=1.0)
    loss_discount: float = Field(default=1.0, ge=0.0, le=1.0)
    balance_tolerance: float = Field(default=0.2, ge=0.0)

    @field_validator("player_names")
    @classmethod
    def at_least_two_players(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 entries for Mexicano format")
        return v

    @model_validator(mode="after")
    def validate_player_count_for_mode(self) -> "CreateMexicanoRequest":
        if not self.team_mode and len(self.player_names) < 4:
            raise ValueError("Need at least 4 players for Mexicano format (or enable team mode)")
        return self

    @field_validator("court_names")
    @classmethod
    def at_least_one_court(cls, v: list[str]) -> list[str]:
        if len(v) < 1:
            raise ValueError("Need at least 1 court")
        return v


class TvSettingsRequest(BaseModel):
    """Partial update for TV display settings."""

    show_courts: bool | None = None
    show_past_matches: bool | None = None
    show_score_breakdown: bool | None = None
    show_standings: bool | None = None
    show_bracket: bool | None = None
    refresh_interval: int | None = Field(default=None, ge=-1, le=300)
    schema_box_scale: float | None = Field(default=None, ge=0.3, le=3.0)
    schema_line_width: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_arrow_scale: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_title_font_scale: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_output_scale: float | None = Field(default=None, ge=0.5, le=3.0)


class SetAliasRequest(BaseModel):
    """Set a human-friendly alias for a tournament (used in TV URLs)."""

    alias: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")


class RecordScoreRequest(BaseModel):
    match_id: str
    score1: int = Field(ge=0)
    score2: int = Field(ge=0)


class RecordTennisScoreRequest(BaseModel):
    """Record a match result using tennis-style set scores."""

    match_id: str
    sets: list[list[int]]  # e.g. [[6,4],[3,6],[7,5]]

    @field_validator("sets")
    @classmethod
    def validate_sets(cls, v: list[list[int]]) -> list[list[int]]:
        if len(v) == 0:
            raise ValueError("Must provide at least one set")
        for i, s in enumerate(v):
            if len(s) != 2:
                raise ValueError(f"Set {i + 1} must have exactly 2 scores")
            if s[0] < 0 or s[1] < 0:
                raise ValueError(f"Set {i + 1} scores must be non-negative")
        return v


class NextRoundRequest(BaseModel):
    option_id: str | None = None


class CustomMatchSpec(BaseModel):
    team1_ids: list[str] = Field(min_length=2, max_length=2)
    team2_ids: list[str] = Field(min_length=2, max_length=2)


class CustomRoundRequest(BaseModel):
    matches: list[CustomMatchSpec]
    sit_out_ids: list[str] | None = None


class ExternalParticipant(BaseModel):
    """An external participant added to play-offs with an optional seed score."""

    name: str
    score: int = 0
    placeholder_id: str | None = None


class StartMexicanoPlayoffsRequest(BaseModel):
    team_player_ids: list[str] | None = None
    n_teams: int = Field(default=4, ge=2)
    double_elimination: bool = False
    extra_participants: list[ExternalParticipant] | None = None


class StartGroupPlayoffsRequest(BaseModel):
    advancing_player_ids: list[str] | None = None
    extra_participants: list[ExternalParticipant] | None = None
    double_elimination: bool | None = None


class SchemaPreviewRequest(BaseModel):
    group_sizes: list[int]
    advance_per_group: int = Field(default=2, ge=1)
    elimination: Literal["single", "double"] = "single"
    title: str | None = None
    box_scale: float = Field(default=1.0, ge=0.3, le=3.0)
    line_width: float = Field(default=1.0, ge=0.3, le=5.0)
    arrow_scale: float = Field(default=1.0, ge=0.3, le=5.0)
    title_font_scale: float = Field(default=1.0, ge=0.3, le=5.0)
    output_scale: float = Field(default=1.0, ge=0.5, le=3.0)

    @field_validator("group_sizes")
    @classmethod
    def validate_group_sizes(cls, v: list[int]) -> list[int]:
        if not v:
            raise ValueError("Need at least one group")
        if any(s < 2 for s in v):
            raise ValueError("Each group must have at least 2 players")
        return v
