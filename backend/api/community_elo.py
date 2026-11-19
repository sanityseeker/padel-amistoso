"""One rating chain per community and sport.

Every community keeps one rating per player and sport: every rated match of
the community's tournaments, in the order the matches were played, whichever
tournament it belongs to.  Two events that run side by side (two leagues of a
season, a league and a weekend Mexicano) therefore share one rating: a match in
one of them starts from the player's rating after their latest match in either.

Rules:

* A player's first match in a community starts from ``DEFAULT_RATING`` with no
  experience.  Communities never seed each other.
* A player is their Hub profile when the participation is linked, else the
  participant itself (``"<tournament>:<player>"``), which is a fresh chain.
* Mexicano match-length scaling and per-profile K-factor overrides apply as
  before (:mod:`.elo_integration`).

Storage is unchanged: each match writes its participants' ``player_elo_log``
rows (``elo_before`` / ``elo_after`` are the community chain), ``player_elo``
holds each participant's span in a tournament (``elo_before`` = rating before
their first match there, ``elo_after`` = after their last one, and
``matches_played`` = experience before the tournament plus matches in it), and
``profile_community_elo`` holds each profile's current rating per community.
The flat ``player_profiles.elo_*`` columns hold the rating of the community the
profile last played in.

A newly scored match is rated on its own from each player's latest community
row (:func:`rate_new_match`).  Anything that rewrites history -- a corrected or
cleared score, a Hub link change or merge, a tournament moved or deleted --
replays the whole community (:func:`replay_community`).  The club chains seed
from the community chain, so a replay is followed by a club replay.
"""

from __future__ import annotations

import json
import logging
import threading
from collections.abc import Collection, Iterable
from dataclasses import dataclass, field
from datetime import datetime, timezone

from backend.models import Match, Sport
from backend.tournaments.elo import DEFAULT_RATING, EloUpdate, compute_match_elo_updates

from .db import get_db
from .elo_store import (
    DEFAULT_COMMUNITY_ID,
    _get_linked_profiles,
    _match_timestamp,
    build_match_log_payload,
    get_k_factor_overrides,
)
from .elo_integration import _extract_completed_matches, _extract_player_ids, _is_team_mode, elo_match_weight
from .leaderboard_cache import invalidate_leaderboard_cache, invalidate_mini_card_cache
from .state import _tournaments

logger = logging.getLogger(__name__)

# Community writes (one match or a whole replay) must not interleave.
_community_lock = threading.RLock()

# Marker in ``meta`` set once every community has been replayed on the shared chain.
_MIGRATION_KEY = "community_elo_chain_v1"

_SPORTS = (Sport.PADEL.value, Sport.TENNIS.value)


def community_of(tournament_id: str) -> str:
    """The community a tournament rates in (the built-in open community when unset)."""
    data = _tournaments.get(tournament_id) or {}
    return data.get("community_id") or DEFAULT_COMMUNITY_ID


def _identity(tid: str, player_id: str, linked: dict[str, str]) -> str:
    return linked.get(player_id) or f"{tid}:{player_id}"


# ---------------------------------------------------------------------------
# One new match
# ---------------------------------------------------------------------------


