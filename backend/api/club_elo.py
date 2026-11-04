"""Per-club ELO ratings, kept separate from the community / global chain.

Every club keeps its own rating for each player: every completed match of the
club's tournaments, in the order the matches were played, with these rules:

* A player's first club match starts from their community rating at that time
  (the main chain's ``elo_before`` for that match), unless the club already set
  a rating for them.
* A tier base ELO or a manual club ELO (``is_manual`` log rows whose
  ``tournament_id`` is the club id) takes effect from the moment it is set.
  It does not count as a match.
* Mexicano match-length scaling and per-profile K-factor overrides apply as in
  the main chain (:mod:`.elo_integration`).

The main chain is never changed: community and global ratings do not see club
ratings.  Each player's club history is stored on their ``player_elo_log`` match
rows: ``club_identity`` (the Hub profile, else ``"<tournament>:<player>"``),
``club_elo_before`` / ``club_elo_after`` and ``club_matches_after``.  The club
views read those columns, and each match payload carries every participant's
club ratings.

A newly scored match is rated on its own from each player's latest club row
(:func:`rate_new_club_match`).  Changes that rewrite club history — a corrected
score, a recalculation, a Hub link change or merge, a tournament moved between
clubs or deleted — replay the whole club (:func:`recompute_club_elo`).
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Collection, Iterator
from contextlib import contextmanager
from dataclasses import dataclass

from backend.models import GPPhase, Match
from backend.tournaments.elo import EloUpdate, compute_match_elo_updates

from .db import get_db
from .elo_integration import (
    _build_effective_k_overrides,
    _extract_completed_matches,
    _is_team_mode,
    _mexicano_k_multiplier,
)
from .elo_store import _get_linked_profiles, _profile_player_ids, get_k_factor_overrides, get_tournament_elos
from .leaderboard_cache import invalidate_leaderboard_cache
from .state import _tournaments

logger = logging.getLogger(__name__)

_EPSILON = 1e-9

# Club writes (a single match or a whole replay) must not interleave.
_club_lock = threading.Lock()

# Batch mode (see :func:`deferred_club_elo`): club ids waiting for one replay.
_defer_lock = threading.Lock()
_defer_depth = 0
_deferred_clubs: set[str] = set()


@dataclass(frozen=True)
class _ClubResult:
    """One player's club values for one match."""

    identity: str
    elo_before: float
    elo_after: float
    matches_after: int


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------


def rate_new_club_match(tournament_id: str, match: Match, sport: str) -> None:
    """Rate a newly scored match on its club's chain.

    Reads each player's latest club row instead of replaying the club.  When
    the match is not the newest event in the club (some club match or manual
    rating is later), the whole club is replayed instead.  Never raises: club
    ratings are a derived view and must not break scoring.
    """
    data = _tournaments.get(tournament_id)
    club_id = data.get("club_id") if data else None
    if not club_id:
        return
    if _defer_if_batching(club_id):
        return
    try:
        with _club_lock:
            rated = _rate_newest_match(club_id, tournament_id, data, match, sport)
    except Exception:
        logger.exception("Failed to rate club ELO for match %s in tournament %s", match.id, tournament_id)
        return
    if rated:
        invalidate_leaderboard_cache(club_id)
    else:
        recompute_club_elo(club_id)


def recompute_club_elo(club_id: str) -> None:
    """Replay every match of *club_id* on its own rating chain.  Never raises."""
    if _defer_if_batching(club_id):
        return
    try:
        with _club_lock:
            changed = _replay_club(club_id)
        if changed:
            invalidate_leaderboard_cache(club_id)
    except Exception:
        logger.exception("Failed to recompute club ELO for club %s", club_id)


def recompute_club_elo_for_tournaments(tournament_ids: Collection[str]) -> None:
    """Replay the clubs that the given tournaments belong to (each club once)."""
    club_ids = {(_tournaments.get(tid) or {}).get("club_id") for tid in tournament_ids}
    for club_id in sorted(c for c in club_ids if c):
        recompute_club_elo(club_id)


