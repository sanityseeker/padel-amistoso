"""
Registration lobby routes.

Allows admins to create shareable registration links where players can
self-register before a tournament is created. Once registrations are
collected, the admin converts the lobby into a real tournament — player
IDs, passphrases, and tokens carry over so the same code works for
scoring.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .rate_limit import BoundedRateLimiter
from ..auth.deps import get_current_user
from ..auth.models import User, UserRole
from ..email import (
    is_configured as email_is_configured,
    is_valid_email,
    render_cancellation_email,
    render_credentials_email,
    render_organizer_message_email,
    render_registration_confirmation,
    render_waitlist_spot_email,
    send_email,
    send_email_background,
)
from ..models import Court, Player, TournamentType
from ..tournaments import GroupPlayoffTournament, MexicanoTournament, PlayoffTournament
from ..tournaments.player_secrets import generate_passphrase, generate_token
from .db import add_co_editor, get_db, get_registration_co_editors, get_shared_registration_ids
from .helpers import _store_tournament
from .player_secret_store import (
    lookup_registrant_by_passphrase,
    lookup_registrant_by_token,
    lookup_profile_by_passphrase,
)
from .schemas import (
    ConvertRegistrationRequest,
    EmailSettings,
    EmailSettingsRequest,
    LinkedTournamentOut,
    QuestionDef,
    RegistrantAdminOut,
    RegistrantAnswersUpdateIn,
    RegistrantIn,
    RegistrantLoginIn,
    RegistrantLoginOut,
    RegistrantPatch,
    RegistrationAdminOut,
    RegistrationCreate,
    RegistrationPublicOut,
    RegistrationUpdate,
    SetAliasRequest,
)
from .state import allocate_tournament_id, _tournaments

router = APIRouter(prefix="/api/registrations", tags=["registrations"])

_CREATE_MAX_ATTEMPTS = 20
_CREATE_WINDOW_SECONDS = 60
_CREATE_MAX_TRACKED_IPS = 4096

_PUBLIC_REGISTER_MAX_ATTEMPTS = 60
_PUBLIC_PASSCODE_MAX_ATTEMPTS = 90
_PUBLIC_WINDOW_SECONDS = 60
_PUBLIC_MAX_TRACKED_IPS = 4096

_create_rate_limiter = BoundedRateLimiter(
    max_attempts=_CREATE_MAX_ATTEMPTS,
    window_seconds=_CREATE_WINDOW_SECONDS,
    max_tracked_ips=_CREATE_MAX_TRACKED_IPS,
)

_email_send_rate_limiter = BoundedRateLimiter(
    max_attempts=30,
    window_seconds=60,
    max_tracked_ips=4096,
)

_public_register_rate_limiter = BoundedRateLimiter(
    max_attempts=_PUBLIC_REGISTER_MAX_ATTEMPTS,
    window_seconds=_PUBLIC_WINDOW_SECONDS,
    max_tracked_ips=_PUBLIC_MAX_TRACKED_IPS,
)

_public_passphrase_rate_limiter = BoundedRateLimiter(
    max_attempts=_PUBLIC_PASSCODE_MAX_ATTEMPTS,
    window_seconds=_PUBLIC_WINDOW_SECONDS,
    max_tracked_ips=_PUBLIC_MAX_TRACKED_IPS,
)

_registration_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)

# Dedicated lock for sequential registration ID allocation — mirrors
# ``_id_allocation_lock`` in ``state.py`` for tournament IDs.
_reg_id_allocation_lock: asyncio.Lock = asyncio.Lock()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _get_registration_lock(registration_id: str) -> asyncio.Lock:
    return _registration_locks[registration_id]


def _email_requirement(reg: dict) -> str:
    value = (reg.get("email_requirement") or "optional").strip().lower()
    if value in {"required", "optional", "disabled"}:
        return value
    return "optional"


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────


def _next_registration_id() -> str:
    """Return the next sequential registration ID (e.g. ``r3``)."""
    with get_db() as conn:
        row = conn.execute("SELECT value FROM meta WHERE key = 'reg_counter'").fetchone()
        if row is None:
            conn.execute("INSERT INTO meta (key, value) VALUES ('reg_counter', 1)")
            return "r1"
        new_val = row["value"] + 1
        conn.execute("UPDATE meta SET value = ? WHERE key = 'reg_counter'", (new_val,))
        return f"r{new_val}"


def _get_registration(rid: str) -> dict:
    """Load a registration row or raise 404.  Resolves aliases too."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM registrations WHERE id = ?", (rid,)).fetchone()
        if row is None:
            row = conn.execute("SELECT * FROM registrations WHERE alias = ?", (rid,)).fetchone()
    if row is None:
        raise HTTPException(404, "Registration not found")
    return dict(row)


def _get_registrants(rid: str) -> list[dict]:
    """Load all registrants for a registration."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM registrants WHERE registration_id = ? ORDER BY registered_at",
            (rid,),
        ).fetchall()
    return [dict(r) for r in rows]


def _require_registration_owner(reg: dict, user: User) -> None:
    """Raise 403 if *user* neither owns the registration nor is an admin.

    Use this only for destructive or share-management operations that should
    be restricted to the original owner.
    """
    if user.role == UserRole.ADMIN:
        return
    if reg.get("owner") != user.username:
        raise HTTPException(403, "You do not have permission to modify this registration")


def _require_registration_editor(reg: dict, user: User) -> None:
    """Raise 403 if *user* may not edit the registration.

    Allowed callers:
    - Admin users (bypass all ownership checks)
    - The registration owner
    - Users that have been granted co-editor access via ``registration_shares``
    """
    if user.role == UserRole.ADMIN:
        return
    if reg.get("owner") == user.username:
        return
    if user.username in get_registration_co_editors(reg["id"]):
        return
    raise HTTPException(403, "You do not have permission to modify this registration")


def _parse_questions(raw: str | None) -> list[QuestionDef]:
    """Deserialise the JSON *questions* column into ``QuestionDef`` models."""
    if not raw:
        return []
    return [QuestionDef(**q) for q in json.loads(raw)]


def _parse_answers(raw: str | None) -> dict[str, str]:
    """Deserialise the JSON *answers* column into a dict."""
    if not raw:
        return {}
    return json.loads(raw)


def _validate_answers(questions: list[QuestionDef], answers: dict[str, str]) -> None:
    """Validate answers against question definitions.

    Checks required fields and validates multichoice answers contain only
    valid choices encoded as a JSON array string.
    """
    for q in questions:
        value = answers.get(q.key)
        if q.required and not value:
            raise HTTPException(400, f"Answer required for: {q.label}")
        if value and q.type == "multichoice" and q.choices:
            try:
                selected = json.loads(value)
            except (json.JSONDecodeError, TypeError):
                raise HTTPException(400, f"Invalid answer format for: {q.label}")
            if not isinstance(selected, list):
                raise HTTPException(400, f"Invalid answer format for: {q.label}")
            allowed = set(q.choices)
            for item in selected:
                if item not in allowed:
                    raise HTTPException(400, f"Invalid choice '{item}' for: {q.label}")
            if q.required and len(selected) == 0:
                raise HTTPException(400, f"Answer required for: {q.label}")


def _parse_tids(raw: str | None) -> list[str]:
    """Deserialise the JSON *converted_to_tids* column into a list of tournament IDs."""
    if not raw:
        return []
    try:
        result = json.loads(raw)
        return result if isinstance(result, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _get_assigned_player_ids(tids: list[str]) -> list[str]:
    """Return distinct player IDs already assigned to any of the given tournaments."""
    if not tids:
        return []
    placeholders = ",".join("?" * len(tids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT DISTINCT player_id FROM player_secrets WHERE tournament_id IN ({placeholders})",
            tids,
        ).fetchall()
    return [r["player_id"] for r in rows]


def _get_player_tournament_map(tids: list[str]) -> dict[str, list[str]]:
    """Return a mapping of player_id → list of tournament IDs they appear in (from *tids*)."""
    if not tids:
        return {}
    placeholders = ",".join("?" * len(tids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT player_id, tournament_id FROM player_secrets WHERE tournament_id IN ({placeholders})",
            tids,
        ).fetchall()
    result: dict[str, list[str]] = {}
    for row in rows:
        result.setdefault(row["player_id"], []).append(row["tournament_id"])
    return result


def _get_registrant_counts(registration_ids: list[str]) -> dict[str, int]:
    """Return registrant counts keyed by registration ID."""
    if not registration_ids:
        return {}
    placeholders = ",".join("?" for _ in registration_ids)
    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT registration_id, COUNT(*) AS c
                FROM registrants
                WHERE registration_id IN ({placeholders})
                GROUP BY registration_id""",
            registration_ids,
        ).fetchall()
    return {row["registration_id"]: row["c"] for row in rows}


