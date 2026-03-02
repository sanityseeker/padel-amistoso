"""
Persistent user store.

Uses the same pickle-based approach as the tournament store, but in a
separate file to keep auth data isolated.
"""

from __future__ import annotations

import os
import pickle
from pathlib import Path

from .models import User
from .security import hash_password, verify_password

# ────────────────────────────────────────────────────────────────────────────
# Storage
# ────────────────────────────────────────────────────────────────────────────

_default_data_dir = Path(__file__).resolve().parent.parent.parent / "data"
_DATA_DIR = Path(os.environ.get("PADEL_DATA_DIR", _default_data_dir))
_USERS_FILE = _DATA_DIR / "users.pkl"


class UserStore:
    """In-memory user store with pickle persistence."""

    def __init__(self) -> None:
        self._users: dict[str, User] = {}

    # ── Persistence ────────────────────────────────────────

    def load(self) -> None:
        """Load users from disk. Silently skips if file is missing."""
        if not _USERS_FILE.exists():
            return
        try:
            with _USERS_FILE.open("rb") as f:
                data = pickle.load(f)  # noqa: S301
            self._users = data.get("users", {})
            print(f"[auth] Loaded {len(self._users)} user(s) from {_USERS_FILE}")
        except Exception as exc:  # noqa: BLE001
            print(f"[auth] Could not load users (starting fresh): {exc}")

    def _save(self) -> None:
        """Persist users to disk (atomic write)."""
        try:
            _DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = _USERS_FILE.with_suffix(".tmp")
            with tmp.open("wb") as f:
                pickle.dump({"users": self._users}, f, protocol=pickle.HIGHEST_PROTOCOL)
            tmp.replace(_USERS_FILE)
        except Exception as exc:  # noqa: BLE001
            print(f"[auth] Could not save users: {exc}")

    # ── Bootstrap ──────────────────────────────────────────

    def bootstrap_default_admin(self) -> bool:
        """Create a default ``admin`` user if the store is empty.

        Returns True if a user was created.
        """
        if self._users:
            return False
        self.create_user("admin", "admin")
        print("[auth] Created default admin user (username=admin, password=admin) — change it!")
        return True

    # ── CRUD ───────────────────────────────────────────────

    def get(self, username: str) -> User | None:
        """Return a user by username or None."""
        return self._users.get(username)

    def list_users(self) -> list[User]:
        """Return all users (sorted by username)."""
        return sorted(self._users.values(), key=lambda u: u.username)

    def create_user(self, username: str, password: str) -> User:
        """Create a new user. Raises ``ValueError`` if username is taken."""
        if username in self._users:
            raise ValueError(f"User '{username}' already exists")
        user = User(username=username, password_hash=hash_password(password))
        self._users[username] = user
        self._save()
        return user

    def delete_user(self, username: str) -> None:
        """Delete a user. Raises ``KeyError`` if not found."""
        if username not in self._users:
            raise KeyError(f"User '{username}' not found")
        del self._users[username]
        self._save()

    def change_password(self, username: str, new_password: str) -> None:
        """Update a user's password. Raises ``KeyError`` if not found."""
        user = self._users.get(username)
        if user is None:
            raise KeyError(f"User '{username}' not found")
        user.password_hash = hash_password(new_password)
        self._save()

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
