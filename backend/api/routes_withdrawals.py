"""
Participant withdrawal endpoints (all tournament types, organiser only).

* ``GET  /api/tournaments/{tid}/withdrawals/preview?player_id=`` — what a
  withdrawal would do (dry run).
* ``POST /api/tournaments/{tid}/withdrawals`` — withdraw.
* ``DELETE /api/tournaments/{tid}/withdrawals/{entry_key}`` — undo a
  group-stage withdrawal (play-off forfeits cannot be undone).

The engine (``backend/tournaments/withdrawal.py``) picks the case from the
format, phase and team mode; this module only maps it to HTTP, persists, and
runs the ELO / finish side effects.  Mexicano rounds keep the existing
``DELETE /{tid}/players/{pid}`` remove.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from ..auth.deps import get_current_user
from ..auth.models import User
from ..models import GPPhase, InputFormat, Match, SetDecider, TournamentType
from ..tournaments.errors import WithdrawalBlocked
from ..tournaments.playoff import bracket_matches
from ..tournaments.set_format import format_sets, match_decider
from ..tournaments.withdrawal import (
    WalkoverTemplate,
    WithdrawalKind,
    WithdrawalPlan,
    WithdrawalRecord,
    bracket_teams,
    check_template_fits,
    deciders_needed,
    entry_member_ids,
    modes_needed,
    plan_bracket_forfeit,
)
from .elo_integration import elo_finish_tournament, elo_recalculate_tournament
from .elo_store import has_match_elo_log
from .helpers import _require_editor_access, _tv_default_decider, tournament_winners
from .push_events import notify_champion, notify_winners
from .schemas import (
    UndoWithdrawalResponse,
    WalkoverScoreIn,
    WithdrawalBlockerItem,
    WithdrawalMatchItem,
    WithdrawalPreviewResponse,
    WithdrawalSummary,
    WithdrawRequest,
    WithdrawResponse,
)
from .state import _tournaments, get_tournament_lock, save_tournament, update_live_stats

router = APIRouter(prefix="/api/tournaments", tags=["withdrawals"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_any_tournament(tid: str) -> dict:
    data = _tournaments.get(tid)
    if not data:
        raise HTTPException(404, "Tournament not found")
    return data


def _stage_key(data: dict) -> str:
    """``tv_settings.score_mode`` key of the stage withdrawals currently affect."""
    ttype = data.get("type")
    t = data["tournament"]
    if ttype == TournamentType.GROUP_PLAYOFF.value:
        return "gp-group" if t.phase == GPPhase.GROUPS else "gp-playoff"
    if ttype == TournamentType.PLAYOFF.value:
        return "po-playoff"
    return "mex-playoff"


def _template(data: dict, body: WalkoverScoreIn | None) -> WalkoverTemplate:
    """Walkover template from the organiser's score (or the defaults) and the stage settings."""
    raw_mode = ((data.get("tv_settings") or {}).get("score_mode") or {}).get(_stage_key(data))
    template = WalkoverTemplate(
        stage_mode=InputFormat.SETS if raw_mode == InputFormat.SETS.value else InputFormat.POINTS,
        default_decider=_tv_default_decider(data),
    )
    if body is not None and body.points is not None:
        template.points = (int(body.points[0]), int(body.points[1]))
    if body is not None and body.sets is not None:
        template.sets = [(int(a), int(b)) for a, b in body.sets]
    return template


def _plan(t: object, person_id: str) -> WithdrawalPlan:
    try:
        return t.plan_withdrawal(person_id)  # type: ignore[attr-defined]
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'\""))
    except WithdrawalBlocked as e:
        raise HTTPException(409, str(e))


def _names(team: list) -> str:
    return " & ".join(p.name for p in team)


def _score_text(m: Match) -> str | None:
    if m.sets:
        return format_sets(m.sets, match_decider(m))
    return f"{m.score[0]}-{m.score[1]}" if m.score else None


def _match_item(m: Match, entry_key: str, template: WalkoverTemplate | None = None) -> WithdrawalMatchItem:
    """Dialog row for *m*; with a *template*, also the walkover score (winner first)."""
    entry_ids = set(entry_key.split("+"))
    withdrawn_is_team1 = any(p.id in entry_ids for p in m.team1)
    opponent = m.team2 if withdrawn_is_team1 else m.team1
    resulting: str | None = None
    mode: InputFormat | None = None
    decider: SetDecider | None = None
    if template is not None:
        mode = template.mode_for(m)
        decider = template.decider_for(m) if mode == InputFormat.SETS else None
        # Oriented winner first: pretend the winner is team1.
        res = template.result_for(m, withdrawn_is_team1=False)
        resulting = format_sets(res.sets, res.decider) if res.sets else f"{res.score[0]}-{res.score[1]}"
    return WithdrawalMatchItem(
        match_id=m.id,
        round_label=m.round_label or "",
        court=m.court.name if m.court else None,
        team1=[p.name for p in m.team1],
        team2=[p.name for p in m.team2],
        opponent=_names(opponent),
        current_score=_score_text(m),
        resulting_score=resulting,
        mode=mode,
        decider=decider,
    )


