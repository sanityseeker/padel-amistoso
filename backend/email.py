"""
Email notification helpers.

All SMTP settings are read from ``backend.config``.  When
``AMISTOSOMISTOS_SMTP_HOST`` is not set every public function degrades gracefully
(``is_configured()`` returns ``False``, ``send_email()`` is a silent no-op).
"""

from __future__ import annotations

import asyncio
import logging
from email.message import EmailMessage

import aiosmtplib
from email_validator import EmailNotValidError, validate_email as _validate_email

from .config import SITE_URL, SMTP_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_USE_TLS, SMTP_USER

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# Public helpers
# ────────────────────────────────────────────────────────────────────────────


def is_configured() -> bool:
    """Return ``True`` when all required SMTP settings are present."""
    return bool(SMTP_HOST and SMTP_FROM)


def is_valid_email(value: str) -> bool:
    """Validate an email address format using the email-validator library (no DNS check)."""
    if not value or not value.strip():
        return False
    try:
        _validate_email(value.strip(), check_deliverability=False)
        return True
    except EmailNotValidError:
        return False


# ────────────────────────────────────────────────────────────────────────────
# Low-level send
# ────────────────────────────────────────────────────────────────────────────


async def send_email(to: str, subject: str, html_body: str) -> bool:
    """Send an HTML email via SMTP.  Returns ``True`` on success.

    When SMTP is not configured the call is a silent no-op returning
    ``False``.  Exceptions from the SMTP library are caught and logged
    so callers never need to handle them.
    """
    if not is_configured():
        logger.debug("Email not configured — skipping send to %s", to)
        return False

    msg = EmailMessage()
    msg["From"] = SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(html_body, subtype="html")

    try:
        await aiosmtplib.send(
            msg,
            hostname=SMTP_HOST,
            port=SMTP_PORT,
            username=SMTP_USER,
            password=SMTP_PASS,
            start_tls=SMTP_USE_TLS,
        )
        logger.info("Email sent to %s (subject=%r)", to, subject)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to)
        return False


def send_email_background(to: str, subject: str, html_body: str) -> None:
    """Fire-and-forget wrapper — schedules ``send_email`` as a background task."""
    if not is_configured():
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(send_email(to, subject, html_body))
    except RuntimeError:
        logger.debug("No running event loop — cannot send background email")


# ────────────────────────────────────────────────────────────────────────────
# Email templates
# ────────────────────────────────────────────────────────────────────────────

_BASE_STYLE = (
    "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;"
    "max-width: 520px; margin: 0 auto; padding: 24px; color: #1a1a1a;"
)

_BUTTON_STYLE = (
    "display: inline-block; padding: 12px 28px; border-radius: 8px;"
    "background: #2563eb; color: #fff; text-decoration: none; font-weight: 600;"
)

_CODE_STYLE = (
    "display: inline-block; padding: 6px 16px; border-radius: 6px;"
    "background: #f3f4f6; font-family: monospace; font-size: 1.15em; letter-spacing: 1px;"
)


def _site_url() -> str:
    """Return the configured site URL or a sensible placeholder."""
    return (SITE_URL or "").rstrip("/")


