"""
Mexicano tournament routes.
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from .rate_limit import BoundedRateLimiter
from ..auth.deps import get_current_user, get_current_user_optional, get_current_player, PlayerIdentity
from ..auth.models import User
from ..models import Court, Player, TournamentType
from ..tournaments import MexicanoTournament
from ..viz import render_playoff_schema
from .helpers import (
    _get_tournament,
    _serialize_match,
    _build_match_labels,
    _tennis_sets_to_scores,
    _schema_image_response,
    _require_editor_access,
    _require_score_permission,
    _find_match,
    _store_tournament,
)
from .schemas import (
    CreateMexicanoRequest,
    CustomRoundRequest,
    NextRoundRequest,
    PatchMexSettingsRequest,
    RecordScoreRequest,
    RecordTennisScoreRequest,
    StartMexicanoPlayoffsRequest,
    UpdateCourtsRequest,
)
from .state import allocate_tournament_id, _save_tournament, get_tournament_lock
from .player_secret_store import create_secrets_for_tournament

router = APIRouter(prefix="/api/tournaments", tags=["mexicano"])

_MEX = TournamentType.MEXICANO.value

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


@router.post("/mexicano")
async def create_mexicano(req: CreateMexicanoRequest, request: Request, user=Depends(get_current_user)) -> dict:
    """Create a new Mexicano tournament and generate the first round of matches."""
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
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    t.generate_next_round()

    tid = await allocate_tournament_id()
    _store_tournament(
        tid,
        name=req.name,
        tournament_type=TournamentType.MEXICANO.value,
        tournament=t,
        owner=user.username,
        public=req.public,
        sport=req.sport.value,
        assign_courts=req.assign_courts,
    )
    create_secrets_for_tournament(tid, [{"id": p.id, "name": p.name} for p in players])
    return {"id": tid, "current_round": t.current_round}


@router.get("/{tid}/mex/status")
async def mex_status(tid: str) -> dict:
    """Return comprehensive Mexicano tournament status including leaderboard, rounds, and sit-out info."""
    data = _get_tournament(tid, _MEX)
    t: MexicanoTournament = data["tournament"]
    return {
        "current_round": t.current_round,
        "num_rounds": t.num_rounds,
        "rolling": t.num_rounds == 0,
        "mexicano_ended": t.mexicano_ended,
        "total_points_per_match": t.total_points_per_match,
        "team_mode": t.team_mode,
        "strength_weight": t.strength_weight,
        "skill_gap": t.skill_gap,
        "win_bonus": t.win_bonus,
        "loss_discount": t.loss_discount,
        "balance_tolerance": t.balance_tolerance,
        "teammate_repeat_weight": t.teammate_repeat_weight,
        "opponent_repeat_weight": t.opponent_repeat_weight,
        "repeat_decay": t.repeat_decay,
        "phase": t.phase,
        "is_finished": t.is_finished,
        "assign_courts": data.get("assign_courts", True),
        "courts": [{"id": c.id, "name": c.name} for c in t.courts],
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
async def mex_matches(tid: str) -> dict:
    """Return current-round matches, all pending matches, and historical match list with breakdowns."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    return {
        "current_round": t.current_round,
        "current_matches": [_serialize_match(m) for m in t.current_round_matches()],
        "pending": [_serialize_match(m) for m in t.pending_matches()],
        "all_matches": [_serialize_match(m) for m in t.all_matches()],
        "breakdowns": t.all_match_breakdowns(),
    }


