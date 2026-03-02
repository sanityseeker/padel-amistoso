"""
Tournament CRUD routes — list and delete tournaments.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from .state import _save_state, _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])


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
