"""
Shared helpers for route modules.
"""

from __future__ import annotations

import hashlib
import time
from collections import OrderedDict, defaultdict
from typing import Any, Callable, Literal

from fastapi import HTTPException
from fastapi.responses import Response

from ..auth.deps import PlayerIdentity
from ..auth.models import User, UserRole
from ..models import InputFormat, Match, MatchStatus, SetDecider
from ..tournaments.playoff import THIRD_PLACE_LABEL, EspejoParallelBracket
from ..tournaments.set_format import format_sets, match_decider, totals_from_sets, validate_decider_sets
from .db import get_co_editors
from .state import _tournaments, _save_tournament


def get_scope_branding(
    community_id: str,
    club_id: str | None = None,
    cache: dict[tuple[str, str | None], dict[str, str | None]] | None = None,
) -> dict[str, str | None]:
    """Return community/club display metadata for a tournament or registration scope.

    When ``club_id`` is provided it is used directly; otherwise the first club
    in the community (by creation date) is used as a legacy fallback.
    """
    # Local imports: routes_clubs (transitively) loads route modules that
    # import this helpers module at import time.
    from .db import get_db  # noqa: PLC0415
    from .routes_clubs import resolve_club_for_scope  # noqa: PLC0415

    cache_key = (community_id, club_id)
    if cache is not None and cache_key in cache:
        return cache[cache_key]

    with get_db() as conn:
        row = conn.execute("SELECT name FROM communities WHERE id = ?", (community_id,)).fetchone()

    club = resolve_club_for_scope(community_id, club_id)
    branding = {
        "community_name": (row["name"] if row is not None else None),
        "club_name": (club.name if club is not None else None),
        "club_logo_url": (f"/api/clubs/{club.id}/logo" if club is not None and club.has_logo else None),
    }
    if cache is not None:
        cache[cache_key] = branding
    return branding


def revalidate_scope_for_community(
    conn,
    new_community_id: str,
    club_id: str | None,
    season_id: str | None,
) -> tuple[str | None, str | None]:
    """Clear ``club_id``/``season_id`` that don't belong to *new_community_id*.

    Clubs and seasons are community-scoped, so reassigning a tournament or
    registration to another community must drop references into the old one.
    Returns the (possibly cleared) ``(club_id, season_id)``.
    """
    if club_id:
        club_row = conn.execute("SELECT community_id FROM clubs WHERE id = ?", (club_id,)).fetchone()
        if club_row is None or club_row["community_id"] != new_community_id:
            club_id = None
    if season_id:
        season_row = conn.execute(
            "SELECT c.community_id AS community_id FROM seasons s JOIN clubs c ON c.id = s.club_id WHERE s.id = ?",
            (season_id,),
        ).fetchone()
        if season_row is None or season_row["community_id"] != new_community_id:
            season_id = None
    return club_id, season_id


def align_community_to_club(conn, community_id: str, club_id: str | None) -> tuple[str, str | None]:
    """Return a ``(community_id, club_id)`` pair that agrees on the community.

    A new event created with a club always lives in that club's community, so
    the club wins over a stale community pick (e.g. the creator's default).
    An unknown club id is dropped.
    """
    if not club_id:
        return community_id, None
    row = conn.execute("SELECT community_id FROM clubs WHERE id = ?", (club_id,)).fetchone()
    if row is None:
        return community_id, None
    return row["community_id"], club_id


# MIME types for the three supported image/document formats.
_SCHEMA_MEDIA_TYPES: dict[str, str] = {
    "png": "image/png",
    "svg": "image/svg+xml",
    "pdf": "application/pdf",
}

# ── Bracket image LRU cache ─────────────────────────────────────────────────
# Keyed by a SHA-256 digest of all render parameters (including tid+version
# for live tournament brackets).  Avoids re-running matplotlib on every
# request when nothing has changed.  Max 64 entries (~few MB of images).
_SCHEMA_CACHE_MAX = 64
_schema_cache: OrderedDict[str, tuple[bytes, str]] = OrderedDict()


def _schema_cache_key(*parts: object) -> str:
    """Build a deterministic cache key from arbitrary hashable parts."""
    raw = "|".join(str(p) for p in parts)
    return hashlib.sha256(raw.encode()).hexdigest()


def _schema_cache_get(key: str) -> tuple[bytes, str] | None:
    """Return cached ``(image_bytes, fmt)`` or ``None``."""
    entry = _schema_cache.get(key)
    if entry is not None:
        _schema_cache.move_to_end(key)
    return entry