def _get_registrants_by_registration_id(registration_ids: list[str]) -> dict[str, list[dict]]:
    """Return registrants grouped by registration ID."""
    if not registration_ids:
        return {}
    placeholders = ",".join("?" for _ in registration_ids)
    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT registration_id, player_id, player_name, answers, registered_at
                FROM registrants
                WHERE registration_id IN ({placeholders})
                ORDER BY registration_id, registered_at""",
            registration_ids,
        ).fetchall()
    grouped: dict[str, list[dict]] = {rid: [] for rid in registration_ids}
    for row in rows:
        grouped[row["registration_id"]].append(dict(row))
    return grouped


def _get_linked_tournaments_by_registration(
    tids_by_registration: dict[str, list[str]],
) -> dict[str, list[LinkedTournamentOut]]:
    """Return linked tournament metadata grouped by registration ID."""
    all_tids = []
    for tids in tids_by_registration.values():
        all_tids.extend(tids)
    unique_tids = list(dict.fromkeys(all_tids))

    rows_by_id: dict[str, dict[str, str | None]] = {}
    if unique_tids:
        placeholders = ",".join("?" for _ in unique_tids)
        with get_db() as conn:
            rows = conn.execute(
                f"SELECT id, name, type FROM tournaments WHERE id IN ({placeholders})",
                unique_tids,
            ).fetchall()
        rows_by_id = {
            row["id"]: {
                "name": row["name"],
                "type": row["type"],
            }
            for row in rows
        }

    def _is_finished(tid: str) -> bool:
        tournament_data = _tournaments.get(tid)
        if tournament_data is None:
            return True
        tournament = tournament_data.get("tournament")
        return str(getattr(tournament, "phase", "")) == "finished"

    return {
        rid: [
            LinkedTournamentOut(
                id=tid,
                name=rows_by_id[tid]["name"],
                type=rows_by_id[tid]["type"],
                finished=_is_finished(tid),
            )
            for tid in tids
            if tid in rows_by_id
        ]
        for rid, tids in tids_by_registration.items()
    }


def _get_linked_tournaments(tids: list[str]) -> list[LinkedTournamentOut]:
    """Return linked tournament metadata preserving the order of ``tids``."""
    if not tids:
        return []

    placeholders = ",".join("?" for _ in tids)
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT id, name, type FROM tournaments WHERE id IN ({placeholders})",
            tids,
        ).fetchall()

    rows_by_id = {
        row["id"]: {
            "name": row["name"],
            "type": row["type"],
        }
        for row in rows
    }

    def _is_finished(tid: str) -> bool:
        tournament_data = _tournaments.get(tid)
        if tournament_data is None:
            return True
        tournament = tournament_data.get("tournament")
        return str(getattr(tournament, "phase", "")) == "finished"

    return [
        LinkedTournamentOut(
            id=tid,
            name=rows_by_id[tid]["name"],
            type=rows_by_id[tid]["type"],
            finished=_is_finished(tid),
        )
        for tid in tids
        if tid in rows_by_id
    ]


# ────────────────────────────────────────────────────────────────────────────
# Admin endpoints (authenticated)
# ────────────────────────────────────────────────────────────────────────────


@router.post("")
async def create_registration(
    req: RegistrationCreate, request: Request, user: User = Depends(get_current_user)
) -> dict:
    """Create a new registration lobby."""
    client_ip = _client_ip(request)
    _create_rate_limiter.check(client_ip, "Too many registration creation attempts — try again later")
    _create_rate_limiter.record(client_ip)
    async with _reg_id_allocation_lock:
        rid = _next_registration_id()
    now = datetime.now(timezone.utc).isoformat()
    questions_json = json.dumps([q.model_dump() for q in req.questions]) if req.questions else None
    with get_db() as conn:
        conn.execute(
            """INSERT INTO registrations
               (id, name, owner, open, join_code, questions, description, message, listed, sport, auto_send_email, email_requirement, created_at)
               VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                rid,
                req.name,
                user.username,
                req.join_code,
                questions_json,
                req.description,
                req.message,
                1 if req.listed else 0,
                req.sport.value,
                1 if req.auto_send_email else 0,
                req.email_requirement,
                now,
            ),
        )
    return {"id": rid, "name": req.name}


