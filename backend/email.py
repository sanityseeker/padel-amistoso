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
from email.utils import formataddr

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


async def send_email(
    to: str,
    subject: str,
    html_body: str,
    *,
    sender_name: str = "",
    reply_to: str = "",
) -> bool:
    """Send an HTML email via SMTP.  Returns ``True`` on success.

    When SMTP is not configured the call is a silent no-op returning
    ``False``.  Exceptions from the SMTP library are caught and logged
    so callers never need to handle them.

    Args:
        to: Recipient email address.
        subject: Email subject line.
        html_body: Full HTML body.
        sender_name: Optional display name that appears before the From address
            (e.g. ``"Summer Cup"``).  When empty the raw ``SMTP_FROM`` address
            is used as-is.
        reply_to: Optional Reply-To address.  When non-empty a ``Reply-To``
            header is added so players can reply directly to the organizer.
    """
    if not is_configured():
        logger.debug("Email not configured — skipping send to %s", to)
        return False

    msg = EmailMessage()
    msg["From"] = formataddr((sender_name, SMTP_FROM)) if sender_name else SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to
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


def send_email_background(
    to: str,
    subject: str,
    html_body: str,
    *,
    sender_name: str = "",
    reply_to: str = "",
) -> None:
    """Fire-and-forget wrapper — schedules ``send_email`` as a background task."""
    if not is_configured():
        return
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(send_email(to, subject, html_body, sender_name=sender_name, reply_to=reply_to))
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
    reply_to: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a registration confirmation email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
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
  {_footer(reply_to)}
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
    reply_to: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a credentials reminder email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
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
  {_footer(reply_to)}
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
    reply_to: str = "",
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
  {_footer(reply_to)}
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
    reply_to: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for an organizer announcement email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
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
    {_footer(reply_to)}
</div>"""
    return subject, body


def render_tournament_message_email(
    *,
    tournament_name: str,
    player_name: str,
    message: str,
    token: str,
    tournament_id: str = "",
    tournament_alias: str | None = None,
    reply_to: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for an organizer message sent from a tournament."""
    base = _site_url()
    tv_path = f"/tv/{tournament_alias}" if tournament_alias else f"/tv/{tournament_id}"
    login_url = f"{base}{tv_path}?player_token={token}" if base else ""

    subject = f"Message from organizer — {tournament_name}"
    body = f"""\
<div style="{_BASE_STYLE}">
    <h2 style="margin-top:0">Message from organizer 📢</h2>
    <p>Hi <strong>{_esc(player_name)}</strong>, there's a new update for
         <strong>{_esc(tournament_name)}</strong>.</p>
    <div style="margin:12px 0;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;white-space:pre-wrap">
        {_esc(message)}
    </div>
    <p style="font-size:.9em;color:#666">
        Use the link below to go to the tournament and check for updates.
    </p>
    {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">Go to tournament</a></p>' if login_url else ""}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    {_footer(reply_to)}
</div>"""
    return subject, body