def _schema_cache_put(key: str, img: bytes, fmt: str) -> None:
    """Store ``(image_bytes, fmt)`` evicting the oldest entry if needed."""
    _schema_cache[key] = (img, fmt)
    _schema_cache.move_to_end(key)
    while len(_schema_cache) > _SCHEMA_CACHE_MAX:
        _schema_cache.popitem(last=False)


def invalidate_schema_cache_for(tid: str) -> None:
    """Remove all cache entries whose key was built with *tid*.

    Called when a tournament is mutated so stale bracket images don't linger.
    In practice the version component of the key already prevents serving
    stale data, but this keeps memory tidy for deleted tournaments.
    """
    # Keys are opaque SHA-256 hashes — we can't reverse them.  Instead, rely
    # on version-based invalidation (the version is part of the key, so an
    # updated tournament will simply miss the cache and generate a new entry;
    # old entries age out via LRU eviction).
    pass


def _schema_image_response(img: bytes, fmt: Literal["png", "svg", "pdf"], *, etag: str | None = None) -> Response:
    """Wrap rendered image bytes in the correct FastAPI Response.

    When *etag* is provided the response includes ``ETag`` and a private
    ``Cache-Control`` header so browsers can revalidate cheaply.
    """
    headers: dict[str, str] = {}
    if etag:
        headers["ETag"] = f'"{etag}"'
        headers["Cache-Control"] = "private, max-age=300"
    return Response(content=img, media_type=_SCHEMA_MEDIA_TYPES[fmt], headers=headers or None)


def _store_tournament(
    tid: str,
    *,
    name: str,
    tournament_type: str,
    tournament: object,
    owner: str,
    public: bool,
    sport: str,
    assign_courts: bool,
    community_id: str = "open",
    season_id: str | None = None,
    club_id: str | None = None,
) -> None:
    """Insert a tournament into the in-memory store and persist to DB."""
    from datetime import datetime, timezone  # noqa: PLC0415

    # If the caller supplied a season but not a club, derive club_id from the
    # season so the two stay consistent without requiring callers to pass both.
    # Then make community/club/season agree: the club's community wins, and a
    # season outside that club's community is dropped.
    from .db import get_db  # noqa: PLC0415

    with get_db() as conn:
        if season_id and not club_id:
            row = conn.execute("SELECT club_id FROM seasons WHERE id = ?", (season_id,)).fetchone()
            if row is not None:
                club_id = row["club_id"]
        community_id, club_id = align_community_to_club(conn, community_id, club_id)
        club_id, season_id = revalidate_scope_for_community(conn, community_id, club_id, season_id)

    _tournaments[tid] = {
        "name": name,
        "type": tournament_type,
        "tournament": tournament,
        "owner": owner,
        "public": public,
        "sport": sport,
        "assign_courts": assign_courts,
        "community_id": community_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "season_id": season_id,
        "club_id": club_id,
    }
    _save_tournament(tid)


def tournament_winners(t: object) -> list[list] | None:
    """Return the decided winners of tournament *t* as a list of teams, else ``None``.

    Prefers ``t.winners()`` (Play-off / Group+Playoff, possibly several equal
    winners) and falls back to ``[t.champion()]`` (Mexicano, legacy objects).
    """
    winners_fn = getattr(t, "winners", None)
    if callable(winners_fn):
        return winners_fn() or None
    champion_fn = getattr(t, "champion", None)
    champ = champion_fn() if callable(champion_fn) else None
    return [champ] if champ else None


def _plata_third_place_payload(bracket: object) -> dict:
    """``plata_third_place`` flag and ``plata_third_place_team`` names (split Espejo only)."""
    if not getattr(bracket, "is_split", False):
        return {}
    lb = getattr(bracket, "losers_bracket", None)
    team = lb.third_place_team() if lb is not None else None
    return {
        "plata_third_place": bool(getattr(lb, "third_place", False)),
        "plata_third_place_team": [p.name for p in team] if team else None,
    }


def winners_payload(t: object) -> dict:
    """Status/playoffs payload fragment: ``num_winners``, ``winners`` and ``champion``.

    ``champion`` is populated only for single-winner tournaments (``num_winners == 1``).
    """
    bracket = getattr(t, "bracket", None) or getattr(t, "playoff_bracket", None)
    num_winners = int(getattr(bracket, "num_winners", 1) or 1)
    winners = tournament_winners(t)
    names = [[p.name for p in team] for team in winners] if winners else None
    return {
        "num_winners": num_winners,
        "third_place": bool(getattr(bracket, "third_place", False))
        or bool(getattr(getattr(bracket, "winners_bracket", None), "third_place", False)),
        "winners": names,
        "champion": names[0] if names and len(names) == 1 else None,
        # Oro / Plata split only: optional 3rd-place match of the lower (Plata) bracket.
        **_plata_third_place_payload(bracket),
    }


