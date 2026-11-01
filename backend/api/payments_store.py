"""
Player payment tracking — storage and lifecycle rules (no HTTP concerns).

Phase 1 scope: the platform never moves money. Organizers configure a flat
per-player fee plus *displayed* payment instructions (Bizum phone, IBAN,
Revolut / PayPal.me links, cash, free text); players report "I've paid" and
the organizer confirms. State lives in ``registrant_payments`` with an
append-only ``payment_events`` audit trail.

Rows are created lazily: while a lobby/tournament has ``fee_cents > 0`` every
participant without a row is *synthesized* as ``unpaid`` in listings; a real
row is written on the first status change or player report.

Lifecycle rules (see ``on_participant_removed`` / ``on_registration_deleted``):
``paid`` becomes ``refund_due``, ``unpaid`` rows are dropped, everything else is
kept. On lobby -> tournament conversion rows gain ``tournament_id`` so both the
lobby and the tournament admin views show the same rows.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timezone
from typing import Literal

from .db import get_db
from .schemas import (
    PAYMENT_STATUSES,
    HubPaymentOut,
    PaymentInfoOut,
    PaymentMethod,
    PaymentPublicOut,
    PaymentRowOut,
    PaymentSettings,
    PaymentsListOut,
    PaymentSummaryOut,
)

EntityKind = Literal["registration", "tournament"]

_CONCEPT_MAX_LEN = 30


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ────────────────────────────────────────────────────────────────────────────
# Settings
# ────────────────────────────────────────────────────────────────────────────


def parse_payment_settings(raw: str | None) -> PaymentSettings:
    """Decode a stored JSON blob into :class:`PaymentSettings` (defaults on garbage)."""
    if raw:
        try:
            return PaymentSettings(**json.loads(raw))
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
    return PaymentSettings()


def get_registration_payment_settings(reg: dict) -> PaymentSettings:
    """Payment settings for a registration row (as loaded by ``_get_registration``)."""
    return parse_payment_settings(reg.get("payment_settings"))


def set_registration_payment_settings(rid: str, settings: PaymentSettings) -> None:
    with get_db() as conn:
        conn.execute(
            "UPDATE registrations SET payment_settings = ? WHERE id = ?",
            (json.dumps(settings.model_dump()), rid),
        )


def get_tournament_payment_settings(tid: str) -> PaymentSettings:
    """Tournament-level settings live in their own table (see module docstring)."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT settings FROM tournament_payment_settings WHERE tournament_id = ?", (tid,)
        ).fetchone()
    return parse_payment_settings(row["settings"] if row else None)


def set_tournament_payment_settings(tid: str, settings: PaymentSettings) -> None:
    with get_db() as conn:
        conn.execute(
            """INSERT INTO tournament_payment_settings (tournament_id, settings) VALUES (?, ?)
               ON CONFLICT(tournament_id) DO UPDATE SET settings = excluded.settings""",
            (tid, json.dumps(settings.model_dump())),
        )


def get_settings(kind: EntityKind, entity_id: str) -> PaymentSettings:
    if kind == "tournament":
        return get_tournament_payment_settings(entity_id)
    with get_db() as conn:
        row = conn.execute("SELECT payment_settings FROM registrations WHERE id = ?", (entity_id,)).fetchone()
    return parse_payment_settings(row["payment_settings"] if row else None)


def public_payment_info(settings: PaymentSettings) -> PaymentPublicOut | None:
    """Fee info for the public lobby page — ``None`` when no fee is configured."""
    if settings.fee_cents <= 0:
        return None
    return PaymentPublicOut(
        fee_cents=settings.fee_cents,
        currency=settings.currency,
        due_at=settings.due_at,
        instructions=settings.instructions,
        methods=list(settings.methods) if settings.show_methods == "always" else [],
    )


# ────────────────────────────────────────────────────────────────────────────
# Concept (transfer reference)
# ────────────────────────────────────────────────────────────────────────────