def get_tournament_display_elos(tournament_id: str, sport: str) -> dict[str, float]:
    """``{player_id: rating}`` shown next to each player of a tournament.

    Outside a club this is the community rating (``player_elo``).  In a club
    tournament it is the player's club rating:

    * while the tournament runs, the rating their next club match starts from —
      their latest club match, or a later tier / manual club rating;
    * once it is finished, their club rating after their last match in it.

    A player with no club rating yet keeps the community rating, which is also
    where their club chain starts.
    """
    elos = get_tournament_elos(tournament_id, sport)
    data = _tournaments.get(tournament_id)
    club_id = data.get("club_id") if data else None
    if not club_id or not elos:
        return elos
    finished = str(getattr(data.get("tournament"), "phase", "")) == GPPhase.FINISHED
    with get_db() as conn:
        profiles = {r["player_id"]: r["profile_id"] for r in _get_linked_profiles(tournament_id, conn)}
        for player_id in elos:
            profile_id = profiles.get(player_id)
            identity = profile_id or f"{tournament_id}:{player_id}"
            last = _last_club_row(conn, club_id, sport, identity, tournament_id=tournament_id if finished else None)
            manual = _latest_manual_rating(conn, club_id, sport, profile_id) if profile_id and not finished else None
            # As when rating a match: a manual rating applies only if it is later.
            if manual is not None and (last is None or manual["updated_at"] > last["updated_at"]):
                elos[player_id] = float(manual["elo_after"])
            elif last is not None:
                elos[player_id] = float(last["club_elo_after"])
    return elos


@contextmanager
def deferred_club_elo() -> Iterator[None]:
    """Collect club work inside the block and replay each club once at the end.

    Used by bulk recalculations, which replay many tournaments of the same club.
    """
    global _defer_depth
    with _defer_lock:
        _defer_depth += 1
    try:
        yield
    finally:
        with _defer_lock:
            _defer_depth -= 1
            pending = set(_deferred_clubs) if _defer_depth == 0 else set()
            if _defer_depth == 0:
                _deferred_clubs.clear()
        for club_id in sorted(pending):
            recompute_club_elo(club_id)


def _defer_if_batching(club_id: str) -> bool:
    with _defer_lock:
        if _defer_depth > 0:
            _deferred_clubs.add(club_id)
            return True
    return False


# ---------------------------------------------------------------------------
# One new match
# ---------------------------------------------------------------------------


def _rate_newest_match(club_id: str, tid: str, data: dict, match: Match, sport: str) -> bool:
    """Rate *match* from the players' latest club rows.  False if a replay is needed."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT player_id, elo_before, updated_at, match_payload FROM player_elo_log"
            " WHERE tournament_id = ? AND sport = ? AND match_id = ? AND is_manual = 0",
            (tid, sport, match.id),
        ).fetchall()
        if not rows:
            return True
        match_ts = min(r["updated_at"] for r in rows)
        if _has_later_club_event(conn, club_id, sport, match_ts, tid, match.id):
            return False

        profiles = {r["player_id"]: r["profile_id"] for r in _get_linked_profiles(tid, conn)}
        start_counts = _start_match_counts(conn, club_id, tournament_id=tid)
        identities: dict[str, str] = {}
        ratings: dict[str, float] = {}
        counts: dict[str, int] = {}
        for row in rows:
            player_id = row["player_id"]
            profile_id = profiles.get(player_id)
            identity = profile_id or f"{tid}:{player_id}"
            last = _last_club_row(conn, club_id, sport, identity, exclude=(tid, match.id))
            manual = _latest_manual_rating(conn, club_id, sport, profile_id) if profile_id else None
            if last is not None:
                rating, count = float(last["club_elo_after"]), int(last["club_matches_after"])
                # A manual rating at the same instant as a match applies before it.
                if manual is not None and manual["updated_at"] > last["updated_at"]:
                    rating = float(manual["elo_after"])
            else:
                rating = float(manual["elo_after"]) if manual is not None else float(row["elo_before"])
                count = start_counts.get((tid, sport, player_id), 0)
            identities[player_id], ratings[player_id], counts[player_id] = identity, rating, count

    tournament, ttype = data["tournament"], data.get("type", "")
    updates = _rate(match, ratings, counts, _is_team_mode(tournament, ttype), data, get_k_factor_overrides(tid))
    results = {
        (tid, sport, match.id, u.player_id): _ClubResult(
            identities[u.player_id], u.elo_before, u.elo_after, u.matches_after
        )
        for u in updates
        if u.player_id in identities
    }
    key = (tid, sport, match.id)
    _write_changes({key: {"rows": {r["player_id"]: None for r in rows}, "payload": rows[0]["match_payload"]}}, results)
    return True


def _has_later_club_event(conn, club_id: str, sport: str, match_ts: str, tid: str, match_id: str) -> bool:
    """True if another club match (or a manual club rating) is at or after *match_ts*."""
    row = conn.execute(
        """
        SELECT 1
          FROM player_elo_log l
     LEFT JOIN tournaments t ON t.id = l.tournament_id
         WHERE l.sport = ?
           AND ((t.club_id = ? AND l.is_manual = 0 AND l.updated_at >= ?
                 AND NOT (l.tournament_id = ? AND l.match_id = ?))
                OR (l.is_manual = 1 AND l.tournament_id = ? AND l.updated_at > ?))
         LIMIT 1
        """,
        (sport, club_id, match_ts, tid, match_id, club_id, match_ts),
    ).fetchone()
    return row is not None


def _last_club_row(
    conn,
    club_id: str,
    sport: str,
    identity: str,
    *,
    tournament_id: str | None = None,
    exclude: tuple[str, str] | None = None,
):
    """The identity's latest rated club match row (``club_elo_after``, ``club_matches_after``, ``updated_at``).

    *tournament_id* limits the search to one tournament; *exclude* skips one
    ``(tournament_id, match_id)``.  None if the identity has no rated club match.
    """
    filters, params = "", [club_id, sport, identity]
    if tournament_id is not None:
        filters += " AND l.tournament_id = ?"
        params.append(tournament_id)
    if exclude is not None:
        filters += " AND NOT (l.tournament_id = ? AND l.match_id = ?)"
        params.extend(exclude)
    return conn.execute(
        f"""
        SELECT l.club_elo_after, l.club_matches_after, l.updated_at
          FROM player_elo_log l
          JOIN tournaments t ON t.id = l.tournament_id
         WHERE t.club_id = ? AND l.sport = ? AND l.club_identity = ? AND l.is_manual = 0
           AND l.club_elo_after IS NOT NULL AND l.club_matches_after IS NOT NULL{filters}
      ORDER BY l.updated_at DESC, l.tournament_id DESC, l.match_order DESC
         LIMIT 1
        """,
        params,
    ).fetchone()


def _latest_manual_rating(conn, club_id: str, sport: str, profile_id: str):
    """The profile's latest manual club rating row (``elo_after``, ``updated_at``), or None."""
    log_ids = [*_profile_player_ids(conn, profile_id), profile_id]
    placeholders = ",".join("?" for _ in log_ids)
    return conn.execute(
        f"SELECT elo_after, updated_at FROM player_elo_log"
        f" WHERE tournament_id = ? AND is_manual = 1 AND sport = ? AND player_id IN ({placeholders})"
        f" ORDER BY updated_at DESC LIMIT 1",
        [club_id, sport, *log_ids],
    ).fetchone()