def render_next_round_email(
    *,
    tournament_name: str,
    player_name: str,
    round_number: int,
    matches_info: list[dict[str, str]],
    stage: str = "",
    token: str = "",
    tournament_id: str = "",
    tournament_alias: str | None = None,
    reply_to: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a next-round notification.

    Each item in *matches_info* should contain keys:
    ``teammates`` (empty string for singles/team-mode), ``opponents``,
    and optionally ``court``, ``comment``, ``contacts``
    (a list of ``{name, info}`` dicts), ``round_number``, and ``round_label``.
    When matches span multiple rounds (e.g. pre-planned group stage) the email
    groups them under per-round sub-headings.
    ``stage`` is a human-readable phase label like ``"Group Stage"`` or
    ``"Mexicano"``; when provided it appears in the subject and as a badge in
    the body.
    """
    base = _site_url()
    tv_path = f"/tv/{tournament_alias}" if tournament_alias else f"/tv/{tournament_id}"
    login_url = f"{base}{tv_path}?player_token={token}" if base else ""

    def _match_li(m: dict) -> str:
        court_part = f" — Court <strong>{_esc(m['court'])}</strong>" if m.get("court") else ""
        comment_part = (
            f'<br><span style="font-size:.85em;color:#555;font-style:italic">📝 {_esc(m["comment"])}</span>'
            if m.get("comment")
            else ""
        )
        contacts_part = _render_contacts(m.get("contacts", []))
        if m.get("bye"):
            # Player has a bye — opponent slot is TBD
            waiting = m.get("waiting_for", "")
            vs_part = (
                f"Your next opponent will be the <strong>{_esc(waiting)}</strong>"
                if waiting
                else "Your next opponent is to be determined"
            )
            return f'<li style="margin-bottom:12px">{vs_part}</li>'
        # Singles / team-mode: no partner — show "vs …" without "With …"
        if m.get("teammates"):
            vs_part = f"With <strong>{_esc(m['teammates'])}</strong> vs <strong>{_esc(m['opponents'])}</strong>"
        else:
            vs_part = f"vs <strong>{_esc(m['opponents'])}</strong>"
        return f'<li style="margin-bottom:12px">{vs_part}{court_part}{comment_part}{contacts_part}</li>'

    # Detect whether this email covers multiple rounds (pre-planned group stage)
    round_nums = sorted(set(m.get("round_number", round_number) for m in matches_info))
    multiple_rounds = len(round_nums) > 1
    all_byes = bool(matches_info) and all(m.get("bye") for m in matches_info)

    # Pick a short round descriptor for the single-round case.
    # Use the match's round_label if all matches share the same one (e.g. "Semi-Final"),
    # otherwise fall back to "Round N".
    def _single_round_label() -> str:
        labels = {m.get("round_label", "") for m in matches_info}
        if len(labels) == 1 and (lbl := labels.pop()):
            return lbl
        return f"Round {round_number}"

    stage_badge = (
        f'<p style="font-size:.82em;color:#6b7280;margin-top:-4px;margin-bottom:12px">📍 {_esc(stage)}</p>'
        if stage
        else ""
    )

    if multiple_rounds:
        round_label = f"Round {round_nums[0]}" if len(round_nums) == 1 else "upcoming rounds"
        subject = f"{stage}: {round_label} — {tournament_name}" if stage else f"Upcoming rounds — {tournament_name}"
        title = "Your upcoming matches 📋"
        intro = (
            f"Hi <strong>{_esc(player_name)}</strong>, here are your upcoming matches "
            f"for <strong>{_esc(tournament_name)}</strong>."
        )
        matches_section = ""
        for rn in round_nums:
            round_items = "".join(_match_li(m) for m in matches_info if m.get("round_number", round_number) == rn)
            matches_section += (
                f'<p style="margin-bottom:4px;font-weight:700">Round {rn}</p>'
                f'<ul style="padding-left:20px;margin-top:0">{round_items}</ul>'
            )
    else:
        rl = _single_round_label()
        if all_byes:
            subject = f"{stage}: {rl} update — {tournament_name}" if stage else f"{rl} update — {tournament_name}"
            title = f"{rl} — awaiting opponent 📋"
            intro = (
                f"Hi <strong>{_esc(player_name)}</strong>, your opponent for {rl.lower()} of "
                f"<strong>{_esc(tournament_name)}</strong> has not been decided yet."
            )
        else:
            subject = f"{stage}: {rl} — {tournament_name}" if stage else f"{rl} — {tournament_name}"
            title = f"{rl} is up! 📋"
            intro = (
                f"Hi <strong>{_esc(player_name)}</strong>, {rl.lower()} of "
                f"<strong>{_esc(tournament_name)}</strong> is ready."
            )
        items = "".join(_match_li(m) for m in matches_info)
        if not items:
            items = "<li>No matches assigned this round (sit-out).</li>"
        matches_section = f'<ul style="padding-left:20px">{items}</ul>'

    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{title}</h2>
  {stage_badge}<p>{intro}</p>
  <p>{"Status:" if all_byes else "Your matches:"}</p>
  {matches_section}
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">Go to tournament</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to)}
</div>"""
    return subject, body


def render_tournament_results_email(
    *,
    tournament_name: str,
    player_name: str,
    rank: int,
    total_players: int,
    stats: dict[str, int | str],
    leaderboard_top: list[dict[str, int | str]],
    token: str,
    tournament_id: str = "",
    tournament_alias: str | None = None,
    reply_to: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a final-results email.

    *stats* should have keys like ``wins``, ``losses``, ``draws``,
    ``points_for``, ``points_against``.
    *leaderboard_top* is a list of dicts with ``rank``, ``name``, ``score``.
    """
    base = _site_url()
    tv_path = f"/tv/{tournament_alias}" if tournament_alias else f"/tv/{tournament_id}"
    login_url = f"{base}{tv_path}?player_token={token}" if base else ""

    # Build stats summary
    wins = stats.get("wins", 0)
    losses = stats.get("losses", 0)
    draws = stats.get("draws", 0)
    stats_line = f"{wins}W – {losses}L"
    if draws:
        stats_line += f" – {draws}D"

    # Build leaderboard rows
    lb_rows = ""
    for entry in leaderboard_top:
        highlight = ' style="font-weight:700;color:#2563eb"' if str(entry.get("name")) == player_name else ""
        lb_rows += (
            f"<tr{highlight}>"
            f'<td style="padding:4px 10px;border-bottom:1px solid #e5e7eb">{_esc(str(entry["rank"]))}</td>'
            f'<td style="padding:4px 10px;border-bottom:1px solid #e5e7eb">{_esc(str(entry["name"]))}</td>'
            f'<td style="padding:4px 10px;border-bottom:1px solid #e5e7eb;text-align:right">{_esc(str(entry["score"]))}</td>'
            f"</tr>"
        )

    subject = f"Final results — {tournament_name}"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">Tournament complete! 🏆</h2>
  <p>Hi <strong>{_esc(player_name)}</strong>,
     <strong>{_esc(tournament_name)}</strong> has finished.</p>
  <p>Your final position: <strong>#{rank}</strong> out of {total_players} players
     ({stats_line}).</p>
  <h3 style="margin-bottom:8px">Leaderboard</h3>
  <table style="width:100%;border-collapse:collapse;font-size:.95em">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:6px 10px;text-align:left">#</th>
        <th style="padding:6px 10px;text-align:left">Player</th>
        <th style="padding:6px 10px;text-align:right">Score</th>
      </tr>
    </thead>
    <tbody>{lb_rows}</tbody>
  </table>
  {f'<p style="text-align:center;margin-top:20px"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">View full results</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to)}
</div>"""
    return subject, body


def render_cancellation_email(
    *,
    lobby_name: str,
    player_name: str,
    lobby_alias: str | None = None,
    lobby_id: str = "",
    reply_to: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a registration-cancellation confirmation."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
    register_url = f"{base}{lobby_path}" if base else ""

    subject = f"Registration cancelled — {lobby_name}"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">Registration cancelled ❌</h2>
  <p>Hi <strong>{_esc(player_name)}</strong>, your registration for
     <strong>{_esc(lobby_name)}</strong> has been cancelled.</p>
  <p style="font-size:.9em;color:#666">
    If this was a mistake, you can register again using the link below
    (as long as registration is still open).
  </p>
  {f'<p style="text-align:center"><a href="{_esc(register_url)}" style="{_BUTTON_STYLE}">Open registration</a></p>' if register_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to)}
</div>"""
    return subject, body


def render_waitlist_spot_email(
    *,
    lobby_name: str,
    player_name: str,
    token: str,
    lobby_alias: str | None = None,
    lobby_id: str = "",
    reply_to: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a waitlist spot-available notification."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
    login_url = f"{base}{lobby_path}?token={token}" if base else ""

    subject = f"A spot opened up — {lobby_name}"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">A spot just opened! 🎉</h2>
  <p>Hi <strong>{_esc(player_name)}</strong>, a spot has become available in
     <strong>{_esc(lobby_name)}</strong>.</p>
  <p style="font-size:.9em;color:#666">
    You were on the waiting list. The organizer is letting you know
    that you can now confirm your participation.
  </p>
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">Open registration</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to)}
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


def render_player_space_welcome(
    *,
    name: str,
    email: str,
    passphrase: str,
    access_token: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a Player Hub welcome / passphrase email."""
    base = _site_url()
    if base and access_token:
        player_url = f"{base}/player#token={access_token}"
    elif base:
        player_url = f"{base}/player"
    else:
        player_url = ""
    display_name = name.strip() or email

    subject = "Your Player Hub passphrase"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">Welcome to Player Hub 🏅</h2>
  <p>Hi <strong>{_esc(display_name)}</strong>!</p>
  <p>Your player profile has been created. Here is your personal passphrase — it's the
     only thing you need to log in from any device:</p>
  <p style="text-align:center"><span style="{_CODE_STYLE}">{_esc(passphrase)}</span></p>
  <p style="font-size:.9em;color:#666">
    Keep this passphrase safe. Use it to access your Player Hub dashboard and
    to log in to any tournament or registration lobby you're linked to.
  </p>
  {f'<p style="text-align:center"><a href="{_esc(player_url)}" style="{_BUTTON_STYLE}">Open Player Hub</a></p>' if player_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">This is an automated message from Torneos Amistosos.</p>
</div>"""
    return subject, body


def render_player_space_magic_link(
    *,
    name: str,
    email: str,
    access_token: str,
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a Player Hub one-click login link email.

    Used for passphrase recovery — sends a short-lived login link without
    revealing the passphrase in the email body.
    """
    base = _site_url()
    player_url = f"{base}/player#token={access_token}" if base else ""
    display_name = name.strip() or email

    subject = "Your Player Hub login link"
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">Player Hub login link 🏅</h2>
  <p>Hi <strong>{_esc(display_name)}</strong>!</p>
  <p>We received a request to access your player profile. Click the button below to log
     in instantly — this link is valid for <strong>1 hour</strong> and can only be
     used once.</p>
  {f'<p style="text-align:center"><a href="{_esc(player_url)}" style="{_BUTTON_STYLE}">Open Player Hub</a></p>' if player_url else ""}
  <p style="font-size:.9em;color:#666">
    If you didn't request this link, you can safely ignore this email — your
    account has not been changed.
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">This is an automated message from Torneos Amistosos.</p>
</div>"""
    return subject, body


def _render_contacts(contacts: list[dict[str, str]]) -> str:
    """Render a compact contact list for match participants.

    Each item should have ``name`` and ``info`` keys.
    Returns an HTML snippet (empty string when no contacts).
    """
    if not contacts:
        return ""
    parts = ", ".join(f"{_esc(c['name'])}: {_esc(c['info'])}" for c in contacts if c.get("info"))
    if not parts:
        return ""
    return f'<br><span style="font-size:.82em;color:#888">📇 {parts}</span>'


def _footer(reply_to: str = "") -> str:
    """Return the HTML footer paragraph for tournament email templates.

    When *reply_to* is set the footer tells players to use the Reply button so
    their message reaches the organiser directly.  Without it the default
    "feel free to reply" text is kept (the organiser may be monitoring the
    sending address).
    """
    if reply_to:
        return (
            '<p style="font-size:.8em;color:#999">This is an automated message from the tournament organizer. '
            "To contact the organizer, just hit <strong>Reply</strong> in your email client "
            "\u2014 your reply will go directly to them.</p>"
        )
    return (
        '<p style="font-size:.8em;color:#999">This is an automated message from the tournament organizer. '
        "Feel free to reply if you have any questions or need any assistance!</p>"
    )


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
