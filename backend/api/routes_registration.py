"""
Registration lobby routes.

Allows admins to create shareable registration links where players can
self-register before a tournament is created. Once registrations are
collected, the admin converts the lobby into a real tournament — player
IDs, passphrases, and tokens carry over so the same code works for
scoring.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from .rate_limit import BoundedRateLimiter
from ..auth.deps import get_current_user
from ..auth.models import User, UserRole
from ..models import Court, Player, TournamentType
from ..tournaments import GroupPlayoffTournament, MexicanoTournament, PlayoffTournament
from ..tournaments.player_secrets import generate_passphrase, generate_token
from .db import get_db
from .helpers import _store_tournament
from .player_secret_store import lookup_registrant_by_passphrase
from .schemas import (
    ConvertRegistrationRequest,
    QuestionDef,
    RegistrantAdminOut,
    RegistrantAnswersUpdateIn,
    RegistrantIn,
    RegistrantLoginIn,
    RegistrantLoginOut,
    RegistrantOut,
    RegistrantPatch,
    RegistrationAdminOut,
    RegistrationCreate,
    RegistrationPublicOut,
    RegistrationUpdate,
    SetAliasRequest,
)
from .state import _next_id, _global_lock

router = APIRouter(prefix="/api/registrations", tags=["registrations"])

_CREATE_MAX_ATTEMPTS = 20
_CREATE_WINDOW_SECONDS = 60
_CREATE_MAX_TRACKED_IPS = 4096

_create_rate_limiter = BoundedRateLimiter(
    max_attempts=_CREATE_MAX_ATTEMPTS,
    window_seconds=_CREATE_WINDOW_SECONDS,
    max_tracked_ips=_CREATE_MAX_TRACKED_IPS,
)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


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
    """Raise 403 if *user* neither owns the registration nor is an admin."""
    if user.role == UserRole.ADMIN:
        return
    if reg.get("owner") != user.username:
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
    rid = _next_registration_id()
    now = datetime.now(timezone.utc).isoformat()
    questions_json = json.dumps([q.model_dump() for q in req.questions]) if req.questions else None
    with get_db() as conn:
        conn.execute(
            """INSERT INTO registrations
               (id, name, owner, open, join_code, questions, description, message, listed, sport, created_at)
               VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)""",
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
                now,
            ),
        )
    return {"id": rid, "name": req.name}


@router.get("")
async def list_registrations(user: User = Depends(get_current_user)) -> list[dict]:
    """List registrations owned by the current user (admins see all)."""
    with get_db() as conn:
        if user.role == UserRole.ADMIN:
            rows = conn.execute("SELECT * FROM registrations ORDER BY created_at DESC").fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM registrations WHERE owner = ? ORDER BY created_at DESC",
                (user.username,),
            ).fetchall()
    result = []
    for row in rows:
        r = dict(row)
        with get_db() as conn:
            cnt = conn.execute("SELECT COUNT(*) AS c FROM registrants WHERE registration_id = ?", (r["id"],)).fetchone()
        r["registrant_count"] = cnt["c"] if cnt else 0
        result.append(r)
    return result


@router.get("/public", response_model=list[RegistrationPublicOut])
async def list_public_registrations() -> list[RegistrationPublicOut]:
    """Return all open, publicly listed registrations that have not been converted."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM registrations WHERE open = 1 AND listed = 1 AND converted_to_tid IS NULL ORDER BY created_at DESC",
        ).fetchall()
    result: list[RegistrationPublicOut] = []
    for row in rows:
        r = dict(row)
        with get_db() as conn:
            registrants = conn.execute(
                "SELECT player_id, player_name, answers, registered_at FROM registrants WHERE registration_id = ? ORDER BY registered_at",
                (r["id"],),
            ).fetchall()
        result.append(
            RegistrationPublicOut(
                id=r["id"],
                name=r["name"],
                open=True,
                questions=_parse_questions(r.get("questions")),
                join_code_required=r.get("join_code") is not None,
                description=r.get("description"),
                message=r.get("message"),
                converted=False,
                converted_to_tid=None,
                listed=True,
                sport=r.get("sport", "padel"),
                registrant_count=len(registrants),
                registrants=[
                    RegistrantOut(
                        player_id=reg["player_id"],
                        player_name=reg["player_name"],
                        answers=_parse_answers(reg["answers"]),
                        registered_at=reg["registered_at"],
                    )
                    for reg in registrants
                ],
            )
        )
    return result


