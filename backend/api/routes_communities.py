(
    """  """
    """Community CRUD routes.

Communities scope ELO leaderboards so that players in different
groups/clubs/locations have independent ratings.  A built-in ``"open"``
community is seeded during DB initialisation and captures all legacy and
unassigned tournaments.
"""
)

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user, get_current_user_optional, require_admin
from ..auth.models import User, UserRole
from .db import get_db, get_shared_club_ids
from .state import _tournaments

router = APIRouter(prefix="/api/communities", tags=["communities"])

DEFAULT_COMMUNITY_ID = "open"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class CommunityCreate(BaseModel):
    """Request body for creating a new community."""

    name: str = Field(min_length=1, max_length=100)


class CommunityOut(BaseModel):
    """Public representation of a community."""

    id: str
    name: str
    created_by: str | None = None
    created_at: str
    is_builtin: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
_ID_LEN = 8


def _generate_community_id() -> str:
    """Return a short random community ID like ``cm_8k3w9q2h``."""
    suffix = "".join(secrets.choice(_ID_ALPHABET) for _ in range(_ID_LEN))
    return f"cm_{suffix}"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("", response_model=list[CommunityOut])
async def list_communities(user: User | None = Depends(get_current_user_optional)) -> list[CommunityOut]:
    """List communities visible to the current user.

    Visibility rules:
    - Anonymous users: built-in Open + communities not upgraded to clubs.
    - Authenticated non-admin users: same public communities + club communities
      they can edit (owner or collaborator).
    - Admins: all communities.
    """
    with get_db() as conn:
        if user is not None and user.role == UserRole.ADMIN:
            rows = conn.execute("SELECT id, name, created_by, created_at FROM communities ORDER BY name").fetchall()
        else:
            public_rows = conn.execute(
                """
                SELECT c.id, c.name, c.created_by, c.created_at
                FROM communities c
                LEFT JOIN clubs cl ON cl.community_id = c.id
                WHERE c.id = ? OR cl.id IS NULL
                ORDER BY c.name
                """,
                (DEFAULT_COMMUNITY_ID,),
            ).fetchall()

            if user is None:
                rows = public_rows
            else:
                shared_club_ids = set(get_shared_club_ids(user.username))
                if shared_club_ids:
                    placeholders = ",".join("?" for _ in shared_club_ids)
                    club_rows = conn.execute(
                        f"""
                        SELECT c.id, c.name, c.created_by, c.created_at
                        FROM communities c
                        JOIN clubs cl ON cl.community_id = c.id
                        WHERE cl.created_by = ? OR cl.id IN ({placeholders})
                        ORDER BY c.name
                        """,
                        [user.username, *shared_club_ids],
                    ).fetchall()
                else:
                    club_rows = conn.execute(
                        """
                        SELECT c.id, c.name, c.created_by, c.created_at
                        FROM communities c
                        JOIN clubs cl ON cl.community_id = c.id
                        WHERE cl.created_by = ?
                        ORDER BY c.name
                        """,
                        (user.username,),
                    ).fetchall()

                merged: dict[str, object] = {}
                for row in [*public_rows, *club_rows]:
                    merged[row["id"]] = row

                # Always include the community the admin assigned as the user's
                # default, even if it's a club community the user doesn't edit.
                if user.default_community_id and user.default_community_id not in merged:
                    assigned_row = conn.execute(
                        "SELECT id, name, created_by, created_at FROM communities WHERE id = ?",
                        (user.default_community_id,),
                    ).fetchone()
                    if assigned_row is not None:
                        merged[assigned_row["id"]] = assigned_row

                rows = sorted(merged.values(), key=lambda r: (r["name"] or "").lower())

    return [CommunityOut(**dict(r), is_builtin=(r["id"] == DEFAULT_COMMUNITY_ID)) for r in rows]


