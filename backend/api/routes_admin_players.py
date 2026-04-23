"""
Admin endpoints for Player Hub profile management.

Provides admin-only CRUD for player profiles: listing, inspecting linked
participations, manually linking/unlinking tournament participations (with
full stats side-effects), resetting the hub passphrase, and updating the
profile email.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated

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
from .elo_store import consolidate_ghost_elos, retroactive_transfer_elo
from .player_secret_store import invalidate_secrets_cache
from .state import rename_player_in_tournament
from .schemas import (
    AdminEmailUpdate,
    AdminKFactorUpdate,
    AdminNameUpdate,
    AdminParticipationLink,
    AdminPlayerProfileDetail,
    AdminPlayerProfileSummary,
    EmailLang,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/player-profiles", tags=["admin-players"])


class GhostConsolidateRequest(BaseModel):
    """Request body for consolidating multiple ghost profiles into one."""

    source_ids: Annotated[list[str], Field(min_length=2)]
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
async def list_profiles(
    q: str = "",
    _admin: User = Depends(require_admin),
) -> list[AdminPlayerProfileSummary]:
    """Return all player profiles, optionally filtered by name or email.

    Args:
        q: Optional search string matched against name and email (case-insensitive).
    """
    elo_cols = ", elo_padel, elo_padel_matches, elo_tennis, elo_tennis_matches, k_factor_override, is_ghost"
    with get_db() as conn:
        if q.strip():
            pattern = f"%{q.strip()}%"
            rows = conn.execute(
                f"SELECT id, name, email, passphrase, created_at{elo_cols} FROM player_profiles"
                " WHERE name LIKE ? OR email LIKE ? ORDER BY created_at DESC",
                (pattern, pattern),
            ).fetchall()
        else:
            rows = conn.execute(
                f"SELECT id, name, email, passphrase, created_at{elo_cols} FROM player_profiles ORDER BY created_at DESC"
            ).fetchall()

    return [
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
        for r in rows
    ]


# ────────────────────────────────────────────────────────────────────────────
# Past participants (players without a profile)
# ────────────────────────────────────────────────────────────────────────────


@router.get("/past-participants")
async def search_past_participants(
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


@router.post("/consolidate-ghosts", response_model=AdminPlayerProfileSummary)
async def consolidate_ghost_profiles(
    req: GhostConsolidateRequest,
    _admin: User = Depends(require_admin),
) -> AdminPlayerProfileSummary:
    """Merge multiple ghost profiles into a single canonical ghost profile.

    The first id in ``source_ids`` becomes the primary profile.  All
    participations, history rows, and ELO data from the remaining (secondary)
    profiles are reassigned to the primary.  Secondary profiles are deleted.
    ELO is recalculated chronologically across all combined player_ids so
    the merged profile reflects the correct current rating.

    Args:
        req: Contains ``source_ids`` (≥ 2 ghost profile ids) and an optional
            ``name`` to assign to the surviving profile.

    Returns:
        The updated primary profile summary.

    Raises:
        HTTPException 404: One or more profiles not found.
        HTTPException 422: Less than 2 distinct ids provided, or any profile
            is not a ghost.
    """
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
            conn.execute(
                "UPDATE player_secrets SET profile_id = ? WHERE profile_id = ?",
                (primary_id, secondary_id),
            )
            # Remove history rows that would conflict with existing primary rows, then
            # reassign the rest.
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
            # Community and club ELO will be fully recomputed below.
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
async def get_profile_detail(
    profile_id: str,
    _admin: User = Depends(require_admin),
) -> AdminPlayerProfileDetail:
    """Return a single profile along with all linked participations (active + history)."""
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

    return AdminPlayerProfileDetail(
        id=profile["id"],
        name=profile["name"],
        email=profile["email"],
        contact=profile["contact"],
        passphrase=profile["passphrase"],
        created_at=profile["created_at"],
        elo_padel=profile["elo_padel"],
        elo_padel_matches=profile["elo_padel_matches"],
        elo_tennis=profile["elo_tennis"],
        elo_tennis_matches=profile["elo_tennis_matches"],
        k_factor_override=profile["k_factor_override"],
        is_ghost=bool(profile["is_ghost"]),
        participations=participations,
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
    """
    with get_db() as conn:
        # Verify the profile exists.
        profile = conn.execute("SELECT id FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
        if profile is None:
            raise HTTPException(404, "Profile not found")

        # Verify the player_secrets row exists and is not already linked.
        row = conn.execute(
            "SELECT profile_id, finished_at, tournament_name, finished_sport,"
            "       finished_stats, finished_top_partners, finished_top_rivals,"
            "       finished_all_partners, finished_all_rivals, player_name"
            " FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
            (tid, player_id),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Player secret not found for this tournament/player")

        if row["profile_id"] is not None:
            if row["profile_id"] == profile_id:
                # Already linked to the same profile — idempotent success.
                return {
                    "ok": True,
                    "status": ParticipationStatus.FINISHED if row["finished_at"] else ParticipationStatus.ACTIVE,
                    "populated": {},
                }
            # Linked to a different profile — clear the old link first.
            old_profile_id = row["profile_id"]
            conn.execute(
                "UPDATE player_secrets SET profile_id = NULL WHERE tournament_id = ? AND player_id = ?",
                (tid, player_id),
            )
            if row["finished_at"] is not None:
                conn.execute(
                    "DELETE FROM player_history WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                    (old_profile_id, tid),
                )

        # Fetch profile name/email/contact to populate empty fields.
        prof = conn.execute("SELECT name, email, contact FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
        populated = {}
        sec_row = conn.execute(
            "SELECT player_name, contact, email FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
            (tid, player_id),
        ).fetchone()
        updates = []
        if prof and prof["name"]:
            updates.append("player_name = ?")
            populated["name"] = prof["name"]
        if prof and prof["email"] and not sec_row["email"]:
            updates.append("email = ?")
            populated["email"] = prof["email"]
        if prof and prof["contact"] and not sec_row["contact"]:
            updates.append("contact = ?")
            populated["contact"] = prof["contact"]

        # Set the profile_id (and optionally email/contact).
        set_clause = "profile_id = ?" + (", " + ", ".join(updates) if updates else "")
        params = [profile_id] + list(populated.values()) + [tid, player_id]
        conn.execute(
            f"UPDATE player_secrets SET {set_clause} WHERE tournament_id = ? AND player_id = ?",
            params,
        )

        is_finished = row["finished_at"] is not None

        # Rename the player in the live tournament object if name was populated.
        if "name" in populated and not is_finished:
            rename_player_in_tournament(tid, player_id, populated["name"])

        if is_finished:
            # Backfill into player_history using the snapshot stored at finish time.
            _backfill_single_finished_secret(conn, profile_id, tid, player_id)

    if is_finished:
        retroactive_transfer_elo(profile_id, player_id)

    invalidate_secrets_cache(tid)
    return {
        "ok": True,
        "status": ParticipationStatus.FINISHED if is_finished else ParticipationStatus.ACTIVE,
        "populated": populated,
    }


def _backfill_single_finished_secret(conn, profile_id: str, tid: str, player_id: str) -> None:
    """Backfill a single finished player_secrets row into player_history.

    Reads the ``finished_*`` snapshot columns and inserts into
    ``player_history``, then deletes the ``player_secrets`` row (matching
    the self-service ``_backfill_finished_secrets`` behaviour in
    ``routes_player_space.py``).
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

    # Check that a history row doesn't already exist.
    existing = conn.execute(
        "SELECT 1 FROM player_history WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
        (profile_id, tid),
    ).fetchone()
    if existing:
        # Already backfilled — just delete the secret row.
        conn.execute(
            "DELETE FROM player_secrets WHERE profile_id = ? AND tournament_id = ? AND player_id = ?",
            (profile_id, tid, player_id),
        )
        return

    stats = json.loads(row["finished_stats"]) if row["finished_stats"] else {}
    top_partners = json.loads(row["finished_top_partners"]) if row["finished_top_partners"] else []
    top_rivals = json.loads(row["finished_top_rivals"]) if row["finished_top_rivals"] else []
    all_partners = json.loads(row["finished_all_partners"]) if row["finished_all_partners"] else []
    all_rivals = json.loads(row["finished_all_rivals"]) if row["finished_all_rivals"] else []

    conn.execute(
        """INSERT OR IGNORE INTO player_history
               (profile_id, entity_type, entity_id, entity_name,
                player_id, player_name, finished_at,
                rank, total_players, wins, losses, draws, points_for, points_against,
                sport, top_partners, top_rivals, all_partners, all_rivals)
           VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
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

    For **active** tournaments the ``profile_id`` is simply set to NULL on
    the ``player_secrets`` row.

    For **finished** tournaments the ``player_history`` row is deleted — this
    permanently removes the stats from the player's hub.  A warning is
    included in the response so the frontend can surface it.
    """
    with get_db() as conn:
        # Try active first (player_secrets row still present).
        row = conn.execute(
            "SELECT profile_id, finished_at FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
            (tid, player_id),
        ).fetchone()

        if row is not None and row["profile_id"] is not None:
            if row["finished_at"] is None:
                # Active tournament — just clear the link.
                conn.execute(
                    "UPDATE player_secrets SET profile_id = NULL WHERE tournament_id = ? AND player_id = ?",
                    (tid, player_id),
                )
                invalidate_secrets_cache(tid)
                return {"ok": True, "status": ParticipationStatus.ACTIVE, "warning": None}
            else:
                # Finished but player_secrets row still exists (edge case: finished
                # but backfill hasn't run yet).  Clear profile_id and remove any
                # history row.
                old_profile_id = row["profile_id"]
                conn.execute(
                    "UPDATE player_secrets SET profile_id = NULL WHERE tournament_id = ? AND player_id = ?",
                    (tid, player_id),
                )
                conn.execute(
                    "DELETE FROM player_history WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                    (old_profile_id, tid),
                )
                invalidate_secrets_cache(tid)
                return {
                    "ok": True,
                    "status": ParticipationStatus.FINISHED,
                    "warning": "Stats have been permanently removed from this player's hub.",
                }

        # No player_secrets row — check player_history directly.
        hist = conn.execute(
            "SELECT profile_id FROM player_history WHERE entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
            (tid, player_id),
        ).fetchone()
        if hist is not None:
            conn.execute(
                "DELETE FROM player_history WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ? AND player_id = ?",
                (hist["profile_id"], tid, player_id),
            )
            return {
                "ok": True,
                "status": ParticipationStatus.FINISHED,
                "warning": "Stats have been permanently removed from this player's hub.",
            }

    raise HTTPException(404, "Participation not found")


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

        if is_ghost:
            # Collect every (tournament_id, player_id) the ghost ever participated as,
            # from both active and finished participations, plus any history rows.
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

    for row in active_rows:
        invalidate_secrets_cache(row["tournament_id"])

    return {"ok": True}


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
        rename_player_in_tournament(row["tournament_id"], row["player_id"], new_name)
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
# Unlinked players for a tournament (used by the link picker)
# ────────────────────────────────────────────────────────────────────────────


@router.get("/unlinked/{tid}")
async def list_unlinked_players(
    tid: str,
    _admin: User = Depends(require_admin),
) -> list[dict]:
    """Return players in a tournament that are not linked to any profile.

    Used by the admin UI to populate the "link" picker dropdown.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT player_id, player_name FROM player_secrets WHERE tournament_id = ? AND profile_id IS NULL",
            (tid,),
        ).fetchall()

    return [{"player_id": r["player_id"], "player_name": r["player_name"]} for r in rows]


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
