"""
Standalone Play-off tournament routes.
"""

from __future__ import annotations

import asyncio

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response

from .club_elo import resolve_initial_strengths
from .rate_limit import BoundedRateLimiter
from ..auth.deps import get_current_user, get_current_user_optional, get_current_player, PlayerIdentity
from ..auth.models import User
from ..models import Court, EliminationType, InputFormat, Player, TournamentType
from ..tournaments import PlayoffTournament
from ..viz import render_playoff_schema
from .helpers import (
    tournament_winners,
    winners_payload,
    _build_match_labels,
    _get_tournament,
    _is_bye_match,
    _require_demo_can_create_tournament,
    _require_editor_access,
    _require_score_permission,
    _sanitize_demo_create_request,
    _find_match,
    _espejo_schema_target,
    _serialize_playoff_matches,
    _schema_cache_get,
    _schema_cache_key,
    _schema_cache_put,
    _schema_image_response,
    _prepare_set_score,
    _store_tournament,
    _apply_player_score_metadata,
    _hold_for_format_review,
    _is_off_format_player_submit,
    _mark_admin_score,
)
from .schemas import CreatePlayoffRequest, RecordScoreRequest, RecordTennisScoreRequest, UpdateCourtsRequest
from .routes_withdrawals import withdraw_unavailable_ids, withdrawal_summaries
from .state import allocate_tournament_id, _tournament_versions, get_tournament_lock, save_tournament
from .player_secret_store import create_secrets_for_tournament
from .push_events import notify_champion, notify_winners
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
    _require_demo_can_create_tournament(user)
    _sanitize_demo_create_request(req, user)
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

    # Players linked to a Hub profile without a manual strength are seeded from
    # their club rating (club tournaments) or community rating; others start at 1000.
    initial_strength = resolve_initial_strengths(
        [p.id for p in all_players],
        initial_strength,
        {p.id: req.player_profile_ids[p.name] for p in all_players if p.name in req.player_profile_ids},
        req.sport.value,
        req.community_id,
        req.club_id,
    )

    try:
        t = PlayoffTournament(
            teams=teams,
            courts=courts,
            double_elimination=req.double_elimination,
            espejo=req.espejo,
            team_mode=req.team_mode,
            initial_strength=initial_strength,
            num_winners=req.num_winners,
            third_place=req.third_place,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    tid = await allocate_tournament_id()
    await asyncio.to_thread(
        _store_tournament,
        tid,
        name=req.name,
        tournament_type=TournamentType.PLAYOFF.value,
        tournament=t,
        owner=user.username,
        public=req.public,
        sport=req.sport.value,
        assign_courts=req.assign_courts,
        community_id=req.community_id,
        season_id=req.season_id,
        club_id=req.club_id,
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


@router.patch("/{tid}/po/courts")
async def po_update_courts(tid: str, req: UpdateCourtsRequest, user=Depends(get_current_user)) -> dict:
    """Replace the court list for the standalone play-off tournament."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        data = _get_tournament(tid, _PO)
        t: PlayoffTournament = data["tournament"]
        courts = [Court(name=n) for n in req.court_names]
        t.update_courts(courts)
        data["assign_courts"] = len(courts) > 0
        await save_tournament(tid)
    return {"courts": [{"id": c.id, "name": c.name} for c in t.courts]}


@router.get("/{tid}/po/status")
async def po_status(tid: str) -> dict:
    """Return high-level status (phase, champion, bracket type) for a standalone Play-off tournament."""
    data = _get_tournament(tid, _PO)
    t: PlayoffTournament = data["tournament"]
    espejo = bool(getattr(t, "espejo", False))
    return {
        "phase": t.phase,
        "team_mode": t.team_mode,
        "double_elimination": t.double_elimination,
        "espejo": espejo,
        # True only for tournaments persisted before the Super Final was removed.
        "espejo_super_final": bool(espejo and getattr(t.bracket, "super_final_enabled", False)),
        "espejo_losers_bracket_seeded": (t.bracket.losers_bracket is not None if espejo else False),
        "assign_courts": data.get("assign_courts", True),
        "courts": [{"id": c.id, "name": c.name} for c in t.courts],
        **winners_payload(t),
        # Known as soon as the Winners final is played (before the tournament ends).
        "winners_champion": (
            [p.name for p in t.bracket.winners_champion()] if espejo and t.bracket.winners_champion() else None
        ),
        # Consolation winner: the Losers Bracket champion.
        "losers_champion": (
            [p.name for p in t.bracket.losers_champion()] if espejo and t.bracket.losers_champion() else None
        ),
        "withdrawals": withdrawal_summaries(t),
        "withdraw_unavailable_ids": withdraw_unavailable_ids(t),
        "sport": data.get("sport", "padel"),
    }


@router.get("/{tid}/po/playoffs")
async def po_playoffs(tid: str) -> dict:
    """Return all play-off matches, pending matches, and the champion (if decided)."""
    t: PlayoffTournament = _get_tournament(tid, _PO)["tournament"]

    matches = _serialize_playoff_matches(t.bracket, [m for m in t.all_matches() if not _is_bye_match(m)])
    pending = _serialize_playoff_matches(t.bracket, t.pending_matches())

    return {
        "matches": matches,
        "pending": pending,
        **winners_payload(t),
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
    side: Literal["winners", "losers"] | None = Query(None),
) -> Response:
    """Generate a schema image for the active Play-off bracket.

    For Espejo tournaments, pass ``side=winners`` or ``side=losers`` to get
    each bracket independently.  Without ``side``, the winners bracket is
    returned (backwards-compatible default).
    """
    t: PlayoffTournament = _get_tournament(tid, _PO)["tournament"]

    # Pick the right bracket object and names.
    if t.espejo:
        active_bracket, auto_title = _espejo_schema_target(t.bracket, side, title)
        elim = EliminationType.SINGLE
    else:
        active_bracket = t.bracket
        elim = EliminationType.DOUBLE if t.double_elimination else EliminationType.SINGLE
        auto_title = title
    participant_names = [" & ".join(p.name for p in team) for team in active_bracket.original_teams]
    match_labels = _build_match_labels(active_bracket)

    if len(participant_names) < 2:
        raise HTTPException(400, "Need at least 2 participants for play-off schema")

    num_winners = int(getattr(active_bracket, "num_winners", 1) or 1)
    third_place = bool(getattr(active_bracket, "third_place", False))

    version = _tournament_versions.get(tid, 0)
    key = _schema_cache_key(
        "po",
        tid,
        version,
        side or "default",
        tuple(participant_names),
        elim,
        auto_title,
        fmt,
        box_scale,
        line_width,
        arrow_scale,
        title_font_scale,
        output_scale,
        num_winners,
        third_place,
    )
    cached = _schema_cache_get(key)
    if cached:
        return _schema_image_response(cached[0], cached[1], etag=key[:16])

    img = render_playoff_schema(
        participant_names=participant_names,
        elimination=elim,
        match_labels=match_labels,
        title=auto_title,
        # Espejo already picked the per-side bracket above; plain double
        # elimination splits one combined layout into winners/losers views.
        side=None if t.espejo else side,
        fmt=fmt,
        box_scale=box_scale,
        line_width=line_width,
        arrow_scale=arrow_scale,
        title_font_scale=title_font_scale,
        output_scale=output_scale,
        num_winners=num_winners,
        third_place=third_place,
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
        if _is_off_format_player_submit(data, match, "po-playoff", InputFormat.POINTS, user, player):
            _hold_for_format_review(match, player.player_id, (req.score1, req.score2))
            await save_tournament(tid)
            return {"ok": True, "review": True}
        try:
            t.record_result(req.match_id, (req.score1, req.score2))
        except (KeyError, RuntimeError, ValueError) as e:
            raise HTTPException(400, str(e))
        if player is not None and user is None:
            _apply_player_score_metadata(match, player.player_id, score=[req.score1, req.score2], confirmed=True)
        else:
            _mark_admin_score(match, user.username if user else None)
        await save_tournament(tid)
        elo_after_score(tid, data, match)
    winners = tournament_winners(t)
    if winners:
        elo_finish_tournament(tid)
        if len(winners) == 1:
            notify_champion(tid, data, [p.name for p in winners[0]])
        else:
            notify_winners(tid, data, [[p.name for p in team] for team in winners])
    return {"ok": True, "phase": t.phase}


@router.post("/{tid}/po/record-tennis")
async def po_record_tennis(
    tid: str,
    req: RecordTennisScoreRequest,
    user: User | None = Depends(get_current_user_optional),
    player: PlayerIdentity | None = Depends(get_current_player),
) -> dict:
    """Record a play-off match using tennis-style set scores."""
    async with get_tournament_lock(tid):
        data = _get_tournament(tid, _PO)
        t: PlayoffTournament = data["tournament"]
        match = _find_match(t, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        _require_score_permission(tid, match, user, player)
        total1, total2, sets_tuples, _, decider = _prepare_set_score(
            data, match, req.sets, req.decider if user is None else None
        )
        if _is_off_format_player_submit(data, match, "po-playoff", InputFormat.SETS, user, player, decider):
            _hold_for_format_review(match, player.player_id, (total1, total2), sets_tuples, decider)
            await save_tournament(tid)
            return {"ok": True, "review": True}
        try:
            t.record_result(req.match_id, (total1, total2), sets=sets_tuples)
        except (KeyError, RuntimeError, ValueError) as e:
            raise HTTPException(400, str(e))
        match.decider = decider
        if player is not None and user is None:
            _apply_player_score_metadata(
                match, player.player_id, score=[total1, total2], sets=[list(s) for s in sets_tuples], confirmed=True
            )
        else:
            _mark_admin_score(match, user.username if user else None)
        await save_tournament(tid)
        elo_after_score(tid, data, match)
    winners = tournament_winners(t)
    if winners:
        elo_finish_tournament(tid)
        if len(winners) == 1:
            notify_champion(tid, data, [p.name for p in winners[0]])
        else:
            notify_winners(tid, data, [[p.name for p in team] for team in winners])
    return {
        "ok": True,
        "phase": t.phase,
        "score": [total1, total2],
        "sets": [list(s) for s in sets_tuples],
    }
