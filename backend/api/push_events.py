"""
Push notification event helpers.

High-level functions that translate tournament events into push notifications.
Each function extracts the relevant player IDs and dispatches non-blocking
push messages via :mod:`backend.api.push`.

Design:
- Functions are fire-and-forget — they never raise or block.
- All functions accept the tournament data dict so they can resolve player names
  and tournament names without additional DB lookups.
- Intended to be called from route handlers **after** ``_save_tournament()``
  so the persisted state is consistent with the notification content.
"""

from __future__ import annotations

import logging

from ..models import Match, MatchStatus
from .push import send_push_to_players, send_push_to_tournament

logger = logging.getLogger(__name__)


def _match_player_ids(match: Match) -> set[str]:
    """Extract all player IDs from both teams of a match."""
    ids: set[str] = set()
    for p in match.team1:
        if p.id:
            ids.add(p.id)
    for p in match.team2:
        if p.id:
            ids.add(p.id)
    return ids


def _opponent_player_ids(match: Match, submitter_id: str) -> set[str]:
    """Return player IDs on the opposite team from *submitter_id*."""
    submitter_team1 = any(p.id == submitter_id for p in match.team1)
    opponents = match.team2 if submitter_team1 else match.team1
    return {p.id for p in opponents if p.id}


def _tv_url(tid: str, alias: str | None) -> str:
    """Build the TV page URL for a tournament."""
    slug = alias or tid
    return f"/t/{slug}"


# ────────────────────────────────────────────────────────────────────────────
# Event: new round / matches ready
# ────────────────────────────────────────────────────────────────────────────


def notify_matches_ready(tid: str, data: dict, matches: list[Match]) -> None:
    """Push 'your match is ready' to all players in the given matches.

    Called after admin generates a new round (Mexicano) or starts playoffs
    (Group+Playoff, Mexicano, Playoff).
    """
    if not matches:
        return

    player_ids: set[str] = set()
    for m in matches:
        if m.status != MatchStatus.COMPLETED:
            player_ids |= _match_player_ids(m)

    if not player_ids:
        return

    name = data.get("name", "Tournament")
    alias = data.get("alias")
    send_push_to_players(
        tournament_id=tid,
        player_ids=player_ids,
        title=f"🏸 {name}",
        body="Your match is ready! Check the TV display for court assignments.",
        url=_tv_url(tid, alias),
        tag=f"{tid}-match-ready",
    )


# ────────────────────────────────────────────────────────────────────────────
# Event: score submitted by opponent (needs your review)
# ────────────────────────────────────────────────────────────────────────────


def notify_score_submitted(tid: str, data: dict, match: Match, submitter_id: str) -> None:
    """Push 'opponent submitted a score — review it' to the opposing team.

    Called after a player submits a score that requires confirmation.
    """
    opponents = _opponent_player_ids(match, submitter_id)
    if not opponents:
        return

    name = data.get("name", "Tournament")
    alias = data.get("alias")
    score_text = f"{match.score[0]}–{match.score[1]}" if match.score else ""
    send_push_to_players(
        tournament_id=tid,
        player_ids=opponents,
        title=f"📋 {name}",
        body=f"Score submitted ({score_text}) — tap to review.",
        url=_tv_url(tid, alias),
        tag=f"{tid}-score-{match.id}",
    )


def notify_score_accepted(tid: str, data: dict, match: Match, accepter_id: str) -> None:
    """Push 'your score was accepted' to the submitting team."""
    submitter_team_ids = _opponent_player_ids(match, accepter_id)
    if not submitter_team_ids:
        return

    name = data.get("name", "Tournament")
    alias = data.get("alias")
    send_push_to_players(
        tournament_id=tid,
        player_ids=submitter_team_ids,
        title=f"✅ {name}",
        body="Your score has been confirmed!",
        url=_tv_url(tid, alias),
        tag=f"{tid}-score-{match.id}",
    )


def notify_score_disputed(tid: str, data: dict, match: Match, disputer_id: str) -> None:
    """Push 'opponent disputes your score' to the submitting team."""
    submitter_team_ids = _opponent_player_ids(match, disputer_id)
    if not submitter_team_ids:
        return

    name = data.get("name", "Tournament")
    alias = data.get("alias")
    send_push_to_players(
        tournament_id=tid,
        player_ids=submitter_team_ids,
        title=f"⚠️ {name}",
        body="Your opponent proposes a different score — check the TV display.",
        url=_tv_url(tid, alias),
        tag=f"{tid}-score-{match.id}",
    )


# ────────────────────────────────────────────────────────────────────────────
# Event: tournament finished
# ────────────────────────────────────────────────────────────────────────────


def notify_champion(tid: str, data: dict, champion_names: list[str]) -> None:
    """Push 'tournament finished' to all subscribers."""
    name = data.get("name", "Tournament")
    alias = data.get("alias")
    champ = " & ".join(champion_names) if champion_names else "the champions"
    send_push_to_tournament(
        tournament_id=tid,
        title=f"🏆 {name}",
        body=f"Tournament finished! Champion: {champ}",
        url=_tv_url(tid, alias),
        tag=f"{tid}-champion",
    )
