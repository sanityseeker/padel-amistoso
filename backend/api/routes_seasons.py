"""Season management routes.

A Season is a named grouping of tournaments within a Club.  Seasons provide
cumulative standings based on ELO progression and best results across the
season's tournaments.

Seasons have no date ranges — they are just named tags that can be active
or archived.  Tournaments are manually assigned to seasons.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth.deps import get_current_user
from ..auth.models import User
from .db import get_db
from .routes_clubs import _get_club, _require_club_admin
from .state import _tournaments

router = APIRouter(tags=["seasons"])

_ID_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"
_ID_LEN = 8


def _generate_season_id() -> str:
    """Return a short random season ID like ``sn_8k3w9q2h``."""
    suffix = "".join(secrets.choice(_ID_ALPHABET) for _ in range(_ID_LEN))
    return f"sn_{suffix}"


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------


class SeasonCreate(BaseModel):
    """Request body for creating a season."""

    name: str = Field(min_length=1, max_length=100)


class SeasonUpdate(BaseModel):
    """Request body for updating a season."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    active: bool | None = None


class SeasonOut(BaseModel):
    """Public representation of a season."""

    id: str
    club_id: str
    name: str
    active: bool
    created_at: str


class SeasonStandingEntry(BaseModel):
    """A single player's aggregated stats across a season for one sport."""

    player_name: str
    profile_id: str | None = None
    elo_start: float | None = None
    elo_end: float | None = None
    elo_change: float | None = None
    matches_played: int = 0
    best_rank: int | None = None
    best_rank_tournament_name: str | None = None
    best_rank_total_players: int | None = None
    tournaments_played: int = 0


class SeasonStandingsResponse(BaseModel):
    """Season standings split by sport."""

    padel: list[SeasonStandingEntry] = []
    tennis: list[SeasonStandingEntry] = []


class SetSeasonRequest(BaseModel):
    """Assign a tournament or registration to a season (or remove)."""

    season_id: str | None = Field(default=None, max_length=64)


class SetClubRequest(BaseModel):
    """Assign a tournament or registration to a club directly (or remove)."""

    club_id: str | None = Field(default=None, max_length=64)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_season(season_id: str) -> dict:
    """Load a season row or raise 404."""
    with get_db() as conn:
        row = conn.execute("SELECT * FROM seasons WHERE id = ?", (season_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Season not found")
    return dict(row)


# ---------------------------------------------------------------------------
# Season CRUD (nested under /api/clubs/{club_id}/seasons)
# ---------------------------------------------------------------------------

club_seasons_router = APIRouter(prefix="/api/clubs/{club_id}/seasons", tags=["seasons"])


@club_seasons_router.get("", response_model=list[SeasonOut])
async def list_seasons(club_id: str) -> list[SeasonOut]:
    """List all seasons for a club.  Active seasons first, then archived."""
    _get_club(club_id)
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM seasons WHERE club_id = ? ORDER BY active DESC, created_at DESC",
            (club_id,),
        ).fetchall()
    return [
        SeasonOut(
            id=r["id"], club_id=r["club_id"], name=r["name"], active=bool(r["active"]), created_at=r["created_at"]
        )
        for r in rows
    ]


@club_seasons_router.post("", response_model=SeasonOut, status_code=201)
async def create_season(club_id: str, req: SeasonCreate, user: User = Depends(get_current_user)) -> SeasonOut:
    """Create a new season for a club."""
    club = _get_club(club_id)
    _require_club_admin(club, user)
    season_id = _generate_season_id()
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO seasons (id, club_id, name, active, created_at) VALUES (?, ?, ?, 1, ?)",
            (season_id, club_id, req.name.strip(), now),
        )
    return SeasonOut(id=season_id, club_id=club_id, name=req.name.strip(), active=True, created_at=now)


# ---------------------------------------------------------------------------
# Season operations (flat /api/seasons/{season_id})
# ---------------------------------------------------------------------------


