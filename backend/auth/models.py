"""
Auth data models.

Keeps user data in pydantic models — never plain dicts.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class UserRole(StrEnum):
    """Fixed set of user roles."""

    ADMIN = "admin"
    USER = "user"


class User(BaseModel):
    """Stored user record (password is always the bcrypt hash)."""

    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password_hash: str
    role: UserRole = UserRole.USER
    disabled: bool = False
    email: str | None = None
    default_community_id: str = "open"
    can_create_clubs: bool = True
