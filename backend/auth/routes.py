"""
Auth API routes — login, user management, invite flow, password reset.

- Login is public.
- ``/me`` is available to any authenticated user.
- User management (list, create, delete) requires the ADMIN role.
- Password change: admins can change any user's password; regular users their own only.
- Invite: admin-only; sends an email invite link valid for 48 h.
- Password reset: public; sends a reset link valid for 1 h.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status

from ..api.rate_limit import BoundedRateLimiter
from ..email import (
    is_configured as email_is_configured,
    render_invite_email,
    render_password_reset_email,
    send_email,
)
from .deps import get_current_user, require_admin
from .models import User, UserRole
from .schemas import (
    AcceptInviteRequest,
    ChangePasswordRequest,
    CreateUserRequest,
    ForgotPasswordRequest,
    InvitePreviewResponse,
    InviteRequest,
    LoginRequest,
    ResetPasswordRequest,
    UpdateManagedUserSettingsRequest,
    TokenResponse,
    UpdateUserSettingsRequest,
    UserResponse,
)
from .security import create_access_token
from .store import AuthTokenType, user_store

router = APIRouter(prefix="/api/auth", tags=["auth"])

_LOGIN_MAX_ATTEMPTS = 10
_LOGIN_WINDOW_SECONDS = 60
_LOGIN_MAX_TRACKED_IPS = 4096

_login_rate_limiter = BoundedRateLimiter(
    max_attempts=_LOGIN_MAX_ATTEMPTS,
    window_seconds=_LOGIN_WINDOW_SECONDS,
    max_tracked_ips=_LOGIN_MAX_TRACKED_IPS,
)


def _validate_community_exists(community_id: str) -> None:
    """Raise 404 if community does not exist."""
    from ..api.db import get_db

    with get_db() as conn:
        row = conn.execute("SELECT id FROM communities WHERE id = ?", (community_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Community not found")


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, request: Request):
    """Authenticate with username + password, receive a JWT."""
    client_ip = _client_ip(request)
    _login_rate_limiter.check(client_ip, "Too many failed login attempts — try again later")
    user = user_store.authenticate(req.username, req.password)
    if user is None:
        _login_rate_limiter.record(client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_access_token(user.username)
    return TokenResponse(access_token=token, username=user.username, role=user.role)


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's info."""
    return UserResponse(
        username=current_user.username,
        role=current_user.role,
        disabled=current_user.disabled,
        email=current_user.email,
        default_community_id=current_user.default_community_id,
        can_create_clubs=current_user.can_create_clubs,
    )


@router.patch("/me/settings", response_model=UserResponse)
async def update_my_settings(req: UpdateUserSettingsRequest, current_user: User = Depends(get_current_user)):
    """Update the current user's settings (e.g. default community)."""
    _validate_community_exists(req.default_community_id)
    user_store.set_default_community(current_user.username, req.default_community_id)
    updated = user_store.get(current_user.username)
    return UserResponse(
        username=updated.username,
        role=updated.role,
        disabled=updated.disabled,
        email=updated.email,
        default_community_id=updated.default_community_id,
        can_create_clubs=updated.can_create_clubs,
    )


@router.get("/users/search")
async def search_users(q: str = "", current_user: User = Depends(get_current_user)) -> list[str]:
    """Return up to 10 usernames matching *q* (case-insensitive prefix/substring).

    Accessible to any authenticated user — returns only usernames, no other
    details.  Disabled users are excluded.  The caller is excluded from results
    so the autocomplete never suggests adding yourself.
    """
    query = q.strip().casefold()
    results: list[str] = []
    for user in user_store.list_users():
        if user.disabled or user.username == current_user.username:
            continue
        if not query or query in user.username.casefold():
            results.append(user.username)
        if len(results) >= 10:
            break
    return results