def stage_progress_payload(matches: list[Match] | None, total: int | None = None) -> dict:
    """Status fragment: matches played in the stage now running (byes excluded).

    ``stage_total`` is ``None`` when the stage has no known size (a Mexicano with no round limit).
    """
    if matches is None:
        return {"stage_played": None, "stage_total": None}
    real = [m for m in matches if not (m.status == MatchStatus.COMPLETED and m.score is None)]
    played = sum(1 for m in real if m.status == MatchStatus.COMPLETED)
    return {"stage_played": played, "stage_total": len(real) if total is None else max(total, len(real))}


def _is_bye_match(m: Match) -> bool:
    """Return True if *m* is a bye (auto-resolved without play)."""
    return m.status == MatchStatus.COMPLETED and m.score is None


def _serialize_format_override(m: Match) -> dict | None:
    """Return the public view of a match's format override (no audit fields)."""
    fo = getattr(m, "format_override", None)
    if fo is None:
        return None
    return {
        "mode": fo.mode.value if fo.mode else None,
        "points_target": fo.points_target,
        "decider": fo.decider.value if fo.decider else None,
    }


def _last_score_activity(m: Match) -> float | None:
    """Timestamp of the newest score-history entry, or ``None`` when nothing was recorded."""
    history = getattr(m, "score_history", None) or []
    for entry in reversed(history):
        stamp = entry.get("timestamp") if isinstance(entry, dict) else None
        if isinstance(stamp, (int, float)):
            return float(stamp)
    return None


def _serialize_match(m: Match, points_target: int | None = None) -> dict:
    """Convert a Match dataclass to a JSON-friendly dict.

    Args:
        m: The match to serialise.
        points_target: For Mexicano round matches, the effective points the
            score must sum to (override or tournament total).  When given it
            is emitted as ``effective_points_target`` so clients never have
            to re-derive it.
    """
    out = {
        "id": m.id,
        "team1": [p.name for p in m.team1],
        "team2": [p.name for p in m.team2],
        "team1_ids": [p.id for p in m.team1],
        "team2_ids": [p.id for p in m.team2],
        "court": m.court.name if m.court else None,
        "status": m.status.value,
        "score": list(m.score) if m.score else None,
        "sets": [list(s) for s in m.sets] if m.sets else None,
        "third_set_loss": m.third_set_loss,
        "slot_number": m.slot_number,
        "round_number": m.round_number,
        "round_label": m.round_label,
        "comment": m.comment or "",
        # Score lifecycle fields
        "scored_by": getattr(m, "scored_by", None),
        "scored_at": getattr(m, "scored_at", None),
        "score_confirmed": getattr(m, "score_confirmed", False),
        "disputed": getattr(m, "disputed", False),
        "dispute_score": list(m.dispute_score) if getattr(m, "dispute_score", None) else None,
        "dispute_sets": [list(s) for s in m.dispute_sets] if getattr(m, "dispute_sets", None) else None,
        "dispute_by": getattr(m, "dispute_by", None),
        "dispute_at": getattr(m, "dispute_at", None),
        "dispute_escalated": getattr(m, "dispute_escalated", False),
        "format_review": getattr(m, "format_review", False),
        "review_score": list(m.review_score) if getattr(m, "review_score", None) else None,
        "review_sets": [list(s) for s in m.review_sets] if getattr(m, "review_sets", None) else None,
        "review_decider": m.review_decider.value if getattr(m, "review_decider", None) else None,
        "format_override": _serialize_format_override(m),
        "effective_decider": _effective_decider_value(m),
        "walkover": bool(getattr(m, "walkover", False)),
        # When the score last changed, for any author (organizer scores have no ``scored_at``).
        "last_activity_at": _last_score_activity(m),
    }
    if points_target is not None:
        out["effective_points_target"] = points_target
    return out


def _get_tournament(tid: str, expected_type: str) -> dict:
    """Look up a tournament by ID and verify its type, or raise 404."""
    data = _tournaments.get(tid)
    if not data or data["type"] != expected_type:
        raise HTTPException(404, "Not found")
    return data


