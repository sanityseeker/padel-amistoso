"""
Tournament CRUD routes — list, delete, and TV settings for tournaments.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..auth.deps import get_current_user, get_current_user_optional
from ..auth.models import User, UserRole
from .helpers import _require_owner_or_admin
from .schemas import SetAliasRequest, SetPublicRequest, TvSettings, TvSettingsRequest
from . import state
from .state import _delete_tournament, _save_tournament, _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


@router.get("")
async def list_tournaments(current_user: User | None = Depends(get_current_user_optional)) -> list[dict]:
    """Return a list of tournaments visible to the caller.

    - **Admin**: all tournaments.
    - **Authenticated user**: only their own tournaments.
    - **Guest (unauthenticated)**: only publicly listed tournaments (``public=True``).
    """
    out = []
    for tid, data in _tournaments.items():
        # Visibility filter
        if current_user is None:
            if not data.get("public", True):
                continue
        elif current_user.role != UserRole.ADMIN:
            if data.get("owner") != current_user.username:
                continue

        t = data.get("tournament")
        out.append(
            {
                "id": tid,
                "name": data["name"],
                "type": data["type"],
                "alias": data.get("alias"),
                "team_mode": t.team_mode if t else False,
                "phase": t.phase if t else "setup",
                "owner": data.get("owner"),
                "public": data.get("public", True),
            }
        )
    return out


@router.delete("/{tournament_id}")
async def delete_tournament(tournament_id: str, user: User = Depends(get_current_user)) -> dict:
    if tournament_id not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    _require_owner_or_admin(tournament_id, user)
    del _tournaments[tournament_id]
    _delete_tournament(tournament_id)
    return {"ok": True}


@router.get("/{tid}/version")
async def get_tournament_version(tid: str) -> dict:
    """Return a counter bumped on every mutation (score recorded, round advanced, etc.).

    The TV display polls this cheaply (~every 2 s) and triggers a full reload
    only when the value changes, enabling \"on-update\" refresh mode.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    return {"version": state._tournament_versions.get(tid, 0)}


@router.get("/{tid}/tv-settings")
async def get_tv_settings(tid: str) -> dict:
    """Return the current TV display settings for a tournament."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    stored = _tournaments[tid].get("tv_settings")
    settings = TvSettings(**stored) if stored else TvSettings()
    return settings.model_dump()


@router.patch("/{tid}/tv-settings")
async def update_tv_settings(tid: str, req: TvSettingsRequest, user: User = Depends(get_current_user)) -> dict:
    """Partially update TV display settings (only supplied fields are changed)."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    _require_owner_or_admin(tid, user)
    stored = _tournaments[tid].get("tv_settings")
    current = TvSettings(**stored) if stored else TvSettings()
    patch = req.model_dump(exclude_none=True)
    updated = current.model_copy(update=patch)
    _tournaments[tid]["tv_settings"] = updated.model_dump()
    _save_tournament(tid)
    return updated.model_dump()


@router.patch("/{tid}/public")
async def set_public(tid: str, req: SetPublicRequest, user: User = Depends(get_current_user)) -> dict:
    """Set whether the tournament is publicly listed for guests."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    _require_owner_or_admin(tid, user)
    _tournaments[tid]["public"] = req.public
    _save_tournament(tid)
    return {"ok": True, "public": req.public}


@router.put("/{tid}/alias")
async def set_alias(tid: str, req: SetAliasRequest, user: User = Depends(get_current_user)) -> dict:
    """Set a human-friendly alias for a tournament (used in TV URLs like /tv?t=my-tourney)."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    _require_owner_or_admin(tid, user)
    # Check uniqueness: no other tournament should have this alias.
    for other_tid, data in _tournaments.items():
        if other_tid != tid and data.get("alias") == req.alias:
            raise HTTPException(409, f"Alias '{req.alias}' is already used by tournament {other_tid}")
    _tournaments[tid]["alias"] = req.alias
    _save_tournament(tid)
    return {"ok": True, "alias": req.alias}


@router.delete("/{tid}/alias")
async def delete_alias(tid: str, user: User = Depends(get_current_user)) -> dict:
    """Remove the alias from a tournament."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    _require_owner_or_admin(tid, user)
    _tournaments[tid].pop("alias", None)
    _save_tournament(tid)
    return {"ok": True}


@router.get("/resolve-alias/{alias}")
async def resolve_alias(alias: str) -> dict:
    """Resolve a tournament alias to its ID. Public (used by TV page)."""
    for tid, data in _tournaments.items():
        if data.get("alias") == alias:
            return {"id": tid, "name": data["name"], "type": data["type"]}
    raise HTTPException(404, f"No tournament with alias '{alias}'")


@router.get("/{tid}/meta")
async def get_tournament_meta(tid: str) -> dict:
    """Return minimal public metadata (name, type) for any tournament by ID.

    No auth or public-flag check — used by the TV page so private tournaments
    are still viewable when accessed directly by ID or alias.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    data = _tournaments[tid]
    t = data.get("tournament")
    return {
        "id": tid,
        "name": data["name"],
        "type": data["type"],
        "alias": data.get("alias"),
        "team_mode": t.team_mode if t else False,
        "phase": t.phase if t else "setup",
    }
