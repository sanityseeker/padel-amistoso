"""
Tournament CRUD routes — list, delete, and TV settings for tournaments.
"""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from ..auth.deps import get_current_user, get_current_user_optional
from ..auth.models import User, UserRole
from ..email import (
    is_configured as email_is_configured,
    is_valid_email,
    render_next_round_email,
    render_tournament_message_email,
    render_tournament_results_email,
    render_tournament_started_email,
    send_email,
)
from ..models import MatchStatus
from .helpers import _find_match, _require_editor_access, _require_owner_or_admin
from .db import get_shared_tournament_ids
from .player_secret_store import (
    delete_secrets_for_tournament,
    extract_history_stats,
    extract_partner_rival_stats,
    get_secrets_for_tournament,
)
from .rate_limit import BoundedRateLimiter
from .schemas import (
    EmailSettings,
    EmailSettingsRequest,
    SetAliasRequest,
    SetMatchCommentRequest,
    SetPublicRequest,
    TournamentMessageRequest,
    TvSettings,
    TvSettingsRequest,
)
from . import state
from .state import _delete_tournament, _save_tournament, _tournaments

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])

_notify_rate_limiter = BoundedRateLimiter(max_attempts=10, window_seconds=60, max_tracked_ips=4096)
_email_send_rate_limiter = BoundedRateLimiter(max_attempts=30, window_seconds=60, max_tracked_ips=4096)


@router.get("")
async def list_tournaments(current_user: User | None = Depends(get_current_user_optional)) -> list[dict]:
    """Return a list of tournaments visible to the caller.

    - **Admin**: all tournaments.
    - **Authenticated user**: only their own tournaments.
    - **Guest (unauthenticated)**: only publicly listed tournaments (``public=True``).
    """
    out = []
    shared_ids: set[str] = set()
    if current_user is not None and current_user.role != UserRole.ADMIN:
        shared_ids = set(get_shared_tournament_ids(current_user.username))
    for tid, data in _tournaments.items():
        # Visibility filter
        if current_user is None:
            if not data.get("public", True):
                continue
        elif current_user.role != UserRole.ADMIN:
            is_owner = data.get("owner") == current_user.username
            if not is_owner and tid not in shared_ids:
                continue

        t = data.get("tournament")
        out.append(
            {
                "id": tid,
                "name": data["name"],
                "type": data["type"],
                "alias": data.get("alias"),
                "team_mode": t.team_mode if t else False,
                "phase": t.phase if t else "setup",
                "owner": data.get("owner"),
                "public": data.get("public", True),
                "sport": data.get("sport", "padel"),
                "shared": current_user is not None and tid in shared_ids,
            }
        )
    return out


@router.delete("/{tournament_id}")
async def delete_tournament(tournament_id: str, user: User = Depends(get_current_user)) -> dict:
    _require_owner_or_admin(tournament_id, user)
    async with state.get_tournament_lock(tournament_id):
        if tournament_id not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        t_data = _tournaments[tournament_id]
        entity_name = t_data.get("name", "")
        player_stats = extract_history_stats(t_data)
        del _tournaments[tournament_id]
        _delete_tournament(tournament_id)
        delete_secrets_for_tournament(
            tournament_id,
            entity_name=entity_name,
            player_stats=player_stats,
            sport=t_data.get("sport", "padel"),
            partner_rival_stats=extract_partner_rival_stats(t_data),
        )
    return {"ok": True}


