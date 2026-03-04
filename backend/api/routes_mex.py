"""
Mexicano tournament routes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth.deps import get_current_user
from ..models import Court, Player, TournamentType
from ..tournaments import MexicanoTournament
from ..viz import render_playoff_schema
from .helpers import (
    _get_tournament,
    _serialize_match,
    _build_match_labels,
    _tennis_sets_to_scores,
    _schema_image_response,
)
from .schemas import (
    CreateMexicanoRequest,
    CustomRoundRequest,
    NextRoundRequest,
    RecordScoreRequest,
    RecordTennisScoreRequest,
    StartMexicanoPlayoffsRequest,
)
from .state import _next_id, _save_state, _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["mexicano"])

_MEX = TournamentType.MEXICANO.value


@router.post("/mexicano")
async def create_mexicano(req: CreateMexicanoRequest, _user=Depends(get_current_user)):
    players = [Player(name=n) for n in req.player_names]
    courts = [Court(name=n) for n in req.court_names]

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

    tid = _next_id()
    _tournaments[tid] = {
        "name": req.name,
        "type": TournamentType.MEXICANO.value,
        "tournament": t,
    }
    _save_state()
    return {"id": tid, "current_round": t.current_round}


@router.get("/{tid}/mex/status")
async def mex_status(tid: str):
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    return {
        "current_round": t.current_round,
        "num_rounds": t.num_rounds,
        "rolling": t.num_rounds == 0,
        "mexicano_ended": t.mexicano_ended,
        "total_points_per_match": t.total_points_per_match,
        "team_mode": t.team_mode,
        "phase": t.phase,
        "is_finished": t.is_finished,
        "leaderboard": t.leaderboard(),
        "players": [{"id": p.id, "name": p.name} for p in t.players],
        "sit_out_count": t._sit_out_count,
        "sit_outs": [[p.name for p in so] for so in t.sit_outs],
        "missed_games": {
            p.id: {
                "name": p.name,
                "sat_out": t._sit_out_counts[p.id],
                "matches_played": t._matches_played[p.id],
            }
            for p in t.players
        },
        "champion": [p.name for p in t.champion()] if t.champion() else None,
    }


@router.get("/{tid}/mex/matches")
async def mex_matches(tid: str):
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    return {
        "current_round": t.current_round,
        "current_matches": [_serialize_match(m) for m in t.current_round_matches()],
        "pending": [_serialize_match(m) for m in t.pending_matches()],
        "all_matches": [_serialize_match(m) for m in t.all_matches()],
        "breakdowns": t.all_match_breakdowns(),
    }


@router.post("/{tid}/mex/record")
async def mex_record(tid: str, req: RecordScoreRequest, _user=Depends(get_current_user)):
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    try:
        t.record_result(req.match_id, (req.score1, req.score2))
    except (KeyError, ValueError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    breakdown = t.get_match_breakdown(req.match_id)
    return {"ok": True, "breakdown": breakdown}


@router.get("/{tid}/mex/propose-pairings")
async def mex_propose_pairings(tid: str, n: int = 3, sit_out_ids: str | None = None):
    """
    Generate up to *n* distinct pairing proposals for the next round.
    The first entry is marked ``recommended=True``.
    Pass the chosen ``option_id`` to POST /mex/next-round to commit it.
    Also includes player_stats for repeat-match history display.

    Query params:
      sit_out_ids: comma-separated player IDs to force as sit-outs.
    """
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    forced = None
    if sit_out_ids:
        forced = [s.strip() for s in sit_out_ids.split(",") if s.strip()]
    try:
        proposals = t.propose_pairings(
            n_options=max(1, min(n, 10)),
            forced_sit_out_ids=forced,
        )
    except (RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))
    return {
        "proposals": proposals,
        "player_stats": t.player_stats(),
    }


@router.post("/{tid}/mex/next-round")
async def mex_next_round(tid: str, req: NextRoundRequest = NextRoundRequest(), _user=Depends(get_current_user)):
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    if t.pending_matches():
        raise HTTPException(400, "Current round has unfinished matches")
    try:
        t.generate_next_round(option_id=req.option_id)
    except (RuntimeError, KeyError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"current_round": t.current_round}


@router.post("/{tid}/mex/custom-round")
async def mex_custom_round(tid: str, req: CustomRoundRequest, _user=Depends(get_current_user)):
    """Commit a manually-specified round with user-defined pairings."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    if t.pending_matches():
        raise HTTPException(400, "Current round has unfinished matches")
    try:
        t.generate_custom_round(
            match_specs=[m.model_dump() for m in req.matches],
            sit_out_ids=req.sit_out_ids,
        )
    except (RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"current_round": t.current_round}