@router.get("")
async def list_registrations(
    include_archived: bool = Query(default=False),
    user: User = Depends(get_current_user),
) -> list[dict]:
    """List registrations owned by or shared with the current user (admins see all)."""
    shared_ids: set[str] = set()
    with get_db() as conn:
        if user.role == UserRole.ADMIN:
            if include_archived:
                rows = conn.execute("SELECT * FROM registrations ORDER BY created_at DESC").fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM registrations WHERE archived = 0 ORDER BY created_at DESC"
                ).fetchall()
        else:
            shared_ids = set(get_shared_registration_ids(user.username))
            if shared_ids:
                placeholders = ",".join("?" * len(shared_ids))
                if include_archived:
                    rows = conn.execute(
                        f"SELECT * FROM registrations WHERE owner = ? OR id IN ({placeholders}) ORDER BY created_at DESC",
                        (user.username, *shared_ids),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        f"SELECT * FROM registrations WHERE (owner = ? OR id IN ({placeholders})) AND archived = 0 ORDER BY created_at DESC",
                        (user.username, *shared_ids),
                    ).fetchall()
            else:
                if include_archived:
                    rows = conn.execute(
                        "SELECT * FROM registrations WHERE owner = ? ORDER BY created_at DESC",
                        (user.username,),
                    ).fetchall()
                else:
                    rows = conn.execute(
                        "SELECT * FROM registrations WHERE owner = ? AND archived = 0 ORDER BY created_at DESC",
                        (user.username,),
                    ).fetchall()
    reg_ids = [row["id"] for row in rows]
    registrant_counts = _get_registrant_counts(reg_ids)

    result = []
    for row in rows:
        r = dict(row)
        r["registrant_count"] = registrant_counts.get(r["id"], 0)
        r["open"] = bool(r.get("open", 0))
        r["listed"] = bool(r.get("listed", 0))
        r["archived"] = bool(r.get("archived", 0))
        r["email_requirement"] = _email_requirement(r)
        r["converted_to_tids"] = _parse_tids(r.get("converted_to_tids"))
        r["shared"] = r["id"] in shared_ids
        result.append(r)
    return result


@router.get("/public", response_model=list[RegistrationPublicOut])
async def list_public_registrations() -> list[RegistrationPublicOut]:
    """Return all open, publicly listed registrations."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM registrations WHERE open = 1 AND listed = 1 AND archived = 0 ORDER BY created_at DESC",
        ).fetchall()
    registrations = [dict(row) for row in rows]
    reg_ids = [registration["id"] for registration in registrations]
    registrants_by_registration = _get_registrants_by_registration_id(reg_ids)
    tids_by_registration = {
        registration["id"]: _parse_tids(registration.get("converted_to_tids")) for registration in registrations
    }
    linked_by_registration = _get_linked_tournaments_by_registration(tids_by_registration)

    result: list[RegistrationPublicOut] = []
    for r in registrations:
        tids = tids_by_registration[r["id"]]
        linked_tournaments = linked_by_registration[r["id"]]
        registrants = registrants_by_registration.get(r["id"], [])
        result.append(
            RegistrationPublicOut(
                id=r["id"],
                name=r["name"],
                open=True,
                questions=_parse_questions(r.get("questions")),
                join_code_required=r.get("join_code") is not None,
                description=r.get("description"),
                message=r.get("message"),
                converted=len(tids) > 0,
                converted_to_tid=tids[0] if tids else None,
                converted_to_tids=tids,
                linked_tournaments=linked_tournaments,
                listed=True,
                archived=bool(r.get("archived", 0)),
                sport=r.get("sport", "padel"),
                email_requirement=_email_requirement(r),
                registrant_count=len(registrants),
                registrants=[],
            )
        )
    return result


@router.get("/{rid}")
async def get_registration(rid: str, user: User = Depends(get_current_user)) -> RegistrationAdminOut:
    """Get full details of a registration including all registrants."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]
    registrants = _get_registrants(reg_id)
    tids = _parse_tids(reg.get("converted_to_tids"))
    linked_tournaments = _get_linked_tournaments(tids)
    assigned_ids = _get_assigned_player_ids(tids)
    player_tournament_map = _get_player_tournament_map(tids)
    return RegistrationAdminOut(
        id=reg["id"],
        name=reg["name"],
        open=bool(reg["open"]),
        join_code=reg.get("join_code"),
        questions=_parse_questions(reg.get("questions")),
        listed=bool(reg.get("listed", 0)),
        archived=bool(reg.get("archived", 0)),
        sport=reg.get("sport", "padel"),
        description=reg.get("description"),
        message=reg.get("message"),
        alias=reg.get("alias"),
        auto_send_email=bool(reg.get("auto_send_email", 0)),
        email_requirement=_email_requirement(reg),
        converted_to_tid=tids[0] if tids else None,
        converted_to_tids=tids,
        linked_tournaments=linked_tournaments,
        assigned_player_ids=assigned_ids,
        player_tournament_map=player_tournament_map,
        created_at=reg["created_at"],
        registrants=[
            RegistrantAdminOut(
                player_id=r["player_id"],
                player_name=r["player_name"],
                passphrase=r["passphrase"],
                token=r["token"],
                answers=_parse_answers(r.get("answers")),
                email=r.get("email", ""),
                registered_at=r["registered_at"],
            )
            for r in registrants
        ],
    )