@router.get("/{tid}/version")
async def get_tournament_version(tid: str, request: Request) -> Response:
    """Return a counter bumped on every mutation (score recorded, round advanced, etc.).

    The TV display polls this cheaply (~every 2 s) and triggers a full reload
    only when the value changes, enabling \"on-update\" refresh mode.
    Supports conditional GET via ETag / If-None-Match.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    v = state._tournament_versions.get(tid, 0)
    etag = f'"v{v}"'
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304)
    return Response(
        content=json.dumps({"version": v}),
        media_type="application/json",
        headers={"ETag": etag, "Cache-Control": "private, no-cache, max-age=0, must-revalidate"},
    )


@router.get("/{tid}/tv-settings")
async def get_tv_settings(tid: str) -> dict:
    """Return the current TV display settings for a tournament."""
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    stored = _tournaments[tid].get("tv_settings")
    settings = TvSettings(**stored) if stored else TvSettings()
    return settings.model_dump()


@router.patch("/{tid}/tv-settings")
async def update_tv_settings(tid: str, req: TvSettingsRequest, user: User = Depends(get_current_user)) -> dict:
    """Partially update TV display settings (only supplied fields are changed)."""
    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        stored = _tournaments[tid].get("tv_settings")
        current = TvSettings(**stored) if stored else TvSettings()
        patch = req.model_dump(exclude_none=True)
        # Merge score_mode dict instead of replacing it entirely, so the admin
        # can update a single context at a time.
        if "score_mode" in patch:
            merged = {**current.score_mode, **patch.pop("score_mode")}
            patch["score_mode"] = merged
        updated = current.model_copy(update=patch)
        _tournaments[tid]["tv_settings"] = updated.model_dump()
        _save_tournament(tid)
    return updated.model_dump()


# ────────────────────────────────────────────────────────────────────────────
# Per-tournament email settings
# ────────────────────────────────────────────────────────────────────────────


def _get_email_settings(tid: str) -> EmailSettings:
    """Return the current email settings for a tournament, falling back to defaults."""
    stored = _tournaments[tid].get("email_settings")
    return EmailSettings(**stored) if stored else EmailSettings()


@router.get("/{tid}/email-settings")
async def get_email_settings(tid: str, user: User = Depends(get_current_user)) -> dict:
    """Return the current per-tournament email customisation settings."""
    _require_editor_access(tid, user)
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    return _get_email_settings(tid).model_dump()


@router.patch("/{tid}/email-settings")
async def update_email_settings(tid: str, req: EmailSettingsRequest, user: User = Depends(get_current_user)) -> dict:
    """Partially update per-tournament email customisation settings.

    Only supplied (non-null) fields are changed.
    """
    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        current = _get_email_settings(tid)
        patch = req.model_dump(exclude_none=True)
        updated = current.model_copy(update=patch)
        _tournaments[tid]["email_settings"] = updated.model_dump()
        _save_tournament(tid)
    return updated.model_dump()


@router.patch("/{tid}/public")
async def set_public(tid: str, req: SetPublicRequest, user: User = Depends(get_current_user)) -> dict:
    """Set whether the tournament is publicly listed for guests."""
    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        _tournaments[tid]["public"] = req.public
        _save_tournament(tid)
    return {"ok": True, "public": req.public}


@router.put("/{tid}/alias")
async def set_alias(tid: str, req: SetAliasRequest, user: User = Depends(get_current_user)) -> dict:
    """Set a human-friendly alias for a tournament (used in TV URLs like /tv/my-tourney)."""
    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        # Check uniqueness: no other tournament should have this alias.
        for other_tid, data in _tournaments.items():
            if other_tid != tid and data.get("alias") == req.alias:
                raise HTTPException(409, f"Alias '{req.alias}' is already used by tournament {other_tid}")
        _tournaments[tid]["alias"] = req.alias
        _save_tournament(tid)
    return {"ok": True, "alias": req.alias}


@router.delete("/{tid}/alias")
async def delete_alias(tid: str, user: User = Depends(get_current_user)) -> dict:
    """Remove the alias from a tournament."""
    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        _tournaments[tid].pop("alias", None)
        _save_tournament(tid)
    return {"ok": True}


@router.get("/resolve-alias/{alias}")
async def resolve_alias(alias: str) -> dict:
    """Resolve a tournament alias to its ID. Public (used by TV page)."""
    for tid, data in _tournaments.items():
        if data.get("alias") == alias:
            return {"id": tid, "name": data["name"], "type": data["type"], "sport": data.get("sport", "padel")}
    raise HTTPException(404, f"No tournament with alias '{alias}'")


@router.get("/{tid}/meta")
async def get_tournament_meta(tid: str) -> dict:
    """Return minimal public metadata (name, type) for any tournament by ID.

    No auth or public-flag check — used by the TV page so private tournaments
    are still viewable when accessed directly by ID or alias.
    """
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")
    data = _tournaments[tid]
    t = data.get("tournament")
    return {
        "id": tid,
        "name": data["name"],
        "type": data["type"],
        "alias": data.get("alias"),
        "team_mode": t.team_mode if t else False,
        "phase": t.phase if t else "setup",
        "sport": data.get("sport", "padel"),
    }


@router.patch("/{tid}/match-comment")
async def set_match_comment(tid: str, req: SetMatchCommentRequest, user: User = Depends(get_current_user)) -> dict:
    """Set or clear an optional admin comment on a match."""
    _require_editor_access(tid, user)
    async with state.get_tournament_lock(tid):
        if tid not in _tournaments:
            raise HTTPException(404, "Tournament not found")
        tournament = _tournaments[tid]["tournament"]
        match = _find_match(tournament, req.match_id)
        if match is None:
            raise HTTPException(404, "Match not found")
        match.comment = req.comment.strip()
        _save_tournament(tid)
    return {"ok": True, "match_id": req.match_id, "comment": match.comment}


# ────────────────────────────────────────────────────────────────────────────
# Email status & notifications
# ────────────────────────────────────────────────────────────────────────────


@router.get("/email-status")
async def email_status() -> dict:
    """Return whether the server has email/SMTP configured."""
    return {"configured": email_is_configured()}


@router.post("/{tid}/notify-players")
async def notify_tournament_players(tid: str, request: Request, user: User = Depends(get_current_user)) -> dict:
    """Send a 'tournament started' email to all players with a valid email address."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = request.client.host if request.client else "unknown"
    _notify_rate_limiter.check(client_ip, "Too many notification attempts — try again later")
    _notify_rate_limiter.record(client_ip)

    _require_editor_access(tid, user)
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    data = _tournaments[tid]
    tournament_name = data["name"]
    alias = data.get("alias")
    es = _get_email_settings(tid)

    secrets = get_secrets_for_tournament(tid)
    sent = 0
    skipped = 0
    failed = 0
    for pid, info in secrets.items():
        email = info.get("email", "")
        if not email or not is_valid_email(email):
            skipped += 1
            continue
        subject, body = render_tournament_started_email(
            tournament_name=tournament_name,
            player_name=info["name"],
            passphrase=info["passphrase"],
            token=info["token"],
            tournament_id=tid,
            tournament_alias=alias,
            reply_to=es.reply_to,
        )
        ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}


