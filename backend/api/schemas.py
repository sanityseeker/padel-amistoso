"""
Pydantic request / response schemas for the REST API.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from ..models import Sport


class CreateGroupPlayoffRequest(BaseModel):
    name: str = Field(default="My Tournament", max_length=255)
    player_names: list[str] = Field(min_length=2, max_length=256)
    team_mode: bool = False
    sport: Sport = Sport.PADEL
    court_names: list[str] = Field(default=["Court 1"], max_length=64)
    num_groups: int = Field(default=2, ge=1, le=32)
    group_names: list[str] = Field(default=[], max_length=32)
    top_per_group: int = Field(default=2, ge=1)
    double_elimination: bool = False
    public: bool = True
    assign_courts: bool = True

    @field_validator("player_names")
    @classmethod
    def at_least_two_players(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 players")
        if any(len(n.strip()) == 0 for n in v):
            raise ValueError("Player names must not be empty")
        return v

    @model_validator(mode="after")
    def validate_courts(self) -> "CreateGroupPlayoffRequest":
        if self.assign_courts and len(self.court_names) < 1:
            raise ValueError("Need at least 1 court when assign_courts is True")
        return self


class CreateMexicanoRequest(BaseModel):
    name: str = Field(default="My Mexicano", max_length=255)
    player_names: list[str] = Field(min_length=2, max_length=256)
    court_names: list[str] = Field(default=["Court 1"], max_length=64)
    team_mode: bool = False
    sport: Sport = Sport.PADEL
    total_points_per_match: int = Field(default=32, ge=1)
    num_rounds: int = Field(default=8, ge=0)
    skill_gap: int | None = Field(default=None, ge=0)
    win_bonus: int = Field(default=0, ge=0)
    strength_weight: float = Field(default=0.0, ge=0.0, le=1.0)
    loss_discount: float = Field(default=1.0, ge=0.0, le=1.0)
    balance_tolerance: float = Field(default=0.2, ge=0.0)
    public: bool = True
    assign_courts: bool = True

    @field_validator("player_names")
    @classmethod
    def at_least_two_players(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 entries for Mexicano format")
        if any(len(n.strip()) == 0 for n in v):
            raise ValueError("Player names must not be empty")
        return v

    @model_validator(mode="after")
    def validate_player_count_for_mode(self) -> "CreateMexicanoRequest":
        if not self.team_mode and len(self.player_names) < 4:
            raise ValueError("Need at least 4 players for Mexicano format (or enable team mode)")
        if self.assign_courts and len(self.court_names) < 1:
            raise ValueError("Need at least 1 court when assign_courts is True")
        return self


class CreatePlayoffRequest(BaseModel):
    name: str = Field(default="My Play-off", max_length=255)
    participant_names: list[str] = Field(min_length=2, max_length=256)
    court_names: list[str] = Field(default=["Court 1"], max_length=64)
    team_mode: bool = True
    sport: Sport = Sport.PADEL
    double_elimination: bool = False
    public: bool = True
    assign_courts: bool = True

    @field_validator("participant_names")
    @classmethod
    def at_least_two_participants(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 participants")
        if any(len(n.strip()) == 0 for n in v):
            raise ValueError("Participant names must not be empty")
        return v

    @model_validator(mode="after")
    def validate_courts(self) -> "CreatePlayoffRequest":
        if self.assign_courts and len(self.court_names) < 1:
            raise ValueError("Need at least 1 court when assign_courts is True")
        return self


class TvSettingsRequest(BaseModel):
    """Partial update for TV display settings."""

    show_courts: bool | None = None
    show_past_matches: bool | None = None
    show_score_breakdown: bool | None = None
    show_standings: bool | None = None
    show_bracket: bool | None = None
    show_pending_matches: bool | None = None
    allow_player_scoring: bool | None = None
    refresh_interval: int | None = Field(default=None, ge=-1, le=300)
    schema_box_scale: float | None = Field(default=None, ge=0.3, le=3.0)
    schema_line_width: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_arrow_scale: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_title_font_scale: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_output_scale: float | None = Field(default=None, ge=0.5, le=3.0)
    score_mode: dict[str, str] | None = None
    banner_text: str | None = None


class TvSettings(BaseModel):
    """Full TV display settings with defaults."""

    show_courts: bool = True
    show_past_matches: bool = True
    show_score_breakdown: bool = False
    show_standings: bool = True
    show_bracket: bool = True
    show_pending_matches: bool = False
    allow_player_scoring: bool = True
    refresh_interval: int = -1
    schema_box_scale: float = 1.0
    schema_line_width: float = 1.0
    schema_arrow_scale: float = 1.0
    schema_title_font_scale: float = 1.0
    schema_output_scale: float = 1.0
    score_mode: dict[str, str] = Field(default_factory=dict)
    banner_text: str = ""


class SetMatchCommentRequest(BaseModel):
    """Set or clear an optional admin comment on a pending match."""

    match_id: str
    comment: str = Field(default="", max_length=500)


class SetAliasRequest(BaseModel):
    """Set a human-friendly alias for a tournament (used in TV URLs)."""

    alias: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")


class SetPublicRequest(BaseModel):
    """Toggle whether a tournament is publicly listed for guests."""

    public: bool


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
        if len(v) > 5:
            raise ValueError("Cannot have more than 5 sets")
        for i, s in enumerate(v):
            if len(s) != 2:
                raise ValueError(f"Set {i + 1} must have exactly 2 scores")
            if s[0] < 0 or s[1] < 0:
                raise ValueError(f"Set {i + 1} scores must be non-negative")
            if s[0] == s[1]:
                raise ValueError(f"Set {i + 1} cannot be a tie ({s[0]}-{s[1]})")
        sets1 = sum(1 for s in v if s[0] > s[1])
        sets2 = sum(1 for s in v if s[1] > s[0])
        if sets1 == sets2:
            raise ValueError("Match must have a winner (equal sets won)")
        return v


class UpdateCourtsRequest(BaseModel):
    court_names: list[str] = Field(default_factory=list, max_length=64)


class NextRoundRequest(BaseModel):
    option_id: str | None = None


class CustomMatchSpec(BaseModel):
    team1_ids: list[str] = Field(min_length=2, max_length=2)
    team2_ids: list[str] = Field(min_length=2, max_length=2)


class CustomRoundRequest(BaseModel):
    matches: list[CustomMatchSpec] = Field(min_length=1, max_length=512)
    sit_out_ids: list[str] | None = Field(default=None, max_length=512)


class ExternalParticipant(BaseModel):
    """An external participant added to play-offs with an optional seed score."""

    name: str = Field(min_length=1, max_length=255)
    score: int = Field(default=0, ge=0)
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


# ────────────────────────────────────────────────────────────────────────────
# Registration lobby schemas
# ────────────────────────────────────────────────────────────────────────────


class QuestionDef(BaseModel):
    """A single question definition for a registration lobby."""

    key: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=128)
    type: Literal["text", "choice"] = "text"
    required: bool = False
    choices: list[str] = Field(default_factory=list)


class RegistrationCreate(BaseModel):
    """Create a new registration lobby."""

    name: str = Field(default="My Tournament", min_length=1, max_length=255)
    join_code: str | None = Field(default=None, max_length=64)
    questions: list[QuestionDef] = Field(default_factory=list)
    description: str | None = Field(default=None, max_length=5000)
    message: str | None = Field(default=None, max_length=5000)
    listed: bool = False
    sport: Sport = Sport.PADEL


class RegistrationUpdate(BaseModel):
    """Partial update for a registration lobby."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    open: bool | None = None
    join_code: str | None = Field(default=None, max_length=64)
    questions: list[QuestionDef] | None = None
    description: str | None = Field(default=None, max_length=5000)
    message: str | None = Field(default=None, max_length=5000)
    listed: bool | None = None
    sport: Sport | None = None
    clear_join_code: bool = False
    clear_description: bool = False
    clear_message: bool = False
    clear_answers_for_keys: list[str] = []