@router.patch("/api/seasons/{season_id}", response_model=SeasonOut)
async def update_season(season_id: str, req: SeasonUpdate, user: User = Depends(get_current_user)) -> SeasonOut:
    """Update a season's name or active status.

    Archiving (active 1→0) snapshots the live standings into ``frozen_standings``
    so the standings shown for an archived season never change again, even if
    new matches are added retroactively to its tournaments.  Re-activating
    (active 0→1) clears the snapshot so standings go back to live aggregation.
    """
    season = _get_season(season_id)
    club = _get_club(season["club_id"])
    _require_club_admin(club, user)
    was_active = bool(season["active"])
    with get_db() as conn:
        updates: list[str] = []
        params: list = []
        if req.name is not None:
            updates.append("name = ?")
            params.append(req.name.strip())
        if req.active is not None and req.active != was_active:
            updates.append("active = ?")
            params.append(int(req.active))
            if was_active and not req.active:
                # Archiving: snapshot live standings.
                snapshot = _compute_live_standings(season_id)
                updates.append("frozen_standings = ?")
                params.append(snapshot.model_dump_json())
                updates.append("archived_at = ?")
                params.append(datetime.now(timezone.utc).isoformat())
            else:
                # Re-activating: drop snapshot, go back to live.
                updates.append("frozen_standings = ?")
                params.append(None)
                updates.append("archived_at = ?")
                params.append(None)
        if updates:
            params.append(season_id)
            conn.execute(f"UPDATE seasons SET {', '.join(updates)} WHERE id = ?", params)
        row = conn.execute("SELECT * FROM seasons WHERE id = ?", (season_id,)).fetchone()
    return SeasonOut(
        id=row["id"], club_id=row["club_id"], name=row["name"], active=bool(row["active"]), created_at=row["created_at"]
    )


@router.delete("/api/seasons/{season_id}")
async def delete_season(season_id: str, user: User = Depends(get_current_user)) -> dict:
    """Delete a season.  Nullifies season_id on affected tournaments/registrations."""
    season = _get_season(season_id)
    club = _get_club(season["club_id"])
    _require_club_admin(club, user)
    with get_db() as conn:
        conn.execute("UPDATE tournaments SET season_id = NULL WHERE season_id = ?", (season_id,))
        conn.execute("UPDATE registrations SET season_id = NULL WHERE season_id = ?", (season_id,))
        conn.execute("DELETE FROM seasons WHERE id = ?", (season_id,))
    # Sync in-memory tournament state
    for data in _tournaments.values():
        if data.get("season_id") == season_id:
            data["season_id"] = None
    return {"ok": True}


# ---------------------------------------------------------------------------
# Tournament / registration season assignment
# ---------------------------------------------------------------------------


@router.patch("/api/tournaments/{tid}/season")
async def set_tournament_season(tid: str, req: SetSeasonRequest, user: User = Depends(get_current_user)) -> dict:
    """Assign a tournament to a season (or remove from one).

    Validates that the tournament's community matches the season's club community.
    """
    from .helpers import _require_editor_access  # noqa: PLC0415
    from . import state  # noqa: PLC0415

    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")

        if req.season_id is not None:
            season = _get_season(req.season_id)
            if not season["active"]:
                raise HTTPException(
                    400,
                    "Cannot assign a tournament to an archived season. Re-activate the season first.",
                )
            club = _get_club(season["club_id"])
            tournament_community = _tournaments[tid].get("community_id", "open")
            if club["community_id"] != tournament_community:
                raise HTTPException(
                    400,
                    f"Tournament belongs to community '{tournament_community}' but the season belongs to community '{club['community_id']}'",
                )
            new_club_id = season["club_id"]
        else:
            new_club_id = _tournaments[tid].get("club_id")

        _tournaments[tid]["season_id"] = req.season_id
        _tournaments[tid]["club_id"] = new_club_id
        from .state import _save_tournament  # noqa: PLC0415

        _save_tournament(tid)
    return {"ok": True, "season_id": req.season_id, "club_id": new_club_id}