def render_registration_confirmation(
    *,
    lobby_name: str,
    player_name: str,
    passphrase: str,
    token: str,
    lobby_alias: str | None = None,
    lobby_id: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a registration confirmation email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register?id={lobby_id}"
    login_url = f"{base}{lobby_path}?token={token}" if base else ""

    subject = f"Registration confirmed — {lobby_name}"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">You're registered! 🎾</h2>
  <p>Hi <strong>{_esc(player_name)}</strong>, you've been registered for
     <strong>{_esc(lobby_name)}</strong>.</p>
  <p>Your personal passphrase:</p>
  <p style="text-align:center"><span style="{_CODE_STYLE}">{_esc(passphrase)}</span></p>
  <p style="font-size:.9em;color:#666">
      Keep this passphrase — you can use it to log in, update your
            answers, and cancel your registration if needed. This same passphrase
            will also be used later in the tournament to submit scores and check
            your next opponents.
    </p>
    <p style="font-size:.9em;color:#666">
        Use the link below to return to this registration. When the tournament
        starts, this link will also take you to the tournament view.
  </p>
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">Open registration</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">This is an automated message from the tournament organizer. Feel free to reply if you have any questions or need any assistance!</p>
</div>"""
    return subject, body


def render_credentials_email(
    *,
    lobby_name: str,
    player_name: str,
    passphrase: str,
    token: str,
    lobby_alias: str | None = None,
    lobby_id: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a credentials reminder email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register?id={lobby_id}"
    login_url = f"{base}{lobby_path}?token={token}" if base else ""

    subject = f"Your login details — {lobby_name}"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">Your login details 🔑</h2>
  <p>Hi <strong>{_esc(player_name)}</strong>, here are your credentials for
     <strong>{_esc(lobby_name)}</strong>.</p>
  <p>Your personal passphrase:</p>
  <p style="text-align:center"><span style="{_CODE_STYLE}">{_esc(passphrase)}</span></p>
    <p style="font-size:.9em;color:#666">
        Keep this passphrase — you can use it later to log in, update your
        answers, and cancel your registration if needed. This same passphrase
        will also be used later in the tournament to submit scores and check
        your next opponents.
    </p>
    <p style="font-size:.9em;color:#666">
        Use the link below to open your registration. When the tournament starts,
        this link will also take you to the tournament view.
    </p>
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">Open registration</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">This is an automated message from the tournament organizer. Feel free to reply if you have any questions or need any assistance!</p>
</div>"""
    return subject, body


def render_tournament_started_email(
    *,
    tournament_name: str,
    player_name: str,
    passphrase: str,
    token: str,
    tournament_id: str = "",
    tournament_alias: str | None = None,
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a "tournament started" notification."""
    base = _site_url()
    tv_path = f"/tv/{tournament_alias}" if tournament_alias else f"/tv/{tournament_id}"
    login_url = f"{base}{tv_path}?player_token={token}" if base else ""

    subject = f"Tournament started — {tournament_name}"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">The tournament is live! 🏆</h2>
  <p>Hi <strong>{_esc(player_name)}</strong>,
     <strong>{_esc(tournament_name)}</strong> has started.</p>
  <p>Your personal passphrase:</p>
  <p style="text-align:center"><span style="{_CODE_STYLE}">{_esc(passphrase)}</span></p>
  <p style="font-size:.9em;color:#666">
    Use this passphrase to log in and submit your scores.
  </p>
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">Go to tournament</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">This is an automated message from the tournament organizer. Feel free to reply if you have any questions or need any assistance!</p>
</div>"""
    return subject, body


def render_organizer_message_email(
    *,
    lobby_name: str,
    player_name: str,
    message: str,
    token: str,
    lobby_alias: str | None = None,
    lobby_id: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for an organizer announcement email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register?id={lobby_id}"
    login_url = f"{base}{lobby_path}?token={token}" if base else ""

    subject = f"Message from organizer — {lobby_name}"
    body = f"""\
<div style="{_BASE_STYLE}">
    <h2 style="margin-top:0">Message from organizer 📢</h2>
    <p>Hi <strong>{_esc(player_name)}</strong>, there's a new update for
         <strong>{_esc(lobby_name)}</strong>.</p>
    <div style="margin:12px 0;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;white-space:pre-wrap">
        {_esc(message)}
    </div>
    <p style="font-size:.9em;color:#666">
        Use the link below to open your registration and follow tournament updates.
    </p>
    {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">Open registration</a></p>' if login_url else ""}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    <p style="font-size:.8em;color:#999">This is an automated message from the tournament organizer. Feel free to reply if you have any questions or need any assistance!</p>
</div>"""
    return subject, body


# ────────────────────────────────────────────────────────────────────────────
# Tiny HTML escape (avoid importing markupsafe just for emails)
# ────────────────────────────────────────────────────────────────────────────


def render_invite_email(*, email: str, role: str, accept_url: str) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for an admin invite email."""
    role_label = role.capitalize()
    subject = "You've been invited to Torneos Amistosos"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">You've been invited! 🎾</h2>
  <p>You've been invited to join <strong>Torneos Amistosos</strong> as a
     <strong>{_esc(role_label)}</strong>.</p>
  <p>Click the button below to set up your account. The link is valid for
     <strong>48 hours</strong>.</p>
  <p style="text-align:center">
    <a href="{_esc(accept_url)}" style="{_BUTTON_STYLE}">Accept invitation</a>
  </p>
  <p style="font-size:.85em;color:#666">
    If you weren't expecting this invitation, you can safely ignore this email.
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">This is an automated message from Torneos Amistosos.</p>
</div>"""
    return subject, body


def render_password_reset_email(*, email: str, reset_url: str) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a password-reset email."""
    subject = "Reset your Torneos Amistosos password"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">Password reset 🔑</h2>
  <p>We received a request to reset the password for <strong>{_esc(email)}</strong>.</p>
  <p>Click the button below to choose a new password. The link is valid for
     <strong>1 hour</strong>.</p>
  <p style="text-align:center">
    <a href="{_esc(reset_url)}" style="{_BUTTON_STYLE}">Reset password</a>
  </p>
  <p style="font-size:.85em;color:#666">
    If you didn't request a password reset, you can safely ignore this email.
    Your password won't change until you open the link above and create a new one.
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">This is an automated message from Torneos Amistosos.</p>
</div>"""
    return subject, body


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
