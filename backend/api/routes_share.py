"""
Tournament sharing / co-editor routes.

Allows a tournament owner to grant and revoke edit access for other registered
users.  Co-editors can perform all editing actions on a tournament but cannot
delete it or manage the collaborator list — those are owner-only operations.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ..auth.deps import get_current_user
from ..auth.models import User
from ..auth.store import user_store
from .db import add_co_editor, get_co_editors, remove_co_editor
from .helpers import _require_owner_or_admin
from .schemas import AddCollaboratorRequest, CollaboratorListResponse
from .state import _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["sharing"])


@router.get("/{tid}/collaborators", response_model=CollaboratorListResponse)
async def list_collaborators(tid: str, user: User = Depends(get_current_user)) -> CollaboratorListResponse:
    """Return the list of co-editors for a tournament.

    Accessible to the owner and any existing co-editor.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    data = _tournaments[tid]
    is_owner = data.get("owner") == user.username
    co_editors = get_co_editors(tid)
    if not is_owner and user.username not in co_editors:
        from ..auth.models import UserRole

        if user.role != UserRole.ADMIN:
            raise HTTPException(403, "You do not have permission to view collaborators for this tournament")
    return CollaboratorListResponse(collaborators=co_editors)


@router.post("/{tid}/collaborators", response_model=CollaboratorListResponse)
async def add_collaborator(
    tid: str,
    req: AddCollaboratorRequest,
    user: User = Depends(get_current_user),
) -> CollaboratorListResponse:
    """Grant co-editor access to a registered user.

    Only the tournament owner (or a site admin) may add collaborators.
    Raises 404 if the target username does not exist.
    Raises 409 if the target user is already the owner.
    """
    _require_owner_or_admin(tid, user)

    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    target_username = req.username.strip()

    if user_store.get(target_username) is None:
        raise HTTPException(404, f"User '{target_username}' not found")

    owner = _tournaments[tid].get("owner", "")
    if target_username == owner:
        raise HTTPException(409, "The tournament owner cannot also be added as a co-editor")

    add_co_editor(tid, target_username)
    return CollaboratorListResponse(collaborators=get_co_editors(tid))


@router.delete("/{tid}/collaborators/{username}", response_model=CollaboratorListResponse)
async def remove_collaborator(
    tid: str,
    username: str,
    user: User = Depends(get_current_user),
) -> CollaboratorListResponse:
    """Revoke co-editor access from a user.

    Only the tournament owner (or a site admin) may remove collaborators.
    Silently succeeds if the user was not a co-editor.
    """
    _require_owner_or_admin(tid, user)

    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    remove_co_editor(tid, username)
    return CollaboratorListResponse(collaborators=get_co_editors(tid))