def _member_names(t: object, record_or_entry: list) -> list[str]:
    team_member_names: dict[str, list[str]] = getattr(t, "team_member_names", None) or {}
    out: list[str] = []
    for p in record_or_entry:
        out.extend(team_member_names.get(p.id) or [p.name])
    return out


def withdrawal_summaries(t: object) -> list[dict]:
    """``withdrawals`` list for the status payloads (JSON-ready dicts)."""
    records: dict[str, WithdrawalRecord] = getattr(t, "withdrawals", None) or {}
    out: list[dict] = []
    for key, r in records.items():
        undo_reason = t.undo_block_reason(key) if hasattr(t, "undo_block_reason") else "n/a"  # type: ignore[attr-defined]
        out.append(_summary(t, r, undo_allowed=undo_reason is None).model_dump(mode="json"))
    return out


def _summary(t: object, r: WithdrawalRecord, *, undo_allowed: bool) -> WithdrawalSummary:
    return WithdrawalSummary(
        entry_key=r.entry_key,
        name=r.name,
        member_ids=list(r.member_ids),
        member_names=_member_names(t, r.entry),
        kind=r.kind,
        group=r.group_name,
        played=r.played,
        total=r.total,
        walkovers=len(r.walkover_match_ids),
        at=r.at,
        undo_allowed=undo_allowed,
    )


def withdraw_unavailable_ids(t: object) -> list[str]:
    """Person ids that cannot be withdrawn because their bracket run is over.

    Only computed while a bracket is live: an entry that already lost (or won)
    its last bracket match, or a person who never reached the play-offs.  Ids
    covered by a withdrawal are left out (they show Undo / the badge instead).
    Empty outside the play-off phases, so the client keeps showing Withdraw.
    """
    bracket = getattr(t, "playoff_bracket", None) or getattr(t, "bracket", None)
    phase = getattr(getattr(t, "phase", None), "value", getattr(t, "phase", None))
    if bracket is None or phase == "finished":
        return []
    roster: dict[str, list[str]] = getattr(t, "team_roster", None) or {}
    records: dict[str, WithdrawalRecord] = getattr(t, "withdrawals", None) or {}
    alive: set[str] = set()
    known: set[str] = {p.id for p in getattr(t, "players", []) or []}
    for team in bracket_teams(bracket):
        known.update(entry_member_ids(team, roster))
        try:
            plan_bracket_forfeit(bracket, team, records)
        except WithdrawalBlocked:
            continue
        alive.update(entry_member_ids(team, roster))
    for members in roster.values():
        known.update(members)
    covered = {pid for r in records.values() for pid in r.member_ids}
    return sorted(known - alive - covered)


def _notify_finish(tid: str, data: dict, winners: list[list] | None) -> None:
    if not winners:
        return
    elo_finish_tournament(tid)
    if len(winners) == 1:
        notify_champion(tid, data, [p.name for p in winners[0]])
    else:
        notify_winners(tid, data, [[p.name for p in team] for team in winners])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/{tid}/withdrawals/preview", response_model=WithdrawalPreviewResponse)
