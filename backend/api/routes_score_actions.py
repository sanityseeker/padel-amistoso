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

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from ..auth.deps import (
    PlayerIdentity,
    get_current_player,
    get_current_user,
)
from ..auth.models import User
from ..models import (
    DisputeChoice,
    InputFormat,
    Match,
    MatchFormatOverride,
    MatchStatus,
    ScoreConfirmation,
    SetDecider,
    TournamentType,
)
from ..tournaments import GroupPlayoffTournament
from ..tournaments.errors import MatchClearBlocked
from ..tournaments.set_format import match_decider, validate_decider_sets
from .helpers import (
    tournament_winners,
    _effective_decider,
    _find_match_full,
    _is_player_in_match,
    _is_player_in_opposing_team,
    _is_player_in_submitter_team,
    _clear_format_review,
    _mark_admin_score,
    _prepare_set_score,
    _require_editor_access,
    _serialize_format_override,
    _serialize_match,
    _tennis_sets_to_scores,
    _tv_default_decider,
)
from .schemas import (
    ClearMatchResponse,
    MatchFormatResponse,
    RecordScoreRequest,
    RecordTennisScoreRequest,
    SetMatchFormatRequest,
    validate_set_scores,
)
from .state import _tournaments, get_tournament_lock, save_tournament, update_live_stats
from .push_events import notify_score_accepted, notify_score_disputed, notify_champion, notify_winners
from .elo_integration import elo_after_score, elo_recalculate_tournament
from .elo_store import has_match_elo_log

router = APIRouter(prefix="/api/tournaments", tags=["score-actions"])

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ResolveDisputeRequest(BaseModel):
    """Choose how to resolve a score dispute."""

    chosen: DisputeChoice
    # Required when chosen == "custom".
    score1: int | None = Field(default=None, ge=0)
    score2: int | None = Field(default=None, ge=0)
    # Optional custom tennis sets.  When given, the server derives the match
    # score from them and ignores score1/score2.
    sets: list[list[int]] | None = None

    @field_validator("sets")
    @classmethod
    def _validate_sets(cls, v: list[list[int]] | None) -> list[list[int]] | None:
        return validate_set_scores(v) if v else None


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
) -> tuple[int, int]:
    """Apply a score to the underlying tournament engine (by type).

    This is used when accepting a score in 'required' mode, when resolving a
    dispute with a correction / custom score, and when an organiser changes
    the decider of a finished match.  For playoff matches (Group+Playoff,
    stand-alone play-offs and Mexicano play-offs alike) the score is
    re-recorded via the bracket engine (bracket advancement already occurred
    on first record; re-recording updates the displayed score only).

    When *sets* are given the game totals are derived from them under the
    match's effective third-set decider (a match tie-break counts as one
    game), the third set is validated against that decider, and the decider
    is stamped on the match once the engine accepted the score.  A three-set
    result always counts as a third-set decision (``third_set_loss``), so
    re-applying a stored set score (accept, accept-correction,
    resolve-dispute) never silently clears the flag.

    Returns:
        The score actually recorded (recomputed from *sets* when given).

    Raises:
        ValueError / RuntimeError / KeyError: from the engine or the decider
            validation; callers map these to HTTP 400.
    """
    decider: SetDecider | None = None
    if sets is not None:
        decider = _effective_decider(data, match)
        validate_decider_sets(sets, decider)
        total1, total2, sets, _ = _tennis_sets_to_scores([list(s) for s in sets], decider)
        score = (total1, total2)
        if len(sets) == 3:
            third_set_loss = True
    t = data["tournament"]
    tournament_type = data.get("type", "")

    if tournament_type == TournamentType.MEXICANO.value:
        if _is_mexicano_round_match(data, match):
            # record_result handles both first-time and re-recording.
            t.record_result(match.id, score)
        else:
            t.record_playoff_result(match.id, score, sets=sets)
    elif tournament_type == TournamentType.GROUP_PLAYOFF.value:
        # Determine whether this is a group or playoff match.
        in_playoff = match.id not in _collect_group_match_ids(t)
        if in_playoff:
            t.record_playoff_result(match.id, score, sets=sets)
        else:
            t.record_group_result(match.id, score, sets=sets, third_set_loss=third_set_loss)
    elif tournament_type == TournamentType.PLAYOFF.value:
        t.record_result(match.id, score, sets=sets)
    if sets is not None:
        match.decider = decider
    return score


def _collect_group_match_ids(t: GroupPlayoffTournament) -> set[str]:
    """Return the set of group-stage match IDs for fast membership testing."""
    ids: set[str] = set()
    for group in getattr(t, "groups", []):
        ids.update(m.id for m in getattr(group, "matches", []))
    return ids


