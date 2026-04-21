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


def _tx(lang: str, en: str, es: str) -> str:
    """Return the Spanish text when ``lang == 'es'``, otherwise English."""
    return es if lang == "es" else en


def render_registration_confirmation(
    *,
    lobby_name: str,
    player_name: str,
    passphrase: str,
    token: str,
    lobby_alias: str | None = None,
    lobby_id: str = "",
    reply_to: str = "",
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a registration confirmation email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
    login_url = f"{base}{lobby_path}?token={token}" if base else ""

    subject = _tx(lang, f"Registration confirmed \u2014 {lobby_name}", f"Registro confirmado \u2014 {lobby_name}")
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, "You're registered! \U0001f3be", "\u00a1Est\u00e1s registrado! \U0001f3be")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>, you've been registered for <strong>{_esc(lobby_name)}</strong>.", f"Hola <strong>{_esc(player_name)}</strong>, te has registrado en <strong>{_esc(lobby_name)}</strong>.")}</p>
  <p>{_tx(lang, "Your personal passphrase:", "Tu contrase\u00f1a personal:")}</p>
  <p style="text-align:center"><span style="{_CODE_STYLE}">{_esc(passphrase)}</span></p>
  <p style="font-size:.9em;color:#666">{_tx(lang, "Keep this passphrase \u2014 you can use it to log in, update your answers, and cancel your registration if needed. This same passphrase will also be used later in the tournament to submit scores and check your next opponents.", "Guard\u00e1 esta contrase\u00f1a \u2014 pod\u00e9s usarla para ingresar, actualizar tus respuestas y cancelar tu registro si es necesario. Esta misma contrase\u00f1a se usar\u00e1 tambi\u00e9n durante el torneo para cargar resultados y ver tus pr\u00f3ximos rivales.")}</p>
  <p style="font-size:.9em;color:#666">{_tx(lang, "Use the link below to return to this registration. When the tournament starts, this link will also take you to the tournament view.", "Us\u00e1 el enlace de abajo para volver a tu registro. Cuando el torneo comience, este enlace tambi\u00e9n te llevar\u00e1 a la vista del torneo.")}</p>
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Open registration", "Abrir registro")}</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to, lang)}
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
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a credentials reminder email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
    login_url = f"{base}{lobby_path}?token={token}" if base else ""

    subject = _tx(lang, f"Your login details \u2014 {lobby_name}", f"Tus datos de acceso \u2014 {lobby_name}")
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, "Your login details \U0001f511", "Tus datos de acceso \U0001f511")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>, here are your credentials for <strong>{_esc(lobby_name)}</strong>.", f"Hola <strong>{_esc(player_name)}</strong>, estas son tus credenciales para <strong>{_esc(lobby_name)}</strong>.")}</p>
  <p>{_tx(lang, "Your personal passphrase:", "Tu contrase\u00f1a personal:")}</p>
  <p style="text-align:center"><span style="{_CODE_STYLE}">{_esc(passphrase)}</span></p>
  <p style="font-size:.9em;color:#666">{_tx(lang, "Keep this passphrase \u2014 you can use it later to log in, update your answers, and cancel your registration if needed. This same passphrase will also be used later in the tournament to submit scores and check your next opponents.", "Guard\u00e1 esta contrase\u00f1a \u2014 pod\u00e9s usarla despu\u00e9s para ingresar, actualizar tus respuestas y cancelar tu registro si es necesario. Esta misma contrase\u00f1a se usar\u00e1 tambi\u00e9n durante el torneo para cargar resultados y ver tus pr\u00f3ximos rivales.")}</p>
  <p style="font-size:.9em;color:#666">{_tx(lang, "Use the link below to open your registration. When the tournament starts, this link will also take you to the tournament view.", "Us\u00e1 el enlace de abajo para abrir tu registro. Cuando el torneo comience, este enlace tambi\u00e9n te llevar\u00e1 a la vista del torneo.")}</p>
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Open registration", "Abrir registro")}</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to, lang)}
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
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a "tournament started" notification."""
    base = _site_url()
    tv_path = f"/tv/{tournament_alias}" if tournament_alias else f"/tv/{tournament_id}"
    login_url = f"{base}{tv_path}?player_token={token}" if base else ""

    subject = _tx(
        lang, f"Tournament started \u2014 {tournament_name}", f"\u00a1Torneo iniciado! \u2014 {tournament_name}"
    )
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, "The tournament is live! \U0001f3c6", "\u00a1El torneo est\u00e1 en marcha! \U0001f3c6")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>, <strong>{_esc(tournament_name)}</strong> has started.", f"Hola <strong>{_esc(player_name)}</strong>, <strong>{_esc(tournament_name)}</strong> ha comenzado.")}</p>
  <p>{_tx(lang, "Your personal passphrase:", "Tu contrase\u00f1a personal:")}</p>
  <p style="text-align:center"><span style="{_CODE_STYLE}">{_esc(passphrase)}</span></p>
  <p style="font-size:.9em;color:#666">{_tx(lang, "Use this passphrase to log in and submit your scores.", "Us\u00e1 esta contrase\u00f1a para ingresar y cargar tus resultados.")}</p>
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Go to tournament", "Ir al torneo")}</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to, lang)}
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
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for an organizer announcement email."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
    login_url = f"{base}{lobby_path}?token={token}" if base else ""

    subject = _tx(lang, f"Message from organizer \u2014 {lobby_name}", f"Mensaje del organizador \u2014 {lobby_name}")
    body = f"""\
