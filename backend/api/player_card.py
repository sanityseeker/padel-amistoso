"""One player card for every place a player's name appears.

The card is a profile's record within one rating scope (a club, a community or
everything), built from :func:`rating_scope.scoped_log_cte` so it always agrees
with the leaderboard of the same scope.  The event card of a single tournament
stays in :mod:`.tournament_card`; this module holds the wider scopes:

* :func:`build_scoped_card` — the card of one profile in one scope.
* :func:`event_card_scopes` — the scopes a card opened from an event may switch
  to (the event's club, else its community, else everything).
* :func:`participant_profile` — the profile linked to a tournament participant.

Visibility rules (the HTTP routes add the sign-in gate):

* Club scope shows every match of that club, unlisted events included.
* Community and global scope count unlisted (``public = 0``) events in the
  numbers, but their matches are left out of another player's match list and
  of the partner / opponent lists.  A player's own card shows everything.
* No contact data, passphrases, tokens or ghost flags are ever returned.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterable
from typing import Any, Literal

from fastapi import HTTPException
from pydantic import BaseModel

from .db import get_db
from .rating_scope import RatingScope, scoped_log_cte

CardScopeKind = Literal["event", "club", "season", "community", "all"]

OPEN_COMMUNITY_ID = "open"
# Newest matches listed on a card (the ``limit`` query parameter); the numbers always cover the
# whole scope.  The UI offers 10, 25 and "all"; "all" asks for the hard cap, which keeps the
# payload and the cache bounded however long a player's history is.
HISTORY_DEFAULT_LIMIT = 10
HISTORY_HARD_CAP = 500
# Rating points drawn by the trend line.
ELO_HISTORY_LIMIT = 40
TOP_COUNTERPARTS = 3


class CardScopeOption(BaseModel):
    """One scope a card can show: the event itself, a club (or one of its seasons), a community or everything."""

    kind: CardScopeKind
    id: str | None = None
    label: str = ""


class CardMember(BaseModel):
    """A member of a composed team (a team card in a wider scope lists them)."""

    player_id: str
    name: str
    has_profile: bool
    # Pair card only: the member's own rating in the card's scope (ratings belong to the players).
    elo: float | None = None


class CardCounterpart(BaseModel):
    """A frequent partner or opponent: matches together / against and the card player's wins."""

    name: str
    profile_id: str | None = None
    matches: int
    wins: int


class CardSportStats(BaseModel):
    """The card player's numbers in one sport of the scope."""

    sport: str
    elo: float | None = None
    matches: int = 0
    wins: int = 0
    losses: int = 0
    draws: int = 0
    elo_history: list[float] = []
    # Club scope only: the place on the club board and the club tier.
    rank: int | None = None
    tier_name: str | None = None


class CardMatch(BaseModel):
    """One rated match, as the card player saw it (``side`` is their side)."""

    tournament_name: str | None = None
    sport: str
    score: list[Any] = []
    sets: list[list[int]] = []
    decider: str | None = None
    team1: list[str] = []
    team2: list[str] = []
    side: int | None = None
    outcome: Literal["W", "L", "D"] | None = None
    elo_before: float | None = None
    elo_after: float | None = None
    elo_delta: float | None = None
    updated_at: str | None = None
    round_number: int | None = None
    round_label: str = ""
    # The card player's partners and opponents in this match, by the names they played under.
    partners: list[str] = []
    opponents: list[str] = []
    # Their linked profiles, in the same order (``None``: not linked), so a name can open its card.
    partner_profiles: list[str | None] = []
    opponent_profiles: list[str | None] = []


class ScopedPlayerCard(BaseModel):
    """A profile's (or a composed team's) card within one scope."""

    profile_id: str | None = None
    name: str
    scope: CardScopeOption
    sport: str | None = None
    is_team: bool = False
    members: list[CardMember] = []
    stats: list[CardSportStats] = []
    top_partners: list[CardCounterpart] = []
    top_opponents: list[CardCounterpart] = []
    recent_matches: list[CardMatch] = []
    # Listed matches before the ``limit`` cut: the UI offers a longer history only when this exceeds 10.
    recent_total: int = 0
    # Matches of unlisted events: counted in ``stats`` but not listed.
    unlisted_matches: int = 0
    # A team card whose two members both have profiles: ``stats``, ``top_opponents`` and
    # ``recent_matches`` are the record of this pair playing together (no pair rating).
    pair: bool = False


