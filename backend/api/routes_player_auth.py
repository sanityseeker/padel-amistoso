"""
Player authentication routes.

Provides endpoints for players to authenticate using their passphrase or
QR-code token, and for tournament organizers to manage player secrets.
"""

from __future__ import annotations

import io
import time
from collections import OrderedDict

import segno
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..auth.deps import PlayerIdentity, get_current_player, get_current_user
from ..auth.models import User
from ..auth.security import create_player_token
from .helpers import _require_owner_or_admin
from .player_secret_store import (
    get_contacts_for_tournament,
    get_secrets_for_tournament,
    lookup_by_passphrase,
    lookup_by_token,
    regenerate_secret,
    update_contact,
)
from .state import _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["player-auth"])


# ────────────────────────────────────────────────────────────────────────────
# Rate limiting (bounded in-memory, per-IP)
# ────────────────────────────────────────────────────────────────────────────

_MAX_ATTEMPTS = 10
_WINDOW_SECONDS = 60
_MAX_TRACKED_IPS = 4096


class _BoundedRateLimiter:
    """Per-IP rate limiter with an upper bound on tracked IPs.

    Uses an OrderedDict as an LRU cache — when the IP limit is exceeded the
    oldest entry is evicted so memory usage stays bounded even under a
    distributed brute-force attack.
    """

    def __init__(self, max_attempts: int, window: float, cap: int) -> None:
        self._max_attempts = max_attempts
        self._window = window
        self._cap = cap
        self._log: OrderedDict[str, list[float]] = OrderedDict()

    def check(self, ip: str) -> None:
        now = time.monotonic()
        attempts = self._log.get(ip, [])
        attempts = [t for t in attempts if now - t < self._window]
        self._log[ip] = attempts
        self._log.move_to_end(ip)
        if len(attempts) >= self._max_attempts:
            raise HTTPException(429, "Too many failed attempts — try again later")

    def record(self, ip: str) -> None:
        attempts = self._log.get(ip, [])
        attempts.append(time.monotonic())
        self._log[ip] = attempts
        self._log.move_to_end(ip)
        while len(self._log) > self._cap:
            self._log.popitem(last=False)


_rate_limiter = _BoundedRateLimiter(_MAX_ATTEMPTS, _WINDOW_SECONDS, _MAX_TRACKED_IPS)


def _check_rate_limit(client_ip: str) -> None:
    """Raise 429 if *client_ip* exceeded the failure threshold."""
    _rate_limiter.check(client_ip)


def _record_failure(client_ip: str) -> None:
    _rate_limiter.record(client_ip)


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


class PlayerContactRequest(BaseModel):
    """Payload for updating a player's contact string."""

    contact: str = Field(default="", max_length=256)


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


@router.put("/{tid}/player-secrets/{player_id}/contact")
async def update_player_contact(
    tid: str,
    player_id: str,
    req: PlayerContactRequest,
    user: User = Depends(get_current_user),
) -> dict:
    """Set the contact string for a player (organizer/admin only)."""
    _require_owner_or_admin(tid, user)
    updated = update_contact(tid, player_id, req.contact)
    if not updated:
        raise HTTPException(404, "Player not found in this tournament")
    return {"player_id": player_id, "contact": req.contact}


@router.get("/{tid}/player/opponents")
async def get_player_opponents(
    tid: str,
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Return upcoming matches and co-players' contact info for the logged-in player.

    Requires a valid player JWT.  Returns all future (non-completed) matches
    that involve the authenticated player along with the name and contact of
    every other player in those matches.
    """
    if not isinstance(player, PlayerIdentity):
        raise HTTPException(401, "Player authentication required")
    if player.tournament_id != tid:
        raise HTTPException(403, "Token is for a different tournament")
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    tournament_data = _tournaments[tid]
    t = tournament_data["tournament"]
    t_type = tournament_data["type"]
    player_id = player.player_id

    # Build set of composite team PIDs that this player belongs to (GP team mode).
    team_roster: dict[str, list[str]] = getattr(t, "team_roster", {}) or {}
    player_teams: set[str] = {team_pid for team_pid, members in team_roster.items() if player_id in members}

    def _player_in_side(side: list) -> bool:
        for p in side:
            if p.id == player_id or p.id in player_teams:
                return True
        return False

    # Collect all future non-completed matches with full teams.
    pending_matches: list = []
    if t_type == "mexicano":
        pending_matches = [m for m in t.pending_matches() if m.team1 and m.team2]
        pending_matches += [m for m in t.pending_playoff_matches() if m.team1 and m.team2]
    elif t_type == "group_playoff":
        pending_matches = [m for m in t.pending_group_matches() if m.team1 and m.team2]
        pending_matches += [m for m in t.pending_playoff_matches() if m.team1 and m.team2]
    elif t_type == "playoff":
        pending_matches = [m for m in t.pending_matches() if m.team1 and m.team2]

    my_matches = [m for m in pending_matches if _player_in_side(m.team1) or _player_in_side(m.team2)]

    contacts = get_contacts_for_tournament(tid)
    secrets = get_secrets_for_tournament(tid)

    result: list[dict] = []
    seen: set[tuple[str, str]] = set()  # (player_id, match_id) dedup

    for m in my_matches:
        for p in m.team1 + m.team2:
            if p.id == player_id or p.id in player_teams:
                continue
            # Expand composite team to its individual member IDs.
            members = team_roster.get(p.id)
            ids_to_add = members if members else [p.id]
            for pid in ids_to_add:
                key = (pid, m.id)
                if key in seen:
                    continue
                seen.add(key)
                sec = secrets.get(pid, {})
                result.append(
                    {
                        "player_id": pid,
                        "name": sec.get("name") or p.name,
                        "contact": contacts.get(pid, ""),
                        "match_id": m.id,
                        "round_number": getattr(m, "round_number", 0),
                    }
                )

    return {"opponents": result}
