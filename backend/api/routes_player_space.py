"""
Player Hub routes.

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

from collections import defaultdict
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth.deps import ProfileIdentity, get_current_profile
from ..auth.security import (
    create_profile_email_verify_token,
    create_profile_token,
    decode_profile_email_verify_token,
)
from ..email import is_valid_email, render_player_space_magic_link, render_player_space_welcome, send_email_background
from ..tournaments.player_secrets import generate_passphrase
from .db import get_db
from .player_secret_store import (
    extract_history_stats,
    extract_partner_rival_stats,
    lookup_profile_by_passphrase,
    resolve_passphrase,
)
from .rate_limit import BoundedRateLimiter
from .state import bump_tournament_version, get_tournament_data

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/player-profile", tags=["player-space"])

_RATE_LIMITER = BoundedRateLimiter(max_attempts=20, window_seconds=60, max_tracked_ips=4096)
_RECOVER_RATE_LIMITER = BoundedRateLimiter(max_attempts=3, window_seconds=900, max_tracked_ips=4096)
_PATH_CACHE_MEM: dict[tuple[str, str, str, int | None], TournamentPathResponse] = {}


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
    """Authenticate to the Player Hub with the global passphrase."""

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


class ProfileUnlinkRequest(BaseModel):
    """Unlink a tournament participation from this profile."""

    entity_type: str = Field(pattern="^tournament$")
    entity_id: str = Field(min_length=1)


class PassphraseResolveRequest(BaseModel):
    """Resolve a passphrase to determine what it matches."""

    passphrase: str = Field(min_length=1, max_length=256)


class ParticipationMatch(BaseModel):
    """A single participation match returned by the resolve endpoint."""

    entity_type: str
    entity_id: str
    entity_name: str
    player_name: str


class PassphraseResolveResponse(BaseModel):
    """Result of resolving a passphrase."""

    type: str  # "profile" | "participation" | "not_found"
    matches: list[ParticipationMatch] = Field(default_factory=list)


class ProfileOut(BaseModel):
    """Public representation of a Player Profile."""

    id: str
    name: str
    email: str
    email_verified: bool = False
    contact: str = ""
    created_at: str
    passphrase: str | None = None


class PlayerSpaceEntry(BaseModel):
    """A single participation entry in the Player Hub dashboard."""

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
    """Full Player Hub dashboard payload."""

    profile: ProfileOut
    access_token: str
    entries: list[PlayerSpaceEntry]


class PlayerPathRound(BaseModel):
    """A single round row in a player's tournament path."""

    round_number: int
    round_label: str
    cumulative_points: int
    rank: int | None
    total_players: int
    partners: list[str] = Field(default_factory=list)
    opponents: list[str] = Field(default_factory=list)
    played: bool = False


class TournamentPathResponse(BaseModel):
    """Round-by-round path payload for one player in one tournament."""

    entity_id: str
    player_id: str
    tournament_type: str | None
    available: bool
    reason: str | None = None
    rounds: list[PlayerPathRound] = Field(default_factory=list)


class ProfileLoginResponse(BaseModel):
    """JWT returned after successful profile login."""

    access_token: str
    profile: ProfileOut


class VerifyEmailRequest(BaseModel):
    """Verify ownership of a profile email using an email-only token."""

    token: str = Field(min_length=1)


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
            "SELECT id, passphrase, name, email, email_verified_at, contact, created_at FROM player_profiles WHERE id = ?",
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
        email_verified=bool(row.get("email_verified_at")),
        contact=row.get("contact") or "",
        created_at=row["created_at"],
        passphrase=row.get("passphrase"),
    )


def _link_email_participations(profile_id: str, email: str) -> None:
    """Link all unclaimed participations that match ``email`` to ``profile_id``."""
    with get_db() as conn:
        conn.execute(
            "UPDATE player_secrets SET profile_id = ? WHERE LOWER(email) = LOWER(?) AND profile_id IS NULL",
            (profile_id, email),
        )
        conn.execute(
            "UPDATE registrants SET profile_id = ? WHERE LOWER(email) = LOWER(?) AND profile_id IS NULL",
            (profile_id, email),
        )


