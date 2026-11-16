"""Player cards in a wider scope than one event (signed-in viewers only).

* ``GET /api/tournaments/{tid}/players/{player_id}/card-scopes`` — the scopes
  this viewer may open for an event's participant (always ``event`` first).
* ``GET /api/tournaments/{tid}/players/{player_id}/card?scope=club|community|all``
  — the card of an event's participant in one of those scopes.  The event's
  own card stays the anonymous ``/public-card``.
* ``GET /api/player-cards/{profile_id}?club_id=&community_id=&season_id=&sport=``
  — the card of a profile in a leaderboard's scope.

All need a Player Hub profile JWT or an organizer JWT (401 otherwise).  Two
access checks decide the rest, both in :mod:`.routes_clubs` next to the
club-permission helper:

* :func:`routes_clubs.require_club_card_access` — club and season scope are
  for the club's visible members and its organizers only (403 for anyone
  else); a player may always open their own card.
* :func:`routes_clubs.viewer_can_see_unlisted` — who sees a player's matches of
  unlisted events in community and global scope.

The scope filter and the field list live in :mod:`.player_card`.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from ..auth.deps import require_profile_or_user
from ..auth.security import decode_profile_token
from . import state
from .db import get_db
from .leaderboard_cache import etag_for, get_mini_card_cached
from .player_card import (
    CardMember,
    CardScopeOption,
    ScopedPlayerCard,
    build_scoped_card,
    event_card_scopes,
    participant_profile,
    participant_profiles,
    team_card,
)
from .rating_scope import RatingScope, scope_query
from .routes_clubs import (
    _get_club,
    ensure_club_roster_synced,
    may_open_club_cards,
    require_club_card_access,
    viewer_can_see_unlisted,
)

router = APIRouter(tags=["player-cards"])

_bearer = HTTPBearer(auto_error=False)
# Auth-gated and follows live scores: never stored by shared caches, always revalidated.
_CACHE_CONTROL = "private, no-cache"


def _respond(card: ScopedPlayerCard, request: Request, response: Response) -> ScopedPlayerCard | Response:
    tag = etag_for(card.model_dump())
    if request.headers.get("if-none-match") == tag:
        return Response(status_code=304, headers={"ETag": tag, "Cache-Control": _CACHE_CONTROL})
    response.headers["ETag"] = tag
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return card


def cached_profile_card(
    profile_id: str, scope: RatingScope, option: CardScopeOption, creds: HTTPAuthorizationCredentials | None
) -> ScopedPlayerCard:
    """:func:`build_scoped_card` behind the mini-card cache (``("profile", ...)`` keys).

    The club gate is the caller's; the unlisted-rows right is part of the key.
    """
    if scope.club_id:
        ensure_club_roster_synced(scope.club_id)
    show_unlisted = scope.kind in ("community", "global") and viewer_can_see_unlisted(creds, profile_id)
    # The player's own club card keeps what the club hides for them (a hidden sport, a removal).
    own = creds is not None and decode_profile_token(creds.credentials) == profile_id
    include_hidden = own and scope.uses_club_chain
    key = ("profile", profile_id, scope.cache_key(), option.kind, show_unlisted, include_hidden)
    return get_mini_card_cached(
        key,
        lambda: build_scoped_card(
            profile_id, scope, option, show_unlisted=show_unlisted, include_hidden=include_hidden
        ),
    )


class _EventParticipant:
    """An event participant: a player (maybe linked to a profile) or a composed team."""

    def __init__(self, tid: str, player_id: str) -> None:
        data = state._tournaments.get(tid)
        if data is None:
            raise HTTPException(404, "Tournament not found")
        tournament = data.get("tournament")
        roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
        self.data: dict[str, Any] = data
        self.sport: str = data.get("sport") or "padel"
        self.names = {p.id: p.name for p in getattr(tournament, "players", []) or []}
        if player_id not in self.names and player_id not in roster:
            raise HTTPException(404, "Player not in this tournament")
        self.name = self.names.get(player_id, player_id)
        self.member_ids: list[str] = list(roster.get(player_id, []))
        self.listed: list[str] = (getattr(tournament, "team_member_names", None) or {}).get(player_id) or []
        if self.member_ids:
            self.linked = participant_profiles(tid, self.member_ids)
            self.profile_id: str | None = None
            self.has_profile = bool(self.linked)
        else:
            self.linked = {}
            self.profile_id = participant_profile(tid, player_id)
            self.has_profile = self.profile_id is not None

    def scopes(self, creds: HTTPAuthorizationCredentials | None) -> list[CardScopeOption]:
        """The scopes this viewer may open (the club only for its members and organizers, or the player)."""
        return event_card_scopes(
            self.data,
            self.has_profile,
            lambda club_id: may_open_club_cards(_get_club(club_id), creds, card_profile_id=self.profile_id),
        )


@router.get(
    "/api/tournaments/{tid}/players/{player_id}/card-scopes",
    response_model=None,
    dependencies=[Depends(require_profile_or_user)],
)
def get_event_player_card_scopes(
    tid: str,
    player_id: str,
    response: Response,
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> list[CardScopeOption]:
    """The scopes the viewer may open for this participant: ``event``, then at most one wider scope."""
    response.headers["Cache-Control"] = _CACHE_CONTROL
    return _EventParticipant(tid, player_id).scopes(creds)


@router.get(
    "/api/tournaments/{tid}/players/{player_id}/card",
    response_model=None,
    dependencies=[Depends(require_profile_or_user)],
)
def get_event_player_card(
    tid: str,
    player_id: str,
    request: Request,
    response: Response,
    scope: Literal["club", "community", "all"] = Query(...),
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> ScopedPlayerCard | Response:
    """An event participant's card in a wider scope.

    403 when *scope* is the event's club and the viewer is neither a member
    nor an organizer of it; 404 when the tournament or participant is unknown
    or *scope* is not offered for this participant (a participant without a
    profile has no wider scope: names are never matched).  A composed team
    returns its members to pick from.
    """
    who = _EventParticipant(tid, player_id)
    club_id = who.data.get("club_id")
    if scope == "club" and club_id and who.has_profile:
        require_club_card_access(_get_club(club_id), creds, card_profile_id=who.profile_id)
    option = next((o for o in who.scopes(creds) if o.kind == scope), None)
    if option is None:
        raise HTTPException(404, "This card has no such scope")
    if scope == "club":
        rating_scope = RatingScope(club_id=option.id, sport=who.sport)
    elif scope == "community":
        rating_scope = RatingScope(community_id=option.id, sport=who.sport)
    else:
        rating_scope = RatingScope(sport=who.sport)

    if who.member_ids:
        members = [
            CardMember(
                player_id=mid,
                name=who.listed[i] if i < len(who.listed) else who.names.get(mid, mid),
                has_profile=mid in who.linked,
            )
            for i, mid in enumerate(who.member_ids)
        ]
        return _respond(team_card(who.name, option, who.sport, members), request, response)

    assert who.profile_id is not None
    return _respond(cached_profile_card(who.profile_id, rating_scope, option, creds), request, response)


def _profile_scope_option(scope: RatingScope) -> CardScopeOption:
    with get_db() as conn:
        if scope.season_id:
            row = conn.execute("SELECT name FROM seasons WHERE id = ?", (scope.season_id,)).fetchone()
            return CardScopeOption(kind="season", id=scope.season_id, label=row["name"] if row else "")
        if scope.club_id:
            row = conn.execute("SELECT name FROM clubs WHERE id = ?", (scope.club_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Club not found")
            return CardScopeOption(kind="club", id=scope.club_id, label=row["name"])
        if scope.community_id:
            row = conn.execute("SELECT name FROM communities WHERE id = ?", (scope.community_id,)).fetchone()
            if row is None:
                raise HTTPException(404, "Community not found")
            return CardScopeOption(kind="community", id=scope.community_id, label=row["name"])
    return CardScopeOption(kind="all")


@router.get(
    "/api/player-cards/{profile_id}",
    response_model=None,
    dependencies=[Depends(require_profile_or_user)],
)
def get_profile_card(
    profile_id: str,
    request: Request,
    response: Response,
    scope: RatingScope = Depends(scope_query),
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> ScopedPlayerCard | Response:
    """A profile's card in a leaderboard's scope (club, season, community or everything).

    Club and season scope: 403 unless the viewer is a visible member or an
    organizer of that club.  404 for an unknown profile, club or community, or
    for a sport the club hides for this player.
    """
    if scope.club_id:
        # A player may always open their own card here (see ``may_open_club_cards``).
        require_club_card_access(_get_club(scope.club_id), creds, card_profile_id=profile_id)
    option = _profile_scope_option(scope)
    return _respond(cached_profile_card(profile_id, scope, option, creds), request, response)
