"""
Group + Play-off tournament routes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth.deps import get_current_user
from ..models import Court, Player, TournamentType
from ..tournaments import GroupPlayoffTournament
from ..viz import render_playoff_schema
from .helpers import (
    _get_tournament,
    _serialize_match,
    _tennis_sets_to_scores,
    _build_match_labels,
    _schema_image_response,
)
from .schemas import (
    CreateGroupPlayoffRequest,
    RecordScoreRequest,
    RecordTennisScoreRequest,
)
from .state import _next_id, _save_state, _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["group-playoff"])

_GP = TournamentType.GROUP_PLAYOFF.value


@router.post("/group-playoff")
async def create_group_playoff(req: CreateGroupPlayoffRequest, _user=Depends(get_current_user)):
    players = [Player(name=n) for n in req.player_names]
    courts = [Court(name=n) for n in req.court_names]

    t = GroupPlayoffTournament(
        players=players,
        num_groups=req.num_groups,
        courts=courts,
        top_per_group=req.top_per_group,
        double_elimination=req.double_elimination,
        team_mode=req.team_mode,
    )
    t.generate()

    tid = _next_id()
    _tournaments[tid] = {
        "name": req.name,
        "type": TournamentType.GROUP_PLAYOFF.value,
        "tournament": t,
    }
    _save_state()
    return {"id": tid, "phase": t.phase}


@router.get("/{tid}/gp/status")
async def gp_status(tid: str):
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    return {
        "phase": t.phase,
        "num_groups": len(t.groups),
        "champion": [p.name for p in t.champion()] if t.champion() else None,
    }


@router.get("/{tid}/gp/groups")
async def gp_groups(tid: str):
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    return {
        "standings": t.group_standings(),
        "matches": {g.name: [_serialize_match(m) for m in g.matches] for g in t.groups},
    }


@router.post("/{tid}/gp/record-group")
async def gp_record_group(tid: str, req: RecordScoreRequest, _user=Depends(get_current_user)):
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    try:
        t.record_group_result(req.match_id, (req.score1, req.score2))
    except (KeyError, RuntimeError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"ok": True}


@router.post("/{tid}/gp/record-group-tennis")
async def gp_record_group_tennis(tid: str, req: RecordTennisScoreRequest, _user=Depends(get_current_user)):
    """Record a group match using tennis-style set scores.
    Score = sum of game differences across all sets."""
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    total1, total2, sets_tuples, third_set_decided = _tennis_sets_to_scores(req.sets)
    try:
        t.record_group_result(
            req.match_id,
            (total1, total2),
            sets=sets_tuples,
            third_set_loss=third_set_decided,
        )
    except (KeyError, RuntimeError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {
        "ok": True,
        "score": [total1, total2],
        "sets": [list(s) for s in sets_tuples],
        "third_set_decided": third_set_decided,
    }


@router.post("/{tid}/gp/start-playoffs")
async def gp_start_playoffs(tid: str, _user=Depends(get_current_user)):
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    try:
        t.start_playoffs()
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"phase": t.phase}


@router.get("/{tid}/gp/playoffs")
async def gp_playoffs(tid: str):
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    return {
        "matches": [_serialize_match(m) for m in t.playoff_matches()],
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
):
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
async def gp_record_playoff(tid: str, req: RecordScoreRequest, _user=Depends(get_current_user)):
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    try:
        t.record_playoff_result(req.match_id, (req.score1, req.score2))
    except (KeyError, RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"ok": True, "phase": t.phase}


@router.post("/{tid}/gp/record-playoff-tennis")
async def gp_record_playoff_tennis(tid: str, req: RecordTennisScoreRequest, _user=Depends(get_current_user)):
    """Record a playoff match using tennis-style set scores."""
    t: GroupPlayoffTournament = _get_tournament(tid, _GP)["tournament"]
    total1, total2, sets_tuples, _ = _tennis_sets_to_scores(req.sets)
    try:
        t.record_playoff_result(req.match_id, (total1, total2), sets=sets_tuples)
    except (KeyError, RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {
        "ok": True,
        "phase": t.phase,
        "score": [total1, total2],
        "sets": [list(s) for s in sets_tuples],
    }