@router.patch("/api/registrations/{rid}/season")
async def set_registration_season(rid: str, req: SetSeasonRequest, user: User = Depends(get_current_user)) -> dict:
    """Assign a registration to a season (or remove from one)."""
    from .routes_registration import _get_registration, _require_registration_editor  # noqa: PLC0415

    registration = _get_registration(rid)
    _require_registration_editor(registration, user)

    if req.season_id is not None:
        season = _get_season(req.season_id)
        if not season["active"]:
            raise HTTPException(
                400,
                "Cannot assign a registration to an archived season. Re-activate the season first.",
            )
        club = _get_club(season["club_id"])
        reg_community = registration.get("community_id", "open")
        if club["community_id"] != reg_community:
            raise HTTPException(
                400,
                f"Registration belongs to community '{reg_community}' but the season belongs to community '{club['community_id']}'",
            )
        new_club_id = season["club_id"]
    else:
        new_club_id = registration.get("club_id")

    with get_db() as conn:
        conn.execute(
            "UPDATE registrations SET season_id = ?, club_id = ? WHERE id = ?",
            (req.season_id, new_club_id, registration["id"]),
        )
    return {"ok": True, "season_id": req.season_id, "club_id": new_club_id}


# ---------------------------------------------------------------------------
# Direct club assignment (independent from seasons)
# ---------------------------------------------------------------------------


@router.patch("/api/tournaments/{tid}/club")
async def set_tournament_club(tid: str, req: SetClubRequest, user: User = Depends(get_current_user)) -> dict:
    """Assign a tournament directly to a club (or remove from one).

    Tournaments belong to a club first; seasons are an optional sub-grouping.
    Validates that the tournament's community matches the club's community.
    Clears ``season_id`` if it pointed to a different club.
    """
    from .helpers import _require_editor_access  # noqa: PLC0415
    from . import state  # noqa: PLC0415

    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")

        if req.club_id is not None:
            club = _get_club(req.club_id)
            tournament_community = _tournaments[tid].get("community_id", "open")
            if club["community_id"] != tournament_community:
                raise HTTPException(
                    400,
                    f"Tournament belongs to community '{tournament_community}' but the club belongs to community '{club['community_id']}'",
                )

        # Clear season_id if it no longer matches the new club
        existing_season_id = _tournaments[tid].get("season_id")
        if existing_season_id:
            season = _get_season(existing_season_id)
            if season["club_id"] != req.club_id:
                _tournaments[tid]["season_id"] = None

        _tournaments[tid]["club_id"] = req.club_id
        from .state import _save_tournament  # noqa: PLC0415

        _save_tournament(tid)
    return {"ok": True, "club_id": req.club_id, "season_id": _tournaments[tid].get("season_id")}


@router.patch("/api/registrations/{rid}/club")
async def set_registration_club(rid: str, req: SetClubRequest, user: User = Depends(get_current_user)) -> dict:
    """Assign a registration directly to a club (or remove from one)."""
    from .routes_registration import _get_registration, _require_registration_editor  # noqa: PLC0415

    registration = _get_registration(rid)
    _require_registration_editor(registration, user)

    if req.club_id is not None:
        club = _get_club(req.club_id)
        reg_community = registration.get("community_id", "open")
        if club["community_id"] != reg_community:
            raise HTTPException(
                400,
                f"Registration belongs to community '{reg_community}' but the club belongs to community '{club['community_id']}'",
            )

    # Clear season_id if no longer matches
    new_season_id = registration.get("season_id")
    if new_season_id:
        season = _get_season(new_season_id)
        if season["club_id"] != req.club_id:
            new_season_id = None

    with get_db() as conn:
        conn.execute(
            "UPDATE registrations SET club_id = ?, season_id = ? WHERE id = ?",
            (req.club_id, new_season_id, registration["id"]),
        )
    return {"ok": True, "club_id": req.club_id, "season_id": new_season_id}


# ---------------------------------------------------------------------------
# Season standings
# ---------------------------------------------------------------------------


