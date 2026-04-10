"""
Push notification API routes.

Endpoints for managing push subscriptions and exposing the VAPID public key
to the frontend.  All subscription endpoints require player authentication.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth.deps import PlayerIdentity, get_current_player
from .push import (
    get_vapid_public_key,
    is_push_available,
    remove_subscription,
    save_subscription,
)

router = APIRouter(prefix="/api/tournaments", tags=["push"])


# ────────────────────────────────────────────────────────────────────────────
# Schemas
# ────────────────────────────────────────────────────────────────────────────


class PushSubscriptionKeys(BaseModel):
    """The encryption keys from a PushSubscription."""

    p256dh: str
    auth: str


class PushSubscriptionRequest(BaseModel):
    """A browser PushSubscription object, as serialized by ``JSON.stringify()``."""

    endpoint: str
    keys: PushSubscriptionKeys


# ────────────────────────────────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────────────────────────────────


@router.get("/{tid}/push/vapid-key")
async def get_vapid_key(tid: str) -> dict:
    """Return the VAPID public key for this server (needed by the browser to subscribe).

    Does not require authentication — the public key is not secret.
    """
    key = get_vapid_public_key()
    if not key:
        raise HTTPException(503, "Push notifications are not available")
    return {"public_key": key}


@router.post("/{tid}/push/subscribe")
async def subscribe_push(
    tid: str,
    req: PushSubscriptionRequest,
    player: PlayerIdentity = Depends(get_current_player),
) -> dict:
    """Register a push subscription for the authenticated player.

    The browser calls this after ``PushManager.subscribe()`` succeeds.
    """
    if player is None or player.tournament_id != tid:
        raise HTTPException(403, "Player authentication required")
    if not is_push_available():
        raise HTTPException(503, "Push notifications are not available")

    save_subscription(
        tournament_id=tid,
        player_id=player.player_id,
        subscription_info=req.model_dump(),
    )
    return {"ok": True}


@router.post("/{tid}/push/unsubscribe")
async def unsubscribe_push(
    tid: str,
    player: PlayerIdentity = Depends(get_current_player),
) -> dict:
    """Remove the push subscription for the authenticated player."""
    if player is None or player.tournament_id != tid:
        raise HTTPException(403, "Player authentication required")

    remove_subscription(tournament_id=tid, player_id=player.player_id)
    return {"ok": True}
