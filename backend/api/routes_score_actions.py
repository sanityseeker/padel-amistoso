"""
Score lifecycle endpoints: accept, correct, and resolve disputes.

These endpoints are tournament-type-agnostic and operate on individual matches
identified by tournament ID + match ID.  They implement the confirm/dispute
flow for player-submitted scores:

  Player A submits score (confirmed client-side via overlay)
    ↓
  Player B accepts → Score confirmed
    ↓ (Player B corrects instead)
  Dispute raised → organiser resolves

Admin/organiser-submitted scores are immediately confirmed and bypass this flow.
"""

from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth.deps import (
    PlayerIdentity,
    get_current_player,
    get_current_user,
)
from ..auth.models import User
from ..models import Match, MatchStatus, TournamentType
from ..tournaments import GroupPlayoffTournament
from .helpers import (
    _find_match_full,
    _is_player_in_match,
    _is_player_in_opposing_team,
    _is_player_in_submitter_team,
    _require_editor_access,
    _tennis_sets_to_scores,
)
from .schemas import RecordScoreRequest, RecordTennisScoreRequest
from .state import _save_tournament, _tournaments, get_tournament_lock, maybe_update_live_stats
from .push_events import notify_score_accepted, notify_score_disputed, notify_champion

router = APIRouter(prefix="/api/tournaments", tags=["score-actions"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ResolveDisputeRequest(BaseModel):
    """Choose how to resolve a score dispute."""

    chosen: Literal["original", "correction", "custom"]
    # Required when chosen == "custom".
    score1: int | None = Field(default=None, ge=0)
    score2: int | None = Field(default=None, ge=0)
    # Optional custom tennis sets.
    sets: list[list[int]] | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_any_tournament(tid: str) -> dict:
    """Look up a tournament of any type or raise 404."""
    data = _tournaments.get(tid)
    if not data:
        raise HTTPException(404, "Tournament not found")
    return data


def _get_tv_settings_from_data(data: dict) -> dict:
    """Extract the TV settings dict from a tournament data entry."""
    return data.get("tv_settings") or {}


def _require_player_in_match_check(match: Match, player: PlayerIdentity, tournament: object) -> None:
    """Raise 403 unless the player participates in the match."""
    if not _is_player_in_match(match, player.player_id, tournament):
        raise HTTPException(403, "You are not a participant in this match")


def _correction_window_seconds(data: dict) -> int:
    """Return the configured correction window in seconds (0 = no limit)."""
    return _get_tv_settings_from_data(data).get("correction_window_seconds", 0)


def _apply_score_to_tournament(
    tid: str,
    data: dict,
    match: Match,
    score: tuple[int, int],
    sets: list[tuple[int, int]] | None = None,
    third_set_loss: bool = False,
) -> None:
    """Apply a score to the underlying tournament engine (by type).

    This is used when accepting a score in 'required' mode or when resolving
    a dispute with a correction / custom score.  For playoff matches the score
    is re-recorded via the bracket engine (bracket advancement already occurred
    on first record; re-recording updates the displayed score only).
    """
    t = data["tournament"]
    tournament_type = data.get("type", "")

    if tournament_type == TournamentType.MEXICANO.value:
        # record_result handles both first-time and re-recording.
        t.record_result(match.id, score)
    elif tournament_type == TournamentType.GROUP_PLAYOFF.value:
        # Determine whether this is a group or playoff match.
        in_playoff = match.id not in _collect_group_match_ids(t)
        if in_playoff:
            t.record_playoff_result(match.id, score, sets=sets)
        else:
            t.record_group_result(match.id, score, sets=sets, third_set_loss=third_set_loss)
    elif tournament_type == TournamentType.PLAYOFF.value:
        t.record_result(match.id, score, sets=sets)


def _collect_group_match_ids(t: GroupPlayoffTournament) -> set[str]:
    """Return the set of group-stage match IDs for fast membership testing."""
    ids: set[str] = set()
    for group in getattr(t, "groups", []):
        ids.update(m.id for m in getattr(group, "matches", []))
    return ids


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/{tid}/matches/{mid}/accept")
async def accept_score(
    tid: str,
    mid: str,
    player: PlayerIdentity = Depends(get_current_player),
) -> dict:
    """Accept a pending player-submitted score on behalf of the opposing team.

    In 'immediate' mode this simply marks the score as confirmed (it already
    counts toward standings).  In 'required' mode it also applies the score
    to the tournament engine so that standings / credits are updated.
    """
    if player is None or player.tournament_id != tid:
        raise HTTPException(403, "Player authentication required")

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")

        if match.score is None:
            raise HTTPException(409, "Match has no pending score to accept")

        if match.score_confirmed:
            raise HTTPException(409, "Score is already confirmed")

        if match.disputed:
            raise HTTPException(409, "Score is under dispute — contact your organiser")

        if not match.scored_by:
            raise HTTPException(409, "Score was recorded by an organiser and is already final")

        # Only the opposing team may accept.
        if not _is_player_in_opposing_team(match, player.player_id, t):
            raise HTTPException(403, "Only an opposing team member may accept this score")

        tv = _get_tv_settings_from_data(data)
        mode = tv.get("score_confirmation", "immediate")

        # In 'required' mode, apply the pending score to the engine.
        if mode == "required" and match.status == MatchStatus.IN_PROGRESS:
            try:
                _apply_score_to_tournament(tid, data, match, match.score, match.sets)
            except (ValueError, RuntimeError, KeyError) as e:
                raise HTTPException(400, str(e))

        match.score_confirmed = True
        match.score_history.append(
            {
                "player_id": player.player_id,
                "action": "accept",
                "score": list(match.score) if match.score else None,
                "sets": None,
                "timestamp": time.time(),
            }
        )
        _save_tournament(tid)
        maybe_update_live_stats(tid)

    notify_score_accepted(tid, data, match, player.player_id)
    champ = getattr(t, "champion", lambda: None)()
    if champ:
        notify_champion(tid, data, [p.name for p in champ])
    return {"ok": True}


@router.post("/{tid}/matches/{mid}/correct")
async def correct_score(
    tid: str,
    mid: str,
    req: RecordScoreRequest,
    player: PlayerIdentity = Depends(get_current_player),
) -> dict:
    """Submit a score correction on behalf of the opposing team.

    The correction is stored as a dispute.  The match score is NOT changed
    immediately — an organiser must resolve the dispute via ``resolve-dispute``.
    Only one correction per match is allowed.
    """
    if player is None or player.tournament_id != tid:
        raise HTTPException(403, "Player authentication required")

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")

        if match.score is None:
            raise HTTPException(409, "Match has no score to correct")

        if match.score_confirmed:
            raise HTTPException(409, "Score is already confirmed and cannot be corrected")

        if match.disputed:
            raise HTTPException(409, "A correction has already been submitted for this match")

        if not match.scored_by:
            raise HTTPException(409, "Score was recorded by an organiser — contact them directly")

        corr_window = _correction_window_seconds(data)
        if corr_window > 0 and match.scored_at is not None:
            if time.time() - match.scored_at > corr_window:
                raise HTTPException(
                    409,
                    f"The {corr_window}s correction window has expired — the score is now final",
                )

        if not _is_player_in_opposing_team(match, player.player_id, t):
            raise HTTPException(403, "Only an opposing team member may correct this score")

        now = time.time()
        match.disputed = True
        match.dispute_score = (req.score1, req.score2)
        match.dispute_sets = None
        match.dispute_by = player.player_id
        match.dispute_at = now
        match.score_history.append(
            {
                "player_id": player.player_id,
                "action": "correct",
                "score": [req.score1, req.score2],
                "sets": None,
                "timestamp": now,
            }
        )
        _save_tournament(tid)

    notify_score_disputed(tid, data, match, player.player_id)
    return {"ok": True}


@router.post("/{tid}/matches/{mid}/correct-tennis")
async def correct_score_tennis(
    tid: str,
    mid: str,
    req: RecordTennisScoreRequest,
    player: PlayerIdentity = Depends(get_current_player),
) -> dict:
    """Submit a tennis-format score correction on behalf of the opposing team."""
    if player is None or player.tournament_id != tid:
        raise HTTPException(403, "Player authentication required")

    total1, total2, sets_tuples, _ = _tennis_sets_to_scores(req.sets)

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")

        if match.score is None:
            raise HTTPException(409, "Match has no score to correct")

        if match.score_confirmed:
            raise HTTPException(409, "Score is already confirmed and cannot be corrected")

        if match.disputed:
            raise HTTPException(409, "A correction has already been submitted for this match")

        if not match.scored_by:
            raise HTTPException(409, "Score was recorded by an organiser — contact them directly")

        corr_window = _correction_window_seconds(data)
        if corr_window > 0 and match.scored_at is not None:
            if time.time() - match.scored_at > corr_window:
                raise HTTPException(
                    409,
                    f"The {corr_window}s correction window has expired — the score is now final",
                )

        if not _is_player_in_opposing_team(match, player.player_id, t):
            raise HTTPException(403, "Only an opposing team member may correct this score")

        now = time.time()
        match.disputed = True
        match.dispute_score = (total1, total2)
        match.dispute_sets = list(sets_tuples)
        match.dispute_by = player.player_id
        match.dispute_at = now
        match.score_history.append(
            {
                "player_id": player.player_id,
                "action": "correct",
                "score": [total1, total2],
                "sets": [list(s) for s in sets_tuples],
                "timestamp": now,
            }
        )
        _save_tournament(tid)

    notify_score_disputed(tid, data, match, player.player_id)
    return {"ok": True}


@router.post("/{tid}/matches/{mid}/accept-correction")
async def accept_correction(
    tid: str,
    mid: str,
    player: PlayerIdentity = Depends(get_current_player),
) -> dict:
    """Accept a correction proposed by the opposing team.

    Only a member of the *original submitter's* team may accept the correction.
    Accepting applies the correction score as the final result and clears the
    dispute without requiring organiser intervention.
    """
    if player is None or player.tournament_id != tid:
        raise HTTPException(403, "Player authentication required")

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")

        if not match.disputed:
            raise HTTPException(409, "Match is not under dispute")

        if match.dispute_escalated:
            raise HTTPException(409, "Dispute has been escalated to the organiser")

        if match.dispute_score is None:
            raise HTTPException(409, "No correction score available")

        if not _is_player_in_submitter_team(match, player.player_id, t):
            raise HTTPException(
                403,
                "Only the original submitter's team may accept or reject a correction",
            )

        # Apply the correction score to the tournament engine.
        final_score = match.dispute_score
        final_sets = list(match.dispute_sets) if match.dispute_sets else None
        try:
            _apply_score_to_tournament(tid, data, match, final_score, final_sets)
        except (ValueError, RuntimeError, KeyError) as e:
            raise HTTPException(400, str(e))

        now = time.time()
        match.score = final_score
        match.sets = final_sets
        match.disputed = False
        match.dispute_score = None
        match.dispute_sets = None
        match.dispute_by = None
        match.dispute_at = None
        match.dispute_escalated = False
        match.score_confirmed = True
        match.score_history.append(
            {
                "player_id": player.player_id,
                "action": "accept_correction",
                "score": list(final_score) if final_score else None,
                "sets": [list(s) for s in final_sets] if final_sets else None,
                "timestamp": now,
            }
        )
        _save_tournament(tid)
        maybe_update_live_stats(tid)

    notify_score_accepted(tid, data, match, player.player_id)
    champ = getattr(t, "champion", lambda: None)()
    if champ:
        notify_champion(tid, data, [p.name for p in champ])
    return {"ok": True}


@router.post("/{tid}/matches/{mid}/escalate-dispute")
async def escalate_dispute(
    tid: str,
    mid: str,
    player: PlayerIdentity = Depends(get_current_player),
) -> dict:
    """Escalate a disputed score to the organiser/admin.

    Only a member of the *original submitter's* team may escalate.
    After escalation, only an organiser can resolve the dispute.
    """
    if player is None or player.tournament_id != tid:
        raise HTTPException(403, "Player authentication required")

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")

        if not match.disputed:
            raise HTTPException(409, "Match is not under dispute")

        if match.dispute_escalated:
            raise HTTPException(409, "Dispute is already escalated")

        if not _is_player_in_submitter_team(match, player.player_id, t):
            raise HTTPException(
                403,
                "Only the original submitter's team may accept or reject a correction",
            )

        now = time.time()
        match.dispute_escalated = True
        match.score_history.append(
            {
                "player_id": player.player_id,
                "action": "escalate",
                "score": None,
                "sets": None,
                "timestamp": now,
            }
        )
        _save_tournament(tid)

    return {"ok": True}


@router.post("/{tid}/matches/{mid}/resolve-dispute")
async def resolve_dispute(
    tid: str,
    mid: str,
    req: ResolveDisputeRequest,
    user: User = Depends(get_current_user),
) -> dict:
    """Resolve a score dispute (organiser/admin only).

    Three options:
    - ``"original"``: Keep the original submitted score and clear the dispute.
    - ``"correction"``: Apply the opposing team's correction as the final score.
    - ``"custom"``: Use a completely different score supplied in ``score1``/``score2``.
    """
    _require_editor_access(tid, user)

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")

        if not match.disputed:
            raise HTTPException(409, "Match is not under dispute")

        now = time.time()
        actor = user.username

        if req.chosen == "original":
            final_score = match.score
            final_sets = match.sets
        elif req.chosen == "correction":
            if match.dispute_score is None:
                raise HTTPException(400, "No correction score available")
            final_score = match.dispute_score
            final_sets = list(match.dispute_sets) if match.dispute_sets else None
        else:  # "custom"
            if req.score1 is None or req.score2 is None:
                raise HTTPException(400, "score1 and score2 are required for custom resolution")
            final_score = (req.score1, req.score2)
            final_sets_raw = req.sets
            if final_sets_raw:
                _, _, sets_tuples, _ = _tennis_sets_to_scores(final_sets_raw)
                final_sets = list(sets_tuples)
            else:
                final_sets = None

        # Apply the resolved score to the tournament engine so standings / credits
        # reflect the final decision.  'original' re-applies the same score which
        # is safe (record_result reverses previous credits for Mexicano).
        try:
            _apply_score_to_tournament(tid, data, match, final_score, final_sets)
        except (ValueError, RuntimeError, KeyError) as e:
            raise HTTPException(400, str(e))

        # Update match with settled score and clear dispute state.
        match.disputed = False
        match.dispute_score = None
        match.dispute_sets = None
        match.dispute_by = None
        match.dispute_at = None
        match.dispute_escalated = False
        match.score_confirmed = True
        match.score_history.append(
            {
                "player_id": actor,
                "action": "resolve_dispute",
                "score": list(final_score) if final_score else None,
                "sets": [list(s) for s in final_sets] if final_sets else None,
                "timestamp": now,
                "chosen": req.chosen,
            }
        )
        _save_tournament(tid)
        maybe_update_live_stats(tid)

    champ = getattr(t, "champion", lambda: None)()
    if champ:
        notify_champion(tid, data, [p.name for p in champ])
    return {"ok": True}


@router.get("/{tid}/matches/{mid}/history")
async def match_score_history(
    tid: str,
    mid: str,
    user: User = Depends(get_current_user),
) -> dict:
    """Return the full score audit history for a match (organiser/admin only)."""
    _require_editor_access(tid, user)

    data = _get_any_tournament(tid)
    t = data["tournament"]
    match = _find_match_full(t, mid)
    if match is None:
        raise HTTPException(404, "Match not found")

    return {
        "match_id": mid,
        "history": list(getattr(match, "score_history", [])),
    }