def _send_email_verification(
    profile_id: str,
    email: str,
    name: str,
    passphrase: str,
    access_token: str = "",
) -> None:
    """Send a Player Hub welcome email that includes a one-click email verification link."""
    verify_token = create_profile_email_verify_token(profile_id, email)
    subject, html_body = render_player_space_welcome(
        name=name,
        email=email,
        passphrase=passphrase,
        access_token=access_token,
        verify_token=verify_token,
    )
    send_email_background(email, subject, html_body)


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

        # Bulk-load in-progress stats snapshots for active tournaments.
        live_stats: dict[str, dict] = {}
        active_tids = [r["tid"] for r in t_rows]
        if active_tids:
            placeholders = ",".join("?" * len(active_tids))
            stat_rows = conn.execute(
                f"""SELECT entity_id, rank, total_players,
                           wins, losses, draws, points_for, points_against
                    FROM player_history
                    WHERE profile_id = ? AND entity_type = 'tournament'
                      AND finished_at = ''
                      AND entity_id IN ({placeholders})""",
                [profile_id, *active_tids],
            ).fetchall()
            for sr in stat_rows:
                live_stats[sr["entity_id"]] = dict(sr)

        for row in t_rows:
            ls = live_stats.get(row["tid"], {})
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
                    rank=ls.get("rank"),
                    total_players=ls.get("total_players"),
                    wins=ls.get("wins", 0),
                    losses=ls.get("losses", 0),
                    draws=ls.get("draws", 0),
                    points_for=ls.get("points_for", 0),
                    points_against=ls.get("points_against", 0),
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
              AND ph.finished_at != ''
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


def _side_score(match: object, is_team1: bool) -> int:
    """Return the side score for a match side, or 0 when score is missing."""
    score = getattr(match, "score", None)
    if not score:
        return 0
    return int(score[0] if is_team1 else score[1])


def _is_completed_match(match: object) -> bool:
    """Return whether a match has a completed status and score."""
    status = str(getattr(match, "status", ""))
    return status == "completed" and getattr(match, "score", None) is not None


def _expand_side_player_ids(side_ids: list[str], team_roster: dict[str, list[str]]) -> list[str]:
    """Expand composite team IDs to member IDs when roster data is available."""
    expanded: list[str] = []
    for pid in side_ids:
        members = team_roster.get(pid)
        if members:
            expanded.extend(members)
        else:
            expanded.append(pid)
    return expanded


def _member_name_map(tournament: object, team_roster: dict[str, list[str]]) -> dict[str, str]:
    """Build best-effort player ID -> display name mapping."""
    name_map: dict[str, str] = {}
    players = getattr(tournament, "players", []) or []
    for p in players:
        pid = getattr(p, "id", "")
        if pid:
            name_map[pid] = getattr(p, "name", pid)

    team_member_names = getattr(tournament, "team_member_names", None) or {}
    for team_id, member_ids in team_roster.items():
        names = team_member_names.get(team_id) or []
        for idx, member_id in enumerate(member_ids):
            if idx < len(names) and names[idx]:
                name_map[member_id] = names[idx]
    return name_map


def _names_from_ids(ids: list[str], name_map: dict[str, str]) -> list[str]:
    """Resolve IDs to names with graceful fallback labels."""
    return [name_map.get(pid) or f"ID {pid[:8]}" for pid in ids]


def _rank_order_by_points(points_by_id: dict[str, int], cohort_ids: list[str]) -> list[str]:
    """Return participant IDs sorted by cumulative points descending."""
    return sorted(cohort_ids, key=lambda pid: (-points_by_id.get(pid, 0), pid))


def _mex_rank_order(points_by_id: dict[str, int], played_by_id: dict[str, int], cohort_ids: list[str]) -> list[str]:
    """Return Mexicano rank order, mirroring leaderboard avg-vs-total behavior."""
    played_counts = {played_by_id.get(pid, 0) for pid in cohort_ids}
    ranked_by_avg = len(played_counts) > 1

    def _avg(pid: str) -> float:
        played = played_by_id.get(pid, 0)
        if played <= 0:
            return 0.0
        return float(points_by_id.get(pid, 0)) / float(played)

    if ranked_by_avg:
        return sorted(cohort_ids, key=lambda pid: (-_avg(pid), -points_by_id.get(pid, 0), pid))
    return sorted(cohort_ids, key=lambda pid: (-points_by_id.get(pid, 0), -_avg(pid), pid))