@router.get("/api/seasons/{season_id}/standings", response_model=SeasonStandingsResponse)
async def get_season_standings(season_id: str) -> SeasonStandingsResponse:
    """Cumulative standings for a season, split by sport.

    For archived seasons returns the frozen snapshot taken at archive time.
    For active seasons aggregates ELO progression (from ``player_elo_log``)
    and best results (from ``player_history``) live across all tournaments
    assigned to the season.  Returns separate lists for padel and tennis.
    """
    season = _get_season(season_id)
    if season.get("frozen_standings"):
        try:
            return SeasonStandingsResponse.model_validate_json(season["frozen_standings"])
        except Exception:  # noqa: BLE001 — fall back to live aggregation if snapshot is corrupt
            pass
    return _compute_live_standings(season_id)


def _compute_live_standings(season_id: str) -> SeasonStandingsResponse:
    """Live aggregation of season standings from `player_elo_log` + `player_history`."""
    season = _get_season(season_id)
    club = _get_club(season["club_id"])
    community_id = club["community_id"]  # noqa: F841

    with get_db() as conn:
        season_tids = [
            r["id"] for r in conn.execute("SELECT id FROM tournaments WHERE season_id = ?", (season_id,)).fetchall()
        ]
        if not season_tids:
            return SeasonStandingsResponse()

        placeholders = ",".join("?" for _ in season_tids)

        elo_rows = conn.execute(
            f"""SELECT player_id, sport, elo_before, elo_after, elo_delta, match_order, tournament_id
                FROM player_elo_log
                WHERE tournament_id IN ({placeholders})
                ORDER BY updated_at ASC, match_order ASC""",
            season_tids,
        ).fetchall()

        history_rows = conn.execute(
            f"""SELECT ph.profile_id, ph.player_name, ph.entity_id, ph.entity_name,
                       ph.rank, ph.total_players, ph.sport
                FROM player_history ph
                WHERE ph.entity_id IN ({placeholders})
                  AND ph.entity_type = 'tournament'
                  AND ph.finished_at != ''""",
            season_tids,
        ).fetchall()

    # Resolve player_id → profile_id mapping
    all_player_ids = {r["player_id"] for r in elo_rows}
    profile_for_player: dict[str, str] = {}
    if all_player_ids:
        with get_db() as conn:
            ph = ",".join("?" for _ in all_player_ids)
            rows = conn.execute(
                f"SELECT player_id, profile_id FROM player_secrets WHERE profile_id IS NOT NULL AND player_id IN ({ph})",
                list(all_player_ids),
            ).fetchall()
            for r in rows:
                profile_for_player[r["player_id"]] = r["profile_id"]
            remaining = all_player_ids - set(profile_for_player.keys())
            if remaining:
                ph2 = ",".join("?" for _ in remaining)
                rows2 = conn.execute(
                    f"SELECT player_id, profile_id FROM player_history WHERE profile_id IS NOT NULL AND player_id IN ({ph2})",
                    list(remaining),
                ).fetchall()
                for r in rows2:
                    if r["player_id"] not in profile_for_player:
                        profile_for_player[r["player_id"]] = r["profile_id"]

    padel_entries = _aggregate_standings(
        [r for r in elo_rows if r["sport"] == "padel"],
        [r for r in history_rows if r["sport"] == "padel"],
        profile_for_player,
    )
    tennis_entries = _aggregate_standings(
        [r for r in elo_rows if r["sport"] == "tennis"],
        [r for r in history_rows if r["sport"] == "tennis"],
        profile_for_player,
    )
    return SeasonStandingsResponse(padel=padel_entries, tennis=tennis_entries)


