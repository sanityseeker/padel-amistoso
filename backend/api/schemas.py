"""
Pydantic request / response schemas for the REST API.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from email_validator import EmailNotValidError, validate_email as _validate_email
from pydantic import AfterValidator, BaseModel, Field, field_validator, model_validator

from backend.models import (
    EliminationType,
    InputFormat,
    ParticipationStatus,
    QuestionType,
    ScoreConfirmation,
    SetDecider,
    Sport,
    TournamentType,
)
from backend.tournaments.withdrawal import (
    DEFAULT_WALKOVER_POINTS,
    DEFAULT_WALKOVER_SETS,
    WithdrawalKind,
    validate_walkover_points,
    validate_walkover_sets,
)

EmailLang = Literal["en", "es", "ru"]


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


def _with_default_name(data: Any, noun: str) -> Any:
    """Fill a missing or blank ``name`` with ``My <Sport> <noun>``.

    The sport comes from the same payload (padel when absent), so an
    auto-named event always says which sport it is for.
    """
    if not isinstance(data, dict):
        return data
    name = data.get("name")
    if isinstance(name, str) and name.strip():
        return data
    sport = data.get("sport") or Sport.PADEL
    label = "Tennis" if sport == Sport.TENNIS else "Padel"
    return {**data, "name": f"My {label} {noun}"}


class CreateGroupPlayoffRequest(BaseModel):
    @model_validator(mode="before")
    @classmethod
    def _default_name(cls, data: Any) -> Any:
        return _with_default_name(data, "Tournament")

    name: str = Field(max_length=255)
    player_names: list[str] = Field(min_length=2, max_length=256)
    team_mode: bool = False
    sport: Sport = Sport.PADEL
    community_id: str = Field(default="open", max_length=64)
    season_id: str | None = Field(default=None, max_length=64)
    club_id: str | None = Field(default=None, max_length=64)
    court_names: list[str] = Field(default=["Court 1"], max_length=64)
    num_groups: int = Field(default=2, ge=1, le=32)
    group_names: list[str] = Field(default=[], max_length=32)
    group_assignments: dict[str, list[str]] = Field(default_factory=dict)
    # Preferred courts per group name (court names from court_names; others may still be borrowed).
    group_courts: dict[str, list[str]] = Field(default_factory=dict, max_length=32)
    top_per_group: int = Field(default=2, ge=1)
    double_elimination: bool = False
    public: bool = True
    assign_courts: bool = True
    player_strengths: dict[str, float] = Field(default_factory=dict)
    player_emails: dict[str, str] = Field(default_factory=dict)
    player_contacts: dict[str, str] = Field(default_factory=dict)
    player_profile_ids: dict[str, str] = Field(default_factory=dict)
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
    @model_validator(mode="before")
    @classmethod
    def _default_name(cls, data: Any) -> Any:
        return _with_default_name(data, "Mexicano")

    name: str = Field(max_length=255)
    player_names: list[str] = Field(min_length=2, max_length=256)
    court_names: list[str] = Field(default=["Court 1"], max_length=64)
    team_mode: bool = False
    sport: Sport = Sport.PADEL
    community_id: str = Field(default="open", max_length=64)
    season_id: str | None = Field(default=None, max_length=64)
    club_id: str | None = Field(default=None, max_length=64)
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
    strength_min_matches: int = Field(default=4, ge=0)
    strength_win_factor: float = Field(default=1.0, ge=0.0, le=1.0)
    strength_draw_factor: float = Field(default=0.75, ge=0.0, le=1.0)
    strength_loss_factor: float = Field(default=0.5, ge=0.0, le=1.0)
    public: bool = True
    assign_courts: bool = True
    player_strengths: dict[str, float] = Field(default_factory=dict)
    player_emails: dict[str, str] = Field(default_factory=dict)
    player_contacts: dict[str, str] = Field(default_factory=dict)
    player_profile_ids: dict[str, str] = Field(default_factory=dict)
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
    @model_validator(mode="before")
    @classmethod
    def _default_name(cls, data: Any) -> Any:
        return _with_default_name(data, "Play-off")

    name: str = Field(max_length=255)
    participant_names: list[str] = Field(min_length=2, max_length=256)
    court_names: list[str] = Field(default=["Court 1"], max_length=64)
    team_mode: bool = True
    sport: Sport = Sport.PADEL
    community_id: str = Field(default="open", max_length=64)
    season_id: str | None = Field(default=None, max_length=64)
    club_id: str | None = Field(default=None, max_length=64)
    double_elimination: bool = False
    espejo: bool = False
    espejo_super_final: bool = Field(
        default=False,
        description="Deprecated and ignored: the Espejo Super Final was removed. Accepted so old clients keep working.",
    )
    # Espejo only: preferred courts per side, keys "winners" (main) and "losers" (consolation).
    bracket_courts: dict[str, list[str]] = Field(default_factory=dict, max_length=2)
    # Number of equal winners (single elimination only; 1 = classic champion, 3 needs third_place).
    num_winners: int = Field(default=1, ge=1, le=64)
    # Play a 3rd-place match (single elimination or Espejo).
    third_place: bool = False
    public: bool = True
    assign_courts: bool = True
    player_strengths: dict[str, float] = Field(default_factory=dict)
    player_emails: dict[str, str] = Field(default_factory=dict)
    player_contacts: dict[str, str] = Field(default_factory=dict)
    player_profile_ids: dict[str, str] = Field(default_factory=dict)
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


class TournamentNotes(BaseModel):
    """Private organizer notepad of a tournament (editors only)."""

    admin_notes: str | None = None


class TournamentNotesRequest(BaseModel):
    """Replace the organizer notepad; a blank text clears it."""

    admin_notes: str = Field(max_length=10000)


class TvSettingsRequest(BaseModel):
    """Partial update for TV display settings."""

    show_courts: bool | None = None
    show_past_matches: bool | None = None
    show_score_breakdown: bool | None = None
    show_standings: bool | None = None
    show_bracket: bool | None = None
    show_pending_matches: bool | None = None
    hide_schedule: bool | None = None
    highlight_places: int | None = Field(default=None, ge=0, le=32)
    # Per-group overrides of highlight_places, merged into the stored map.
    highlight_places_by_group: dict[str, Annotated[int, Field(ge=0, le=32)]] | None = None
    allow_player_scoring: bool | None = None
    refresh_interval: int | None = Field(default=None, ge=-1, le=300)
    schema_box_scale: float | None = Field(default=None, ge=0.3, le=3.0)
    schema_line_width: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_arrow_scale: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_title_font_scale: float | None = Field(default=None, ge=0.3, le=5.0)
    schema_output_scale: float | None = Field(default=None, ge=0.5, le=3.0)
    schema_format: Literal["svg", "png"] | None = None
    score_mode: dict[str, str] | None = None
    # Tournament-wide third-set decider for set scores (per-match overrides win).
    set_decider: Literal["full_set", "match_tiebreak"] | None = None
    banner_text: str | None = Field(default=None, max_length=5000)
    custom_info_title: str | None = Field(default=None, max_length=120)
    custom_info_text: str | None = Field(default=None, max_length=5000)
    score_confirmation: ScoreConfirmation | None = None
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
    # Withhold unplayed matches, groups, standings and the bracket from non-editors.
    hide_schedule: bool = False
    # Places marked in each group's standings (1-3 in podium colors, the rest with an accent ring).
    highlight_places: int = 3
    # Group name -> places for that group; groups not listed use highlight_places.
    highlight_places_by_group: dict[str, int] = Field(default_factory=dict)
    allow_player_scoring: bool = True
    refresh_interval: int = -1
    schema_box_scale: float = 1.0
    schema_line_width: float = 1.0
    schema_arrow_scale: float = 1.0
    schema_title_font_scale: float = 1.0
    schema_output_scale: float = 1.0
    # Rendering format for live bracket images shown on TV/admin views.
    # SVG is vector and stays crisp at any zoom; PNG is the legacy raster fallback.
    schema_format: Literal["svg", "png"] = "svg"
    score_mode: dict[str, str] = Field(default_factory=dict)
    # How a deciding third set is played by default: a full set, or a match
    # tie-break (to 10, win by 2) that counts as one game in standings / ELO.
    set_decider: Literal["full_set", "match_tiebreak"] = "full_set"
    banner_text: str = ""
    custom_info_title: str = ""
    custom_info_text: str = ""
    # "immediate": score counts on submit (good for fast Mexicano rounds).
    # "required": score stays pending until accepted/auto-finalised by opposing team.
    score_confirmation: ScoreConfirmation = ScoreConfirmation.IMMEDIATE
    # Seconds the opposing team has to submit a correction (0 = no limit).
    correction_window_seconds: int = 0

    @field_validator("score_confirmation", mode="before")
    @classmethod
    def validate_score_confirmation(cls, v: str) -> ScoreConfirmation:
        try:
            return ScoreConfirmation(v)
        except ValueError:
            allowed = {m.value for m in ScoreConfirmation}
            raise ValueError(f"score_confirmation must be one of {allowed}")


class SendMessageEmailsRequest(BaseModel):
    """Options for sending the organizer message email to registrants."""

    # When True, only registrants passing the stored participant filter receive
    # the message (everyone when no filter is set).
    eligible_only: bool = False


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


DeliveryMode = Literal["email", "push_first", "both"]
"""How organizer sends reach tournament players.