def _require_owner_or_admin(tid: str, user: User) -> None:
    """Raise 403 if *user* neither owns the tournament nor is an admin.

    Use this only for destructive or share-management operations that should
    be restricted to the original owner.  For general editing, prefer
    ``_require_editor_access``.
    """
    data = _tournaments.get(tid)
    if data is None:
        raise HTTPException(404, "Tournament not found")
    if user.role == UserRole.ADMIN:
        return
    if data.get("owner") != user.username:
        raise HTTPException(403, "You do not have permission to modify this tournament")


def _require_demo_can_create_tournament(user: User) -> None:
    """Raise 403 if a demo user already owns a tournament (one at a time)."""
    if not user.is_demo:
        return
    for data in list(_tournaments.values()):
        if data.get("owner") == user.username:
            raise HTTPException(
                403,
                "Demo accounts can run one tournament at a time — delete the current one first",
            )


def _sanitize_demo_create_request(req, user: User) -> None:
    """Strip scope and identity fields from a tournament-create payload for demo users.

    Demo tournaments always live in the open community with no club/season,
    and their players stay ephemeral: without emails or profile ids no Player
    Hub link is ever created, so nothing leaks into hub/leaderboard tables.
    """
    if not user.is_demo:
        return
    req.community_id = "open"
    req.season_id = None
    req.club_id = None
    req.player_emails = {}
    req.player_contacts = {}
    req.player_profile_ids = {}


def _is_editor(tid: str, user: User | None) -> bool:
    """Return True when *user* is an admin, the owner, or a co-editor of *tid* (never raises)."""
    if user is None:
        return False
    if user.role == UserRole.ADMIN:
        return True
    data = _tournaments.get(tid)
    if data is None:
        return False
    if data.get("owner") == user.username:
        return True
    return user.username in get_co_editors(tid)


def schedule_hidden_for(tid: str, user: User | None) -> bool:
    """True when the organizer hid the schedule and *user* is not an editor."""
    tv_settings = _tournaments.get(tid, {}).get("tv_settings") or {}
    return bool(tv_settings.get("hide_schedule", False)) and not _is_editor(tid, user)


def _visible_match(match: Match) -> bool:
    """A match players may see while the schedule is hidden: already played."""
    return match.status == MatchStatus.COMPLETED or match.score is not None


def _require_editor_access(tid: str, user: User) -> None:
    """Raise 403 if *user* may not edit the tournament.

    Allowed callers:
    - Admin users (bypass all ownership checks)
    - The tournament owner
    - Users that have been granted co-editor access via ``tournament_shares``
    """
    data = _tournaments.get(tid)
    if data is None:
        raise HTTPException(404, "Tournament not found")
    if _is_editor(tid, user):
        return
    raise HTTPException(403, "You do not have permission to modify this tournament")


def _require_score_permission(
    tid: str,
    match: Match,
    user: User | None,
    player: PlayerIdentity | None,
) -> None:
    """Raise 403 unless the caller may record a score for *match*.

    Allowed callers:
    - Admin users
    - The tournament owner
    - An authenticated player who is a participant in the match
      (only when ``allow_player_scoring`` is enabled in TV settings)
    """
    # Admin, owner, or co-editor
    if user is not None:
        data = _tournaments.get(tid)
        if data is None:
            raise HTTPException(404, "Tournament not found")
        if user.role == UserRole.ADMIN:
            return
        if data.get("owner") == user.username:
            return
        if user.username in get_co_editors(tid):
            return

    # Player in the match — only allowed when player scoring is enabled
    if player is not None and player.tournament_id == tid:
        tv_settings = _tournaments.get(tid, {}).get("tv_settings") or {}
        if not tv_settings.get("allow_player_scoring", True):
            raise HTTPException(403, "Player score submission is disabled for this tournament")
        if getattr(match, "format_review", False):
            raise HTTPException(409, "A score for this match is awaiting organiser review")
        match_player_ids = {p.id for p in match.team1} | {p.id for p in match.team2}
        is_participant = player.player_id in match_player_ids
        if not is_participant:
            # Composite team roster: the player may belong to a synthetic team
            # entry that appears in the match.
            tournament = _tournaments.get(tid, {}).get("tournament")
            team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
            is_participant = any(player.player_id in team_roster.get(team_pid, []) for team_pid in match_player_ids)
        if is_participant:
            if tv_settings.get("hide_schedule", False) and not _visible_match(match):
                raise HTTPException(403, "Scores are entered by the organizer while the schedule is hidden")
            # A recorded (or pending) score is never overwritten by a player; changes go
            # through accept / correct / escalate, or the organizer.
            if match.score is not None:
                raise HTTPException(409, "A score was already submitted for this match")
            return

    raise HTTPException(403, "You do not have permission to record this score")


