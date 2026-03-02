"""
Auth API routes — login, user management.

All user-management endpoints require an authenticated admin.
The login endpoint is public.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

from .deps import get_current_user
from .models import User
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
    return TokenResponse(access_token=token, username=user.username)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's info."""
    return UserResponse(username=current_user.username, role=current_user.role, disabled=current_user.disabled)


@router.get("/users", response_model=list[UserResponse])
async def list_users(current_user: User = Depends(get_current_user)):
    """List all users (admin only)."""
    return [UserResponse(username=u.username, role=u.role, disabled=u.disabled) for u in user_store.list_users()]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(req: CreateUserRequest, current_user: User = Depends(get_current_user)):
    """Create a new admin user."""
    try:
        user = user_store.create_user(req.username, req.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return UserResponse(username=user.username, role=user.role, disabled=user.disabled)


@router.delete("/users/{username}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(username: str, current_user: User = Depends(get_current_user)):
    """Delete a user. Cannot delete yourself."""
    if username == current_user.username:
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
    """Change a user's password (admin can change any user's password)."""
    try:
        user_store.change_password(username, req.new_password)
    except KeyError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