def _aggregate_standings(
    elo_rows: list,
    history_rows: list,
    profile_for_player: dict[str, str],
) -> list[SeasonStandingEntry]:
    """Aggregate ELO and history rows for a single sport into sorted standings.

    ``elo_rows`` must already be ordered chronologically (oldest first).
    Profiles linked to multiple ``player_id``s have their ``elo_start`` and
    ``elo_end`` resolved by global temporal ordering across all of their ids,
    not by dict iteration order.
    """
    # Per player_id state, plus the chronological ordinal of the first/last
    # event so we can merge multiple player_ids into one profile correctly.
    player_elo_data: dict[str, dict] = {}
    for ordinal, r in enumerate(elo_rows):
        pid = r["player_id"]
        if pid not in player_elo_data:
            player_elo_data[pid] = {
                "elo_start": r["elo_before"],
                "elo_end": r["elo_after"],
                "start_ord": ordinal,
                "end_ord": ordinal,
                "total_delta": 0.0,
                "matches": 0,
            }
        entry = player_elo_data[pid]
        entry["elo_end"] = r["elo_after"]
        entry["end_ord"] = ordinal
        entry["total_delta"] += r["elo_delta"]
        entry["matches"] += 1

    profile_data: dict[str, dict] = {}
    for r in history_rows:
        pid = r["profile_id"]
        if pid not in profile_data:
            profile_data[pid] = {
                "player_name": r["player_name"],
                "profile_id": pid,
                "best_rank": None,
                "best_rank_tournament_name": None,
                "best_rank_total_players": None,
                "tournaments_played": 0,
                "tournament_ids": set(),
            }
        entry = profile_data[pid]
        tid = r["entity_id"]
        if tid not in entry["tournament_ids"]:
            entry["tournament_ids"].add(tid)
            entry["tournaments_played"] += 1
        rank = r["rank"]
        if rank is not None and (entry["best_rank"] is None or rank < entry["best_rank"]):
            entry["best_rank"] = rank
            entry["best_rank_tournament_name"] = r["entity_name"]
            entry["best_rank_total_players"] = r["total_players"]

    for player_id, elo_info in player_elo_data.items():
        pid = profile_for_player.get(player_id)
        if not pid:
            continue
        if pid not in profile_data:
            with get_db() as conn:
                name_row = conn.execute("SELECT name FROM player_profiles WHERE id = ?", (pid,)).fetchone()
            profile_data[pid] = {
                "player_name": name_row["name"] if name_row else f"Player {player_id}",
                "profile_id": pid,
                "best_rank": None,
                "best_rank_tournament_name": None,
                "best_rank_total_players": None,
                "tournaments_played": 0,
                "tournament_ids": set(),
            }
        entry = profile_data[pid]
        if "_start_ord" not in entry:
            entry["_start_ord"] = elo_info["start_ord"]
            entry["elo_start"] = elo_info["elo_start"]
            entry["_end_ord"] = elo_info["end_ord"]
            entry["elo_end"] = elo_info["elo_end"]
            entry["elo_change"] = round(elo_info["total_delta"], 1)
            entry["matches_played"] = elo_info["matches"]
        else:
            if elo_info["start_ord"] < entry["_start_ord"]:
                entry["_start_ord"] = elo_info["start_ord"]
                entry["elo_start"] = elo_info["elo_start"]
            if elo_info["end_ord"] > entry["_end_ord"]:
                entry["_end_ord"] = elo_info["end_ord"]
                entry["elo_end"] = elo_info["elo_end"]
            entry["matches_played"] = entry.get("matches_played", 0) + elo_info["matches"]
            entry["elo_change"] = round(entry.get("elo_change", 0) + elo_info["total_delta"], 1)

    result: list[SeasonStandingEntry] = []
    for pid, data in profile_data.items():
        result.append(
            SeasonStandingEntry(
                player_name=data["player_name"],
                profile_id=data["profile_id"],
                elo_start=round(data["elo_start"], 1) if data.get("elo_start") is not None else None,
                elo_end=round(data["elo_end"], 1) if data.get("elo_end") is not None else None,
                elo_change=data.get("elo_change"),
                matches_played=data.get("matches_played", 0),
                best_rank=data.get("best_rank"),
                best_rank_tournament_name=data.get("best_rank_tournament_name"),
                best_rank_total_players=data.get("best_rank_total_players"),
                tournaments_played=data.get("tournaments_played", 0),
            )
        )
    result.sort(key=lambda x: x.elo_end or 0, reverse=True)
    return result
