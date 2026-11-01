"""
Player payment tracking routes (phase 1).

Three audiences share the same ``registrant_payments`` rows:

- **Editors** (JWT admin/organizer accounts): fee settings, the per-participant
  payments table, "mark paid" style status changes and reminder emails — on
  both registration lobbies and tournaments.
- **Players on the registration page** (passphrase / token, same auth as the
  ``player-answers`` route): "I've paid" self-report.
- **Player Hub profiles** (profile JWT): pending payments across every lobby
  and tournament linked to the profile, with the same self-report.

Nothing here is ever reachable from ``/public`` endpoints, TV views or share
exports — see ``tests/test_payments.py``.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request

from ..auth.deps import ProfileIdentity, get_current_profile, get_current_user
from ..auth.models import User
from ..email import (
    is_configured as email_is_configured,
    is_valid_email,
    render_organizer_message_email,
    render_tournament_message_email,
    send_email,
)
from . import payments_store as store
from . import player_secret_store as _pss
from .db import get_db
from .helpers import _require_editor_access
from .player_secret_store import lookup_registrant_by_passphrase, lookup_registrant_by_token
from .routes_crud import _get_email_settings as _get_tournament_email_settings
from .routes_registration import (
    _client_ip,
    _email_send_rate_limiter,
    _get_reg_email_settings,
    _get_registrants,
    _get_registration,
    _public_passphrase_rate_limiter,
    _require_registration_editor,
    _send_emails_bounded,
)
from .schemas import (
    HubPaymentOut,
    HubPaymentReportIn,
    PaymentInfoOut,
    PaymentPatchIn,
    PaymentRowOut,
    PaymentSettings,
    PaymentSettingsPatch,
    PaymentsListOut,
    PlayerPaymentReportIn,
    RemindUnpaidIn,
    RemindUnpaidOut,
)
from .state import _tournaments

router = APIRouter(tags=["payments"])

_ACTIVE_REMINDER_STATUSES = ("unpaid", "reported")


# ────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ────────────────────────────────────────────────────────────────────────────


def _tournament_or_404(tid: str) -> dict:
    data = _tournaments.get(tid)
    if data is None:
        raise HTTPException(404, "Tournament not found")
    return data


def _tournament_participants(tid: str) -> list[dict]:
    """Players of a tournament from ``player_secrets`` (lang included for reminder emails).

    Reads the table directly — the cached ``get_secrets_for_tournament`` is the
    fallback for tournaments whose secrets were never persisted (test doubles).
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT player_id, player_name, email, token, lang FROM player_secrets WHERE tournament_id = ?",
            (tid,),
        ).fetchall()
    if rows:
        return [
            {
                "player_id": r["player_id"],
                "player_name": r["player_name"],
                "email": r["email"] or "",
                "token": r["token"],
                "lang": r["lang"] or "en",
            }
            for r in rows
        ]
    secrets = _pss.get_secrets_for_tournament(tid)
    return [
        {
            "player_id": pid,
            "player_name": info.get("name", ""),
            "email": info.get("email", "") or "",
            "token": info.get("token", ""),
            "lang": info.get("lang", "en"),
        }
        for pid, info in secrets.items()
    ]


def _registration_participants(reg_id: str) -> list[dict]:
    return [
        {"player_id": r["player_id"], "player_name": r["player_name"], "email": r.get("email", "") or ""}
        for r in _get_registrants(reg_id)
    ]


def _apply_settings_patch(current: PaymentSettings, req: PaymentSettingsPatch) -> PaymentSettings:
    merged = {**current.model_dump(), **req.model_dump(exclude_none=True)}
    merged["currency"] = str(merged["currency"]).upper()
    return PaymentSettings(**merged)


def _resolve_registrant(reg_id: str, passphrase: str | None, token: str | None) -> dict:
    if passphrase and token:
        raise HTTPException(400, "Provide either passphrase or token, not both")
    if not passphrase and not token:
        raise HTTPException(400, "Provide passphrase or token")
    result = (
        lookup_registrant_by_passphrase(reg_id, passphrase) if passphrase else lookup_registrant_by_token(reg_id, token)  # type: ignore[arg-type]
    )
    if result is None:
        raise HTTPException(401, "Passphrase or token not found")
    return result