``email``: email only. ``push_first``: a push notification to players who turned
notifications on, email to the rest. ``both``: push and email to everyone reachable.
"""


class TournamentEmailSettingsRequest(EmailSettingsRequest):
    """Partial update for a tournament's email settings, plus the delivery mode."""

    delivery: DeliveryMode | None = None


class TournamentEmailSettings(EmailSettings):
    """A tournament's email settings. Lobbies have no push, so only tournaments carry ``delivery``."""

    delivery: DeliveryMode = "email"


class TournamentEmailSettingsOut(TournamentEmailSettings):
    """Tournament email settings plus what push can reach right now."""

    push_available: bool = False
    push_subscribers: int = 0


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


class SetCommunityRequest(BaseModel):
    """Assign a tournament or registration to a community."""

    community_id: str = Field(min_length=1, max_length=64)


class SetSeasonRequest(BaseModel):
    """Assign a tournament or registration to a season (or remove from one)."""

    season_id: str | None = Field(default=None, max_length=64)


class RecordScoreRequest(BaseModel):
    match_id: str
    score1: int = Field(ge=0)
    score2: int = Field(ge=0)


def validate_set_scores(v: list[list[int]]) -> list[list[int]]:
    """Validate a list of tennis-style set scores (shared by several requests).

    Raises:
        ValueError: when the list is empty or too long, a set is malformed or
            tied, or neither team won more sets.
    """
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