def _rate(
    match: Match,
    ratings: dict[str, float],
    counts: dict[str, int],
    team_mode: bool,
    data: dict,
    k_overrides: dict[str, int],
) -> list[EloUpdate]:
    """Rate one match exactly as the main chain does, from club ratings."""
    multiplier = _mexicano_k_multiplier(data, match)
    effective_k = _build_effective_k_overrides(match, counts, k_overrides, multiplier)
    return compute_match_elo_updates(match, ratings, counts, team_mode, effective_k)


# ---------------------------------------------------------------------------
# Whole-club replay
# ---------------------------------------------------------------------------


def _replay_club(club_id: str) -> bool:
    """Replay *club_id* and write changed rows.  Returns True if anything changed."""
    with get_db() as conn:
        match_rows = conn.execute(
            """
            SELECT l.tournament_id, l.sport, l.match_id, l.player_id, l.match_order, l.elo_before,
                   l.club_identity, l.club_elo_before, l.club_elo_after, l.club_matches_after,
                   l.match_payload, l.updated_at
              FROM player_elo_log l
              JOIN tournaments t ON t.id = l.tournament_id
             WHERE t.club_id = ? AND l.is_manual = 0
            """,
            (club_id,),
        ).fetchall()
        if not match_rows:
            return False
        manual_rows = conn.execute(
            "SELECT player_id, sport, elo_after, updated_at FROM player_elo_log WHERE tournament_id = ? AND is_manual = 1",
            (club_id,),
        ).fetchall()
        tournament_profiles = _tournament_profile_map(conn, club_id)
        manual_profiles = _manual_profile_map(conn, {r["player_id"] for r in manual_rows})
        start_counts = _start_match_counts(conn, club_id)

    # Group log rows per match.
    matches: dict[tuple[str, str, str], dict] = {}
    for row in match_rows:
        key = (row["tournament_id"], row["sport"], row["match_id"])
        entry = matches.setdefault(
            key,
            {"ts": row["updated_at"], "order": row["match_order"], "rows": {}, "payload": row["match_payload"]},
        )
        entry["ts"] = min(entry["ts"], row["updated_at"])
        entry["rows"][row["player_id"]] = row

    # Match objects come from the in-memory tournaments (exact scores, sets,
    # Mexicano match length).  A match no longer in its tournament is skipped.
    tournament_ctx: dict[str, tuple[dict, dict, bool, dict[str, int]]] = {}
    for tid in {key[0] for key in matches}:
        data = _tournaments.get(tid)
        if data is None:
            continue
        tournament, ttype = data["tournament"], data.get("type", "")
        by_id = {m.id: m for m in _extract_completed_matches(tournament, ttype)}
        tournament_ctx[tid] = (data, by_id, _is_team_mode(tournament, ttype), get_k_factor_overrides(tid))

    # Events in play order; at the same instant a manual rating applies first.
    events: list[tuple[tuple, str, object]] = []
    for key, entry in matches.items():
        events.append(((entry["ts"], 1, key[0], entry["order"]), "match", key))
    for row in manual_rows:
        events.append(((row["updated_at"], 0, "", 0), "manual", row))
    events.sort(key=lambda e: e[0])

    # Chains per (sport, identity).
    rating: dict[tuple[str, str], float] = {}
    count: dict[tuple[str, str], int] = {}
    played: set[tuple[str, str]] = set()
    results: dict[tuple[str, str, str, str], _ClubResult] = {}

    for _sort_key, kind, item in events:
        if kind == "manual":
            profile_id = manual_profiles.get(item["player_id"])
            if profile_id is not None:
                rating[(item["sport"], profile_id)] = float(item["elo_after"])
            continue

        tid, sport, match_id = item
        ctx = tournament_ctx.get(tid)
        match = ctx[1].get(match_id) if ctx else None
        if match is None:
            continue
        data, _by_id, team_mode, k_overrides = ctx

        identities: dict[str, str] = {}
        ratings: dict[str, float] = {}
        counts: dict[str, int] = {}
        for player_id, row in matches[item]["rows"].items():
            identity = tournament_profiles.get((tid, player_id)) or f"{tid}:{player_id}"
            chain = (sport, identity)
            if chain not in played:
                played.add(chain)
                rating.setdefault(chain, float(row["elo_before"]))
                count[chain] = start_counts.get((tid, sport, player_id), 0)
            identities[player_id], ratings[player_id], counts[player_id] = identity, rating[chain], count[chain]

        for u in _rate(match, ratings, counts, team_mode, data, k_overrides):
            identity = identities.get(u.player_id)
            if identity is None:
                continue
            rating[(sport, identity)] = u.elo_after
            count[(sport, identity)] = u.matches_after
            results[(tid, sport, match_id, u.player_id)] = _ClubResult(
                identity, u.elo_before, u.elo_after, u.matches_after
            )

    return _write_changes(matches, results)


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def _write_changes(
    matches: dict[tuple[str, str, str], dict], results: dict[tuple[str, str, str, str], _ClubResult]
) -> bool:
    """Write the club values that differ from the stored rows (``None`` rows always differ)."""
    row_updates: list[tuple] = []
    payload_updates: list[tuple[str, str, str, str]] = []
    for key, entry in matches.items():
        tid, sport, match_id = key
        changed = False
        for player_id, row in entry["rows"].items():
            result = results.get((tid, sport, match_id, player_id))
            if result is None or not _differs(row, result):
                continue
            row_updates.append(
                (
                    result.identity,
                    result.elo_before,
                    result.elo_after,
                    result.matches_after,
                    tid,
                    sport,
                    match_id,
                    player_id,
                )
            )
            changed = True
        if changed:
            payload_updates.append((_payload_with_club_elo(entry["payload"], key, results), tid, sport, match_id))

    if not row_updates:
        return False
    with get_db() as conn:
        conn.executemany(
            "UPDATE player_elo_log"
            " SET club_identity = ?, club_elo_before = ?, club_elo_after = ?, club_matches_after = ?"
            " WHERE tournament_id = ? AND sport = ? AND match_id = ? AND player_id = ?",
            row_updates,
        )
        conn.executemany(
            "UPDATE player_elo_log SET match_payload = ? WHERE tournament_id = ? AND sport = ? AND match_id = ?",
            payload_updates,
        )
    return True