def _find_match(tournament: object, match_id: str) -> Match | None:
    """Look up a ``Match`` by ID across all match sources in a tournament.

    Works for Mexicano, Group+Playoff, and standalone Playoff tournaments
    by inspecting whichever accessors exist on *tournament*.
    """
    for accessor in ("all_matches", "current_round_matches", "playoff_matches"):
        fn = getattr(tournament, accessor, None)
        if fn is None:
            continue
        for m in fn():
            if m.id == match_id:
                return m
    # Group+Playoff: iterate group matches directly.
    for group in getattr(tournament, "groups", []):
        for m in getattr(group, "matches", []):
            if m.id == match_id:
                return m
    # Playoff bracket matches.
    bracket = getattr(tournament, "bracket", None) or getattr(tournament, "playoff_bracket", None)
    if bracket is not None:
        for accessor in ("pending_matches",):
            fn = getattr(bracket, accessor, None)
            if fn:
                for m in fn():
                    if m.id == match_id:
                        return m
    return None


def _check_read_access(tid: str, user: User | None) -> None:
    """Raise 403 if a guest or regular user should not read this tournament.

    - Admins always have access.
    - Authenticated owners always have access.
    - Everyone else (guests or non-owners) can only access public tournaments.
      Non-public tournaments are still accessible by direct link (ID), so no
      restriction is applied here for read endpoints — private means only
      hidden from the listing, not fully locked behind auth.
    """
    # This helper intentionally does nothing: private tournaments are
    # accessible by direct link to anyone (requirement: "access should only
    # be provided with a link"). Filtering only happens in the list endpoint.
    return


def _tennis_sets_to_scores(
    sets: list[list[int]],
    decider: SetDecider | None = None,
) -> tuple[int, int, list[tuple[int, int]], bool]:
    """Convert raw set scores to total game counts and typed tuples.

    When both teams have accumulated equal game totals the winner is
    determined by sets won and their count is incremented by 1 so that
    no draw is recorded.  The fourth return value is True whenever exactly
    three sets were played (i.e. the match went to a deciding 3rd set),
    regardless of whether the total-game adjustment was needed.

    With a match tie-break *decider* the third set counts as one game
    (``set_format.games_from_sets``), so ``6-4 3-6 [10-8]`` totals 10-10
    before the winner adjustment, not 19-18.

    Returns:
        Tuple of (total_games_team1, total_games_team2, sets_as_tuples,
        decided_by_third_set).
    """
    sets_tuples = [tuple(s) for s in sets]
    # The set winner always gets the higher game total (see totals_from_sets),
    # so Match.winner_team names whoever won more *sets*.
    total1, total2, decided_by_third_set = totals_from_sets(sets_tuples, decider)
    return total1, total2, sets_tuples, decided_by_third_set


def _effective_decider(data: dict, match: Match) -> SetDecider:
    """Resolve the third-set decider for *match*: override, else tournament setting.

    ``format_override.decider`` wins; otherwise ``tv_settings.set_decider``
    (default full set).  This is the value a *new* set score is validated and
    recorded under; a stored score keeps the decider it was recorded with
    (``Match.decider``), so changing the tournament setting later never
    reinterprets existing results.
    """
    override = getattr(match, "format_override", None)
    if override is not None and override.decider:
        return override.decider
    return _tv_default_decider(data)


def _tv_default_decider(data: dict) -> SetDecider:
    """Tournament-wide third-set decider from ``tv_settings`` (default full set)."""
    raw = (data.get("tv_settings") or {}).get("set_decider")
    try:
        return SetDecider(raw) if raw else SetDecider.FULL_SET
    except ValueError:
        return SetDecider.FULL_SET


def _prepare_set_score(
    data: dict,
    match: Match,
    sets: list[list[int]],
    decider: SetDecider | None = None,
) -> tuple[int, int, list[tuple[int, int]], bool, SetDecider]:
    """Validate *sets* against the match's effective decider and total the games.

    Pass *decider* to validate under another decider instead (a player score
    entered off-format, which then goes to organiser review).

    Raises ``HTTPException(400)`` when the third set does not fit a match
    tie-break decider (see ``set_format.validate_decider_sets``).

    Returns:
        ``(total1, total2, sets_tuples, decided_by_third_set, decider)``; the
        caller stamps ``match.decider = decider`` once the engine accepted
        the score.
    """
    decider = decider or _effective_decider(data, match)
    try:
        validate_decider_sets(sets, decider)
    except ValueError as e:
        raise HTTPException(400, str(e))
    total1, total2, sets_tuples, decided = _tennis_sets_to_scores(sets, decider)
    return total1, total2, sets_tuples, decided, decider


