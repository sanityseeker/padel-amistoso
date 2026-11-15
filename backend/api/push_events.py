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
import re

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
    return f"/tv/{slug}"


def _hub_event_url(tid: str) -> str:
    """Build the Player Hub event page URL for a tournament (the React route ``/player/matches/tournament/:id``)."""
    return f"/player/matches/tournament/{tid}"


_ANNOUNCEMENT_PUSH_CHARS = 140
_MD_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")
_MD_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_MD_LINE_PREFIX = re.compile(r"^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)", re.MULTILINE)
_MD_FENCE = re.compile(r"^\s*(```|~~~).*$", re.MULTILINE)
_MD_EMPHASIS = re.compile(r"(\*{1,3}|_{1,3}|~~|`+)")
_HTML_TAG = re.compile(r"<[^>]+>")


def markdown_to_plain(text: str, limit: int = _ANNOUNCEMENT_PUSH_CHARS) -> str:
    """Reduce Markdown to one line of plain text for a notification body, cut at *limit* characters."""
    plain = _MD_FENCE.sub("", text)
    plain = _MD_IMAGE.sub(r"\1", plain)
    plain = _MD_LINK.sub(r"\1", plain)
    plain = _MD_LINE_PREFIX.sub("", plain)
    plain = _MD_EMPHASIS.sub("", plain)
    plain = _HTML_TAG.sub("", plain)
    plain = " ".join(plain.split())
    if len(plain) > limit:
        plain = plain[: limit - 1].rstrip() + "…"
    return plain


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
    if (data.get("tv_settings") or {}).get("hide_schedule", False):
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
        title=name,
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
        title=name,
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
        title=name,
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
        title=name,
        body="Your opponent proposes a different score — check the TV display.",
        url=_tv_url(tid, alias),
        tag=f"{tid}-score-{match.id}",
    )


# ────────────────────────────────────────────────────────────────────────────
# Event: tournament finished
# ────────────────────────────────────────────────────────────────────────────


def notify_winners(tid: str, data: dict, winner_teams: list[list[str]] | list[str]) -> None:
    """Push 'tournament finished' to all subscribers.

    *winner_teams* is a list of teams (each a list of player names).  A flat
    list of names is treated as a single team (legacy ``notify_champion`` form).
    """
    name = data.get("name", "Tournament")
    alias = data.get("alias")
    teams: list[list[str]]
    if winner_teams and isinstance(winner_teams[0], str):
        teams = [list(winner_teams)]  # type: ignore[arg-type]
    else:
        teams = [list(t) for t in winner_teams]  # type: ignore[union-attr]
    if len(teams) > 1:
        body = "Tournament finished! Winners: " + "; ".join(" & ".join(t) for t in teams)
    else:
        champ = " & ".join(teams[0]) if teams and teams[0] else "the champions"
        body = f"Tournament finished! Champion: {champ}"
    send_push_to_tournament(
        tournament_id=tid,
        title=name,
        body=body,
        url=_tv_url(tid, alias),
        tag=f"{tid}-champion",
    )


def notify_champion(tid: str, data: dict, champion_names: list[str]) -> None:
    """Push 'tournament finished' for a single champion (wrapper around :func:`notify_winners`)."""
    notify_winners(tid, data, [list(champion_names)] if champion_names else [])


# ────────────────────────────────────────────────────────────────────────────
# Event: organizer announcement
# ────────────────────────────────────────────────────────────────────────────


def notify_announcement(tid: str, data: dict, announcement_id: str, text: str) -> None:
    """Push a new organizer announcement to every subscriber of the tournament.

    The notification opens the Player Hub event page, where the announcement is listed;
    the body is the announcement as plain text, cut to about 140 characters.
    """
    body = markdown_to_plain(text)
    if not body:
        return
    send_push_to_tournament(
        tournament_id=tid,
        title=data.get("name", "Tournament"),
        body=body,
        url=_hub_event_url(tid),
        tag=f"{tid}-announcement-{announcement_id}",
    )
