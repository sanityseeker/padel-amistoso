"""
Player Space routes.

Provides a cross-tournament identity layer for players.  A *Player Profile*
is a lightweight, platform-global identity keyed by a single 3-word
passphrase.  It accumulates active and past participations across any number
of tournaments and registration lobbies — without requiring a platform
account.

Authentication flow
-------------------
- Profile JWT: ``type=profile``, ``sub=profile:<profile_id>``, 30-day expiry.
  Stored on the client as ``padel-player-profile`` in localStorage.
- The profile passphrase is also accepted as a login credential on individual
  tournament TV pages (unified auth fallback — see ``routes_player_auth.py``).
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth.deps import ProfileIdentity, get_current_profile
from ..auth.security import create_profile_token
from ..email import is_valid_email, render_player_space_magic_link, render_player_space_welcome, send_email_background
from ..tournaments.player_secrets import generate_passphrase
from .db import get_db
from .player_secret_store import extract_history_stats, extract_partner_rival_stats, lookup_profile_by_passphrase
from .rate_limit import BoundedRateLimiter
from .state import get_tournament_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/player-profile", tags=["player-space"])

_RATE_LIMITER = BoundedRateLimiter(max_attempts=20, window_seconds=60, max_tracked_ips=4096)
_RECOVER_RATE_LIMITER = BoundedRateLimiter(max_attempts=3, window_seconds=900, max_tracked_ips=4096)


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ────────────────────────────────────────────────────────────────────────────


class ProfileCreateRequest(BaseModel):
    """Participant passphrase to verify prior participation, plus email and optional display name."""

    participant_passphrase: str = Field(min_length=1, max_length=256)
    name: str = Field(default="", max_length=128)
    email: str = Field(min_length=1, max_length=256)
    contact: str = Field(default="", max_length=256)


class ProfileLoginRequest(BaseModel):
    """Authenticate to the Player Space with the global passphrase."""

    passphrase: str = Field(min_length=1)


class ProfileRecoverRequest(BaseModel):
    """Request passphrase recovery by email."""

    email: str = Field(min_length=1, max_length=256)


class ProfileUpdateRequest(BaseModel):
    """Update mutable profile fields."""

    name: str = Field(default="", max_length=128)
    email: str = Field(default="", max_length=256)
    contact: str = Field(default="", max_length=256)


class ProfileLinkRequest(BaseModel):
    """Link an existing tournament or registration participation to this profile.

    The player proves ownership by supplying the passphrase they received for
    that specific entity (tournament or lobby).
    """

    entity_type: str = Field(pattern="^(tournament|registration)$")
    entity_id: str = Field(min_length=1)
    passphrase: str = Field(min_length=1)


class ProfileOut(BaseModel):
    """Public representation of a Player Profile."""

    id: str
    name: str
    email: str
    contact: str = ""
    created_at: str
    passphrase: str | None = None


class PlayerSpaceEntry(BaseModel):
    """A single participation entry in the Player Space dashboard."""

    entity_type: str  # "tournament" or "registration"
    entity_id: str
    entity_name: str
    player_id: str
    player_name: str
    status: str  # "active" or "finished"
    alias: str | None
    auto_login_token: str | None  # None for finished entries
    sport: str
    tournament_type: str | None  # None for registration-only entries
    entity_deleted: bool = False
    finished_at: str | None  # ISO string, only for history rows
    # Per-tournament stats (only populated for finished history entries)
    rank: int | None = None
    total_players: int | None = None
    wins: int = 0
    losses: int = 0
    draws: int = 0
    points_for: int = 0
    points_against: int = 0
    top_partners: list[dict] = Field(default_factory=list)
    top_rivals: list[dict] = Field(default_factory=list)
    all_partners: list[dict] = Field(default_factory=list)
    all_rivals: list[dict] = Field(default_factory=list)


class PlayerSpaceResponse(BaseModel):
    """Full Player Space dashboard payload."""

    profile: ProfileOut
    access_token: str
    entries: list[PlayerSpaceEntry]


class ProfileLoginResponse(BaseModel):
    """JWT returned after successful profile login."""

    access_token: str
    profile: ProfileOut


# ────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ────────────────────────────────────────────────────────────────────────────


def _passphrase_unique(passphrase: str) -> bool:
    """Return True if the passphrase is not already used by another profile."""
    with get_db() as conn:
        row = conn.execute("SELECT 1 FROM player_profiles WHERE passphrase = ?", (passphrase,)).fetchone()
    return row is None


def _generate_unique_passphrase(max_tries: int = 20) -> str:
    """Generate a 3-word passphrase that does not already exist in player_profiles."""
    for _ in range(max_tries):
        phrase = generate_passphrase()
        if _passphrase_unique(phrase):
            return phrase
    raise RuntimeError("Could not generate a unique passphrase after multiple attempts")


def _get_profile(profile_id: str) -> dict | None:
    """Return a profile row as a dict, or None if not found."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, passphrase, name, email, contact, created_at FROM player_profiles WHERE id = ?",
            (profile_id,),
        ).fetchone()
    if row is None:
        return None
    return dict(row)