def _differs(row, result: _ClubResult) -> bool:
    if row is None or row["club_elo_before"] is None or row["club_elo_after"] is None:
        return True
    return (
        row["club_identity"] != result.identity
        or row["club_matches_after"] != result.matches_after
        or abs(row["club_elo_before"] - result.elo_before) > _EPSILON
        or abs(row["club_elo_after"] - result.elo_after) > _EPSILON
    )


def _payload_with_club_elo(
    payload_json: str,
    key: tuple[str, str, str],
    results: dict[tuple[str, str, str, str], _ClubResult],
) -> str:
    """Add each participant's club ratings to the match payload (shown in club history)."""
    try:
        payload = json.loads(payload_json or "{}")
    except json.JSONDecodeError:
        return payload_json
    tid, sport, match_id = key
    for side in ("team1", "team2"):
        for participant in payload.get(side) or []:
            result = results.get((tid, sport, match_id, str(participant.get("player_id") or "")))
            if result is not None:
                participant["club_elo_before"] = result.elo_before
                participant["club_elo_after"] = result.elo_after
    return json.dumps(payload)


# ---------------------------------------------------------------------------
# Lookups
# ---------------------------------------------------------------------------


def _tournament_profile_map(conn, club_id: str) -> dict[tuple[str, str], str]:
    """``{(tournament_id, player_id): profile_id}`` for the club's linked players.

    ``player_secrets`` wins over ``player_history``, as in
    :func:`.elo_store._get_linked_profiles`.
    """
    mapping: dict[tuple[str, str], str] = {}
    history = conn.execute(
        """
        SELECT ph.entity_id AS tournament_id, ph.player_id, ph.profile_id
          FROM player_history ph
          JOIN tournaments t ON t.id = ph.entity_id
         WHERE t.club_id = ? AND ph.entity_type = 'tournament' AND ph.profile_id IS NOT NULL
        """,
        (club_id,),
    ).fetchall()
    secrets = conn.execute(
        """
        SELECT ps.tournament_id, ps.player_id, ps.profile_id
          FROM player_secrets ps
          JOIN tournaments t ON t.id = ps.tournament_id
         WHERE t.club_id = ? AND ps.profile_id IS NOT NULL
        """,
        (club_id,),
    ).fetchall()
    for row in [*history, *secrets]:
        mapping[(row["tournament_id"], row["player_id"])] = row["profile_id"]
    return mapping


