"""
Auth API routes — login, user management.

- Login is public.
- ``/me`` is available to any authenticated user.
- User management (list, create, delete) requires the ADMIN role.
- Password change: admins can change any user's password; regular users their own only.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .deps import get_current_user, require_admin
from .models import User, UserRole
from .schemas import (
    ChangePasswordRequest,
    CreateUserRequest,
    LoginRequest,
    TokenResponse,
    UserResponse,
)
from .security import create_access_token
from .store import user_store

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest):
    """Authenticate with username + password, receive a JWT."""
    user = user_store.authenticate(req.username, req.password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_access_token(user.username)
    return TokenResponse(access_token=token, username=user.username, role=user.role)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's info."""
    return UserResponse(username=current_user.username, role=current_user.role, disabled=current_user.disabled)


@router.get("/users", response_model=list[UserResponse])
async def list_users(_admin: User = Depends(require_admin)):
    """List all users (admin only)."""
    return [UserResponse(username=u.username, role=u.role, disabled=u.disabled) for u in user_store.list_users()]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(req: CreateUserRequest, _admin: User = Depends(require_admin)):
    """Create a new user (admin only). Defaults to regular USER role."""
    role = UserRole(req.role) if req.role else UserRole.USER
    try:
        user = user_store.create_user(req.username, req.password, role=role)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return UserResponse(username=user.username, role=user.role, disabled=user.disabled)


@router.delete("/users/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(username: str, admin: User = Depends(require_admin)):
    """Delete a user (admin only). Cannot delete yourself."""
    if username == admin.username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    try:
        user_store.delete_user(username)
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@router.patch("/users/{username}/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    username: str,
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
):
    """Change a user's password.

    Admins can change any user's password. Regular users can only change their own.
    """
    if current_user.role != UserRole.ADMIN and current_user.username != username:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot change another user's password")
    try:
        user_store.change_password(username, req.new_password)
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