def _rank_for_id(ranked_ids: list[str], target_id: str) -> int | None:
    """Return 1-based rank position for an ID in an ordered ranking list."""
    for idx, pid in enumerate(ranked_ids, start=1):
        if pid == target_id:
            return idx
    return None


def _group_rank_and_points_for_round(group: object, up_to_round: int) -> tuple[dict[str, int], dict[str, int]]:
    """Return exact group rank and points_for maps using native standings criteria."""
    table: dict[str, dict] = {}
    for player in getattr(group, "players", []) or []:
        pid = getattr(player, "id", "")
        if pid:
            table[pid] = {
                "player": player,
                "wins": 0,
                "draws": 0,
                "losses": 0,
                "sets_won": 0,
                "sets_lost": 0,
                "points_for": 0,
                "points_against": 0,
            }

    uses_sets = False
    for match in getattr(group, "matches", []) or []:
        rn = int(getattr(match, "round_number", 0) or 0)
        if rn <= 0 or rn > up_to_round or not _is_completed_match(match):
            continue

        team1_ids = [getattr(p, "id", "") for p in getattr(match, "team1", []) or []]
        team2_ids = [getattr(p, "id", "") for p in getattr(match, "team2", []) or []]
        if any(pid not in table for pid in team1_ids + team2_ids):
            continue

        sets = getattr(match, "sets", None)
        if sets:
            uses_sets = True
            games1 = sum(int(s[0]) for s in sets)
            games2 = sum(int(s[1]) for s in sets)
            sets1 = sum(1 for s in sets if int(s[0]) > int(s[1]))
            sets2 = sum(1 for s in sets if int(s[1]) > int(s[0]))
            if sets1 > sets2:
                team1_won: bool | None = True
            elif sets2 > sets1:
                team1_won = False
            else:
                team1_won = None

            for pid in team1_ids:
                row = table[pid]
                row["points_for"] += games1
                row["points_against"] += games2
                row["sets_won"] += sets1
                row["sets_lost"] += sets2
                if team1_won is True:
                    row["wins"] += 1
                elif team1_won is False:
                    row["losses"] += 1
                else:
                    row["draws"] += 1

            for pid in team2_ids:
                row = table[pid]
                row["points_for"] += games2
                row["points_against"] += games1
                row["sets_won"] += sets2
                row["sets_lost"] += sets1
                if team1_won is True:
                    row["losses"] += 1
                elif team1_won is False:
                    row["wins"] += 1
                else:
                    row["draws"] += 1
            continue

        score = getattr(match, "score", None)
        if not score:
            continue
        s1, s2 = int(score[0]), int(score[1])

        for pid in team1_ids:
            row = table[pid]
            row["points_for"] += s1
            row["points_against"] += s2
            if s1 > s2:
                row["wins"] += 1
            elif s1 < s2:
                row["losses"] += 1
            else:
                row["draws"] += 1

        for pid in team2_ids:
            row = table[pid]
            row["points_for"] += s2
            row["points_against"] += s1
            if s2 > s1:
                row["wins"] += 1
            elif s2 < s1:
                row["losses"] += 1
            else:
                row["draws"] += 1

    rows = list(table.values())
    if uses_sets:
        rows.sort(
            key=lambda row: (
                row["wins"],
                row["sets_won"] - row["sets_lost"],
                row["points_for"] - row["points_against"],
                row["points_for"],
            ),
            reverse=True,
        )
    else:
        rows.sort(
            key=lambda row: (
                row["wins"],
                row["points_for"] - row["points_against"],
                row["points_for"],
            ),
            reverse=True,
        )

    rank_map = {row["player"].id: idx for idx, row in enumerate(rows, start=1)}
    points_map = {row["player"].id: int(row["points_for"]) for row in rows}
    return rank_map, points_map


def _group_identity_context(
    tournament: object,
    player_id: str,
    team_roster: dict[str, list[str]],
) -> tuple[object | None, str | None, list[str]]:
    """Resolve group object, canonical scoring ID, and cohort IDs for a player."""
    member_to_team: dict[str, str] = {}
    for team_id, members in team_roster.items():
        for member_id in members:
            member_to_team[member_id] = team_id

    canonical_id = member_to_team.get(player_id, player_id)
    groups = getattr(tournament, "groups", []) or []
    for group in groups:
        group_ids = [getattr(p, "id", "") for p in getattr(group, "players", []) or []]
        if canonical_id in group_ids:
            return group, canonical_id, group_ids
    return None, None, []


