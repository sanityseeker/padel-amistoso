"""
Pydantic request / response schemas for auth routes.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Credentials for the login endpoint."""

    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class CreateUserRequest(BaseModel):
    """Payload for creating a new user."""

    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=4, max_length=128)
    role: str | None = Field(default=None, description="'admin' or 'user' (default: 'user')")


class ChangePasswordRequest(BaseModel):
    """Payload for changing a user's password."""

    new_password: str = Field(min_length=4, max_length=128)


class TokenResponse(BaseModel):
    """Returned on successful login."""

    access_token: str
    token_type: str = "bearer"
    username: str
    role: str


class UserResponse(BaseModel):
    """Public user representation (no password hash)."""

    username: str
    role: str
    disabled: bool