def _is_mexicano_round_match(data: dict, match: Match) -> bool:
    """Return True for a Mexicano round match (not a Mexicano play-off match)."""
    if data.get("type") != TournamentType.MEXICANO.value:
        return False
    t = data["tournament"]
    return any(m.id == match.id for m in t.all_matches())


def _check_mexicano_round_sum(data: dict, match: Match, score1: int, score2: int) -> None:
    """Raise 400 unless a Mexicano round score sums to the match's points target."""
    if not _is_mexicano_round_match(data, match):
        return
    target = data["tournament"]._points_target_for(match)
    if score1 + score2 != target:
        raise HTTPException(400, f"Scores must sum to {target}, got {score1} + {score2} = {score1 + score2}")


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
        mode = tv.get("score_confirmation", ScoreConfirmation.IMMEDIATE)

        # In 'required' mode, apply the pending score to the engine.
        if mode == ScoreConfirmation.REQUIRED and match.status == MatchStatus.IN_PROGRESS:
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
        await save_tournament(tid)
        await update_live_stats(tid)
        elo_after_score(tid, data, match)

    notify_score_accepted(tid, data, match, player.player_id)
    winners = tournament_winners(t)
    if winners:
        if len(winners) == 1:
            notify_champion(tid, data, [p.name for p in winners[0]])
        else:
            notify_winners(tid, data, [[p.name for p in team] for team in winners])
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

        _check_mexicano_round_sum(data, match, req.score1, req.score2)

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
        await save_tournament(tid)

    notify_score_disputed(tid, data, match, player.player_id)
    return {"ok": True}


@router.post("/{tid}/matches/{mid}/correct-tennis")
async def correct_score_tennis(
    tid: str,
    mid: str,
    req: RecordTennisScoreRequest,
    player: PlayerIdentity = Depends(get_current_player),
) -> dict:
    """Submit a tennis-format score correction on behalf of the opposing team.

    The third set is validated against the match's effective decider right
    away (a match tie-break must be e.g. 10-8), so the player gets a clear
    400 instead of a failure at resolution time.
    """
    if player is None or player.tournament_id != tid:
        raise HTTPException(403, "Player authentication required")

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")

        total1, total2, sets_tuples, _, _decider = _prepare_set_score(data, match, req.sets)

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
        await save_tournament(tid)

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
            final_score = _apply_score_to_tournament(tid, data, match, final_score, final_sets)
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
        await save_tournament(tid)
        await update_live_stats(tid)
        elo_after_score(tid, data, match)

    notify_score_accepted(tid, data, match, player.player_id)
    winners = tournament_winners(t)
    if winners:
        if len(winners) == 1:
            notify_champion(tid, data, [p.name for p in winners[0]])
        else:
            notify_winners(tid, data, [[p.name for p in team] for team in winners])
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
        await save_tournament(tid)

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

        if req.chosen == DisputeChoice.ORIGINAL:
            final_score = match.score
            final_sets = match.sets
        elif req.chosen == DisputeChoice.CORRECTION:
            if match.dispute_score is None:
                raise HTTPException(400, "No correction score available")
            final_score = match.dispute_score
            final_sets = list(match.dispute_sets) if match.dispute_sets else None
        else:  # "custom"
            if req.sets:
                # Set scores: the server derives the match score (game totals
                # under the effective decider, adjusted so the set winner
                # always wins) and ignores any client-supplied score1/score2,
                # which may be raw game sums.
                total1, total2, sets_tuples, _, _decider = _prepare_set_score(data, match, req.sets)
                final_score = (total1, total2)
                final_sets = list(sets_tuples)
            else:
                if req.score1 is None or req.score2 is None:
                    raise HTTPException(400, "score1 and score2 are required for custom resolution")
                final_score = (req.score1, req.score2)
                final_sets = None

        # Apply the resolved score to the tournament engine so standings / credits
        # reflect the final decision.  'original' re-applies the same score which
        # is safe (record_result reverses previous credits for Mexicano).
        try:
            final_score = _apply_score_to_tournament(tid, data, match, final_score, final_sets)
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
        await save_tournament(tid)
        await update_live_stats(tid)
        elo_recalculate_tournament(tid)

    winners = tournament_winners(t)
    if winners:
        if len(winners) == 1:
            notify_champion(tid, data, [p.name for p in winners[0]])
        else:
            notify_winners(tid, data, [[p.name for p in team] for team in winners])
    return {"ok": True}