def _build_group_path_rows(tournament: object, player_id: str) -> list[PlayerPathRound]:
    """Build round-path rows for Group+Playoff group-stage rounds only."""
    team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
    name_map = _member_name_map(tournament, team_roster)

    group, canonical_id, cohort_ids = _group_identity_context(tournament, player_id, team_roster)
    if group is None or canonical_id is None or not cohort_ids:
        return []

    matches = [m for m in (getattr(group, "matches", []) or []) if int(getattr(m, "round_number", 0) or 0) > 0]
    round_numbers = sorted({int(getattr(m, "round_number", 0) or 0) for m in matches})
    rows: list[PlayerPathRound] = []

    for round_number in round_numbers:
        played = False
        partners: list[str] = []
        opponents: list[str] = []

        round_matches = [m for m in matches if int(getattr(m, "round_number", 0) or 0) == round_number]
        for match in round_matches:
            if not _is_completed_match(match):
                continue

            team1_ids = [getattr(p, "id", "") for p in getattr(match, "team1", []) or []]
            team2_ids = [getattr(p, "id", "") for p in getattr(match, "team2", []) or []]

            in_team1 = canonical_id in team1_ids
            in_team2 = canonical_id in team2_ids

            if in_team1:
                side_ids = _expand_side_player_ids(team1_ids, team_roster)
                opp_ids = _expand_side_player_ids(team2_ids, team_roster)
                played = True
            elif in_team2:
                side_ids = _expand_side_player_ids(team2_ids, team_roster)
                opp_ids = _expand_side_player_ids(team1_ids, team_roster)
                played = True
            else:
                side_ids = []
                opp_ids = []

            if played:
                for partner_id in side_ids:
                    if partner_id != player_id and partner_id not in partners:
                        partners.append(partner_id)
                for opponent_id in opp_ids:
                    if opponent_id != player_id and opponent_id not in opponents:
                        opponents.append(opponent_id)

        rank_map, points_map = _group_rank_and_points_for_round(group, round_number)
        label = f"Group {getattr(group, 'name', '')} R{round_number}".strip()
        rows.append(
            PlayerPathRound(
                round_number=round_number,
                round_label=label,
                cumulative_points=int(points_map.get(canonical_id, 0)),
                rank=rank_map.get(canonical_id),
                total_players=len(cohort_ids),
                partners=_names_from_ids(partners, name_map),
                opponents=_names_from_ids(opponents, name_map),
                played=played,
            )
        )

    return rows


def _match_credit_for_pid(tournament: object, match: object, pid: str, fallback: int) -> int:
    """Resolve a player's credited points for a match from stored credit breakdowns."""
    credits = getattr(tournament, "_match_credits", None) or {}
    entry = (credits.get(getattr(match, "id", ""), {}) or {}).get(pid)
    if isinstance(entry, dict):
        return int(round(float(entry.get("final", entry.get("raw", fallback)))))
    if isinstance(entry, (int, float)):
        return int(round(float(entry)))
    return fallback


def _match_raw_for_pid(tournament: object, match: object, pid: str, fallback: int) -> int:
    """Resolve a player's raw (pre-modifier) points for a match."""
    credits = getattr(tournament, "_match_credits", None) or {}
    entry = (credits.get(getattr(match, "id", ""), {}) or {}).get(pid)
    if isinstance(entry, dict):
        return int(round(float(entry.get("raw", fallback))))
    if isinstance(entry, (int, float)):
        return fallback
    return fallback


def _mex_buchholz(raw_by_id: dict[str, int], opp_counts: dict[str, dict[str, int]], pid: str) -> float:
    """Compute Buchholz tie-break the same way as Mexicano leaderboard."""
    total = 0.0
    for opp_id, count in (opp_counts.get(pid, {}) or {}).items():
        if count > 0:
            total += float(raw_by_id.get(opp_id, 0)) * float(count)
    return total