@router.post("/{tid}/send-email/{player_id}")
async def send_tournament_player_email(
    tid: str, player_id: str, request: Request, user: User = Depends(get_current_user)
) -> dict:
    """Send a credentials email to a single tournament player."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = request.client.host if request.client else "unknown"
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    _require_editor_access(tid, user)
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    secrets = get_secrets_for_tournament(tid)
    info = secrets.get(player_id)
    if info is None:
        raise HTTPException(404, "Player not found in this tournament")

    email = info.get("email", "")
    if not email or not is_valid_email(email):
        raise HTTPException(422, "No valid email address on file for this player")

    data = _tournaments[tid]
    es = _get_email_settings(tid)
    subject, body = render_tournament_started_email(
        tournament_name=data["name"],
        player_name=info["name"],
        passphrase=info["passphrase"],
        token=info["token"],
        tournament_id=tid,
        tournament_alias=data.get("alias"),
        reply_to=es.reply_to,
    )
    ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
    if not ok:
        raise HTTPException(502, "Failed to send email — check server SMTP configuration")
    return {"sent": True}


@router.post("/{tid}/send-all-emails")
async def send_all_tournament_emails(tid: str, request: Request, user: User = Depends(get_current_user)) -> dict:
    """Send credentials emails to all tournament players that have a valid email address."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = request.client.host if request.client else "unknown"
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    _require_editor_access(tid, user)
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    data = _tournaments[tid]
    tournament_name = data["name"]
    alias = data.get("alias")
    es = _get_email_settings(tid)

    secrets = get_secrets_for_tournament(tid)
    sent = 0
    skipped = 0
    failed = 0
    for _pid, info in secrets.items():
        email = info.get("email", "")
        if not email or not is_valid_email(email):
            skipped += 1
            continue
        subject, body = render_tournament_started_email(
            tournament_name=tournament_name,
            player_name=info["name"],
            passphrase=info["passphrase"],
            token=info["token"],
            tournament_id=tid,
            tournament_alias=alias,
            reply_to=es.reply_to,
        )
        ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}