class RecordTennisScoreRequest(BaseModel):
    """Record a match result using tennis-style set scores."""

    match_id: str
    sets: list[list[int]]  # e.g. [[6,4],[3,6],[7,5]]
    # Third-set decider the match was actually played with.  Only honoured for
    # player submissions: one that differs from the match's own decider is an
    # off-format score and goes to organiser review.  ``None`` = the match's.
    decider: SetDecider | None = None

    @field_validator("sets")
    @classmethod
    def validate_sets(cls, v: list[list[int]]) -> list[list[int]]:
        return validate_set_scores(v)


class MatchFormatOverrideBody(BaseModel):
    """Per-match scoring format chosen by an organiser.

    ``None`` fields inherit the tournament setting.  ``decider`` picks how a
    deciding third set is played (full set or match tie-break) for matches
    scored in sets; it is rejected for Mexicano round matches.
    """

    mode: Literal["points", "sets"] | None = None
    points_target: int | None = Field(default=None, ge=2, le=200)
    decider: Literal["full_set", "match_tiebreak"] | None = None


class SetMatchFormatRequest(BaseModel):
    """Body for ``PATCH /api/tournaments/{tid}/matches/{mid}/format``.

    ``override = null`` resets the match to the tournament defaults.  A
    replacement score is required when the change alters what an existing
    score means (a Mexicano points target on a scored match, or the decider
    of a match that went to a third set).
    """

    override: MatchFormatOverrideBody | None = None
    score1: int | None = Field(default=None, ge=0)
    score2: int | None = Field(default=None, ge=0)
    sets: list[list[int]] | None = None

    @field_validator("sets")
    @classmethod
    def _validate_sets(cls, v: list[list[int]] | None) -> list[list[int]] | None:
        return validate_set_scores(v) if v else None


class MatchFormatResponse(BaseModel):
    """Result of a per-match format change."""

    ok: bool
    match: dict


class UpdateCourtsRequest(BaseModel):
    court_names: list[str] = Field(default_factory=list, max_length=64)


class UpdateCourtPreferencesRequest(BaseModel):
    """Preferred courts per group and per Espejo side; replaces the stored preferences."""

    group_courts: dict[str, list[str]] = Field(default_factory=dict, max_length=32)
    bracket_courts: dict[str, list[str]] = Field(default_factory=dict, max_length=2)

    @model_validator(mode="after")
    def validate_sides(self) -> "UpdateCourtPreferencesRequest":
        if set(self.bracket_courts) - {"winners", "losers"}:
            raise ValueError('bracket_courts keys must be "winners" or "losers"')
        return self


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
    strength_min_matches: int = Field(default=4, ge=0)
    strength_win_factor: float = Field(default=1.0, ge=0.0, le=1.0)
    strength_draw_factor: float = Field(default=0.75, ge=0.0, le=1.0)
    strength_loss_factor: float = Field(default=0.5, ge=0.0, le=1.0)


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
    playoff_teams: list[list[str]] | None = None


class StartGroupPlayoffsRequest(BaseModel):
    advancing_player_ids: list[str] | None = None
    extra_participants: list[ExternalParticipant] | None = None
    double_elimination: bool | None = None
    espejo: bool = False
    espejo_super_final: bool = Field(
        default=False,
        description="Deprecated and ignored: the Espejo Super Final was removed. Accepted so old clients keep working.",
    )
    playoff_teams: list[list[str]] | None = None
    # Number of equal winners (single elimination only) and optional 3rd-place match.
    num_winners: int = Field(default=1, ge=1, le=64)
    third_place: bool = False
    # Oro / Plata split Espejo: two brackets seeded up front from explicit player lists
    # (same id space as ``advancing_player_ids``; ids in neither list are excluded).
    espejo_split: bool = False
    oro_player_ids: list[str] | None = None
    plata_player_ids: list[str] | None = None
    # External participants per bracket (split mode replaces ``extra_participants``).
    oro_extra_participants: list[ExternalParticipant] | None = None
    plata_extra_participants: list[ExternalParticipant] | None = None
    # Optional 3rd-place match in the Plata bracket (``third_place`` applies to Oro).
    plata_third_place: bool = False

    @model_validator(mode="after")
    def _check_split_options(self) -> StartGroupPlayoffsRequest:
        if self.espejo_split:
            if self.advancing_player_ids is not None:
                raise ValueError("advancing_player_ids cannot be used with espejo_split; send oro/plata lists")
            if self.extra_participants:
                raise ValueError(
                    "extra_participants cannot be used with espejo_split; send oro/plata_extra_participants"
                )
        elif (
            self.oro_player_ids
            or self.plata_player_ids
            or self.oro_extra_participants
            or self.plata_extra_participants
            or self.plata_third_place
        ):
            raise ValueError(
                "oro/plata player ids, oro/plata extra participants and plata_third_place require espejo_split"
            )
        return self