async def preview_withdrawal(
    tid: str,
    player_id: str = Query(min_length=1, max_length=64),
    user: User = Depends(get_current_user),
) -> WithdrawalPreviewResponse:
    """Dry run: what withdrawing *player_id* would do.  Blockers are listed, not raised."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        plan = _plan(t, player_id)
        template = _template(data, None)
        affected = plan.affected_walkover_matches
        sport = data.get("sport", "padel")
        # Round labels for the blocker list.
        lookup: dict[str, Match] = {}
        for g in getattr(t, "groups", []) or []:
            lookup.update({m.id: m for m in g.matches})
        bracket = getattr(t, "bracket", None) or getattr(t, "playoff_bracket", None)
        if bracket is not None:
            lookup.update({m.id: m for m in bracket_matches(bracket)})
        return WithdrawalPreviewResponse(
            entry_key=plan.entry_key,
            entry_name=_names(plan.entry),
            member_names=_member_names(t, plan.entry),
            kind=plan.kind,
            group=plan.group_name,
            played=plan.played,
            total=plan.total,
            annul_matches=[_match_item(m, plan.entry_key) for m in plan.annul_matches],
            walkover_matches=[_match_item(m, plan.entry_key, template) for m in plan.walkover_matches],
            dropped_match=_match_item(plan.dropped_match, plan.entry_key) if plan.dropped_match else None,
            sit_out_names=[p.name for p in plan.sit_out_players],
            pending_forfeit_match=(
                _match_item(plan.pending_forfeit_match, plan.entry_key, template)
                if plan.pending_forfeit_match
                else None
            ),
            advance_to=plan.advance_to,
            opponent_tbd=plan.tbd,
            lb_drop=plan.lb_drop,
            third_place_note=plan.third_place_note,
            active_after=plan.active_after,
            modes_needed=(
                modes_needed(template, affected, plan.future_walkovers)
                if plan.kind in (WithdrawalKind.WALKOVER, WithdrawalKind.FORFEIT)
                else []
            ),
            walkover_defaults=WalkoverScoreIn.defaults(),
            default_decider=template.default_decider,
            deciders_needed=(
                deciders_needed(template, affected, plan.future_walkovers)
                if plan.kind in (WithdrawalKind.WALKOVER, WithdrawalKind.FORFEIT)
                else []
            ),
            elo_recalc=any(m.score is not None and has_match_elo_log(tid, m.id, sport) for m in plan.annul_matches),
            undo_possible=plan.undo_possible,
            blockers=[
                WithdrawalBlockerItem(
                    match_id=b.match_id,
                    round_label=lookup[b.match_id].round_label if b.match_id in lookup else "",
                    reason=b.reason,
                )
                for b in plan.blockers
            ],
        )


@router.post("/{tid}/withdrawals", response_model=WithdrawResponse)
async def withdraw_participant(
    tid: str,
    req: WithdrawRequest,
    user: User = Depends(get_current_user),
) -> WithdrawResponse:
    """Withdraw a participant.  The outcome must match the confirmed preview (``expected_kind``)."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        sport = data.get("sport", "padel")
        plan = _plan(t, req.player_id)
        if plan.kind != req.expected_kind:
            raise HTTPException(409, "The withdrawal outcome changed; review it again")
        if plan.blockers:
            raise HTTPException(409, "Settle the pending, disputed or under-review scores first")
        template = _template(data, req.walkover)
        if plan.kind in (WithdrawalKind.WALKOVER, WithdrawalKind.FORFEIT):
            try:
                check_template_fits(template, plan.affected_walkover_matches, plan.future_walkovers)
            except ValueError as e:
                raise HTTPException(422, str(e))
        had_elo = any(m.score is not None and has_match_elo_log(tid, m.id, sport) for m in plan.annul_matches)
        try:
            record, created = t.withdraw(
                req.player_id,
                template=template,
                expected_kind=req.expected_kind,
                by=user.username,
            )
        except KeyError as e:
            raise HTTPException(404, str(e).strip("'\""))
        except (WithdrawalBlocked, ValueError, RuntimeError) as e:
            raise HTTPException(409, str(e))
        await save_tournament(tid)
        await update_live_stats(tid)
        if had_elo:
            elo_recalculate_tournament(tid)
        undo_reason = t.undo_block_reason(record.entry_key)
        response = WithdrawResponse(
            ok=True,
            withdrawal=_summary(t, record, undo_allowed=undo_reason is None),
            walkovers_created=len(created),
            phase=str(t.phase),
            elo_recalculated=had_elo,
        )
    if record.kind == WithdrawalKind.FORFEIT:
        _notify_finish(tid, data, tournament_winners(t))
    return response


@router.delete("/{tid}/withdrawals/{entry_key}", response_model=UndoWithdrawalResponse)
async def undo_withdrawal(
    tid: str,
    entry_key: str,
    user: User = Depends(get_current_user),
) -> UndoWithdrawalResponse:
    """Undo a group-stage withdrawal (409 for play-off forfeits and when no longer possible)."""
    _require_editor_access(tid, user)
    async with get_tournament_lock(tid):
        data = _get_any_tournament(tid)
        t = data["tournament"]
        records: dict[str, WithdrawalRecord] = getattr(t, "withdrawals", None) or {}
        record = records.get(entry_key)
        if record is None:
            raise HTTPException(404, "Withdrawal not found")
        reason = t.undo_block_reason(entry_key)
        if reason is not None:
            raise HTTPException(409, reason)
        had_results = record.kind == WithdrawalKind.ANNUL and any(m.score is not None for m in record.annulled_matches)
        try:
            t.undo_withdrawal(entry_key, by=user.username)
        except KeyError as e:
            raise HTTPException(404, str(e).strip("'\""))
        except (WithdrawalBlocked, ValueError, RuntimeError) as e:
            raise HTTPException(409, str(e))
        await save_tournament(tid)
        await update_live_stats(tid)
        if had_results:
            elo_recalculate_tournament(tid)
        return UndoWithdrawalResponse(ok=True, phase=str(t.phase), elo_recalculated=had_results)