@router.get("/users", response_model=list[UserResponse])
async def list_users(_admin: User = Depends(require_admin)):
    """List all users (admin only)."""
    return [
        UserResponse(
            username=u.username,
            role=u.role,
            disabled=u.disabled,
            email=u.email,
            default_community_id=u.default_community_id,
            can_create_clubs=u.can_create_clubs,
        )
        for u in user_store.list_users()
    ]


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(req: CreateUserRequest, _admin: User = Depends(require_admin)):
    """Create a new user (admin only). Defaults to regular USER role."""
    role = UserRole(req.role) if req.role else UserRole.USER
    _validate_community_exists(req.default_community_id)
    try:
        user = user_store.create_user(
            req.username,
            req.password,
            role=role,
            email=str(req.email) if req.email is not None else None,
            default_community_id=req.default_community_id,
            can_create_clubs=req.can_create_clubs,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return UserResponse(
        username=user.username,
        role=user.role,
        disabled=user.disabled,
        email=user.email,
        default_community_id=user.default_community_id,
        can_create_clubs=user.can_create_clubs,
    )


@router.patch("/users/{username}/settings", response_model=UserResponse)
async def update_user_settings(
    username: str,
    req: UpdateManagedUserSettingsRequest,
    _admin: User = Depends(require_admin),
):
    """Update admin-managed settings for a user (community and club creation permission)."""
    user = user_store.get(username)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"User '{username}' not found")

    if req.default_community_id is not None:
        _validate_community_exists(req.default_community_id)
        user_store.set_default_community(username, req.default_community_id)
    if req.can_create_clubs is not None:
        user_store.set_can_create_clubs(username, req.can_create_clubs)

    updated = user_store.get(username)
    return UserResponse(
        username=updated.username,
        role=updated.role,
        disabled=updated.disabled,
        email=updated.email,
        default_community_id=updated.default_community_id,
        can_create_clubs=updated.can_create_clubs,
    )


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


# ── Invite flow ─────────────────────────────────────────────


@router.post("/invite", status_code=status.HTTP_204_NO_CONTENT)
async def send_invite(req: InviteRequest, background_tasks: BackgroundTasks, _admin: User = Depends(require_admin)):
    """Send an email invite to a new user (admin only). Requires SMTP to be configured."""
    if not email_is_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Email not configured")
    try:
        role = UserRole(req.role)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Invalid role: {req.role!r}")
    raw_token = user_store.create_auth_token(str(req.email), AuthTokenType.INVITE, role=role)
    accept_url = f"{_site_base()}/?invite_token={raw_token}"
    subject, body = render_invite_email(email=str(req.email), role=role.value, accept_url=accept_url)
    background_tasks.add_task(send_email, str(req.email), subject, body)


@router.get("/invite/{token}", response_model=InvitePreviewResponse)
async def preview_invite(token: str):
    """Validate an invite token without consuming it. Returns the intended email and role."""
    data = user_store.peek_auth_token(token, AuthTokenType.INVITE)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invite link is invalid or has expired")
    return InvitePreviewResponse(email=data["email"], role=data["role"] or "user")


@router.post("/invite/{token}/accept", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def accept_invite(token: str, req: AcceptInviteRequest):
    """Consume an invite token and create a new user account."""
    data = user_store.consume_auth_token(token, AuthTokenType.INVITE)
    if data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Invite link is invalid, expired, or already used"
        )
    role = UserRole(data["role"]) if data["role"] else UserRole.USER
    try:
        user = user_store.create_user(req.username, req.password, role=role, email=data["email"])
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    return UserResponse(
        username=user.username,
        role=user.role,
        disabled=user.disabled,
        email=user.email,
        default_community_id=user.default_community_id,
        can_create_clubs=user.can_create_clubs,
    )


# ── Password-reset flow ────────────────────────────────────────


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
async def forgot_password(req: ForgotPasswordRequest, background_tasks: BackgroundTasks):
    """Initiate a password reset.  Always returns 204 to avoid account enumeration."""
    if not email_is_configured():
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Email not configured")
    user = user_store.find_by_email(str(req.email))
    if user is not None and not user.disabled:
        raw_token = user_store.create_auth_token(str(req.email), AuthTokenType.PASSWORD_RESET)
        reset_url = f"{_site_base()}/reset-password?reset_token={raw_token}"
        subject, body = render_password_reset_email(email=str(req.email), reset_url=reset_url)
        background_tasks.add_task(send_email, str(req.email), subject, body)


@router.post("/reset-password/{token}", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(token: str, req: ResetPasswordRequest):
    """Consume a password-reset token and update the user's password."""
    data = user_store.consume_auth_token(token, AuthTokenType.PASSWORD_RESET)
    if data is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Reset link is invalid, expired, or already used"
        )
    user = user_store.find_by_email(data["email"])
    if user is None or user.disabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active account found for this email")
    user_store.change_password(user.username, req.new_password)


def _site_base() -> str:
    from ..config import SITE_URL

    return (SITE_URL or "").rstrip("/")