class SchemaPreviewRequest(BaseModel):
    group_sizes: list[int]
    advance_per_group: int = Field(default=2, ge=1)
    elimination: EliminationType = EliminationType.SINGLE
    title: str | None = None
    box_scale: float = Field(default=1.0, ge=0.3, le=3.0)
    line_width: float = Field(default=1.0, ge=0.3, le=5.0)
    arrow_scale: float = Field(default=1.0, ge=0.3, le=5.0)
    title_font_scale: float = Field(default=1.0, ge=0.3, le=5.0)
    output_scale: float = Field(default=1.0, ge=0.5, le=3.0)
    num_winners: int = Field(default=1, ge=1, le=64)
    third_place: bool = False

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
    type: QuestionType = QuestionType.TEXT
    required: bool = False
    choices: list[str] = Field(default_factory=list)


# Participant-filter condition operators:
# - "any_of":   answer matches any of ``values`` (choice: equals; multichoice: intersects)
# - "contains": answer contains ``text`` (case-insensitive substring)
# - "range":    numeric answer within [min_value, max_value] (either bound optional)
# - "answered": any non-empty answer
FilterOp = Literal["any_of", "contains", "range", "answered"]


class FilterConditionDef(BaseModel):
    """One condition of a registration participant filter (conditions are AND-ed)."""

    key: str = Field(min_length=1, max_length=64)
    op: FilterOp
    values: list[str] = Field(default_factory=list)
    text: str = Field(default="", max_length=256)
    min_value: float | None = None
    max_value: float | None = None


class RegistrationCreate(BaseModel):
    """Create a new registration lobby."""

    @model_validator(mode="before")
    @classmethod
    def _default_name(cls, data: Any) -> Any:
        return _with_default_name(data, "Tournament")

    name: str = Field(min_length=1, max_length=255)
    join_code: str | None = Field(default=None, max_length=64)
    questions: list[QuestionDef] = Field(default_factory=list)
    description: str | None = Field(default=None, max_length=5000)
    message: str | None = Field(default=None, max_length=5000)
    listed: bool = False
    sport: Sport = Sport.PADEL
    auto_send_email: bool = False
    email_requirement: EmailRequirement = "optional"
    community_id: str = Field(default="open", min_length=1, max_length=64)
    club_id: str | None = Field(default=None, max_length=64)
    season_id: str | None = Field(default=None, max_length=64)


class RegistrationUpdate(BaseModel):
    """Partial update for a registration lobby."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    open: bool | None = None
    join_code: str | None = Field(default=None, max_length=64)
    questions: list[QuestionDef] | None = None
    description: str | None = Field(default=None, max_length=5000)
    message: str | None = Field(default=None, max_length=5000)
    admin_notes: str | None = Field(default=None, max_length=10000)
    listed: bool | None = None
    archived: bool | None = None
    sport: Sport | None = None
    auto_send_email: bool | None = None
    email_requirement: EmailRequirement | None = None
    participant_filter: list[FilterConditionDef] | None = None
    clear_join_code: bool = False
    clear_description: bool = False
    clear_message: bool = False
    clear_participant_filter: bool = False
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
    lang: EmailLang = "en"


class AdminRegistrantIn(BaseModel):
    """Admin request to add a player to a registration lobby.

    ``profile_id`` links the entry to an existing Player Hub profile (e.g. a
    club member picked from the roster); name/email still come from the body so
    the organizer can adjust them.
    """

    player_name: str = Field(min_length=1, max_length=128)
    answers: dict[str, str] = Field(default_factory=dict)
    email: OptionalEmailStr = Field(default="")
    profile_id: str | None = Field(default=None, max_length=64)
    lang: EmailLang = "en"


class RegistrantOut(BaseModel):
    """Public view of a registrant (no secrets)."""

    player_id: str
    player_name: str
    answers: dict[str, str] = Field(default_factory=dict)
    email: str = ""
    registered_at: str
    lang: EmailLang = "en"


class RegistrantPublicOut(BaseModel):
    """Names-only view of a registrant, safe for the public lobby page."""

    player_id: str
    player_name: str


class RegistrantAdminOut(BaseModel):
    """Admin view of a registrant (includes secrets)."""

    player_id: str
    player_name: str
    passphrase: str
    token: str
    answers: dict[str, str] = Field(default_factory=dict)
    email: str = ""
    registered_at: str
    lang: EmailLang = "en"
    profile_id: str | None = None


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
    # Present only when the lobby has a fee configured (see routes_payments).
    payment: PaymentInfoOut | None = None


class RegistrantAnswersUpdateIn(BaseModel):
    """Request body for returning-player answer edits on a registration lobby."""

    passphrase: str = Field(min_length=1, max_length=128)
    answers: dict[str, str] = Field(default_factory=dict)


class RegistrationAnswerDelta(BaseModel):
    """One question changed in a player's submitted answers."""

    question_key: str
    question_label: str
    change: Literal["added", "changed", "removed"]
    previous_answer: str | None = None
    new_answer: str | None = None


