"""
Player authentication routes.

Provides endpoints for players to authenticate using their passphrase or
QR-code token, and for tournament organizers to manage player secrets.
"""

from __future__ import annotations

import io
import time
from collections import defaultdict

import segno
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user
from ..auth.models import User
from ..auth.security import create_player_token
from .helpers import _require_owner_or_admin
from .player_secret_store import (
    get_secrets_for_tournament,
    lookup_by_passphrase,
    lookup_by_token,
    regenerate_secret,
)
from .state import _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["player-auth"])


# ────────────────────────────────────────────────────────────────────────────
# Rate limiting (simple in-memory, per-IP)
# ────────────────────────────────────────────────────────────────────────────

_MAX_ATTEMPTS = 10
_WINDOW_SECONDS = 60
_fail_log: dict[str, list[float]] = defaultdict(list)


def _check_rate_limit(client_ip: str) -> None:
    """Raise 429 if *client_ip* exceeded the failure threshold."""
    now = time.monotonic()
    attempts = _fail_log[client_ip]
    # Prune old entries
    _fail_log[client_ip] = [t for t in attempts if now - t < _WINDOW_SECONDS]
    if len(_fail_log[client_ip]) >= _MAX_ATTEMPTS:
        raise HTTPException(429, "Too many failed attempts — try again later")


def _record_failure(client_ip: str) -> None:
    _fail_log[client_ip].append(time.monotonic())


# ────────────────────────────────────────────────────────────────────────────
# Schemas
# ────────────────────────────────────────────────────────────────────────────


class PlayerAuthRequest(BaseModel):
    """Authenticate via passphrase OR token (exactly one must be provided)."""

    passphrase: str | None = Field(default=None, min_length=1)
    token: str | None = Field(default=None, min_length=1)


class PlayerAuthResponse(BaseModel):
    access_token: str
    player_id: str
    player_name: str
    tournament_id: str


# ────────────────────────────────────────────────────────────────────────────
# Public endpoints
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{tid}/player-auth", response_model=PlayerAuthResponse)
async def player_auth(tid: str, req: PlayerAuthRequest, request: Request) -> PlayerAuthResponse:
    """Authenticate a player by passphrase or QR token.

    Returns a short-lived JWT that the player can use to submit scores
    for their own matches.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    client_ip = request.client.host if request.client else "unknown"
    _check_rate_limit(client_ip)

    if req.passphrase and req.token:
        raise HTTPException(400, "Provide either passphrase or token, not both")
    if not req.passphrase and not req.token:
        raise HTTPException(400, "Provide passphrase or token")

    player_info: dict | None = None

    if req.passphrase:
        player_info = lookup_by_passphrase(tid, req.passphrase)
    elif req.token:
        result = lookup_by_token(req.token)
        if result and result["tournament_id"] == tid:
            player_info = {"player_id": result["player_id"], "player_name": result["player_name"]}

    if player_info is None:
        _record_failure(client_ip)
        raise HTTPException(401, "Invalid passphrase or token")

    jwt_token = create_player_token(tid, player_info["player_id"])
    return PlayerAuthResponse(
        access_token=jwt_token,
        player_id=player_info["player_id"],
        player_name=player_info["player_name"],
        tournament_id=tid,
    )


# ────────────────────────────────────────────────────────────────────────────
# Organizer-only endpoints
# ────────────────────────────────────────────────────────────────────────────


@router.get("/{tid}/player-secrets")
async def get_player_secrets(tid: str, user: User = Depends(get_current_user)) -> dict:
    """Return all player secrets for a tournament (organizer/admin only).

    Includes passphrases for display and tokens for QR code generation.
    """
    _require_owner_or_admin(tid, user)
    secrets = get_secrets_for_tournament(tid)
    return {"tournament_id": tid, "players": secrets}


@router.post("/{tid}/player-secrets/regenerate/{player_id}")
async def regenerate_player_secret(
    tid: str,
    player_id: str,
    user: User = Depends(get_current_user),
) -> dict:
    """Regenerate passphrase and token for a single player (organizer/admin only)."""
    _require_owner_or_admin(tid, user)
    new_secret = regenerate_secret(tid, player_id)
    if new_secret is None:
        raise HTTPException(404, "Player not found in this tournament")
    return {
        "player_id": player_id,
        "passphrase": new_secret.passphrase,
        "token": new_secret.token,
    }


@router.get("/{tid}/player-secrets/qr/{player_id}")
async def player_qr_code(
    tid: str,
    player_id: str,
    origin: str = "",
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    """Generate a QR code PNG containing the player's auto-login URL.

    The QR encodes: ``{origin}/tv/{tid}?player_token={token}``
    The frontend passes its ``window.location.origin`` via the ``origin``
    query parameter so the QR contains a full absolute URL that works
    when scanned by a phone camera.
    """
    _require_owner_or_admin(tid, user)
    secrets = get_secrets_for_tournament(tid)
    player = secrets.get(player_id)
    if player is None:
        raise HTTPException(404, "Player not found in this tournament")

    # Build auto-login URL with the caller-supplied origin so the QR
    # contains a fully-qualified URL scannable by any device.
    token = player["token"]
    url = f"{origin}/tv/{tid}?player_token={token}"

    qr = segno.make(url)
    buf = io.BytesIO()
    qr.save(buf, kind="png", scale=6, border=2)
    buf.seek(0)
    return StreamingResponse(buf, media_type="image/png")