@router.get("/{community_id}", response_model=CommunityOut)
async def get_community(community_id: str) -> CommunityOut:
    """Get a single community by ID."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, created_by, created_at FROM communities WHERE id = ?",
            (community_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Community not found")
    return CommunityOut(**dict(row), is_builtin=(row["id"] == DEFAULT_COMMUNITY_ID))


@router.post("", response_model=CommunityOut, status_code=201)
async def create_community(req: CommunityCreate, user: User = Depends(require_admin)) -> CommunityOut:
    """Create a new community. Admin only."""
    community_id = _generate_community_id()
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO communities (id, name, created_by, created_at) VALUES (?, ?, ?, ?)",
            (community_id, req.name.strip(), user.username, now),
        )
    return CommunityOut(
        id=community_id, name=req.name.strip(), created_by=user.username, created_at=now, is_builtin=False
    )


@router.put("/{community_id}", response_model=CommunityOut)
async def update_community(
    community_id: str, req: CommunityCreate, user: User = Depends(get_current_user)
) -> CommunityOut:
    """Rename a community.  Only the creator or an admin may rename."""
    if community_id == DEFAULT_COMMUNITY_ID:
        raise HTTPException(403, "Cannot modify the built-in Open community")
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, name, created_by, created_at FROM communities WHERE id = ?",
            (community_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Community not found")
        if row["created_by"] != user.username and user.role != "admin":
            raise HTTPException(403, "Only the community creator or an admin may rename it")
        conn.execute("UPDATE communities SET name = ? WHERE id = ?", (req.name.strip(), community_id))
    return CommunityOut(
        id=community_id,
        name=req.name.strip(),
        created_by=row["created_by"],
        created_at=row["created_at"],
        is_builtin=False,
    )


@router.delete("/{community_id}")
async def delete_community(community_id: str, user: User = Depends(get_current_user)) -> dict:
    """Delete a community.  Only the creator or an admin may delete.

    The built-in 'open' community cannot be deleted.  Tournaments in the
    deleted community are reassigned to 'open'.
    """
    if community_id == DEFAULT_COMMUNITY_ID:
        raise HTTPException(403, "Cannot delete the built-in Open community")
    with get_db() as conn:
        row = conn.execute("SELECT created_by FROM communities WHERE id = ?", (community_id,)).fetchone()
        if row is None:
            raise HTTPException(404, "Community not found")
        if row["created_by"] != user.username and user.role != "admin":
            raise HTTPException(403, "Only the community creator or an admin may delete it")
        # Block deletion when clubs still reference the community — clubs are
        # community-scoped via a non-cascading FK, so deleting would either
        # raise IntegrityError or orphan the clubs.
        clubs_count = conn.execute(
            "SELECT COUNT(*) AS n FROM clubs WHERE community_id = ?", (community_id,)
        ).fetchone()["n"]
        if clubs_count:
            raise HTTPException(
                409,
                f"Community has {clubs_count} attached club(s); delete or move them first",
            )
        # Reassign tournaments and registrations to Open
        conn.execute(
            "UPDATE tournaments SET community_id = ? WHERE community_id = ?",
            (DEFAULT_COMMUNITY_ID, community_id),
        )
        conn.execute(
            "UPDATE registrations SET community_id = ? WHERE community_id = ?",
            (DEFAULT_COMMUNITY_ID, community_id),
        )
        # Move profile ELO rows to Open (merge on conflict — keep the row with higher matches)
        conn.execute(
            """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
               SELECT profile_id, ?, sport, elo, matches
               FROM profile_community_elo WHERE community_id = ?
               ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                 elo = CASE WHEN excluded.matches > profile_community_elo.matches
                            THEN excluded.elo ELSE profile_community_elo.elo END,
                 matches = MAX(excluded.matches, profile_community_elo.matches)""",
            (DEFAULT_COMMUNITY_ID, community_id),
        )
        conn.execute("DELETE FROM profile_community_elo WHERE community_id = ?", (community_id,))
        conn.execute("DELETE FROM communities WHERE id = ?", (community_id,))
    # Sync in-memory tournament state
    for data in _tournaments.values():
        if data.get("community_id") == community_id:
            data["community_id"] = DEFAULT_COMMUNITY_ID
    return {"ok": True}