def _row_to_profile_out(row: dict) -> ProfileOut:
    return ProfileOut(
        id=row["id"],
        name=row["name"] or "",
        email=row["email"] or "",
        contact=row.get("contact") or "",
        created_at=row["created_at"],
        passphrase=row.get("passphrase"),
    )


def _build_active_entries(profile_id: str) -> list[PlayerSpaceEntry]:
    """Aggregate active tournament and registration participations for a profile."""
    entries: list[PlayerSpaceEntry] = []

    with get_db() as conn:
        # Active tournament participations
        t_rows = conn.execute(
            """
            SELECT ps.player_id, ps.player_name, ps.token,
                   t.id AS tid, t.name AS tname, t.alias AS talias,
                   t.sport, t.type AS ttype
            FROM player_secrets ps
            JOIN tournaments t ON t.id = ps.tournament_id
            WHERE ps.profile_id = ?
              AND ps.finished_at IS NULL
            """,
            (profile_id,),
        ).fetchall()

        for row in t_rows:
            entries.append(
                PlayerSpaceEntry(
                    entity_type="tournament",
                    entity_id=row["tid"],
                    entity_name=row["tname"],
                    player_id=row["player_id"],
                    player_name=row["player_name"],
                    status="active",
                    alias=row["talias"],
                    auto_login_token=row["token"],
                    sport=row["sport"] or "padel",
                    tournament_type=row["ttype"],
                    entity_deleted=False,
                    finished_at=None,
                )
            )

        # Active registration participations
        r_rows = conn.execute(
            """
            SELECT rn.player_id, rn.player_name, rn.token,
                   r.id AS rid, r.name AS rname, r.alias AS ralias,
                   r.sport
            FROM registrants rn
            JOIN registrations r ON r.id = rn.registration_id
            WHERE rn.profile_id = ?
                            AND COALESCE(r.open, 0) = 1
              AND COALESCE(r.archived, 0) = 0
            """,
            (profile_id,),
        ).fetchall()

        for row in r_rows:
            entries.append(
                PlayerSpaceEntry(
                    entity_type="registration",
                    entity_id=row["rid"],
                    entity_name=row["rname"],
                    player_id=row["player_id"],
                    player_name=row["player_name"],
                    status="active",
                    alias=row["ralias"],
                    auto_login_token=row["token"],
                    sport=row["sport"] or "padel",
                    tournament_type=None,
                    entity_deleted=False,
                    finished_at=None,
                )
            )

    return entries