def _mex_rank_order_exact(
    points_by_id: dict[str, int],
    raw_by_id: dict[str, int],
    played_by_id: dict[str, int],
    opp_counts: dict[str, dict[str, int]],
    cohort_ids: list[str],
) -> list[str]:
    """Return Mexicano rank order with exact leaderboard tie-break criteria."""
    played_counts = {played_by_id.get(pid, 0) for pid in cohort_ids}
    ranked_by_avg = len(played_counts) > 1

    def _avg(pid: str) -> float:
        played = played_by_id.get(pid, 0)
        if played <= 0:
            return 0.0
        return float(points_by_id.get(pid, 0)) / float(played)

    if ranked_by_avg:
        return sorted(
            cohort_ids,
            key=lambda pid: (
                -_avg(pid),
                -float(points_by_id.get(pid, 0)),
                -_mex_buchholz(raw_by_id, opp_counts, pid),
            ),
        )
    return sorted(
        cohort_ids,
        key=lambda pid: (
            -float(points_by_id.get(pid, 0)),
            -_avg(pid),
            -_mex_buchholz(raw_by_id, opp_counts, pid),
        ),
    )


def _build_mex_path_rows(tournament: object, player_id: str) -> list[PlayerPathRound]:
    """Build round-path rows for Mexicano rounds."""
    team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
    name_map = _member_name_map(tournament, team_roster)

    member_to_team: dict[str, str] = {}
    for team_id, members in team_roster.items():
        for member_id in members:
            member_to_team[member_id] = team_id
    canonical_id = member_to_team.get(player_id, player_id)

    cohort_ids = [getattr(p, "id", "") for p in getattr(tournament, "players", []) or []]
    if canonical_id not in cohort_ids:
        return []

    rounds = getattr(tournament, "rounds", []) or []
    points_by_id: dict[str, int] = defaultdict(int)
    raw_by_id: dict[str, int] = defaultdict(int)
    played_by_id: dict[str, int] = defaultdict(int)
    opp_counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    rows: list[PlayerPathRound] = []

    for idx, round_matches in enumerate(rounds, start=1):
        played = False
        partners: list[str] = []
        opponents: list[str] = []

        for match in round_matches:
            if not _is_completed_match(match):
                continue

            team1_ids = [getattr(p, "id", "") for p in getattr(match, "team1", []) or []]
            team2_ids = [getattr(p, "id", "") for p in getattr(match, "team2", []) or []]

            for pid in team1_ids:
                points_by_id[pid] += _match_credit_for_pid(tournament, match, pid, _side_score(match, True))
                raw_by_id[pid] += _match_raw_for_pid(tournament, match, pid, _side_score(match, True))
                played_by_id[pid] += 1
            for pid in team2_ids:
                points_by_id[pid] += _match_credit_for_pid(tournament, match, pid, _side_score(match, False))
                raw_by_id[pid] += _match_raw_for_pid(tournament, match, pid, _side_score(match, False))
                played_by_id[pid] += 1

            for pid1 in team1_ids:
                for pid2 in team2_ids:
                    opp_counts[pid1][pid2] += 1
                    opp_counts[pid2][pid1] += 1

            in_team1 = canonical_id in team1_ids
            in_team2 = canonical_id in team2_ids
            if in_team1:
                side_ids = _expand_side_player_ids(team1_ids, team_roster)
                opp_ids = _expand_side_player_ids(team2_ids, team_roster)
                played = True
            elif in_team2:
                side_ids = _expand_side_player_ids(team2_ids, team_roster)
                opp_ids = _expand_side_player_ids(team1_ids, team_roster)
                played = True
            else:
                side_ids = []
                opp_ids = []

            if played:
                for partner_id in side_ids:
                    if partner_id != player_id and partner_id not in partners:
                        partners.append(partner_id)
                for opponent_id in opp_ids:
                    if opponent_id != player_id and opponent_id not in opponents:
                        opponents.append(opponent_id)

        ranked_ids = _mex_rank_order_exact(points_by_id, raw_by_id, played_by_id, opp_counts, cohort_ids)
        sample_match = round_matches[0] if round_matches else None
        label = getattr(sample_match, "round_label", "") if sample_match is not None else ""
        if not label:
            label = f"Round {idx}"
        rows.append(
            PlayerPathRound(
                round_number=idx,
                round_label=label,
                cumulative_points=int(points_by_id.get(canonical_id, 0)),
                rank=_rank_for_id(ranked_ids, canonical_id),
                total_players=len(cohort_ids),
                partners=_names_from_ids(partners, name_map),
                opponents=_names_from_ids(opponents, name_map),
                played=played,
            )
        )

    return rows