@router.patch("/{rid}")
async def update_registration(rid: str, req: RegistrationUpdate, user: User = Depends(get_current_user)) -> dict:
    """Update registration settings (partial)."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]

    updates: list[str] = []
    params: list = []
    if req.name is not None:
        updates.append("name = ?")
        params.append(req.name)
    if req.open is not None:
        updates.append("open = ?")
        params.append(1 if req.open else 0)
    if req.clear_join_code:
        updates.append("join_code = NULL")
    elif req.join_code is not None:
        updates.append("join_code = ?")
        params.append(req.join_code)
    if req.questions is not None:
        updates.append("questions = ?")
        params.append(json.dumps([q.model_dump() for q in req.questions]))
    if req.clear_description:
        updates.append("description = NULL")
    elif req.description is not None:
        updates.append("description = ?")
        params.append(req.description)
    if req.clear_message:
        updates.append("message = NULL")
    elif req.message is not None:
        updates.append("message = ?")
        params.append(req.message)
    if req.listed is not None:
        updates.append("listed = ?")
        params.append(1 if req.listed else 0)
    if req.archived is not None:
        updates.append("archived = ?")
        params.append(1 if req.archived else 0)
    if req.sport is not None:
        updates.append("sport = ?")
        params.append(req.sport.value)
    if req.auto_send_email is not None:
        updates.append("auto_send_email = ?")
        params.append(1 if req.auto_send_email else 0)
    if req.email_requirement is not None:
        updates.append("email_requirement = ?")
        params.append(req.email_requirement)

    if updates:
        params.append(reg_id)
        with get_db() as conn:
            conn.execute(f"UPDATE registrations SET {', '.join(updates)} WHERE id = ?", params)

    if req.clear_answers_for_keys:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT player_id, answers FROM registrants WHERE registration_id = ?",
                [reg_id],
            ).fetchall()
            for row in rows:
                answers = _parse_answers(row["answers"])
                changed = False
                for key in req.clear_answers_for_keys:
                    if key in answers:
                        del answers[key]
                        changed = True
                if changed:
                    conn.execute(
                        "UPDATE registrants SET answers = ? WHERE registration_id = ? AND player_id = ?",
                        [json.dumps(answers), reg_id, row["player_id"]],
                    )

    return {"ok": True}


@router.delete("/{rid}")
async def delete_registration(rid: str, user: User = Depends(get_current_user)) -> dict:
    """Delete a registration and all its registrants."""
    reg = _get_registration(rid)
    _require_registration_owner(reg, user)
    reg_id = reg["id"]
    entity_name = reg.get("name", "")
    finished_at = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        # Snapshot any profile-linked registrants into player_history before wiping them.
        linked = conn.execute(
            "SELECT profile_id, player_id, player_name FROM registrants"
            " WHERE registration_id = ? AND profile_id IS NOT NULL",
            (reg_id,),
        ).fetchall()
        if linked:
            conn.executemany(
                """INSERT OR IGNORE INTO player_history
                   (profile_id, entity_type, entity_id, entity_name,
                    player_id, player_name, finished_at, sport)
                   VALUES (?, 'registration', ?, ?, ?, ?, ?, ?)""",
                [
                    (
                        row["profile_id"],
                        reg_id,
                        entity_name,
                        row["player_id"],
                        row["player_name"],
                        finished_at,
                        reg.get("sport", "padel"),
                    )
                    for row in linked
                ],
            )
        conn.execute("DELETE FROM registration_shares WHERE registration_id = ?", (reg_id,))
        conn.execute("DELETE FROM registrants WHERE registration_id = ?", (reg_id,))
        conn.execute("DELETE FROM registrations WHERE id = ?", (reg_id,))
    _registration_locks.pop(reg_id, None)
    from .db import invalidate_reg_co_editor_cache  # noqa: PLC0415

    invalidate_reg_co_editor_cache(reg_id)
    return {"ok": True}


@router.post("/{rid}/registrant")
async def admin_add_registrant(rid: str, req: RegistrantIn, user: User = Depends(get_current_user)) -> dict:
    """Admin: add a player directly to a registration lobby.

    Bypasses the open-lobby, join-code and rate-limit checks that apply to
    the public self-registration endpoint.  Useful for manually enrolling
    late entries or players who cannot use the public form.
    """
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]

    player_id = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()

    existing_passphrases: set[str] = set()
    existing_names: set[str] = set()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT player_name, passphrase FROM registrants WHERE registration_id = ?",
            (reg_id,),
        ).fetchall()
        for r in rows:
            existing_passphrases.add(r["passphrase"])
            existing_names.add(r["player_name"].strip().lower())

    if req.player_name.strip().lower() in existing_names:
        raise HTTPException(409, "A player with this name is already registered")

    passphrase = generate_passphrase()
    while passphrase in existing_passphrases:
        passphrase = generate_passphrase()

    token = generate_token()

    answers_json = json.dumps(req.answers) if req.answers else None
    email = req.email.strip()
    with get_db() as conn:
        conn.execute(
            """INSERT INTO registrants
               (registration_id, player_id, player_name, passphrase, token, answers, email, registered_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (reg_id, player_id, req.player_name, passphrase, token, answers_json, email, now),
        )

    # Auto-send confirmation email if the lobby has auto_send_email enabled
    if email and is_valid_email(email) and reg.get("auto_send_email"):
        es = _get_reg_email_settings(reg)
        subject, body = render_registration_confirmation(
            lobby_name=reg["name"],
            player_name=req.player_name,
            passphrase=passphrase,
            token=token,
            lobby_alias=reg.get("alias"),
            lobby_id=reg_id,
            reply_to=es.reply_to,
        )
        send_email_background(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)

    return {
        "player_id": player_id,
        "player_name": req.player_name,
        "passphrase": passphrase,
        "token": token,
    }