def _manual_profile_map(conn, player_ids: set[str]) -> dict[str, str]:
    """Map manual-row ``player_id`` values to profiles.

    A manual row names one of the profile's tournament players, or the profile
    id itself when the profile has never played (see
    ``routes_clubs._record_club_elo_override``).  Going through the player ids
    means a merged profile's manual ratings follow its tournament players.
    """
    if not player_ids:
        return {}
    ids = sorted(player_ids)
    placeholders = ",".join("?" for _ in ids)
    mapping: dict[str, str] = {}
    profiles = conn.execute(f"SELECT id FROM player_profiles WHERE id IN ({placeholders})", ids).fetchall()
    for row in profiles:
        mapping[row["id"]] = row["id"]
    linked = conn.execute(
        f"SELECT player_id, profile_id FROM player_history"
        f" WHERE entity_type = 'tournament' AND profile_id IS NOT NULL AND player_id IN ({placeholders})"
        f" UNION ALL"
        f" SELECT player_id, profile_id FROM player_secrets"
        f" WHERE profile_id IS NOT NULL AND player_id IN ({placeholders})",
        [*ids, *ids],
    ).fetchall()
    for row in linked:
        mapping[row["player_id"]] = row["profile_id"]
    return mapping


def _start_match_counts(conn, club_id: str, tournament_id: str | None = None) -> dict[tuple[str, str, str], int]:
    """``{(tournament_id, sport, player_id): matches played before the tournament}``.

    Seeds the K-factor experience of a player's first club match, mirroring
    :func:`.elo_store.get_tournament_elo_snapshots`.
    """
    tournament_filter = " AND pe.tournament_id = ?" if tournament_id else ""
    params = (club_id, tournament_id) if tournament_id else (club_id,)
    rows = conn.execute(
        f"""
        SELECT pe.tournament_id, pe.sport, pe.player_id,
               pe.matches_played - (SELECT COUNT(*) FROM player_elo_log el
                                     WHERE el.tournament_id = pe.tournament_id
                                       AND el.sport = pe.sport
                                       AND el.player_id = pe.player_id) AS start_count
          FROM player_elo pe
          JOIN tournaments t ON t.id = pe.tournament_id
         WHERE t.club_id = ?{tournament_filter}
        """,
        params,
    ).fetchall()
    return {(r["tournament_id"], r["sport"], r["player_id"]): max(0, int(r["start_count"] or 0)) for r in rows}