def _backfill_history_for_profile(profile_id: str) -> int:
    """Insert player_history rows for finished tournaments linked via registrants.

    Called after a profile is linked to registrant rows so that tournaments
    which already finished (and whose player_secrets have been purged) still
    appear in the history dashboard.

    For each registrant row owned by this profile, the function looks up the
    registrations it was converted into, loads each tournament's data blob,
    recomputes per-player stats and partner/rival data, then inserts a
    player_history row (``INSERT OR IGNORE`` — existing rows are never
    overwritten).  The ``finished_at`` timestamp is taken from any sibling
    history row for the same tournament; if none exists it falls back to now.

    Args:
        profile_id: The profile to backfill for.

    Returns:
        Number of newly inserted rows.
    """
    with get_db() as conn:
        registrant_rows = conn.execute(
            """
            SELECT rn.player_id, rn.player_name, rn.registration_id
            FROM registrants rn
            WHERE rn.profile_id = ?
            """,
            (profile_id,),
        ).fetchall()

    if not registrant_rows:
        return 0

    reg_ids = list({r["registration_id"] for r in registrant_rows})
    placeholders = ",".join("?" * len(reg_ids))

    with get_db() as conn:
        reg_rows = conn.execute(
            f"SELECT id, name, sport, converted_to_tids FROM registrations WHERE id IN ({placeholders})",
            reg_ids,
        ).fetchall()

    pid_by_reg: dict[str, list] = {}
    for r in registrant_rows:
        pid_by_reg.setdefault(r["registration_id"], []).append(r)

    inserted = 0
    for reg in reg_rows:
        tids: list[str] = json.loads(reg["converted_to_tids"]) if reg["converted_to_tids"] else []
        for tid in tids:
            t_data = get_tournament_data(tid)
            if t_data is None:
                continue

            ps = extract_history_stats(t_data)
            pr = extract_partner_rival_stats(t_data)
            sport = t_data.get("sport") or reg["sport"] or "padel"
            tournament_name = t_data.get("name") or reg["name"]

            for registrant in pid_by_reg.get(reg["id"], []):
                player_id = registrant["player_id"]
                player_name = registrant["player_name"]

                with get_db() as conn:
                    existing = conn.execute(
                        "SELECT 1 FROM player_history"
                        " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                        (profile_id, tid),
                    ).fetchone()
                    if existing:
                        continue

                    # Reuse the timestamp already recorded for this tournament by any other
                    # player so finished_at reflects the actual finish time, not now.
                    sibling = conn.execute(
                        "SELECT finished_at FROM player_history"
                        " WHERE entity_type = 'tournament' AND entity_id = ? LIMIT 1",
                        (tid,),
                    ).fetchone()
                    finished_at = sibling["finished_at"] if sibling else datetime.now(timezone.utc).isoformat()

                    stats = ps.get(player_id, {})
                    pr_data = pr.get(player_id, {})

                    conn.execute(
                        """
                        INSERT OR IGNORE INTO player_history
                               (profile_id, entity_type, entity_id, entity_name,
                                player_id, player_name, finished_at,
                                rank, total_players, wins, losses, draws,
                                points_for, points_against, sport, top_partners, top_rivals, all_partners, all_rivals)
                               VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            profile_id,
                            tid,
                            tournament_name,
                            player_id,
                            player_name,
                            finished_at,
                            stats.get("rank"),
                            stats.get("total_players"),
                            stats.get("wins", 0),
                            stats.get("losses", 0),
                            stats.get("draws", 0),
                            stats.get("points_for", 0),
                            stats.get("points_against", 0),
                            sport,
                            json.dumps(pr_data.get("top_partners", [])),
                            json.dumps(pr_data.get("top_rivals", [])),
                            json.dumps(pr_data.get("all_partners", [])),
                            json.dumps(pr_data.get("all_rivals", [])),
                        ),
                    )
                    inserted += conn.execute("SELECT changes()").fetchone()[0]

    return inserted


def _build_history_entries(profile_id: str) -> list[PlayerSpaceEntry]:
    """Load finished participation history for a profile from player_history."""
    entries: list[PlayerSpaceEntry] = []

    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT ph.entity_type, ph.entity_id, ph.entity_name,
                   ph.player_id, ph.player_name, ph.finished_at,
                   ph.rank, ph.total_players,
                   ph.wins, ph.losses, ph.draws, ph.points_for, ph.points_against,
                     ph.sport, ph.top_partners, ph.top_rivals, ph.all_partners, ph.all_rivals
            FROM player_history ph
            WHERE ph.profile_id = ?
            ORDER BY ph.finished_at DESC
            """,
            (profile_id,),
        ).fetchall()

        # Collect entity IDs by type for a single bulk lookup of alias and type.
        # sport is now stored on player_history so the live lookup is only needed for alias/type.
        t_ids = [r["entity_id"] for r in rows if r["entity_type"] == "tournament"]
        r_ids = [r["entity_id"] for r in rows if r["entity_type"] == "registration"]

        t_meta: dict[str, dict] = {}
        r_meta: dict[str, dict] = {}

        if t_ids:
            placeholders = ",".join("?" * len(t_ids))
            t_rows = conn.execute(
                f"SELECT id, name, alias, sport, type FROM tournaments WHERE id IN ({placeholders})",
                t_ids,
            ).fetchall()
            t_meta = {r["id"]: dict(r) for r in t_rows}

        if r_ids:
            placeholders = ",".join("?" * len(r_ids))
            r_rows = conn.execute(
                f"SELECT id, name, alias, sport FROM registrations WHERE id IN ({placeholders})",
                r_ids,
            ).fetchall()
            r_meta = {r["id"]: dict(r) for r in r_rows}

    for row in rows:
        etype = row["entity_type"]
        eid = row["entity_id"]
        stored_name = row["entity_name"] or ""
        stored_sport = row["sport"] or "padel"
        top_partners = json.loads(row["top_partners"]) if row["top_partners"] else []
        top_rivals = json.loads(row["top_rivals"]) if row["top_rivals"] else []
        all_partners = json.loads(row["all_partners"]) if row["all_partners"] else []
        all_rivals = json.loads(row["all_rivals"]) if row["all_rivals"] else []
        if etype == "tournament":
            meta = t_meta.get(eid, {})
            entries.append(
                PlayerSpaceEntry(
                    entity_type="tournament",
                    entity_id=eid,
                    entity_name=stored_name or meta.get("name", eid),
                    player_id=row["player_id"],
                    player_name=row["player_name"],
                    status="finished",
                    alias=meta.get("alias"),
                    auto_login_token=None,
                    sport=stored_sport,
                    tournament_type=meta.get("type"),
                    entity_deleted=not bool(meta),
                    finished_at=row["finished_at"],
                    rank=row["rank"],
                    total_players=row["total_players"],
                    wins=row["wins"] or 0,
                    losses=row["losses"] or 0,
                    draws=row["draws"] or 0,
                    points_for=row["points_for"] or 0,
                    points_against=row["points_against"] or 0,
                    top_partners=top_partners,
                    top_rivals=top_rivals,
                    all_partners=all_partners,
                    all_rivals=all_rivals,
                )
            )
        else:
            meta = r_meta.get(eid, {})
            entries.append(
                PlayerSpaceEntry(
                    entity_type="registration",
                    entity_id=eid,
                    entity_name=stored_name or meta.get("name", eid),
                    player_id=row["player_id"],
                    player_name=row["player_name"],
                    status="finished",
                    alias=meta.get("alias"),
                    auto_login_token=None,
                    sport=stored_sport,
                    tournament_type=None,
                    entity_deleted=not bool(meta),
                    finished_at=row["finished_at"],
                    rank=row["rank"],
                    total_players=row["total_players"],
                    wins=row["wins"] or 0,
                    losses=row["losses"] or 0,
                    draws=row["draws"] or 0,
                    points_for=row["points_for"] or 0,
                    points_against=row["points_against"] or 0,
                )
            )

    return entries