def _clear_in_tournament(data: dict, match: Match) -> None:
    """Dispatch a result clear to the engine matching the tournament type."""
    t = data["tournament"]
    tournament_type = data.get("type", "")
    if tournament_type == TournamentType.MEXICANO.value:
        if _is_mexicano_round_match(data, match):
            t.clear_result(match.id)
        else:
            t.clear_playoff_result(match.id)
    elif tournament_type == TournamentType.GROUP_PLAYOFF.value:
        if match.id not in _collect_group_match_ids(t):
            t.clear_playoff_result(match.id)
        else:
            t.clear_group_result(match.id)
    elif tournament_type == TournamentType.PLAYOFF.value:
        t.clear_result(match.id)
    else:
        raise RuntimeError("Unsupported tournament type")


@router.post("/{tid}/matches/{mid}/clear", response_model=ClearMatchResponse)
async def clear_match_result(
    tid: str,
    mid: str,
    user: User = Depends(get_current_user),
) -> ClearMatchResponse:
    """Revert a match to unplayed (organiser/admin only).

    The engine refuses (409) when later state depends on the result.  ELO is
    recalculated afterwards when the match had been rated.
    """
    _require_editor_access(tid, user)

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")
        if match.score is None and match.status == MatchStatus.SCHEDULED and not match.format_review:
            raise HTTPException(409, "Match has no result to clear")
        if str(getattr(t, "phase", "")) == "finished":
            raise HTTPException(409, "Finished tournaments cannot be reopened; edit the score instead")

        prev_score = list(match.score) if match.score else None
        prev_sets = [list(s) for s in match.sets] if match.sets else None
        sport = data.get("sport", "padel")
        had_elo_log = has_match_elo_log(tid, mid, sport)

        try:
            _clear_in_tournament(data, match)
        except KeyError as e:
            raise HTTPException(404, str(e))
        except (MatchClearBlocked, ValueError, RuntimeError) as e:
            raise HTTPException(409, str(e))

        match.score_history.append(
            {
                "player_id": user.username,
                "action": "admin_clear",
                "score": prev_score,
                "sets": prev_sets,
                "timestamp": time.time(),
            }
        )
        await save_tournament(tid)
        await update_live_stats(tid)
        if had_elo_log:
            elo_recalculate_tournament(tid)
        return ClearMatchResponse(ok=True, phase=str(getattr(t, "phase", "")))


@router.post("/{tid}/matches/{mid}/approve-review")
async def approve_format_review(tid: str, mid: str, user: User = Depends(get_current_user)) -> dict:
    """Accept a player score that was submitted in a non-default format (organiser only).

    The parked ``review_score`` / ``review_sets`` are applied to the engine as
    if the organiser had recorded them.
    """
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")
        if not match.format_review or match.review_score is None:
            raise HTTPException(409, "Match has no score awaiting review")
        sets = list(match.review_sets) if match.review_sets else None
        # Approving adopts the format the match was actually played in, so the
        # stored score, the decider validation and the match's chip all agree.
        previous_override = match.format_override
        prev = previous_override or MatchFormatOverride()
        match.format_override = MatchFormatOverride(
            mode=InputFormat.SETS if sets else InputFormat.POINTS,
            points_target=prev.points_target,
            decider=(match.review_decider or prev.decider) if sets else prev.decider,
            set_by=user.username,
            set_at=time.time(),
        )
        try:
            _apply_score_to_tournament(tid, data, match, match.review_score, sets)
        except (ValueError, RuntimeError, KeyError) as e:
            match.format_override = previous_override
            raise HTTPException(400, str(e))
        _mark_admin_score(match, user.username)
        match.score_history[-1]["action"] = "approve_review"
        await save_tournament(tid)
        await update_live_stats(tid)
        elo_after_score(tid, data, match)

    winners = tournament_winners(t)
    if winners:
        if len(winners) == 1:
            notify_champion(tid, data, [p.name for p in winners[0]])
        else:
            notify_winners(tid, data, [[p.name for p in team] for team in winners])
    return {"ok": True}