# ────────────────────────────────────────────────────────────────────────────
# Settings — registrations
# ────────────────────────────────────────────────────────────────────────────


@router.get("/api/registrations/{rid}/payment-settings", response_model=PaymentSettings)
def get_registration_payment_settings(rid: str, user: User = Depends(get_current_user)) -> PaymentSettings:
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    return store.get_registration_payment_settings(reg)


@router.patch("/api/registrations/{rid}/payment-settings", response_model=PaymentSettings)
async def update_registration_payment_settings(
    rid: str, req: PaymentSettingsPatch, user: User = Depends(get_current_user)
) -> PaymentSettings:
    """Partially update lobby fee settings (only supplied fields change)."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    updated = _apply_settings_patch(store.get_registration_payment_settings(reg), req)
    store.set_registration_payment_settings(reg["id"], updated)
    return updated


# ────────────────────────────────────────────────────────────────────────────
# Settings — tournaments
# ────────────────────────────────────────────────────────────────────────────


@router.get("/api/tournaments/{tid}/payment-settings", response_model=PaymentSettings)
def get_tournament_payment_settings(tid: str, user: User = Depends(get_current_user)) -> PaymentSettings:
    _require_editor_access(tid, user)
    return store.get_tournament_payment_settings(tid)


@router.patch("/api/tournaments/{tid}/payment-settings", response_model=PaymentSettings)
async def update_tournament_payment_settings(
    tid: str, req: PaymentSettingsPatch, user: User = Depends(get_current_user)
) -> PaymentSettings:
    _require_editor_access(tid, user)
    updated = _apply_settings_patch(store.get_tournament_payment_settings(tid), req)
    store.set_tournament_payment_settings(tid, updated)
    return updated


# ────────────────────────────────────────────────────────────────────────────
# Editor listings + status changes
# ────────────────────────────────────────────────────────────────────────────


@router.get("/api/registrations/{rid}/payments", response_model=PaymentsListOut)
def list_registration_payments(rid: str, user: User = Depends(get_current_user)) -> PaymentsListOut:
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    return store.build_listing(
        "registration",
        reg["id"],
        entity_name=reg["name"],
        participants=_registration_participants(reg["id"]),
        settings=store.get_registration_payment_settings(reg),
    )


@router.get("/api/tournaments/{tid}/payments", response_model=PaymentsListOut)
def list_tournament_payments(tid: str, user: User = Depends(get_current_user)) -> PaymentsListOut:
    _require_editor_access(tid, user)
    data = _tournament_or_404(tid)
    return store.build_listing(
        "tournament",
        tid,
        entity_name=data["name"],
        participants=_tournament_participants(tid),
    )


def _patch_payment(
    kind: store.EntityKind,
    entity_id: str,
    entity_name: str,
    participants: list[dict],
    player_id: str,
    req: PaymentPatchIn,
    actor: str,
) -> PaymentRowOut:
    by_id = {p["player_id"]: p for p in participants}
    participant = by_id.get(player_id)
    if participant is None and store.get_row(kind, entity_id, player_id) is None:
        raise HTTPException(404, "Player not found")
    settings = store.get_settings(kind, entity_id)
    row = store.set_status(
        kind,
        entity_id,
        player_id,
        status=req.status,
        actor=actor,
        player_name=(participant or {}).get("player_name"),
        email=(participant or {}).get("email"),
        amount_cents=req.amount_cents,
        method=req.method,
        note=req.note,
        settings=settings,
    )
    listing = store.build_listing(
        kind,
        entity_id,
        entity_name=entity_name,
        participants=participants,
        settings=settings,
    )
    for out in listing.rows:
        if out.player_id == player_id:
            return out
    # Unreachable in practice: the row was just written.
    return PaymentRowOut(
        id=row["id"],
        player_id=player_id,
        player_name=row.get("player_name") or "",
        status=row["status"],
        amount_cents=row.get("amount_cents") or settings.fee_cents,
        currency=row.get("currency") or settings.currency,
        concept=store.make_concept(entity_name, row.get("player_name") or ""),
    )


@router.patch("/api/registrations/{rid}/payments/{player_id}", response_model=PaymentRowOut)
async def patch_registration_payment(
    rid: str, player_id: str, req: PaymentPatchIn, user: User = Depends(get_current_user)
) -> PaymentRowOut:
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    return _patch_payment(
        "registration",
        reg["id"],
        reg["name"],
        _registration_participants(reg["id"]),
        player_id,
        req,
        user.username,
    )


@router.patch("/api/tournaments/{tid}/payments/{player_id}", response_model=PaymentRowOut)
async def patch_tournament_payment(
    tid: str, player_id: str, req: PaymentPatchIn, user: User = Depends(get_current_user)
) -> PaymentRowOut:
    _require_editor_access(tid, user)
    data = _tournament_or_404(tid)
    return _patch_payment(
        "tournament",
        tid,
        data["name"],
        _tournament_participants(tid),
        player_id,
        req,
        user.username,
    )


# ────────────────────────────────────────────────────────────────────────────
# Reminder emails
# ────────────────────────────────────────────────────────────────────────────


def _pending_rows(listing: PaymentsListOut) -> list[PaymentRowOut]:
    return [r for r in listing.rows if r.status in _ACTIVE_REMINDER_STATUSES]


@router.post("/api/registrations/{rid}/payments/remind-unpaid", response_model=RemindUnpaidOut)
async def remind_unpaid_registration(
    rid: str,
    request: Request,
    req: RemindUnpaidIn | None = None,
    user: User = Depends(get_current_user),
) -> RemindUnpaidOut:
    """Email every unpaid/reported registrant the amount, methods and concept."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")
    client_ip = _client_ip(request)
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]
    settings = store.get_registration_payment_settings(reg)
    if settings.fee_cents <= 0:
        raise HTTPException(400, "No fee configured for this lobby")

    registrants = {r["player_id"]: r for r in _get_registrants(reg_id)}
    listing = store.build_listing(
        "registration",
        reg_id,
        entity_name=reg["name"],
        participants=_registration_participants(reg_id),
        settings=settings,
    )
    es = _get_reg_email_settings(reg)
    jobs: list[tuple[str, str, str]] = []
    unreachable: list[str] = []
    for row in _pending_rows(listing):
        registrant = registrants.get(row.player_id)
        email = (registrant or {}).get("email") or row.email
        if not registrant or not email or not is_valid_email(email):
            unreachable.append(row.player_name)
            continue
        lang = registrant.get("lang", "en")
        message = (req.message if req and req.message else None) or store.reminder_message(
            settings, concept=row.concept, entity_name=reg["name"], lang=lang
        )
        subject, body = render_organizer_message_email(
            lobby_name=reg["name"],
            player_name=row.player_name,
            message=message,
            token=registrant["token"],
            lobby_alias=reg.get("alias"),
            lobby_id=reg_id,
            reply_to=es.reply_to,
            lang=lang,
        )
        if req and req.subject:
            subject = req.subject
        jobs.append((email, subject, body))
    sent, failed = await _send_emails_bounded(jobs, es)
    return RemindUnpaidOut(sent=sent, failed=failed, skipped=len(unreachable), unreachable=unreachable)


