"""Club management routes.

A Club is an optional upgrade layer on top of a Community.  It adds
branding (logo), player tiers with base ELO values, and seasons for
grouping tournaments.  The underlying Community continues to handle
ELO scoping and tournament/registration assignment unchanged.
"""

from __future__ import annotations

import io
import json
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user
from ..auth.models import User, UserRole
from ..auth.security import create_profile_email_verify_token, create_profile_token
from ..auth.store import user_store
from ..config import DATA_DIR
from ..email import (
    is_valid_email,
    render_club_announcement_email,
    render_club_lobby_invite_email,
    render_player_space_welcome,
    send_email_background,
)
from .db import (
    add_club_co_editor,
    get_club_co_editors,
    get_db,
    get_shared_club_ids,
    remove_club_co_editor,
)
from .elo_store import consolidate_ghost_elos, retroactive_transfer_elo
from .routes_communities import DEFAULT_COMMUNITY_ID
from .schemas import AddCollaboratorRequest, CollaboratorListResponse, EmailLang
from ..tournaments.player_secrets import generate_passphrase

router = APIRouter(prefix="/api/clubs", tags=["clubs"])

_LOGOS_DIR = DATA_DIR / "logos"
_MAX_LOGO_BYTES = 5 * 1024 * 1024  # 5 MB
_LOGO_MAX_PX = 256  # max width/height after resizing

_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
_ID_LEN = 8


def _generate_id(prefix: str) -> str:
    """Return a short random ID like ``cl_8k3w9q2h``."""
    suffix = "".join(secrets.choice(_ID_ALPHABET) for _ in range(_ID_LEN))
    return f"{prefix}_{suffix}"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class ClubCreate(BaseModel):
    """Request body for creating a club from an existing community."""

    community_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=100)


class ClubUpdate(BaseModel):
    """Request body for updating club details."""

    name: str = Field(min_length=1, max_length=100)


class ClubOut(BaseModel):
    """Public representation of a club."""

    id: str
    community_id: str
    name: str
    has_logo: bool = False
    created_by: str
    created_at: str
    shared: bool = False
    email_settings: dict | None = None


class ClubEmailSettings(BaseModel):
    """Email settings for a club."""

    reply_to: str | None = Field(default=None, max_length=255)
    sender_name: str | None = Field(default=None, max_length=100)


class ClubPlayerAdd(BaseModel):
    """Request body for manually adding a player profile to a club."""

    profile_id: str | None = Field(default=None, min_length=1, max_length=64)
    past_player_id: str | None = Field(default=None, min_length=1, max_length=64)


class TierCreate(BaseModel):
    """Request body for creating a player tier."""

    name: str = Field(min_length=1, max_length=50)
    sport: str = Field(pattern=r"^(padel|tennis)$")
    base_elo: float = Field(default=1000, ge=0, le=3000)
    position: int = Field(default=0, ge=0)


class TierUpdate(BaseModel):
    """Request body for updating a tier."""

    name: str | None = Field(default=None, min_length=1, max_length=50)
    base_elo: float | None = Field(default=None, ge=0, le=3000)
    position: int | None = Field(default=None, ge=0)


class TierOut(BaseModel):
    """Public representation of a club tier."""

    id: str
    club_id: str
    name: str
    sport: str
    base_elo: float
    position: int


class PlayerEloUpdate(BaseModel):
    """Request body for manually setting a player's ELO within a club's community."""

    elo: float = Field(ge=0, le=4000)
    sport: str = Field(default="padel", pattern=r"^(padel|tennis)$")


class PlayerTierAssign(BaseModel):
    """Request body for assigning a tier to a player in a specific sport within a club's community.

    Tiers are per-sport: a player can hold different tiers for padel and tennis.
    Assignment only affects the row for the given sport.
    """

    sport: str = Field(pattern=r"^(padel|tennis)$")
    tier_id: str | None = Field(default=None, max_length=64)
    apply_base_elo: bool = False


class ClubPlayerOut(BaseModel):
    """A player entry in a club's player list."""

    profile_id: str
    name: str
    email: str | None = None
    has_hub_profile: bool = True
    elo_padel: float | None = None
    elo_tennis: float | None = None
    matches_padel: int = 0
    matches_tennis: int = 0
    tier_id_padel: str | None = None
    tier_name_padel: str | None = None
    tier_id_tennis: str | None = None
    tier_name_tennis: str | None = None
    hidden_padel: bool = False
    hidden_tennis: bool = False


class SportVisibilityUpdate(BaseModel):
    """Request body for per-sport visibility of a player in a club."""

    sport: str = Field(pattern=r"^(padel|tennis)$")
    hidden: bool


class BulkOperationFailure(BaseModel):
    """Failure detail for a profile that could not be messaged."""

    profile_id: str
    reason: str


class BulkOperationResponse(BaseModel):
    """Summary of a bulk messaging operation."""

    requested: int
    sent: int
    failed: list[BulkOperationFailure]


class BulkLobbyInviteRequest(BaseModel):
    """Request body for inviting players to a registration lobby."""

    profile_ids: list[str] = Field(min_length=1, max_length=200)
    registration_id: str = Field(min_length=1, max_length=64)


class BulkAnnounceRequest(BaseModel):
    """Request body for sending a free-form announcement to club players."""

    profile_ids: list[str] = Field(min_length=1, max_length=200)
    subject: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=4000)


class ClubPlayerCandidateOut(BaseModel):
    """Candidate returned by club player search."""

    name: str
    profile_id: str | None = None
    past_player_id: str | None = None
    has_hub_profile: bool = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_club(club_id: str) -> dict:
    """Load a club row or raise 404."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM clubs WHERE id = ?", (club_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Club not found")
    return dict(row)


def _require_club_admin(club: dict, user: User) -> None:
    """Raise 403 unless *user* created the club or is a global admin."""
    if club["created_by"] != user.username and user.role != "admin":
        raise HTTPException(403, "Only the club creator or an admin may perform this action")


def _require_club_editor(club: dict, user: User) -> None:
    """Raise 403 unless *user* is the club owner, a co-editor, or a global admin."""
    if user.role == UserRole.ADMIN:
        return
    if club["created_by"] == user.username:
        return
    co_editors = get_club_co_editors(club["id"])
    if user.username not in co_editors:
        raise HTTPException(403, "You do not have editing access to this club")


def _build_club_out(r: dict, *, shared: bool = False) -> ClubOut:
    """Build a ClubOut from a DB row dict."""
    logo_exists = (_LOGOS_DIR / f"{r['id']}.png").exists() if r.get("logo_path") else False
    raw_settings = r.get("email_settings")
    email_settings = json.loads(raw_settings) if raw_settings else None
    return ClubOut(
        id=r["id"],
        community_id=r["community_id"],
        name=r["name"],
        has_logo=logo_exists,
        created_by=r["created_by"],
        created_at=r["created_at"],
        shared=shared,
        email_settings=email_settings,
    )


def _load_player_profile(profile_id: str) -> dict | None:
    """Load a player profile by ID, or None if it does not exist."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
    return dict(row) if row is not None else None


def _find_community_participant(conn, community_id: str, past_player_id: str) -> dict | None:
    """Return latest known participant row for a community + player_id."""
    row = conn.execute(
        """
        SELECT player_id, player_name, seen_at
        FROM (
            SELECT ps.player_id, ps.player_name,
                   COALESCE(ps.finished_at, datetime('now')) AS seen_at
            FROM player_secrets ps
            JOIN tournaments t ON t.id = ps.tournament_id
            WHERE t.community_id = ?
              AND ps.player_id = ?
            UNION ALL
            SELECT ph.player_id, ph.player_name,
                   COALESCE(ph.finished_at, datetime('now')) AS seen_at
            FROM player_history ph
            JOIN tournaments t ON t.id = ph.entity_id
            WHERE ph.entity_type = 'tournament'
              AND t.community_id = ?
              AND ph.player_id = ?
        ) u
        ORDER BY seen_at DESC
        LIMIT 1
        """,
        (community_id, past_player_id, community_id, past_player_id),
    ).fetchone()
    return dict(row) if row is not None else None