class RegistrantIn(BaseModel):
    """Player self-registration request."""

    player_name: str = Field(min_length=1, max_length=128)
    join_code: str | None = None
    answers: dict[str, str] = Field(default_factory=dict)


class RegistrantOut(BaseModel):
    """Public view of a registrant (no secrets)."""

    player_id: str
    player_name: str
    answers: dict[str, str] = Field(default_factory=dict)
    registered_at: str


class RegistrantAdminOut(BaseModel):
    """Admin view of a registrant (includes secrets)."""

    player_id: str
    player_name: str
    passphrase: str
    token: str
    answers: dict[str, str] = Field(default_factory=dict)
    registered_at: str


class RegistrantLoginIn(BaseModel):
    """Request body for returning-player login on a registration lobby."""

    passphrase: str = Field(min_length=1, max_length=128)


class RegistrantLoginOut(BaseModel):
    """Response for a successful returning-player login."""

    player_id: str
    player_name: str
    passphrase: str
    answers: dict[str, str] = Field(default_factory=dict)
    registered_at: str


class RegistrantAnswersUpdateIn(BaseModel):
    """Request body for returning-player answer edits on a registration lobby."""

    passphrase: str = Field(min_length=1, max_length=128)
    answers: dict[str, str] = Field(default_factory=dict)