def rate_new_match(tid: str, data: dict, match: Match, sport: str) -> bool:
    """Rate a newly scored *match* from its players' latest community ratings.

    Returns False (and writes nothing) when one of the players already has a
    later rated match in the community: the caller then replays the community
    so that later match picks this one up.
    """
    community_id = community_of(tid)
    match_ts = _match_timestamp(match)
    with _community_lock, get_db() as conn:
        linked = {r["player_id"]: r["profile_id"] for r in _get_linked_profiles(tid, conn) if r["profile_id"]}
        ratings: dict[str, float] = {}
        counts: dict[str, int] = {}
        for player in [*match.team1, *match.team2]:
            latest, count = _latest_row(conn, community_id, sport, tid, player.id, linked.get(player.id))
            if latest is not None and latest["updated_at"] > match_ts:
                return False
            ratings[player.id] = float(latest["elo_after"]) if latest is not None else DEFAULT_RATING
            counts[player.id] = count
        order = (
            conn.execute(
                "SELECT COUNT(DISTINCT match_id) AS n FROM player_elo_log"
                " WHERE tournament_id = ? AND sport = ? AND is_manual = 0",
                (tid, sport),
            ).fetchone()["n"]
            + 1
        )

        tournament, ttype = data["tournament"], data.get("type", "")
        weight = elo_match_weight(data, match)
        updates = compute_match_elo_updates(
            match, ratings, counts, _is_team_mode(tournament, ttype), get_k_factor_overrides(tid), weight=weight
        )
        _write_log_rows(conn, tid, sport, [(match, updates, order, match_ts)], {})
        conn.executemany(
            """INSERT INTO player_elo
               (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (tournament_id, player_id, sport) DO UPDATE SET
                 elo_before = CASE WHEN excluded.matches_played = -1 THEN player_elo.elo_before
                                   ELSE excluded.elo_before END,
                 elo_after = excluded.elo_after,
                 matches_played = CASE WHEN excluded.matches_played = -1 THEN player_elo.matches_played + 1
                                       ELSE excluded.matches_played END,
                 updated_at = excluded.updated_at""",
            [
                (
                    tid,
                    u.player_id,
                    sport,
                    u.elo_before,
                    u.elo_after,
                    # -1: the player already played here, so keep the span's start and add one match.
                    -1 if _played_before(conn, tid, sport, u.player_id, match.id) else u.matches_after,
                    match_ts,
                )
                for u in updates
            ],
        )
        profiles = {linked[u.player_id]: u for u in updates if u.player_id in linked}
        for profile_id, u in profiles.items():
            _set_community_rating(conn, profile_id, community_id, sport, u.elo_after, u.matches_after)
            _set_flat_rating(conn, profile_id, sport, u.elo_after, u.matches_after)
    invalidate_leaderboard_cache()
    return True


def _played_before(conn, tid: str, sport: str, player_id: str, match_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM player_elo_log WHERE tournament_id = ? AND sport = ? AND player_id = ?"
        " AND is_manual = 0 AND match_id != ? LIMIT 1",
        (tid, sport, player_id, match_id),
    ).fetchone()
    return row is not None


def _latest_row(conn, community_id: str, sport: str, tid: str, player_id: str, profile_id: str | None):
    """The latest community log row of a player (``elo_after``, ``updated_at``) and their match count."""
    if profile_id is None:
        where = "l.tournament_id = ? AND l.player_id = ?"
        params: list = [tid, player_id]
    else:
        where = (
            "(EXISTS (SELECT 1 FROM player_secrets ps WHERE ps.tournament_id = l.tournament_id"
            "          AND ps.player_id = l.player_id AND ps.profile_id = ?)"
            " OR EXISTS (SELECT 1 FROM player_history ph WHERE ph.entity_type = 'tournament'"
            "          AND ph.entity_id = l.tournament_id AND ph.player_id = l.player_id AND ph.profile_id = ?))"
        )
        params = [profile_id, profile_id]
    rows = conn.execute(
        f"""SELECT l.elo_after, l.updated_at
              FROM player_elo_log l
         LEFT JOIN tournaments t ON t.id = l.tournament_id
             WHERE l.sport = ? AND l.is_manual = 0 AND COALESCE(t.community_id, ?) = ? AND {where}
          ORDER BY l.updated_at DESC, l.tournament_id DESC, l.match_order DESC""",
        [sport, DEFAULT_COMMUNITY_ID, community_id, *params],
    ).fetchall()
    return (rows[0] if rows else None), len(rows)


# ---------------------------------------------------------------------------
# Whole-community replay
# ---------------------------------------------------------------------------


@dataclass
class _Span:
    """One participant's ratings within one tournament."""

    start_elo: float | None = None
    start_count: int = 0
    end_elo: float | None = None
    played: int = 0
    last_ts: str | None = None


@dataclass
class _Chain:
    elo: float = DEFAULT_RATING
    count: int = 0
    tournaments: set[str] = field(default_factory=set)


def replay_communities(community_ids: Iterable[str]) -> None:
    """Replay each community once, then the clubs of their tournaments.  Never raises."""
    for community_id in sorted(set(community_ids)):
        replay_community(community_id)


