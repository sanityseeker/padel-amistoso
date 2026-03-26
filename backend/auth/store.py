"""
Persistent user store backed by SQLite.

Users are stored in the ``users`` table of the shared ``padel.db`` database.
The in-memory dict (``self._users``) is the hot-path read cache; every write
goes to both the cache and the database immediately.
"""

from __future__ import annotations

import logging

from ..api.db import get_db
from .models import User, UserRole
from .security import hash_password, verify_password

logger = logging.getLogger(__name__)


class UserStore:
    """In-memory user store with SQLite persistence."""

    def __init__(self) -> None:
        self._users: dict[str, User] = {}

    # ── Persistence ────────────────────────────────────────

    def load(self) -> None:
        """Load all users from the SQLite ``users`` table into memory."""
        try:
            with get_db() as conn:
                rows = conn.execute("SELECT username, password_hash, role, disabled FROM users").fetchall()
            for row in rows:
                user = User(
                    username=row["username"],
                    password_hash=row["password_hash"],
                    role=UserRole(row["role"]),
                    disabled=bool(row["disabled"]),
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
                    "INSERT OR REPLACE INTO users (username, password_hash, role, disabled) VALUES (?, ?, ?, ?)",
                    (user.username, user.password_hash, user.role.value, int(user.disabled)),
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

    def create_user(self, username: str, password: str, role: UserRole = UserRole.USER) -> User:
        """Create a new user with the given role. Raises ``ValueError`` if username is taken."""
        if username in self._users:
            raise ValueError(f"User '{username}' already exists")
        user = User(username=username, password_hash=hash_password(password), role=role)
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


# Singleton instance — imported by routes and deps.
user_store = UserStore()