@router.get("/{tid}/mex/recommend-playoffs")
async def mex_recommend_playoffs(tid: str, n_teams: int = 4):
    """Get recommended teams for Mexicano play-offs."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    return {"recommended_teams": t.recommend_playoff_teams(n_teams)}


@router.post("/{tid}/mex/start-playoffs")
async def mex_start_playoffs(tid: str, req: StartMexicanoPlayoffsRequest, _user=Depends(get_current_user)):
    """Start play-offs after Mexicano rounds are complete."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    try:
        t.start_playoffs(
            team_player_ids=req.team_player_ids,
            n_teams=req.n_teams,
            double_elimination=req.double_elimination,
            extra_participants=[ep.model_dump() for ep in req.extra_participants] if req.extra_participants else None,
        )
    except (RuntimeError, ValueError, KeyError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"phase": t.phase}


@router.post("/{tid}/mex/end")
async def mex_end(tid: str, _user=Depends(get_current_user)):
    """End Mexicano rounds and open optional play-off decision step."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    try:
        t.end_mexicano()
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"phase": t.phase, "mexicano_ended": t.mexicano_ended}


@router.post("/{tid}/mex/finish")
async def mex_finish(tid: str, _user=Depends(get_current_user)):
    """Finish tournament as-is without play-offs."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    try:
        t.finish_without_playoffs()
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"phase": t.phase, "is_finished": t.is_finished}


@router.get("/{tid}/mex/playoffs")
async def mex_playoffs(tid: str):
    """Get play-off bracket status and matches."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    return {
        "phase": t.phase,
        "matches": [_serialize_match(m) for m in t.playoff_matches()],
        "pending": [_serialize_match(m) for m in t.pending_playoff_matches()],
        "champion": [p.name for p in t.champion()] if t.champion() else None,
    }


@router.get("/{tid}/mex/playoffs-schema")
async def mex_playoffs_schema(
    tid: str,
    title: str | None = Query(None),
    fmt: Literal["png", "svg", "pdf"] = Query("png"),
    box_scale: float = Query(1.0, ge=0.3, le=3.0),
    line_width: float = Query(1.0, ge=0.3, le=5.0),
    arrow_scale: float = Query(1.0, ge=0.3, le=5.0),
    title_font_scale: float = Query(1.0, ge=0.3, le=5.0),
    output_scale: float = Query(1.0, ge=0.5, le=3.0),
):
    """Generate a schema image/document for the active Mexicano play-off bracket."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    if t.playoff_bracket is None:
        raise HTTPException(400, "Play-offs have not started")

    participant_names = [" & ".join(p.name for p in team) for team in t.playoff_bracket.original_teams]
    if len(participant_names) < 2:
        raise HTTPException(400, "Need at least 2 participants for play-off schema")

    img = render_playoff_schema(
        participant_names=participant_names,
        elimination="double" if hasattr(t.playoff_bracket, "all_matches") else "single",
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


@router.post("/{tid}/mex/record-playoff")
async def mex_record_playoff(tid: str, req: RecordScoreRequest, _user=Depends(get_current_user)):
    """Record a play-off match result."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    try:
        t.record_playoff_result(req.match_id, (req.score1, req.score2))
    except (KeyError, RuntimeError, ValueError) as e:
        raise HTTPException(400, str(e))
    _save_state()
    return {"ok": True, "phase": t.phase}


@router.post("/{tid}/mex/record-playoff-tennis")
async def mex_record_playoff_tennis(tid: str, req: RecordTennisScoreRequest, _user=Depends(get_current_user)):
    """Record a Mexicano play-off match using tennis-style set scores."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
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