@router.post("/api/tournaments/{tid}/payments/remind-unpaid", response_model=RemindUnpaidOut)
async def remind_unpaid_tournament(
    tid: str,
    request: Request,
    req: RemindUnpaidIn | None = None,
    user: User = Depends(get_current_user),
) -> RemindUnpaidOut:
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")
    client_ip = _client_ip(request)
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    _require_editor_access(tid, user)
    data = _tournament_or_404(tid)
    settings = store.get_tournament_payment_settings(tid)
    if settings.fee_cents <= 0:
        raise HTTPException(400, "No fee configured for this tournament")

    participants = _tournament_participants(tid)
    by_id = {p["player_id"]: p for p in participants}
    listing = store.build_listing(
        "tournament",
        tid,
        entity_name=data["name"],
        participants=participants,
        settings=settings,
    )
    es = _get_tournament_email_settings(tid)
    sent = failed = 0
    unreachable: list[str] = []
    for row in _pending_rows(listing):
        info = by_id.get(row.player_id)
        email = (info or {}).get("email") or row.email
        if not info or not email or not is_valid_email(email):
            unreachable.append(row.player_name)
            continue
        lang = info.get("lang", "en")
        message = (req.message if req and req.message else None) or store.reminder_message(
            settings, concept=row.concept, entity_name=data["name"], lang=lang
        )
        subject, body = render_tournament_message_email(
            tournament_name=data["name"],
            player_name=row.player_name,
            message=message,
            token=info["token"],
            tournament_id=tid,
            tournament_alias=data.get("alias"),
            reply_to=es.reply_to,
            lang=lang,
        )
        if req and req.subject:
            subject = req.subject
        ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
        if ok:
            sent += 1
        else:
            failed += 1
    return RemindUnpaidOut(sent=sent, failed=failed, skipped=len(unreachable), unreachable=unreachable)


