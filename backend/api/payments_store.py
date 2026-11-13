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
from contextlib import nullcontext
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel

from .db import get_db
from .schemas import (
    PAYMENT_STATUSES,
    HubPaymentOut,
    PayableTeammateOut,
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


class PaymentRecord(BaseModel):
    """One ``registrant_payments`` row."""

    id: int
    registration_id: str | None = None
    tournament_id: str | None = None
    player_id: str
    player_name: str | None = None
    email: str | None = None
    status: str
    amount_cents: int | None = None
    currency: str | None = None
    method: str | None = None
    reference: str | None = None
    note: str | None = None
    updated_by: str | None = None
    created_at: str = ""
    updated_at: str = ""


class Participant(BaseModel):
    """A player of a lobby or tournament (``token`` / ``lang`` only filled for tournaments)."""

    player_id: str
    player_name: str = ""
    email: str = ""
    token: str = ""
    lang: str = "en"


@dataclass(frozen=True)
class PaymentTarget:
    """Where a player's payment row lives (own entity, or the lobby's shared row)."""

    kind: EntityKind
    entity_id: str


class _Unset:
    """Sentinel type: "argument not given" (``None`` is a real value for a missing row)."""


UNSET = _Unset()


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


def _load_rows(conn: sqlite3.Connection, kind: EntityKind, entity_id: str) -> dict[str, PaymentRecord]:
    rows = conn.execute(
        f"SELECT * FROM registrant_payments WHERE {_entity_column(kind)} = ?",  # noqa: S608 — column is internal
        (entity_id,),
    ).fetchall()
    return {r["player_id"]: PaymentRecord(**dict(r)) for r in rows}


def source_registration_id(conn: sqlite3.Connection, tid: str) -> str | None:
    """The lobby this tournament was converted from, or ``None``.

    Stored on the tournament side at conversion (``tournament_payment_settings.registration_id``),
    so it survives the deletion of the lobby and its ``converted_to_tids``.
    """
    row = conn.execute(
        "SELECT registration_id FROM tournament_payment_settings WHERE tournament_id = ?", (tid,)
    ).fetchone()
    return row["registration_id"] if row and row["registration_id"] else None


def _shared_lobby_row(conn: sqlite3.Connection, tid: str, player_id: str) -> PaymentRecord | None:
    """The player's row in the source lobby of *tid* (one fee per lobby), whatever tournament it is stamped with."""
    rid = source_registration_id(conn, tid)
    if rid is None:
        return None
    row = conn.execute(
        "SELECT * FROM registrant_payments WHERE registration_id = ? AND player_id = ?", (rid, player_id)
    ).fetchone()
    return PaymentRecord(**dict(row)) if row else None


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
    """Source lobby of this tournament, when it still contains this registrant."""
    rid = source_registration_id(conn, tid)
    if rid is None:
        return None
    hit = conn.execute(
        "SELECT 1 FROM registrants WHERE registration_id = ? AND player_id = ?", (rid, player_id)
    ).fetchone()
    return rid if hit else None


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
    conn: sqlite3.Connection | None = None,
) -> PaymentRecord:
    """Create-or-update the payment row for one participant and log the event.

    Pass *conn* to take part in the caller's transaction (it then commits or rolls back with it).
    A tournament without its own row updates the shared lobby row instead of inserting a second one.
    """
    if status not in PAYMENT_STATUSES:
        raise ValueError(f"Unknown payment status: {status}")
    settings = settings or get_settings(kind, entity_id)
    now = _now()
    with nullcontext(conn) if conn is not None else get_db() as conn:
        existing = conn.execute(
            f"SELECT * FROM registrant_payments WHERE {_entity_column(kind)} = ? AND player_id = ?",  # noqa: S608
            (entity_id, player_id),
        ).fetchone()
        if existing is None and kind == "tournament":
            shared = conn.execute(
                "SELECT * FROM registrant_payments WHERE registration_id = ? AND player_id = ?",
                (source_registration_id(conn, entity_id), player_id),
            ).fetchone()
            existing = shared
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
    return PaymentRecord(**dict(row))


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
) -> PaymentRecord | None:
    """Player self-report: ``unpaid`` (or no row) -> ``reported``.

    Any other state is left untouched (a confirmed ``paid`` row is never
    downgraded). Returns the row, or ``None`` when nothing changed and no row
    exists.
    """
    target = resolve_target(kind, entity_id, player_id)
    existing = get_row(target.kind, target.entity_id, player_id)
    if existing is not None and existing.status != "unpaid":
        return existing
    return set_status(
        target.kind,
        target.entity_id,
        player_id,
        status="reported",
        actor=actor,
        player_name=player_name,
        email=email,
        reference=reference,
        method=method,
    )