@router.post("/{tid}/send-message-emails")
async def send_tournament_message_emails(
    tid: str, req: TournamentMessageRequest, request: Request, user: User = Depends(get_current_user)
) -> dict:
    """Send an organizer message email to all tournament players with a valid email address."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = request.client.host if request.client else "unknown"
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    _require_editor_access(tid, user)
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    data = _tournaments[tid]
    tournament_name = data["name"]
    alias = data.get("alias")
    es = _get_email_settings(tid)

    secrets = get_secrets_for_tournament(tid)
    sent = 0
    skipped = 0
    failed = 0
    for _pid, info in secrets.items():
        email = info.get("email", "")
        if not email or not is_valid_email(email):
            skipped += 1
            continue
        subject, body = render_tournament_message_email(
            tournament_name=tournament_name,
            player_name=info["name"],
            message=req.message,
            token=info["token"],
            tournament_id=tid,
            tournament_alias=alias,
            reply_to=es.reply_to,
        )
        ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}


@router.post("/{tid}/send-next-round-emails")
async def send_next_round_emails(tid: str, request: Request, user: User = Depends(get_current_user)) -> dict:
    """Send a next-round notification email to all players with matches in the current round."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = request.client.host if request.client else "unknown"
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    _require_editor_access(tid, user)
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    data = _tournaments[tid]
    tournament = data["tournament"]
    tournament_name = data["name"]
    alias = data.get("alias")
    es = _get_email_settings(tid)

    # Determine current round matches across all tournament types
    current_matches: list = []
    round_number = 0
    stage = ""  # human-readable phase label included in round notification emails
    # Bracket reference — set when using a playoff bracket so bye teams can be detected
    playoff_bracket_ref = None
    if hasattr(tournament, "current_round_matches"):
        from ..models import MexPhase

        if tournament.phase == MexPhase.PLAYOFFS and tournament.playoff_bracket is not None:
            # Mexicano playoff phase — use bracket pending matches, not last Mexicano round
            playoff_bracket_ref = tournament.playoff_bracket
            current_matches = playoff_bracket_ref.pending_matches()
            round_number = max((m.round_number for m in current_matches), default=1)
            stage = "Play-offs"
        else:
            # Mexicano regular phase
            current_matches = tournament.current_round_matches()
            round_number = tournament.current_round
            stage = "Mexicano"
    elif hasattr(tournament, "groups"):
        # Group+Playoff — gather ALL non-completed group matches with real players
        for group in tournament.groups:
            for m in group.matches:
                if m.status != MatchStatus.COMPLETED and m.team1 and m.team2:
                    current_matches.append(m)
        # Use the first upcoming round as the fallback round_number
        if current_matches:
            round_number = min(m.round_number for m in current_matches)
            stage = "Group Stage"
        elif getattr(tournament, "playoff_bracket", None) is not None:
            # Group stage finished — fall back to playoff bracket matches
            playoff_bracket_ref = tournament.playoff_bracket
            current_matches = playoff_bracket_ref.pending_matches()
            round_number = max((m.round_number for m in current_matches), default=1)
            stage = "Play-offs"
    elif hasattr(tournament, "bracket") and tournament.bracket is not None:
        # Standalone Playoff — pending bracket matches with real players on both sides
        playoff_bracket_ref = tournament.bracket
        current_matches = playoff_bracket_ref.pending_matches()
        round_number = max((m.round_number for m in current_matches), default=1)

    if not current_matches and playoff_bracket_ref is None:
        raise HTTPException(400, "No current-round matches to notify about")

    def _bye_feeder_match(bracket, tbd_match_id: str, tbd_slot: int) -> tuple | None:
        """Return (feeder_match, is_loser) for the match feeding the TBD slot, or None."""
        match_map: dict = getattr(bracket, "_match_map", {})
        # SingleEliminationBracket: _next_match[feeder_id] = (target_id, slot)
        # Winners always advance, so is_loser is always False here.
        if hasattr(bracket, "_next_match"):
            for feeder_id, (target_id, slot) in bracket._next_match.items():
                if target_id == tbd_match_id and slot == tbd_slot:
                    feeder = match_map.get(feeder_id)
                    return (feeder, False) if feeder else None
        # DoubleEliminationBracket: _advancement[feeder_id] = [(target_id, slot, is_loser), ...]
        if hasattr(bracket, "_advancement"):
            for feeder_id, advancements in bracket._advancement.items():
                for target_id, slot, is_loser in advancements:
                    if target_id == tbd_match_id and slot == tbd_slot:
                        feeder = match_map.get(feeder_id)
                        return (feeder, is_loser) if feeder else None
        return None

    # Load secrets once for contact/email lookups
    secrets = get_secrets_for_tournament(tid)

    def _player_contact(pid: str) -> str:
        """Return the best available contact string for a player."""
        info = secrets.get(pid)
        if not info:
            return ""
        return info.get("contact") or info.get("email") or ""

    # Build per-player match info
    player_matches: dict[str, list[dict]] = {}
    for match in current_matches:
        court_name = match.court.name if match.court else ""
        comment = match.comment if match.comment else ""
        m_round = match.round_number
        m_label = match.round_label
        all_players = match.team1 + match.team2
        for player in match.team1:
            # Empty teammates means singles or team mode — no partner to show
            teammates = ", ".join(p.name for p in match.team1 if p.id != player.id)
            opponents = ", ".join(p.name for p in match.team2)
            contacts = [
                {"name": p.name, "info": _player_contact(p.id)}
                for p in all_players
                if p.id != player.id and _player_contact(p.id)
            ]
            player_matches.setdefault(player.id, []).append(
                {
                    "teammates": teammates,
                    "opponents": opponents,
                    "court": court_name,
                    "comment": comment,
                    "contacts": contacts,
                    "round_number": m_round,
                    "round_label": m_label,
                }
            )
        for player in match.team2:
            teammates = ", ".join(p.name for p in match.team2 if p.id != player.id)
            opponents = ", ".join(p.name for p in match.team1)
            contacts = [
                {"name": p.name, "info": _player_contact(p.id)}
                for p in all_players
                if p.id != player.id and _player_contact(p.id)
            ]
            player_matches.setdefault(player.id, []).append(
                {
                    "teammates": teammates,
                    "opponents": opponents,
                    "court": court_name,
                    "comment": comment,
                    "contacts": contacts,
                    "round_number": m_round,
                    "round_label": m_label,
                }
            )

    # Detect bye teams: players in a TBD match (one team set, opponent still unknown).
    # We find which feeder match is still pending so we can tell them who they're waiting for.
    if playoff_bracket_ref is not None:
        all_bracket_matches = list(getattr(playoff_bracket_ref, "_match_map", {}).values())
        for m in all_bracket_matches:
            if m.status == MatchStatus.COMPLETED:
                continue
            has_t1 = bool(m.team1)
            has_t2 = bool(m.team2)
            if has_t1 == has_t2:
                continue  # both teams known (real match) or both empty (skip)
            bye_team = m.team1 if has_t1 else m.team2
            tbd_slot = 1 if has_t1 else 0  # which slot is waiting on a feeder
            result = _bye_feeder_match(playoff_bracket_ref, m.id, tbd_slot)
            if result and result[0] and result[0].team1 and result[0].team2:
                feeder, is_loser = result
                t1_str = " & ".join(p.name for p in feeder.team1)
                t2_str = " & ".join(p.name for p in feeder.team2)
                winner_or_loser = "loser" if is_loser else "winner"
                waiting_for = f"{winner_or_loser} of {t1_str} vs {t2_str} ({feeder.round_label})"
            else:
                waiting_for = ""
            for player in bye_team:
                player_matches.setdefault(player.id, []).append(
                    {
                        "teammates": ", ".join(p.name for p in bye_team if p.id != player.id),
                        "opponents": "",
                        "court": "",
                        "comment": "",
                        "contacts": [],
                        "round_number": m.round_number,
                        "round_label": m.round_label,
                        "bye": True,
                        "waiting_for": waiting_for,
                    }
                )

    if not player_matches:
        raise HTTPException(400, "No current-round matches to notify about")
    sent = 0
    skipped = 0
    failed = 0
    for pid, matches_info in player_matches.items():
        info = secrets.get(pid)
        if not info:
            skipped += 1
            continue
        email = info.get("email", "")
        if not email or not is_valid_email(email):
            skipped += 1
            continue
        subject, body = render_next_round_email(
            tournament_name=tournament_name,
            player_name=info["name"],
            round_number=round_number,
            matches_info=matches_info,
            stage=stage,
            token=info["token"],
            tournament_id=tid,
            tournament_alias=alias,
            reply_to=es.reply_to,
        )
        ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}


