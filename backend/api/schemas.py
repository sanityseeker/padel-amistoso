"""
Pydantic request / response schemas for the REST API.
"""

from __future__ import annotations

from typing import Annotated, Literal

from email_validator import EmailNotValidError, validate_email as _validate_email
from pydantic import AfterValidator, BaseModel, Field, field_validator, model_validator

from backend.models import Sport


def _coerce_optional_email(v: str) -> str:
    """Accept empty string (no email) or a valid, normalised email address."""
    stripped = v.strip()
    if not stripped:
        return ""
    try:
        return _validate_email(stripped, check_deliverability=False).normalized
    except EmailNotValidError as exc:
        raise ValueError(str(exc)) from exc


# Use this for fields where an email is optional (empty string = no email provided).
OptionalEmailStr = Annotated[str, AfterValidator(_coerce_optional_email)]

EmailRequirement = Literal["required", "optional", "disabled"]


def _normalized_unique_names(values: list[str], field_name: str) -> list[str]:
    cleaned = [name.strip() for name in values]
    if any(len(name) == 0 for name in cleaned):
        raise ValueError(f"{field_name} must not contain empty names")
    seen: set[str] = set()
    for name in cleaned:
        key = name.casefold()
        if key in seen:
            raise ValueError(f"{field_name} must not contain duplicates")
        seen.add(key)
    return cleaned


def _validate_player_emails(emails: dict[str, str]) -> dict[str, str]:
    """Validate and normalise a name→email mapping."""
    out: dict[str, str] = {}
    for name, raw in emails.items():
        out[name] = _coerce_optional_email(raw)
    return out


def _coerce_team_names(values: list[str | None]) -> list[str]:
    """Coerce a team_names list by converting None entries to empty strings.

    This guards against sparse-array holes serialised as JSON null by the
    frontend, which Pydantic would otherwise reject as invalid strings.
    """
    return [(v or "").strip() for v in values]