@router.get("/{rid}")
async def get_registration(rid: str, user: User = Depends(get_current_user)) -> RegistrationAdminOut:
    """Get full details of a registration including all registrants."""
    reg = _get_registration(rid)
    _require_registration_owner(reg, user)
    reg_id = reg["id"]
    registrants = _get_registrants(reg_id)
    return RegistrationAdminOut(
        id=reg["id"],
        name=reg["name"],
        open=bool(reg["open"]),
        join_code=reg.get("join_code"),
        questions=_parse_questions(reg.get("questions")),
        listed=bool(reg.get("listed", 0)),
        sport=reg.get("sport", "padel"),
        description=reg.get("description"),
        message=reg.get("message"),
        alias=reg.get("alias"),
        converted_to_tid=reg.get("converted_to_tid"),
        created_at=reg["created_at"],
        registrants=[
            RegistrantAdminOut(
                player_id=r["player_id"],
                player_name=r["player_name"],
                passphrase=r["passphrase"],
                token=r["token"],
                answers=_parse_answers(r.get("answers")),
                registered_at=r["registered_at"],
            )
            for r in registrants
        ],
    )


@router.patch("/{rid}")
async def update_registration(rid: str, req: RegistrationUpdate, user: User = Depends(get_current_user)) -> dict:
    """Update registration settings (partial)."""
    reg = _get_registration(rid)
    _require_registration_owner(reg, user)
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
    if req.sport is not None:
        updates.append("sport = ?")
        params.append(req.sport.value)

    if updates:
        params.append(reg_id)
        with get_db() as conn:
            conn.execute(f"UPDATE registrations SET {', '.join(updates)} WHERE id = ?", params)

    return {"ok": True}


@router.delete("/{rid}")
async def delete_registration(rid: str, user: User = Depends(get_current_user)) -> dict:
    """Delete a registration and all its registrants."""
    reg = _get_registration(rid)
    _require_registration_owner(reg, user)
    reg_id = reg["id"]
    with get_db() as conn:
        conn.execute("DELETE FROM registrants WHERE registration_id = ?", (reg_id,))
        conn.execute("DELETE FROM registrations WHERE id = ?", (reg_id,))
    return {"ok": True}


@router.patch("/{rid}/registrant/{player_id}")
async def patch_registrant(
    rid: str, player_id: str, req: RegistrantPatch, user: User = Depends(get_current_user)
) -> dict:
    """Override a registrant's name or level (admin)."""
    reg = _get_registration(rid)
    _require_registration_owner(reg, user)
    reg_id = reg["id"]

    updates: list[str] = []
    params: list = []
    if req.player_name is not None:
        updates.append("player_name = ?")
        params.append(req.player_name)
    if req.answers is not None:
        updates.append("answers = ?")
        params.append(json.dumps(req.answers))

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
    _require_registration_owner(reg, user)
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
    _require_registration_owner(reg, user)
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
    return RegistrationPublicOut(
        id=reg["id"],
        name=reg["name"],
        open=bool(reg["open"]),
        questions=_parse_questions(reg.get("questions")),
        join_code_required=reg.get("join_code") is not None,
        description=reg.get("description"),
        message=reg.get("message"),
        converted=reg.get("converted_to_tid") is not None,
        converted_to_tid=reg.get("converted_to_tid"),
        listed=bool(reg.get("listed", 0)),
        sport=reg.get("sport", "padel"),
        registrant_count=len(registrants),
        registrants=[
            RegistrantOut(
                player_id=r["player_id"],
                player_name=r["player_name"],
                answers=_parse_answers(r.get("answers")),
                registered_at=r["registered_at"],
            )
            for r in registrants
        ],
    )