def _upsert_default_club_player_rows(
    conn,
    profile_id: str,
    club_id: str,
    community_id: str,
    *,
    is_ghost_insert: bool = False,
) -> None:
    """Ensure both sport rows exist in ``profile_club_elo`` for a profile + club.

    New rows inherit values from ``profile_community_elo`` when available,
    otherwise they default to 1000 ELO and 0 matches.

    Args:
        is_ghost_insert: When True the newly inserted row is created with
            ``hidden = 1`` so ghost profiles are hidden from the main roster
            by default.  The ``hidden`` flag is never touched on conflict
            (an organiser who explicitly un-hid a row keeps it visible).
    """
    hidden_on_insert = 1 if is_ghost_insert else 0
    for sport in ("padel", "tennis"):
        community_row = conn.execute(
            """
            SELECT elo, matches
            FROM profile_community_elo
            WHERE profile_id = ? AND community_id = ? AND sport = ?
            """,
            (profile_id, community_id, sport),
        ).fetchone()
        elo = float(community_row["elo"]) if community_row is not None else 1000.0
        matches = int(community_row["matches"]) if community_row is not None else 0
        conn.execute(
            """
            INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, hidden)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (profile_id, club_id, sport) DO UPDATE SET
                elo = CASE WHEN matches = 0 AND excluded.matches > 0 THEN excluded.elo ELSE elo END,
                matches = CASE WHEN matches = 0 AND excluded.matches > 0 THEN excluded.matches ELSE matches END
            """,
            (profile_id, club_id, sport, elo, matches, hidden_on_insert),
        )


def _sync_club_players_from_community(conn, club_id: str, community_id: str) -> list[tuple[str, str]]:
    """Backfill club player rows from participants in this club's tournaments.

    Automatic addition is scoped to tournaments where ``t.club_id = club_id``
    (i.e. actual club events), not the broader community.  Hub-profile
    discovery / search across the whole community is handled separately by
    ``search_club_player_candidates``.

    Returns:
        List of ``(profile_id, player_id)`` tuples for ghost profiles that need
        a retroactive ELO transfer (either newly created or missing community ELO).
    """
    # 1) Profiles already linked through tournament participation in this club.
    linked_profile_rows = conn.execute(
        """
        SELECT DISTINCT profile_id
        FROM (
            SELECT ps.profile_id AS profile_id
            FROM player_secrets ps
            JOIN tournaments t ON t.id = ps.tournament_id
            WHERE t.club_id = ?
              AND ps.profile_id IS NOT NULL
              AND ps.profile_id != ''
            UNION
            SELECT ph.profile_id AS profile_id
            FROM player_history ph
            JOIN tournaments t ON t.id = ph.entity_id
            WHERE ph.entity_type = 'tournament'
              AND t.club_id = ?
              AND ph.profile_id IS NOT NULL
              AND ph.profile_id != ''
        ) u
        """,
        (club_id, club_id),
    ).fetchall()
    for row in linked_profile_rows:
        _upsert_default_club_player_rows(conn, row["profile_id"], club_id, community_id)

    # 2) Unlinked historical participants in this club's tournaments become
    # ghost profiles and are added (hidden by default).
    unlinked_player_ids = conn.execute(
        """
        SELECT DISTINCT player_id
        FROM (
            SELECT ps.player_id AS player_id
            FROM player_secrets ps
            JOIN tournaments t ON t.id = ps.tournament_id
            WHERE t.club_id = ?
              AND (ps.profile_id IS NULL OR ps.profile_id = '')
            UNION
            SELECT ph.player_id AS player_id
            FROM player_history ph
            JOIN tournaments t ON t.id = ph.entity_id
            WHERE ph.entity_type = 'tournament'
              AND t.club_id = ?
              AND (ph.profile_id IS NULL OR ph.profile_id = '')
        ) u
        """,
        (club_id, club_id),
    ).fetchall()

    needs_elo_transfer: list[tuple[str, str]] = []
    for row in unlinked_player_ids:
        player_id = row["player_id"]
        ghost_id = f"ghost_{player_id}"
        profile, newly_created = _get_or_create_ghost_profile_for_club_participant(conn, community_id, player_id)
        if profile is None:
            continue
        _upsert_default_club_player_rows(conn, profile["id"], club_id, community_id, is_ghost_insert=True)
        if newly_created:
            needs_elo_transfer.append((ghost_id, player_id))
        else:
            # For existing ghost profiles, check if community ELO is still missing/default.
            elo_row = conn.execute(
                "SELECT matches FROM profile_community_elo WHERE profile_id = ? AND community_id = ? AND sport = 'padel'",
                (ghost_id, community_id),
            ).fetchone()
            if elo_row is None or elo_row["matches"] == 0:
                needs_elo_transfer.append((ghost_id, player_id))

    return needs_elo_transfer


def _get_or_create_ghost_profile_for_club_participant(
    conn, community_id: str, past_player_id: str
) -> tuple[dict | None, bool]:
    """Get/create a ghost profile for a prior participant in this community.

    Returns:
        A tuple of (profile_dict_or_None, newly_created).  ``newly_created`` is
        True when the profile row was inserted during this call (first time seen).
    """
    participant = _find_community_participant(conn, community_id, past_player_id)
    if participant is None:
        return None, False

    ghost_id = f"ghost_{past_player_id}"
    profile = conn.execute("SELECT * FROM player_profiles WHERE id = ?", (ghost_id,)).fetchone()
    newly_created = profile is None
    if profile is None:
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """
            INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at, is_ghost)
            VALUES (?, ?, ?, '', '', ?, 1)
            """,
            (ghost_id, secrets.token_hex(16), participant["player_name"], now),
        )
        profile = conn.execute("SELECT * FROM player_profiles WHERE id = ?", (ghost_id,)).fetchone()

    conn.execute(
        """
        UPDATE player_secrets
        SET profile_id = ?
        WHERE player_id = ?
          AND profile_id IS NULL
          AND tournament_id IN (SELECT id FROM tournaments WHERE community_id = ?)
        """,
        (ghost_id, past_player_id, community_id),
    )
    conn.execute(
        """
        UPDATE player_history
        SET profile_id = ?
        WHERE entity_type = 'tournament'
          AND player_id = ?
          AND profile_id IS NULL
          AND entity_id IN (SELECT id FROM tournaments WHERE community_id = ?)
        """,
        (ghost_id, past_player_id, community_id),
    )
    return dict(profile) if profile is not None else None, newly_created


def _club_invite_settings(club: dict) -> tuple[str, str]:
    """Return ``(reply_to, sender_name)`` for club email sends."""
    raw_settings = club.get("email_settings")
    settings: dict = json.loads(raw_settings) if raw_settings else {}
    reply_to = settings.get("reply_to") or ""
    sender_name = settings.get("sender_name") or club["name"]
    return reply_to, sender_name


def _load_registration(registration_id: str) -> dict | None:
    """Return the registration row as a dict, or None if not found."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM registrations WHERE id = ?", (registration_id,)).fetchone()
    return dict(row) if row else None


def _player_in_club(profile_id: str, club_id: str) -> bool:
    """Return whether a profile is visible (not hidden) in the given club."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM profile_club_elo WHERE profile_id = ? AND club_id = ? AND hidden = 0 LIMIT 1",
            (profile_id, club_id),
        ).fetchone()
    return row is not None


def _player_in_community(profile_id: str, community_id: str) -> bool:
    """Return whether a profile has ELO rows in the given community."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM profile_community_elo WHERE profile_id = ? AND community_id = ? LIMIT 1",
            (profile_id, community_id),
        ).fetchone()
    return row is not None


def get_club_for_community(community_id: str) -> ClubOut | None:
    """Return the first club associated with a community, or None.

    When multiple clubs exist in a community, returns the oldest by creation
    date.  Prefer explicit ``club_id``-based lookups in new code.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM clubs WHERE community_id = ? ORDER BY created_at ASC LIMIT 1",
            (community_id,),
        ).fetchone()
    if row is None:
        return None
    return _build_club_out(dict(row))


