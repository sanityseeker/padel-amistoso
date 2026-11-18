"""Player cards in a wider scope than one event (signed-in viewers only).

* ``GET /api/tournaments/{tid}/players/{player_id}/card-scopes`` — the scopes
  this viewer may open for an event's participant (always ``event`` first).
* ``GET /api/tournaments/{tid}/players/{player_id}/card?scope=club|community|all``
  — the card of an event's participant in one of those scopes.  For a composed
  team whose two members both have profiles it is the record of that pair playing
  together in the scope (``pair: true``).  The event's own card stays the
  anonymous ``/public-card``.
* ``GET /api/player-cards/{profile_id}?club_id=&community_id=&season_id=&sport=``
  — the card of a profile in a leaderboard's scope.

Both cards take ``limit`` (matches listed, default 10, at most
:data:`player_card.HISTORY_HARD_CAP`; the UI's "all" asks for the cap) and
return ``recent_total``, the matches there are to list.

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
    HISTORY_DEFAULT_LIMIT,
    HISTORY_HARD_CAP,
    CardMember,
    CardScopeOption,
    ScopedPlayerCard,
    build_pair_card,
    build_scoped_card,
    club_hides,
    event_card_scopes,
    participant_profile,
    participant_profiles,
    team_card,
)
from .rating_scope import RatingScope, scope_query
from .routes_clubs import (
    _bearer_user,
    _get_club,
    ensure_club_roster_synced,
    is_club_editor,
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
    profile_id: str,
    scope: RatingScope,
    option: CardScopeOption,
    creds: HTTPAuthorizationCredentials | None,
    limit: int = HISTORY_DEFAULT_LIMIT,
) -> ScopedPlayerCard:
    """:func:`build_scoped_card` behind the mini-card cache (``("profile", ...)`` keys).

    The club gate is the caller's; the unlisted-rows right is part of the key.
    """
    if scope.club_id:
        ensure_club_roster_synced(scope.club_id)
    show_unlisted = scope.kind in ("community", "global") and viewer_can_see_unlisted(creds, profile_id)
    include_hidden = scope.uses_club_chain and _sees_hidden(scope.club_id, creds, profile_id)
    key = ("profile", profile_id, scope.cache_key(), option.kind, show_unlisted, include_hidden, limit)
    return get_mini_card_cached(
        key,
        lambda: build_scoped_card(
            profile_id, scope, option, show_unlisted=show_unlisted, include_hidden=include_hidden, limit=limit
        ),
    )


def _sees_hidden(club_id: str | None, creds: HTTPAuthorizationCredentials | None, profile_id: str) -> bool:
    """Whether the bearer sees what a club hides for *profile_id* (a hidden sport, a removal).

    The player themself, and the club's organizers (they manage its roster, hidden rows included).
    """
    if creds is None:
        return False
    viewer = decode_profile_token(creds.credentials)
    if viewer is not None:
        return viewer == profile_id
    return bool(club_id) and is_club_editor(_get_club(club_id), _bearer_user(creds))


def cached_pair_card(
    name: str,
    profile_ids: tuple[str, str],
    scope: RatingScope,
    option: CardScopeOption,
    members: list[CardMember],
    creds: HTTPAuthorizationCredentials | None,
    limit: int,
) -> ScopedPlayerCard:
    """:func:`build_pair_card` behind the mini-card cache.

    A pair's unlisted-event rows are shown to a viewer who may see either player's: a member of the
    pair played in all of them, and an organizer or admin sees any player's.  The key starts with ``("profile",)`` so the card drops with the profile cards.
    """
    if scope.club_id:
        ensure_club_roster_synced(scope.club_id)
    show_unlisted = scope.kind in ("community", "global") and any(
        viewer_can_see_unlisted(creds, pid) for pid in profile_ids
    )
    key = ("profile", "pair", *sorted(profile_ids), scope.cache_key(), option.kind, show_unlisted, limit)
    return get_mini_card_cached(
        key,
        lambda: build_pair_card(
            name, profile_ids[0], profile_ids[1], scope, option, members, show_unlisted=show_unlisted, limit=limit
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
        member_names: dict[str, list[str]] = getattr(tournament, "team_member_names", None) or {}
        self.names = {p.id: p.name for p in getattr(tournament, "players", []) or []}
        # A composed team's members are not tournament players; each opens their own card too.
        for team_id, ids in roster.items():
            listed = member_names.get(team_id) or []
            for i, mid in enumerate(ids):
                self.names.setdefault(mid, listed[i] if i < len(listed) else mid)
        if player_id not in self.names and player_id not in roster:
            raise HTTPException(404, "Player not in this tournament")
        self.name = self.names.get(player_id, player_id)
        self.member_ids: list[str] = list(roster.get(player_id, []))
        self.listed: list[str] = member_names.get(player_id) or []
        if self.member_ids:
            self.linked = participant_profiles(tid, self.member_ids)
            self.profile_id: str | None = None
            self.has_profile = bool(self.linked)
        else:
            self.linked = {}
            self.profile_id = participant_profile(tid, player_id)
            self.has_profile = self.profile_id is not None

    def _may_open_club(self, club_id: str, creds: HTTPAuthorizationCredentials | None) -> bool:
        """The club card is offered only when the viewer may open it and it would show this sport."""
        if not may_open_club_cards(_get_club(club_id), creds, card_profile_id=self.profile_id):
            return False
        if self.profile_id is None or not club_hides(self.profile_id, club_id, self.sport):
            return True
        return _sees_hidden(club_id, creds, self.profile_id)

    def scopes(self, creds: HTTPAuthorizationCredentials | None) -> list[CardScopeOption]:
        """The scopes this viewer may open (the club only for its members and organizers, or the player)."""
        return event_card_scopes(
            self.data,
            self.has_profile,
            lambda club_id: self._may_open_club(club_id, creds),
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
    limit: int = Query(HISTORY_DEFAULT_LIMIT, ge=1, le=HISTORY_HARD_CAP),
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> ScopedPlayerCard | Response:
    """An event participant's card in a wider scope.

    403 when *scope* is the event's club and the viewer is neither a member
    nor an organizer of it; 404 when the tournament or participant is unknown
    or *scope* is not offered for this participant (a participant without a
    profile has no wider scope: names are never matched).  A composed team
    returns the record of its pair in the scope when both members have profiles
    (each member with their own rating), else only its members.
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
        profiles = [who.linked.get(mid) for mid in who.member_ids]
        if len(profiles) == 2 and profiles[0] and profiles[1] and profiles[0] != profiles[1]:
            pair = (profiles[0], profiles[1])
            for member, profile_id in zip(members, pair, strict=True):
                member.elo = _member_elo(profile_id, rating_scope, option, creds, who.sport)
            return _respond(
                cached_pair_card(who.name, pair, rating_scope, option, members, creds, limit), request, response
            )
        return _respond(team_card(who.name, option, who.sport, members), request, response)

    assert who.profile_id is not None
    return _respond(cached_profile_card(who.profile_id, rating_scope, option, creds, limit), request, response)


def _member_elo(
    profile_id: str,
    scope: RatingScope,
    option: CardScopeOption,
    creds: HTTPAuthorizationCredentials | None,
    sport: str,
) -> float | None:
    """A pair member's rating in the card's scope (``None``: not rated there, or hidden by the club)."""
    try:
        card = cached_profile_card(profile_id, scope, option, creds)
    except HTTPException:
        return None
    return next((s.elo for s in card.stats if s.sport == sport), None)


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
    limit: int = Query(HISTORY_DEFAULT_LIMIT, ge=1, le=HISTORY_HARD_CAP),
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
    return _respond(cached_profile_card(profile_id, scope, option, creds, limit), request, response)