def _effective_decider_value(m: Match) -> str | None:
    """Public ``effective_decider`` for a serialised match.

    A scored set match reports the decider it was recorded under (legacy
    records: full set).  A pending match reports its override, or ``None``
    when it inherits ``tv_settings.set_decider`` (clients fall back to that).
    """
    decider = getattr(m, "decider", None)
    if decider:
        return decider.value if isinstance(decider, SetDecider) else str(decider)
    if m.sets:
        return SetDecider.FULL_SET.value
    fo = getattr(m, "format_override", None)
    return fo.decider.value if fo is not None and fo.decider else None


def _build_match_labels(bracket: object) -> dict[str, dict]:
    """Build a match_labels dict keyed by viz graph node ID.

    Keys match the node IDs created by bracket builders in bracket_schema.py:
    - Single-elim matches: ``"match_r{r}_p{p}"`` (r and p are 0-based)
    - Double-elim winners matches: ``"w_r{r}_p{p}"``
    - Double-elim losers matches: ``"l_{i}"`` (sequential index across all losers matches)
    - Double-elim grand final: ``"grand_final"``

    Args:
        bracket: A ``SingleEliminationBracket`` or ``DoubleEliminationBracket`` instance.

    Returns:
        Dict mapping node IDs to ``{team1, team2, score, round}`` dicts.
    """

    def _fmt_team(team: list) -> str:
        return " & ".join(p.name for p in team) if team else "TBD"

    def _fmt_score(m: object) -> str | None:
        if getattr(m, "walkover", False):
            return "W/O"
        if m.sets:
            return format_sets(m.sets, match_decider(m), sep="  ")
        return f"{m.score[0]}–{m.score[1]}" if m.score else None

    def _wo_loser(m: object) -> str | None:
        """Side (``team1`` / ``team2``) that lost a walkover; ``None`` for played matches."""
        if not getattr(m, "walkover", False) or not m.score:
            return None
        return "team2" if m.score[0] > m.score[1] else "team1"

    def _label_round_matches(match_list: list, prefix: str) -> None:
        """Group *match_list* by round, then write labels keyed ``{prefix}_r{r}_p{p}``."""
        by_round: defaultdict[int, list] = defaultdict(list)
        for m in match_list:
            by_round[m.round_number].append(m)
        for round_num, rmatches in sorted(by_round.items()):
            r = round_num - 1
            for p_idx, m in enumerate(rmatches):
                is_third = m.round_label == THIRD_PLACE_LABEL
                # Use the stored bracket pair_index when available so the key
                # matches the viz node ID (which uses the actual slot position
                # including bye slots, not a sequential non-bye count).
                key_p = m.pair_index if m.pair_index >= 0 else p_idx
                entry: dict = {
                    "team1": _fmt_team(m.team1),
                    "team2": _fmt_team(m.team2),
                    "score": _fmt_score(m),
                    "round": m.round_label,
                    "walkover_loser": _wo_loser(m),
                }
                # Include loser info so the viz can draw data-driven loss edges.
                loser = m.loser_team
                if loser:
                    entry["loser"] = _fmt_team(loser)
                labels["third_place" if is_third else f"{prefix}_r{r}_p{key_p}"] = entry

    labels: dict[str, dict] = {}

    if hasattr(bracket, "winners_matches"):
        _label_round_matches(bracket.winners_matches, "w")
        idx = 0
        for m in bracket.losers_matches:
            # Skip bye matches (auto-completed without both teams) so the
            # sequential index stays aligned with the viz graph nodes which
            # also skip byes.
            if not m.team1 or not m.team2:
                continue
            entry: dict = {
                "team1": _fmt_team(m.team1),
                "team2": _fmt_team(m.team2),
                "score": _fmt_score(m),
                "round": m.round_label,
                "walkover_loser": _wo_loser(m),
            }
            loser = m.loser_team
            if loser:
                entry["loser"] = _fmt_team(loser)
            labels[f"l_{idx}"] = entry
            idx += 1
        if bracket.grand_final:
            gf = bracket.grand_final
            labels["grand_final"] = {
                "team1": _fmt_team(gf.team1),
                "team2": _fmt_team(gf.team2),
                "score": _fmt_score(gf),
                "round": "Grand Final",
                "walkover_loser": _wo_loser(gf),
            }
    else:
        _label_round_matches(bracket.matches, "match")

    return labels


def _is_espejo_bracket(bracket: object) -> bool:
    """Return True when *bracket* is an :class:`EspejoParallelBracket`."""
    return isinstance(bracket, EspejoParallelBracket)