def replay_community(community_id: str) -> None:
    """Re-rate every match of *community_id* in play order and rewrite its ratings.  Never raises."""
    from .club_elo import recompute_club_elo_for_tournaments  # noqa: PLC0415 — club_elo imports elo_integration

    try:
        with _community_lock:
            tids = _replay(community_id)
    except Exception:
        logger.exception("Failed to replay community ELO for %s", community_id)
        return
    recompute_club_elo_for_tournaments(tids)
    invalidate_leaderboard_cache()
    invalidate_mini_card_cache(("tournament",))
    invalidate_mini_card_cache(("profile",))


def _replay(community_id: str) -> list[str]:
    """Replay one community; returns its tournament ids."""
    tids = sorted(tid for tid in list(_tournaments) if community_of(tid) == community_id)
    with get_db() as conn:
        log_ts: dict[tuple[str, str], str] = {}
        old_payloads: dict[tuple[str, str], str] = {}
        if tids:
            marks = ",".join("?" for _ in tids)
            for r in conn.execute(
                f"SELECT tournament_id, match_id, MIN(updated_at) AS ts, MAX(match_payload) AS payload"
                f"  FROM player_elo_log WHERE tournament_id IN ({marks}) AND is_manual = 0"
                f" GROUP BY tournament_id, match_id",
                tids,
            ).fetchall():
                log_ts[(r["tournament_id"], r["match_id"])] = r["ts"]
                old_payloads[(r["tournament_id"], r["match_id"])] = r["payload"]
        linked_by_tid = {
            tid: {r["player_id"]: r["profile_id"] for r in _get_linked_profiles(tid, conn) if r["profile_id"]}
            for tid in tids
        }
        # Participants who have not played keep the timestamp of their row.
        old_stamps: dict[tuple[str, str], str] = {}
        if tids:
            for r in conn.execute(
                f"SELECT tournament_id, player_id, updated_at FROM player_elo WHERE tournament_id IN ({marks})",
                tids,
            ).fetchall():
                old_stamps[(r["tournament_id"], r["player_id"])] = r["updated_at"]

    # Every rated match of the community, in play order.  The stored timestamp
    # wins (the moment it was first rated); a new match uses its scored time.
    events: list[tuple[str, str, int, Match]] = []
    ctx: dict[str, tuple[dict, str, bool, dict[str, int]]] = {}
    for tid in tids:
        data = _tournaments.get(tid)
        if data is None:
            continue
        tournament, ttype = data["tournament"], data.get("type", "")
        ctx[tid] = (data, data.get("sport", "padel"), _is_team_mode(tournament, ttype), get_k_factor_overrides(tid))
        for i, match in enumerate(_extract_completed_matches(tournament, ttype)):
            events.append((log_ts.get((tid, match.id)) or _match_timestamp(match), tid, i, match))
    events.sort(key=lambda e: (e[0], e[1], e[2]))

    chains: dict[tuple[str, str], _Chain] = {}
    spans: dict[tuple[str, str], _Span] = {}
    rated: dict[str, list[tuple[Match, list[EloUpdate], int, str]]] = {tid: [] for tid in ctx}
    for ts, tid, _i, match in events:
        data, sport, team_mode, k_overrides = ctx[tid]
        linked = linked_by_tid[tid]
        ratings: dict[str, float] = {}
        counts: dict[str, int] = {}
        for player in [*match.team1, *match.team2]:
            chain = chains.setdefault((sport, _identity(tid, player.id, linked)), _Chain())
            ratings[player.id], counts[player.id] = chain.elo, chain.count
        updates = compute_match_elo_updates(
            match, ratings, counts, team_mode, k_overrides, weight=elo_match_weight(data, match)
        )
        rated[tid].append((match, updates, len(rated[tid]) + 1, ts))
        for u in updates:
            chain = chains[(sport, _identity(tid, u.player_id, linked))]
            chain.elo, chain.count = u.elo_after, u.matches_after
            chain.tournaments.add(tid)
            span = spans.setdefault((tid, u.player_id), _Span())
            if span.start_elo is None:
                span.start_elo, span.start_count = u.elo_before, u.matches_before
            span.end_elo, span.played, span.last_ts = u.elo_after, span.played + 1, ts

    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        for tid, (data, sport, _team_mode, _k) in ctx.items():
            conn.execute(
                "DELETE FROM player_elo_log WHERE tournament_id = ? AND sport = ? AND is_manual = 0",
                (tid, sport),
            )
            _write_log_rows(conn, tid, sport, rated[tid], old_payloads)
            # Every participant keeps a row: those who have not played yet show their current rating.
            linked = linked_by_tid[tid]
            player_ids = set(_extract_player_ids(data["tournament"], data.get("type", "")))
            player_ids |= {pid for (t, pid) in spans if t == tid}
            conn.execute("DELETE FROM player_elo WHERE tournament_id = ? AND sport = ?", (tid, sport))
            rows = []
            for pid in sorted(player_ids):
                span = spans.get((tid, pid))
                if span is not None and span.start_elo is not None and span.end_elo is not None:
                    rows.append(
                        (tid, pid, sport, span.start_elo, span.end_elo, span.start_count + span.played, span.last_ts)
                    )
                else:
                    chain = chains.get((sport, _identity(tid, pid, linked))) or _Chain()
                    stamp = old_stamps.get((tid, pid), now)
                    rows.append((tid, pid, sport, chain.elo, chain.elo, chain.count, stamp))
            conn.executemany(
                "INSERT INTO player_elo"
                " (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)"
                " VALUES (?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            # Each linked profile's history line shows its span in this tournament.
            for pid, profile_id in linked.items():
                span = spans.get((tid, pid))
                if span is None:
                    continue
                conn.execute(
                    "UPDATE player_history SET elo_before = ?, elo_after = ?"
                    " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ? AND sport = ?",
                    (span.start_elo, span.end_elo, profile_id, tid, sport),
                )

        # Profile ratings in this community: the end of each chain; profiles left
        # without a match here go back to the starting rating.
        profile_ids = {p for linked in linked_by_tid.values() for p in linked.values()}
        rated_profiles: dict[str, set[str]] = {sport: set() for sport in _SPORTS}
        for (sport, identity), chain in chains.items():
            if identity not in profile_ids or chain.count == 0:
                continue  # an unlinked participant, or a profile without a match here
            rated_profiles.setdefault(sport, set()).add(identity)
            _set_community_rating(conn, identity, community_id, sport, chain.elo, chain.count)
        stale = [
            (r["profile_id"], r["sport"])
            for r in conn.execute(
                "SELECT profile_id, sport FROM profile_community_elo WHERE community_id = ?"
                " AND (elo != ? OR matches != 0)",
                (community_id, DEFAULT_RATING),
            ).fetchall()
            if r["profile_id"] not in rated_profiles.get(r["sport"], set())
        ]
        for profile_id, sport in stale:
            _set_community_rating(conn, profile_id, community_id, sport, DEFAULT_RATING, 0)
        touched = {p for ps in rated_profiles.values() for p in ps} | {p for p, _s in stale}
        for profile_id in sorted(touched):
            refresh_flat_rating(conn, profile_id)
    return tids


# ---------------------------------------------------------------------------
# Writing
# ---------------------------------------------------------------------------


def _write_log_rows(
    conn,
    tid: str,
    sport: str,
    rated: list[tuple[Match, list[EloUpdate], int, str]],
    old_payloads: dict[tuple[str, str], str],
) -> None:
    """Write the log rows of rated matches; club ratings already in a payload are kept."""
    rows = []
    for match, updates, order, ts in rated:
        payload = build_match_log_payload(match, updates)
        old = old_payloads.get((tid, match.id))
        if old:
            _keep_club_values(payload, old)
        payload_json = json.dumps(payload)
        for u in updates:
            rows.append(
                (
                    tid,
                    sport,
                    match.id,
                    u.player_id,
                    order,
                    u.elo_before,
                    u.elo_after,
                    u.elo_after - u.elo_before,
                    payload_json,
                    ts,
                )
            )
    conn.executemany(
        """INSERT INTO player_elo_log
           (tournament_id, sport, match_id, player_id, match_order,
            elo_before, elo_after, elo_delta, match_payload, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (tournament_id, sport, match_id, player_id) DO UPDATE SET
             match_order = excluded.match_order,
             elo_before = excluded.elo_before,
             elo_after = excluded.elo_after,
             elo_delta = excluded.elo_delta,
             match_payload = excluded.match_payload,
             updated_at = excluded.updated_at""",
        rows,
    )


def _keep_club_values(payload: dict, old_json: str) -> None:
    """Carry each participant's club ratings over from the previous payload (the club replay updates them)."""
    try:
        old = json.loads(old_json or "{}")
    except json.JSONDecodeError:
        return
    club = {
        str(p.get("player_id")): p
        for side in ("team1", "team2")
        for p in old.get(side) or []
        if p.get("club_elo_after") is not None
    }
    for side in ("team1", "team2"):
        for participant in payload.get(side) or []:
            prev = club.get(str(participant.get("player_id")))
            if prev is not None:
                participant["club_elo_before"] = prev.get("club_elo_before")
                participant["club_elo_after"] = prev.get("club_elo_after")


def _set_community_rating(conn, profile_id: str, community_id: str, sport: str, elo: float, matches: int) -> None:
    conn.execute(
        """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
             elo = excluded.elo, matches = excluded.matches""",
        (profile_id, community_id, sport, elo, matches),
    )


def _set_flat_rating(conn, profile_id: str, sport: str, elo: float, matches: int) -> None:
    elo_col, matches_col = (
        ("elo_padel", "elo_padel_matches") if sport == Sport.PADEL else ("elo_tennis", "elo_tennis_matches")
    )
    conn.execute(
        f"UPDATE player_profiles SET {elo_col} = ?, {matches_col} = ? WHERE id = ?",
        (elo, matches, profile_id),
    )


def refresh_flat_rating(conn, profile_id: str) -> None:
    """Set the flat ``player_profiles`` ratings to the community the profile last played in."""
    for sport in _SPORTS:
        latest = conn.execute(
            """SELECT COALESCE(t.community_id, ?) AS community_id
                 FROM player_elo_log l
            LEFT JOIN tournaments t ON t.id = l.tournament_id
                WHERE l.sport = ? AND l.is_manual = 0
                  AND (EXISTS (SELECT 1 FROM player_secrets ps WHERE ps.tournament_id = l.tournament_id
                                AND ps.player_id = l.player_id AND ps.profile_id = ?)
                       OR EXISTS (SELECT 1 FROM player_history ph WHERE ph.entity_type = 'tournament'
                                AND ph.entity_id = l.tournament_id AND ph.player_id = l.player_id
                                AND ph.profile_id = ?))
             ORDER BY l.updated_at DESC LIMIT 1""",
            (DEFAULT_COMMUNITY_ID, sport, profile_id, profile_id),
        ).fetchone()
        row = (
            conn.execute(
                "SELECT elo, matches FROM profile_community_elo WHERE profile_id = ? AND community_id = ? AND sport = ?",
                (profile_id, latest["community_id"], sport),
            ).fetchone()
            if latest is not None
            else None
        )
        if row is not None:
            _set_flat_rating(conn, profile_id, sport, row["elo"], row["matches"])
        else:
            _set_flat_rating(conn, profile_id, sport, DEFAULT_RATING, 0)


# ---------------------------------------------------------------------------
# Lookups and one-off migration
# ---------------------------------------------------------------------------


def communities_of(tournament_ids: Collection[str]) -> set[str]:
    """The communities of the given (in-memory) tournaments."""
    return {community_of(tid) for tid in tournament_ids if tid in _tournaments}


def all_communities() -> set[str]:
    """Every community that has a tournament in memory."""
    return {community_of(tid) for tid in list(_tournaments)}


def migrate_to_community_chains() -> None:
    """Replay every community once, the first time the shared chain runs on this database."""
    with get_db() as conn:
        done = conn.execute("SELECT value FROM meta WHERE key = ?", (_MIGRATION_KEY,)).fetchone()
    if done is not None:
        return
    replay_communities(all_communities())
    with get_db() as conn:
        conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, 1)", (_MIGRATION_KEY,))