@router.post("/{tid}/send-results-emails")
async def send_results_emails(tid: str, request: Request, user: User = Depends(get_current_user)) -> dict:
    """Send final tournament results email to all players with a valid email."""
    if not email_is_configured():
        raise HTTPException(400, "Email is not configured on this server")

    client_ip = request.client.host if request.client else "unknown"
    _email_send_rate_limiter.check(client_ip, "Too many email send attempts — try again later")
    _email_send_rate_limiter.record(client_ip)

    _require_editor_access(tid, user)
    if tid not in _tournaments:
        raise HTTPException(404, "Tournament not found")

    data = _tournaments[tid]
    tournament = data["tournament"]
    tournament_name = data["name"]
    alias = data.get("alias")
    es = _get_email_settings(tid)

    # Build leaderboard based on tournament type
    leaderboard: list[dict] = []
    if hasattr(tournament, "leaderboard"):
        # Mexicano
        lb = tournament.leaderboard()
        for entry in lb:
            if entry.get("removed"):
                continue
            leaderboard.append(
                {
                    "rank": entry["rank"],
                    "name": entry["player"],
                    "player_id": entry["player_id"],
                    "score": entry["total_points"],
                    "wins": entry.get("wins", 0),
                    "losses": entry.get("losses", 0),
                    "draws": entry.get("draws", 0),
                }
            )
    elif hasattr(tournament, "group_standings"):
        # Group+Playoff — flatten group standings
        all_standings: list[dict] = []
        for _group_name, standings in tournament.group_standings().items():
            all_standings.extend(standings)
        all_standings.sort(key=lambda s: (-s.get("wins", 0), -s.get("point_diff", 0), -s.get("points_for", 0)))
        for i, s in enumerate(all_standings):
            leaderboard.append(
                {
                    "rank": i + 1,
                    "name": s["player"],
                    "player_id": s["player_id"],
                    "score": s.get("points_for", 0),
                    "wins": s.get("wins", 0),
                    "losses": s.get("losses", 0),
                    "draws": s.get("draws", 0),
                }
            )
    else:
        raise HTTPException(400, "This tournament type does not support results emails")

    if not leaderboard:
        raise HTTPException(400, "No standings available yet")

    leaderboard_top = leaderboard[:10]
    total_players = len(leaderboard)

    # Build a lookup: player_id -> leaderboard entry
    player_lb = {e["player_id"]: e for e in leaderboard}

    secrets = get_secrets_for_tournament(tid)
    sent = 0
    skipped = 0
    failed = 0
    for pid, info in secrets.items():
        email = info.get("email", "")
        if not email or not is_valid_email(email):
            skipped += 1
            continue
        entry = player_lb.get(pid)
        if not entry:
            skipped += 1
            continue
        subject, body = render_tournament_results_email(
            tournament_name=tournament_name,
            player_name=info["name"],
            rank=entry["rank"],
            total_players=total_players,
            stats={
                "wins": entry.get("wins", 0),
                "losses": entry.get("losses", 0),
                "draws": entry.get("draws", 0),
            },
            leaderboard_top=leaderboard_top,
            token=info["token"],
            tournament_id=tid,
            tournament_alias=alias,
            reply_to=es.reply_to,
        )
        ok = await send_email(email, subject, body, sender_name=es.sender_name, reply_to=es.reply_to)
        if ok:
            sent += 1
        else:
            failed += 1

    return {"sent": sent, "skipped": skipped, "failed": failed}