# ────────────────────────────────────────────────────────────────────────────
# Player self-report (registration page)
# ────────────────────────────────────────────────────────────────────────────


@router.post("/api/registrations/{rid}/player-payment-report", response_model=PaymentInfoOut)
async def player_payment_report(rid: str, req: PlayerPaymentReportIn, request: Request) -> PaymentInfoOut:
    """ "I've paid": ``unpaid`` -> ``reported``. Never downgrades a confirmed row."""
    client_ip = _client_ip(request)
    _public_passphrase_rate_limiter.check(client_ip, "Too many attempts — try again later")
    _public_passphrase_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    reg_id = reg["id"]
    settings = store.get_registration_payment_settings(reg)
    if settings.fee_cents <= 0:
        raise HTTPException(400, "No fee configured for this lobby")
    registrant = _resolve_registrant(reg_id, req.passphrase, req.token)
    email = next((r.get("email") for r in _get_registrants(reg_id) if r["player_id"] == registrant["player_id"]), "")
    store.report_payment(
        "registration",
        reg_id,
        registrant["player_id"],
        player_name=registrant["player_name"],
        email=email or None,
        reference=req.reference,
        method=req.method,
    )
    info = store.player_payment_info(
        "registration",
        reg_id,
        entity_name=reg["name"],
        player_id=registrant["player_id"],
        player_name=registrant["player_name"],
        settings=settings,
    )
    if info is None:  # pragma: no cover — fee > 0 was checked above
        raise HTTPException(400, "No fee configured for this lobby")
    return info


# ────────────────────────────────────────────────────────────────────────────
# Player Hub
# ────────────────────────────────────────────────────────────────────────────


@router.get("/api/player-profile/payments", response_model=list[HubPaymentOut])
def hub_list_payments(identity: ProfileIdentity | None = Depends(get_current_profile)) -> list[HubPaymentOut]:
    """Pending payments (unpaid / reported) across the profile's lobbies and tournaments."""
    if identity is None:
        raise HTTPException(401, "Profile authentication required")
    return store.hub_payments_for_profile(identity.profile_id)


@router.post("/api/player-profile/payments/{key}/report", response_model=list[HubPaymentOut])
async def hub_report_payment(
    key: str,
    req: HubPaymentReportIn | None = None,
    identity: ProfileIdentity | None = Depends(get_current_profile),
) -> list[HubPaymentOut]:
    """Self-report from the Hub; the key must belong to one of the profile's own entries."""
    if identity is None:
        raise HTTPException(401, "Profile authentication required")
    parsed = store.parse_hub_key(key)
    if parsed is None:
        raise HTTPException(400, "Invalid payment key")
    kind, entity_id, player_id = parsed
    owned = next(
        (
            p
            for p in store.profile_participations(identity.profile_id)
            if p["kind"] == kind and p["entity_id"] == entity_id and p["player_id"] == player_id
        ),
        None,
    )
    if owned is None:
        raise HTTPException(404, "Payment not found")
    if store.get_settings(kind, entity_id).fee_cents <= 0 and store.get_row(kind, entity_id, player_id) is None:
        raise HTTPException(400, "No fee configured")
    store.report_payment(
        kind,
        entity_id,
        player_id,
        player_name=owned.get("player_name"),
        email=owned.get("email"),
        reference=req.reference if req else None,
        method=req.method if req else None,
    )
    return store.hub_payments_for_profile(identity.profile_id)