class MarkAnswerChangesSeenRequest(BaseModel):
    """Mark a lobby's answer changes up to ``up_to_id`` (inclusive) as seen."""

    up_to_id: int = Field(ge=0)


class RegistrationAnswerChangeOut(BaseModel):
    """A player's answer submission or update in a registration lobby."""

    id: int
    player_id: str
    player_name: str
    changed_at: str
    changes: list[RegistrationAnswerDelta]


class FindByNameRequest(BaseModel):
    """Search past participations by player name, scoped to a lobby's club/community."""

    player_name: str = Field(min_length=1, max_length=128)


class ParticipationMatchOut(BaseModel):
    """A past participation surfaced by name search (no secrets, no email).

    ``already_linked`` marks participations that already belong to a real Hub
    profile — they are shown for recognition but cannot be claimed.

    A ghost-linked participation (internal ELO-tracking identity, no owner)
    keeps its real ``entity_type``/``entity_id`` for display — the player
    sees every event individually, tournaments before registrations — but
    carries ``ghost_profile_id``: the claim action for *any* of these targets
    that whole ghost (``entity_type="profile"``), merging all its
    participations + ELO into the claimant at once. A ghost with no live
    participation row (its tournament/lobby was purged/deleted) falls back to
    a single ``entity_type="profile"`` row with no event context.
    """

    entity_type: str  # 'tournament' | 'registration' | 'profile'
    entity_id: str
    entity_name: str
    player_id: str
    player_name: str
    already_linked: bool = False
    sport: str | None = None
    # Tournament creation date / lobby registration date — shown so the player
    # can recognize WHICH event the found name belongs to.
    event_date: str | None = None
    # Set when this match is ghost-linked: claiming it must target this ghost
    # profile id (entity_type="profile"), not the displayed entity/player_id.
    ghost_profile_id: str | None = None


class ClaimParticipationRequest(BaseModel):
    """Request to claim a name-matched past participation for a Hub profile.

    The claimant identifies their Hub profile with its passphrase (created or
    logged-in on the registration page).  The claim is not linked until an
    organizer approves it.
    """

    profile_passphrase: str = Field(min_length=1, max_length=256)
    entity_type: str = Field(min_length=1, max_length=32)
    entity_id: str = Field(min_length=1, max_length=128)
    player_id: str = Field(min_length=1, max_length=128)


class ParticipationClaimOut(BaseModel):
    """A pending participation claim shown to the organizer."""

    id: str
    profile_id: str
    entity_type: str
    entity_id: str
    entity_name: str
    player_id: str
    player_name: str
    claimant_name: str = ""
    claimant_email: str = ""
    status: str
    created_at: str


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
    sport: Sport = Sport.PADEL
    auto_send_email: bool = False
    email_requirement: EmailRequirement = "optional"
    registrant_count: int = 0
    registrants: list[RegistrantPublicOut] = []
    community_id: str = "open"
    community_name: str | None = None
    club_id: str | None = None
    club_name: str | None = None
    club_logo_url: str | None = None
    # Fee info (never per-player state); methods only when show_methods=always.
    payment: PaymentPublicOut | None = None


class RegistrationAdminOut(BaseModel):
    """Full admin view of a registration."""

    id: str
    name: str
    open: bool
    join_code: str | None = None
    questions: list[QuestionDef] = Field(default_factory=list)
    listed: bool = False
    archived: bool = False
    sport: Sport = Sport.PADEL
    description: str | None = None
    message: str | None = None
    alias: str | None = None
    auto_send_email: bool = False
    email_requirement: EmailRequirement = "optional"
    club_id: str | None = None
    converted_to_tid: str | None = None
    converted_to_tids: list[str] = Field(default_factory=list)
    linked_tournaments: list[LinkedTournamentOut] = Field(default_factory=list)
    assigned_player_ids: list[str] = Field(default_factory=list)
    player_tournament_map: dict[str, list[str]] = Field(default_factory=dict)
    participant_filter: list[FilterConditionDef] = Field(default_factory=list)
    admin_notes: str | None = None
    # Registrants passing every participant-filter condition (all registrants
    # when no filter is set) — the "final set" eligible for the event.
    eligible_player_ids: list[str] = Field(default_factory=list)
    # The newest answer change the requesting organizer has seen, and how many
    # changes are newer than that.
    answer_changes_seen_id: int = 0
    unseen_answer_changes: int = 0
    created_at: str
    registrants: list[RegistrantAdminOut] = []


