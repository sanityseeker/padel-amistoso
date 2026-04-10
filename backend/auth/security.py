"""
Password hashing and JWT token helpers.

Uses bcrypt for password hashing and PyJWT for token creation / verification.
The JWT secret is read from the ``PADEL_JWT_SECRET`` environment variable.
If not set, a random secret is generated on first startup and persisted to
a ``.jwt_secret`` file in the data directory so tokens survive restarts.
"""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from ..config import DATA_DIR

# ────────────────────────────────────────────────────────────────────────────
# JWT configuration
# ────────────────────────────────────────────────────────────────────────────

_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

_SECRET_FILE = DATA_DIR / ".jwt_secret"


def _get_jwt_secret() -> str:
    """Return the JWT signing secret, creating one if necessary."""
    env = os.environ.get("PADEL_JWT_SECRET")
    if env:
        return env

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if _SECRET_FILE.exists():
        return _SECRET_FILE.read_text().strip()

    secret = secrets.token_urlsafe(64)
    _SECRET_FILE.write_text(secret)
    _SECRET_FILE.chmod(0o600)
    return secret


JWT_SECRET = _get_jwt_secret()


# ────────────────────────────────────────────────────────────────────────────
# Password hashing
# ────────────────────────────────────────────────────────────────────────────


def hash_password(plain: str) -> str:
    """Return a bcrypt hash of *plain*."""
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    """Check *plain* against a bcrypt *hashed* value."""
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ────────────────────────────────────────────────────────────────────────────
# JWT tokens
# ────────────────────────────────────────────────────────────────────────────


def create_access_token(username: str, *, expires_delta: timedelta | None = None) -> str:
    """Create a signed JWT access token for *username*."""
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=_ALGORITHM)


def decode_access_token(token: str) -> str | None:
    """Decode *token* and return the username, or ``None`` if invalid / expired."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[_ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


# ────────────────────────────────────────────────────────────────────────────
# Player tokens (tournament-scoped, lightweight)
# ────────────────────────────────────────────────────────────────────────────

PLAYER_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours


def create_player_token(
    tournament_id: str,
    player_id: str,
    *,
    expires_delta: timedelta | None = None,
) -> str:
    """Create a signed JWT for a tournament player.

    The ``sub`` claim uses the format ``player:<tid>:<pid>`` to distinguish
    player tokens from admin tokens at decode time.
    """
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=PLAYER_TOKEN_EXPIRE_MINUTES))
    payload = {
        "sub": f"player:{tournament_id}:{player_id}",
        "exp": expire,
        "type": "player",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=_ALGORITHM)


def decode_player_token(token: str) -> tuple[str, str] | None:
    """Decode a player JWT and return ``(tournament_id, player_id)``.

    Returns ``None`` if the token is invalid, expired, or not a player token.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[_ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "player":
        return None
    sub: str = payload.get("sub", "")
    parts = sub.split(":", 2)
    if len(parts) != 3 or parts[0] != "player":
        return None
    return parts[1], parts[2]


# ────────────────────────────────────────────────────────────────────────────
# Profile tokens (cross-tournament player identity, long-lived)
# ────────────────────────────────────────────────────────────────────────────

PROFILE_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 days


def create_profile_token(profile_id: str, *, expires_delta: timedelta | None = None) -> str:
    """Create a signed JWT for a Player Hub profile.

    The ``sub`` claim uses ``profile:<profile_id>`` and ``type=profile``
    to distinguish these tokens from admin and player JWTs.
    """
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=PROFILE_TOKEN_EXPIRE_MINUTES))
    payload = {
        "sub": f"profile:{profile_id}",
        "exp": expire,
        "type": "profile",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=_ALGORITHM)


def decode_profile_token(token: str) -> str | None:
    """Decode a profile JWT and return the ``profile_id``.

    Returns ``None`` if the token is invalid, expired, or not a profile token.
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[_ALGORITHM])
    except jwt.PyJWTError:
        return None
    if payload.get("type") != "profile":
        return None
    sub: str = payload.get("sub", "")
    parts = sub.split(":", 1)
    if len(parts) != 2 or parts[0] != "profile":
        return None
    return parts[1]
