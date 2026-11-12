"""
Admin endpoints for Player Hub profile management.

Provides admin-only CRUD for player profiles: listing, inspecting linked
participations, manually linking/unlinking tournament participations (with
full stats side-effects), resetting the hub passphrase, and updating the
profile email.
"""

from __future__ import annotations

import asyncio

import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from datetime import timedelta

from ..auth.deps import require_admin
from ..auth.models import User
from ..auth.security import create_profile_email_verify_token, create_profile_token
from ..email import is_valid_email, render_player_space_welcome, send_email_background
from ..models import ParticipationStatus, Sport
from ..tournaments.player_secrets import generate_passphrase
from .db import get_db
from .elo_recalc import flush_elo_recalculation, mark_elo_dirty
from .elo_store import DEFAULT_RATING, get_live_profile_elo_stats
from .rating_scope import RatingScope, resolve_scope
from .player_merge import (
    materialize_participants,
    merge_hub_profile_data,
    normalize_name,
    profile_tournament_ids,
    reassign_profile_data,
    shared_tournaments,
)
from .leaderboard_cache import invalidate_leaderboard_cache
from .player_secret_store import invalidate_secrets_cache
from .state import rename_player_in_tournament
from .schemas import (
    AdminEmailUpdate,
    AdminKFactorUpdate,
    AdminNameUpdate,
    AdminParticipationLink,
    AdminPlayerProfileDetail,
    AdminPlayerProfileSummary,
    AdminTournamentParticipant,
    EmailLang,
    HubMergePreview,
    HubMergeProfile,
    HubMergeRequest,
    HubMergeResult,
    HubMergeSharedTournament,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/player-profiles", tags=["admin-players"])


class GhostConsolidateRequest(BaseModel):
    """Request body for consolidating multiple profiles/participants into one.

    ``source_ids`` are existing profile ids (ghost, or at most one Hub profile
    used as the merge target).  ``source_player_ids`` are raw past-participant
    ``player_id``s that have no profile row yet — they are materialized into
    ghost profiles and merged in.  At least 2 distinct sources total are
    required across both fields.
    """

    source_ids: list[str] = Field(default_factory=list)
    source_player_ids: list[str] = Field(default_factory=list)
    name: str | None = Field(default=None, max_length=128)


class GhostConvertRequest(BaseModel):
    """Request body for converting a ghost profile into a real Player Hub profile."""

    name: str | None = Field(default=None, max_length=128)
    email: str | None = Field(default=None, max_length=256)
    lang: EmailLang = "en"


# ────────────────────────────────────────────────────────────────────────────
# List / search profiles
# ────────────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[AdminPlayerProfileSummary])
def list_profiles(
    q: str = "",
    club_id: str | None = None,
    community_id: str | None = None,
    limit: int = 500,
    _admin: User = Depends(require_admin),
) -> list[AdminPlayerProfileSummary]:
    """Return all player profiles, optionally filtered by name/email and by scope.

    Args:
        q: Optional search string matched against name and email (case-insensitive).
        club_id: Restrict results to profiles that are members of this club
            (i.e. have a non-hidden ``profile_club_elo`` row for it).
        community_id: Restrict results to profiles that have ever played in
            this community (i.e. have a ``profile_community_elo`` row for it).
            Ignored when ``club_id`` is provided, since clubs are already
            community-scoped.
        limit: Maximum rows returned (newest profiles first), clamped to 2000.
    """
    elo_cols = ", elo_padel, elo_padel_matches, elo_tennis, elo_tennis_matches, k_factor_override, is_ghost"
    where_clauses: list[str] = []
    params: list[str | int] = []
    if q.strip():
        pattern = f"%{q.strip()}%"
        where_clauses.append("(p.name LIKE ? OR p.email LIKE ?)")
        params.extend([pattern, pattern])
    join_clause = ""
    if club_id:
        join_clause = " INNER JOIN profile_club_elo pce ON pce.profile_id = p.id AND pce.club_id = ? AND pce.hidden = 0"
        params.insert(0, club_id)
    elif community_id:
        join_clause = " INNER JOIN profile_community_elo pcoe ON pcoe.profile_id = p.id AND pcoe.community_id = ?"
        params.insert(0, community_id)
    sql = (
        f"SELECT DISTINCT p.id, p.name, p.email, p.passphrase, p.created_at{elo_cols}"
        f" FROM player_profiles p{join_clause}"
    )
    if where_clauses:
        sql += " WHERE " + " AND ".join(where_clauses)
    sql += " ORDER BY p.created_at DESC LIMIT ?"
    params.append(max(1, min(limit, 2000)))
    with get_db() as conn:
        rows = conn.execute(sql, params).fetchall()
        scope = resolve_scope(club_id=club_id, community_id=community_id)
        live = get_live_profile_elo_stats([r["id"] for r in rows], conn=conn, scope=scope)

    return [
        AdminPlayerProfileSummary(
            id=r["id"],
            name=r["name"],
            email=r["email"],
            passphrase=r["passphrase"],
            created_at=r["created_at"],
            k_factor_override=r["k_factor_override"],
            is_ghost=bool(r["is_ghost"]),
            **_live_elo_fields(r, live.get(r["id"], {}), scope=scope),
        )
        for r in rows
    ]


def _live_elo_fields(row, live: dict[str, dict], scope: RatingScope | None = None) -> dict[str, float | int | None]:
    """ELO / match-count fields for an admin profile payload.

    Prefers the log-derived values (shared with the Player Hub header and the
    leaderboards) and falls back to the flat ``player_profiles`` snapshot for a
    sport with no logged matches.  In a club or community *scope* the flat
    snapshot is not a number of that scope, so a sport without matches there
    shows the default rating and no matches instead.
    """
    out: dict[str, float | int | None] = {
        "elo_padel": row["elo_padel"],
        "elo_padel_matches": row["elo_padel_matches"],
        "elo_tennis": row["elo_tennis"],
        "elo_tennis_matches": row["elo_tennis_matches"],
    }
    if scope is not None and scope.kind != "global":
        out = {
            "elo_padel": DEFAULT_RATING,
            "elo_padel_matches": 0,
            "elo_tennis": DEFAULT_RATING,
            "elo_tennis_matches": 0,
        }
    for sport in ("padel", "tennis"):
        stats = live.get(sport)
        if stats is None:
            continue
        out[f"elo_{sport}_matches"] = int(stats["matches"] or 0)
        if stats["elo"] is not None:
            out[f"elo_{sport}"] = stats["elo"]
    return out


# ────────────────────────────────────────────────────────────────────────────
# Past participants (players without a profile)
# ────────────────────────────────────────────────────────────────────────────


@router.get("/past-participants")
def search_past_participants(
    q: str = "",
    _admin: User = Depends(require_admin),
) -> list[dict]:
    """Search across all historical tournament players who have no Player Hub profile.

    Returns distinct player entries (by player_id) from ``player_secrets`` and
    ``player_history``, optionally filtered by name.  Ghost profiles are excluded
    because those players already have a tracking identity.

    Args:
        q: Name substring to match (case-insensitive). Empty returns up to 50 recents.

    Returns:
        List of ``{player_id, name, last_tournament_id, last_tournament_name, last_seen_at}``.
    """
    pattern = f"%{q.strip()}%" if q.strip() else "%"
    with get_db() as conn:
        # Combine active participations (player_secrets) with finished ones (player_history).
        # We want the most-recently-seen entry per player_id to avoid duplicates.
        rows = conn.execute(
            """
            SELECT player_id, player_name AS name,
                   tournament_id AS last_tournament_id,
                   COALESCE(tournament_name, '') AS last_tournament_name,
                   updated_at AS last_seen_at
            FROM (
                SELECT ps.player_id, ps.player_name, ps.tournament_id,
                       COALESCE(t.name, '') AS tournament_name,
                       COALESCE(ps.finished_at, datetime('now')) AS updated_at
                FROM player_secrets ps
                LEFT JOIN tournaments t ON t.id = ps.tournament_id
                WHERE ps.profile_id IS NULL
                  AND ps.player_name LIKE ?
                UNION ALL
                SELECT ph.player_id, ph.player_name, ph.entity_id AS tournament_id,
                       ph.entity_name AS tournament_name,
                       ph.finished_at AS updated_at
                FROM player_history ph
                WHERE ph.profile_id IS NULL
                  AND ph.entity_type = 'tournament'
                  AND ph.player_name LIKE ?
            ) combined
            -- Keep only the latest entry per player_id
            GROUP BY player_id
            HAVING updated_at = MAX(updated_at)
            ORDER BY updated_at DESC
            LIMIT 50
            """,
            (pattern, pattern),
        ).fetchall()

    return [
        {
            "player_id": r["player_id"],
            "name": r["name"],
            "last_tournament_id": r["last_tournament_id"],
            "last_tournament_name": r["last_tournament_name"],
            "last_seen_at": r["last_seen_at"],
        }
        for r in rows
    ]


# ────────────────────────────────────────────────────────────────────────────
# Ghost profile consolidation
# ────────────────────────────────────────────────────────────────────────────


# Merge primitives live in ``player_merge`` so the club endpoints share exactly
# the same behavior; keep the private alias for the existing call sites here.
_reassign_profile_data = reassign_profile_data


def merge_ghost_into_profile(primary_id: str, ghost_id: str) -> bool:
    """Merge one ghost profile's data into ``primary_id``; ELO follows on the next flush.

    Used by organizer-approved participation claims (``entity_type="profile"``
    in ``routes_registration``).  Returns ``False`` — leaving everything
    untouched — when ``ghost_id`` no longer exists or is not a ghost (e.g. it
    was already merged), or when ``primary_id`` does not exist.
    """
    if primary_id == ghost_id:
        return False
    with get_db() as conn:
        ghost = conn.execute("SELECT is_ghost FROM player_profiles WHERE id = ?", (ghost_id,)).fetchone()
        target = conn.execute("SELECT 1 FROM player_profiles WHERE id = ?", (primary_id,)).fetchone()
        if ghost is None or not ghost["is_ghost"] or target is None:
            return False
        _reassign_profile_data(conn, primary_id, ghost_id)
    mark_elo_dirty([primary_id])
    return True


@router.post("/consolidate-ghosts", response_model=AdminPlayerProfileSummary)
async def consolidate_ghost_profiles(
    req: GhostConsolidateRequest,
    _admin: User = Depends(require_admin),
) -> AdminPlayerProfileSummary:
    """Merge multiple ghost profiles into a single canonical ghost profile.

    The first id in ``source_ids`` becomes the primary profile.  All
    participations, history rows, and ELO data from the remaining (secondary)
    profiles are reassigned to the primary.  Secondary profiles are deleted.
    ELO is replayed from the merged profile's earliest tournament (see
    ``elo_recalc``) so the merged profile reflects the correct current rating.

    Args:
        req: Contains ``source_ids`` (profile ids), optional
            ``source_player_ids`` (raw past-participant player_ids to
            materialize into ghosts and merge in), and an optional ``name`` to
            assign to the surviving profile.

    Returns:
        The updated primary profile summary.

    Raises:
        HTTPException 404: One or more profiles not found.
        HTTPException 422: Fewer than 2 distinct sources, or more than one
            non-ghost (Hub) profile provided.
    """
    # Raw participants (no profile yet) become ghost profiles, appended after
    # the explicit source_ids so the target selection below is preserved.
    materialized = materialize_participants(req.source_player_ids)
    unique_ids: list[str] = list(dict.fromkeys([*req.source_ids, *materialized]))
    if len(unique_ids) < 2:
        raise HTTPException(422, "At least 2 distinct profiles/participants are required")

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
        if len(non_ghost) > 1:
            raise HTTPException(
                422,
                f"At most one non-ghost (Hub) profile may be included as the merge target. "
                f"Non-ghost profiles found: {', '.join(sorted(non_ghost))}",
            )
        ghost_only = [r["id"] for r in profiles if r["is_ghost"]]
        if not ghost_only:
            raise HTTPException(422, "At least one ghost profile must be included in the merge")

        # If a hub (non-ghost) profile is present it becomes the primary target.
        if non_ghost and primary_id != non_ghost[0]:
            primary_id = non_ghost[0]
            secondary_ids = [i for i in unique_ids if i != primary_id]

        if req.name:
            conn.execute(
                "UPDATE player_profiles SET name = ? WHERE id = ?",
                (req.name.strip(), primary_id),
            )

        for secondary_id in secondary_ids:
            _reassign_profile_data(conn, primary_id, secondary_id)

    # The response carries the merged rating, so recalculate before reading it.
    mark_elo_dirty([primary_id])
    await flush_elo_recalculation()

    with get_db() as conn:
        elo_cols = ", elo_padel, elo_padel_matches, elo_tennis, elo_tennis_matches, k_factor_override, is_ghost"
        row = conn.execute(
            f"SELECT id, name, email, passphrase, created_at{elo_cols} FROM player_profiles WHERE id = ?",
            (primary_id,),
        ).fetchone()

    return AdminPlayerProfileSummary(
        id=row["id"],
        name=row["name"],
        email=row["email"],
        passphrase=row["passphrase"],
        created_at=row["created_at"],
        elo_padel=row["elo_padel"],
        elo_padel_matches=row["elo_padel_matches"],
        elo_tennis=row["elo_tennis"],
        elo_tennis_matches=row["elo_tennis_matches"],
        k_factor_override=row["k_factor_override"],
        is_ghost=bool(row["is_ghost"]),
    )


# ────────────────────────────────────────────────────────────────────────────
# Merge two registered (Hub) profiles
# ────────────────────────────────────────────────────────────────────────────


def hub_merge_preview(conn, primary_id: str, secondary_id: str) -> HubMergePreview:
    """Describe merging Hub profile *secondary_id* into Hub profile *primary_id*.

    Shared by the admin and club endpoints.  Raises 404/422 when the pair is
    not two distinct registered profiles; a shared tournament does not raise
    here, it sets ``can_merge = False`` so the UI can explain why.
    """
    if primary_id == secondary_id:
        raise HTTPException(422, "Pick two different profiles to merge")
    rows = {
        r["id"]: r
        for r in conn.execute(
            "SELECT id, name, email, is_ghost FROM player_profiles WHERE id IN (?, ?)",
            (primary_id, secondary_id),
        ).fetchall()
    }
    missing = [pid for pid in (primary_id, secondary_id) if pid not in rows]
    if missing:
        raise HTTPException(404, f"Profiles not found: {', '.join(missing)}")
    if any(rows[pid]["is_ghost"] for pid in (primary_id, secondary_id)):
        raise HTTPException(422, "Both profiles must be registered Player Hub profiles")

    def side(pid: str) -> HubMergeProfile:
        return HubMergeProfile(
            id=pid,
            name=rows[pid]["name"] or "",
            email=rows[pid]["email"] or "",
            tournaments=len(profile_tournament_ids(conn, pid)),
        )

    shared = [
        HubMergeSharedTournament(tournament_id=tid, tournament_name=name)
        for tid, name in shared_tournaments(conn, primary_id, secondary_id)
    ]
    return HubMergePreview(
        primary=side(primary_id),
        secondary=side(secondary_id),
        shared_tournaments=shared,
        can_merge=not shared,
    )


async def merge_hub_profiles(primary_id: str, secondary_id: str) -> HubMergeResult:
    """Merge Hub profile *secondary_id* into *primary_id* and recompute ELO.

    Raises 409 when both played the same tournament: they were two different
    participants there, so they cannot be one person.
    """
    with get_db() as conn:
        preview = hub_merge_preview(conn, primary_id, secondary_id)
        if not preview.can_merge:
            names = ", ".join(t.tournament_name for t in preview.shared_tournaments)
            raise HTTPException(
                409,
                f"These players both took part in: {names}. One person cannot be two participants "
                "in the same tournament, so these profiles cannot be merged.",
            )
        moved_tournament_ids = profile_tournament_ids(conn, secondary_id)
        merge_hub_profile_data(conn, primary_id, secondary_id)
        name = conn.execute("SELECT name FROM player_profiles WHERE id = ?", (primary_id,)).fetchone()["name"]

    for tid in moved_tournament_ids:
        invalidate_secrets_cache(tid)
    mark_elo_dirty([primary_id])
    await flush_elo_recalculation()
    # Club memberships and ratings of every club either profile is in changed.
    invalidate_leaderboard_cache()
    return HubMergeResult(profile_id=primary_id, name=name or "")


@router.get("/merge-hub/preview", response_model=HubMergePreview)
def admin_hub_merge_preview(
    primary_id: str,
    secondary_id: str,
    _admin: User = Depends(require_admin),
) -> HubMergePreview:
    """Preview merging two registered profiles (see :func:`hub_merge_preview`)."""
    with get_db() as conn:
        return hub_merge_preview(conn, primary_id, secondary_id)


@router.post("/merge-hub", response_model=HubMergeResult)
async def admin_merge_hub_profiles(
    req: HubMergeRequest,
    _admin: User = Depends(require_admin),
) -> HubMergeResult:
    """Merge registered profile ``secondary_id`` into ``primary_id``.

    The primary keeps its name, email and passphrase; the secondary is deleted
    and its passphrase and sessions stop working.
    """
    return await merge_hub_profiles(req.primary_id, req.secondary_id)


@router.get("/{profile_id}/merge-candidates", response_model=list[AdminPlayerProfileSummary])
def merge_candidates(
    profile_id: str,
    _admin: User = Depends(require_admin),
) -> list[AdminPlayerProfileSummary]:
    """Suggest ghost profiles likely to be the same person as ``profile_id``.

    Conservative signals only: a ghost profile is suggested when it shares a
    non-empty email with the target, or an accent/case/punctuation-normalized
    identical name.  Never merges anything — the admin picks and confirms.

    Raises:
        HTTPException 404: The target profile does not exist.
    """
    with get_db() as conn:
        target = conn.execute(
            "SELECT id, name, email FROM player_profiles WHERE id = ?",
            (profile_id,),
        ).fetchone()
        if target is None:
            raise HTTPException(404, "Profile not found")

        target_name_key = normalize_name(target["name"])
        target_email = (target["email"] or "").strip().lower()

        elo_cols = ", elo_padel, elo_padel_matches, elo_tennis, elo_tennis_matches, k_factor_override, is_ghost"
        ghosts = conn.execute(
            f"SELECT id, name, email, passphrase, created_at{elo_cols} "
            f"FROM player_profiles WHERE is_ghost = 1 AND id != ?",
            (profile_id,),
        ).fetchall()

    out: list[AdminPlayerProfileSummary] = []
    for r in ghosts:
        name_match = target_name_key and normalize_name(r["name"]) == target_name_key
        email_match = target_email and (r["email"] or "").strip().lower() == target_email
        if not (name_match or email_match):
            continue
        out.append(
            AdminPlayerProfileSummary(
                id=r["id"],
                name=r["name"],
                email=r["email"],
                passphrase=r["passphrase"],
                created_at=r["created_at"],
                elo_padel=r["elo_padel"],
                elo_padel_matches=r["elo_padel_matches"],
                elo_tennis=r["elo_tennis"],
                elo_tennis_matches=r["elo_tennis_matches"],
                k_factor_override=r["k_factor_override"],
                is_ghost=bool(r["is_ghost"]),
            )
        )
    return out


# ────────────────────────────────────────────────────────────────────────────
# Ghost → Hub profile conversion
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{profile_id}/convert-ghost", response_model=AdminPlayerProfileSummary)
async def convert_ghost_to_hub_profile(
    profile_id: str,
    req: GhostConvertRequest,
    _admin: User = Depends(require_admin),
) -> AdminPlayerProfileSummary:
    """Convert a ghost profile into a real Player Hub profile.

    Generates a unique 3-word passphrase and sets ``is_ghost = 0``.  All
    existing participations, ELO data, and history rows are retained
    unchanged.  If an email address is supplied, a welcome email with the new
    passphrase is sent to the player immediately.

    Args:
        profile_id: ID of the ghost profile to convert.
        req: Optional ``name`` override, optional ``email``, and ``lang``.

    Returns:
        The updated profile summary, including the new 3-word passphrase.

    Raises:
        HTTPException 404: Profile not found.
        HTTPException 422: Profile is not a ghost.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, email, passphrase, created_at, is_ghost,"
            " elo_padel, elo_padel_matches, elo_tennis, elo_tennis_matches, k_factor_override"
            " FROM player_profiles WHERE id = ?",
            (profile_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(404, "Profile not found")
    if not row["is_ghost"]:
        raise HTTPException(422, "Profile is already a real Hub profile, not a ghost")

    # Generate a unique 3-word passphrase to replace the unusable hex token.
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

    if clean_email:
        token = create_profile_token(profile_id, expires_delta=timedelta(days=365))
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

    with get_db() as conn:
        updated = conn.execute(
            "SELECT id, name, email, passphrase, created_at, is_ghost,"
            " elo_padel, elo_padel_matches, elo_tennis, elo_tennis_matches, k_factor_override"
            " FROM player_profiles WHERE id = ?",
            (profile_id,),
        ).fetchone()

    return AdminPlayerProfileSummary(
        id=updated["id"],
        name=updated["name"],
        email=updated["email"] or "",
        passphrase=updated["passphrase"],
        created_at=updated["created_at"],
        elo_padel=updated["elo_padel"] or 0.0,
        elo_padel_matches=updated["elo_padel_matches"] or 0,
        elo_tennis=updated["elo_tennis"] or 0.0,
        elo_tennis_matches=updated["elo_tennis_matches"] or 0,
        k_factor_override=updated["k_factor_override"],
        is_ghost=False,
    )


# ────────────────────────────────────────────────────────────────────────────
# Profile detail (with participations)
# ────────────────────────────────────────────────────────────────────────────


@router.get("/{profile_id}", response_model=AdminPlayerProfileDetail)
def get_profile_detail(
    profile_id: str,
    club_id: str | None = None,
    community_id: str | None = None,
    _admin: User = Depends(require_admin),
) -> AdminPlayerProfileDetail:
    """Return a single profile along with all linked participations (active + history).

    With ``club_id`` or ``community_id`` the ELO and match counts are those of
    that scope (as in the list view's filter); otherwise they are global.
    """
    scope = resolve_scope(club_id=club_id, community_id=community_id)
    with get_db() as conn:
        profile = conn.execute(
            "SELECT id, name, email, contact, passphrase, created_at,"
            " elo_padel, elo_padel_matches, elo_tennis, elo_tennis_matches,"
            " k_factor_override, is_ghost"
            " FROM player_profiles WHERE id = ?",
            (profile_id,),
        ).fetchone()
        if profile is None:
            raise HTTPException(404, "Profile not found")

        participations = _build_participations(conn, profile_id)
        live = get_live_profile_elo_stats([profile_id], conn=conn, scope=scope).get(profile_id, {})

    return AdminPlayerProfileDetail(
        id=profile["id"],
        name=profile["name"],
        email=profile["email"],
        contact=profile["contact"],
        passphrase=profile["passphrase"],
        created_at=profile["created_at"],
        k_factor_override=profile["k_factor_override"],
        is_ghost=bool(profile["is_ghost"]),
        participations=participations,
        **_live_elo_fields(profile, live, scope=scope),
    )


def _build_participations(conn, profile_id: str) -> list[AdminParticipationLink]:
    """Aggregate active and finished participations for a profile.

    Active participations come from ``player_secrets`` rows where
    ``finished_at IS NULL``.  Finished participations come from
    ``player_history``.
    """
    parts: list[AdminParticipationLink] = []

    # Active (still-running tournaments)
    active_rows = conn.execute(
        """
        SELECT ps.tournament_id, ps.player_id, ps.player_name,
               COALESCE(t.name, ps.tournament_name, '') AS tournament_name
        FROM player_secrets ps
        LEFT JOIN tournaments t ON t.id = ps.tournament_id
        WHERE ps.profile_id = ? AND ps.finished_at IS NULL
        """,
        (profile_id,),
    ).fetchall()
    for r in active_rows:
        parts.append(
            AdminParticipationLink(
                tournament_id=r["tournament_id"],
                player_id=r["player_id"],
                player_name=r["player_name"],
                tournament_name=r["tournament_name"],
                status=ParticipationStatus.ACTIVE,
            )
        )

    # Finished (from player_history)
    hist_rows = conn.execute(
        """
        SELECT entity_id AS tournament_id, player_id, player_name,
               entity_name AS tournament_name, finished_at,
               rank, total_players, wins, losses, draws,
               points_for, points_against
        FROM player_history
        WHERE profile_id = ? AND entity_type = 'tournament'
        ORDER BY finished_at DESC
        """,
        (profile_id,),
    ).fetchall()
    for r in hist_rows:
        parts.append(
            AdminParticipationLink(
                tournament_id=r["tournament_id"],
                player_id=r["player_id"],
                player_name=r["player_name"],
                tournament_name=r["tournament_name"],
                status=ParticipationStatus.FINISHED,
                finished_at=r["finished_at"],
                rank=r["rank"],
                total_players=r["total_players"],
                wins=r["wins"] or 0,
                losses=r["losses"] or 0,
                draws=r["draws"] or 0,
                points_for=r["points_for"] or 0,
                points_against=r["points_against"] or 0,
            )
        )

    return parts


# ────────────────────────────────────────────────────────────────────────────
# Link a participation to a profile
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{profile_id}/link/{tid}/{player_id}")
async def admin_link_participation(
    profile_id: str,
    tid: str,
    player_id: str,
    _admin: User = Depends(require_admin),
) -> dict:
    """Link a tournament participation to a Player Hub profile.

    Sets ``profile_id`` on the ``player_secrets`` row.  If the tournament is
    already finished (``finished_at IS NOT NULL``), the stats snapshot is
    backfilled into ``player_history`` and the ``player_secrets`` row is
    cleaned up — exactly matching the self-service Player Hub flow.

    A participation already linked to another profile (Hub or ghost) is
    re-linked: the old link is dropped and the durable ``player_history``
    row, if any, moves to ``profile_id``.  This also covers finished
    participations whose ``player_secrets`` row is already gone (backfilled
    by an earlier link, or purged), where only ``player_history`` remains.

    A profile is one participant per tournament: any other participant of
    ``tid`` linked to ``profile_id`` is unlinked.  Their ids are returned in
    ``unlinked_player_ids``.

    ELO is then recalculated from this tournament onward, and the profiles
    that lost the participation are rebuilt from what they still own.
    """
    populated: dict[str, str] = {}
    with get_db() as conn:
        # Verify the profile exists.
        profile = conn.execute("SELECT id FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
        if profile is None:
            raise HTTPException(404, "Profile not found")

        # Any 404 below rolls this back along with the rest of the transaction.
        unlinked_player_ids = _unlink_profile_from_other_participants(conn, profile_id, tid, player_id)

        row = conn.execute(
            "SELECT profile_id, finished_at FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
            (tid, player_id),
        ).fetchone()

        if row is None:
            # Finished participation that only survives in player_history.
            hist = conn.execute(
                "SELECT profile_id FROM player_history"
                " WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
                (tid, player_id),
            ).fetchone()
            if hist is None:
                raise HTTPException(404, "Participation not found for this tournament/player")
            is_finished = True
            changed = hist["profile_id"] != profile_id
            old_profile_ids = [hist["profile_id"]]
            if changed:
                conn.execute(
                    "UPDATE player_history SET profile_id = ?"
                    " WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
                    (profile_id, tid, player_id),
                )
        else:
            is_finished = row["finished_at"] is not None
            changed = row["profile_id"] != profile_id
            old_profile_ids = [row["profile_id"]]
            if changed and is_finished:
                # Detach the durable history snapshot from whichever profile
                # holds it (the previous link, or a claim made directly on the
                # history row) so the backfill upsert below reassigns it.
                hist = conn.execute(
                    "SELECT profile_id FROM player_history"
                    " WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
                    (tid, player_id),
                ).fetchone()
                if hist is not None:
                    old_profile_ids.append(hist["profile_id"])
                conn.execute(
                    "UPDATE player_history SET profile_id = NULL"
                    " WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
                    (tid, player_id),
                )
            if changed:
                populated = _link_secret_row(conn, profile_id, tid, player_id)
            if changed and is_finished:
                # Backfill into player_history using the snapshot stored at finish time.
                _backfill_single_finished_secret(conn, profile_id, tid, player_id)

    # Rename the player in the live tournament object if name was populated.
    if "name" in populated and not is_finished:
        await asyncio.to_thread(rename_player_in_tournament, tid, player_id, populated["name"])

    # Ratings in this tournament (and those after it) depend on who is linked.
    if changed or unlinked_player_ids:
        mark_elo_dirty([*old_profile_ids, profile_id], [tid], [player_id, *unlinked_player_ids])

    invalidate_secrets_cache(tid)
    return {
        "ok": True,
        "status": ParticipationStatus.FINISHED if is_finished else ParticipationStatus.ACTIVE,
        "populated": populated,
        "unlinked_player_ids": unlinked_player_ids,
    }


def _unlink_profile_from_other_participants(conn, profile_id: str, tid: str, player_id: str) -> list[str]:
    """Drop ``profile_id``'s links to participants of ``tid`` other than ``player_id``.

    Finished participations keep their durable ``player_history`` row, just
    detached (``profile_id = NULL``) so it can be linked again later.
    Returns the unlinked ``player_id``s.
    """
    params = (profile_id, tid, player_id)
    secret_ids = [
        r["player_id"]
        for r in conn.execute(
            "SELECT player_id FROM player_secrets WHERE profile_id = ? AND tournament_id = ? AND player_id != ?",
            params,
        ).fetchall()
    ]
    history_ids = [
        r["player_id"]
        for r in conn.execute(
            "SELECT player_id FROM player_history"
            " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ? AND player_id != ?",
            params,
        ).fetchall()
    ]
    conn.execute(
        "UPDATE player_secrets SET profile_id = NULL WHERE profile_id = ? AND tournament_id = ? AND player_id != ?",
        params,
    )
    conn.execute(
        "UPDATE player_history SET profile_id = NULL"
        " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ? AND player_id != ?",
        params,
    )
    return list(dict.fromkeys([*secret_ids, *history_ids]))


def _link_secret_row(conn, profile_id: str, tid: str, player_id: str) -> dict[str, str]:
    """Point a ``player_secrets`` row at ``profile_id``, replacing any old link.

    The row's name is overwritten with the profile name; email/contact are
    only filled when empty.  Returns the fields that were populated.
    """
    prof = conn.execute("SELECT name, email, contact FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
    sec_row = conn.execute(
        "SELECT contact, email FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
        (tid, player_id),
    ).fetchone()
    populated: dict[str, str] = {}
    if prof["name"]:
        populated["name"] = prof["name"]
    if prof["email"] and not sec_row["email"]:
        populated["email"] = prof["email"]
    if prof["contact"] and not sec_row["contact"]:
        populated["contact"] = prof["contact"]

    columns = {"name": "player_name", "email": "email", "contact": "contact"}
    set_clause = ", ".join(["profile_id = ?", *(f"{columns[k]} = ?" for k in populated)])
    conn.execute(
        f"UPDATE player_secrets SET {set_clause} WHERE tournament_id = ? AND player_id = ?",
        [profile_id, *populated.values(), tid, player_id],
    )
    return populated


def _backfill_single_finished_secret(conn, profile_id: str, tid: str, player_id: str) -> None:
    """Backfill a single finished player_secrets row into player_history.

    A row for this ``(player_id, tid)`` may already exist in ``player_history``
    with ``profile_id IS NULL`` — the durable snapshot written for every
    participant, linked or not, at tournament finish (see
    ``delete_secrets_for_tournament``) — so this upserts: set ``profile_id``
    on that existing row rather than inserting a conflicting duplicate, only
    when it isn't already claimed by another profile. Falls back to a fresh
    insert (using the ``finished_*`` snapshot columns) for rows finished
    before that durable-snapshot behavior existed. Then deletes the
    ``player_secrets`` row (matching the self-service
    ``_backfill_finished_secrets`` behaviour in ``routes_player_space.py``).
    """
    row = conn.execute(
        """SELECT tournament_id, player_id, player_name,
                  finished_at, tournament_name, finished_sport,
                  finished_stats, finished_top_partners, finished_top_rivals,
                  finished_all_partners, finished_all_rivals
           FROM player_secrets
           WHERE profile_id = ? AND tournament_id = ? AND player_id = ?
             AND finished_at IS NOT NULL""",
        (profile_id, tid, player_id),
    ).fetchone()
    if row is None:
        return

    stats = json.loads(row["finished_stats"]) if row["finished_stats"] else {}
    top_partners = json.loads(row["finished_top_partners"]) if row["finished_top_partners"] else []
    top_rivals = json.loads(row["finished_top_rivals"]) if row["finished_top_rivals"] else []
    all_partners = json.loads(row["finished_all_partners"]) if row["finished_all_partners"] else []
    all_rivals = json.loads(row["finished_all_rivals"]) if row["finished_all_rivals"] else []

    conn.execute(
        """INSERT INTO player_history
               (profile_id, entity_type, entity_id, entity_name,
                player_id, player_name, finished_at,
                rank, total_players, wins, losses, draws, points_for, points_against,
                sport, top_partners, top_rivals, all_partners, all_rivals)
           VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (player_id, entity_type, entity_id) DO UPDATE
               SET profile_id = excluded.profile_id
               WHERE player_history.profile_id IS NULL""",
        (
            profile_id,
            row["tournament_id"],
            row["tournament_name"] or "",
            row["player_id"],
            row["player_name"],
            row["finished_at"],
            stats.get("rank"),
            stats.get("total_players"),
            stats.get("wins", 0),
            stats.get("losses", 0),
            stats.get("draws", 0),
            stats.get("points_for", 0),
            stats.get("points_against", 0),
            row["finished_sport"] or Sport.PADEL,
            json.dumps(top_partners),
            json.dumps(top_rivals),
            json.dumps(all_partners),
            json.dumps(all_rivals),
        ),
    )
    # Remove the player_secrets row now that it's been migrated.
    conn.execute(
        "DELETE FROM player_secrets WHERE profile_id = ? AND tournament_id = ? AND player_id = ?",
        (profile_id, tid, player_id),
    )


# ────────────────────────────────────────────────────────────────────────────
# Unlink a participation from a profile
# ────────────────────────────────────────────────────────────────────────────


@router.delete("/link/{tid}/{player_id}")
async def admin_unlink_participation(
    tid: str,
    player_id: str,
    _admin: User = Depends(require_admin),
) -> dict:
    """Unlink a tournament participation from a Player Hub profile.

    Clears ``profile_id`` on the ``player_secrets`` row and, for finished
    tournaments, on the durable ``player_history`` row — the stats leave the
    player's hub, but the record stays so it can be linked again later.  ELO
    is recalculated from this tournament onward and the profile is rebuilt
    from the participations it still owns.
    """
    with get_db() as conn:
        sec = conn.execute(
            "SELECT profile_id, finished_at FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
            (tid, player_id),
        ).fetchone()
        hist = conn.execute(
            "SELECT profile_id FROM player_history WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
            (tid, player_id),
        ).fetchone()
        old_profile_ids = [r["profile_id"] for r in (sec, hist) if r is not None and r["profile_id"] is not None]
        if not old_profile_ids:
            raise HTTPException(404, "Participation not found")
        conn.execute(
            "UPDATE player_secrets SET profile_id = NULL WHERE tournament_id = ? AND player_id = ?",
            (tid, player_id),
        )
        conn.execute(
            "UPDATE player_history SET profile_id = NULL"
            " WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
            (tid, player_id),
        )
    is_finished = hist is not None or sec["finished_at"] is not None

    mark_elo_dirty(old_profile_ids, [tid], [player_id])
    invalidate_secrets_cache(tid)
    if not is_finished:
        return {"ok": True, "status": ParticipationStatus.ACTIVE, "warning": None}
    return {
        "ok": True,
        "status": ParticipationStatus.FINISHED,
        "warning": "Stats have been removed from this player's hub.",
    }


# ────────────────────────────────────────────────────────────────────────────
# Permanently delete a profile
# ────────────────────────────────────────────────────────────────────────────


@router.delete("/{profile_id}")
async def admin_delete_profile(
    profile_id: str,
    _admin: User = Depends(require_admin),
) -> dict:
    """Permanently delete a Player Hub profile and all profile-bound records.

    This removes the profile row and all derived profile data (history, ELO,
    and cached path data).

    For **real (non-ghost) profiles** active tournament participations are
    preserved by unlinking them (``profile_id = NULL``) so tournaments remain
    intact and the player can later be re-linked.

    For **ghost profiles** (which have no real owner) all linked
    ``player_secrets`` rows and their per-tournament ELO log entries are also
    purged. Without this, orphaned secrets keep the deleted players surfacing
    in the "past participants" suggestions and ELO history forever.
    """
    with get_db() as conn:
        existing = conn.execute("SELECT id, is_ghost FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
        if existing is None:
            raise HTTPException(404, "Profile not found")
        is_ghost = bool(existing["is_ghost"])

        # Tournaments whose secret cache must be invalidated regardless of branch.
        active_rows = conn.execute(
            "SELECT DISTINCT tournament_id FROM player_secrets WHERE profile_id = ?",
            (profile_id,),
        ).fetchall()

        _purge_profile_record(conn, profile_id, is_ghost=is_ghost)

    for row in active_rows:
        invalidate_secrets_cache(row["tournament_id"])

    return {"ok": True}


def _purge_profile_record(conn, profile_id: str, *, is_ghost: bool) -> None:
    """Delete a player profile and its derived rows.

    Ghost profiles are fully removed (player_secrets + per-tournament
    ``player_elo_log`` rows for each participation). Real profiles are
    detached (``player_secrets.profile_id = NULL``) so existing
    tournaments keep their participation history intact.
    """
    if is_ghost:
        participation_rows = conn.execute(
            """
            SELECT tournament_id, player_id FROM player_secrets WHERE profile_id = ?
            UNION
            SELECT entity_id AS tournament_id, player_id FROM player_history
             WHERE profile_id = ? AND entity_type = 'tournament'
            """,
            (profile_id, profile_id),
        ).fetchall()

        for row in participation_rows:
            conn.execute(
                "DELETE FROM player_elo_log WHERE tournament_id = ? AND player_id = ?",
                (row["tournament_id"], row["player_id"]),
            )

        conn.execute("DELETE FROM player_secrets WHERE profile_id = ?", (profile_id,))
    else:
        conn.execute("UPDATE player_secrets SET profile_id = NULL WHERE profile_id = ?", (profile_id,))

    conn.execute("DELETE FROM player_history WHERE profile_id = ?", (profile_id,))
    conn.execute("DELETE FROM profile_community_elo WHERE profile_id = ?", (profile_id,))
    conn.execute("DELETE FROM profile_club_elo WHERE profile_id = ?", (profile_id,))
    conn.execute("DELETE FROM player_tournament_path_cache WHERE profile_id = ?", (profile_id,))
    conn.execute("DELETE FROM player_profiles WHERE id = ?", (profile_id,))


def list_ghost_profiles_for_tournament(tournament_id: str) -> list[dict[str, str]]:
    """Return ghost profiles linked via ``player_secrets`` to a tournament."""
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT pp.id AS id, pp.name AS name
              FROM player_secrets ps
              JOIN player_profiles pp ON pp.id = ps.profile_id
             WHERE ps.tournament_id = ? AND pp.is_ghost = 1
            """,
            (tournament_id,),
        ).fetchall()
    return [{"id": r["id"], "name": r["name"] or ""} for r in rows]


# ────────────────────────────────────────────────────────────────────────────
# Reset profile passphrase
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{profile_id}/reset-passphrase")
async def admin_reset_passphrase(
    profile_id: str,
    _admin: User = Depends(require_admin),
) -> dict:
    """Generate a new 3-word passphrase for a Player Hub profile.

    The old passphrase is immediately invalidated. Returns the new passphrase
    so the admin can communicate it to the player.
    """
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
        if existing is None:
            raise HTTPException(404, "Profile not found")

        # Generate a unique passphrase.
        for _ in range(20):
            new_passphrase = generate_passphrase()
            clash = conn.execute("SELECT 1 FROM player_profiles WHERE passphrase = ?", (new_passphrase,)).fetchone()
            if clash is None:
                break
        else:
            raise HTTPException(500, "Could not generate a unique passphrase")

        conn.execute(
            "UPDATE player_profiles SET passphrase = ? WHERE id = ?",
            (new_passphrase, profile_id),
        )

    return {"ok": True, "passphrase": new_passphrase}


# ────────────────────────────────────────────────────────────────────────────
# Rename profile
# ────────────────────────────────────────────────────────────────────────────


@router.put("/{profile_id}/name")
async def admin_update_name(
    profile_id: str,
    req: AdminNameUpdate,
    _admin: User = Depends(require_admin),
) -> dict:
    """Rename a Player Hub profile and propagate to all active linked participations.

    Updates ``player_profiles.name`` and ``player_secrets.player_name`` for
    every active (not-yet-finished) participation linked to this profile, and
    also renames the player in each live tournament's in-memory state.

    Args:
        profile_id: ID of the profile to rename.
        req: Contains the new ``name``.

    Returns:
        ``{"ok": True, "name": new_name}``.

    Raises:
        HTTPException 404: Profile not found.
    """
    new_name = req.name.strip()

    with get_db() as conn:
        cur = conn.execute(
            "UPDATE player_profiles SET name = ? WHERE id = ?",
            (new_name, profile_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Profile not found")

        active_rows = conn.execute(
            "SELECT tournament_id, player_id FROM player_secrets WHERE profile_id = ? AND finished_at IS NULL",
            (profile_id,),
        ).fetchall()

        if active_rows:
            conn.execute(
                "UPDATE player_secrets SET player_name = ? WHERE profile_id = ? AND finished_at IS NULL",
                (new_name, profile_id),
            )

    for row in active_rows:
        await asyncio.to_thread(rename_player_in_tournament, row["tournament_id"], row["player_id"], new_name)
        invalidate_secrets_cache(row["tournament_id"])

    return {"ok": True, "name": new_name}


# ────────────────────────────────────────────────────────────────────────────
# Update profile email
# ────────────────────────────────────────────────────────────────────────────


@router.put("/{profile_id}/email")
async def admin_update_email(
    profile_id: str,
    req: AdminEmailUpdate,
    _admin: User = Depends(require_admin),
) -> dict:
    """Update a profile's email and propagate to all active linked participations.

    Mirrors the self-service ``PUT /api/player-profile`` behaviour: the new
    email is written to ``player_profiles`` and also to every active
    ``player_secrets`` row linked to this profile.
    """
    new_email = req.email.strip()

    with get_db() as conn:
        cur = conn.execute(
            "UPDATE player_profiles SET email = ? WHERE id = ?",
            (new_email, profile_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Profile not found")

        # Propagate to all active linked player_secrets rows.
        conn.execute(
            "UPDATE player_secrets SET email = ? WHERE profile_id = ? AND finished_at IS NULL",
            (new_email, profile_id),
        )

    return {"ok": True, "email": new_email}


# ────────────────────────────────────────────────────────────────────────────
# Tournament participants with their current link (used by the link picker)
# ────────────────────────────────────────────────────────────────────────────


@router.get("/participants/{tid}", response_model=list[AdminTournamentParticipant])
def list_tournament_participants(
    tid: str,
    _admin: User = Depends(require_admin),
) -> list[AdminTournamentParticipant]:
    """Return every participant of a tournament with the profile it is linked to.

    Used by the admin UI to populate the "link" picker dropdown.  Linked
    participants are included so the admin can re-link them; finished
    participations whose ``player_secrets`` row is gone come from
    ``player_history``.
    """
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT p.player_id, p.player_name, p.profile_id,
                   pp.name AS profile_name, COALESCE(pp.is_ghost, 0) AS is_ghost
              FROM (
                    SELECT player_id, player_name, profile_id
                      FROM player_secrets WHERE tournament_id = ?
                    UNION ALL
                    SELECT ph.player_id, ph.player_name, ph.profile_id
                      FROM player_history ph
                     WHERE ph.entity_type = 'tournament' AND ph.entity_id = ?
                       AND NOT EXISTS (
                           SELECT 1 FROM player_secrets ps
                            WHERE ps.tournament_id = ph.entity_id AND ps.player_id = ph.player_id
                       )
                   ) p
              LEFT JOIN player_profiles pp ON pp.id = p.profile_id
             ORDER BY p.profile_id IS NOT NULL, p.player_name COLLATE NOCASE
            """,
            (tid, tid),
        ).fetchall()

    return [
        AdminTournamentParticipant(
            player_id=r["player_id"],
            player_name=r["player_name"] or "",
            profile_id=r["profile_id"],
            profile_name=r["profile_name"],
            is_ghost=bool(r["is_ghost"]),
        )
        for r in rows
    ]


# ────────────────────────────────────────────────────────────────────────────
# Update profile K-factor override
# ────────────────────────────────────────────────────────────────────────────


@router.put("/{profile_id}/k-factor")
async def admin_update_k_factor(
    profile_id: str,
    req: AdminKFactorUpdate,
    _admin: User = Depends(require_admin),
) -> dict:
    """Set or clear a custom K-factor override for a player profile.

    When set, the player's ELO updates will use this K value instead of
    the default tier-based calculation.  Pass ``null`` to remove the
    override and revert to automatic K-factor.
    """
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE player_profiles SET k_factor_override = ? WHERE id = ?",
            (req.k_factor_override, profile_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Profile not found")

    return {"ok": True, "k_factor_override": req.k_factor_override}