def get_club_by_id(club_id: str) -> ClubOut | None:
    """Return a club by id, or None if it does not exist."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM clubs WHERE id = ?", (club_id,)).fetchone()
    if row is None:
        return None
    return _build_club_out(dict(row))


def resolve_club_for_scope(community_id: str, club_id: str | None) -> ClubOut | None:
    """Return the club for a tournament/registration scope.

    Prefers an explicit ``club_id`` when set and valid for the given
    ``community_id``; falls back to the first club in the community for
    legacy rows that have no ``club_id``.  An explicit ``club_id`` that
    points to a different community is ignored (treated as legacy data).
    """
    if club_id:
        club = get_club_by_id(club_id)
        if club is not None and club.community_id == community_id:
            return club
    return get_club_for_community(community_id)


def get_club_logo_url(community_id: str, club_id: str | None = None) -> str | None:
    """Return the logo URL for the scope's club, or None.

    If ``club_id`` is provided and resolves to a club with a logo, that club
    is used; otherwise falls back to the first club in the community.
    """
    club = resolve_club_for_scope(community_id, club_id)
    if club is None or not club.has_logo:
        return None
    return f"/api/clubs/{club.id}/logo"


# ---------------------------------------------------------------------------
# Public club lookup (no auth required)
# ---------------------------------------------------------------------------


@router.get("/by-community/{community_id}")
async def get_club_by_community(community_id: str) -> dict:
    """Return minimal club info for a community. Public — used by TV/register."""
    club = get_club_for_community(community_id)
    if club is None:
        raise HTTPException(404, "No club for this community")
    return {
        "id": club.id,
        "name": club.name,
        "has_logo": club.has_logo,
        "logo_url": f"/api/clubs/{club.id}/logo" if club.has_logo else None,
    }


# ---------------------------------------------------------------------------
# Club CRUD
# ---------------------------------------------------------------------------


@router.get("", response_model=list[ClubOut])
async def list_clubs(user: User = Depends(get_current_user)) -> list[ClubOut]:
    """List clubs visible to the current user.

    Admins see all clubs.  Regular users see clubs they created plus clubs
    they have been added to as co-editors.
    """
    with get_db() as conn:
        if user.role == UserRole.ADMIN:
            rows = conn.execute("SELECT * FROM clubs ORDER BY name").fetchall()
            return [_build_club_out(dict(r)) for r in rows]

        owned = conn.execute("SELECT * FROM clubs WHERE created_by = ? ORDER BY name", (user.username,)).fetchall()
        owned_ids = {r["id"] for r in owned}

        shared_ids = set(get_shared_club_ids(user.username))
        shared_rows: list = []
        if shared_ids:
            placeholders = ",".join("?" * len(shared_ids))
            shared_rows = conn.execute(
                f"SELECT * FROM clubs WHERE id IN ({placeholders}) ORDER BY name",
                list(shared_ids),
            ).fetchall()

    out = [_build_club_out(dict(r), shared=False) for r in owned]
    for r in shared_rows:
        if r["id"] not in owned_ids:
            out.append(_build_club_out(dict(r), shared=True))
    out.sort(key=lambda c: c.name.lower())
    return out


@router.get("/{club_id}", response_model=ClubOut)
async def get_club_endpoint(club_id: str) -> ClubOut:
    """Get a club by ID."""
    club = _get_club(club_id)
    return _build_club_out(club)


@router.post("", response_model=ClubOut, status_code=201)
async def create_club(req: ClubCreate, user: User = Depends(get_current_user)) -> ClubOut:
    """Create a club inside an existing community.

    A community can contain multiple clubs (e.g. a city community can host
    several independent player groups).  The built-in ``"open"`` community
    cannot have clubs.  Any authenticated user may create a club in any
    non-open community.
    """
    if user.role != UserRole.ADMIN and not user.can_create_clubs:
        raise HTTPException(403, "Your account is not allowed to create clubs")

    if req.community_id == DEFAULT_COMMUNITY_ID:
        raise HTTPException(400, "Cannot create a club for the built-in Open community")

    with get_db() as conn:
        # Verify community exists
        community = conn.execute("SELECT * FROM communities WHERE id = ?", (req.community_id,)).fetchone()
        if community is None:
            raise HTTPException(404, "Community not found")

        club_id = _generate_id("cl")
        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            "INSERT INTO clubs (id, community_id, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
            (club_id, req.community_id, req.name.strip(), user.username, now),
        )
    return ClubOut(
        id=club_id,
        community_id=req.community_id,
        name=req.name.strip(),
        has_logo=False,
        created_by=user.username,
        created_at=now,
    )


@router.patch("/{club_id}", response_model=ClubOut)
async def update_club(club_id: str, req: ClubUpdate, user: User = Depends(get_current_user)) -> ClubOut:
    """Rename a club.  Club and community names are independent."""
    club = _get_club(club_id)
    _require_club_editor(club, user)
    new_name = req.name.strip()
    with get_db() as conn:
        conn.execute("UPDATE clubs SET name = ? WHERE id = ?", (new_name, club_id))
    club["name"] = new_name
    return _build_club_out(club)


@router.delete("/{club_id}")
async def delete_club(club_id: str, user: User = Depends(get_current_user)) -> dict:
    """Delete a club.

    The underlying community, tournaments, and ELO data are NOT affected.
    Only the club layer (branding, tiers, seasons) is removed.
    """
    club = _get_club(club_id)
    _require_club_admin(club, user)
    with get_db() as conn:
        # Nullify season_id on tournaments that reference seasons of this club
        conn.execute(
            "UPDATE tournaments SET season_id = NULL WHERE season_id IN (SELECT id FROM seasons WHERE club_id = ?)",
            (club_id,),
        )
        conn.execute(
            "UPDATE registrations SET season_id = NULL WHERE season_id IN (SELECT id FROM seasons WHERE club_id = ?)",
            (club_id,),
        )
        # Nullify tier_id on profile_club_elo rows referencing this club's tiers
        conn.execute(
            "UPDATE profile_club_elo SET tier_id = NULL WHERE tier_id IN (SELECT id FROM club_tiers WHERE club_id = ?)",
            (club_id,),
        )
        # Also nullify any legacy tier references in profile_community_elo
        conn.execute(
            "UPDATE profile_community_elo SET tier_id = NULL WHERE tier_id IN (SELECT id FROM club_tiers WHERE club_id = ?)",
            (club_id,),
        )
        # CASCADE deletes seasons and club_tiers (and profile_club_elo via club_id FK)
        conn.execute("DELETE FROM clubs WHERE id = ?", (club_id,))
    # Clean up logo file
    logo_path = _LOGOS_DIR / f"{club_id}.png"
    if logo_path.exists():
        logo_path.unlink(missing_ok=True)
    # Sync in-memory tournament state: drop the deleted club_id, and resync
    # any season_id that the FK cascade nullified in the DB.
    from .state import _tournaments  # noqa: PLC0415

    affected_tids = [tid for tid, data in _tournaments.items() if data.get("club_id") == club_id]
    season_tids = [tid for tid, data in _tournaments.items() if data.get("season_id")]
    if season_tids:
        with get_db() as conn:
            placeholders = ",".join("?" * len(season_tids))
            rows = conn.execute(
                f"SELECT id, season_id FROM tournaments WHERE id IN ({placeholders})",
                season_tids,
            ).fetchall()
            db_season_by_tid = {r["id"]: r["season_id"] for r in rows}
        for tid in season_tids:
            if _tournaments[tid].get("season_id") != db_season_by_tid.get(tid):
                _tournaments[tid]["season_id"] = db_season_by_tid.get(tid)
    for tid in affected_tids:
        _tournaments[tid]["club_id"] = None
    return {"ok": True}


# ---------------------------------------------------------------------------
# Logo upload / serve
# ---------------------------------------------------------------------------


@router.put("/{club_id}/logo")
async def upload_logo(club_id: str, file: UploadFile, user: User = Depends(get_current_user)) -> dict:
    """Upload or replace the club logo.

    Accepts PNG, JPEG, or WebP images up to 5 MB.  The image is
    resized to fit within 256×256 px and saved as optimised PNG.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)

    if file.content_type not in ("image/png", "image/jpeg", "image/webp"):
        raise HTTPException(400, "Logo must be PNG, JPEG, or WebP")

    content = await file.read()
    if len(content) > _MAX_LOGO_BYTES:
        raise HTTPException(400, f"Logo exceeds maximum size of {_MAX_LOGO_BYTES // (1024 * 1024)} MB")

    # Resize & compress with Pillow
    try:
        img = Image.open(io.BytesIO(content))
        img = img.convert("RGBA") if img.mode in ("RGBA", "LA", "P") else img.convert("RGB")
        img.thumbnail((_LOGO_MAX_PX, _LOGO_MAX_PX), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG", optimize=True)
        optimised = buf.getvalue()
    except Exception as exc:
        raise HTTPException(400, f"Invalid image file: {exc}") from exc

    _LOGOS_DIR.mkdir(parents=True, exist_ok=True)
    logo_path = _LOGOS_DIR / f"{club_id}.png"
    logo_path.write_bytes(optimised)

    with get_db() as conn:
        conn.execute("UPDATE clubs SET logo_path = ? WHERE id = ?", (str(logo_path), club_id))

    return {"ok": True}


@router.delete("/{club_id}/logo")
async def delete_logo(club_id: str, user: User = Depends(get_current_user)) -> dict:
    """Remove the club logo."""
    club = _get_club(club_id)
    _require_club_editor(club, user)

    logo_path = _LOGOS_DIR / f"{club_id}.png"
    if logo_path.exists():
        logo_path.unlink(missing_ok=True)
    with get_db() as conn:
        conn.execute("UPDATE clubs SET logo_path = NULL WHERE id = ?", (club_id,))
    return {"ok": True}


@router.get("/{club_id}/logo")
async def get_logo(club_id: str) -> FileResponse:
    """Serve the club logo image."""
    logo_path = _LOGOS_DIR / f"{club_id}.png"
    if not logo_path.exists():
        raise HTTPException(404, "No logo uploaded")
    return FileResponse(
        logo_path,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )


# ---------------------------------------------------------------------------
# Club tiers
# ---------------------------------------------------------------------------


@router.get("/{club_id}/tiers", response_model=list[TierOut])
async def list_tiers(club_id: str) -> list[TierOut]:
    """List all tiers for a club, ordered by position."""
    _get_club(club_id)  # 404 if club doesn't exist
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM club_tiers WHERE club_id = ? ORDER BY position, name",
            (club_id,),
        ).fetchall()
    return [TierOut(**dict(r)) for r in rows]


