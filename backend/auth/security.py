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