@router.post("/{tid}/mex/record")
async def mex_record(
    tid: str,
    req: RecordScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a raw-score result for the current Mexicano match."""
    async with get_tournament_lock(tid):
        t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
        match = _find_match(t, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        _require_score_permission(tid, match, user, player)
        try:
            t.record_result(req.match_id, (req.score1, req.score2))
        except (KeyError, ValueError) as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
        breakdown = t.get_match_breakdown(req.match_id)
    return {"ok": True, "breakdown": breakdown}


@router.patch("/{tid}/mex/settings")
async def mex_update_settings(tid: str, req: PatchMexSettingsRequest, user=Depends(get_current_user)) -> dict:
    """Replace all advanced Mexicano settings (pairing weights, scoring modifiers, round count)."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
        t.num_rounds = req.num_rounds
        t.skill_gap = req.skill_gap
        t.win_bonus = req.win_bonus
        t.strength_weight = req.strength_weight
        t.loss_discount = req.loss_discount
        t.balance_tolerance = req.balance_tolerance
        t.teammate_repeat_weight = req.teammate_repeat_weight
        t.opponent_repeat_weight = req.opponent_repeat_weight
        t.repeat_decay = req.repeat_decay
        _save_tournament(tid)
    return {
        "num_rounds": t.num_rounds,
        "skill_gap": t.skill_gap,
        "win_bonus": t.win_bonus,
        "strength_weight": t.strength_weight,
        "loss_discount": t.loss_discount,
        "balance_tolerance": t.balance_tolerance,
        "teammate_repeat_weight": t.teammate_repeat_weight,
        "opponent_repeat_weight": t.opponent_repeat_weight,
        "repeat_decay": t.repeat_decay,
    }


@router.patch("/{tid}/mex/courts")
async def mex_update_courts(tid: str, req: UpdateCourtsRequest, user=Depends(get_current_user)) -> dict:
    """Replace the court list for future rounds and play-off bracket generation."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        data = _get_tournament(tid, _MEX)
        t: MexicanoTournament = data["tournament"]
        courts = [Court(name=n) for n in req.court_names]
        t.update_courts(courts)
        data["assign_courts"] = len(courts) > 0
        _save_tournament(tid)
    return {"courts": [{"id": c.id, "name": c.name} for c in t.courts]}


@router.get("/{tid}/mex/propose-pairings")
async def mex_propose_pairings(tid: str, n: int = 3, sit_out_ids: str | None = None) -> dict:
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
async def mex_next_round(tid: str, req: NextRoundRequest = NextRoundRequest(), user=Depends(get_current_user)) -> dict:
    """Commit the chosen pairing proposal and generate the next Mexicano round."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
        if t.pending_matches():
            raise HTTPException(400, "Current round has unfinished matches")
        try:
            t.generate_next_round(option_id=req.option_id)
        except (RuntimeError, KeyError) as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {"current_round": t.current_round}


@router.post("/{tid}/mex/custom-round")
async def mex_custom_round(tid: str, req: CustomRoundRequest, user=Depends(get_current_user)) -> dict:
    """Commit a manually-specified round with user-defined pairings."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
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
        _save_tournament(tid)
    return {"current_round": t.current_round}


@router.get("/{tid}/mex/recommend-playoffs")
async def mex_recommend_playoffs(tid: str, n_teams: int = 4) -> dict:
    """Get recommended teams for Mexicano play-offs."""
    t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
    return {"recommended_teams": t.recommend_playoff_teams(n_teams)}


@router.post("/{tid}/mex/start-playoffs")
async def mex_start_playoffs(tid: str, req: StartMexicanoPlayoffsRequest, user=Depends(get_current_user)) -> dict:
    """Start play-offs after Mexicano rounds are complete."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
        try:
            t.start_playoffs(
                team_player_ids=req.team_player_ids,
                n_teams=req.n_teams,
                double_elimination=req.double_elimination,
                extra_participants=[ep.model_dump() for ep in req.extra_participants]
                if req.extra_participants
                else None,
            )
        except (RuntimeError, ValueError, KeyError) as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {"phase": t.phase}


@router.post("/{tid}/mex/end")
async def mex_end(tid: str, user=Depends(get_current_user)) -> dict:
    """End Mexicano rounds and open optional play-off decision step."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
        try:
            t.end_mexicano()
        except RuntimeError as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {"phase": t.phase, "mexicano_ended": t.mexicano_ended}


@router.post("/{tid}/mex/finish")
async def mex_finish(tid: str, user=Depends(get_current_user)) -> dict:
    """Finish tournament as-is without play-offs."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
        try:
            t.finish_without_playoffs()
        except RuntimeError as e:
            raise HTTPException(400, str(e))
        _save_tournament(tid)
    return {"phase": t.phase, "is_finished": t.is_finished}


@router.get("/{tid}/mex/playoffs")
async def mex_playoffs(tid: str) -> dict:
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
) -> Response:
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
async def mex_record_playoff(
    tid: str,
    req: RecordScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a play-off match result."""
    async with get_tournament_lock(tid):
        t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
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


@router.post("/{tid}/mex/record-playoff-tennis")
async def mex_record_playoff_tennis(
    tid: str,
    req: RecordTennisScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a Mexicano play-off match using tennis-style set scores."""
    total1, total2, sets_tuples, _ = _tennis_sets_to_scores(req.sets)
    async with get_tournament_lock(tid):
        t: MexicanoTournament = _get_tournament(tid, _MEX)["tournament"]
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