@router.post("/{tid}/matches/{mid}/reject-review")
async def reject_format_review(tid: str, mid: str, user: User = Depends(get_current_user)) -> dict:
    """Discard a player score parked for format review; players may submit again."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        match = _find_match_full(data["tournament"], mid)
        if match is None:
            raise HTTPException(404, "Match not found")
        if not match.format_review:
            raise HTTPException(409, "Match has no score awaiting review")
        _clear_format_review(match)
        match.score_history.append(
            {
                "player_id": user.username,
                "action": "reject_review",
                "score": None,
                "sets": None,
                "timestamp": time.time(),
            }
        )
        await save_tournament(tid)
    return {"ok": True}


@router.patch("/{tid}/matches/{mid}/format", response_model=MatchFormatResponse)
async def set_match_format(
    tid: str,
    mid: str,
    req: SetMatchFormatRequest,
    user: User = Depends(get_current_user),
) -> MatchFormatResponse:
    """Set or clear the scoring-format override of one match (organiser only).

    - ``mode`` (points / sets) only changes which inputs the score forms show;
      it is allowed on any match, including completed ones, and never touches a
      stored score.  ``sets`` is rejected for Mexicano round matches.
    - ``points_target`` applies to Mexicano round matches only.  Changing the
      effective target of a match that already holds a score (completed, or a
      pending player score) requires a replacement ``score1``/``score2`` in the
      same request; the score is re-recorded against the new target as an
      organiser correction.
    - ``decider`` (full set / match tie-break) applies to set-capable matches
      only.  Changing the decider of a match whose stored score went to a
      third set requires replacement ``sets`` in the same request (409
      otherwise); the sets are re-recorded under the new decider.  Two-set
      and points scores are unaffected, so the change is applied freely.
    - Disputed matches are rejected (409) until the dispute is resolved.

    Players never reach this endpoint: it requires an organiser JWT
    (``get_current_user``) with editor access to the tournament.
    """
    _require_editor_access(tid, user)

    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        match = _find_match_full(t, mid)
        if match is None:
            raise HTTPException(404, "Match not found")

        if match.disputed:
            raise HTTPException(409, "Resolve the dispute before changing the format")

        is_mex_round = _is_mexicano_round_match(data, match)
        body = req.override
        new_mode = InputFormat(body.mode) if body and body.mode else None
        new_target = body.points_target if body else None
        new_decider = SetDecider(body.decider) if body and body.decider else None

        if new_mode == InputFormat.SETS and is_mex_round:
            raise HTTPException(400, "Mexicano round matches are scored in points only")
        if new_target is not None and not is_mex_round:
            raise HTTPException(400, "A points target only applies to Mexicano round matches")
        if new_decider is not None and is_mex_round:
            raise HTTPException(400, "A third-set decider only applies to matches scored in sets")

        # A target equal to the tournament total is the default, not an override.
        if is_mex_round and new_target == t.total_points_per_match:
            new_target = None

        new_override: MatchFormatOverride | None = None
        if new_mode is not None or new_target is not None or new_decider is not None:
            new_override = MatchFormatOverride(
                mode=new_mode,
                points_target=new_target,
                decider=new_decider,
                set_by=user.username,
                set_at=time.time(),
            )

        rescore = False
        rescore_sets = False
        restamp_decider: SetDecider | None = None
        if not is_mex_round and match.sets and match.score is not None:
            # The stored set score keeps the decider it was recorded under;
            # compare that with what the match would use after this change.
            decider_after = new_decider or _tv_default_decider(data)
            if match_decider(match) != decider_after:
                if len(match.sets) == 3:
                    if not req.sets:
                        raise HTTPException(409, "Re-enter the score to change this match's format")
                    rescore_sets = True
                else:
                    restamp_decider = decider_after
        if is_mex_round:
            old_target = t._points_target_for(match)
            target_after = new_target or t.total_points_per_match
            has_score = match.score is not None and match.status in (MatchStatus.COMPLETED, MatchStatus.IN_PROGRESS)
            if has_score and old_target != target_after:
                if req.sets:
                    raise HTTPException(400, "Mexicano round matches are scored in points only")
                if req.score1 is None or req.score2 is None:
                    raise HTTPException(409, "Re-enter the score to change this match's format")
                rescore = True

        previous_override = match.format_override
        match.format_override = new_override
        if rescore:
            try:
                t.record_result(match.id, (req.score1, req.score2))
            except (ValueError, RuntimeError, KeyError) as e:
                match.format_override = previous_override
                raise HTTPException(400, str(e))
            _mark_admin_score(match, user.username)
        elif rescore_sets:
            try:
                _apply_score_to_tournament(tid, data, match, (0, 0), [tuple(s) for s in req.sets])
            except (ValueError, RuntimeError, KeyError) as e:
                match.format_override = previous_override
                raise HTTPException(400, str(e))
            _mark_admin_score(match, user.username)
            rescore = True
        elif restamp_decider is not None:
            match.decider = restamp_decider

        match.score_history.append(
            {
                "player_id": user.username,
                "action": "format_override",
                "score": list(match.score) if match.score else None,
                "sets": [list(s) for s in match.sets] if match.sets else None,
                "timestamp": time.time(),
                "override": _serialize_format_override(match),
            }
        )
        await save_tournament(tid)
        await update_live_stats(tid)
        if rescore:
            elo_recalculate_tournament(tid)

        payload = _serialize_match(match, t._points_target_for(match) if is_mex_round else None)

    return MatchFormatResponse(ok=True, match=payload)


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
