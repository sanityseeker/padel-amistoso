"""
The organizer workspace in one request.

``GET /api/tournaments/{tid}/workspace`` returns what the React workspace used to
assemble from four or five calls (status, the phase's matches, the group results
or round history, TV settings) plus the caller's edit rights. It calls the
existing GET handlers, so serialization, ``hide_schedule`` handling and ELO
display stay shared with them. It exposes nothing those endpoints do not, apart
from two booleans about the caller and, for editors only, the tournament's list
entry (without the owner).
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth.deps import get_current_user_optional
from ..auth.models import User, UserRole
from ..models import GPPhase, MexPhase, Sport, TournamentType
from .helpers import _is_editor, get_scope_branding
from .routes_crud import get_tv_settings
from .routes_gp import gp_groups, gp_playoffs, gp_status
from .routes_mex import mex_matches, mex_playoffs, mex_status
from .routes_playoff import po_playoffs, po_status
from .state import _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["workspace"])

WorkspacePrefix = Literal["gp", "mex", "po"]
WorkspacePath = Literal["groups", "matches", "playoffs"]

_PREFIX: dict[str, WorkspacePrefix] = {
    TournamentType.GROUP_PLAYOFF.value: "gp",
    TournamentType.MEXICANO.value: "mex",
    TournamentType.PLAYOFF.value: "po",
}


class WorkspaceAccess(BaseModel):
    """What the caller may do here. Booleans only: never who the owner is."""

    can_edit: bool
    is_owner_or_admin: bool


class WorkspaceTournament(BaseModel):
    """The tournament's entry in ``GET /api/tournaments``, minus the owner and sharing fields."""

    id: str
    name: str
    type: TournamentType
    sport: Sport
    phase: str
    alias: str | None = None
    team_mode: bool = False
    public: bool = True
    community_id: str
    club_id: str | None = None
    club_name: str | None = None
    community_name: str | None = None
    season_id: str | None = None
    created_at: str = ""


class WorkspaceResponse(BaseModel):
    """Everything the workspace page shows for one tournament."""

    type: TournamentType
    prefix: WorkspacePrefix
    status: dict[str, Any]
    path: WorkspacePath
    group_stage: bool
    data: dict[str, Any]
    # Group+Play-off after the group stage: the group results, read-only.
    groups: dict[str, Any] | None = None
    # Mexicano that ended without play-offs: the round history, read-only.
    rounds: dict[str, Any] | None = None
    tv_settings: dict[str, Any]
    access: WorkspaceAccess
    # Editors only (the overview list shows it to them already); null for everyone else.
    tournament: WorkspaceTournament | None = None


def _is_owner_or_admin(tid: str, user: User | None) -> bool:
    """The non-raising form of ``_require_owner_or_admin``."""
    if user is None:
        return False
    if user.role == UserRole.ADMIN:
        return True
    return _tournaments.get(tid, {}).get("owner") == user.username


def _list_entry(tid: str, data: dict[str, Any]) -> WorkspaceTournament:
    t = data.get("tournament")
    community_id = data.get("community_id", "open")
    club_id = data.get("club_id")
    branding = get_scope_branding(community_id, club_id)
    return WorkspaceTournament(
        id=tid,
        name=data["name"],
        type=data["type"],
        sport=data.get("sport", Sport.PADEL),
        phase=t.phase if t else GPPhase.SETUP,
        alias=data.get("alias"),
        team_mode=t.team_mode if t else False,
        public=data.get("public", True),
        community_id=community_id,
        club_id=club_id,
        club_name=branding["club_name"],
        community_name=branding["community_name"],
        season_id=data.get("season_id"),
        created_at=data.get("created_at", ""),
    )


def _has_matches(payload: dict[str, Any]) -> bool:
    """Mirror of the frontend's ``allMatches(data).length > 0``."""
    raw = payload.get("all_matches") or payload.get("matches") or []
    if isinstance(raw, dict):
        return any(raw.values())
    return bool(raw)


@router.get("/{tid}/workspace", response_model=WorkspaceResponse)
async def get_workspace(tid: str, user: User | None = Depends(get_current_user_optional)) -> WorkspaceResponse:
    """Return the workspace of one tournament: status, the phase's matches, settings and access."""
    data = _tournaments.get(tid)
    if data is None or data.get("type") not in _PREFIX:
        raise HTTPException(404, "Not found")
    prefix = _PREFIX[data["type"]]
    groups: dict[str, Any] | None = None
    rounds: dict[str, Any] | None = None
    if prefix == "gp":
        status = await gp_status(tid)
        group_stage = status["phase"] == GPPhase.GROUPS
        if group_stage:
            path: WorkspacePath = "groups"
            payload = await gp_groups(tid, user=user)
        else:
            path = "playoffs"
            payload = await gp_playoffs(tid, user=user)
            groups = await gp_groups(tid, user=user)
    elif prefix == "mex":
        status = await mex_status(tid, user=user)
        group_stage = False
        if status["phase"] == MexPhase.MEXICANO:
            path = "matches"
            payload = await mex_matches(tid, user=user)
        else:
            path = "playoffs"
            payload = await mex_playoffs(tid, user=user)
            if not _has_matches(payload):
                rounds = await mex_matches(tid, user=user)
    else:
        status = await po_status(tid)
        group_stage = False
        path = "playoffs"
        payload = await po_playoffs(tid, user=user)
    can_edit = _is_editor(tid, user)
    return WorkspaceResponse(
        type=data["type"],
        prefix=prefix,
        status=status,
        path=path,
        group_stage=group_stage,
        data=payload,
        groups=groups,
        rounds=rounds,
        tv_settings=await get_tv_settings(tid),
        access=WorkspaceAccess(can_edit=can_edit, is_owner_or_admin=_is_owner_or_admin(tid, user)),
        tournament=_list_entry(tid, data) if can_edit else None,
    )