def _slug_token(value: str, max_len: int) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9]+", "", value or "")
    return cleaned[:max_len].upper()


def make_concept(entity_name: str, player_name: str) -> str:
    """``PADEL-<short event name>-<player first name>`` capped at ~30 chars.

    Generated server-side so the admin table and the player's screen show the
    exact same string.
    """
    first = (player_name or "").strip().split()[0] if (player_name or "").strip() else "PLAYER"
    first_tok = _slug_token(first, 10) or "PLAYER"
    budget = _CONCEPT_MAX_LEN - len("PADEL-") - 1 - len(first_tok)
    event_tok = _slug_token(entity_name, max(budget, 4)) or "EVENT"
    return f"PADEL-{event_tok}-{first_tok}"


# ────────────────────────────────────────────────────────────────────────────
# Rows
# ────────────────────────────────────────────────────────────────────────────


def _entity_column(kind: EntityKind) -> str:
    return "tournament_id" if kind == "tournament" else "registration_id"


def _load_rows(conn: sqlite3.Connection, kind: EntityKind, entity_id: str) -> dict[str, dict]:
    rows = conn.execute(
        f"SELECT * FROM registrant_payments WHERE {_entity_column(kind)} = ?",  # noqa: S608 — column is internal
        (entity_id,),
    ).fetchall()
    return {r["player_id"]: dict(r) for r in rows}


def _linked_tournament_id(conn: sqlite3.Connection, rid: str, player_id: str) -> str | None:
    """Tournament (converted from *rid*) that already holds this player, if any."""
    reg = conn.execute("SELECT converted_to_tids FROM registrations WHERE id = ?", (rid,)).fetchone()
    if reg is None or not reg["converted_to_tids"]:
        return None
    try:
        tids = json.loads(reg["converted_to_tids"])
    except (json.JSONDecodeError, ValueError):
        return None
    for tid in tids:
        hit = conn.execute(
            "SELECT 1 FROM player_secrets WHERE tournament_id = ? AND player_id = ?", (tid, player_id)
        ).fetchone()
        if hit:
            return tid
    return None


def _linked_registration_id(conn: sqlite3.Connection, tid: str, player_id: str) -> str | None:
    """Lobby this tournament was converted from that contains this registrant, if any."""
    rows = conn.execute(
        "SELECT id, converted_to_tids FROM registrations WHERE converted_to_tids LIKE ?",
        (f'%"{tid}"%',),
    ).fetchall()
    for reg in rows:
        hit = conn.execute(
            "SELECT 1 FROM registrants WHERE registration_id = ? AND player_id = ?", (reg["id"], player_id)
        ).fetchone()
        if hit:
            return reg["id"]
    return None


def _insert_event(
    conn: sqlite3.Connection,
    payment_id: int,
    from_status: str | None,
    to_status: str,
    actor: str | None,
    note: str | None,
) -> None:
    conn.execute(
        "INSERT INTO payment_events (payment_id, from_status, to_status, actor, at, note) VALUES (?, ?, ?, ?, ?, ?)",
        (payment_id, from_status, to_status, actor, _now(), note),
    )