@router.post("/{club_id}/tiers", response_model=TierOut, status_code=201)
async def create_tier(club_id: str, req: TierCreate, user: User = Depends(get_current_user)) -> TierOut:
    """Create a new tier for a club."""
    club = _get_club(club_id)
    _require_club_editor(club, user)
    tier_id = _generate_id("ct")
    with get_db() as conn:
        conn.execute(
            "INSERT INTO club_tiers (id, club_id, name, sport, base_elo, position) VALUES (?, ?, ?, ?, ?, ?)",
            (tier_id, club_id, req.name.strip(), req.sport, req.base_elo, req.position),
        )
    return TierOut(
        id=tier_id,
        club_id=club_id,
        name=req.name.strip(),
        sport=req.sport,
        base_elo=req.base_elo,
        position=req.position,
    )


@router.patch("/{club_id}/tiers/{tier_id}", response_model=TierOut)
async def update_tier(club_id: str, tier_id: str, req: TierUpdate, user: User = Depends(get_current_user)) -> TierOut:
    """Update a tier's name, base_elo, or position."""
    club = _get_club(club_id)
    _require_club_editor(club, user)
    with get_db() as conn:
        row = conn.execute("SELECT * FROM club_tiers WHERE id = ? AND club_id = ?", (tier_id, club_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Tier not found")
        updates: list[str] = []
        params: list = []
        if req.name is not None:
            updates.append("name = ?")
            params.append(req.name.strip())
        if req.base_elo is not None:
            updates.append("base_elo = ?")
            params.append(req.base_elo)
        if req.position is not None:
            updates.append("position = ?")
            params.append(req.position)
        if updates:
            params.append(tier_id)
            conn.execute(f"UPDATE club_tiers SET {', '.join(updates)} WHERE id = ?", params)
        updated = conn.execute("SELECT * FROM club_tiers WHERE id = ?", (tier_id,)).fetchone()
    return TierOut(**dict(updated))


@router.delete("/{club_id}/tiers/{tier_id}")
async def delete_tier(club_id: str, tier_id: str, user: User = Depends(get_current_user)) -> dict:
    """Delete a tier.  Nullifies tier_id on affected profile_community_elo rows."""
    club = _get_club(club_id)
    _require_club_editor(club, user)
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM club_tiers WHERE id = ? AND club_id = ?", (tier_id, club_id)).fetchone()
        if row is None:
            raise HTTPException(404, "Tier not found")
        conn.execute("UPDATE profile_club_elo SET tier_id = NULL WHERE tier_id = ?", (tier_id,))
        conn.execute("UPDATE profile_community_elo SET tier_id = NULL WHERE tier_id = ?", (tier_id,))
        conn.execute("DELETE FROM club_tiers WHERE id = ?", (tier_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Club players — ELO & tier management
# ---------------------------------------------------------------------------


@router.get("/{club_id}/players", response_model=list[ClubPlayerOut])
async def list_club_players(
    club_id: str,
    sport: str = Query(default="", pattern=r"^(|padel|tennis)$"),
    user: User = Depends(get_current_user),
) -> list[ClubPlayerOut]:
    """List club players with their club-local ELO and tier info.

    When ``sport`` is provided, only players visible for that sport are
    returned. This is used by tournament creation so hidden padel/tennis club
    players are not proposed for the wrong sport.
    """
    club = _get_club(club_id)
    with get_db() as conn:
        needs_elo_transfer = _sync_club_players_from_community(conn, club_id, club["community_id"])

    # Call retroactive ELO transfer for ghost profiles outside the transaction
    # to avoid nested DB connections.  After transfer, re-sync club ELO rows.
    if needs_elo_transfer:
        for profile_id, player_id in needs_elo_transfer:
            retroactive_transfer_elo(profile_id, player_id)
        with get_db() as conn:
            for profile_id, _ in needs_elo_transfer:
                _upsert_default_club_player_rows(conn, profile_id, club_id, club["community_id"], is_ghost_insert=True)

    with get_db() as conn:
        rows = conn.execute(
            """SELECT pce.profile_id, pce.sport, pce.elo, pce.matches, pce.tier_id, pce.hidden,
                      pp.name AS player_name, pp.email AS player_email, pp.is_ghost AS player_is_ghost,
                      ct.name AS tier_name
               FROM profile_club_elo pce
               JOIN player_profiles pp ON pp.id = pce.profile_id
               LEFT JOIN club_tiers ct ON ct.id = pce.tier_id
               WHERE pce.club_id = ? AND pp.is_ghost = 0
                 AND EXISTS (
                     SELECT 1 FROM profile_club_elo sub
                     WHERE sub.profile_id = pce.profile_id AND sub.club_id = ? AND sub.hidden = 0
                 )
               ORDER BY pp.name""",
            (club_id, club_id),
        ).fetchall()
        # Live-derive matches and latest ELO from player_elo_log scoped to this
        # club's tournaments. profile_club_elo.matches/elo are stale snapshots
        # that are only seeded on insert and never incremented per match, so
        # the leaderboard would otherwise lag behind actual play.
        live_rows = conn.execute(
            """
            WITH linked_tournament_players AS (
                SELECT ps.profile_id AS profile_id,
                       ps.tournament_id AS tournament_id,
                       ps.player_id AS player_id
                  FROM player_secrets ps
                 WHERE ps.profile_id IN (
                     SELECT profile_id FROM profile_club_elo WHERE club_id = ?
                 )
                UNION
                SELECT ph.profile_id AS profile_id,
                       ph.entity_id AS tournament_id,
                       ph.player_id AS player_id
                  FROM player_history ph
                 WHERE ph.entity_type = 'tournament'
                   AND ph.profile_id IN (
                       SELECT profile_id FROM profile_club_elo WHERE club_id = ?
                   )
            ),
            scoped AS (
                SELECT lp.profile_id  AS profile_id,
                       l.sport        AS sport,
                       l.elo_after    AS elo_after,
                       l.is_manual    AS is_manual,
                       l.updated_at   AS updated_at,
                       l.match_order  AS match_order
                  FROM player_elo_log l
                  JOIN linked_tournament_players lp
                    ON lp.tournament_id = l.tournament_id
                   AND lp.player_id = l.player_id
                  JOIN tournaments t
                    ON t.id = l.tournament_id
                 WHERE t.club_id = ?
            ),
            matches_agg AS (
                SELECT s.profile_id,
                       s.sport,
                       SUM(CASE WHEN s.is_manual = 0 THEN 1 ELSE 0 END) AS matches
                  FROM scoped s
              GROUP BY s.profile_id, s.sport
            ),
            latest AS (
                SELECT s.profile_id,
                       s.sport,
                       s.elo_after,
                       ROW_NUMBER() OVER (
                           PARTITION BY s.profile_id, s.sport
                           ORDER BY s.updated_at DESC, s.match_order DESC
                       ) AS rn
                  FROM scoped s
            )
            SELECT m.profile_id  AS profile_id,
                   m.sport       AS sport,
                   m.matches     AS matches,
                   lt.elo_after  AS elo
              FROM matches_agg m
         LEFT JOIN latest lt
                ON lt.profile_id = m.profile_id
               AND lt.sport = m.sport
               AND lt.rn = 1
            """,
            (club_id, club_id, club_id),
        ).fetchall()

    live_by_key: dict[tuple[str, str], dict[str, float | int | None]] = {
        (r["profile_id"], r["sport"]): {
            "matches": int(r["matches"] or 0),
            "elo": r["elo"],
        }
        for r in live_rows
    }

    # Pivot: group by profile_id, combine padel + tennis rows.
    # Rows include hidden sport rows so that hidden_padel / hidden_tennis flags are populated.
    players: dict[str, ClubPlayerOut] = {}
    for r in rows:
        pid = r["profile_id"]
        if pid not in players:
            players[pid] = ClubPlayerOut(
                profile_id=pid,
                name=r["player_name"],
                email=r["player_email"],
                has_hub_profile=not bool(r["player_is_ghost"]),
            )
        p = players[pid]
        live = live_by_key.get((pid, r["sport"]), {})
        live_matches = int(live.get("matches") or 0)
        live_elo = live.get("elo")
        # Prefer live ELO from match logs; fall back to the snapshot (which
        # captures tier base ELO and admin-set manual overrides) when the
        # player has no logged matches in this club yet.
        effective_elo = live_elo if live_elo is not None else r["elo"]
        if r["sport"] == "padel":
            p.elo_padel = round(effective_elo, 1) if effective_elo is not None else None
            p.matches_padel = live_matches
            p.tier_id_padel = r["tier_id"]
            p.tier_name_padel = r["tier_name"]
            p.hidden_padel = bool(r["hidden"])
        elif r["sport"] == "tennis":
            p.elo_tennis = round(effective_elo, 1) if effective_elo is not None else None
            p.matches_tennis = live_matches
            p.tier_id_tennis = r["tier_id"]
            p.tier_name_tennis = r["tier_name"]
            p.hidden_tennis = bool(r["hidden"])
    player_list = list(players.values())
    if sport == "padel":
        return [player for player in player_list if not player.hidden_padel]
    if sport == "tennis":
        return [player for player in player_list if not player.hidden_tennis]
    return player_list


@router.post("/{club_id}/players", response_model=ClubPlayerOut, status_code=201)
async def add_player_to_club(club_id: str, req: ClubPlayerAdd, user: User = Depends(get_current_user)) -> ClubPlayerOut:
    """Manually add a player profile to the club's community.

    Creates ``profile_community_elo`` rows (one per sport) with default ELO 1000
    and 0 matches if they do not already exist.  Returns the player entry.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)
    community_id = club["community_id"]

    if bool(req.profile_id) == bool(req.past_player_id):
        raise HTTPException(422, "Provide exactly one of profile_id or past_player_id")

    ghost_player_id: str | None = None
    with get_db() as conn:
        profile = None
        profile_id = ""
        if req.profile_id is not None:
            profile = conn.execute("SELECT * FROM player_profiles WHERE id = ?", (req.profile_id,)).fetchone()
            if profile is None:
                raise HTTPException(404, "Player profile not found")
            profile_id = req.profile_id
        else:
            assert req.past_player_id is not None
            profile_dict, newly_created = _get_or_create_ghost_profile_for_club_participant(
                conn, community_id, req.past_player_id
            )
            if profile_dict is None:
                raise HTTPException(404, "Past participant not found in this club community")
            profile = profile_dict
            profile_id = profile_dict["id"]
            if newly_created:
                ghost_player_id = req.past_player_id

        for sport in ("padel", "tennis"):
            conn.execute(
                """
                INSERT OR IGNORE INTO profile_club_elo
                    (profile_id, club_id, sport, elo, matches)
                VALUES (?, ?, ?, 1000, 0)
                """,
                (profile_id, club_id, sport),
            )
        # Seed ELO/matches from this community's snapshot (no-op when the row
        # already has matches recorded).  This applies to both hub profiles
        # and ghosts so explicit add mirrors the auto-sync seeding.
        _upsert_default_club_player_rows(conn, profile_id, club_id, community_id)
        # Ensure the row is visible in the main roster (un-hide if it was a
        # ghost that had been auto-synced with hidden=1).
        conn.execute(
            "UPDATE profile_club_elo SET hidden = 0 WHERE profile_id = ? AND club_id = ?",
            (profile_id, club_id),
        )

    # Transfer retroactive ELO outside the transaction for newly-created ghost profiles.
    if ghost_player_id is not None:
        retroactive_transfer_elo(profile_id, ghost_player_id)
        with get_db() as conn:
            _upsert_default_club_player_rows(conn, profile_id, club_id, community_id)

    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT pce.profile_id, pce.sport, pce.elo, pce.matches, pce.tier_id,
                   pp.name AS player_name, pp.email AS player_email, pp.is_ghost AS player_is_ghost,
                   ct.name AS tier_name
            FROM profile_club_elo pce
            JOIN player_profiles pp ON pp.id = pce.profile_id
            LEFT JOIN club_tiers ct ON ct.id = pce.tier_id
            WHERE pce.club_id = ? AND pce.profile_id = ?
            """,
            (club_id, profile_id),
        ).fetchall()

    profile_is_ghost = bool(profile["is_ghost"]) if "is_ghost" in profile.keys() else False
    player = ClubPlayerOut(
        profile_id=profile_id,
        name=profile["name"],
        email=profile["email"],
        has_hub_profile=not profile_is_ghost,
    )
    for r in rows:
        if r["sport"] == "padel":
            player.elo_padel = round(r["elo"], 1)
            player.matches_padel = r["matches"]
            player.tier_id_padel = r["tier_id"]
            player.tier_name_padel = r["tier_name"]
        elif r["sport"] == "tennis":
            player.elo_tennis = round(r["elo"], 1)
            player.matches_tennis = r["matches"]
            player.tier_id_tennis = r["tier_id"]
            player.tier_name_tennis = r["tier_name"]
    return player


@router.get("/{club_id}/players/candidates", response_model=list[ClubPlayerCandidateOut])
async def search_club_player_candidates(
    club_id: str,
    q: str = "",
    user: User = Depends(get_current_user),
) -> list[ClubPlayerCandidateOut]:
    """Search player candidates for club add-player flow.

    Returns:
        - Player Hub profiles (has_hub_profile=true)
        - Past participants in this club's community without a linked profile
          (has_hub_profile=false, returned as ``past_player_id``)
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)
    query = q.strip()
    if len(query) < 2:
        return []

    community_id = club["community_id"]
    pattern = f"%{query}%"
    with get_db() as conn:
        hub_rows = conn.execute(
            """
            SELECT id, name
            FROM player_profiles
            WHERE is_ghost = 0
              AND (name LIKE ? OR email LIKE ?)
              AND EXISTS (
                  SELECT 1 FROM profile_community_elo pce
                  WHERE pce.profile_id = player_profiles.id
                    AND pce.community_id = ?
              )
            ORDER BY name
            LIMIT 15
            """,
            (pattern, pattern, community_id),
        ).fetchall()

        past_rows = conn.execute(
            """
            SELECT player_id, player_name, seen_at
            FROM (
                SELECT ps.player_id, ps.player_name,
                       COALESCE(ps.finished_at, datetime('now')) AS seen_at
                FROM player_secrets ps
                JOIN tournaments t ON t.id = ps.tournament_id
                WHERE t.community_id = ?
                  AND ps.profile_id IS NULL
                  AND ps.player_name LIKE ?
                UNION ALL
                SELECT ph.player_id, ph.player_name,
                       COALESCE(ph.finished_at, datetime('now')) AS seen_at
                FROM player_history ph
                JOIN tournaments t ON t.id = ph.entity_id
                WHERE ph.entity_type = 'tournament'
                  AND t.community_id = ?
                  AND ph.profile_id IS NULL
                  AND ph.player_name LIKE ?
            ) u
            ORDER BY seen_at DESC
            LIMIT 200
            """,
            (community_id, pattern, community_id, pattern),
        ).fetchall()

    results: list[ClubPlayerCandidateOut] = [
        ClubPlayerCandidateOut(name=r["name"], profile_id=r["id"], has_hub_profile=True) for r in hub_rows
    ]

    seen_past_ids: set[str] = set()
    for r in past_rows:
        pid = r["player_id"]
        if pid in seen_past_ids:
            continue
        seen_past_ids.add(pid)
        results.append(
            ClubPlayerCandidateOut(
                name=r["player_name"],
                past_player_id=pid,
                has_hub_profile=False,
            )
        )
        if len(seen_past_ids) >= 15:
            break

    return results


class GhostDuplicateGroup(BaseModel):
    """A group of ghost profiles in the club that share the same name."""

    name: str
    profiles: list[ClubPlayerOut]


class ClubGhostConsolidateRequest(BaseModel):
    """Request body for consolidating ghost profiles within a club."""

    source_ids: list[str] = Field(min_length=2)
    name: str | None = Field(default=None, max_length=128)


@router.get("/{club_id}/players/possible-members", response_model=list[ClubPlayerOut])
async def list_possible_members(
    club_id: str,
    user: User = Depends(get_current_user),
) -> list[ClubPlayerOut]:
    """Return ghost profiles linked to the club — past participants not yet on the roster.

    These are players who participated in community tournaments under this club
    and were auto-synced as ghost profiles.  They are hidden from the main
    roster by default until explicitly added or converted.

    Returns:
        Flat list of ghost profiles ordered by name.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)

    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT pce.profile_id, pce.sport, pce.elo, pce.matches, pce.tier_id,
                   pp.name AS player_name, pp.email AS player_email,
                   ct.name AS tier_name
              FROM profile_club_elo pce
              JOIN player_profiles pp ON pp.id = pce.profile_id
              LEFT JOIN club_tiers ct ON ct.id = pce.tier_id
             WHERE pce.club_id = ? AND pp.is_ghost = 1 AND pce.hidden = 1
             ORDER BY LOWER(pp.name), pp.name
            """,
            (club_id,),
        ).fetchall()

    players: dict[str, ClubPlayerOut] = {}
    for r in rows:
        pid = r["profile_id"]
        if pid not in players:
            players[pid] = ClubPlayerOut(
                profile_id=pid,
                name=r["player_name"],
                email=r["player_email"],
                has_hub_profile=False,
            )
        p = players[pid]
        if r["sport"] == "padel":
            p.elo_padel = round(r["elo"], 1)
            p.matches_padel = r["matches"]
            p.tier_id_padel = r["tier_id"]
            p.tier_name_padel = r["tier_name"]
        elif r["sport"] == "tennis":
            p.elo_tennis = round(r["elo"], 1)
            p.matches_tennis = r["matches"]
            p.tier_id_tennis = r["tier_id"]
            p.tier_name_tennis = r["tier_name"]

    return list(players.values())


@router.get("/{club_id}/players/ghost-duplicates", response_model=list[GhostDuplicateGroup])
async def list_ghost_duplicates(
    club_id: str,
    user: User = Depends(get_current_user),
) -> list[GhostDuplicateGroup]:
    """Return groups of ghost profiles in the club that share the same name.

    All ghost profiles linked to this club are considered, regardless of their
    ``hidden`` status.  Each group in the result has ≥ 2 members and represents
    a likely-duplicate set for the same real-world player.

    Returns:
        List of groups, each with a ``name`` and the ``profiles`` that
        share it.  Empty when no duplicates exist.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)

    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT pce.profile_id, pce.sport, pce.elo, pce.matches, pce.tier_id,
                   pp.name AS player_name, pp.email AS player_email,
                   ct.name AS tier_name
              FROM profile_club_elo pce
              JOIN player_profiles pp ON pp.id = pce.profile_id
              LEFT JOIN club_tiers ct ON ct.id = pce.tier_id
             WHERE pce.club_id = ? AND pp.is_ghost = 1
             ORDER BY LOWER(pp.name), pp.name
            """,
            (club_id,),
        ).fetchall()

    players: dict[str, ClubPlayerOut] = {}
    for r in rows:
        pid = r["profile_id"]
        if pid not in players:
            players[pid] = ClubPlayerOut(
                profile_id=pid,
                name=r["player_name"],
                email=r["player_email"],
                has_hub_profile=False,
            )
        p = players[pid]
        if r["sport"] == "padel":
            p.elo_padel = round(r["elo"], 1)
            p.matches_padel = r["matches"]
            p.tier_id_padel = r["tier_id"]
            p.tier_name_padel = r["tier_name"]
        elif r["sport"] == "tennis":
            p.elo_tennis = round(r["elo"], 1)
            p.matches_tennis = r["matches"]
            p.tier_id_tennis = r["tier_id"]
            p.tier_name_tennis = r["tier_name"]

    name_groups: dict[str, list[ClubPlayerOut]] = {}
    for p in players.values():
        key = p.name.lower().strip()
        name_groups.setdefault(key, []).append(p)

    return [
        GhostDuplicateGroup(name=group[0].name, profiles=group) for group in name_groups.values() if len(group) >= 2
    ]


@router.post("/{club_id}/players/consolidate-ghosts", response_model=ClubPlayerOut)
async def consolidate_club_ghost_profiles(
    club_id: str,
    req: ClubGhostConsolidateRequest,
    user: User = Depends(get_current_user),
) -> ClubPlayerOut:
    """Merge multiple ghost profiles into a single canonical profile within a club.

    The first id in ``source_ids`` becomes the primary.  All participations,
    history rows, and ELO data from secondary profiles are reassigned to the
    primary, secondary profiles are deleted, and ELO is recalculated
    chronologically so the merged profile reflects the correct current rating.

    All profiles must be ghost profiles (``is_ghost = 1``).  After
    consolidation the merged profile remains visible in the club.

    Args:
        req: ``source_ids`` (≥ 2 distinct ghost profile ids) and an optional
            ``name`` to assign to the surviving profile.

    Returns:
        The updated primary profile as it appears in the club player list.

    Raises:
        HTTPException 404: One or more profiles not found.
        HTTPException 422: Fewer than 2 distinct ids, or any profile is not
            a ghost.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)

    unique_ids: list[str] = list(dict.fromkeys(req.source_ids))
    if len(unique_ids) < 2:
        raise HTTPException(422, "At least 2 distinct profile IDs are required")

    primary_id = unique_ids[0]
    secondary_ids = unique_ids[1:]

    with get_db() as conn:
        placeholders = ",".join("?" for _ in unique_ids)
        profiles = conn.execute(
            f"SELECT id, is_ghost FROM player_profiles WHERE id IN ({placeholders})",
            unique_ids,
        ).fetchall()

        found_ids = {r["id"] for r in profiles}
        missing = set(unique_ids) - found_ids
        if missing:
            raise HTTPException(404, f"Profiles not found: {', '.join(sorted(missing))}")

        non_ghost = [r["id"] for r in profiles if not r["is_ghost"]]
        if non_ghost:
            raise HTTPException(
                422,
                f"Only ghost profiles can be consolidated. Non-ghost profiles: {', '.join(sorted(non_ghost))}",
            )

        if req.name:
            conn.execute(
                "UPDATE player_profiles SET name = ? WHERE id = ?",
                (req.name.strip(), primary_id),
            )

        for secondary_id in secondary_ids:
            conn.execute(
                "UPDATE player_secrets SET profile_id = ? WHERE profile_id = ?",
                (primary_id, secondary_id),
            )
            conn.execute(
                """DELETE FROM player_history
                   WHERE profile_id = ?
                     AND entity_type = 'tournament'
                     AND entity_id IN (
                         SELECT entity_id FROM player_history
                          WHERE profile_id = ? AND entity_type = 'tournament'
                     )""",
                (secondary_id, primary_id),
            )
            conn.execute(
                "UPDATE player_history SET profile_id = ? WHERE profile_id = ?",
                (primary_id, secondary_id),
            )
            conn.execute("DELETE FROM profile_community_elo WHERE profile_id = ?", (secondary_id,))
            conn.execute("DELETE FROM profile_club_elo WHERE profile_id = ?", (secondary_id,))
            conn.execute("DELETE FROM player_profiles WHERE id = ?", (secondary_id,))

        all_player_ids = [
            r["player_id"]
            for r in conn.execute(
                """
                SELECT DISTINCT player_id FROM (
                    SELECT player_id FROM player_secrets
                     WHERE profile_id = ? AND player_id IS NOT NULL
                    UNION
                    SELECT player_id FROM player_history
                     WHERE profile_id = ? AND entity_type = 'tournament'
                       AND player_id IS NOT NULL
                )
                """,
                (primary_id, primary_id),
            ).fetchall()
        ]

    consolidate_ghost_elos(primary_id, all_player_ids)

    with get_db() as conn:
        _upsert_default_club_player_rows(conn, primary_id, club_id, club["community_id"])

    with get_db() as conn:
        rows = conn.execute(
            """SELECT pce.profile_id, pce.sport, pce.elo, pce.matches, pce.tier_id,
                      pp.name AS player_name, pp.email AS player_email,
                      ct.name AS tier_name
               FROM profile_club_elo pce
               JOIN player_profiles pp ON pp.id = pce.profile_id
               LEFT JOIN club_tiers ct ON ct.id = pce.tier_id
               WHERE pce.club_id = ? AND pce.profile_id = ? AND pce.hidden = 0""",
            (club_id, primary_id),
        ).fetchall()
        profile_name_row = conn.execute("SELECT name FROM player_profiles WHERE id = ?", (primary_id,)).fetchone()

    player = ClubPlayerOut(
        profile_id=primary_id,
        name=profile_name_row["name"] if profile_name_row else primary_id,
        has_hub_profile=False,
    )
    for r in rows:
        if r["sport"] == "padel":
            player.elo_padel = round(r["elo"], 1)
            player.matches_padel = r["matches"]
            player.tier_id_padel = r["tier_id"]
            player.tier_name_padel = r["tier_name"]
        elif r["sport"] == "tennis":
            player.elo_tennis = round(r["elo"], 1)
            player.matches_tennis = r["matches"]
            player.tier_id_tennis = r["tier_id"]
            player.tier_name_tennis = r["tier_name"]
    return player


