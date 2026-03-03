"""
Tournament CRUD routes — list, delete, and TV settings for tournaments.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..auth.deps import get_current_user
from .schemas import SetAliasRequest, TvSettingsRequest
from . import state
from .state import _save_state, _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])

_DEFAULT_TV_SETTINGS: dict = {
    "show_courts": True,
    "show_past_matches": True,
    "show_score_breakdown": False,
    "show_standings": True,
    "show_bracket": True,
    "refresh_interval": -1,
    "schema_box_scale": 1.0,
    "schema_line_width": 1.0,
    "schema_arrow_scale": 1.0,
    "schema_title_font_scale": 1.0,
    "schema_output_scale": 1.0,
}


@router.get("")
async def list_tournaments():
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
async def delete_tournament(tournament_id: str, _user=Depends(get_current_user)):
    if tournament_id not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    del _tournaments[tournament_id]
    _save_state()
    return {"ok": True}


@router.get("/{tid}/version")
async def get_tournament_version(tid: str):
    """Return a counter bumped on every mutation (score recorded, round advanced, etc.).

    The TV display polls this cheaply (~every 2 s) and triggers a full reload
    only when the value changes, enabling \"on-update\" refresh mode.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    return {"version": state._state_version}


@router.get("/{tid}/tv-settings")
async def get_tv_settings(tid: str):
    """Return the current TV display settings for a tournament."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    return _tournaments[tid].get("tv_settings", _DEFAULT_TV_SETTINGS.copy())


@router.patch("/{tid}/tv-settings")
async def update_tv_settings(tid: str, req: TvSettingsRequest, _user=Depends(get_current_user)):
    """Partially update TV display settings (only supplied fields are changed)."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    current = _tournaments[tid].get("tv_settings", _DEFAULT_TV_SETTINGS.copy())
    patch = req.model_dump(exclude_none=True)
    current.update(patch)
    _tournaments[tid]["tv_settings"] = current
    _save_state()
    return current


@router.put("/{tid}/alias")
async def set_alias(tid: str, req: SetAliasRequest, _user=Depends(get_current_user)):
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
async def delete_alias(tid: str, _user=Depends(get_current_user)):
    """Remove the alias from a tournament."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    _tournaments[tid].pop("alias", None)
    _save_state()
    return {"ok": True}


@router.get("/resolve-alias/{alias}")
async def resolve_alias(alias: str):
    """Resolve a tournament alias to its ID. Public (used by TV page)."""
    for tid, data in _tournaments.items():
        if data.get("alias") == alias:
            return {"id": tid, "name": data["name"], "type": data["type"]}
    raise HTTPException(404, f"No tournament with alias '{alias}'")