def set_status(
    kind: EntityKind,
    entity_id: str,
    player_id: str,
    *,
    status: str,
    actor: str | None,
    player_name: str | None = None,
    email: str | None = None,
    amount_cents: int | None = None,
    currency: str | None = None,
    method: str | None = None,
    reference: str | None = None,
    note: str | None = None,
    settings: PaymentSettings | None = None,
) -> dict:
    """Create-or-update the payment row for one participant and log the event.

    Returns the stored row as a dict.
    """
    if status not in PAYMENT_STATUSES:
        raise ValueError(f"Unknown payment status: {status}")
    settings = settings or get_settings(kind, entity_id)
    now = _now()
    with get_db() as conn:
        existing = conn.execute(
            f"SELECT * FROM registrant_payments WHERE {_entity_column(kind)} = ? AND player_id = ?",  # noqa: S608
            (entity_id, player_id),
        ).fetchone()
        if existing is None:
            rid = entity_id if kind == "registration" else _linked_registration_id(conn, entity_id, player_id)
            tid = entity_id if kind == "tournament" else _linked_tournament_id(conn, entity_id, player_id)
            cur = conn.execute(
                """INSERT INTO registrant_payments
                   (registration_id, tournament_id, player_id, player_name, email, status, amount_cents,
                    currency, method, reference, note, updated_by, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    rid,
                    tid,
                    player_id,
                    player_name,
                    email,
                    status,
                    settings.fee_cents if amount_cents is None else amount_cents,
                    currency or settings.currency,
                    method,
                    reference,
                    note,
                    actor,
                    now,
                    now,
                ),
            )
            payment_id = int(cur.lastrowid or 0)
            _insert_event(conn, payment_id, None, status, actor, note)
        else:
            payment_id = int(existing["id"])
            conn.execute(
                """UPDATE registrant_payments
                   SET status = ?, amount_cents = COALESCE(?, amount_cents), currency = COALESCE(?, currency),
                       method = COALESCE(?, method), reference = COALESCE(?, reference),
                       note = COALESCE(?, note), updated_by = ?, updated_at = ?,
                       player_name = COALESCE(?, player_name), email = COALESCE(?, email)
                   WHERE id = ?""",
                (status, amount_cents, currency, method, reference, note, actor, now, player_name, email, payment_id),
            )
            if existing["status"] != status:
                _insert_event(conn, payment_id, existing["status"], status, actor, note)
        row = conn.execute("SELECT * FROM registrant_payments WHERE id = ?", (payment_id,)).fetchone()
    return dict(row)


def report_payment(
    kind: EntityKind,
    entity_id: str,
    player_id: str,
    *,
    player_name: str | None,
    email: str | None,
    reference: str | None,
    method: str | None,
    actor: str = "player",
) -> dict | None:
    """Player self-report: ``unpaid`` (or no row) -> ``reported``.

    Any other state is left untouched (a confirmed ``paid`` row is never
    downgraded). Returns the row, or ``None`` when nothing changed and no row
    exists.
    """
    with get_db() as conn:
        existing = conn.execute(
            f"SELECT * FROM registrant_payments WHERE {_entity_column(kind)} = ? AND player_id = ?",  # noqa: S608
            (entity_id, player_id),
        ).fetchone()
    if existing is not None and existing["status"] != "unpaid":
        return dict(existing)
    return set_status(
        kind,
        entity_id,
        player_id,
        status="reported",
        actor=actor,
        player_name=player_name,
        email=email,
        reference=reference,
        method=method,
    )


def get_row(kind: EntityKind, entity_id: str, player_id: str) -> dict | None:
    with get_db() as conn:
        row = conn.execute(
            f"SELECT * FROM registrant_payments WHERE {_entity_column(kind)} = ? AND player_id = ?",  # noqa: S608
            (entity_id, player_id),
        ).fetchone()
    return dict(row) if row else None


def list_events(payment_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM payment_events WHERE payment_id = ? ORDER BY id", (payment_id,)).fetchall()
    return [dict(r) for r in rows]


# ────────────────────────────────────────────────────────────────────────────
# Listings
# ────────────────────────────────────────────────────────────────────────────


def _row_out(
    row: dict | None,
    participant: dict,
    settings: PaymentSettings,
    entity_name: str,
) -> PaymentRowOut:
    name = (row or {}).get("player_name") or participant.get("player_name") or ""
    return PaymentRowOut(
        id=row["id"] if row else None,
        player_id=participant["player_id"],
        player_name=name,
        email=(row or {}).get("email") or participant.get("email") or "",
        status=row["status"] if row else "unpaid",
        amount_cents=(row or {}).get("amount_cents")
        if row and row.get("amount_cents") is not None
        else settings.fee_cents,
        currency=(row or {}).get("currency") or settings.currency,
        method=(row or {}).get("method"),
        reference=(row or {}).get("reference"),
        note=(row or {}).get("note"),
        concept=make_concept(entity_name, name),
        updated_by=(row or {}).get("updated_by"),
        updated_at=(row or {}).get("updated_at"),
        synthesized=row is None,
    )


def build_listing(
    kind: EntityKind,
    entity_id: str,
    *,
    entity_name: str,
    participants: list[dict],
    settings: PaymentSettings | None = None,
) -> PaymentsListOut:
    """Merge stored rows with the current participant list.

    *participants* is ``[{"player_id", "player_name", "email"}]``. Participants
    without a row are synthesized as ``unpaid`` only when a fee is configured;
    stored rows for participants who left (refund_due etc.) are still listed.
    """
    settings = settings or get_settings(kind, entity_id)
    with get_db() as conn:
        stored = _load_rows(conn, kind, entity_id)
    out: list[PaymentRowOut] = []
    seen: set[str] = set()
    for p in participants:
        pid = p["player_id"]
        seen.add(pid)
        row = stored.get(pid)
        if row is None and settings.fee_cents <= 0:
            continue
        out.append(_row_out(row, p, settings, entity_name))
    for pid, row in stored.items():
        if pid in seen:
            continue
        out.append(
            _row_out(row, {"player_id": pid, "player_name": row.get("player_name") or ""}, settings, entity_name)
        )
    summary = PaymentSummaryOut(total=len(out))
    for r in out:
        if r.status == "paid":
            summary.paid += 1
            summary.collected_cents += r.amount_cents
        elif r.status == "reported":
            summary.reported += 1
        elif r.status == "unpaid":
            summary.unpaid += 1
        elif r.status == "waived":
            summary.waived += 1
        elif r.status == "refund_due":
            summary.refund_due += 1
        elif r.status == "refunded":
            summary.refunded += 1
    return PaymentsListOut(settings=settings, rows=out, summary=summary, entity_name=entity_name)


def player_payment_info(
    kind: EntityKind,
    entity_id: str,
    *,
    entity_name: str,
    player_id: str,
    player_name: str,
    settings: PaymentSettings | None = None,
) -> PaymentInfoOut | None:
    """A registered player's own payment view, or ``None`` when no fee is set."""
    settings = settings or get_settings(kind, entity_id)
    row = get_row(kind, entity_id, player_id)
    if settings.fee_cents <= 0 and row is None:
        return None
    return PaymentInfoOut(
        status=row["status"] if row else "unpaid",
        amount_cents=row["amount_cents"] if row and row.get("amount_cents") is not None else settings.fee_cents,
        currency=(row or {}).get("currency") or settings.currency,
        due_at=settings.due_at,
        instructions=settings.instructions,
        methods=list(settings.methods),
        concept=make_concept(entity_name, player_name),
        reference=(row or {}).get("reference"),
        method=(row or {}).get("method"),
    )


# ────────────────────────────────────────────────────────────────────────────
# Lifecycle hooks
# ────────────────────────────────────────────────────────────────────────────


def _apply_removal(conn: sqlite3.Connection, row: sqlite3.Row, actor: str | None, note: str) -> None:
    if row["status"] == "paid":
        conn.execute(
            "UPDATE registrant_payments SET status = 'refund_due', updated_by = ?, updated_at = ? WHERE id = ?",
            (actor, _now(), row["id"]),
        )
        _insert_event(conn, int(row["id"]), "paid", "refund_due", actor, note)
    elif row["status"] == "unpaid":
        conn.execute("DELETE FROM payment_events WHERE payment_id = ?", (row["id"],))
        conn.execute("DELETE FROM registrant_payments WHERE id = ?", (row["id"],))
    # reported / waived / refund_due / refunded: keep as-is for the organizer to settle.


def on_participant_removed(kind: EntityKind, entity_id: str, player_id: str, actor: str | None = None) -> None:
    """Registrant deleted / player cancelled: paid -> refund_due, unpaid dropped."""
    with get_db() as conn:
        row = conn.execute(
            f"SELECT * FROM registrant_payments WHERE {_entity_column(kind)} = ? AND player_id = ?",  # noqa: S608
            (entity_id, player_id),
        ).fetchone()
        if row is not None:
            _apply_removal(conn, row, actor, "participant removed")


def on_registration_deleted(rid: str, actor: str | None = None) -> None:
    """Lobby deleted: same rule for every row; rows keep ``registration_id`` for the audit trail."""
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM registrant_payments WHERE registration_id = ?", (rid,)).fetchall()
        for row in rows:
            _apply_removal(conn, row, actor, "lobby deleted")


def on_registration_converted(rid: str, tid: str, player_ids: list[str], reg_settings_raw: str | None) -> None:
    """Attach *tid* to the lobby's payment rows for the converted players and copy settings."""
    if not player_ids:
        return
    settings = parse_payment_settings(reg_settings_raw)
    with get_db() as conn:
        placeholders = ",".join("?" * len(player_ids))
        conn.execute(
            f"""UPDATE registrant_payments SET tournament_id = ?
                WHERE registration_id = ? AND tournament_id IS NULL AND player_id IN ({placeholders})""",  # noqa: S608
            (tid, rid, *player_ids),
        )
        if reg_settings_raw:
            conn.execute(
                """INSERT INTO tournament_payment_settings (tournament_id, settings) VALUES (?, ?)
                   ON CONFLICT(tournament_id) DO UPDATE SET settings = excluded.settings""",
                (tid, json.dumps(settings.model_dump())),
            )


# ────────────────────────────────────────────────────────────────────────────
# Player Hub
# ────────────────────────────────────────────────────────────────────────────


def hub_key(kind: EntityKind, entity_id: str, player_id: str) -> str:
    prefix = "t" if kind == "tournament" else "r"
    return f"{prefix}:{entity_id}:{player_id}"


def parse_hub_key(key: str) -> tuple[EntityKind, str, str] | None:
    parts = key.split(":", 2)
    if len(parts) != 3 or parts[0] not in ("t", "r") or not parts[1] or not parts[2]:
        return None
    kind: EntityKind = "tournament" if parts[0] == "t" else "registration"
    return kind, parts[1], parts[2]


def profile_participations(profile_id: str) -> list[dict]:
    """``[{kind, entity_id, entity_name, player_id, player_name, email}]`` for a Hub profile.

    Lobby rows come from ``registrants.profile_id``; tournament rows from
    ``player_secrets.profile_id``. Tournament names are read from the
    ``tournaments`` table (the pickled blob is not needed for this).
    """
    out: list[dict] = []
    with get_db() as conn:
        reg_rows = conn.execute(
            """SELECT r.registration_id AS entity_id, g.name AS entity_name, r.player_id, r.player_name, r.email
               FROM registrants r JOIN registrations g ON g.id = r.registration_id
               WHERE r.profile_id = ?""",
            (profile_id,),
        ).fetchall()
        for r in reg_rows:
            out.append({"kind": "registration", **dict(r)})
        t_rows = conn.execute(
            """SELECT ps.tournament_id AS entity_id, t.name AS entity_name, ps.player_id, ps.player_name, ps.email
               FROM player_secrets ps JOIN tournaments t ON t.id = ps.tournament_id
               WHERE ps.profile_id = ?""",
            (profile_id,),
        ).fetchall()
        for r in t_rows:
            out.append({"kind": "tournament", **dict(r)})
    return out


def hub_payments_for_profile(profile_id: str) -> list[HubPaymentOut]:
    """Pending (unpaid / reported) payments across every lobby and tournament of a profile.

    A lobby that was converted and a tournament created from it share one row;
    the tournament entry wins so the player sees it once.
    """
    parts = profile_participations(profile_id)
    out: list[HubPaymentOut] = []
    seen_payment_ids: set[int] = set()
    tournament_keys = {(p["entity_id"], p["player_id"]) for p in parts if p["kind"] == "tournament"}
    # Tournaments first so shared (converted) rows are attributed to them.
    parts.sort(key=lambda p: 0 if p["kind"] == "tournament" else 1)
    for p in parts:
        kind: EntityKind = p["kind"]
        settings = get_settings(kind, p["entity_id"])
        row = get_row(kind, p["entity_id"], p["player_id"])
        if row is None and settings.fee_cents <= 0:
            continue
        if row is not None:
            if row["id"] in seen_payment_ids:
                continue
            seen_payment_ids.add(row["id"])
        elif kind == "registration":
            # No row yet: a lobby entry already converted into one of the
            # profile's tournaments is shown under that tournament only.
            with get_db() as conn:
                linked_tid = _linked_tournament_id(conn, p["entity_id"], p["player_id"])
            if linked_tid and (linked_tid, p["player_id"]) in tournament_keys:
                continue
        status = row["status"] if row else "unpaid"
        if status not in ("unpaid", "reported"):
            continue
        out.append(
            HubPaymentOut(
                key=hub_key(kind, p["entity_id"], p["player_id"]),
                entity_type=kind,
                entity_id=p["entity_id"],
                entity_name=p["entity_name"] or "",
                player_id=p["player_id"],
                status=status,
                amount_cents=row["amount_cents"] if row and row.get("amount_cents") is not None else settings.fee_cents,
                currency=(row or {}).get("currency") or settings.currency,
                due_at=settings.due_at,
                instructions=settings.instructions,
                methods=list(settings.methods),
                concept=make_concept(p["entity_name"] or "", p["player_name"] or ""),
                reference=(row or {}).get("reference"),
            )
        )
    return out


# ────────────────────────────────────────────────────────────────────────────
# Reminder email copy
# ────────────────────────────────────────────────────────────────────────────


def format_amount(amount_cents: int, currency: str) -> str:
    return f"{amount_cents / 100:.2f} {currency.upper()}"


def method_line(m: PaymentMethod) -> str:
    label = m.label or {
        "bizum": "Bizum",
        "iban": "IBAN",
        "revolut": "Revolut",
        "paypal_me": "PayPal",
        "cash": "Cash",
        "other": "Other",
    }.get(m.kind, m.kind)
    return f"{label}: {m.value}" if m.value else label


def reminder_message(settings: PaymentSettings, *, concept: str, entity_name: str, lang: str = "en") -> str:
    """Default localized reminder body with amount, methods and the concept."""
    amount = format_amount(settings.fee_cents, settings.currency)
    methods = "\n".join(f"- {method_line(m)}" for m in settings.methods)
    if lang == "es":
        lines = [f"Queda pendiente el pago de {amount} para {entity_name}."]
        if settings.due_at:
            lines.append(f"Fecha limite: {settings.due_at}.")
        if methods:
            lines.append("Formas de pago:\n" + methods)
        lines.append(f"Concepto: {concept}")
        if settings.instructions:
            lines.append(settings.instructions)
        lines.append("Si ya has pagado, ignora este mensaje o marca 'Ya he pagado' en tu inscripcion.")
    else:
        lines = [f"Your payment of {amount} for {entity_name} is still pending."]
        if settings.due_at:
            lines.append(f"Due by: {settings.due_at}.")
        if methods:
            lines.append("Payment methods:\n" + methods)
        lines.append(f"Concept: {concept}")
        if settings.instructions:
            lines.append(settings.instructions)
        lines.append("If you have already paid, ignore this message or tap 'I've paid' on your registration.")
    return "\n\n".join(lines)