def _espejo_side_of(bracket: object) -> Callable[[Match], str | None]:
    """Return a function mapping a match to its Espejo bracket side.

    The result is ``"winners"``, ``"losers"`` or ``"super_final"`` (legacy
    tournaments only).  For any non-Espejo bracket the function always
    returns ``None`` so callers can use it unconditionally.
    """
    if not isinstance(bracket, EspejoParallelBracket):
        return lambda _m: None
    wb_ids = {m.id for m in bracket.winners_bracket.matches}
    lb_ids = {m.id for m in bracket.losers_bracket.matches} if bracket.losers_bracket else set()
    sf_id = bracket.super_final_match.id if bracket.super_final_match else None

    def _side(m: Match) -> str | None:
        if m.id in wb_ids:
            return "winners"
        if m.id in lb_ids:
            return "losers"
        if m.id == sf_id:
            return "super_final"
        return None

    return _side


def _serialize_playoff_matches(bracket: object, matches: list[Match]) -> list[dict]:
    """Serialise play-off *matches*, tagging each with ``bracket_side`` for Espejo.

    Without the tag, Winners and Losers matches that share a round name
    (e.g. both "Semi-Final") would be merged into one card by the clients.
    """
    side_of = _espejo_side_of(bracket)
    out: list[dict] = []
    for m in matches:
        d = _serialize_match(m)
        side = side_of(m)
        if side:
            d["bracket_side"] = side
        out.append(d)
    return out


def _espejo_schema_target(bracket: EspejoParallelBracket, side: str | None, title: str | None) -> tuple[Any, str]:
    """Pick the single-elimination bracket (and its default title) to draw for *side*.

    Raises:
        HTTPException: 425 when the Losers Bracket is requested before it is seeded.
    """
    split = bool(getattr(bracket, "is_split", False))
    if side == "losers":
        if split and bracket.losers_bracket is not None:
            return bracket.losers_bracket, title or "Silver Bracket"
        if bracket.losers_bracket is None:
            raise HTTPException(425, "Losers bracket not yet seeded — wait for all Round-1 winners matches to complete")
        return bracket.losers_bracket, title or "Losers Bracket"
    return bracket.winners_bracket, title or ("Gold Bracket" if split else "Winners Bracket")


# ---------------------------------------------------------------------------
# Score lifecycle helpers
# ---------------------------------------------------------------------------


def _get_tv_settings(tid: str) -> dict[str, Any]:
    """Return the TV settings dict for a tournament (defaults to empty dict)."""
    return _tournaments.get(tid, {}).get("tv_settings") or {}


def _apply_player_score_metadata(
    match: Match,
    player_id: str,
    score: list[int] | None = None,
    sets: list[list[int]] | None = None,
    confirmed: bool = False,
) -> None:
    """Stamp a player-submitted score with metadata for the lifecycle flow.

    Appends a ``"submit"`` entry to the match's score_history and sets
    ``scored_by`` / ``scored_at`` / ``score_confirmed``.
    Pass ``confirmed=True`` when the tournament is in immediate confirmation
    mode so the score is visible as confirmed straight away.
    Admin-submitted scores bypass this entirely via ``_mark_admin_score``.
    """
    now = time.time()
    match.scored_by = player_id
    match.scored_at = now
    match.score_confirmed = confirmed
    match.score_history.append(
        {
            "player_id": player_id,
            "action": "submit",
            "score": score,
            "sets": sets,
            "timestamp": now,
        }
    )


def _expected_input_format(data: dict, match: Match, stage: str) -> InputFormat:
    """Input format the organiser set for *match*: its override, else the stage default.

    *stage* is the ``tv_settings.score_mode`` key (``"gp-group"``,
    ``"gp-playoff"``, ``"mex-playoff"``, ``"po-playoff"``).
    """
    override = getattr(match, "format_override", None)
    if override is not None and override.mode:
        return override.mode
    raw = ((data.get("tv_settings") or {}).get("score_mode") or {}).get(stage)
    return InputFormat.SETS if raw == InputFormat.SETS.value else InputFormat.POINTS


def _is_off_format_player_submit(
    data: dict,
    match: Match,
    stage: str,
    submitted: InputFormat,
    user: User | None,
    player: PlayerIdentity | None,
    decider: SetDecider | None = None,
) -> bool:
    """True when a *player* (not an organiser) submits in a format other than the match's.

    For set scores *decider* is the third-set decider the player entered
    under; a different decider than the match's is also off-format.
    """
    if player is None or user is not None:
        return False
    if submitted != _expected_input_format(data, match, stage):
        return True
    return decider is not None and decider != _effective_decider(data, match)