def _ensure_profile_owns_tournament_player(profile_id: str, entity_id: str, player_id: str) -> None:
    """Validate that a tournament participation belongs to the authenticated profile."""
    with get_db() as conn:
        active = conn.execute(
            """
            SELECT 1
            FROM player_secrets
            WHERE profile_id = ? AND tournament_id = ? AND player_id = ?
            LIMIT 1
            """,
            (profile_id, entity_id, player_id),
        ).fetchone()
        if active is not None:
            return

        history = conn.execute(
            """
            SELECT 1
            FROM player_history
            WHERE profile_id = ?
              AND entity_type = 'tournament'
              AND entity_id = ?
              AND player_id = ?
            LIMIT 1
            """,
            (profile_id, entity_id, player_id),
        ).fetchone()
        if history is not None:
            return

    raise HTTPException(404, "Participation not found")


def _get_tournament_version(entity_id: str) -> int | None:
    """Return persisted tournament version, or None when tournament row is missing."""
    with get_db() as conn:
        row = conn.execute("SELECT version FROM tournaments WHERE id = ?", (entity_id,)).fetchone()
    if row is None:
        return None
    return int(row["version"] or 0)


def _get_cached_tournament_path(
    profile_id: str,
    entity_id: str,
    player_id: str,
    tournament_version: int | None,
) -> tuple[TournamentPathResponse | None, int | None]:
    """Return cached path payload and its stored version when valid."""
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT tournament_version, payload
            FROM player_tournament_path_cache
            WHERE profile_id = ? AND entity_id = ? AND player_id = ?
            """,
            (profile_id, entity_id, player_id),
        ).fetchone()

    if row is None:
        return None, None

    cached_version = int(row["tournament_version"] or -1)
    if tournament_version is not None and cached_version != tournament_version:
        return None, cached_version

    try:
        raw = json.loads(row["payload"])
    except Exception:  # noqa: BLE001
        return None, cached_version

    if not isinstance(raw, dict):
        return None, cached_version

    rounds_raw = raw.get("rounds") if isinstance(raw.get("rounds"), list) else []
    rounds: list[PlayerPathRound] = []
    for rr in rounds_raw:
        if not isinstance(rr, dict):
            continue
        try:
            rounds.append(PlayerPathRound.model_validate(rr))
        except Exception:  # noqa: BLE001
            continue

    payload = TournamentPathResponse(
        entity_id=str(raw.get("entity_id") or entity_id),
        player_id=str(raw.get("player_id") or player_id),
        tournament_type=raw.get("tournament_type"),
        available=bool(raw.get("available", True)),
        reason=raw.get("reason"),
        rounds=rounds,
    )
    return payload, cached_version


def _save_cached_tournament_path(
    profile_id: str,
    entity_id: str,
    player_id: str,
    tournament_version: int | None,
    payload: TournamentPathResponse,
) -> None:
    """Upsert cached path payload for a profile/tournament/player tuple."""
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO player_tournament_path_cache
                (profile_id, entity_id, player_id, tournament_version, payload, updated_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
            ON CONFLICT(profile_id, entity_id, player_id) DO UPDATE SET
                tournament_version = excluded.tournament_version,
                payload = excluded.payload,
                updated_at = excluded.updated_at
            """,
            (
                profile_id,
                entity_id,
                player_id,
                int(tournament_version) if tournament_version is not None else -1,
                json.dumps(payload.model_dump()),
            ),
        )


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


@router.post("/resolve", response_model=PassphraseResolveResponse)
async def resolve_profile_passphrase(req: PassphraseResolveRequest, request: Request) -> PassphraseResolveResponse:
    """Resolve a passphrase to determine if it belongs to a hub profile or a tournament/registration.

    This is a read-only discovery endpoint: it does not create sessions or return JWTs.
    """
    _RATE_LIMITER.check(_client_ip(request), "Too many requests \u2014 try again later")
    clean = req.passphrase.strip()
    result = resolve_passphrase(clean)
    matches = [ParticipationMatch(**m) for m in result.get("matches", [])]
    return PassphraseResolveResponse(type=result["type"], matches=matches)