class RegistrationPublicOut(BaseModel):
    """Public information about a registration (no secrets, no join_code value)."""

    id: str
    name: str
    open: bool
    questions: list[QuestionDef] = Field(default_factory=list)
    join_code_required: bool = False
    description: str | None = None
    message: str | None = None
    converted: bool = False
    converted_to_tid: str | None = None
    listed: bool = False
    sport: str = "padel"
    registrant_count: int = 0
    registrants: list[RegistrantOut] = []


class RegistrationAdminOut(BaseModel):
    """Full admin view of a registration."""

    id: str
    name: str
    open: bool
    join_code: str | None = None
    questions: list[QuestionDef] = Field(default_factory=list)
    listed: bool = False
    sport: str = "padel"
    description: str | None = None
    message: str | None = None
    alias: str | None = None
    converted_to_tid: str | None = None
    created_at: str
    registrants: list[RegistrantAdminOut] = []


class RegistrantPatch(BaseModel):
    """Admin override of a registrant's name or answers."""

    player_name: str | None = Field(default=None, min_length=1, max_length=128)
    answers: dict[str, str] | None = None


class ConvertRegistrationRequest(BaseModel):
    """Convert a registration lobby into a tournament."""

    tournament_type: Literal["group_playoff", "mexicano", "playoff"]
    name: str | None = Field(default=None, max_length=255)
    player_names: list[str] = Field(default_factory=list)
    # Group+Playoff specific
    team_mode: bool = False
    sport: Sport = Sport.PADEL
    court_names: list[str] = Field(default_factory=lambda: ["Court 1"])
    num_groups: int = Field(default=2, ge=1, le=32)
    group_names: list[str] = []
    top_per_group: int = Field(default=2, ge=1)
    double_elimination: bool = False
    public: bool = True
    assign_courts: bool = True
    # Mexicano specific
    total_points_per_match: int = Field(default=32, ge=1)
    num_rounds: int = Field(default=8, ge=0)
    skill_gap: int | None = Field(default=None, ge=0)
    win_bonus: int = Field(default=0, ge=0)
    strength_weight: float = Field(default=0.0, ge=0.0, le=1.0)
    loss_discount: float = Field(default=1.0, ge=0.0, le=1.0)
    balance_tolerance: float = Field(default=0.2, ge=0.0)
