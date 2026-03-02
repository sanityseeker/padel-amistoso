"""
Authentication & user-management submodule.

Fully isolated from tournament logic — provides JWT-based auth,
password hashing with bcrypt, and a persistent user store.
"""

from __future__ import annotations

from .deps import get_current_user
from .models import User, UserRole
from .routes import router as auth_router
from .store import user_store

__all__ = [
    "UserRole",
    "User",
    "auth_router",
    "get_current_user",
    "user_store",
]
