"""
Tournament CRUD routes — list, delete, and TV settings for tournaments.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .schemas import TvSettingsRequest
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
            }
        )
    return out


@router.delete("/{tournament_id}")
async def delete_tournament(tournament_id: str):
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
async def update_tv_settings(tid: str, req: TvSettingsRequest):
    """Partially update TV display settings (only supplied fields are changed)."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    current = _tournaments[tid].get("tv_settings", _DEFAULT_TV_SETTINGS.copy())
    patch = req.model_dump(exclude_none=True)
    current.update(patch)
    _tournaments[tid]["tv_settings"] = current
    _save_state()
    return current
