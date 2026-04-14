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

from fastapi import APIRouter, Depends, HTTPException

from ..auth.deps import require_admin
from ..auth.models import User
from ..models import ParticipationStatus, Sport
from ..tournaments.player_secrets import generate_passphrase
from .db import get_db
from .elo_store import retroactive_transfer_elo
from .player_secret_store import invalidate_secrets_cache
from .state import rename_player_in_tournament
from .schemas import (
    AdminEmailUpdate,
    AdminKFactorUpdate,
    AdminParticipationLink,
    AdminPlayerProfileDetail,
    AdminPlayerProfileSummary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/player-profiles", tags=["admin-players"])


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
    elo_cols = ", elo_padel, elo_padel_matches, elo_tennis, elo_tennis_matches, k_factor_override"
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
        )
        for r in rows
    ]


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
            " k_factor_override"
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