<div style="{_BASE_STYLE}">
    <h2 style="margin-top:0">{_tx(lang, "Message from organizer \U0001f4e2", "Mensaje del organizador \U0001f4e2")}</h2>
    <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>, there's a new update for <strong>{_esc(lobby_name)}</strong>.", f"Hola <strong>{_esc(player_name)}</strong>, hay una novedad para <strong>{_esc(lobby_name)}</strong>.")}</p>
    <div style="margin:12px 0;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;white-space:pre-wrap">
        {_esc(message)}
    </div>
    <p style="font-size:.9em;color:#666">{_tx(lang, "Use the link below to open your registration and follow tournament updates.", "Us\u00e1 el enlace de abajo para abrir tu registro y seguir las novedades del torneo.")}</p>
    {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Open registration", "Abrir registro")}</a></p>' if login_url else ""}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    {_footer(reply_to, lang)}
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
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for an organizer message sent from a tournament."""
    base = _site_url()
    tv_path = f"/tv/{tournament_alias}" if tournament_alias else f"/tv/{tournament_id}"
    login_url = f"{base}{tv_path}?player_token={token}" if base else ""

    subject = _tx(
        lang, f"Message from organizer \u2014 {tournament_name}", f"Mensaje del organizador \u2014 {tournament_name}"
    )
    body = f"""\
<div style="{_BASE_STYLE}">
    <h2 style="margin-top:0">{_tx(lang, "Message from organizer \U0001f4e2", "Mensaje del organizador \U0001f4e2")}</h2>
    <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>, there's a new update for <strong>{_esc(tournament_name)}</strong>.", f"Hola <strong>{_esc(player_name)}</strong>, hay una novedad para <strong>{_esc(tournament_name)}</strong>.")}</p>
    <div style="margin:12px 0;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;white-space:pre-wrap">
        {_esc(message)}
    </div>
    <p style="font-size:.9em;color:#666">{_tx(lang, "Use the link below to go to the tournament and check for updates.", "Us\u00e1 el enlace de abajo para ir al torneo y ver las novedades.")}</p>
    {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Go to tournament", "Ir al torneo")}</a></p>' if login_url else ""}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
    {_footer(reply_to, lang)}
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
    lang: str = "en",
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
        court_part = (
            _tx(
                lang,
                f" \u2014 Court <strong>{_esc(m['court'])}</strong>",
                f" \u2014 Cancha <strong>{_esc(m['court'])}</strong>",
            )
            if m.get("court")
            else ""
        )
        comment_part = (
            f'<br><span style="font-size:.85em;color:#555;font-style:italic">\U0001f4dd {_esc(m["comment"])}</span>'
            if m.get("comment")
            else ""
        )
        contacts_part = _render_contacts(m.get("contacts", []))
        if m.get("bye"):
            waiting = m.get("waiting_for", "")
            vs_part = (
                _tx(
                    lang,
                    f"Your next opponent will be the <strong>{_esc(waiting)}</strong>",
                    f"Tu pr\u00f3ximo rival ser\u00e1 el <strong>{_esc(waiting)}</strong>",
                )
                if waiting
                else _tx(
                    lang, "Your next opponent is to be determined", "Tu pr\u00f3ximo rival est\u00e1 por definirse"
                )
            )
            return f'<li style="margin-bottom:12px">{vs_part}</li>'
        if m.get("teammates"):
            vs_part = _tx(
                lang,
                f"With <strong>{_esc(m['teammates'])}</strong> vs <strong>{_esc(m['opponents'])}</strong>",
                f"Con <strong>{_esc(m['teammates'])}</strong> vs <strong>{_esc(m['opponents'])}</strong>",
            )
        else:
            vs_part = f"vs <strong>{_esc(m['opponents'])}</strong>"
        return f'<li style="margin-bottom:12px">{vs_part}{court_part}{comment_part}{contacts_part}</li>'

    def _round_label(n: int) -> str:
        return _tx(lang, f"Round {n}", f"Ronda {n}")

    round_nums = sorted(set(m.get("round_number", round_number) for m in matches_info))
    multiple_rounds = len(round_nums) > 1
    all_byes = bool(matches_info) and all(m.get("bye") for m in matches_info)

    def _single_round_label() -> str:
        labels = {m.get("round_label", "") for m in matches_info}
        if len(labels) == 1 and (lbl := labels.pop()):
            return lbl
        return _round_label(round_number)

    stage_badge = (
        f'<p style="font-size:.82em;color:#6b7280;margin-top:-4px;margin-bottom:12px">\U0001f4cd {_esc(stage)}</p>'
        if stage
        else ""
    )

    if multiple_rounds:
        round_label = _round_label(round_nums[0]) if len(round_nums) == 1 else ""
        subject = (
            f"{stage}: {round_label} \u2014 {tournament_name}"
            if stage and round_label
            else _tx(
                lang,
                f"{stage}: upcoming rounds \u2014 {tournament_name}",
                f"{stage}: pr\u00f3ximas rondas \u2014 {tournament_name}",
            )
            if stage
            else _tx(
                lang, f"Upcoming rounds \u2014 {tournament_name}", f"Pr\u00f3ximas rondas \u2014 {tournament_name}"
            )
        )
        title = _tx(lang, "Your upcoming matches \U0001f4cb", "Tus pr\u00f3ximos partidos \U0001f4cb")
        intro = _tx(
            lang,
            f"Hi <strong>{_esc(player_name)}</strong>, here are your upcoming matches for <strong>{_esc(tournament_name)}</strong>.",
            f"Hola <strong>{_esc(player_name)}</strong>, estos son tus pr\u00f3ximos partidos en <strong>{_esc(tournament_name)}</strong>.",
        )
        matches_section = ""
        for rn in round_nums:
            round_items = "".join(_match_li(m) for m in matches_info if m.get("round_number", round_number) == rn)
            rn_label = _round_label(rn)
            matches_section += (
                f'<p style="margin-bottom:4px;font-weight:700">{rn_label}</p>'
                f'<ul style="padding-left:20px;margin-top:0">{round_items}</ul>'
            )
    else:
        rl = _single_round_label()
        if all_byes:
            subject = (
                f"{stage}: {rl} \u2014 {tournament_name}"
                if stage
                else _tx(
                    lang,
                    f"{rl} update \u2014 {tournament_name}",
                    f"Actualizaci\u00f3n de {rl} \u2014 {tournament_name}",
                )
            )
            title = _tx(lang, f"{rl} \u2014 awaiting opponent \U0001f4cb", f"{rl} \u2014 esperando rival \U0001f4cb")
            intro = _tx(
                lang,
                f"Hi <strong>{_esc(player_name)}</strong>, your opponent for {rl.lower()} of <strong>{_esc(tournament_name)}</strong> has not been decided yet.",
                f"Hola <strong>{_esc(player_name)}</strong>, tu rival para la {rl.lower()} de <strong>{_esc(tournament_name)}</strong> a\u00fan no se ha definido.",
            )
        else:
            subject = f"{stage}: {rl} \u2014 {tournament_name}" if stage else f"{rl} \u2014 {tournament_name}"
            title = _tx(lang, f"{rl} is up! \U0001f4cb", f"\u00a1{rl} est\u00e1 lista! \U0001f4cb")
            intro = _tx(
                lang,
                f"Hi <strong>{_esc(player_name)}</strong>, {rl.lower()} of <strong>{_esc(tournament_name)}</strong> is ready.",
                f"Hola <strong>{_esc(player_name)}</strong>, la {rl.lower()} de <strong>{_esc(tournament_name)}</strong> est\u00e1 lista.",
            )
        items = "".join(_match_li(m) for m in matches_info)
        if not items:
            items = f"<li>{_tx(lang, 'No matches assigned this round (sit-out).', 'No ten\u00e9s partidos asignados en esta ronda (descans\u00e1s).')}</li>"
        matches_section = f'<ul style="padding-left:20px">{items}</ul>'

    matches_label = _tx(lang, "Status:", "Estado:") if all_byes else _tx(lang, "Your matches:", "Tus partidos:")
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{title}</h2>
  {stage_badge}<p>{intro}</p>
  <p>{matches_label}</p>
  {matches_section}
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Go to tournament", "Ir al torneo")}</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to, lang)}
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
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a final-results email.

    *stats* should have keys like ``wins``, ``losses``, ``draws``,
    ``points_for``, ``points_against``.
    *leaderboard_top* is a list of dicts with ``rank``, ``name``, ``score``.
    """
    base = _site_url()
    tv_path = f"/tv/{tournament_alias}" if tournament_alias else f"/tv/{tournament_id}"
    login_url = f"{base}{tv_path}?player_token={token}" if base else ""

    wins = stats.get("wins", 0)
    losses = stats.get("losses", 0)
    draws = stats.get("draws", 0)
    if draws:
        stats_line = _tx(lang, f"{wins}W \u2013 {losses}L \u2013 {draws}D", f"{wins}G \u2013 {losses}P \u2013 {draws}E")
    else:
        stats_line = _tx(lang, f"{wins}W \u2013 {losses}L", f"{wins}G \u2013 {losses}P")

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

    subject = _tx(lang, f"Final results \u2014 {tournament_name}", f"Resultados finales \u2014 {tournament_name}")
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, "Tournament complete! \U0001f3c6", "\u00a1Torneo finalizado! \U0001f3c6")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>, <strong>{_esc(tournament_name)}</strong> has finished.", f"Hola <strong>{_esc(player_name)}</strong>, <strong>{_esc(tournament_name)}</strong> ha terminado.")}</p>
  <p>{_tx(lang, f"Your final position: <strong>#{rank}</strong> out of {total_players} players ({stats_line}).", f"Tu posici\u00f3n final: <strong>#{rank}</strong> de {total_players} jugadores ({stats_line}).")}</p>
  <h3 style="margin-bottom:8px">{_tx(lang, "Leaderboard", "Tabla de posiciones")}</h3>
  <table style="width:100%;border-collapse:collapse;font-size:.95em">
    <thead>
      <tr style="background:#f3f4f6">
        <th style="padding:6px 10px;text-align:left">#</th>
        <th style="padding:6px 10px;text-align:left">{_tx(lang, "Player", "Jugador")}</th>
        <th style="padding:6px 10px;text-align:right">{_tx(lang, "Score", "Puntos")}</th>
      </tr>
    </thead>
    <tbody>{lb_rows}</tbody>
  </table>
  {f'<p style="text-align:center;margin-top:20px"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "View full results", "Ver resultados completos")}</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to, lang)}
</div>"""
    return subject, body


def render_cancellation_email(
    *,
    lobby_name: str,
    player_name: str,
    lobby_alias: str | None = None,
    lobby_id: str = "",
    reply_to: str = "",
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a registration-cancellation confirmation."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
    register_url = f"{base}{lobby_path}" if base else ""

    subject = _tx(lang, f"Registration cancelled \u2014 {lobby_name}", f"Registro cancelado \u2014 {lobby_name}")
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, "Registration cancelled \u274c", "Registro cancelado \u274c")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>, your registration for <strong>{_esc(lobby_name)}</strong> has been cancelled.", f"Hola <strong>{_esc(player_name)}</strong>, tu registro en <strong>{_esc(lobby_name)}</strong> ha sido cancelado.")}</p>
  <p style="font-size:.9em;color:#666">{_tx(lang, "If this was a mistake, you can register again using the link below (as long as registration is still open).", "Si fue un error, pod\u00e9s volver a registrarte usando el enlace de abajo (siempre que el registro siga abierto).")}</p>
  {f'<p style="text-align:center"><a href="{_esc(register_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Open registration", "Abrir registro")}</a></p>' if register_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to, lang)}
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
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a waitlist spot-available notification."""
    base = _site_url()
    lobby_path = f"/register/{lobby_alias}" if lobby_alias else f"/register/{lobby_id}"
    login_url = f"{base}{lobby_path}?token={token}" if base else ""

    subject = _tx(lang, f"A spot opened up \u2014 {lobby_name}", f"\u00a1Se liber\u00f3 un lugar! \u2014 {lobby_name}")
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, "A spot just opened! \U0001f389", "\u00a1Se liber\u00f3 un lugar! \U0001f389")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>, a spot has become available in <strong>{_esc(lobby_name)}</strong>.", f"Hola <strong>{_esc(player_name)}</strong>, se liber\u00f3 un lugar en <strong>{_esc(lobby_name)}</strong>.")}</p>
  <p style="font-size:.9em;color:#666">{_tx(lang, "You were on the waiting list. The organizer is letting you know that you can now confirm your participation.", "Estabas en la lista de espera. El organizador te avisa que ya pod\u00e9s confirmar tu participaci\u00f3n.")}</p>
  {f'<p style="text-align:center"><a href="{_esc(login_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Open registration", "Abrir registro")}</a></p>' if login_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to, lang)}
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
    verify_token: str = "",
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a Player Hub welcome / passphrase email."""
    base = _site_url()
    if base and access_token:
        player_url = f"{base}/player#token={access_token}"
    elif base:
        player_url = f"{base}/player"
    else:
        player_url = ""
    if base and verify_token and access_token:
        verify_url = f"{base}/player#verify_token={verify_token}&token={access_token}"
    elif base and verify_token:
        verify_url = f"{base}/player#verify_token={verify_token}"
    else:
        verify_url = ""
    display_name = name.strip() or email

    subject = _tx(lang, "Your Player Hub passphrase", "Tu contrase\u00f1a de Player Hub")
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, "Welcome to Player Hub \U0001f3c5", "Bienvenido a Player Hub \U0001f3c5")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(display_name)}</strong>!", f"\u00a1Hola <strong>{_esc(display_name)}</strong>!")}</p>
  <p>{_tx(lang, "Your player profile has been created. Here is your personal passphrase \u2014 it's the only thing you need to log in from any device:", "Tu perfil de jugador fue creado. Esta es tu contrase\u00f1a personal \u2014 es lo \u00fanico que necesit\u00e1s para ingresar desde cualquier dispositivo:")}</p>
  <p style="text-align:center"><span style="{_CODE_STYLE}">{_esc(passphrase)}</span></p>
  <p style="font-size:.9em;color:#666">{_tx(lang, "Keep this passphrase safe. Use it to access your Player Hub dashboard and to log in to any tournament or registration lobby you're linked to.", "Guard\u00e1 esta contrase\u00f1a de forma segura. Usala para acceder a tu panel de Player Hub y para ingresar a cualquier torneo o registro al que est\u00e9s vinculado.")}</p>
    {f'<p style="font-size:.9em;color:#666">{_tx(lang, "Please verify your email address to enable secure account recovery and automatic linking by email.", "Por favor verific\u00e1 tu direcci\u00f3n de email para habilitar la recuperaci\u00f3n segura de tu cuenta y la vinculaci\u00f3n autom\u00e1tica por email.")}</p><p style="text-align:center"><a href="{_esc(verify_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Verify email", "Verificar email")}</a></p>' if verify_url else ""}
  {f'<p style="text-align:center"><a href="{_esc(player_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Open Player Hub", "Abrir Player Hub")}</a></p>' if player_url else ""}
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">{_tx(lang, "This is an automated message from Torneos Amistosos.", "Este es un mensaje autom\u00e1tico de Torneos Amistosos.")}</p>
</div>"""
    return subject, body


def render_player_space_magic_link(
    *,
    name: str,
    email: str,
    access_token: str,
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a Player Hub one-click login link email.

    Used for passphrase recovery — sends a short-lived login link without
    revealing the passphrase in the email body.
    """
    base = _site_url()
    player_url = f"{base}/player#token={access_token}" if base else ""
    display_name = name.strip() or email

    subject = _tx(lang, "Your Player Hub login link", "Tu enlace de acceso a Player Hub")
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, "Player Hub login link \U0001f3c5", "Enlace de acceso a Player Hub \U0001f3c5")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(display_name)}</strong>!", f"\u00a1Hola <strong>{_esc(display_name)}</strong>!")}</p>
  <p>{_tx(lang, "We received a request to access your player profile. Click the button below to log in instantly \u2014 this link is valid for <strong>1 hour</strong> and can only be used once.", "Recibimos una solicitud para acceder a tu perfil de jugador. Hac\u00e9 clic en el bot\u00f3n de abajo para ingresar \u2014 este enlace es v\u00e1lido por <strong>1 hora</strong> y solo se puede usar una vez.")}</p>
  {f'<p style="text-align:center"><a href="{_esc(player_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Open Player Hub", "Abrir Player Hub")}</a></p>' if player_url else ""}
  <p style="font-size:.9em;color:#666">{_tx(lang, "If you didn't request this link, you can safely ignore this email \u2014 your account has not been changed.", "Si no solicitaste este enlace, pod\u00e9s ignorar este email \u2014 tu cuenta no fue modificada.")}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  <p style="font-size:.8em;color:#999">{_tx(lang, "This is an automated message from Torneos Amistosos.", "Este es un mensaje autom\u00e1tico de Torneos Amistosos.")}</p>
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


