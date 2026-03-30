"""
Persistent user store backed by SQLite.

Users are stored in the ``users`` table of the shared ``padel.db`` database.
The in-memory dict (``self._users``) is the hot-path read cache; every write
goes to both the cache and the database immediately.
"""

from __future__ import annotations

import hashlib
import logging
import secrets
import time
from enum import StrEnum

from ..api.db import get_db
from .models import User, UserRole
from .security import hash_password, verify_password

logger = logging.getLogger(__name__)

_INVITE_TTL_SECS = 48 * 3600
_RESET_TTL_SECS = 3600


class AuthTokenType(StrEnum):
    INVITE = "invite"
    PASSWORD_RESET = "password_reset"


class UserStore:
    """In-memory user store with SQLite persistence."""

    def __init__(self) -> None:
        self._users: dict[str, User] = {}

    # ── Persistence ────────────────────────────────────────

    def load(self) -> None:
        """Load all users from the SQLite ``users`` table into memory."""
        try:
            with get_db() as conn:
                # Migrate: add email column to users if it doesn't exist yet.
                cols = {row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()}
                if "email" not in cols:
                    conn.execute("ALTER TABLE users ADD COLUMN email TEXT")

                rows = conn.execute("SELECT username, password_hash, role, disabled, email FROM users").fetchall()
            for row in rows:
                user = User(
                    username=row["username"],
                    password_hash=row["password_hash"],
                    role=UserRole(row["role"]),
                    disabled=bool(row["disabled"]),
                    email=row["email"],
                )
                self._users[user.username] = user
            logger.info("Loaded %d user(s) from SQLite", len(self._users))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not load users (starting fresh): %s", exc)

    def _save_user(self, user: User) -> None:
        """Upsert a single user row in SQLite."""
        try:
            with get_db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO users (username, password_hash, role, disabled, email) VALUES (?, ?, ?, ?, ?)",
                    (user.username, user.password_hash, user.role.value, int(user.disabled), user.email),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not save user %s: %s", user.username, exc)

    def _remove_user(self, username: str) -> None:
        """Delete a user row from SQLite."""
        try:
            with get_db() as conn:
                conn.execute("DELETE FROM users WHERE username = ?", (username,))
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not delete user %s: %s", username, exc)

    # ── Bootstrap ──────────────────────────────────────────

    def bootstrap_default_admin(self) -> bool:
        """Create a default ``admin`` user if the store is empty.

        If ``PADEL_ADMIN_PASSWORD`` is set, that value is used as the
        initial password.  Otherwise a random password is generated and
        printed to the console so the operator can log in.

        Returns True if a user was created.
        """
        import os
        import secrets as _secrets

        if self._users:
            return False
        password = os.environ.get("PADEL_ADMIN_PASSWORD", "")
        if not password:
            password = _secrets.token_urlsafe(16)
            import sys

            print(
                f"\n⚠️  No PADEL_ADMIN_PASSWORD set — generated initial admin password: {password}\n",
                file=sys.stderr,
                flush=True,
            )
            logger.warning(
                "No PADEL_ADMIN_PASSWORD set — generated initial admin password: %s",
                password,
            )
        self.create_user("admin", password, role=UserRole.ADMIN)
        logger.info("Created default admin user (username=admin)")
        return True

    # ── CRUD ───────────────────────────────────────────────

    def get(self, username: str) -> User | None:
        """Return a user by username or None."""
        return self._users.get(username)

    def list_users(self) -> list[User]:
        """Return all users (sorted by username)."""
        return sorted(self._users.values(), key=lambda u: u.username)

    def create_user(
        self, username: str, password: str, role: UserRole = UserRole.USER, email: str | None = None
    ) -> User:
        """Create a new user with the given role. Raises ``ValueError`` if username is taken."""
        if username in self._users:
            raise ValueError(f"User '{username}' already exists")
        user = User(username=username, password_hash=hash_password(password), role=role, email=email)
        self._users[username] = user
        self._save_user(user)
        return user

    def delete_user(self, username: str) -> None:
        """Delete a user. Raises ``KeyError`` if not found."""
        if username not in self._users:
            raise KeyError(f"User '{username}' not found")
        del self._users[username]
        self._remove_user(username)

    def change_password(self, username: str, new_password: str) -> None:
        """Update a user's password. Raises ``KeyError`` if not found."""
        user = self._users.get(username)
        if user is None:
            raise KeyError(f"User '{username}' not found")
        user.password_hash = hash_password(new_password)
        self._save_user(user)

    def authenticate(self, username: str, password: str) -> User | None:
        """Return the user if credentials are valid, else None."""
        user = self._users.get(username)
        if user is None or user.disabled:
            return None
        if not verify_password(password, user.password_hash):
            return None
        return user

    def set_email(self, username: str, email: str | None) -> None:
        """Set or clear the email address for a user. Raises ``KeyError`` if not found."""
        user = self._users.get(username)
        if user is None:
            raise KeyError(f"User '{username}' not found")
        user.email = email
        self._save_user(user)

    def find_by_email(self, email: str) -> User | None:
        """Return the first user whose email matches (case-insensitive), or None."""
        email_lower = email.strip().lower()
        return next((u for u in self._users.values() if u.email and u.email.strip().lower() == email_lower), None)

    # ── Auth tokens (invite / password-reset) ──────────────

    @staticmethod
    def _hash_token(raw: str) -> str:
        return hashlib.sha256(raw.encode()).hexdigest()

    def create_auth_token(
        self,
        email: str,
        token_type: AuthTokenType,
        role: UserRole | None = None,
    ) -> str:
        """Create a time-limited single-use auth token.  Returns the raw token (send this in the email)."""
        raw = secrets.token_urlsafe(32)
        token_hash = self._hash_token(raw)
        ttl = _INVITE_TTL_SECS if token_type == AuthTokenType.INVITE else _RESET_TTL_SECS
        expires_at = time.time() + ttl
        try:
            with get_db() as conn:
                conn.execute(
                    "INSERT INTO pending_auth_tokens (token_hash, email, token_type, role, expires_at)"
                    " VALUES (?, ?, ?, ?, ?)",
                    (token_hash, email, token_type.value, role.value if role else None, expires_at),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not persist auth token: %s", exc)
        return raw

    def consume_auth_token(self, raw: str, token_type: AuthTokenType) -> dict | None:
        """Validate and consume a raw token.  Returns a dict with ``email`` and optional ``role``, or None.

        Returns None if the token is unknown, expired, or already used.
        """
        token_hash = self._hash_token(raw)
        try:
            with get_db() as conn:
                row = conn.execute(
                    "SELECT email, role, expires_at, used_at FROM pending_auth_tokens"
                    " WHERE token_hash = ? AND token_type = ?",
                    (token_hash, token_type.value),
                ).fetchone()
                if row is None or row["used_at"] is not None or row["expires_at"] < time.time():
                    return None
                conn.execute(
                    "UPDATE pending_auth_tokens SET used_at = ? WHERE token_hash = ?",
                    (time.time(), token_hash),
                )
            return {"email": row["email"], "role": row["role"]}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not consume auth token: %s", exc)
            return None

    def peek_auth_token(self, raw: str, token_type: AuthTokenType) -> dict | None:
        """Validate a token without consuming it.  Returns dict with ``email`` and ``role``, or None."""
        token_hash = self._hash_token(raw)
        try:
            with get_db() as conn:
                row = conn.execute(
                    "SELECT email, role, expires_at, used_at FROM pending_auth_tokens"
                    " WHERE token_hash = ? AND token_type = ?",
                    (token_hash, token_type.value),
                ).fetchone()
            if row is None or row["used_at"] is not None or row["expires_at"] < time.time():
                return None
            return {"email": row["email"], "role": row["role"]}
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not peek auth token: %s", exc)
            return None

    def purge_expired_tokens(self) -> int:
        """Delete expired or used tokens.  Returns number of rows removed."""
        try:
            with get_db() as conn:
                cur = conn.execute(
                    "DELETE FROM pending_auth_tokens WHERE expires_at < ? OR used_at IS NOT NULL",
                    (time.time(),),
                )
                return cur.rowcount
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not purge auth tokens: %s", exc)
            return 0


# Singleton instance — imported by routes and deps.
user_store = UserStore()