class ClubConvertGhostRequest(BaseModel):
    """Request body for converting a ghost profile into a real Player Hub profile."""

    name: str | None = Field(default=None, max_length=128)
    email: str | None = Field(default=None, max_length=256)
    lang: EmailLang = "en"


class ClubConvertResult(BaseModel):
    """Result of converting a ghost profile within a club."""

    profile_id: str
    name: str
    passphrase: str
    email: str = ""
    is_ghost: bool = False


@router.post("/{club_id}/players/{profile_id}/convert-ghost", response_model=ClubConvertResult)
async def club_convert_ghost_to_hub_profile(
    club_id: str,
    profile_id: str,
    req: ClubConvertGhostRequest,
    user: User = Depends(get_current_user),
) -> ClubConvertResult:
    """Convert a ghost profile into a real Player Hub profile within a club context.

    Generates a unique 3-word passphrase and sets ``is_ghost = 0``.  All
    existing participations, ELO data, and history rows are retained.
    If ``email`` is supplied, a welcome email with the new passphrase is
    sent to the player immediately.

    Args:
        club_id: Club the organizer manages.
        profile_id: ID of the ghost profile to convert.
        req: Optional ``name`` override, optional ``email``, and ``lang``.

    Returns:
        The new profile id, name, and passphrase.

    Raises:
        HTTPException 404: Profile not found.
        HTTPException 422: Profile is not a ghost.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)

    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, email, is_ghost FROM player_profiles WHERE id = ?",
            (profile_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(404, "Profile not found")
    if not row["is_ghost"]:
        raise HTTPException(422, "Profile is already a real Hub profile, not a ghost")

    new_passphrase = generate_passphrase()
    with get_db() as conn:
        while conn.execute(
            "SELECT 1 FROM player_profiles WHERE passphrase = ? AND id != ?",
            (new_passphrase, profile_id),
        ).fetchone():
            new_passphrase = generate_passphrase()

    clean_name = req.name.strip() if req.name else row["name"]
    clean_email = req.email.strip() if req.email else (row["email"] or "")

    if clean_email and not is_valid_email(clean_email):
        raise HTTPException(422, "Invalid email address")

    with get_db() as conn:
        conn.execute(
            "UPDATE player_profiles SET is_ghost = 0, passphrase = ?, name = ?, email = ? WHERE id = ?",
            (new_passphrase, clean_name, clean_email, profile_id),
        )
        # Un-hide the profile in all clubs so it appears in the main roster.
        conn.execute(
            "UPDATE profile_club_elo SET hidden = 0 WHERE profile_id = ?",
            (profile_id,),
        )

    if clean_email:
        token = create_profile_token(profile_id, expires_delta=timedelta(days=30))
        verify_token = create_profile_email_verify_token(profile_id, clean_email)
        subject, html_body = render_player_space_welcome(
            name=clean_name,
            email=clean_email,
            passphrase=new_passphrase,
            access_token=token,
            verify_token=verify_token,
            lang=req.lang,
        )
        send_email_background(clean_email, subject, html_body)

    return ClubConvertResult(
        profile_id=profile_id,
        name=clean_name,
        passphrase=new_passphrase,
        email=clean_email,
        is_ghost=False,
    )


@router.patch("/{club_id}/players/{profile_id}/sport-visibility")
async def update_player_sport_visibility(
    club_id: str,
    profile_id: str,
    req: SportVisibilityUpdate,
    user: User = Depends(get_current_user),
) -> dict:
    """Toggle a player's visibility for a specific sport within the club.

    When hidden, the player is excluded from that sport's leaderboard and
    ratings.  Their match history and ELO are preserved.  Players removed
    from all sports entirely (via DELETE) must be re-added explicitly.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)
    with get_db() as conn:
        conn.execute(
            "UPDATE profile_club_elo SET hidden = ? WHERE profile_id = ? AND club_id = ? AND sport = ?",
            (1 if req.hidden else 0, profile_id, club_id, req.sport),
        )
    return {"ok": True}