@router.patch("/{rid}/registrant/{player_id}")
async def patch_registrant(
    rid: str, player_id: str, req: RegistrantPatch, user: User = Depends(get_current_user)
) -> dict:
    """Override a registrant's name or level (admin)."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]

    updates: list[str] = []
    params: list = []
    if req.player_name is not None:
        updates.append("player_name = ?")
        params.append(req.player_name)
    if req.answers is not None:
        updates.append("answers = ?")
        params.append(json.dumps(req.answers))
    if req.email is not None:
        updates.append("email = ?")
        params.append(req.email.strip())

    if updates:
        params.extend([reg_id, player_id])
        with get_db() as conn:
            cur = conn.execute(
                f"UPDATE registrants SET {', '.join(updates)} WHERE registration_id = ? AND player_id = ?",
                params,
            )
            if cur.rowcount == 0:
                raise HTTPException(404, "Registrant not found")

    return {"ok": True}


@router.delete("/{rid}/registrant/{player_id}")
async def delete_registrant(rid: str, player_id: str, user: User = Depends(get_current_user)) -> dict:
    """Remove a registrant from a registration."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM registrants WHERE registration_id = ? AND player_id = ?",
            (reg_id, player_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Registrant not found")
    return {"ok": True}


@router.get("/{rid}/secrets")
async def get_registration_secrets(rid: str, user: User = Depends(get_current_user)) -> list[dict]:
    """Return all passphrase/token pairs for printing."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]
    registrants = _get_registrants(reg_id)
    return [
        {
            "player_id": r["player_id"],
            "player_name": r["player_name"],
            "passphrase": r["passphrase"],
            "token": r["token"],
        }
        for r in registrants
    ]


# ────────────────────────────────────────────────────────────────────────────
# Public endpoints (no authentication)
# ────────────────────────────────────────────────────────────────────────────


@router.get("/{rid}/public", response_model=RegistrationPublicOut)
async def get_registration_public(rid: str) -> RegistrationPublicOut:
    """Return public information about a registration (no secrets)."""
    reg = _get_registration(rid)
    reg_id = reg["id"]
    registrants = _get_registrants(reg_id)
    tids = _parse_tids(reg.get("converted_to_tids"))
    linked_tournaments = _get_linked_tournaments(tids)
    return RegistrationPublicOut(
        id=reg["id"],
        name=reg["name"],
        open=bool(reg["open"]),
        questions=_parse_questions(reg.get("questions")),
        join_code_required=reg.get("join_code") is not None,
        description=reg.get("description"),
        message=reg.get("message"),
        converted=len(tids) > 0,
        converted_to_tid=tids[0] if tids else None,
        converted_to_tids=tids,
        linked_tournaments=linked_tournaments,
        listed=bool(reg.get("listed", 0)),
        archived=bool(reg.get("archived", 0)),
        sport=reg.get("sport", "padel"),
        email_requirement=_email_requirement(reg),
        registrant_count=len(registrants),
        registrants=[],
    )


@router.post("/{rid}/register")
async def register_player(rid: str, req: RegistrantIn, request: Request) -> dict:
    """Self-register a player in an open registration lobby.

    Returns the newly created passphrase and token so the player can
    see them immediately (and scan the QR code).
    """
    client_ip = _client_ip(request)
    _public_register_rate_limiter.check(client_ip, "Too many registration attempts — try again later")
    _public_register_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    reg_id = reg["id"]

    if not reg["open"]:
        raise HTTPException(400, "Registration is closed")

    # Check join code if required
    if reg.get("join_code"):
        if not req.join_code or req.join_code != reg["join_code"]:
            raise HTTPException(403, "Invalid join code")

    # Validate required questions
    questions = _parse_questions(reg.get("questions"))
    _validate_answers(questions, req.answers)

    player_id = uuid.uuid4().hex[:8]
    now = datetime.now(timezone.utc).isoformat()

    # Fetch existing registrants for uniqueness checks
    existing_passphrases: set[str] = set()
    existing_names: set[str] = set()
    with get_db() as conn:
        rows = conn.execute(
            "SELECT player_name, passphrase FROM registrants WHERE registration_id = ?",
            (reg_id,),
        ).fetchall()
        for r in rows:
            existing_passphrases.add(r["passphrase"])
            existing_names.add(r["player_name"].strip().lower())

    if req.player_name.strip().lower() in existing_names:
        raise HTTPException(409, "A player with this name is already registered")

    passphrase = generate_passphrase()
    while passphrase in existing_passphrases:
        passphrase = generate_passphrase()

    token = generate_token()

    # Resolve optional Player Hub profile link
    profile_id: str | None = None
    if req.profile_passphrase:
        profile = lookup_profile_by_passphrase(req.profile_passphrase.strip())
        if profile is not None:
            # Use the profile's global passphrase as the registrant's passphrase
            # so the player only needs to remember one phrase across all events.
            profile_passphrase_value = req.profile_passphrase.strip()
            if profile_passphrase_value not in existing_passphrases:
                passphrase = profile_passphrase_value
            profile_id = profile["id"]

    # Auto-link by email: if the player provides an email that matches a Player Hub
    # profile and they haven't explicitly linked via passphrase, link them silently.
    if profile_id is None:
        potential_email = req.email.strip()
        if potential_email and is_valid_email(potential_email):
            with get_db() as conn:
                profile_row = conn.execute(
                    "SELECT id, passphrase FROM player_profiles WHERE LOWER(email) = LOWER(?)",
                    (potential_email,),
                ).fetchone()
            if profile_row is not None:
                pp_val = profile_row["passphrase"]
                if pp_val not in existing_passphrases:
                    passphrase = pp_val
                profile_id = profile_row["id"]

    answers_json = json.dumps(req.answers) if req.answers else None
    email = req.email.strip()
    email_mode = _email_requirement(reg)
    if email_mode == "required":
        if not email or not is_valid_email(email):
            raise HTTPException(400, "A valid email address is required for this registration")
    elif email_mode == "disabled":
        if email:
            raise HTTPException(400, "Email is disabled for this registration")
        email = ""
    elif email and not is_valid_email(email):
        raise HTTPException(400, "Invalid email address")

    with get_db() as conn:
        conn.execute(
            """INSERT INTO registrants
               (registration_id, player_id, player_name, passphrase, token, answers, email, registered_at, profile_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (reg_id, player_id, req.player_name, passphrase, token, answers_json, email, now, profile_id),
        )

    # Auto-send confirmation email if the lobby has auto_send_email enabled
    if email and is_valid_email(email) and reg.get("auto_send_email"):
        es = _get_reg_email_settings(reg)
        subject, body = render_registration_confirmation(
            lobby_name=reg["name"],
            player_name=req.player_name,
            passphrase=passphrase,
            token=token,
            lobby_alias=reg.get("alias"),
            lobby_id=reg_id,
            reply_to=es.reply_to,
        )
        send_email_background(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)

    return {
        "player_id": player_id,
        "player_name": req.player_name,
        "passphrase": passphrase,
        "token": token,
    }


# ────────────────────────────────────────────────────────────────────────────
# Conversion endpoint
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{rid}/convert")
async def convert_registration(
    rid: str, req: ConvertRegistrationRequest, user: User = Depends(get_current_user)
) -> dict:
    """Convert a registration lobby into a tournament (may be called multiple times).

    Each call creates one tournament from a subset of registrants.  The same
    registrant cannot be assigned to more than one tournament from the same lobby.
    Player IDs, passphrases, and tokens are preserved so the same QR codes and
    passphrases continue to work after conversion.

    The registration is automatically closed once every registrant has been
    assigned to at least one tournament.
    """
    registration = _get_registration(rid)
    _require_registration_editor(registration, user)
    if registration.get("archived"):
        raise HTTPException(400, "Cannot convert an archived registration")
    reg_id = registration["id"]

    async with _get_registration_lock(reg_id):
        registration = _get_registration(reg_id)
        if registration.get("archived"):
            raise HTTPException(400, "Cannot convert an archived registration")
        registrants = _get_registrants(reg_id)

        # Determine the existing set of already-assigned player IDs across all
        # tournaments previously created from this lobby.
        existing_tids = _parse_tids(registration.get("converted_to_tids"))
        already_assigned: set[str] = set(_get_assigned_player_ids(existing_tids))

        # Build the final player list from req.player_names if provided,
        # otherwise use all registrants.  Names matching existing registrants
        # reuse their IDs / passphrases / tokens; new names get fresh ones.
        registrant_by_name: dict[str, dict] = {r["player_name"]: dict(r) for r in registrants}
        names = (
            [n.strip() for n in req.player_names if n.strip()] if req.player_names else list(registrant_by_name.keys())
        )

        if len(names) < 2:
            raise HTTPException(400, "Need at least 2 players to create a tournament")

        selected_names = set(names)
        if req.team_mode and req.teams:
            team_members = [member for team in req.teams for member in team]
            unknown_members = sorted({member for member in team_members if member not in selected_names})
            if unknown_members:
                raise HTTPException(
                    400,
                    f"These team members are not in player_names: {', '.join(unknown_members)}",
                )
            assigned_names = set(team_members)
            missing_names = sorted(selected_names - assigned_names)
            if missing_names:
                raise HTTPException(
                    400,
                    f"These selected players are missing from teams: {', '.join(missing_names)}",
                )

        # Collect names of players already assigned to a previous tournament from this lobby.
        # We no longer block this — multi-tournament use case allows the same player in multiple
        # tournaments.  The overlapping names are returned in the response so the caller can warn.
        overlap_names = [
            name
            for name in names
            if name in registrant_by_name and registrant_by_name[name]["player_id"] in already_assigned
        ]

        # Collect existing passphrases so we don't collide when generating new ones
        existing_passphrases: set[str] = {r["passphrase"] for r in registrants}

        player_entries: list[tuple[str, str]] = []  # (name, player_id)
        secret_rows: list[tuple] = []  # rows for player_secrets INSERT
        contact_map: dict[str, str] = {}  # player_id → contact string
        email_map: dict[str, str] = {}  # player_id → email address

        for name in names:
            reg = registrant_by_name.get(name)
            if reg:
                pid = reg["player_id"]
                player_entries.append((name, pid))
                # When a player is already in another tournament from this lobby their token
                # is already taken (UNIQUE constraint on player_secrets.token).  Generate a
                # fresh token so this tournament entry gets its own distinct QR-code link.
                if pid in already_assigned:
                    token = generate_token()
                else:
                    token = reg["token"]
                secret_rows.append((reg.get("profile_id"), pid, name, reg["passphrase"], token))
                answers = _parse_answers(reg.get("answers"))
                if answers.get("contact"):
                    contact_map[pid] = answers["contact"]
                if reg.get("email"):
                    email_map[pid] = reg["email"]
            else:
                # New player added during conversion
                pid = uuid.uuid4().hex[:8]
                passphrase = generate_passphrase()
                while passphrase in existing_passphrases:
                    passphrase = generate_passphrase()
                existing_passphrases.add(passphrase)
                token = generate_token()
                player_entries.append((name, pid))
                secret_rows.append((None, pid, name, passphrase, token))

        tournament_name = req.name or registration["name"]

        # Build initial_strength mapping (player name → score → player_id → score)
        initial_strength: dict[str, float] | None = None
        if req.player_strengths:
            initial_strength = {}
            for name, pid in player_entries:
                if name in req.player_strengths:
                    initial_strength[pid] = req.player_strengths[name]

        tid = await allocate_tournament_id()

        if req.tournament_type == "group_playoff":
            courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []
            team_roster: dict[str, list[str]] = {}
            team_member_names: dict[str, list[str]] = {}

            if req.teams and req.team_mode:
                # Composite teams: create synthetic team Player for each group
                entry_map = {name: pid for name, pid in player_entries}
                team_players: list[Player] = []
                for idx, member_names in enumerate(req.teams):
                    team_label = (
                        req.team_names[idx]
                        if idx < len(req.team_names) and req.team_names[idx].strip()
                        else " & ".join(member_names)
                    )
                    team_pid = uuid.uuid4().hex[:8]
                    team_player = Player(name=team_label, id=team_pid)
                    team_players.append(team_player)
                    member_ids = [entry_map[n] for n in member_names if n in entry_map]
                    team_roster[team_pid] = member_ids
                    team_member_names[team_pid] = list(member_names)
                    # Aggregate strength for the synthetic team
                    if initial_strength:
                        team_str = sum(initial_strength.get(mid, 0.0) for mid in member_ids)
                        initial_strength[team_pid] = team_str
                players = team_players
            else:
                players = [Player(name=name, id=pid) for name, pid in player_entries]

            t = GroupPlayoffTournament(
                players=players,
                num_groups=req.num_groups,
                courts=courts,
                top_per_group=req.top_per_group,
                double_elimination=req.double_elimination,
                team_mode=req.team_mode,
                group_names=req.group_names,
                initial_strength=initial_strength,
                team_roster=team_roster,
                team_member_names=team_member_names,
                group_assignments=req.group_assignments,
            )
            try:
                t.generate()
            except ValueError as e:
                raise HTTPException(400, str(e))
            _store_tournament(
                tid,
                name=tournament_name,
                tournament_type=TournamentType.GROUP_PLAYOFF.value,
                tournament=t,
                owner=user.username,
                public=req.public,
                sport=req.sport.value,
                assign_courts=req.assign_courts,
            )

        elif req.tournament_type == "mexicano":
            courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []

            if req.teams and req.team_mode:
                # Form fixed composite team Players — each team is one Player entity
                # (Mexicano team mode: pre-formed pairs who always play together)
                entry_map = {name: pid for name, pid in player_entries}
                sec_by_pid = {r[1]: r for r in secret_rows}
                team_players: list[Player] = []
                team_secret_rows: list[tuple] = []
                for idx, member_names in enumerate(req.teams):
                    team_label = (
                        req.team_names[idx]
                        if idx < len(req.team_names) and req.team_names[idx].strip()
                        else " & ".join(m for m in member_names if m)
                    )
                    team_pid = uuid.uuid4().hex[:8]
                    team_players.append(Player(name=team_label, id=team_pid))
                    # Aggregate individual strengths into team-level strength
                    if initial_strength:
                        member_ids = [entry_map[n] for n in member_names if n in entry_map]
                        initial_strength[team_pid] = sum(initial_strength.get(mid, 0.0) for mid in member_ids)
                    # Reuse first known member's passphrase/token for the team secret
                    first_sec = next(
                        (
                            sec_by_pid[entry_map[m]]
                            for m in member_names
                            if m in entry_map and entry_map[m] in sec_by_pid
                        ),
                        None,
                    )
                    if first_sec:
                        team_secret_rows.append((None, team_pid, team_label, first_sec[3], first_sec[4]))
                    else:
                        team_secret_rows.append((None, team_pid, team_label, generate_passphrase(), generate_token()))
                players = team_players
                secret_rows = team_secret_rows
            else:
                players = [Player(name=name, id=pid) for name, pid in player_entries]

            try:
                t = MexicanoTournament(
                    players=players,
                    courts=courts,
                    total_points_per_match=req.total_points_per_match,
                    num_rounds=req.num_rounds,
                    skill_gap=req.skill_gap,
                    win_bonus=req.win_bonus,
                    strength_weight=req.strength_weight,
                    loss_discount=req.loss_discount,
                    balance_tolerance=req.balance_tolerance,
                    team_mode=req.team_mode,
                    initial_strength=initial_strength,
                    teammate_repeat_weight=req.teammate_repeat_weight,
                    opponent_repeat_weight=req.opponent_repeat_weight,
                    repeat_decay=req.repeat_decay,
                    partner_balance_weight=req.partner_balance_weight,
                )
            except ValueError as e:
                raise HTTPException(400, str(e))
            _store_tournament(
                tid,
                name=tournament_name,
                tournament_type=TournamentType.MEXICANO.value,
                tournament=t,
                owner=user.username,
                public=req.public,
                sport=req.sport.value,
                assign_courts=req.assign_courts,
            )

        elif req.tournament_type == "playoff":
            courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []

            if req.teams and req.team_mode:
                # Composite teams for playoff
                entry_map = {name: pid for name, pid in player_entries}
                teams: list[list[Player]] = []
                for idx, member_names in enumerate(req.teams):
                    team_members = [Player(name=n, id=entry_map[n]) for n in member_names if n in entry_map]
                    teams.append(team_members)
            else:
                teams = [[Player(name=name, id=pid)] for name, pid in player_entries]

            t = PlayoffTournament(
                teams=teams,
                courts=courts,
                double_elimination=req.double_elimination,
                team_mode=req.team_mode,
                initial_strength=initial_strength,
            )
            _store_tournament(
                tid,
                name=tournament_name,
                tournament_type=TournamentType.PLAYOFF.value,
                tournament=t,
                owner=user.username,
                public=req.public,
                sport=req.sport.value,
                assign_courts=req.assign_courts,
            )

        else:
            raise HTTPException(400, f"Unknown tournament type: {req.tournament_type}")

        # Populate player_secrets (reuse registrant passphrases/tokens where available)
        with get_db() as conn:
            conn.executemany(
                """INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, contact, email, profile_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(tournament_id, player_id) DO UPDATE SET
                       passphrase  = excluded.passphrase,
                       token       = excluded.token,
                       player_name = excluded.player_name,
                       contact     = excluded.contact,
                       email       = excluded.email,
                       profile_id  = excluded.profile_id""",
                [
                    (tid, pid, name, pp, tok, contact_map.get(pid, ""), email_map.get(pid, ""), profile_id_val)
                    for (profile_id_val, pid, name, pp, tok) in secret_rows
                ],
            )

        # Grant all current registration co-editors access to the new tournament so
        # they can continue managing it without the owner having to re-share manually.
        for co_editor in get_registration_co_editors(reg_id):
            add_co_editor(tid, co_editor)

        # Append the new tid to converted_to_tids and keep the legacy single-tid column
        # for backward compatibility.  Auto-close the registration once every registrant
        # has been assigned to at least one tournament.
        with get_db() as conn:
            new_tids = existing_tids + [tid]
            new_tids_json = json.dumps(new_tids)
            first_tid = new_tids[0]

            all_registrant_ids = {r["player_id"] for r in registrants}
            # Use original registrant IDs (from player_entries) not team synthetic IDs,
            # so the check works correctly in both individual and team mode conversions.
            newly_assigned_registrant_ids = {pid for name, pid in player_entries if name in registrant_by_name}
            all_now_assigned = all_registrant_ids.issubset(already_assigned | newly_assigned_registrant_ids)

            if all_now_assigned:
                conn.execute(
                    "UPDATE registrations SET converted_to_tids = ?, converted_to_tid = ?, open = 0 WHERE id = ?",
                    (new_tids_json, first_tid, reg_id),
                )
            else:
                conn.execute(
                    "UPDATE registrations SET converted_to_tids = ?, converted_to_tid = ? WHERE id = ?",
                    (new_tids_json, first_tid, reg_id),
                )

    if all_now_assigned:
        return {
            "tournament_id": tid,
            "tournament_name": tournament_name,
            "all_assigned": True,
            "overlapping_players": overlap_names,
        }

    return {
        "tournament_id": tid,
        "tournament_name": tournament_name,
        "all_assigned": False,
        "overlapping_players": overlap_names,
    }


# ────────────────────────────────────────────────────────────────────────────
# Alias endpoints
# ────────────────────────────────────────────────────────────────────────────


@router.put("/{rid}/alias")
async def set_registration_alias(rid: str, req: SetAliasRequest, user: User = Depends(get_current_user)) -> dict:
    """Set a human-friendly alias for a registration (used in registration URLs)."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    # Check uniqueness among registrations
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM registrations WHERE alias = ? AND id != ?",
            (req.alias, reg["id"]),
        ).fetchone()
    if existing:
        raise HTTPException(409, f"Alias '{req.alias}' is already in use")
    with get_db() as conn:
        conn.execute("UPDATE registrations SET alias = ? WHERE id = ?", (req.alias, reg["id"]))
    return {"ok": True, "alias": req.alias}


@router.post("/{rid}/player-login", response_model=RegistrantLoginOut)
async def player_login(rid: str, req: RegistrantLoginIn, request: Request) -> RegistrantLoginOut:
    """Allow a returning player to retrieve their registration data by passphrase or token.

    No admin auth required — the passphrase/token proves identity.
    Returns 401 if neither is found in this lobby.
    """
    if req.passphrase and req.token:
        raise HTTPException(400, "Provide either passphrase or token, not both")
    if not req.passphrase and not req.token:
        raise HTTPException(400, "Provide passphrase or token")

    client_ip = _client_ip(request)
    _public_passphrase_rate_limiter.check(client_ip, "Too many login attempts — try again later")
    _public_passphrase_rate_limiter.record(client_ip)

    reg = _get_registration(rid)  # 404 if lobby doesn't exist
    result: dict | None = None
    if req.passphrase:
        result = lookup_registrant_by_passphrase(reg["id"], req.passphrase)
    else:
        result = lookup_registrant_by_token(reg["id"], req.token)  # type: ignore[arg-type]
    if result is None:
        raise HTTPException(401, "Passphrase or token not found")
    return RegistrantLoginOut(**result)


@router.patch("/{rid}/player-answers", response_model=RegistrantLoginOut)
async def player_update_answers(rid: str, req: RegistrantAnswersUpdateIn, request: Request) -> RegistrantLoginOut:
    """Allow a returning player to update their own answers by passphrase."""
    client_ip = _client_ip(request)
    _public_passphrase_rate_limiter.check(client_ip, "Too many update attempts — try again later")
    _public_passphrase_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    reg_id = reg["id"]

    if not reg["open"]:
        raise HTTPException(400, "Registration is closed")

    # Block updates for players already assigned to a tournament
    tids = _parse_tids(reg.get("converted_to_tids"))
    if tids:
        assigned_ids = _get_assigned_player_ids(tids)
        with get_db() as conn:
            row = conn.execute(
                "SELECT player_id FROM registrants WHERE registration_id = ? AND passphrase = ?",
                (reg_id, req.passphrase),
            ).fetchone()
        if row and row["player_id"] in assigned_ids:
            raise HTTPException(400, "You have already been assigned to a tournament")

    questions = _parse_questions(reg.get("questions"))
    _validate_answers(questions, req.answers)

    answers_json = json.dumps(req.answers) if req.answers else None
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE registrants SET answers = ? WHERE registration_id = ? AND passphrase = ?",
            (answers_json, reg_id, req.passphrase),
        )
        if cur.rowcount == 0:
            raise HTTPException(401, "Passphrase not found")

    result = lookup_registrant_by_passphrase(reg_id, req.passphrase)
    if result is None:
        raise HTTPException(401, "Passphrase not found")
    return RegistrantLoginOut(**result)


@router.post("/{rid}/player-cancel")
async def player_cancel_registration(rid: str, req: RegistrantLoginIn, request: Request) -> dict:
    """Allow a returning player to cancel their own registration by passphrase."""
    client_ip = _client_ip(request)
    _public_passphrase_rate_limiter.check(client_ip, "Too many cancellation attempts — try again later")
    _public_passphrase_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    reg_id = reg["id"]

    if not reg["open"]:
        raise HTTPException(400, "Registration is closed")

    # Block cancellation for players already assigned to a tournament
    tids = _parse_tids(reg.get("converted_to_tids"))
    if tids:
        assigned_ids = _get_assigned_player_ids(tids)
        with get_db() as conn:
            row = conn.execute(
                "SELECT player_id FROM registrants WHERE registration_id = ? AND passphrase = ?",
                (reg_id, req.passphrase),
            ).fetchone()
        if row and row["player_id"] in assigned_ids:
            raise HTTPException(400, "You have already been assigned to a tournament and cannot cancel")

    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM registrants WHERE registration_id = ? AND passphrase = ?",
            (reg_id, req.passphrase),
        )
        if cur.rowcount == 0:
            raise HTTPException(401, "Passphrase not found")
    return {"ok": True}


@router.delete("/{rid}/alias")
async def delete_registration_alias(rid: str, user: User = Depends(get_current_user)) -> dict:
    """Remove the alias from a registration."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    with get_db() as conn:
        conn.execute("UPDATE registrations SET alias = NULL WHERE id = ?", (reg["id"],))
    return {"ok": True}


# ────────────────────────────────────────────────────────────────────────────
# Per-registration email settings
# ────────────────────────────────────────────────────────────────────────────


def _get_reg_email_settings(reg: dict) -> EmailSettings:
    """Return the email settings for a registration lobby, falling back to defaults."""
    raw = reg.get("email_settings")
    if raw:
        try:
            return EmailSettings(**json.loads(raw))
        except (json.JSONDecodeError, ValueError, TypeError):
            pass
    return EmailSettings()


@router.get("/{rid}/email-settings")
async def get_reg_email_settings(rid: str, user: User = Depends(get_current_user)) -> dict:
    """Return the current per-registration email customisation settings."""
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    return _get_reg_email_settings(reg).model_dump()


@router.patch("/{rid}/email-settings")
async def update_reg_email_settings(
    rid: str, req: EmailSettingsRequest, user: User = Depends(get_current_user)
) -> dict:
    """Partially update per-registration email customisation settings.

    Only supplied (non-null) fields are changed.
    """
    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    current = _get_reg_email_settings(reg)
    patch = req.model_dump(exclude_none=True)
    updated = current.model_copy(update=patch)
    with get_db() as conn:
        conn.execute(
            "UPDATE registrations SET email_settings = ? WHERE id = ?",
            (json.dumps(updated.model_dump()), reg["id"]),
        )
    return updated.model_dump()


# ────────────────────────────────────────────────────────────────────────────
# Email endpoints
# ────────────────────────────────────────────────────────────────────────────


@router.post("/{rid}/send-email/{player_id}")
async def send_registrant_email(
    rid: str, player_id: str, request: Request, user: User = Depends(get_current_user)
) -> dict:
    """Send login credentials email to a single registrant."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = _client_ip(request)
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM registrants WHERE registration_id = ? AND player_id = ?",
            (reg_id, player_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Registrant not found")

    email = row["email"] if row["email"] else ""
    if not email or not is_valid_email(email):
        raise HTTPException(422, "No valid email address on file for this player")

    es = _get_reg_email_settings(reg)
    subject, body = render_credentials_email(
        lobby_name=reg["name"],
        player_name=row["player_name"],
        passphrase=row["passphrase"],
        token=row["token"],
        lobby_alias=reg.get("alias"),
        lobby_id=reg_id,
        reply_to=es.reply_to,
    )
    ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
    if not ok:
        raise HTTPException(502, "Failed to send email — check server SMTP configuration")
    return {"sent": True}


@router.post("/{rid}/send-all-emails")
async def send_all_registrant_emails(rid: str, request: Request, user: User = Depends(get_current_user)) -> dict:
    """Send login credentials emails to all registrants that have a valid email address."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = _client_ip(request)
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]

    registrants = _get_registrants(reg_id)
    es = _get_reg_email_settings(reg)
    sent = 0
    skipped = 0
    failed = 0
    for r in registrants:
        email = r.get("email", "")
        if not email or not is_valid_email(email):
            skipped += 1
            continue
        subject, body = render_credentials_email(
            lobby_name=reg["name"],
            player_name=r["player_name"],
            passphrase=r["passphrase"],
            token=r["token"],
            lobby_alias=reg.get("alias"),
            lobby_id=reg_id,
            reply_to=es.reply_to,
        )
        ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}


