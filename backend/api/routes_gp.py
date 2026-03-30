"""
Group + Play-off tournament routes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from .rate_limit import BoundedRateLimiter
from ..auth.deps import get_current_user, get_current_user_optional, get_current_player, PlayerIdentity
from ..auth.models import User
from ..models import Court, Player, TournamentType
from ..tournaments import GroupPlayoffTournament
from ..viz import render_playoff_schema
from .helpers import (
    _get_tournament,
    _is_bye_match,
    _serialize_match,
    _tennis_sets_to_scores,
    _build_match_labels,
    _schema_image_response,
    _require_editor_access,
    _require_score_permission,
    _find_match,
    _store_tournament,
)
from .schemas import (
    CreateGroupPlayoffRequest,
    RecordScoreRequest,
    RecordTennisScoreRequest,
    StartGroupPlayoffsRequest,
    UpdateCourtsRequest,
)
from .state import allocate_tournament_id, _save_tournament, get_tournament_lock
from .player_secret_store import create_secrets_for_tournament

router = APIRouter(prefix="/api/tournaments", tags=["group-playoff"])

_GP = TournamentType.GROUP_PLAYOFF.value

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


@router.post("/group-playoff")
async def create_group_playoff(
    req: CreateGroupPlayoffRequest, request: Request, user=Depends(get_current_user)
) -> dict:
    """Create a new Group+Playoff tournament and generate the first group-stage matches."""
    client_ip = _client_ip(request)
    _create_rate_limiter.check(client_ip, "Too many tournament creation attempts — try again later")
    _create_rate_limiter.record(client_ip)
    players = [Player(name=n) for n in req.player_names]
    courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []

    # Build initial_strength mapping keyed by player id
    initial_strength: dict[str, float] | None = None
    if req.player_strengths:
        name_to_id = {p.name: p.id for p in players}
        initial_strength = {
            name_to_id[name]: score for name, score in req.player_strengths.items() if name in name_to_id
        } or None

    t = GroupPlayoffTournament(
        players=players,
        num_groups=req.num_groups,
        courts=courts,
        top_per_group=req.top_per_group,
        double_elimination=req.double_elimination,
        team_mode=req.team_mode,
        group_names=req.group_names,
        initial_strength=initial_strength,
        group_assignments=req.group_assignments,
    )
    try:
        t.generate()
    except ValueError as e:
        raise HTTPException(400, str(e))

    tid = await allocate_tournament_id()
    _store_tournament(
        tid,
        name=req.name,
        tournament_type=TournamentType.GROUP_PLAYOFF.value,
        tournament=t,
        owner=user.username,
        public=req.public,
        sport=req.sport.value,
        assign_courts=req.assign_courts,
    )
    create_secrets_for_tournament(tid, [{"id": p.id, "name": p.name} for p in players])
    return {"id": tid, "phase": t.phase}


@router.get("/{tid}/gp/status")
async def gp_status(tid: str) -> dict:
    """Return high-level status (phase, number of groups, team mode, champion) for a GP tournament."""
    data = _get_tournament(tid, _GP)
    t: GroupPlayoffTournament = data["tournament"]
    return {
        "phase": t.phase,
        "num_groups": len(t.groups),
        "team_mode": t.team_mode,
        "assign_courts": data.get("assign_courts", True),
        "courts": [{"id": c.id, "name": c.name} for c in t.courts],
        "champion": [p.name for p in t.champion()] if t.champion() else None,
        "team_roster": getattr(t, "team_roster", None) or {},
    }


@router.get("/{tid}/gp/groups")
async def gp_groups(tid: str) -> dict:
    """Return standings, all matches for each group, and whether more rounds can be generated."""
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    return {
        "standings": t.group_standings(),
        "matches": {g.name: [_serialize_match(m) for m in g.matches] for g in t.groups},
        "has_more_rounds": t.has_more_group_rounds,
    }


@router.post("/{tid}/gp/record-group")
async def gp_record_group(
    tid: str,
    req: RecordScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a raw-score result for a group-stage match."""
    async with get_tournament_lock(tid):
        t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
        match = _find_match(t, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        _require_score_permission(tid, match, user, player)
        try:
            t.record_group_result(req.match_id, (req.score1, req.score2))
        except (KeyError, RuntimeError) as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {"ok": True}


@router.post("/{tid}/gp/record-group-tennis")
async def gp_record_group_tennis(
    tid: str,
    req: RecordTennisScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a group match using tennis-style set scores.
    Score = sum of game differences across all sets."""
    total1, total2, sets_tuples, third_set_decided = _tennis_sets_to_scores(req.sets)
    async with get_tournament_lock(tid):
        t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
        match = _find_match(t, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        _require_score_permission(tid, match, user, player)
        try:
            t.record_group_result(
                req.match_id,
                (total1, total2),
                sets=sets_tuples,
                third_set_loss=third_set_decided,
            )
        except (KeyError, RuntimeError) as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {
        "ok": True,
        "score": [total1, total2],
        "sets": [list(s) for s in sets_tuples],
        "third_set_decided": third_set_decided,
    }


@router.patch("/{tid}/gp/courts")
async def gp_update_courts(tid: str, req: UpdateCourtsRequest, user=Depends(get_current_user)) -> dict:
    """Replace the court list for the group-playoff tournament."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        data = _get_tournament(tid, _GP)
        t: GroupPlayoffTournament = data["tournament"]
        courts = [Court(name=n) for n in req.court_names]
        t.update_courts(courts)
        data["assign_courts"] = len(courts) > 0
        _save_tournament(tid)
    return {"courts": [{"id": c.id, "name": c.name} for c in t.courts]}


@router.post("/{tid}/gp/next-group-round")
async def gp_next_group_round(tid: str, user=Depends(get_current_user)) -> dict:
    """Generate the next round of group-stage matches (individual mode only).

    Requires all current-round matches to be completed so cumulative scores
    can be used for opponent selection.
    """
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
        try:
            new_matches = t.generate_next_group_round()
        except RuntimeError as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {
        "matches": [_serialize_match(m) for m in new_matches],
        "has_more_rounds": t.has_more_group_rounds,
    }


@router.get("/{tid}/gp/recommend-playoffs")
async def gp_recommend_playoffs(tid: str) -> dict:
    """Get all group-stage participants ranked for playoff selection."""
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    return {"recommended_participants": t.recommend_playoff_participants()}


@router.post("/{tid}/gp/start-playoffs")
async def gp_start_playoffs(
    tid: str,
    req: StartGroupPlayoffsRequest = StartGroupPlayoffsRequest(),
    user=Depends(get_current_user),
) -> dict:
    """Seed the play-off bracket from group standings and transition to the playoffs phase."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
        try:
            t.start_playoffs(
                advancing_player_ids=req.advancing_player_ids,
                extra_players=[(ep.name, ep.score) for ep in req.extra_participants]
                if req.extra_participants
                else None,
                double_elimination=req.double_elimination,
            )
        except (RuntimeError, KeyError, ValueError) as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {"phase": t.phase}


@router.get("/{tid}/gp/playoffs")
async def gp_playoffs(tid: str) -> dict:
    """Return all play-off matches, pending matches, and the champion (if decided)."""
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    return {
        "matches": [_serialize_match(m) for m in t.playoff_matches() if not _is_bye_match(m)],
        "pending": [_serialize_match(m) for m in t.pending_playoff_matches()],
        "champion": [p.name for p in t.champion()] if t.champion() else None,
    }


@router.get("/{tid}/gp/playoffs-schema")
async def gp_playoffs_schema(
    tid: str,
    title: str | None = Query(None),
    fmt: Literal["png", "svg", "pdf"] = Query("png"),
    box_scale: float = Query(1.0, ge=0.3, le=3.0),
    line_width: float = Query(1.0, ge=0.3, le=5.0),
    arrow_scale: float = Query(1.0, ge=0.3, le=5.0),
    title_font_scale: float = Query(1.0, ge=0.3, le=5.0),
    output_scale: float = Query(1.0, ge=0.5, le=3.0),
) -> Response:
    """Generate a schema image/document for the active Group+Playoff bracket."""
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    if t.playoff_bracket is None:
        raise HTTPException(400, "Play-offs have not started")

    participant_names = [" & ".join(p.name for p in team) for team in t.playoff_bracket.original_teams]
    if len(participant_names) < 2:
        raise HTTPException(400, "Need at least 2 participants for play-off schema")

    img = render_playoff_schema(
        participant_names=participant_names,
        elimination="double" if t.double_elimination else "single",
        match_labels=_build_match_labels(t.playoff_bracket),
        title=title,
        fmt=fmt,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
        title_font_scale=title_font_scale,
        output_scale=output_scale,
    )
    return _schema_image_response(img, fmt)


@router.post("/{tid}/gp/record-playoff")
async def gp_record_playoff(
    tid: str,
    req: RecordScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a raw-score result for a play-off match."""
    async with get_tournament_lock(tid):
        t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
        match = _find_match(t, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        _require_score_permission(tid, match, user, player)
        try:
            t.record_playoff_result(req.match_id, (req.score1, req.score2))
        except (KeyError, RuntimeError, ValueError) as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {"ok": True, "phase": t.phase}


@router.post("/{tid}/gp/record-playoff-tennis")
async def gp_record_playoff_tennis(
    tid: str,
    req: RecordTennisScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a playoff match using tennis-style set scores."""
    total1, total2, sets_tuples, _ = _tennis_sets_to_scores(req.sets)
    async with get_tournament_lock(tid):
        t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
        match = _find_match(t, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        _require_score_permission(tid, match, user, player)
        try:
            t.record_playoff_result(req.match_id, (total1, total2), sets=sets_tuples)
        except (KeyError, RuntimeError, ValueError) as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {
        "ok": True,
        "phase": t.phase,
        "score": [total1, total2],
        "sets": [list(s) for s in sets_tuples],
    }