def _footer(reply_to: str = "", lang: str = "en") -> str:
    """Return the HTML footer paragraph for tournament email templates."""
    if reply_to:
        msg = _tx(
            lang,
            "This is an automated message from the tournament organizer. "
            "To contact the organizer, just hit <strong>Reply</strong> in your email client "
            "\u2014 your reply will go directly to them.",
            "Este es un mensaje autom\u00e1tico del organizador del torneo. "
            "Para contactar al organizador, simplemente respond\u00e9 este email "
            "\u2014 tu respuesta llegar\u00e1 directamente a ellos.",
        )
    else:
        msg = _tx(
            lang,
            "This is an automated message from the tournament organizer. "
            "Feel free to reply if you have any questions or need any assistance!",
            "Este es un mensaje autom\u00e1tico del organizador del torneo. "
            "\u00a1No dudes en responder si ten\u00e9s alguna pregunta o necesit\u00e1s ayuda!",
        )
    return f'<p style="font-size:.8em;color:#999">{msg}</p>'


def _esc(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def render_club_lobby_invite_email(
    *,
    club_name: str,
    lobby_name: str,
    player_name: str,
    registration_alias: str | None = None,
    registration_id: str = "",
    reply_to: str = "",
    sender_name: str = "",
    lang: str = "en",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a club lobby invitation email."""
    base = _site_url()
    reg_path = f"/register/{registration_alias}" if registration_alias else f"/register/{registration_id}"
    reg_url = f"{base}{reg_path}" if base else ""

    subject = _tx(
        lang,
        f"You're invited to {lobby_name}",
        f"Estás invitado a {lobby_name}",
    )
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_tx(lang, f"Invitation to {_esc(lobby_name)}", f"Invitación a {_esc(lobby_name)}")}</h2>
  <p>{_tx(lang, f"Hi <strong>{_esc(player_name)}</strong>,", f"Hola <strong>{_esc(player_name)}</strong>,")}</p>
  <p>{
        _tx(
            lang,
            f"<strong>{_esc(club_name)}</strong> is organising <strong>{_esc(lobby_name)}</strong> and you're invited to join.",
            f"<strong>{_esc(club_name)}</strong> está organizando <strong>{_esc(lobby_name)}</strong> y estás invitado a participar.",
        )
    }</p>
  {
        f'<p style="text-align:center"><a href="{_esc(reg_url)}" style="{_BUTTON_STYLE}">{_tx(lang, "Register now", "Registrarse ahora")}</a></p>'
        if reg_url
        else ""
    }
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to, lang)}
</div>"""
    return subject, body


def render_club_announcement_email(
    *,
    club_name: str,
    player_name: str,
    subject: str,
    message: str,
    reply_to: str = "",
    sender_name: str = "",
) -> tuple[str, str]:
    """Return ``(subject, html_body)`` for a free-form club announcement email."""
    body = f"""\
<div style="{_BASE_STYLE}">
  <h2 style="margin-top:0">{_esc(club_name)}</h2>
  <p>Hi <strong>{_esc(player_name)}</strong>,</p>
  <div style="margin:12px 0;padding:12px 14px;border-radius:8px;background:#f8fafc;border:1px solid #e5e7eb;white-space:pre-wrap">{_esc(message)}</div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
  {_footer(reply_to)}
</div>"""
    return subject, body