@router.post("/{rid}/send-message-emails")
async def send_registration_message_emails(rid: str, request: Request, user: User = Depends(get_current_user)) -> dict:
    """Send organizer message email to all registrants with a valid email address."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = _client_ip(request)
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]

    message = (reg.get("message") or "").strip()
    if not message:
        raise HTTPException(400, "No organizer message set for this registration")

    registrants = _get_registrants(reg_id)
    es = _get_reg_email_settings(reg)
    sent = 0
    skipped = 0
    failed = 0
    for r in registrants:
        email = r.get("email", "")
        if not email or not is_valid_email(email):
            skipped += 1
            continue
        subject, body = render_organizer_message_email(
            lobby_name=reg["name"],
            player_name=r["player_name"],
            message=message,
            token=r["token"],
            lobby_alias=reg.get("alias"),
            lobby_id=reg_id,
            reply_to=es.reply_to,
        )
        ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}


@router.post("/{rid}/send-cancellation-email/{player_id}")
async def send_cancellation_email(
    rid: str, player_id: str, request: Request, user: User = Depends(get_current_user)
) -> dict:
    """Send a registration cancellation confirmation email to a specific player."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = _client_ip(request)
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM registrants WHERE registration_id = ? AND player_id = ?",
            (reg_id, player_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Registrant not found")

    email = row["email"] if row["email"] else ""
    if not email or not is_valid_email(email):
        raise HTTPException(422, "No valid email address on file for this player")

    es = _get_reg_email_settings(reg)
    subject, body = render_cancellation_email(
        lobby_name=reg["name"],
        player_name=row["player_name"],
        lobby_alias=reg.get("alias"),
        lobby_id=reg_id,
        reply_to=es.reply_to,
    )
    ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
    if not ok:
        raise HTTPException(502, "Failed to send email — check server SMTP configuration")
    return {"sent": True}


@router.post("/{rid}/send-waitlist-email/{player_id}")
async def send_waitlist_email(
    rid: str, player_id: str, request: Request, user: User = Depends(get_current_user)
) -> dict:
    """Send a waitlist spot-available notification email to a specific player."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = _client_ip(request)
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    reg = _get_registration(rid)
    _require_registration_editor(reg, user)
    reg_id = reg["id"]

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM registrants WHERE registration_id = ? AND player_id = ?",
            (reg_id, player_id),
        ).fetchone()
    if row is None:
        raise HTTPException(404, "Registrant not found")

    email = row["email"] if row["email"] else ""
    if not email or not is_valid_email(email):
        raise HTTPException(422, "No valid email address on file for this player")

    es = _get_reg_email_settings(reg)
    subject, body = render_waitlist_spot_email(
        lobby_name=reg["name"],
        player_name=row["player_name"],
        token=row["token"],
        lobby_alias=reg.get("alias"),
        lobby_id=reg_id,
        reply_to=es.reply_to,
    )
    ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
    if not ok:
        raise HTTPException(502, "Failed to send email — check server SMTP configuration")
    return {"sent": True}
