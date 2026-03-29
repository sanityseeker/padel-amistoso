"""
Tournament CRUD routes — list, delete, and TV settings for tournaments.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from ..auth.deps import get_current_user, get_current_user_optional
from ..auth.models import User, UserRole
from ..email import (
    is_configured as email_is_configured,
    is_valid_email,
    render_tournament_started_email,
    send_email,
)
from .helpers import _find_match, _require_owner_or_admin
from .player_secret_store import delete_secrets_for_tournament, get_secrets_for_tournament
from .rate_limit import BoundedRateLimiter
from .schemas import SetAliasRequest, SetMatchCommentRequest, SetPublicRequest, TvSettings, TvSettingsRequest
from . import state
from .state import _delete_tournament, _save_tournament, _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])

_notify_rate_limiter = BoundedRateLimiter(max_attempts=10, window_seconds=60, max_tracked_ips=4096)


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
                "sport": data.get("sport", "padel"),
            }
        )
    return out


@router.delete("/{tournament_id}")
async def delete_tournament(tournament_id: str, user: User = Depends(get_current_user)) -> dict:
    _require_owner_or_admin(tournament_id, user)
    async with state.get_tournament_lock(tournament_id):
        if tournament_id not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        del _tournaments[tournament_id]
        _delete_tournament(tournament_id)
        delete_secrets_for_tournament(tournament_id)
    return {"ok": True}


@router.get("/{tid}/version")
async def get_tournament_version(tid: str, request: Request) -> Response:
    """Return a counter bumped on every mutation (score recorded, round advanced, etc.).

    The TV display polls this cheaply (~every 2 s) and triggers a full reload
    only when the value changes, enabling \"on-update\" refresh mode.
    Supports conditional GET via ETag / If-None-Match.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    v = state._tournament_versions.get(tid, 0)
    etag = f'"v{v}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)
    return Response(
        content=json.dumps({"version": v}),
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, no-cache, max-age=0, must-revalidate"},
    )


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
    _require_owner_or_admin(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        stored = _tournaments[tid].get("tv_settings")
        current = TvSettings(**stored) if stored else TvSettings()
        patch = req.model_dump(exclude_none=True)
        # Merge score_mode dict instead of replacing it entirely, so the admin
        # can update a single context at a time.
        if "score_mode" in patch:
            merged = {**current.score_mode, **patch.pop("score_mode")}
            patch["score_mode"] = merged
        updated = current.model_copy(update=patch)
        _tournaments[tid]["tv_settings"] = updated.model_dump()
        _save_tournament(tid)
    return updated.model_dump()


@router.patch("/{tid}/public")
async def set_public(tid: str, req: SetPublicRequest, user: User = Depends(get_current_user)) -> dict:
    """Set whether the tournament is publicly listed for guests."""
    _require_owner_or_admin(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        _tournaments[tid]["public"] = req.public
        _save_tournament(tid)
    return {"ok": True, "public": req.public}


@router.put("/{tid}/alias")
async def set_alias(tid: str, req: SetAliasRequest, user: User = Depends(get_current_user)) -> dict:
    """Set a human-friendly alias for a tournament (used in TV URLs like /tv/my-tourney)."""
    _require_owner_or_admin(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
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
    _require_owner_or_admin(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        _tournaments[tid].pop("alias", None)
        _save_tournament(tid)
    return {"ok": True}


@router.get("/resolve-alias/{alias}")
async def resolve_alias(alias: str) -> dict:
    """Resolve a tournament alias to its ID. Public (used by TV page)."""
    for tid, data in _tournaments.items():
        if data.get("alias") == alias:
            return {"id": tid, "name": data["name"], "type": data["type"], "sport": data.get("sport", "padel")}
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
        "sport": data.get("sport", "padel"),
    }


@router.patch("/{tid}/match-comment")
async def set_match_comment(tid: str, req: SetMatchCommentRequest, user: User = Depends(get_current_user)) -> dict:
    """Set or clear an optional admin comment on a match."""
    _require_owner_or_admin(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        tournament = _tournaments[tid]["tournament"]
        match = _find_match(tournament, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        match.comment = req.comment.strip()
        _save_tournament(tid)
    return {"ok": True, "match_id": req.match_id, "comment": match.comment}


# ────────────────────────────────────────────────────────────────────────────
# Email status & notifications
# ────────────────────────────────────────────────────────────────────────────


@router.get("/email-status")
async def email_status() -> dict:
    """Return whether the server has email/SMTP configured."""
    return {"configured": email_is_configured()}


@router.post("/{tid}/notify-players")
async def notify_tournament_players(tid: str, request: Request, user: User = Depends(get_current_user)) -> dict:
    """Send a 'tournament started' email to all players with a valid email address."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = request.client.host if request.client else "unknown"
    _notify_rate_limiter.check(client_ip, "Too many notification attempts — try again later")
    _notify_rate_limiter.record(client_ip)

    _require_owner_or_admin(tid, user)
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    data = _tournaments[tid]
    tournament_name = data["name"]
    alias = data.get("alias")

    secrets = get_secrets_for_tournament(tid)
    sent = 0
    skipped = 0
    failed = 0
    for pid, info in secrets.items():
        email = info.get("email", "")
        if not email or not is_valid_email(email):
            skipped += 1
            continue
        subject, body = render_tournament_started_email(
            tournament_name=tournament_name,
            player_name=info["name"],
            passphrase=info["passphrase"],
            token=info["token"],
            tournament_id=tid,
            tournament_alias=alias,
        )
        ok = await send_email(email, subject, body)
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}