def lobby_eligible_ids(rid: str) -> set[str]:
    """Player ids of a lobby's registrants that pass its participant filter (all when none is set).

    Only these players owe the lobby fee: listings, reminders, the player's own
    payment block and the Hub leave the others out.
    """
    from .routes_registration import _eligible_player_ids  # noqa: PLC0415 — routes_registration imports this module

    with get_db() as conn:
        reg = conn.execute("SELECT * FROM registrations WHERE id = ?", (rid,)).fetchone()
        if reg is None:
            return set()
        registrants = conn.execute("SELECT * FROM registrants WHERE registration_id = ?", (rid,)).fetchall()
    return set(_eligible_player_ids(dict(reg), [dict(r) for r in registrants]))


def _owes_nothing(kind: EntityKind, entity_id: str, player_id: str, row: PaymentRecord | None) -> bool:
    """True for a lobby registrant outside the participant filter with nothing paid or reported."""
    if kind != "registration" or (row is not None and row.status != "unpaid"):
        return False
    return player_id not in lobby_eligible_ids(entity_id)


class PayForOthersError(ValueError):
    """A player tried to report a payment for someone who is not eligible."""


def entity_participants(kind: EntityKind, entity_id: str) -> list[Participant]:
    """Eligible registrants of a lobby, or the players of a tournament (``player_secrets``)."""
    with get_db() as conn:
        if kind == "registration":
            rows = conn.execute(
                "SELECT player_id, player_name, email FROM registrants WHERE registration_id = ? ORDER BY registered_at",
                (entity_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT player_id, player_name, email FROM player_secrets WHERE tournament_id = ?",
                (entity_id,),
            ).fetchall()
    eligible = lobby_eligible_ids(entity_id) if kind == "registration" else None
    return [
        Participant(player_id=r["player_id"], player_name=r["player_name"] or "", email=r["email"] or "")
        for r in rows
        if eligible is None or r["player_id"] in eligible
    ]


def _excluded_tournament_ids(tid: str) -> set[str]:
    """Players of a running tournament who no longer take part: withdrawn, or removed mid-rounds (Mexicano)."""
    from .state import _tournaments  # noqa: PLC0415 — state imports the persistence layer

    tournament = (_tournaments.get(tid) or {}).get("tournament")
    out: set[str] = set()
    for record in (getattr(tournament, "withdrawals", None) or {}).values():
        out.update(record.member_ids)
    out.update(p.id for p in getattr(tournament, "_removed_players", None) or [])
    return out


def _eligible_participants(kind: EntityKind, entity_id: str, reporter_id: str) -> list[Participant]:
    """Other players of the event whose payment is still ``unpaid`` (or has no row yet).

    Tournament players who withdrew or were removed are left out. Rows are loaded once (own plus the
    source lobby's) and merged in memory.
    """
    if get_settings(kind, entity_id).fee_cents <= 0:
        return []
    participants = entity_participants(kind, entity_id)
    with get_db() as conn:
        rows = effective_rows(conn, kind, entity_id)
    excluded = _excluded_tournament_ids(entity_id) if kind == "tournament" else set()
    out = []
    for participant in participants:
        pid = participant.player_id
        if pid == reporter_id or pid in excluded:
            continue
        row = rows.get(pid)
        if row is None or row.status == "unpaid":
            out.append(participant)
    return out


def payable_teammates(kind: EntityKind, entity_id: str, reporter_id: str) -> list[PayableTeammateOut]:
    """Id and display name only: no e-mail, no amounts, no status of other players."""
    return [
        PayableTeammateOut(player_id=p.player_id, player_name=p.player_name)
        for p in _eligible_participants(kind, entity_id, reporter_id)
    ]


def report_payment_for_players(
    kind: EntityKind,
    entity_id: str,
    reporter: Participant,
    *,
    reference: str | None,
    method: str | None,
    also_for: list[str],
) -> None:
    """Report the reporter's own payment and, in the same transaction, one for each id in *also_for*.

    Every id must be another player of this event whose row is ``unpaid`` or missing, and (in a
    tournament) not withdrawn or removed; otherwise :class:`PayForOthersError` is raised before
    anything is written. Each selected row becomes ``reported`` with the note "Paid by <reporter>"
    and the reporter as actor in the audit trail. The reporter's own row follows
    :func:`report_payment` (never downgraded past ``unpaid``).
    """
    wanted = list(dict.fromkeys(also_for))
    eligible = {p.player_id: p for p in _eligible_participants(kind, entity_id, reporter.player_id)}
    if any(pid not in eligible for pid in wanted):
        raise PayForOthersError("One of the selected players cannot be paid for")
    settings = get_settings(kind, entity_id)
    payer = reporter.player_name or reporter.player_id
    # Resolved before the transaction opens: the helpers use their own get_db() blocks (shared connection).
    own = resolve_target(kind, entity_id, reporter.player_id)
    targets = {pid: resolve_target(kind, entity_id, pid) for pid in wanted}
    with get_db() as conn:
        own_row = conn.execute(
            f"SELECT status FROM registrant_payments WHERE {_entity_column(own.kind)} = ? AND player_id = ?",  # noqa: S608
            (own.entity_id, reporter.player_id),
        ).fetchone()
        if own_row is None or own_row["status"] == "unpaid":
            set_status(
                own.kind,
                own.entity_id,
                reporter.player_id,
                status="reported",
                actor="player",
                player_name=reporter.player_name,
                email=reporter.email or None,
                reference=reference,
                method=method,
                settings=settings,
                conn=conn,
            )
        for pid in wanted:
            target = targets[pid]
            set_status(
                target.kind,
                target.entity_id,
                pid,
                status="reported",
                actor=f"player:{payer}",
                player_name=eligible[pid].player_name,
                email=eligible[pid].email or None,
                reference=reference,
                method=method,
                note=f"Paid by {payer}",
                settings=settings,
                conn=conn,
            )


def resolve_target(kind: EntityKind, entity_id: str, player_id: str) -> PaymentTarget:
    """Where the player's payment row lives: a tournament without its own row uses the lobby's."""
    if kind == "tournament":
        with get_db() as conn:
            own = conn.execute(
                "SELECT 1 FROM registrant_payments WHERE tournament_id = ? AND player_id = ?", (entity_id, player_id)
            ).fetchone()
            shared = None if own else _shared_lobby_row(conn, entity_id, player_id)
        if shared is not None and shared.registration_id:
            return PaymentTarget("registration", shared.registration_id)
    return PaymentTarget(kind, entity_id)


def effective_rows(conn: sqlite3.Connection, kind: EntityKind, entity_id: str) -> dict[str, PaymentRecord]:
    """Every stored row visible for the event, in two queries: own rows plus, for a tournament, the
    source lobby's rows for players without a row of their own (one fee per lobby)."""
    rows = _load_rows(conn, kind, entity_id)
    if kind == "tournament":
        rid = source_registration_id(conn, entity_id)
        if rid is not None:
            for pid, row in _load_rows(conn, "registration", rid).items():
                rows.setdefault(pid, row)
    return rows


def effective_row(kind: EntityKind, entity_id: str, player_id: str) -> PaymentRecord | None:
    """Own row of the player; for a tournament without one, the source lobby's row."""
    with get_db() as conn:
        own = _get_row(conn, kind, entity_id, player_id)
        if own is None and kind == "tournament":
            return _shared_lobby_row(conn, entity_id, player_id)
    return own


def _get_row(conn: sqlite3.Connection, kind: EntityKind, entity_id: str, player_id: str) -> PaymentRecord | None:
    row = conn.execute(
        f"SELECT * FROM registrant_payments WHERE {_entity_column(kind)} = ? AND player_id = ?",  # noqa: S608
        (entity_id, player_id),
    ).fetchone()
    return PaymentRecord(**dict(row)) if row else None


def get_row(kind: EntityKind, entity_id: str, player_id: str) -> PaymentRecord | None:
    with get_db() as conn:
        return _get_row(conn, kind, entity_id, player_id)


def list_events(payment_id: int) -> list[dict]:
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM payment_events WHERE payment_id = ? ORDER BY id", (payment_id,)).fetchall()
    return [dict(r) for r in rows]


# ────────────────────────────────────────────────────────────────────────────
# Listings
# ────────────────────────────────────────────────────────────────────────────


def _row_out(
    row: PaymentRecord | None,
    participant: Participant,
    settings: PaymentSettings,
    entity_name: str,
) -> PaymentRowOut:
    name = (row.player_name if row else None) or participant.player_name or ""
    return PaymentRowOut(
        id=row.id if row else None,
        player_id=participant.player_id,
        player_name=name,
        email=(row.email if row else None) or participant.email or "",
        status=row.status if row else "unpaid",
        amount_cents=row.amount_cents if row and row.amount_cents is not None else settings.fee_cents,
        currency=(row.currency if row else None) or settings.currency,
        method=row.method if row else None,
        reference=row.reference if row else None,
        note=row.note if row else None,
        concept=make_concept(entity_name, name),
        updated_by=row.updated_by if row else None,
        updated_at=row.updated_at if row else None,
        synthesized=row is None,
    )


def build_listing(
    kind: EntityKind,
    entity_id: str,
    *,
    entity_name: str,
    participants: list[Participant],
    settings: PaymentSettings | None = None,
) -> PaymentsListOut:
    """Merge stored rows with the current participant list.

    Participants without a row are synthesized as ``unpaid`` only when a fee is
    configured; stored rows for participants who left (refund_due etc.) are
    still listed. A tournament converted from a lobby shows the lobby's row for
    a player without a row of its own (one fee per lobby), for participants only.
    For a lobby, *participants* are its eligible registrants only; a stored
    ``unpaid`` row of anyone else is left out too (they owe nothing).
    """
    settings = settings or get_settings(kind, entity_id)
    with get_db() as conn:
        stored = _load_rows(conn, kind, entity_id)
        merged = effective_rows(conn, kind, entity_id)
    out: list[PaymentRowOut] = []
    seen: set[str] = set()
    for p in participants:
        pid = p.player_id
        seen.add(pid)
        row = merged.get(pid)
        if row is None and settings.fee_cents <= 0:
            continue
        out.append(_row_out(row, p, settings, entity_name))
    for pid, row in stored.items():
        if pid in seen or (kind == "registration" and row.status == "unpaid"):
            continue
        out.append(_row_out(row, Participant(player_id=pid, player_name=row.player_name or ""), settings, entity_name))
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
    row = effective_row(kind, entity_id, player_id)
    if (settings.fee_cents <= 0 and row is None) or _owes_nothing(kind, entity_id, player_id, row):
        return None
    return PaymentInfoOut(
        status=row.status if row else "unpaid",
        amount_cents=row.amount_cents if row and row.amount_cents is not None else settings.fee_cents,
        currency=(row.currency if row else None) or settings.currency,
        due_at=settings.due_at,
        instructions=settings.instructions,
        methods=list(settings.methods),
        concept=make_concept(entity_name, player_name),
        reference=row.reference if row else None,
        method=row.method if row else None,
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
    """Lobby deleted: same rule for lobby-only rows; rows keep ``registration_id`` for the audit trail.

    Rows already stamped with a ``tournament_id`` belong to a tournament that still has the
    player, so deleting the lobby leaves them untouched.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM registrant_payments WHERE registration_id = ? AND tournament_id IS NULL", (rid,)
        ).fetchall()
        for row in rows:
            _apply_removal(conn, row, actor, "lobby deleted")


def on_registration_converted(rid: str, tid: str, player_ids: list[str], reg_settings_raw: str | None) -> None:
    """Attach *tid* to the lobby's payment rows, copy settings and remember the source lobby.

    The source lobby id is stored on the tournament side so a second tournament from the same
    lobby keeps finding the shared row after the lobby itself is deleted.
    """
    with get_db() as conn:
        if player_ids:
            placeholders = ",".join("?" * len(player_ids))
            conn.execute(
                f"""UPDATE registrant_payments SET tournament_id = ?
                    WHERE registration_id = ? AND tournament_id IS NULL AND player_id IN ({placeholders})""",  # noqa: S608
                (tid, rid, *player_ids),
            )
        settings_json = json.dumps(parse_payment_settings(reg_settings_raw).model_dump()) if reg_settings_raw else "{}"
        conn.execute(
            """INSERT INTO tournament_payment_settings (tournament_id, settings, registration_id) VALUES (?, ?, ?)
               ON CONFLICT(tournament_id) DO UPDATE SET
                   settings = CASE WHEN ? THEN excluded.settings ELSE settings END,
                   registration_id = excluded.registration_id""",
            (tid, settings_json, rid, 1 if reg_settings_raw else 0),
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
    """``[{kind, entity_id, entity_name, player_id, player_name, email, created_at?}]`` for a Hub profile.

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
            """SELECT ps.tournament_id AS entity_id, t.name AS entity_name, t.created_at AS created_at,
                      ps.player_id, ps.player_name, ps.email
               FROM player_secrets ps JOIN tournaments t ON t.id = ps.tournament_id
               WHERE ps.profile_id = ?""",
            (profile_id,),
        ).fetchall()
        for r in t_rows:
            out.append({"kind": "tournament", **dict(r)})
    return out


HUB_LISTED_STATUSES = ("unpaid", "reported", "refund_due")


def hub_payment_for(p: dict, row: PaymentRecord | None | _Unset = UNSET) -> HubPaymentOut | None:
    """One Hub payment (any status) for a profile participation, or ``None`` when nothing is owed.

    *row* is the already loaded row (``None`` = the player has none); leave it out to load it.
    """
    kind: EntityKind = p["kind"]
    settings = get_settings(kind, p["entity_id"])
    if isinstance(row, _Unset):
        row = effective_row(kind, p["entity_id"], p["player_id"])
    if (row is None and settings.fee_cents <= 0) or _owes_nothing(kind, p["entity_id"], p["player_id"], row):
        return None
    key = hub_key(kind, p["entity_id"], p["player_id"])
    return HubPaymentOut(
        key=key,
        entry_keys=[key],
        entity_type=kind,
        entity_id=p["entity_id"],
        entity_name=p["entity_name"] or "",
        player_id=p["player_id"],
        status=row.status if row else "unpaid",
        amount_cents=row.amount_cents if row and row.amount_cents is not None else settings.fee_cents,
        currency=(row.currency if row else None) or settings.currency,
        due_at=settings.due_at,
        instructions=settings.instructions,
        methods=list(settings.methods),
        concept=make_concept(p["entity_name"] or "", p["player_name"] or ""),
        reference=row.reference if row else None,
    )


def hub_payments_for_profile(profile_id: str) -> list[HubPaymentOut]:
    """Open payments (unpaid / reported / refund_due) across every lobby and tournament of a profile.

    One fee per lobby and player is listed once, keyed on the payment row id (before a row exists:
    on the lobby and player). The item carries the key of the earliest tournament of the profile
    that shows the fee (a lobby entry only when no tournament does); ``entry_keys`` lists every
    entry that shows it, so each card can badge the same single debt.
    """
    parts = profile_participations(profile_id)
    parts.sort(key=lambda p: (p["kind"] != "tournament", p.get("created_at") or "", p["entity_id"]))
    groups: dict[tuple, tuple[dict, PaymentRecord | None, list[str]]] = {}
    for p in parts:
        kind: EntityKind = p["kind"]
        row = effective_row(kind, p["entity_id"], p["player_id"])
        if row is not None:
            group: tuple = ("row", row.id)
        else:
            if kind == "registration":
                lobby_id: str | None = p["entity_id"]
            else:
                with get_db() as conn:
                    lobby_id = source_registration_id(conn, p["entity_id"])
            group = ("lobby", lobby_id, p["player_id"]) if lobby_id else ("own", kind, p["entity_id"], p["player_id"])
        key = hub_key(kind, p["entity_id"], p["player_id"])
        if group in groups:
            groups[group][2].append(key)
        else:
            groups[group] = (p, row, [key])
    out: list[HubPaymentOut] = []
    for p, row, keys in groups.values():
        item = hub_payment_for(p, row)
        if item is not None and item.status in HUB_LISTED_STATUSES:
            item.entry_keys = keys
            out.append(item)
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
    elif lang == "ru":
        lines = [f"Оплата не получена. Сумма: {amount}. Событие: {entity_name}."]
        if settings.due_at:
            lines.append(f"Оплатить до: {settings.due_at}.")
        if methods:
            lines.append("Способы оплаты:\n" + methods)
        lines.append(f"Назначение платежа: {concept}")
        if settings.instructions:
            lines.append(settings.instructions)
        lines.append(
            "Если вы уже оплатили, не обращайте внимания на это сообщение или нажмите «Я оплатил(а)» в вашей заявке."
        )
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
