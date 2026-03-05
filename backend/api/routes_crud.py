"""
Tournament CRUD routes — list, delete, and TV settings for tournaments.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..auth.deps import get_current_user
from .schemas import SetAliasRequest, TvSettings, TvSettingsRequest
from . import state
from .state import _save_state, _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


@router.get("")
async def list_tournaments() -> list[dict]:
    out = []
    for tid, data in _tournaments.items():
        out.append(
            {
                "id": tid,
                "name": data["name"],
                "type": data["type"],
                "alias": data.get("alias"),
            }
        )
    return out


@router.delete("/{tournament_id}")
async def delete_tournament(tournament_id: str, _user=Depends(get_current_user)) -> dict:
    if tournament_id not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    del _tournaments[tournament_id]
    _save_state()
    return {"ok": True}


@router.get("/{tid}/version")
async def get_tournament_version(tid: str) -> dict:
    """Return a counter bumped on every mutation (score recorded, round advanced, etc.).

    The TV display polls this cheaply (~every 2 s) and triggers a full reload
    only when the value changes, enabling \"on-update\" refresh mode.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    return {"version": state._state_version}


@router.get("/{tid}/tv-settings")
async def get_tv_settings(tid: str) -> dict:
    """Return the current TV display settings for a tournament."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    stored = _tournaments[tid].get("tv_settings")
    settings = TvSettings(**stored) if stored else TvSettings()
    return settings.model_dump()


@router.patch("/{tid}/tv-settings")
async def update_tv_settings(tid: str, req: TvSettingsRequest, _user=Depends(get_current_user)) -> dict:
    """Partially update TV display settings (only supplied fields are changed)."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    stored = _tournaments[tid].get("tv_settings")
    current = TvSettings(**stored) if stored else TvSettings()
    patch = req.model_dump(exclude_none=True)
    updated = current.model_copy(update=patch)
    _tournaments[tid]["tv_settings"] = updated.model_dump()
    _save_state()
    return updated.model_dump()


@router.put("/{tid}/alias")
async def set_alias(tid: str, req: SetAliasRequest, _user=Depends(get_current_user)) -> dict:
    """Set a human-friendly alias for a tournament (used in TV URLs like /tv?t=my-tourney)."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    # Check uniqueness: no other tournament should have this alias.
    for other_tid, data in _tournaments.items():
        if other_tid != tid and data.get("alias") == req.alias:
            raise HTTPException(409, f"Alias '{req.alias}' is already used by tournament {other_tid}")
    _tournaments[tid]["alias"] = req.alias
    _save_state()
    return {"ok": True, "alias": req.alias}


@router.delete("/{tid}/alias")
async def delete_alias(tid: str, _user=Depends(get_current_user)) -> dict:
    """Remove the alias from a tournament."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    _tournaments[tid].pop("alias", None)
    _save_state()
    return {"ok": True}


@router.get("/resolve-alias/{alias}")
async def resolve_alias(alias: str) -> dict:
    """Resolve a tournament alias to its ID. Public (used by TV page)."""
    for tid, data in _tournaments.items():
        if data.get("alias") == alias:
            return {"id": tid, "name": data["name"], "type": data["type"]}
    raise HTTPException(404, f"No tournament with alias '{alias}'")