@router.delete("/{club_id}/players/{profile_id}")
async def remove_player_from_club(club_id: str, profile_id: str, user: User = Depends(get_current_user)) -> dict:
    """Hide a player from the club's player list.

    Sets ``hidden = 1`` on the ``profile_club_elo`` rows for this player so
    they are excluded from the list and leaderboard.  The player is never
    re-added by the community auto-sync because ``INSERT OR UPDATE`` respects
    the existing hidden row.  Community ELO history and match records are not
    affected.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)
    with get_db() as conn:
        conn.execute(
            "UPDATE profile_club_elo SET hidden = 1 WHERE profile_id = ? AND club_id = ?",
            (profile_id, club_id),
        )
    return {"ok": True}


@router.post("/{club_id}/players/invite-lobby", response_model=BulkOperationResponse)
async def invite_players_to_lobby(
    club_id: str, req: BulkLobbyInviteRequest, user: User = Depends(get_current_user)
) -> BulkOperationResponse:
    """Send lobby invite emails to selected club players.

    Each email links directly to the registration page.  Players with a Player Hub
    session will have their name/email pre-filled by the registration form.
    The registration must belong to the same community as the club.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)

    reg = _load_registration(req.registration_id)
    if reg is None:
        raise HTTPException(404, "Registration not found")
    if reg.get("community_id") != club["community_id"]:
        raise HTTPException(422, "Registration does not belong to this club's community")

    reply_to, sender_name = _club_invite_settings(club)
    unique_profile_ids = list(dict.fromkeys(req.profile_ids))
    failures: list[BulkOperationFailure] = []
    sent = 0

    for profile_id in unique_profile_ids:
        if not _player_in_club(profile_id, club_id):
            failures.append(BulkOperationFailure(profile_id=profile_id, reason="Player not found in this club"))
            continue
        profile = _load_player_profile(profile_id)
        if profile is None:
            failures.append(BulkOperationFailure(profile_id=profile_id, reason="Player profile not found"))
            continue
        email = profile.get("email")
        if not email or not is_valid_email(email):
            failures.append(BulkOperationFailure(profile_id=profile_id, reason="Player has no valid email address"))
            continue
        subject, body = render_club_lobby_invite_email(
            club_name=club["name"],
            lobby_name=reg["name"],
            player_name=profile.get("name") or "there",
            registration_alias=reg.get("alias") or None,
            registration_id=reg["id"],
            reply_to=reply_to,
            sender_name=sender_name,
        )
        send_email_background(email, subject, body, sender_name=sender_name, reply_to=reply_to)
        sent += 1

    return BulkOperationResponse(requested=len(unique_profile_ids), sent=sent, failed=failures)