def _hold_for_format_review(
    match: Match,
    player_id: str,
    score: tuple[int, int],
    sets: list[tuple[int, int]] | None = None,
    decider: SetDecider | None = None,
) -> None:
    """Park an off-format player score for organiser review.

    The score is NOT applied to the tournament engine, so it counts nowhere
    (standings, bracket, ELO) until an organiser approves it.
    """
    now = time.time()
    match.format_review = True
    match.review_score = (score[0], score[1])
    match.review_sets = [(s[0], s[1]) for s in sets] if sets else None
    match.review_decider = decider if sets else None
    match.score_history.append(
        {
            "player_id": player_id,
            "action": "submit_for_review",
            "score": [score[0], score[1]],
            "sets": [list(s) for s in sets] if sets else None,
            "timestamp": now,
        }
    )


def _clear_format_review(match: Match) -> None:
    """Drop a parked off-format score (approved, rejected or superseded)."""
    match.format_review = False
    match.review_score = None
    match.review_sets = None
    match.review_decider = None


def _mark_admin_score(match: Match, actor_id: str | None = None) -> None:
    """Mark a match score as immediately confirmed (admin / organiser record)."""
    match.scored_by = None
    match.scored_at = None
    match.score_confirmed = True
    _clear_format_review(match)
    # Clear any previous dispute state when an admin re-records.
    match.disputed = False
    match.dispute_score = None
    match.dispute_sets = None
    match.dispute_by = None
    match.dispute_at = None
    match.score_history.append(
        {
            "player_id": actor_id,
            "action": "admin_record",
            "score": list(match.score) if match.score else None,
            "sets": [list(s) for s in match.sets] if match.sets else None,
            "timestamp": time.time(),
        }
    )


def _is_player_in_opposing_team(match: Match, player_id: str, tournament: object) -> bool:
    """Return True if *player_id* is in the team that did NOT submit the score.

    Works with direct player IDs and composite team rosters.
    """
    team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}

    def _ids_for(players: list) -> set[str]:
        direct = {p.id for p in players}
        expanded: set[str] = set()
        for pid in direct:
            expanded.update(team_roster.get(pid, [pid]))
        expanded.update(direct)
        return expanded

    team1_ids = _ids_for(match.team1)
    team2_ids = _ids_for(match.team2)

    if not match.scored_by:
        return False

    if match.scored_by in team1_ids:
        return player_id in team2_ids
    if match.scored_by in team2_ids:
        return player_id in team1_ids
    return False


def _is_player_in_submitter_team(match: Match, player_id: str, tournament: object) -> bool:
    """Return True if *player_id* is on the same team as the player who submitted the score.

    Works with direct player IDs and composite team rosters.
    """
    team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}

    def _ids_for(players: list) -> set[str]:
        direct = {p.id for p in players}
        expanded: set[str] = set()
        for pid in direct:
            expanded.update(team_roster.get(pid, [pid]))
        expanded.update(direct)
        return expanded

    if not match.scored_by:
        return False

    team1_ids = _ids_for(match.team1)
    team2_ids = _ids_for(match.team2)

    if match.scored_by in team1_ids:
        return player_id in team1_ids
    if match.scored_by in team2_ids:
        return player_id in team2_ids
    return False


def _is_player_in_match(match: Match, player_id: str, tournament: object) -> bool:
    """Return True if *player_id* participates in *match* (direct or via roster)."""
    team_roster: dict[str, list[str]] = getattr(tournament, "team_roster", None) or {}
    all_ids: set[str] = set()
    for player in match.team1 + match.team2:
        all_ids.add(player.id)
        all_ids.update(team_roster.get(player.id, []))
    return player_id in all_ids


def _find_match_full(tournament: object, match_id: str) -> Match | None:
    """Extended match finder that also searches completed bracket matches."""
    # First try the standard finder (covers Mexicano, group stage, pending bracket).
    m = _find_match(tournament, match_id)
    if m is not None:
        return m
    # Fallback: iterate all matches in the bracket including completed ones.
    for bracket_attr in ("bracket", "playoff_bracket"):
        bracket = getattr(tournament, bracket_attr, None)
        if bracket is None:
            continue
        # Try winners/losers/all match lists on the bracket.
        for accessor in ("winners_matches", "losers_matches", "matches"):
            for bm in getattr(bracket, accessor, []):
                if bm.id == match_id:
                    return bm
        if getattr(bracket, "grand_final", None) and bracket.grand_final.id == match_id:
            return bracket.grand_final
    return None