def _deduplicate_entries(entries: list[PlayerSpaceEntry]) -> list[PlayerSpaceEntry]:
    """Keep the first entry per (entity_type, entity_id)."""
    seen: set[tuple[str, str]] = set()
    deduplicated: list[PlayerSpaceEntry] = []
    for entry in entries:
        key = (entry.entity_type, entry.entity_id)
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append(entry)
    return deduplicated


# ────────────────────────────────────────────────────────────────────────────
# Public endpoints
# ────────────────────────────────────────────────────────────────────────────


def _backfill_finished_secrets(profile_id: str) -> None:
    """Backfill player_history rows for newly linked finished secrets.

    After a profile is created or a manual link is made, any ``player_secrets``
    rows that already have ``finished_at`` set (tournament ended before the
    player created their profile) are converted into history entries using the
    stats snapshot that was serialised into the secret at finish time.

    Only rows that do not already have a matching ``player_history`` record are
    considered. This prevents deleting already-retained finished secrets that
    were linked before tournament completion.

    Stats are read from the ``finished_stats`` / ``finished_top_partners`` /
    ``finished_top_rivals`` columns, which were populated by
    ``delete_secrets_for_tournament`` when the tournament finished.  This means
    backfill works even after a server restart or tournament deletion.

    Args:
        profile_id: The profile whose newly linked finished secrets should be
            backfilled.
    """
    with get_db() as conn:
        rows = conn.execute(
            """SELECT tournament_id, player_id, player_name,
                      finished_at, tournament_name, finished_sport,
                      finished_stats, finished_top_partners, finished_top_rivals,
                      finished_all_partners, finished_all_rivals
               FROM player_secrets
                             WHERE profile_id = ?
                                 AND finished_at IS NOT NULL
                                 AND NOT EXISTS (
                                             SELECT 1
                                                 FROM player_history ph
                                                WHERE ph.profile_id = player_secrets.profile_id
                                                    AND ph.entity_type = 'tournament'
                                                    AND ph.entity_id = player_secrets.tournament_id
                                 )""",
            (profile_id,),
        ).fetchall()
        if not rows:
            return

        for row in rows:
            stats = json.loads(row["finished_stats"]) if row["finished_stats"] else {}
            top_partners = json.loads(row["finished_top_partners"]) if row["finished_top_partners"] else []
            top_rivals = json.loads(row["finished_top_rivals"]) if row["finished_top_rivals"] else []
            all_partners = json.loads(row["finished_all_partners"]) if row["finished_all_partners"] else []
            all_rivals = json.loads(row["finished_all_rivals"]) if row["finished_all_rivals"] else []
            conn.execute(
                """
                INSERT OR IGNORE INTO player_history
                    (profile_id, entity_type, entity_id, entity_name,
                     player_id, player_name, finished_at,
                     rank, total_players, wins, losses, draws, points_for, points_against,
                     sport, top_partners, top_rivals, all_partners, all_rivals)
                VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    profile_id,
                    row["tournament_id"],
                    row["tournament_name"] or "",
                    row["player_id"],
                    row["player_name"],
                    row["finished_at"],
                    stats.get("rank"),
                    stats.get("total_players"),
                    stats.get("wins", 0),
                    stats.get("losses", 0),
                    stats.get("draws", 0),
                    stats.get("points_for", 0),
                    stats.get("points_against", 0),
                    row["finished_sport"] or "padel",
                    json.dumps(top_partners),
                    json.dumps(top_rivals),
                    json.dumps(all_partners),
                    json.dumps(all_rivals),
                ),
            )
        conn.executemany(
            "DELETE FROM player_secrets WHERE profile_id = ? AND tournament_id = ? AND player_id = ?",
            [(profile_id, row["tournament_id"], row["player_id"]) for row in rows],
        )


@router.post("", response_model=PlayerSpaceResponse)
async def create_profile(req: ProfileCreateRequest, request: Request) -> PlayerSpaceResponse:
    """Create a new Player Space profile.

    Generates a unique 3-word passphrase and returns it in the response.
    Also returns an initial JWT so the player can immediately see their
    (empty) dashboard without a second round-trip.
    """
    _RATE_LIMITER.check(_client_ip(request), "Too many requests — try again later")

    clean_passphrase = req.participant_passphrase.strip()
    with get_db() as conn:
        participant_row = conn.execute(
            "SELECT 1 FROM player_secrets WHERE passphrase = ? UNION SELECT 1 FROM registrants WHERE passphrase = ?",
            (clean_passphrase, clean_passphrase),
        ).fetchone()
    if participant_row is None:
        raise HTTPException(401, "Passphrase not recognised — join a tournament or registration lobby first")

    clean_email = req.email.strip()
    if not is_valid_email(clean_email):
        raise HTTPException(422, "A valid email address is required")

    profile_id = str(uuid.uuid4())
    # Reuse the tournament/lobby passphrase as the profile passphrase so the
    # player doesn't need to remember a second credential.  Fall back to a
    # freshly generated one only if the passphrase is already claimed by
    # another profile.
    passphrase = clean_passphrase if _passphrase_unique(clean_passphrase) else _generate_unique_passphrase()
    now = datetime.now(timezone.utc).isoformat()
    clean_name = req.name.strip()
    clean_contact = req.contact.strip()

    with get_db() as conn:
        conn.execute(
            "INSERT INTO player_profiles (id, passphrase, name, email, contact, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (profile_id, passphrase, clean_name, clean_email, clean_contact, now),
        )
        # Auto-link the participation the player used to prove identity.
        # Always update BOTH tables: when a lobby is converted to a tournament the
        # same passphrase may exist in both registrants and player_secrets, so we
        # must link them unconditionally rather than stopping after the first hit.
        conn.execute(
            "UPDATE player_secrets SET profile_id = ? WHERE passphrase = ? AND profile_id IS NULL",
            (profile_id, clean_passphrase),
        )
        conn.execute(
            "UPDATE registrants SET profile_id = ? WHERE passphrase = ? AND profile_id IS NULL",
            (profile_id, clean_passphrase),
        )
        # Also bulk-link every other existing participation that shares the same
        # email address so they all appear in the dashboard immediately.
        conn.execute(
            "UPDATE player_secrets SET profile_id = ? WHERE LOWER(email) = LOWER(?) AND profile_id IS NULL",
            (profile_id, clean_email),
        )
        conn.execute(
            "UPDATE registrants SET profile_id = ? WHERE LOWER(email) = LOWER(?) AND profile_id IS NULL",
            (profile_id, clean_email),
        )

    profile_dict = {
        "id": profile_id,
        "passphrase": passphrase,
        "name": clean_name,
        "email": clean_email,
        "created_at": now,
    }
    profile_out = _row_to_profile_out(profile_dict)
    token = create_profile_token(profile_id)

    subject, html_body = render_player_space_welcome(
        name=clean_name, email=clean_email, passphrase=passphrase, access_token=token
    )
    send_email_background(clean_email, subject, html_body)

    _backfill_history_for_profile(profile_id)
    _backfill_finished_secrets(profile_id)
    active = _build_active_entries(profile_id)
    history = _build_history_entries(profile_id)

    return PlayerSpaceResponse(
        profile=profile_out,
        access_token=token,
        entries=_deduplicate_entries(active + history),
    )


@router.post("/login", response_model=ProfileLoginResponse)
async def login_profile(req: ProfileLoginRequest, request: Request) -> ProfileLoginResponse:
    """Authenticate to the Player Space with the 3-word global passphrase.

    Returns a 30-day JWT on success.
    """
    _RATE_LIMITER.check(_client_ip(request), "Too many requests — try again later")

    profile = lookup_profile_by_passphrase(req.passphrase)
    if profile is None:
        _RATE_LIMITER.record(_client_ip(request))
        raise HTTPException(401, "Invalid passphrase")

    token = create_profile_token(profile["id"])
    return ProfileLoginResponse(access_token=token, profile=_row_to_profile_out(profile))


@router.post("/recover")
async def recover_passphrase(req: ProfileRecoverRequest, request: Request) -> dict:
    """Email the player a one-click login link given their registered email address.

    The link embeds a short-lived (1-hour) profile JWT — the passphrase is
    never included in the email.  Always returns ``{"ok": True}`` regardless
    of whether the email is found, to prevent account enumeration.
    """
    _RECOVER_RATE_LIMITER.check(_client_ip(request), "Too many recovery requests — try again in 15 minutes")
    _RECOVER_RATE_LIMITER.record(_client_ip(request))

    clean_email = req.email.strip()
    if not is_valid_email(clean_email):
        return {"ok": True}

    with get_db() as conn:
        row = conn.execute(
            "SELECT id, passphrase, name, email FROM player_profiles WHERE LOWER(email) = LOWER(?)",
            (clean_email,),
        ).fetchone()

    if row is not None:
        # Short-lived token so the magic link expires quickly.
        recovery_token = create_profile_token(row["id"], expires_delta=timedelta(hours=1))
        subject, html_body = render_player_space_magic_link(
            name=row["name"], email=row["email"], access_token=recovery_token
        )
        send_email_background(row["email"], subject, html_body)

    return {"ok": True}


@router.get("/space", response_model=PlayerSpaceResponse)
async def get_player_space(
    identity: ProfileIdentity | None = Depends(get_current_profile),
) -> PlayerSpaceResponse:
    """Return the full Player Space dashboard for the authenticated profile.

    Requires a valid profile JWT (``Authorization: Bearer <token>``).
    Active tournament and registration participations plus finished history
    are included.
    """
    if identity is None:
        raise HTTPException(401, "Profile authentication required")

    profile = _get_profile(identity.profile_id)
    if profile is None:
        raise HTTPException(404, "Profile not found")

    active = _build_active_entries(identity.profile_id)
    history = _build_history_entries(identity.profile_id)

    # De-duplicate: a registration that was converted to a tournament should
    # not appear twice if both still have a valid profile_id row.
    token = create_profile_token(identity.profile_id)
    return PlayerSpaceResponse(
        profile=_row_to_profile_out(profile),
        access_token=token,
        entries=_deduplicate_entries(active + history),
    )


@router.put("", response_model=ProfileOut)
async def update_profile(
    req: ProfileUpdateRequest,
    identity: ProfileIdentity | None = Depends(get_current_profile),
) -> ProfileOut:
    """Update the display name, email, and/or contact of the authenticated profile.

    Changes to *email* and *contact* are propagated to all active
    ``player_secrets`` rows linked to this profile so tournament organizers
    always see up-to-date contact information without having to edit it manually.
    """
    if identity is None:
        raise HTTPException(401, "Profile authentication required")

    new_email = req.email.strip()
    new_contact = req.contact.strip()

    with get_db() as conn:
        cur = conn.execute(
            "UPDATE player_profiles SET name = ?, email = ?, contact = ? WHERE id = ?",
            (req.name.strip(), new_email, new_contact, identity.profile_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(404, "Profile not found")
        # Propagate email and contact to all active (non-finished) linked secrets.
        conn.execute(
            """
            UPDATE player_secrets
               SET email = ?, contact = ?
             WHERE profile_id = ? AND finished_at IS NULL
            """,
            (new_email, new_contact, identity.profile_id),
        )
        row = conn.execute(
            "SELECT id, passphrase, name, email, contact, created_at FROM player_profiles WHERE id = ?",
            (identity.profile_id,),
        ).fetchone()

    return _row_to_profile_out(dict(row))


@router.post("/link", response_model=PlayerSpaceEntry)
async def link_participation(
    req: ProfileLinkRequest,
    request: Request,
    identity: ProfileIdentity | None = Depends(get_current_profile),
) -> PlayerSpaceEntry:
    """Link an existing tournament or registration participation to this profile.

    The player proves ownership of the participation by providing the passphrase
    they originally received for that tournament or lobby.  On success the
    matching row gets ``profile_id`` set and the participation appears in the
    Player Space dashboard.
    """
    if identity is None:
        raise HTTPException(401, "Profile authentication required")

    _RATE_LIMITER.check(_client_ip(request), "Too many requests — try again later")

    if req.entity_type == "tournament":
        with get_db() as conn:
            row = conn.execute(
                """
                SELECT ps.player_id, ps.player_name, ps.token, ps.finished_at,
                       t.id AS tid, t.name AS tname, t.alias AS talias,
                       t.sport, t.type AS ttype
                FROM player_secrets ps
                JOIN tournaments t ON t.id = ps.tournament_id
                WHERE (ps.tournament_id = ? OR t.alias = ?) AND ps.passphrase = ?
                """,
                (req.entity_id, req.entity_id, req.passphrase),
            ).fetchone()

            if row is None:
                _RATE_LIMITER.record(_client_ip(request))
                raise HTTPException(401, "Invalid passphrase or tournament not found")

            resolved_tid = row["tid"]
            conn.execute(
                "UPDATE player_secrets SET profile_id = ? WHERE tournament_id = ? AND passphrase = ?",
                (identity.profile_id, resolved_tid, req.passphrase),
            )

        if row["finished_at"]:
            # Tournament already finished — backfill history and return a finished entry.
            _backfill_finished_secrets(identity.profile_id)
            with get_db() as conn:
                h = conn.execute(
                    "SELECT * FROM player_history"
                    " WHERE profile_id = ? AND entity_id = ? AND entity_type = 'tournament'",
                    (identity.profile_id, resolved_tid),
                ).fetchone()
            return PlayerSpaceEntry(
                entity_type="tournament",
                entity_id=row["tid"],
                entity_name=row["tname"] or (h["entity_name"] if h else ""),
                player_id=row["player_id"],
                player_name=row["player_name"],
                status="finished",
                alias=row["talias"],
                auto_login_token=None,
                sport=row["sport"] or (h["sport"] if h else "padel") or "padel",
                tournament_type=row["ttype"],
                finished_at=h["finished_at"] if h else None,
                rank=h["rank"] if h else None,
                total_players=h["total_players"] if h else None,
                wins=h["wins"] or 0 if h else 0,
                losses=h["losses"] or 0 if h else 0,
                draws=h["draws"] or 0 if h else 0,
                points_for=h["points_for"] or 0 if h else 0,
                points_against=h["points_against"] or 0 if h else 0,
                top_partners=json.loads(h["top_partners"]) if h and h["top_partners"] else [],
                top_rivals=json.loads(h["top_rivals"]) if h and h["top_rivals"] else [],
            )

        return PlayerSpaceEntry(
            entity_type="tournament",
            entity_id=row["tid"],
            entity_name=row["tname"],
            player_id=row["player_id"],
            player_name=row["player_name"],
            status="active",
            alias=row["talias"],
            auto_login_token=row["token"],
            sport=row["sport"] or "padel",
            tournament_type=row["ttype"],
            finished_at=None,
        )

    else:  # registration
        with get_db() as conn:
            row = conn.execute(
                """
                SELECT rn.player_id, rn.player_name, rn.token,
                       r.id AS rid, r.name AS rname, r.alias AS ralias,
                       r.sport
                FROM registrants rn
                JOIN registrations r ON r.id = rn.registration_id
                WHERE (rn.registration_id = ? OR r.alias = ?) AND rn.passphrase = ?
                """,
                (req.entity_id, req.entity_id, req.passphrase),
            ).fetchone()

            if row is None:
                _RATE_LIMITER.record(_client_ip(request))
                raise HTTPException(401, "Invalid passphrase or registration not found")

            conn.execute(
                "UPDATE registrants SET profile_id = ? WHERE registration_id = ? AND passphrase = ?",
                (identity.profile_id, row["rid"], req.passphrase),
            )

        return PlayerSpaceEntry(
            entity_type="registration",
            entity_id=row["rid"],
            entity_name=row["rname"],
            player_id=row["player_id"],
            player_name=row["player_name"],
            status="active",
            alias=row["ralias"],
            auto_login_token=row["token"],
            sport=row["sport"] or "padel",
            tournament_type=None,
            finished_at=None,
        )
