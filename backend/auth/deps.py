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
from .security import decode_access_token
from .store import user_store

_bearer_scheme = HTTPBearer(auto_error=False)


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
