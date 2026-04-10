"""
FastAPI dependencies for authentication.

Provides:
- ``get_current_user`` — validates the JWT and returns the authenticated user (401 if missing/invalid).
- ``get_current_user_optional`` — same but returns ``None`` for unauthenticated requests.
- ``require_admin`` — like ``get_current_user`` but also enforces the ADMIN role (403 otherwise).
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .models import User, UserRole
from .security import decode_access_token, decode_player_token, decode_profile_token
from .store import user_store

_bearer_scheme = HTTPBearer(auto_error=False)


# ────────────────────────────────────────────────────────────────────────────
# Player identity (tournament-scoped, no platform account)
# ────────────────────────────────────────────────────────────────────────────


class PlayerIdentity:
    """Lightweight identity for a tournament player (not a registered user)."""

    __slots__ = ("tournament_id", "player_id")

    def __init__(self, tournament_id: str, player_id: str) -> None:
        self.tournament_id = tournament_id
        self.player_id = player_id


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User:
    """Validate the JWT and return the authenticated user.

    Raises 401 if the token is missing, invalid, expired, or the user
    no longer exists / is disabled.
    """
    if creds is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username = decode_access_token(creds.credentials)
    if username is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = user_store.get(username)
    if user is None or user.disabled:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


async def get_current_user_optional(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> User | None:
    """Return the authenticated user if a valid token is present, otherwise ``None``.

    Unlike ``get_current_user`` this dependency never raises — unauthenticated
    requests are treated as guest access.
    """
    if creds is None:
        return None

    username = decode_access_token(creds.credentials)
    if username is None:
        return None

    user = user_store.get(username)
    if user is None or user.disabled:
        return None

    return user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Require the current user to have the ADMIN role.

    Raises 403 if the authenticated user is not an admin.
    """
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


# ────────────────────────────────────────────────────────────────────────────
# Player authentication
# ────────────────────────────────────────────────────────────────────────────

_player_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_player(
    creds: HTTPAuthorizationCredentials | None = Depends(_player_bearer_scheme),
) -> PlayerIdentity | None:
    """Extract player identity from the ``Authorization`` header.

    Returns ``None`` when no valid player token is present (never raises).
    The player JWT is distinguished from admin JWTs by its ``type=player``
    claim, so both can share the same ``Authorization`` header.
    """
    if creds is None:
        return None
    result = decode_player_token(creds.credentials)
    if result is None:
        return None
    return PlayerIdentity(tournament_id=result[0], player_id=result[1])


# ────────────────────────────────────────────────────────────────────────────
# Profile authentication (cross-tournament Player Hub identity)
# ────────────────────────────────────────────────────────────────────────────


class ProfileIdentity:
    """Identity for a Player Hub profile (cross-tournament, optional)."""

    __slots__ = ("profile_id",)

    def __init__(self, profile_id: str) -> None:
        self.profile_id = profile_id


_profile_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_profile(
    creds: HTTPAuthorizationCredentials | None = Depends(_profile_bearer_scheme),
) -> ProfileIdentity | None:
    """Extract profile identity from the ``Authorization`` header.

    Returns ``None`` when no valid profile token is present (never raises).
    The profile JWT is distinguished by its ``type=profile`` claim.
    """
    if creds is None:
        return None
    profile_id = decode_profile_token(creds.credentials)
    if profile_id is None:
        return None
    return ProfileIdentity(profile_id=profile_id)