class RegistrantPatch(BaseModel):
    """Admin override of a registrant's name, answers, email, or email language."""

    player_name: str | None = Field(default=None, min_length=1, max_length=128)
    answers: dict[str, str] | None = None
    email: OptionalEmailStr | None = None
    lang: EmailLang | None = None


class ConvertRegistrationRequest(BaseModel):
    """Convert a registration lobby into a tournament."""

    tournament_type: TournamentType
    name: str | None = Field(default=None, max_length=255)
    player_names: list[str] = Field(default_factory=list)
    # Group+Playoff specific
    team_mode: bool = False
    sport: Sport = Sport.PADEL
    court_names: list[str] = Field(default_factory=lambda: ["Court 1"])
    num_groups: int = Field(default=2, ge=1, le=32)
    group_names: list[str] = []
    group_assignments: dict[str, list[str]] = Field(default_factory=dict)
    # Preferred courts per group name (court names from court_names; others may still be borrowed).
    group_courts: dict[str, list[str]] = Field(default_factory=dict, max_length=32)
    top_per_group: int = Field(default=2, ge=1)
    double_elimination: bool = False
    # Play-off specific (single elimination only for num_winners > 1)
    num_winners: int = Field(default=1, ge=1, le=64)
    third_place: bool = False
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
    strength_min_matches: int = Field(default=4, ge=0)
    strength_win_factor: float = Field(default=1.0, ge=0.0, le=1.0)
    strength_draw_factor: float = Field(default=0.75, ge=0.0, le=1.0)
    strength_loss_factor: float = Field(default=0.5, ge=0.0, le=1.0)
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
        if self.tournament_type == TournamentType.PLAYOFF and self.sport == Sport.PADEL and not self.team_mode:
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
    elo_padel: float
    elo_padel_matches: int
    elo_tennis: float
    elo_tennis_matches: int
    k_factor_override: int | None = None
    is_ghost: bool = False


class AdminParticipationLink(BaseModel):
    """A single tournament/registration participation linked to a profile."""

    tournament_id: str
    player_id: str
    player_name: str
    tournament_name: str
    status: ParticipationStatus  # "active" or "finished"
    finished_at: str | None = None
    rank: int | None = None
    total_players: int | None = None
    wins: int = 0
    losses: int = 0
    draws: int = 0
    points_for: int = 0
    points_against: int = 0


class AdminTournamentParticipant(BaseModel):
    """A tournament participant as offered by the admin link picker."""

    player_id: str
    player_name: str
    profile_id: str | None = None  # profile currently linked, if any
    profile_name: str | None = None
    is_ghost: bool = False


class HubMergeRequest(BaseModel):
    """Merge registered profile ``secondary_id`` into registered profile ``primary_id``."""

    primary_id: str
    secondary_id: str


class HubMergeProfile(BaseModel):
    """One side of a Hub-profile merge, as shown in the preview."""

    id: str
    name: str
    email: str
    tournaments: int  # distinct tournaments taken part in


class HubMergeSharedTournament(BaseModel):
    """A tournament both profiles took part in — it blocks the merge."""

    tournament_id: str
    tournament_name: str


class HubMergePreview(BaseModel):
    """What merging two registered profiles would do, and whether it is allowed."""

    primary: HubMergeProfile
    secondary: HubMergeProfile
    shared_tournaments: list[HubMergeSharedTournament]
    can_merge: bool


class HubMergeResult(BaseModel):
    """The surviving profile after a Hub-profile merge."""

    profile_id: str
    name: str


class AdminPlayerProfileDetail(BaseModel):
    """Full profile with all linked participations."""

    id: str
    name: str
    email: str
    contact: str
    passphrase: str
    created_at: str
    is_ghost: bool = False
    elo_padel: float
    elo_padel_matches: int
    elo_tennis: float
    elo_tennis_matches: int
    k_factor_override: int | None = None
    participations: list[AdminParticipationLink]


class AdminNameUpdate(BaseModel):
    """Request body for renaming a player profile."""

    name: str = Field(min_length=1, max_length=128)


class AdminEmailUpdate(BaseModel):
    """Request body for updating a profile's email."""

    email: OptionalEmailStr = Field(default="")


class AdminKFactorUpdate(BaseModel):
    """Request body for updating a profile's K-factor override."""

    k_factor_override: int | None = Field(default=None, ge=1, le=200)


# ────────────────────────────────────────────────────────────────────────────
# Player payment tracking (phase 1: display-only methods, manual confirmation)
# ────────────────────────────────────────────────────────────────────────────

PaymentMethodKind = Literal["bizum", "iban", "revolut", "paypal_me", "cash", "other"]
PaymentStatus = Literal["unpaid", "reported", "paid", "waived", "refund_due", "refunded"]
PAYMENT_ALSO_FOR_MAX = 50
PAYMENT_STATUSES: tuple[str, ...] = ("unpaid", "reported", "paid", "waived", "refund_due", "refunded")


class PaymentMethod(BaseModel):
    """One way to pay the organizer — displayed instructions only, never processed."""

    kind: PaymentMethodKind
    value: str = Field(default="", max_length=512)
    label: str | None = Field(default=None, max_length=80)