class CreateGroupPlayoffRequest(BaseModel):
    name: str = Field(default="My Tournament", max_length=255)
    player_names: list[str] = Field(min_length=2, max_length=256)
    team_mode: bool = False
    sport: Sport = Sport.PADEL
    court_names: list[str] = Field(default=["Court 1"], max_length=64)
    num_groups: int = Field(default=2, ge=1, le=32)
    group_names: list[str] = Field(default=[], max_length=32)
    group_assignments: dict[str, list[str]] = Field(default_factory=dict)
    top_per_group: int = Field(default=2, ge=1)
    double_elimination: bool = False
    public: bool = True
    assign_courts: bool = True
    player_strengths: dict[str, float] = Field(default_factory=dict)
    player_emails: dict[str, str] = Field(default_factory=dict)
    player_contacts: dict[str, str] = Field(default_factory=dict)
    teams: list[list[str]] = Field(default_factory=list)
    team_names: list[str | None] = Field(default_factory=list)

    @field_validator("team_names", mode="before")
    @classmethod
    def coerce_team_names_gp(cls, v: list[str | None]) -> list[str]:
        return _coerce_team_names(v)

    @field_validator("player_names")
    @classmethod
    def at_least_two_players(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 players")
        return _normalized_unique_names(v, "player_names")

    @field_validator("player_emails")
    @classmethod
    def validate_emails_gp(cls, v: dict[str, str]) -> dict[str, str]:
        return _validate_player_emails(v)

    @model_validator(mode="after")
    def validate_courts_and_teams(self) -> "CreateGroupPlayoffRequest":
        if self.assign_courts and len(self.court_names) < 1:
            raise ValueError("Need at least 1 court when assign_courts is True")
        if self.teams:
            if not self.team_mode:
                raise ValueError("teams requires team_mode=True")
            seen: set[str] = set()
            for team in self.teams:
                if len(team) < 1:
                    raise ValueError("Each team must have at least 1 player")
                for name in team:
                    if name in seen:
                        raise ValueError(f"Player '{name}' appears in multiple teams")
                    seen.add(name)
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
    teammate_repeat_weight: float = Field(default=2.0, ge=0.0)
    opponent_repeat_weight: float = Field(default=1.0, ge=0.0)
    repeat_decay: float = Field(default=0.5, ge=0.0)
    partner_balance_weight: float = Field(default=0.0, ge=0.0)
    public: bool = True
    assign_courts: bool = True
    player_strengths: dict[str, float] = Field(default_factory=dict)
    player_emails: dict[str, str] = Field(default_factory=dict)
    player_contacts: dict[str, str] = Field(default_factory=dict)
    teams: list[list[str]] = Field(default_factory=list)
    team_names: list[str | None] = Field(default_factory=list)

    @field_validator("team_names", mode="before")
    @classmethod
    def coerce_team_names_mex(cls, v: list[str | None]) -> list[str]:
        return _coerce_team_names(v)

    @field_validator("player_names")
    @classmethod
    def at_least_two_players(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 entries for Mexicano format")
        return _normalized_unique_names(v, "player_names")

    @field_validator("player_emails")
    @classmethod
    def validate_emails_mex(cls, v: dict[str, str]) -> dict[str, str]:
        return _validate_player_emails(v)

    @model_validator(mode="after")
    def validate_player_count_and_teams(self) -> "CreateMexicanoRequest":
        if not self.team_mode and len(self.player_names) < 4:
            raise ValueError("Need at least 4 players for Mexicano format (or enable team mode)")
        if self.assign_courts and len(self.court_names) < 1:
            raise ValueError("Need at least 1 court when assign_courts is True")
        if self.teams:
            if not self.team_mode:
                raise ValueError("teams requires team_mode=True")
            seen: set[str] = set()
            for team in self.teams:
                if len(team) < 1:
                    raise ValueError("Each team must have at least 1 player")
                for name in team:
                    if name in seen:
                        raise ValueError(f"Player '{name}' appears in multiple teams")
                    seen.add(name)
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
    player_strengths: dict[str, float] = Field(default_factory=dict)
    player_emails: dict[str, str] = Field(default_factory=dict)
    player_contacts: dict[str, str] = Field(default_factory=dict)
    teams: list[list[str]] = Field(default_factory=list)
    team_names: list[str | None] = Field(default_factory=list)

    @field_validator("team_names", mode="before")
    @classmethod
    def coerce_team_names_po(cls, v: list[str | None]) -> list[str]:
        return _coerce_team_names(v)

    @field_validator("participant_names")
    @classmethod
    def at_least_two_participants(cls, v: list[str]) -> list[str]:
        if len(v) < 2:
            raise ValueError("Need at least 2 participants")
        return _normalized_unique_names(v, "participant_names")

    @field_validator("player_emails")
    @classmethod
    def validate_emails_po(cls, v: dict[str, str]) -> dict[str, str]:
        return _validate_player_emails(v)

    @model_validator(mode="after")
    def validate_courts_and_teams(self) -> "CreatePlayoffRequest":
        if self.sport == Sport.PADEL and not self.team_mode:
            raise ValueError("Play-off creation for padel requires team_mode=True")
        if self.assign_courts and len(self.court_names) < 1:
            raise ValueError("Need at least 1 court when assign_courts is True")
        if self.teams:
            if not self.team_mode:
                raise ValueError("teams requires team_mode=True")
            seen: set[str] = set()
            for team in self.teams:
                if len(team) < 1:
                    raise ValueError("Each team must have at least 1 player")
                for name in team:
                    if name in seen:
                        raise ValueError(f"Player '{name}' appears in multiple teams")
                    seen.add(name)
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
    score_confirmation: str | None = None
    # Seconds the opposing team has to submit a correction after the score is
    # submitted.  0 means no limit (corrections are always allowed until confirmed).
    correction_window_seconds: int | None = Field(default=None, ge=0, le=3600)


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
    # "immediate": score counts on submit (good for fast Mexicano rounds).
    # "required": score stays pending until accepted/auto-finalised by opposing team.
    score_confirmation: str = "immediate"
    # Seconds the opposing team has to submit a correction (0 = no limit).
    correction_window_seconds: int = 0

    @field_validator("score_confirmation")
    @classmethod
    def validate_score_confirmation(cls, v: str) -> str:
        allowed = {"immediate", "required"}
        if v not in allowed:
            raise ValueError(f"score_confirmation must be one of {allowed}")
        return v


class EmailSettingsRequest(BaseModel):
    """Partial update for per-tournament email settings (PATCH semantics)."""

    sender_name: str | None = Field(default=None, max_length=100)
    reply_to: str | None = None

    @field_validator("reply_to")
    @classmethod
    def validate_reply_to(cls, v: str | None) -> str | None:
        if v is None:
            return None
        return _coerce_optional_email(v)


class EmailSettings(BaseModel):
    """Full per-tournament email settings with defaults."""

    sender_name: str = ""
    reply_to: str = ""


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


class PatchMexSettingsRequest(BaseModel):
    """Request body for PATCH /{tid}/mex/settings — replaces all advanced Mexicano settings."""

    num_rounds: int = Field(ge=0)
    skill_gap: int | None = Field(default=None, ge=0)
    win_bonus: int = Field(ge=0)
    strength_weight: float = Field(ge=0.0, le=1.0)
    loss_discount: float = Field(ge=0.0, le=1.0)
    balance_tolerance: float = Field(ge=0.0)
    teammate_repeat_weight: float = Field(ge=0.0)
    opponent_repeat_weight: float = Field(ge=0.0)
    repeat_decay: float = Field(ge=0.0)
    partner_balance_weight: float = Field(default=0.0, ge=0.0)


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
    type: Literal["text", "choice", "multichoice", "number"] = "text"
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
    auto_send_email: bool = False
    email_requirement: EmailRequirement = "optional"


class RegistrationUpdate(BaseModel):
    """Partial update for a registration lobby."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    open: bool | None = None
    join_code: str | None = Field(default=None, max_length=64)
    questions: list[QuestionDef] | None = None
    description: str | None = Field(default=None, max_length=5000)
    message: str | None = Field(default=None, max_length=5000)
    listed: bool | None = None
    archived: bool | None = None
    sport: Sport | None = None
    auto_send_email: bool | None = None
    email_requirement: EmailRequirement | None = None
    clear_join_code: bool = False
    clear_description: bool = False
    clear_message: bool = False
    clear_answers_for_keys: list[str] = []


class RegistrantIn(BaseModel):
    """Player self-registration request."""

    player_name: str = Field(min_length=1, max_length=128)
    join_code: str | None = None
    answers: dict[str, str] = Field(default_factory=dict)
    email: OptionalEmailStr = Field(default="")
    profile_passphrase: str | None = Field(
        default=None,
        description="Optional Player Hub passphrase to link this registration to a profile.",
    )


class RegistrantOut(BaseModel):
    """Public view of a registrant (no secrets)."""

    player_id: str
    player_name: str
    answers: dict[str, str] = Field(default_factory=dict)
    email: str = ""
    registered_at: str


class RegistrantAdminOut(BaseModel):
    """Admin view of a registrant (includes secrets)."""

    player_id: str
    player_name: str
    passphrase: str
    token: str
    answers: dict[str, str] = Field(default_factory=dict)
    email: str = ""
    registered_at: str


class RegistrantLoginIn(BaseModel):
    """Request body for returning-player login on a registration lobby.

    Exactly one of ``passphrase`` or ``token`` must be provided.
    """

    passphrase: str | None = Field(default=None, min_length=1, max_length=128)
    token: str | None = Field(default=None, min_length=1, max_length=256)


class RegistrantLoginOut(BaseModel):
    """Response for a successful returning-player login."""

    player_id: str
    player_name: str
    passphrase: str
    token: str
    answers: dict[str, str] = Field(default_factory=dict)
    registered_at: str


class RegistrantAnswersUpdateIn(BaseModel):
    """Request body for returning-player answer edits on a registration lobby."""

    passphrase: str = Field(min_length=1, max_length=128)
    answers: dict[str, str] = Field(default_factory=dict)


class LinkedTournamentOut(BaseModel):
    """Linked tournament metadata exposed to registration viewers."""

    id: str
    name: str
    type: str | None = None
    finished: bool = False


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
    converted_to_tids: list[str] = Field(default_factory=list)
    linked_tournaments: list[LinkedTournamentOut] = Field(default_factory=list)
    listed: bool = False
    archived: bool = False
    sport: str = "padel"
    auto_send_email: bool = False
    email_requirement: EmailRequirement = "optional"
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
    archived: bool = False
    sport: str = "padel"
    description: str | None = None
    message: str | None = None
    alias: str | None = None
    auto_send_email: bool = False
    email_requirement: EmailRequirement = "optional"
    converted_to_tid: str | None = None
    converted_to_tids: list[str] = Field(default_factory=list)
    linked_tournaments: list[LinkedTournamentOut] = Field(default_factory=list)
    assigned_player_ids: list[str] = Field(default_factory=list)
    player_tournament_map: dict[str, list[str]] = Field(default_factory=dict)
    created_at: str
    registrants: list[RegistrantAdminOut] = []


class RegistrantPatch(BaseModel):
    """Admin override of a registrant's name, answers, or email."""

    player_name: str | None = Field(default=None, min_length=1, max_length=128)
    answers: dict[str, str] | None = None
    email: OptionalEmailStr | None = None


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
    group_assignments: dict[str, list[str]] = Field(default_factory=dict)
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
    teammate_repeat_weight: float = Field(default=2.0, ge=0.0)
    opponent_repeat_weight: float = Field(default=1.0, ge=0.0)
    repeat_decay: float = Field(default=0.5, ge=0.0)
    partner_balance_weight: float = Field(default=0.0, ge=0.0)
    # Team formation (admin-composed teams from individual registrants)
    teams: list[list[str]] = Field(default_factory=list)
    team_names: list[str | None] = Field(default_factory=list)
    # Per-player initial strength for seeding
    player_strengths: dict[str, float] = Field(default_factory=dict)

    @field_validator("team_names", mode="before")
    @classmethod
    def coerce_team_names_convert(cls, v: list[str | None]) -> list[str]:
        return _coerce_team_names(v)

    @field_validator("player_names")
    @classmethod
    def validate_player_names(cls, v: list[str]) -> list[str]:
        if not v:
            return v
        return _normalized_unique_names(v, "player_names")

    @model_validator(mode="after")
    def validate_teams(self) -> "ConvertRegistrationRequest":
        if self.tournament_type == "playoff" and self.sport == Sport.PADEL and not self.team_mode:
            raise ValueError("Play-off conversion for padel requires team_mode=True")

        if self.teams:
            if not self.team_mode:
                raise ValueError("teams requires team_mode=True")
            # Check no player appears in multiple teams
            seen: set[str] = set()
            for team in self.teams:
                if len(team) < 1:
                    raise ValueError("Each team must have at least 1 player")
                for name in team:
                    if name in seen:
                        raise ValueError(f"Player '{name}' appears in multiple teams")
                    seen.add(name)
        return self


class AddCollaboratorRequest(BaseModel):
    """Request body for granting co-editor access to a user."""

    username: str = Field(min_length=1, max_length=150)


class CollaboratorListResponse(BaseModel):
    """Response containing the list of co-editors for a tournament."""

    collaborators: list[str]


class PlayerEmailRequest(BaseModel):
    """Request body for setting a player's email address."""

    email: OptionalEmailStr = Field(default="")


class TournamentMessageRequest(BaseModel):
    """Request body for sending an organizer message to tournament players."""

    message: str = Field(min_length=1, max_length=2000)


# ────────────────────────────────────────────────────────────────────────────
# Admin Player Hub management
# ────────────────────────────────────────────────────────────────────────────


class AdminPlayerProfileSummary(BaseModel):
    """Lightweight profile row for list views."""

    id: str
    name: str
    email: str
    passphrase: str
    created_at: str


class AdminParticipationLink(BaseModel):
    """A single tournament/registration participation linked to a profile."""

    tournament_id: str
    player_id: str
    player_name: str
    tournament_name: str
    status: str  # "active" or "finished"
    finished_at: str | None = None
    rank: int | None = None
    total_players: int | None = None
    wins: int = 0
    losses: int = 0
    draws: int = 0
    points_for: int = 0
    points_against: int = 0


class AdminPlayerProfileDetail(BaseModel):
    """Full profile with all linked participations."""

    id: str
    name: str
    email: str
    contact: str
    passphrase: str
    created_at: str
    participations: list[AdminParticipationLink]


class AdminEmailUpdate(BaseModel):
    """Request body for updating a profile's email."""

    email: OptionalEmailStr = Field(default="")
