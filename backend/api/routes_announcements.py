"""
Organizer announcements of a tournament.

* ``GET    /api/tournaments/{tid}/announcements`` — anonymous, like ``tv-settings``.
* ``POST   /api/tournaments/{tid}/announcements`` — post one (editors; optional web push).
* ``PATCH  /api/tournaments/{tid}/announcements/{aid}`` — edit the text or pin it (editors).
* ``DELETE /api/tournaments/{tid}/announcements/{aid}`` — remove it (editors, idempotent).

Announcements live in ``_tournaments[tid]["announcements"]`` (a list of
:class:`~backend.api.schemas.Announcement` dicts in posting order), persisted in the
``tournaments.announcements`` JSON column by ``save_tournament``, which also bumps the
tournament version so SSE clients reload. They go away with the tournament row.
The anonymous ``tv-settings`` response carries the same list, so the TV page and the
Player Hub event page get them without an extra request.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response

from ..auth.deps import get_current_user
from ..auth.models import User
from . import state
from .helpers import _require_editor_access
from .push_events import notify_announcement
from .rate_limit import BoundedRateLimiter
from .schemas import ANNOUNCEMENTS_MAX_ITEMS, Announcement, AnnouncementCreate, AnnouncementUpdate
from .state import _tournaments, save_tournament

router = APIRouter(prefix="/api/tournaments", tags=["announcements"])

# Posting can fan out a push to every subscriber: at most 10 posts a minute per organizer and tournament.
_post_rate_limiter = BoundedRateLimiter(max_attempts=10, window_seconds=60, max_tracked_ips=4096)


def _stored(tid: str) -> list[Announcement]:
    """The tournament's announcements in posting order (invalid stored entries are skipped)."""
    out: list[Announcement] = []
    for raw in _tournaments[tid].get("announcements") or []:
        try:
            out.append(Announcement(**raw))
        except (TypeError, ValueError):
            continue
    return out


def _store(tid: str, items: list[Announcement]) -> None:
    _tournaments[tid]["announcements"] = [a.model_dump() for a in items]


def list_announcements(tid: str) -> list[Announcement]:
    """Announcements as screens show them: pinned first, then newest first."""
    ranked = sorted(enumerate(_stored(tid)), key=lambda ia: (ia[1].pinned, ia[1].created_at, ia[0]), reverse=True)
    return [a for _, a in ranked]


def _cap(items: list[Announcement], keep_id: str) -> list[Announcement]:
    """Drop the oldest unpinned announcements (never *keep_id*) until the list fits the cap."""
    items = list(items)
    while len(items) > ANNOUNCEMENTS_MAX_ITEMS:
        victim = next((a for a in items if not a.pinned and a.id != keep_id), None)
        if victim is None:
            victim = next(a for a in items if a.id != keep_id)
        items.remove(victim)
    return items


def _require_tournament(tid: str) -> None:
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")


@router.get("/{tid}/announcements", response_model=list[Announcement])
async def get_announcements(tid: str) -> list[Announcement]:
    """Anonymous: the tournament's announcements, pinned first, then newest first."""
    _require_tournament(tid)
    return list_announcements(tid)


@router.post("/{tid}/announcements", response_model=Announcement, status_code=201)
async def create_announcement(
    tid: str, req: AnnouncementCreate, user: User = Depends(get_current_user)
) -> Announcement:
    """Post an announcement; with ``notify`` it is also pushed to the tournament's subscribers."""
    _require_editor_access(tid, user)
    key = f"{user.username}:{tid}"
    _post_rate_limiter.check(key, "Too many announcements — try again in a minute")
    _post_rate_limiter.record(key)
    async with state.get_tournament_lock(tid):
        _require_tournament(tid)
        item = Announcement(
            id=uuid.uuid4().hex[:12],
            text=req.text,
            created_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )
        _store(tid, _cap([*_stored(tid), item], keep_id=item.id))
        await save_tournament(tid)
        data = _tournaments[tid]
    if req.notify:
        notify_announcement(tid, data, item.id, item.text)
    return item


@router.patch("/{tid}/announcements/{aid}", response_model=Announcement)
async def update_announcement(
    tid: str, aid: str, req: AnnouncementUpdate, user: User = Depends(get_current_user)
) -> Announcement:
    """Edit the text and/or pin state. Never sends a push."""
    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        _require_tournament(tid)
        items = _stored(tid)
        target = next((a for a in items if a.id == aid), None)
        if target is None:
            raise HTTPException(404, "Announcement not found")
        patch = req.model_dump(exclude_none=True)
        updated = target.model_copy(update=patch)
        if updated != target:
            _store(tid, [updated if a.id == aid else a for a in items])
            await save_tournament(tid)
    return updated


@router.delete("/{tid}/announcements/{aid}", status_code=204)
async def delete_announcement(tid: str, aid: str, user: User = Depends(get_current_user)) -> Response:
    """Remove an announcement. Deleting one that is already gone succeeds too."""
    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        _require_tournament(tid)
        items = _stored(tid)
        kept = [a for a in items if a.id != aid]
        if len(kept) != len(items):
            _store(tid, kept)
            await save_tournament(tid)
    return Response(status_code=204)