class PaymentSettings(BaseModel):
    """Per-lobby / per-tournament fee configuration (flat fee per player)."""

    fee_cents: int = Field(default=0, ge=0, le=100_000_000)
    currency: str = Field(default="EUR", min_length=3, max_length=3, pattern=r"^[A-Za-z]{3}$")
    due_at: str | None = Field(default=None, max_length=32)
    instructions: str | None = Field(default=None, max_length=2000)
    methods: list[PaymentMethod] = Field(default_factory=list, max_length=12)
    show_methods: Literal["always", "after_register"] = "after_register"


class PaymentSettingsPatch(BaseModel):
    """Partial update for :class:`PaymentSettings` — only supplied fields change."""

    fee_cents: int | None = Field(default=None, ge=0, le=100_000_000)
    currency: str | None = Field(default=None, min_length=3, max_length=3, pattern=r"^[A-Za-z]{3}$")
    due_at: str | None = Field(default=None, max_length=32)
    instructions: str | None = Field(default=None, max_length=2000)
    methods: list[PaymentMethod] | None = Field(default=None, max_length=12)
    show_methods: Literal["always", "after_register"] | None = None


class PaymentPublicOut(BaseModel):
    """Fee information safe for the public lobby page (no per-player state).

    ``methods`` is only populated when the organizer chose ``show_methods=always``.
    """

    fee_cents: int
    currency: str
    due_at: str | None = None
    instructions: str | None = None
    methods: list[PaymentMethod] = Field(default_factory=list)


class PaymentInfoOut(BaseModel):
    """A player's own payment state plus everything needed to pay."""

    status: PaymentStatus
    amount_cents: int
    currency: str
    due_at: str | None = None
    instructions: str | None = None
    methods: list[PaymentMethod] = Field(default_factory=list)
    concept: str
    reference: str | None = None
    method: str | None = None


class PaymentRowOut(BaseModel):
    """Admin view of one participant's payment state."""

    id: int | None = None
    player_id: str
    player_name: str
    email: str = ""
    status: PaymentStatus = "unpaid"
    amount_cents: int
    currency: str
    method: str | None = None
    reference: str | None = None
    note: str | None = None
    concept: str
    updated_by: str | None = None
    updated_at: str | None = None
    synthesized: bool = False


class PaymentSummaryOut(BaseModel):
    total: int = 0
    paid: int = 0
    reported: int = 0
    unpaid: int = 0
    waived: int = 0
    refund_due: int = 0
    refunded: int = 0
    collected_cents: int = 0


class PaymentsListOut(BaseModel):
    settings: PaymentSettings
    rows: list[PaymentRowOut]
    summary: PaymentSummaryOut
    entity_name: str = ""


class PaymentPatchIn(BaseModel):
    """Editor-side status change for one participant."""

    status: PaymentStatus
    method: str | None = Field(default=None, max_length=40)
    amount_cents: int | None = Field(default=None, ge=0, le=100_000_000)
    note: str | None = Field(default=None, max_length=500)


class PlayerPaymentReportIn(BaseModel):
    """Player self-report ("I've paid"), authenticated by passphrase or token."""

    passphrase: str | None = Field(default=None, min_length=1, max_length=128)
    token: str | None = Field(default=None, min_length=1, max_length=256)
    reference: str | None = Field(default=None, max_length=120)
    method: str | None = Field(default=None, max_length=40)
    also_for: list[str] = Field(default_factory=list, max_length=PAYMENT_ALSO_FOR_MAX)


class PlayerPaymentAuthIn(BaseModel):
    """Player credentials only (passphrase or token), to list the players they could also pay for."""

    passphrase: str | None = Field(default=None, min_length=1, max_length=128)
    token: str | None = Field(default=None, min_length=1, max_length=256)


class PayableTeammateOut(BaseModel):
    """A fellow player the reporter may also report a payment for: id and display name only."""

    player_id: str
    player_name: str


class HubPaymentReportIn(BaseModel):
    reference: str | None = Field(default=None, max_length=120)
    method: str | None = Field(default=None, max_length=40)
    also_for: list[str] = Field(default_factory=list, max_length=PAYMENT_ALSO_FOR_MAX)


class HubPaymentOut(BaseModel):
    """One pending payment shown in the Player Hub."""

    key: str
    entity_type: Literal["registration", "tournament"]
    entity_id: str
    entity_name: str
    player_id: str
    status: PaymentStatus
    amount_cents: int
    currency: str
    due_at: str | None = None
    instructions: str | None = None
    methods: list[PaymentMethod] = Field(default_factory=list)
    concept: str
    reference: str | None = None
    # Hub keys of every entry of the profile that shows this one fee (its own key first). A lobby
    # converted into several tournaments has one fee per player, listed once.
    entry_keys: list[str] = Field(default_factory=list)


class RemindUnpaidIn(BaseModel):
    subject: str | None = Field(default=None, max_length=200)
    message: str | None = Field(default=None, max_length=4000)