@router.post("", response_model=PlayerSpaceResponse)
async def create_profile(req: ProfileCreateRequest, request: Request) -> PlayerSpaceResponse:
    """Create a new Player Hub profile.

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
            """
            INSERT INTO player_profiles (id, passphrase, name, email, email_verified_at, contact, created_at)
            VALUES (?, ?, ?, ?, NULL, ?, ?)
            """,
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

    profile_dict = {
        "id": profile_id,
        "passphrase": passphrase,
        "name": clean_name,
        "email": clean_email,
        "created_at": now,
    }
    profile_out = _row_to_profile_out(profile_dict)
    token = create_profile_token(profile_id)

    _send_email_verification(
        profile_id=profile_id,
        email=clean_email,
        name=clean_name,
        passphrase=passphrase,
        access_token=token,
    )

    _backfill_history_for_profile(profile_id)
    _backfill_finished_secrets(profile_id)
    active = _build_active_entries(profile_id)
    history = _build_history_entries(profile_id)

    return PlayerSpaceResponse(
        profile=profile_out,
        access_token=token,
        entries=_deduplicate_entries(active + history),
    )


@router.post("/verify-email")
async def verify_profile_email(req: VerifyEmailRequest) -> dict:
    """Verify a profile email using a one-click token delivered by email."""
    decoded = decode_profile_email_verify_token(req.token.strip())
    if decoded is None:
        raise HTTPException(400, "Invalid or expired verification token")

    profile_id, email = decoded
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT id, email
              FROM player_profiles
             WHERE id = ?
            """,
            (profile_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(404, "Profile not found")
        if (row["email"] or "").strip().lower() != email:
            raise HTTPException(400, "Verification token does not match current profile email")
        conn.execute("UPDATE player_profiles SET email_verified_at = ? WHERE id = ?", (now, profile_id))

    _link_email_participations(profile_id, email)
    return {"ok": True}


@router.post("/resend-verification")
async def resend_profile_email_verification(
    request: Request,
    identity: ProfileIdentity | None = Depends(get_current_profile),
) -> dict:
    """Resend email verification link for the authenticated profile."""
    if identity is None:
        raise HTTPException(401, "Profile authentication required")

    _RECOVER_RATE_LIMITER.check(_client_ip(request), "Too many verification emails — try again in 15 minutes")
    _RECOVER_RATE_LIMITER.record(_client_ip(request))

    with get_db() as conn:
        row = conn.execute(
            """
            SELECT id, passphrase, name, email, email_verified_at
              FROM player_profiles
             WHERE id = ?
            """,
            (identity.profile_id,),
        ).fetchone()

    if row is None:
        raise HTTPException(404, "Profile not found")

    email = (row["email"] or "").strip()
    if not email or not is_valid_email(email):
        return {"ok": True, "already_verified": False}

    if row["email_verified_at"]:
        return {"ok": True, "already_verified": True}

    _send_email_verification(
        profile_id=row["id"],
        email=email,
        name=row["name"] or "",
        passphrase=row["passphrase"] or "",
    )
    return {"ok": True, "already_verified": False}


@router.post("/login", response_model=ProfileLoginResponse)
async def login_profile(req: ProfileLoginRequest, request: Request) -> ProfileLoginResponse:
    """Authenticate to the Player Hub with the 3-word global passphrase.

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
            """
                        SELECT id, passphrase, name, email
                            FROM player_profiles
                         WHERE LOWER(email) = LOWER(?)
                             AND email_verified_at IS NOT NULL
                        """,
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
    """Return the full Player Hub dashboard for the authenticated profile.

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


@router.get("/tournament-path/{entity_id}/{player_id}", response_model=TournamentPathResponse)
async def get_tournament_path(
    entity_id: str,
    player_id: str,
    identity: ProfileIdentity | None = Depends(get_current_profile),
) -> TournamentPathResponse:
    """Return round-by-round path data for one player in one tournament."""
    if identity is None:
        raise HTTPException(401, "Profile authentication required")

    _ensure_profile_owns_tournament_player(identity.profile_id, entity_id, player_id)

    tournament_version = _get_tournament_version(entity_id)
    mem_key = (identity.profile_id, entity_id, player_id, tournament_version)
    cached_mem = _PATH_CACHE_MEM.get(mem_key)
    if cached_mem is not None:
        return cached_mem

    cached, _cached_version = _get_cached_tournament_path(
        identity.profile_id,
        entity_id,
        player_id,
        tournament_version,
    )
    if cached is not None:
        _PATH_CACHE_MEM[mem_key] = cached
        return cached

    t_data = get_tournament_data(entity_id)
    if t_data is None:
        return TournamentPathResponse(
            entity_id=entity_id,
            player_id=player_id,
            tournament_type=None,
            available=False,
            reason="tournament_unavailable",
            rounds=[],
        )

    t_type = t_data.get("type")
    tournament = t_data.get("tournament")
    if t_type not in {"group_playoff", "mexicano"}:
        raise HTTPException(400, "Path is available only for Group+Playoff and Mexicano tournaments")

    if t_type == "group_playoff":
        rows = _build_group_path_rows(tournament, player_id)
    else:
        rows = _build_mex_path_rows(tournament, player_id)

    response = TournamentPathResponse(
        entity_id=entity_id,
        player_id=player_id,
        tournament_type=t_type,
        available=True,
        reason=None,
        rounds=rows,
    )
    _PATH_CACHE_MEM[mem_key] = response
    _save_cached_tournament_path(identity.profile_id, entity_id, player_id, tournament_version, response)
    return response


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
    if new_email and not is_valid_email(new_email):
        raise HTTPException(422, "A valid email address is required")

    with get_db() as conn:
        current = conn.execute(
            "SELECT email, passphrase, name FROM player_profiles WHERE id = ?", (identity.profile_id,)
        ).fetchone()
        if current is None:
            raise HTTPException(404, "Profile not found")
        email_changed = (current["email"] or "").strip().lower() != new_email.lower()
        cur = conn.execute(
            """
            UPDATE player_profiles
               SET name = ?,
                   email = ?,
                   email_verified_at = CASE WHEN ? THEN NULL ELSE email_verified_at END,
                   contact = ?
             WHERE id = ?
            """,
            (req.name.strip(), new_email, 1 if email_changed else 0, new_contact, identity.profile_id),
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
            "SELECT id, passphrase, name, email, email_verified_at, contact, created_at FROM player_profiles WHERE id = ?",
            (identity.profile_id,),
        ).fetchone()

    if email_changed and new_email:
        _send_email_verification(
            profile_id=identity.profile_id,
            email=new_email,
            name=req.name.strip() or (current["name"] or ""),
            passphrase=current["passphrase"] or "",
        )

    return _row_to_profile_out(dict(row))


@router.delete("/unlink")
async def unlink_participation(
    req: ProfileUnlinkRequest,
    identity: ProfileIdentity | None = Depends(get_current_profile),
) -> dict:
    """Unlink a tournament participation from the authenticated player's profile.

    For **active** tournaments the ``profile_id`` is simply set to NULL on
    the ``player_secrets`` row — the player can re-link later using their
    passphrase.

    For **finished** tournaments the ``player_history`` row is deleted,
    permanently removing the stats from the player's hub.  A warning is
    included in the response so the frontend can surface it.
    """
    if identity is None:
        raise HTTPException(401, "Profile authentication required")

    pid = identity.profile_id

    with get_db() as conn:
        # Try active first (player_secrets row still present).
        row = conn.execute(
            "SELECT profile_id, finished_at FROM player_secrets WHERE tournament_id = ? AND profile_id = ?",
            (req.entity_id, pid),
        ).fetchone()

        if row is not None:
            if row["finished_at"] is None:
                # Active tournament — just clear the link.
                conn.execute(
                    "UPDATE player_secrets SET profile_id = NULL WHERE tournament_id = ? AND profile_id = ?",
                    (req.entity_id, pid),
                )
                bump_tournament_version(req.entity_id)
                return {"ok": True, "status": "active", "warning": None}
            else:
                # Finished but player_secrets row still exists.
                conn.execute(
                    "UPDATE player_secrets SET profile_id = NULL WHERE tournament_id = ? AND profile_id = ?",
                    (req.entity_id, pid),
                )
                conn.execute(
                    "DELETE FROM player_history WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                    (pid, req.entity_id),
                )
                bump_tournament_version(req.entity_id)
                return {
                    "ok": True,
                    "status": "finished",
                    "warning": "Stats have been permanently removed from your hub.",
                }

        # No player_secrets row — check player_history directly.
        hist = conn.execute(
            "SELECT 1 FROM player_history WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
            (pid, req.entity_id),
        ).fetchone()
        if hist is not None:
            conn.execute(
                "DELETE FROM player_history WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                (pid, req.entity_id),
            )
            return {
                "ok": True,
                "status": "finished",
                "warning": "Stats have been permanently removed from your hub.",
            }

    raise HTTPException(404, "Participation not found")


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
    Player Hub dashboard.
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