# ---------------------------------------------------------------------------
# Participants and scopes
# ---------------------------------------------------------------------------


def participant_profiles(tid: str, player_ids: Iterable[str]) -> dict[str, str]:
    """``{player_id: profile_id}`` for the linked participants of tournament *tid*."""
    ids = list(dict.fromkeys(player_ids))
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    with get_db() as conn:
        rows = conn.execute(
            f"""SELECT player_id, profile_id FROM player_secrets
                 WHERE tournament_id = ? AND profile_id IS NOT NULL AND player_id IN ({marks})
                UNION
                SELECT player_id, profile_id FROM player_history
                 WHERE entity_type = 'tournament' AND entity_id = ? AND profile_id IS NOT NULL
                   AND player_id IN ({marks})""",
            (tid, *ids, tid, *ids),
        ).fetchall()
    return {r["player_id"]: r["profile_id"] for r in rows}


def participant_profile(tid: str, player_id: str) -> str | None:
    """The profile linked to one tournament participant, or ``None``."""
    return participant_profiles(tid, [player_id]).get(player_id)


def event_card_scopes(
    data: dict[str, Any], has_profile: bool, club_allowed: Callable[[str], bool]
) -> list[CardScopeOption]:
    """Scopes a card opened from this event may show to this viewer.

    Always the event; for a linked player also the widest scope of the event's
    own setting: its club (when *club_allowed* lets the viewer open it), else
    its community (a closed one), else everything (an event of the open
    community).  A club event never widens past its club's own community:
    without the club and in the open community it offers the event only.
    """
    scopes = [CardScopeOption(kind="event")]
    if not has_profile:
        return scopes
    club_id = data.get("club_id")
    community_id = data.get("community_id") or OPEN_COMMUNITY_ID
    with get_db() as conn:
        club = conn.execute("SELECT name FROM clubs WHERE id = ?", (club_id,)).fetchone() if club_id else None
        if club is not None and club_allowed(club_id):
            scopes.append(CardScopeOption(kind="club", id=club_id, label=club["name"]))
            return scopes
        if community_id != OPEN_COMMUNITY_ID:
            row = conn.execute("SELECT name FROM communities WHERE id = ?", (community_id,)).fetchone()
            if row is not None:
                scopes.append(CardScopeOption(kind="community", id=community_id, label=row["name"]))
                return scopes
    if club is None:
        scopes.append(CardScopeOption(kind="all"))
    return scopes


# ---------------------------------------------------------------------------
# Match rows
# ---------------------------------------------------------------------------


def _side_of(payload: dict[str, Any], player_id: str) -> int | None:
    for side, key in ((1, "team1"), (2, "team2")):
        if any(p.get("player_id") == player_id for p in payload.get(key) or []):
            return side
    return None


def match_outcome(payload: dict[str, Any], side: int | None) -> Literal["W", "L", "D"] | None:
    """W / L / D for *side*: by sets won when the match has sets, else by the score."""
    if side is None:
        return None
    sets = payload.get("sets") or []
    try:
        if sets:
            ours = sum(1 for s in sets if int(s[0]) > int(s[1]))
            theirs = sum(1 for s in sets if int(s[1]) > int(s[0]))
        else:
            score = payload.get("score") or []
            if len(score) < 2:
                return None
            ours, theirs = int(score[0]), int(score[1])
    except (TypeError, ValueError, IndexError):
        return None
    if side == 2:
        ours, theirs = theirs, ours
    return "D" if ours == theirs else "W" if ours > theirs else "L"