class RemindUnpaidOut(BaseModel):
    sent: int = 0
    pushed: int = 0
    failed: int = 0
    skipped: int = 0
    unreachable: list[str] = Field(default_factory=list)


class ClearMatchResponse(BaseModel):
    """Result of clearing a match back to unplayed."""

    ok: bool = True
    phase: str


# ---------------------------------------------------------------------------
# Withdrawals
# ---------------------------------------------------------------------------


class WalkoverScoreIn(BaseModel):
    """Walkover score template, winner first (opponent - withdrawn).

    ``points`` is ``[W, L]`` with ``0 <= L < W <= 200``; ``sets`` is a set
    score the first side wins.  Each is optional: the 6-0 / 6-0 6-0 defaults
    apply when omitted.
    """

    points: list[int] | None = None
    sets: list[list[int]] | None = None

    @field_validator("points")
    @classmethod
    def _validate_points(cls, v: list[int] | None) -> list[int] | None:
        if v is None:
            return None
        validate_walkover_points(v)
        return v

    @field_validator("sets")
    @classmethod
    def _validate_sets(cls, v: list[list[int]] | None) -> list[list[int]] | None:
        if v is None:
            return None
        validate_set_scores(v)
        validate_walkover_sets(v)
        return v

    @classmethod
    def defaults(cls) -> WalkoverScoreIn:
        return cls(points=list(DEFAULT_WALKOVER_POINTS), sets=[list(s) for s in DEFAULT_WALKOVER_SETS])


class WithdrawRequest(BaseModel):
    """Body for ``POST /api/tournaments/{tid}/withdrawals``."""

    player_id: str = Field(min_length=1, max_length=64)
    # The outcome the organiser confirmed in the preview; a different outcome is a 409.
    expected_kind: WithdrawalKind
    walkover: WalkoverScoreIn | None = None


class WithdrawalMatchItem(BaseModel):
    """One match affected by a withdrawal, as shown in the confirm dialog."""

    match_id: str
    round_label: str = ""
    court: str | None = None
    team1: list[str] = Field(default_factory=list)
    team2: list[str] = Field(default_factory=list)
    # The other side's names (the withdrawn entry's opponent).
    opponent: str = ""
    current_score: str | None = None
    # Walkover score, winner first, for matches that become walkovers.
    resulting_score: str | None = None
    # Score mode the walkover is recorded in (``None`` when no walkover).
    mode: InputFormat | None = None
    # Third-set decider the walkover is recorded under (the match's own override,
    # else the tournament default); ``None`` unless the walkover is in sets.
    decider: SetDecider | None = None


class WithdrawalBlockerItem(BaseModel):
    """A match whose score must be accepted, resolved or cleared first."""

    match_id: str
    round_label: str = ""
    reason: Literal["pending", "disputed", "format_review"]


class WithdrawalPreviewResponse(BaseModel):
    """What withdrawing a participant would do (``GET .../withdrawals/preview``)."""

    entry_key: str
    entry_name: str
    member_names: list[str] = Field(default_factory=list)
    kind: WithdrawalKind
    group: str | None = None
    played: int = 0
    total: int = 0
    annul_matches: list[WithdrawalMatchItem] = Field(default_factory=list)
    walkover_matches: list[WithdrawalMatchItem] = Field(default_factory=list)
    dropped_match: WithdrawalMatchItem | None = None
    sit_out_names: list[str] = Field(default_factory=list)
    pending_forfeit_match: WithdrawalMatchItem | None = None
    advance_to: str | None = None
    opponent_tbd: bool = False
    lb_drop: bool = False
    third_place_note: bool = False
    active_after: int | None = None
    modes_needed: list[InputFormat] = Field(default_factory=list)
    walkover_defaults: WalkoverScoreIn = Field(default_factory=WalkoverScoreIn.defaults)
    default_decider: SetDecider = SetDecider.FULL_SET
    # Distinct deciders the set score must satisfy: one per affected match scored in
    # sets, plus the tournament default when walkovers are created later.
    deciders_needed: list[SetDecider] = Field(default_factory=list)
    elo_recalc: bool = False
    undo_possible: bool = False
    blockers: list[WithdrawalBlockerItem] = Field(default_factory=list)


class WithdrawalSummary(BaseModel):
    """A stored withdrawal, as listed in the status payloads."""

    entry_key: str
    name: str
    member_ids: list[str] = Field(default_factory=list)
    member_names: list[str] = Field(default_factory=list)
    kind: WithdrawalKind
    group: str | None = None
    played: int = 0
    total: int = 0
    walkovers: int = 0
    at: float = 0.0
    undo_allowed: bool = False


class WithdrawResponse(BaseModel):
    """Result of ``POST /api/tournaments/{tid}/withdrawals``."""

    ok: bool = True
    withdrawal: WithdrawalSummary
    walkovers_created: int = 0
    phase: str
    elo_recalculated: bool = False


class UndoWithdrawalResponse(BaseModel):
    """Result of ``DELETE /api/tournaments/{tid}/withdrawals/{entry_key}``."""

    ok: bool = True
    phase: str
    elo_recalculated: bool = False
