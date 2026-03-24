"""
Standalone Play-off tournament routes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response

from ..auth.deps import get_current_user, get_current_user_optional, get_current_player, PlayerIdentity
from ..auth.models import User
from ..models import Court, Player, TournamentType
from ..tournaments import PlayoffTournament
from ..viz import render_playoff_schema
from .helpers import (
    _build_match_labels,
    _get_tournament,
    _is_bye_match,
    _require_score_permission,
    _find_match,
    _schema_image_response,
    _serialize_match,
    _tennis_sets_to_scores,
)
from .schemas import CreatePlayoffRequest, RecordScoreRequest, RecordTennisScoreRequest
from .state import _next_id, _save_tournament, _tournaments
from .player_secret_store import create_secrets_for_tournament

router = APIRouter(prefix="/api/tournaments", tags=["playoff"])

_PO = TournamentType.PLAYOFF.value


@router.post("/playoff")
async def create_playoff(req: CreatePlayoffRequest, user=Depends(get_current_user)) -> dict:
    """Create a new standalone Play-off tournament and seed the bracket immediately."""
    # Each participant name becomes a single-entry team in the bracket.
    teams: list[list[Player]] = [[Player(name=n)] for n in req.participant_names]
    courts = [Court(name=n) for n in req.court_names] if req.assign_courts else []

    t = PlayoffTournament(
        teams=teams,
        courts=courts,
        double_elimination=req.double_elimination,
        team_mode=req.team_mode,
    )

    tid = _next_id()
    _tournaments[tid] = {
        "name": req.name,
        "type": TournamentType.PLAYOFF.value,
        "tournament": t,
        "owner": user.username,
        "public": req.public,
        "sport": req.sport.value,
        "assign_courts": req.assign_courts,
    }
    _save_tournament(tid)
    # Flatten all teams into individual players for secret generation.
    all_players = [p for team in teams for p in team]
    create_secrets_for_tournament(tid, [{"id": p.id, "name": p.name} for p in all_players])
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

    img = render_playoff_schema(
        participant_names=participant_names,
        elimination="double" if t.double_elimination else "single",
        match_labels=_build_match_labels(t.bracket),
        title=title,
        fmt=fmt,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
        title_font_scale=title_font_scale,
        output_scale=output_scale,
    )
    return _schema_image_response(img, fmt)


@router.post("/{tid}/po/record")
async def po_record(
    tid: str,
    req: RecordScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a raw-score result for a play-off match."""
    t: PlayoffTournament = _get_tournament(tid, _PO)["tournament"]
    match = _find_match(t, req.match_id)
    if match is None:
        raise HTTPException(404, "Match not found")
    _require_score_permission(tid, match, user, player)
    try:
        t.record_result(req.match_id, (req.score1, req.score2))
    except (KeyError, RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))
    _save_tournament(tid)
    return {"ok": True, "phase": t.phase}


@router.post("/{tid}/po/record-tennis")
async def po_record_tennis(
    tid: str,
    req: RecordTennisScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a play-off match using tennis-style set scores."""
    t: PlayoffTournament = _get_tournament(tid, _PO)["tournament"]
    match = _find_match(t, req.match_id)
    if match is None:
        raise HTTPException(404, "Match not found")
    _require_score_permission(tid, match, user, player)
    total1, total2, sets_tuples, _ = _tennis_sets_to_scores(req.sets)
    try:
        t.record_result(req.match_id, (total1, total2), sets=sets_tuples)
    except (KeyError, RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))
    _save_tournament(tid)
    return {
        "ok": True,
        "phase": t.phase,
        "score": [total1, total2],
        "sets": [list(s) for s in sets_tuples],
    }