def load_payload(raw: str | None) -> dict[str, Any]:
    try:
        payload = json.loads(raw or "{}")
    except (ValueError, TypeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def match_entry_from_log(
    log: dict[str, Any], round_info_cache: dict[str, dict[str, tuple[int, str]]]
) -> dict[str, Any]:
    """One ``player_elo_log`` row as a card match (the legacy club card reads the same fields).

    Rows written before the payload carried the round fall back to the live
    tournament's own round of that match.
    """
    payload = load_payload(log.get("match_payload"))
    round_number = payload.get("round_number")
    round_label = payload.get("round_label") or ""
    if not round_number and not round_label:
        tid = log.get("tournament_id")
        if tid:
            if tid not in round_info_cache:
                # Lazy imports: ``routes_crud`` imports the club routes, which import this module.
                from .routes_crud import _collect_tournament_match_round_info  # noqa: PLC0415
                from .state import _tournaments  # noqa: PLC0415

                tournament = _tournaments.get(tid, {}).get("tournament")
                round_info_cache[tid] = _collect_tournament_match_round_info(tournament)
            fallback = round_info_cache[tid].get(log.get("match_id"))
            if fallback:
                round_number = fallback[0] or None
                round_label = fallback[1]
    me = log.get("player_id") or ""
    side = _side_of(payload, me)
    own_key, other_key = ("team1", "team2") if side == 1 else ("team2", "team1")
    return {
        "tournament_name": log.get("tournament_name"),
        "tournament_alias": log.get("tournament_alias"),
        "sport": log.get("sport"),
        "score": payload.get("score") or [],
        "sets": payload.get("sets") or [],
        "decider": payload.get("decider"),
        "team1": [p.get("player_name", "") for p in payload.get("team1", []) or []],
        "team2": [p.get("player_name", "") for p in payload.get("team2", []) or []],
        "side": side,
        "partners": [p.get("player_name", "") for p in payload.get(own_key) or [] if p.get("player_id") != me]
        if side
        else [],
        "opponents": [p.get("player_name", "") for p in payload.get(other_key) or []] if side else [],
        "outcome": None if log.get("is_manual") else match_outcome(payload, side),
        "elo_before": log.get("elo_before"),
        "elo_after": log.get("elo_after"),
        "elo_delta": log.get("elo_delta"),
        "updated_at": log.get("updated_at"),
        "is_manual": bool(log.get("is_manual")),
        "round_number": round_number or None,
        "round_label": round_label,
        "_payload": payload,
    }


def _linked_profiles(conn, pairs: set[tuple[str, str]]) -> dict[tuple[str, str], str]:
    """``{(tournament_id, player_id): profile_id}`` for the given participations."""
    tids = sorted({t for t, _ in pairs})
    out: dict[tuple[str, str], str] = {}
    for start in range(0, len(tids), 400):
        chunk = tids[start : start + 400]
        marks = ",".join("?" for _ in chunk)
        rows = conn.execute(
            f"""SELECT tournament_id, player_id, profile_id FROM player_secrets
                 WHERE profile_id IS NOT NULL AND tournament_id IN ({marks})
                UNION
                SELECT entity_id AS tournament_id, player_id, profile_id FROM player_history
                 WHERE entity_type = 'tournament' AND profile_id IS NOT NULL AND entity_id IN ({marks})""",
            (*chunk, *chunk),
        ).fetchall()
        for r in rows:
            key = (r["tournament_id"], r["player_id"])
            if key in pairs:
                out[key] = r["profile_id"]
    return out


def _top(counter: dict[str, dict[str, Any]]) -> list[CardCounterpart]:
    rows = sorted(counter.values(), key=lambda c: (-c["matches"], -c["wins"], c["name"].lower()))
    return [CardCounterpart(**c) for c in rows[:TOP_COUNTERPARTS]]


# ---------------------------------------------------------------------------
# The scoped card
# ---------------------------------------------------------------------------


def _hidden_in_club(conn, profile_id: str, club_id: str, sport: str) -> bool:
    row = conn.execute(
        "SELECT hidden FROM profile_club_elo WHERE profile_id = ? AND club_id = ? AND sport = ?",
        (profile_id, club_id, sport),
    ).fetchone()
    return bool(row and row["hidden"])


def club_hides(profile_id: str, club_id: str, sport: str) -> bool:
    """Whether the club hides *sport* for *profile_id* (its card there is then 404 for most viewers)."""
    with get_db() as conn:
        return _hidden_in_club(conn, profile_id, club_id, sport)


def build_scoped_card(
    profile_id: str,
    scope: RatingScope,
    option: CardScopeOption,
    *,
    show_unlisted: bool,
    include_hidden: bool = False,
    limit: int = HISTORY_DEFAULT_LIMIT,
) -> ScopedPlayerCard:
    """Build (uncached) the card of *profile_id* within *scope*.

    404 when the profile does not exist, or when the scope asks for a sport
    the club hides for this player.  *show_unlisted* (the viewer's right, see
    ``routes_clubs.viewer_can_see_unlisted``) lists unlisted events of a
    community or global scope; otherwise they only count in the numbers.
    The caller checks the club gate (``routes_clubs.require_club_card_access``).
    *include_hidden* is for the player and the club's organizers: it keeps the sports
    (or the whole membership) the club hides for them.
    """
    hide_unlisted = scope.kind in ("community", "global") and not show_unlisted
    with get_db() as conn:
        profile = conn.execute("SELECT name FROM player_profiles WHERE id = ?", (profile_id,)).fetchone()
        if profile is None:
            raise HTTPException(404, "Player not found")
        if (
            scope.uses_club_chain
            and scope.sport
            and not include_hidden
            and _hidden_in_club(conn, profile_id, scope.club_id or "", scope.sport)
        ):
            raise HTTPException(404, "Player not visible in this scope")
        cte, params = scoped_log_cte(scope, profile_ids=[profile_id], include_hidden=include_hidden)
        logs = [
            dict(r)
            for r in conn.execute(
                f"""{cte}
                SELECT * FROM scoped_log ORDER BY updated_at ASC, match_order ASC""",
                params,
            ).fetchall()
        ]
        match_logs = [log for log in logs if not log["is_manual"]]
        pairs: set[tuple[str, str]] = set()
        for log in match_logs:
            payload = load_payload(log["match_payload"])
            for key in ("team1", "team2"):
                for p in payload.get(key) or []:
                    if p.get("player_id"):
                        pairs.add((log["tournament_id"], p["player_id"]))
        linked = _linked_profiles(conn, pairs) if pairs else {}

    by_sport: dict[str, CardSportStats] = {}
    elo_steps: dict[str, list[tuple[float | None, float]]] = {}
    for log in logs:
        stats = by_sport.setdefault(log["sport"], CardSportStats(sport=log["sport"]))
        if log["elo_after"] is not None:
            stats.elo = round(float(log["elo_after"]), 1)
            stats.elo_history.append(round(float(log["elo_after"]), 1))
            before = log.get("elo_before")
            elo_steps.setdefault(log["sport"], []).append(
                (round(float(before), 1) if before is not None else None, round(float(log["elo_after"]), 1))
            )

    round_cache: dict[str, dict[str, tuple[int, str]]] = {}
    shown: list[dict[str, Any]] = []
    unlisted = 0
    partners: dict[str, dict[str, Any]] = {}
    opponents: dict[str, dict[str, Any]] = {}
    for log in match_logs:
        entry = match_entry_from_log(log, round_cache)
        stats = by_sport[log["sport"]]
        stats.matches += 1
        outcome = entry["outcome"]
        if outcome == "W":
            stats.wins += 1
        elif outcome == "L":
            stats.losses += 1
        elif outcome == "D":
            stats.draws += 1
        if hide_unlisted and log.get("tournament_public") == 0:
            unlisted += 1
            continue
        shown.append(entry)
        side = entry["side"]
        if side is None:
            continue
        payload = entry["_payload"]
        own_key, other_key = ("team1", "team2") if side == 1 else ("team2", "team1")

        def profiles_of(
            key: str, skip_me: bool, log: dict[str, Any] = log, payload: dict = payload
        ) -> list[str | None]:
            return [
                linked.get((log["tournament_id"], p.get("player_id"))) if p.get("player_id") else None
                for p in payload.get(key) or []
                if not (skip_me and p.get("player_id") == log["player_id"])
            ]

        entry["partner_profiles"] = profiles_of(own_key, True)
        entry["opponent_profiles"] = profiles_of(other_key, False)
        for key, counter in ((own_key, partners), (other_key, opponents)):
            for p in payload.get(key) or []:
                pid = p.get("player_id")
                if key == own_key and pid == log["player_id"]:
                    continue
                linked_profile = linked.get((log["tournament_id"], pid)) if pid else None
                if linked_profile == profile_id:
                    continue
                name = p.get("player_name") or ""
                ident = f"p:{linked_profile}" if linked_profile else f"n:{name.strip().lower()}"
                if ident == "n:":
                    continue
                row = counter.setdefault(ident, {"name": name, "profile_id": linked_profile, "matches": 0, "wins": 0})
                row["name"] = name or row["name"]
                row["matches"] += 1
                row["wins"] += 1 if outcome == "W" else 0

    for sport, stats in by_sport.items():
        # Trim first, then prepend the rating before the first shown row, so a
        # 2-match card still plots its first change (3 points).
        steps = elo_steps.get(sport, [])[-ELO_HISTORY_LIMIT:]
        stats.elo_history = [after for _before, after in steps]
        if steps and steps[0][0] is not None:
            stats.elo_history.insert(0, steps[0][0])
    if scope.kind == "club":
        _apply_club_board(profile_id, scope, by_sport)
    recent = [CardMatch(**{k: v for k, v in e.items() if k in CardMatch.model_fields}) for e in reversed(shown)]
    return ScopedPlayerCard(
        profile_id=profile_id,
        name=profile["name"] or "",
        scope=option,
        sport=scope.sport,
        stats=[by_sport[s] for s in sorted(by_sport, key=lambda s: (s != "padel", s))],
        top_partners=_top(partners),
        top_opponents=_top(opponents),
        recent_matches=recent[:limit],
        recent_total=len(recent),
        unlisted_matches=unlisted,
    )


def _apply_club_board(profile_id: str, scope: RatingScope, by_sport: dict[str, CardSportStats]) -> None:
    """Rating, rank and tier from the club board, so the card agrees with the row it was opened from.

    The board also knows a tier of a player without matches yet; that sport
    gets its numbers too.
    """
    # Lazy import: the club routes import this module.
    from .routes_clubs import _compute_club_leaderboard_rows, project_club_board  # noqa: PLC0415

    with get_db() as conn:
        rows = _compute_club_leaderboard_rows(conn, scope.club_id or "")
    for row in rows:
        if row["profile_id"] != profile_id or row["hidden"] or scope.sport not in (None, row["sport"]):
            continue
        sport = row["sport"]
        if sport not in by_sport and not (row.get("matches") or row.get("tier_name")):
            continue  # the roster's default row of a sport never played
        stats = by_sport.setdefault(sport, CardSportStats(sport=sport))
        if row.get("elo") is not None:
            stats.elo = round(float(row["elo"]), 1)
        stats.tier_name = row.get("tier_name")
        stats.rank = next((e["rank"] for e in project_club_board(rows, sport) if e["profile_id"] == profile_id), None)


def team_card(name: str, option: CardScopeOption, sport: str | None, members: list[CardMember]) -> ScopedPlayerCard:
    """A composed team whose pair has no shared history to show (a member has no profile)."""
    return ScopedPlayerCard(name=name, scope=option, sport=sport, is_team=True, members=members)


def _mean_delta(logs: Iterable[dict[str, Any]]) -> float | None:
    values = [float(log["elo_delta"]) for log in logs if log.get("elo_delta") is not None]
    return round(sum(values) / len(values), 1) if values else None


def build_pair_card(
    name: str,
    profile_a: str,
    profile_b: str,
    scope: RatingScope,
    option: CardScopeOption,
    members: list[CardMember],
    *,
    show_unlisted: bool,
    limit: int = HISTORY_DEFAULT_LIMIT,
) -> ScopedPlayerCard:
    """Build (uncached) the record of two profiles playing together within *scope*.

    A match counts when both profiles took part in it on the same side, in any
    event of the scope (a composed team, or partners in a Mexicano round).
    Visibility is the individual card's: unlisted events of a community or
    global scope count in the numbers but are not listed unless *show_unlisted*
    (the caller decides it for both members).  The pair has no rating of its own.
    """
    hide_unlisted = scope.kind in ("community", "global") and not show_unlisted
    with get_db() as conn:
        cte, params = scoped_log_cte(scope, profile_ids=[profile_a, profile_b])
        logs = [
            dict(r)
            for r in conn.execute(
                f"""{cte}
                SELECT * FROM scoped_log WHERE is_manual = 0 ORDER BY updated_at ASC, match_order ASC""",
                params,
            ).fetchall()
        ]
        # ``{(tournament, match): {profile: log row}}`` of the matches both members rated in.
        together: dict[tuple[str, str], dict[str, dict[str, Any]]] = {}
        for log in logs:
            together.setdefault((log["tournament_id"], log["match_id"]), {})[log["profile_id"]] = log
        pairs: set[tuple[str, str]] = set()
        shared: list[tuple[dict[str, Any], dict[str, Any]]] = []
        for rows in together.values():
            if profile_a not in rows or profile_b not in rows:
                continue
            log_a, log_b = rows[profile_a], rows[profile_b]
            payload = load_payload(log_a["match_payload"])
            side = _side_of(payload, log_a["player_id"])
            if side is None or side != _side_of(payload, log_b["player_id"]):
                continue
            shared.append((log_a, log_b))
            opposing = payload.get("team2" if side == 1 else "team1") or []
            pairs.update((log_a["tournament_id"], p["player_id"]) for p in opposing if p.get("player_id"))
        linked = _linked_profiles(conn, pairs) if pairs else {}

    shared.sort(key=lambda row: (row[0]["updated_at"] or "", row[0]["match_order"] or 0))
    by_sport: dict[str, CardSportStats] = {}
    round_cache: dict[str, dict[str, tuple[int, str]]] = {}
    shown: list[dict[str, Any]] = []
    unlisted = 0
    opponents: dict[str, dict[str, Any]] = {}
    for log_a, log_b in shared:
        entry = match_entry_from_log(log_a, round_cache)
        stats = by_sport.setdefault(log_a["sport"], CardSportStats(sport=log_a["sport"]))
        stats.matches += 1
        outcome = entry["outcome"]
        if outcome == "W":
            stats.wins += 1
        elif outcome == "L":
            stats.losses += 1
        elif outcome == "D":
            stats.draws += 1
        if hide_unlisted and log_a.get("tournament_public") == 0:
            unlisted += 1
            continue
        payload = entry["_payload"]
        other_key = "team2" if entry["side"] == 1 else "team1"
        entry["partners"] = []  # the partner is the other member
        entry["partner_profiles"] = []
        entry["opponent_profiles"] = [
            linked.get((log_a["tournament_id"], p.get("player_id"))) if p.get("player_id") else None
            for p in payload.get(other_key) or []
        ]
        entry["elo_delta"] = _mean_delta([log_a, log_b])
        entry["elo_before"] = entry["elo_after"] = None
        shown.append(entry)
        for p, profile in zip(payload.get(other_key) or [], entry["opponent_profiles"], strict=True):
            name_ = p.get("player_name") or ""
            ident = f"p:{profile}" if profile else f"n:{name_.strip().lower()}"
            if ident == "n:":
                continue
            row = opponents.setdefault(ident, {"name": name_, "profile_id": profile, "matches": 0, "wins": 0})
            row["name"] = name_ or row["name"]
            row["matches"] += 1
            row["wins"] += 1 if outcome == "W" else 0

    recent = [CardMatch(**{k: v for k, v in e.items() if k in CardMatch.model_fields}) for e in reversed(shown)]
    return ScopedPlayerCard(
        name=name,
        scope=option,
        sport=scope.sport,
        is_team=True,
        members=members,
        stats=[by_sport[s] for s in sorted(by_sport, key=lambda s: (s != "padel", s))],
        top_opponents=_top(opponents),
        recent_matches=recent[:limit],
        recent_total=len(recent),
        unlisted_matches=unlisted,
        pair=True,
    )
