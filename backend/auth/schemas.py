"""
Pydantic request / response schemas for auth routes.
"""

from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    """Credentials for the login endpoint."""

    username: str = Field(min_length=1)
    password: str = Field(min_length=1)


class CreateUserRequest(BaseModel):
    """Payload for creating a new user."""

    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)
    role: str | None = Field(default=None, description="'admin' or 'user' (default: 'user')")
    email: EmailStr | None = None
    default_community_id: str = Field(default="open", min_length=1, max_length=64)
    can_create_clubs: bool = True


class ChangePasswordRequest(BaseModel):
    """Payload for changing a user's password."""

    new_password: str = Field(min_length=8, max_length=128)


class UpdateUserSettingsRequest(BaseModel):
    """Payload for updating the current user's settings."""

    default_community_id: str = Field(min_length=1, max_length=64)


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
    email: str | None = None
    default_community_id: str = "open"
    can_create_clubs: bool = True


class UpdateManagedUserSettingsRequest(BaseModel):
    """Payload for updating admin-managed user settings."""

    default_community_id: str | None = Field(default=None, min_length=1, max_length=64)
    can_create_clubs: bool | None = None


class InviteRequest(BaseModel):
    """Payload for sending an admin invite."""

    email: EmailStr
    role: str = Field(default="user", description="'admin' or 'user'")


class AcceptInviteRequest(BaseModel):
    """Payload for accepting an invite and creating an account."""

    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)


class InvitePreviewResponse(BaseModel):
    """Response from GET /invite/{token} — shows what the invite is for."""

    email: str
    role: str


class ForgotPasswordRequest(BaseModel):
    """Payload for initiating a password reset."""

    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Payload for completing a password reset."""

    new_password: str = Field(min_length=8, max_length=128)
