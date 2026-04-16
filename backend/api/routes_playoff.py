"""
Standalone Play-off tournament routes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from .rate_limit import BoundedRateLimiter
from ..auth.deps import get_current_user, get_current_user_optional, get_current_player, PlayerIdentity
from ..auth.models import User
from ..models import Court, Player, TournamentType, EliminationType
from ..tournaments import PlayoffTournament
from ..viz import render_playoff_schema
from .helpers import (
    _build_match_labels,
    _get_tournament,
    _is_bye_match,
    _require_score_permission,
    _find_match,
    _schema_cache_get,
    _schema_cache_key,
    _schema_cache_put,
    _schema_image_response,
    _serialize_match,
    _tennis_sets_to_scores,
    _store_tournament,
    _apply_player_score_metadata,
    _mark_admin_score,
)
from .schemas import CreatePlayoffRequest, RecordScoreRequest, RecordTennisScoreRequest
from .state import allocate_tournament_id, _save_tournament, _tournament_versions, get_tournament_lock
from .player_secret_store import create_secrets_for_tournament
from .push_events import notify_champion
from .elo_integration import elo_after_score, elo_finish_tournament, elo_init_tournament

router = APIRouter(prefix="/api/tournaments", tags=["playoff"])

_PO = TournamentType.PLAYOFF.value

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


@router.post("/playoff")
async def create_playoff(req: CreatePlayoffRequest, request: Request, user=Depends(get_current_user)) -> dict:
    """Create a new standalone Play-off tournament and seed the bracket immediately."""
    client_ip = _client_ip(request)
    _create_rate_limiter.check(client_ip, "Too many tournament creation attempts — try again later")
    _create_rate_limiter.record(client_ip)
    courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []

    # Build initial_strength mapping keyed by player id
    initial_strength: dict[str, float] | None = None

    if req.teams and req.team_mode:
        # Composite teams: each entry in req.teams is a list of member names
        individual_players = [Player(name=n) for n in req.participant_names]
        name_to_player = {p.name: p for p in individual_players}
        if req.player_strengths:
            initial_strength = {
                name_to_player[name].id: score for name, score in req.player_strengths.items() if name in name_to_player
            } or None
        teams: list[list[Player]] = []
        for member_names in req.teams:
            team_members = [name_to_player[n] for n in member_names if n in name_to_player]
            teams.append(team_members)
        all_players = individual_players
    else:
        # Each participant name becomes a single-entry team in the bracket.
        teams = [[Player(name=n)] for n in req.participant_names]
        all_players = [p for team in teams for p in team]
        if req.player_strengths:
            name_to_id = {team[0].name: team[0].id for team in teams}
            initial_strength = {
                name_to_id[name]: score for name, score in req.player_strengths.items() if name in name_to_id
            } or None

    t = PlayoffTournament(
        teams=teams,
        courts=courts,
        double_elimination=req.double_elimination,
        team_mode=req.team_mode,
        initial_strength=initial_strength,
    )

    tid = await allocate_tournament_id()
    _store_tournament(
        tid,
        name=req.name,
        tournament_type=TournamentType.PLAYOFF.value,
        tournament=t,
        owner=user.username,
        public=req.public,
        sport=req.sport.value,
        assign_courts=req.assign_courts,
    )
    # Create secrets for individual players (each member gets their own passphrase)
    contact_map = {p.id: req.player_contacts[p.name] for p in all_players if p.name in req.player_contacts} or None
    email_map = {p.id: req.player_emails[p.name] for p in all_players if p.name in req.player_emails} or None
    pid_map = {p.id: req.player_profile_ids[p.name] for p in all_players if p.name in req.player_profile_ids} or None
    create_secrets_for_tournament(
        tid,
        [{"id": p.id, "name": p.name} for p in all_players],
        contacts=contact_map,
        emails=email_map,
        profile_ids=pid_map,
    )
    elo_init_tournament(tid, [p.id for p in all_players], req.sport.value)
    return {"id": tid, "phase": t.phase}


@router.get("/{tid}/po/status")
async def po_status(tid: str) -> dict:
    """Return high-level status (phase, champion, bracket type) for a standalone Play-off tournament."""
    data = _get_tournament(tid, _PO)
    t: PlayoffTournament = data["tournament"]
    return {
        "phase": t.phase,
        "team_mode": t.team_mode,
        "double_elimination": t.double_elimination,
        "assign_courts": data.get("assign_courts", True),
        "champion": [p.name for p in t.champion()] if t.champion() else None,
        "sport": data.get("sport", "padel"),
    }


@router.get("/{tid}/po/playoffs")
async def po_playoffs(tid: str) -> dict:
    """Return all play-off matches, pending matches, and the champion (if decided)."""
    t: PlayoffTournament = _get_tournament(tid, _PO)["tournament"]
    return {
        "matches": [_serialize_match(m) for m in t.all_matches() if not _is_bye_match(m)],
        "pending": [_serialize_match(m) for m in t.pending_matches()],
        "champion": [p.name for p in t.champion()] if t.champion() else None,
    }


@router.get("/{tid}/po/playoffs-schema")
async def po_playoffs_schema(
    tid: str,
    title: str | None = Query(None),
    fmt: Literal["png", "svg", "pdf"] = Query("png"),
    box_scale: float = Query(1.0, ge=0.3, le=3.0),
    line_width: float = Query(1.0, ge=0.3, le=5.0),
    arrow_scale: float = Query(1.0, ge=0.3, le=5.0),
    title_font_scale: float = Query(1.0, ge=0.3, le=5.0),
    output_scale: float = Query(1.0, ge=0.5, le=3.0),
) -> Response:
    """Generate a schema image/document for the active Play-off bracket."""
    t: PlayoffTournament = _get_tournament(tid, _PO)["tournament"]
    participant_names = [" & ".join(p.name for p in team) for team in t.bracket.original_teams]
    if len(participant_names) < 2:
        raise HTTPException(400, "Need at least 2 participants for play-off schema")

    version = _tournament_versions.get(tid, 0)
    key = _schema_cache_key(
        "po",
        tid,
        version,
        tuple(participant_names),
        EliminationType.DOUBLE if t.double_elimination else EliminationType.SINGLE,
        title,
        fmt,
        box_scale,
        line_width,
        arrow_scale,
        title_font_scale,
        output_scale,
    )
    cached = _schema_cache_get(key)
    if cached:
        return _schema_image_response(cached[0], cached[1], etag=key[:16])

    img = render_playoff_schema(
        participant_names=participant_names,
        elimination=EliminationType.DOUBLE if t.double_elimination else EliminationType.SINGLE,
        match_labels=_build_match_labels(t.bracket),
        title=title,
        fmt=fmt,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
        title_font_scale=title_font_scale,
        output_scale=output_scale,
    )
    _schema_cache_put(key, img, fmt)
    return _schema_image_response(img, fmt, etag=key[:16])


@router.post("/{tid}/po/record")
async def po_record(
    tid: str,
    req: RecordScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a raw-score result for a play-off match."""
    async with get_tournament_lock(tid):
        data = _get_tournament(tid, _PO)
        t: PlayoffTournament = data["tournament"]
        match = _find_match(t, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        _require_score_permission(tid, match, user, player)
        try:
            t.record_result(req.match_id, (req.score1, req.score2))
        except (KeyError, RuntimeError, ValueError) as e:
            raise HTTPException(400, str(e))
        if player is not None and user is None:
            _apply_player_score_metadata(match, player.player_id, score=[req.score1, req.score2], confirmed=True)
        else:
            _mark_admin_score(match, user.username if user else None)
        _save_tournament(tid)
        elo_after_score(tid, data, match)
    champ = t.champion()
    if champ:
        elo_finish_tournament(tid)
        notify_champion(tid, data, [p.name for p in champ])
    return {"ok": True, "phase": t.phase}


@router.post("/{tid}/po/record-tennis")
async def po_record_tennis(
    tid: str,
    req: RecordTennisScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a play-off match using tennis-style set scores."""
    total1, total2, sets_tuples, _ = _tennis_sets_to_scores(req.sets)
    async with get_tournament_lock(tid):
        data = _get_tournament(tid, _PO)
        t: PlayoffTournament = data["tournament"]
        match = _find_match(t, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        _require_score_permission(tid, match, user, player)
        try:
            t.record_result(req.match_id, (total1, total2), sets=sets_tuples)
        except (KeyError, RuntimeError, ValueError) as e:
            raise HTTPException(400, str(e))
        if player is not None and user is None:
            _apply_player_score_metadata(
                match, player.player_id, score=[total1, total2], sets=[list(s) for s in sets_tuples], confirmed=True
            )
        else:
            _mark_admin_score(match, user.username if user else None)
        _save_tournament(tid)
        elo_after_score(tid, data, match)
    champ = t.champion()
    if champ:
        elo_finish_tournament(tid)
        notify_champion(tid, data, [p.name for p in champ])
    return {
        "ok": True,
        "phase": t.phase,
        "score": [total1, total2],
        "sets": [list(s) for s in sets_tuples],
    }