@router.post("/{club_id}/players/announce", response_model=BulkOperationResponse)
async def announce_to_players(
    club_id: str, req: BulkAnnounceRequest, user: User = Depends(get_current_user)
) -> BulkOperationResponse:
    """Send a free-form announcement email to selected club players."""
    club = _get_club(club_id)
    _require_club_editor(club, user)

    reply_to, sender_name = _club_invite_settings(club)
    unique_profile_ids = list(dict.fromkeys(req.profile_ids))
    failures: list[BulkOperationFailure] = []
    sent = 0

    for profile_id in unique_profile_ids:
        if not _player_in_club(profile_id, club_id):
            failures.append(BulkOperationFailure(profile_id=profile_id, reason="Player not found in this club"))
            continue
        profile = _load_player_profile(profile_id)
        if profile is None:
            failures.append(BulkOperationFailure(profile_id=profile_id, reason="Player profile not found"))
            continue
        email = profile.get("email")
        if not email or not is_valid_email(email):
            failures.append(BulkOperationFailure(profile_id=profile_id, reason="Player has no valid email address"))
            continue
        _, body = render_club_announcement_email(
            club_name=club["name"],
            player_name=profile.get("name") or "there",
            subject=req.subject,
            message=req.message,
            reply_to=reply_to,
            sender_name=sender_name,
        )
        send_email_background(email, req.subject, body, sender_name=sender_name, reply_to=reply_to)
        sent += 1

    return BulkOperationResponse(requested=len(unique_profile_ids), sent=sent, failed=failures)