@router.post("/{rid}/register")
async def register_player(rid: str, req: RegistrantIn) -> dict:
    """Self-register a player in an open registration lobby.

    Returns the newly created passphrase and token so the player can
    see them immediately (and scan the QR code).
    """
    reg = _get_registration(rid)
    reg_id = reg["id"]

    if not reg["open"]:
        raise HTTPException(400, "Registration is closed")
    if reg.get("converted_to_tid"):
        raise HTTPException(400, "Registration has already been converted to a tournament")

    # Check join code if required
    if reg.get("join_code"):
        if not req.join_code or req.join_code != reg["join_code"]:
            raise HTTPException(403, "Invalid join code")

    # Validate required questions
    questions = _parse_questions(reg.get("questions"))
    for q in questions:
        if q.required and not req.answers.get(q.key):
            raise HTTPException(400, f"Answer required for: {q.label}")

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

    answers_json = json.dumps(req.answers) if req.answers else None
    with get_db() as conn:
        conn.execute(
            """INSERT INTO registrants
               (registration_id, player_id, player_name, passphrase, token, answers, registered_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (reg_id, player_id, req.player_name, passphrase, token, answers_json, now),
        )

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
    """Convert a registration lobby into a real tournament.

    Player IDs, passphrases, and tokens are preserved so the same QR
    codes and passphrases work for scoring after conversion.
    """
    registration = _get_registration(rid)
    _require_registration_owner(registration, user)
    reg_id = registration["id"]

    if registration.get("converted_to_tid"):
        raise HTTPException(400, "Registration has already been converted")

    registrants = _get_registrants(reg_id)

    # Build the final player list from req.player_names if provided,
    # otherwise use all registrants.  Names matching existing registrants
    # reuse their IDs / passphrases / tokens; new names get fresh ones.
    registrant_by_name: dict[str, dict] = {r["player_name"]: dict(r) for r in registrants}
    names = [n.strip() for n in req.player_names if n.strip()] if req.player_names else list(registrant_by_name.keys())

    if len(names) < 2:
        raise HTTPException(400, "Need at least 2 players to create a tournament")

    # Collect existing passphrases so we don't collide when generating new ones
    existing_passphrases: set[str] = {r["passphrase"] for r in registrants}

    player_entries: list[tuple[str, str]] = []  # (name, player_id)
    secret_rows: list[tuple] = []  # rows for player_secrets INSERT

    for name in names:
        reg = registrant_by_name.get(name)
        if reg:
            player_entries.append((name, reg["player_id"]))
            secret_rows.append((None, reg["player_id"], name, reg["passphrase"], reg["token"]))
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

    async with _global_lock:
        tid = _next_id()

        if req.tournament_type == "group_playoff":
            players = [Player(name=name, id=pid) for name, pid in player_entries]
            courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []
            t = GroupPlayoffTournament(
                players=players,
                num_groups=req.num_groups,
                courts=courts,
                top_per_group=req.top_per_group,
                double_elimination=req.double_elimination,
                team_mode=req.team_mode,
                group_names=req.group_names,
            )
            t.generate()
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
            players = [Player(name=name, id=pid) for name, pid in player_entries]
            courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []
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
                )
            except ValueError as e:
                raise HTTPException(400, str(e))
            t.generate_next_round()
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
            teams = [[Player(name=name, id=pid)] for name, pid in player_entries]
            courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []
            t = PlayoffTournament(
                teams=teams,
                courts=courts,
                double_elimination=req.double_elimination,
                team_mode=req.team_mode,
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
            """INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(tournament_id, player_id) DO UPDATE SET
                   passphrase  = excluded.passphrase,
                   token       = excluded.token,
                   player_name = excluded.player_name""",
            [(tid, pid, name, pp, tok) for (_, pid, name, pp, tok) in secret_rows],
        )

    # Mark registration as converted
    with get_db() as conn:
        conn.execute(
            "UPDATE registrations SET converted_to_tid = ?, open = 0 WHERE id = ?",
            (tid, reg_id),
        )

    return {"tournament_id": tid, "tournament_name": tournament_name}


# ────────────────────────────────────────────────────────────────────────────
# Alias endpoints
# ────────────────────────────────────────────────────────────────────────────


@router.put("/{rid}/alias")
async def set_registration_alias(rid: str, req: SetAliasRequest, user: User = Depends(get_current_user)) -> dict:
    """Set a human-friendly alias for a registration (used in registration URLs)."""
    reg = _get_registration(rid)
    _require_registration_owner(reg, user)
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
async def player_login(rid: str, req: RegistrantLoginIn) -> RegistrantLoginOut:
    """Allow a returning player to retrieve their registration data by passphrase.

    No admin auth required — the passphrase proves identity.
    Returns 401 if the passphrase is not found in this lobby.
    """
    reg = _get_registration(rid)  # 404 if lobby doesn't exist
    result = lookup_registrant_by_passphrase(reg["id"], req.passphrase)
    if result is None:
        raise HTTPException(401, "Passphrase not found")
    return RegistrantLoginOut(**result)


@router.patch("/{rid}/player-answers", response_model=RegistrantLoginOut)
async def player_update_answers(rid: str, req: RegistrantAnswersUpdateIn) -> RegistrantLoginOut:
    """Allow a returning player to update their own answers by passphrase."""
    reg = _get_registration(rid)
    reg_id = reg["id"]

    if not reg["open"]:
        raise HTTPException(400, "Registration is closed")
    if reg.get("converted_to_tid"):
        raise HTTPException(400, "Registration has already been converted to a tournament")

    questions = _parse_questions(reg.get("questions"))
    for q in questions:
        if q.required and not req.answers.get(q.key):
            raise HTTPException(400, f"Answer required for: {q.label}")

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
async def player_cancel_registration(rid: str, req: RegistrantLoginIn) -> dict:
    """Allow a returning player to cancel their own registration by passphrase."""
    reg = _get_registration(rid)
    reg_id = reg["id"]

    if not reg["open"]:
        raise HTTPException(400, "Registration is closed")
    if reg.get("converted_to_tid"):
        raise HTTPException(400, "Registration has already been converted to a tournament")

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
    _require_registration_owner(reg, user)
    with get_db() as conn:
        conn.execute("UPDATE registrations SET alias = NULL WHERE id = ?", (reg["id"],))
    return {"ok": True}