@router.patch("/{club_id}/players/{profile_id}/elo")
async def set_player_elo(
    club_id: str, profile_id: str, req: PlayerEloUpdate, user: User = Depends(get_current_user)
) -> dict:
    """Manually set a player's ELO within the club scope."""
    club = _get_club(club_id)
    _require_club_editor(club, user)
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM profile_club_elo WHERE profile_id = ? AND club_id = ? AND sport = ?",
            (profile_id, club_id, req.sport),
        ).fetchone()
        if existing is None:
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches) VALUES (?, ?, ?, ?, 0)",
                (profile_id, club_id, req.sport, req.elo),
            )
        else:
            conn.execute(
                "UPDATE profile_club_elo SET elo = ? WHERE profile_id = ? AND club_id = ? AND sport = ?",
                (req.elo, profile_id, club_id, req.sport),
            )
    return {"ok": True, "elo": req.elo}


@router.patch("/{club_id}/players/{profile_id}/tier")
async def assign_player_tier(
    club_id: str, profile_id: str, req: PlayerTierAssign, user: User = Depends(get_current_user)
) -> dict:
    """Assign or remove a tier for a player in a specific sport within a club.

    Tiers are per-sport: padel and tennis tiers are managed independently.
    If ``apply_base_elo`` is True and a tier is set, the player's club ELO for
    the given sport is reset to the tier's base ELO.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)
    sport = req.sport

    tier: dict | None = None
    if req.tier_id is not None:
        with get_db() as conn:
            row = conn.execute(
                "SELECT * FROM club_tiers WHERE id = ? AND club_id = ?", (req.tier_id, club_id)
            ).fetchone()
        if row is None:
            raise HTTPException(404, "Tier not found")
        tier = dict(row)
        if tier["sport"] != sport:
            raise HTTPException(422, f"This tier is for {tier['sport']}, not {sport}")

    elo_val: float = tier["base_elo"] if (req.apply_base_elo and tier) else 1000.0

    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM profile_club_elo WHERE profile_id = ? AND club_id = ? AND sport = ?",
            (profile_id, club_id, sport),
        ).fetchone()

        if existing is None:
            conn.execute(
                "INSERT INTO profile_club_elo (profile_id, club_id, sport, elo, matches, tier_id) VALUES (?, ?, ?, ?, 0, ?)",
                (profile_id, club_id, sport, elo_val if (req.apply_base_elo and tier) else 1000.0, req.tier_id),
            )
        elif req.apply_base_elo and tier:
            conn.execute(
                "UPDATE profile_club_elo SET tier_id = ?, elo = ? WHERE profile_id = ? AND club_id = ? AND sport = ?",
                (req.tier_id, elo_val, profile_id, club_id, sport),
            )
        else:
            conn.execute(
                "UPDATE profile_club_elo SET tier_id = ? WHERE profile_id = ? AND club_id = ? AND sport = ?",
                (req.tier_id, profile_id, club_id, sport),
            )
    return {
        "ok": True,
        "sport": sport,
        "tier_id": req.tier_id,
        "applied_base_elo": req.apply_base_elo and tier is not None,
    }


# ---------------------------------------------------------------------------
# Collaborators (co-editors)
# ---------------------------------------------------------------------------


@router.get("/{club_id}/collaborators", response_model=CollaboratorListResponse)
async def list_club_collaborators(club_id: str, user: User = Depends(get_current_user)) -> CollaboratorListResponse:
    """Return the list of co-editors for a club.

    Accessible to the owner, any existing co-editor, and admins.
    """
    club = _get_club(club_id)
    co_editors = get_club_co_editors(club_id)
    is_owner = club["created_by"] == user.username
    if not is_owner and user.username not in co_editors and user.role != UserRole.ADMIN:
        raise HTTPException(403, "You do not have permission to view collaborators for this club")
    return CollaboratorListResponse(collaborators=co_editors)


@router.post("/{club_id}/collaborators", response_model=CollaboratorListResponse, status_code=201)
async def add_club_collaborator(
    club_id: str,
    req: AddCollaboratorRequest,
    user: User = Depends(get_current_user),
) -> CollaboratorListResponse:
    """Grant co-editor access to a registered user.

    Only the club owner or a site admin may add collaborators.
    Raises 404 if the target username does not exist.
    Raises 409 if the target user is already the owner.
    """
    club = _get_club(club_id)
    _require_club_admin(club, user)

    target_username = req.username.strip()

    if user_store.get(target_username) is None:
        raise HTTPException(404, f"User '{target_username}' not found")

    if target_username == club["created_by"]:
        raise HTTPException(409, "The club owner cannot also be added as a co-editor")

    add_club_co_editor(club_id, target_username)
    return CollaboratorListResponse(collaborators=get_club_co_editors(club_id))


@router.delete("/{club_id}/collaborators/{username}", response_model=CollaboratorListResponse)
async def remove_club_collaborator(
    club_id: str,
    username: str,
    user: User = Depends(get_current_user),
) -> CollaboratorListResponse:
    """Revoke co-editor access from a user.

    Only the club owner or a site admin may remove collaborators.
    Silently succeeds if the user was not a co-editor.
    """
    club = _get_club(club_id)
    _require_club_admin(club, user)
    remove_club_co_editor(club_id, username)
    return CollaboratorListResponse(collaborators=get_club_co_editors(club_id))


# ---------------------------------------------------------------------------
# Email settings
# ---------------------------------------------------------------------------


@router.patch("/{club_id}/email-settings", response_model=ClubEmailSettings)
async def update_club_email_settings(
    club_id: str,
    req: ClubEmailSettings,
    user: User = Depends(get_current_user),
) -> ClubEmailSettings:
    """Update the club's default email settings (reply_to address, sender name).

    These act as defaults for all tournament emails sent within this club's
    community unless overridden by the tournament's own email settings.
    """
    club = _get_club(club_id)
    _require_club_editor(club, user)

    if req.reply_to and not is_valid_email(req.reply_to):
        raise HTTPException(422, "reply_to must be a valid email address")

    settings = {k: v for k, v in {"reply_to": req.reply_to, "sender_name": req.sender_name}.items() if v is not None}
    with get_db() as conn:
        conn.execute(
            "UPDATE clubs SET email_settings = ? WHERE id = ?",
            (json.dumps(settings), club_id),
        )
    return ClubEmailSettings(**settings)
