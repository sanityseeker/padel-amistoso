"""Persistence layer for ELO ratings.

Provides CRUD operations against the ``player_elo`` table and helpers
for reading/writing ELO columns on ``player_profiles`` and
``player_history``.  All database access goes through :func:`get_db`.
"""

from __future__ import annotations

import logging
import json
from datetime import datetime, timezone
from uuid import uuid4

from backend.models import Sport
from backend.tournaments.elo import DEFAULT_RATING, EloUpdate

from .db import get_db
from .rating_scope import RatingScope, scope_stats, scoped_recent_logs

logger = logging.getLogger(__name__)

DEFAULT_COMMUNITY_ID = "open"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _match_timestamp(match: object) -> str:
    """ISO timestamp for a match's ELO rows, from the match's real scored time.

    Deriving the ``updated_at`` written to ``player_elo`` / ``player_elo_log``
    from the match's own ``scored_at`` (a unix epoch) — rather than
    ``datetime.now()`` — means a recalculation reproduces the *same* timestamps
    instead of stamping every replayed row with the moment of the recalc.  That
    keeps the ELO history and the chronological ordering keys (used to pick a
    profile's "latest" rating) faithful to when matches were actually played.
    """
    scored_at = getattr(match, "scored_at", None)
    if isinstance(scored_at, (int, float)) and scored_at > 0:
        return datetime.fromtimestamp(scored_at, tz=timezone.utc).isoformat()
    return datetime.now(timezone.utc).isoformat()


def _get_tournament_community_id(tournament_id: str, conn=None) -> str:
    """Return the community_id for a tournament, defaulting to 'open'."""

    def _query(c):
        row = c.execute("SELECT community_id FROM tournaments WHERE id = ?", (tournament_id,)).fetchone()
        return row["community_id"] if row else DEFAULT_COMMUNITY_ID

    if conn is not None:
        return _query(conn)
    with get_db() as c:
        return _query(c)


# ---------------------------------------------------------------------------
# Tournament-scoped ELO operations
# ---------------------------------------------------------------------------


def _get_linked_profiles(tournament_id: str, conn=None) -> list[dict]:
    """Return ``[{player_id, profile_id}]`` for all players linked to a profile.

    Checks both ``player_secrets`` (active/in-progress tournaments) and
    ``player_history`` (finished tournaments whose secrets were migrated).
    When a player appears in both, ``player_secrets`` wins.
    """

    def _query(c):
        rows = c.execute(
            "SELECT player_id, profile_id FROM player_secrets WHERE tournament_id = ? AND profile_id IS NOT NULL",
            (tournament_id,),
        ).fetchall()
        seen = {r["player_id"] for r in rows}
        history_rows = c.execute(
            "SELECT player_id, profile_id FROM player_history WHERE entity_type = 'tournament' AND entity_id = ?",
            (tournament_id,),
        ).fetchall()
        rows = list(rows) + [r for r in history_rows if r["player_id"] not in seen]
        return rows

    if conn is not None:
        return _query(conn)
    with get_db() as c:
        return _query(c)


def get_tournament_elos(tournament_id: str, sport: str = Sport.PADEL) -> dict[str, float]:
    """Return ``{player_id: current_elo}`` for all players in a tournament."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT player_id, elo_after FROM player_elo WHERE tournament_id = ? AND sport = ?",
            (tournament_id, sport),
        ).fetchall()
    return {r["player_id"]: r["elo_after"] for r in rows}


def get_tournament_match_counts(tournament_id: str, sport: str = Sport.PADEL) -> dict[str, int]:
    """Return ``{player_id: matches_played}`` for all players in a tournament."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT player_id, matches_played FROM player_elo WHERE tournament_id = ? AND sport = ?",
            (tournament_id, sport),
        ).fetchall()
    return {r["player_id"]: r["matches_played"] for r in rows}


def get_k_factor_overrides(tournament_id: str) -> dict[str, int]:
    """Return ``{player_id: k_factor}`` for linked players with a K-factor override."""
    with get_db() as conn:
        linked = _get_linked_profiles(tournament_id, conn)
        if not linked:
            return {}
        profile_map = {r["profile_id"]: r["player_id"] for r in linked}
        placeholders = ",".join("?" for _ in profile_map)
        rows = conn.execute(
            f"SELECT id, k_factor_override FROM player_profiles"
            f" WHERE id IN ({placeholders}) AND k_factor_override IS NOT NULL",
            list(profile_map.keys()),
        ).fetchall()
    return {profile_map[r["id"]]: r["k_factor_override"] for r in rows}


def initialize_tournament_elos(
    tournament_id: str,
    player_ids: list[str],
    sport: str = Sport.PADEL,
    *,
    elo_overrides: dict[str, float] | None = None,
    match_count_overrides: dict[str, int] | None = None,
) -> None:
    """Seed ELO rows for every player at tournament start.

    For players linked to a profile, their current profile ELO (scoped to
    the tournament's community) is used.  Unlinked players start at
    ``DEFAULT_RATING``.

    When ``elo_overrides`` / ``match_count_overrides`` are supplied (e.g.
    during a retroactive recalculation), those values take precedence over
    the player-profile lookup so the original pre-tournament state is
    restored exactly.
    """
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        community_id = _get_tournament_community_id(tournament_id, conn)
        # Look up profile ELO for linked players not already covered by overrides
        profile_elos: dict[str, float] = {}
        profile_counts: dict[str, int] = {}
        covered_pids = set(elo_overrides or {}) & set(match_count_overrides or {})
        uncovered_pids = [pid for pid in player_ids if pid not in covered_pids]
        if uncovered_pids:
            linked = _get_linked_profiles(tournament_id, conn)
            # Only look up profiles for players we don't already have overrides for
            linked = [r for r in linked if r["player_id"] in set(uncovered_pids)]
            if linked:
                profile_ids = [r["profile_id"] for r in linked]
                pid_to_player = {r["profile_id"]: r["player_id"] for r in linked}
                placeholders = ",".join("?" for _ in profile_ids)
                # The community's own rating: communities never seed each other, so a
                # player new to this community starts at the default rating.
                profiles = conn.execute(
                    f"SELECT profile_id, elo, matches FROM profile_community_elo"
                    f" WHERE profile_id IN ({placeholders}) AND community_id = ? AND sport = ?",
                    [*profile_ids, community_id, sport],
                ).fetchall()
                for p in profiles:
                    player_id = pid_to_player.get(p["profile_id"])
                    if player_id:
                        profile_elos[player_id] = p["elo"]
                        profile_counts[player_id] = p["matches"]

        # Merge: explicit overrides win over profile lookups
        starting_elos = {**profile_elos, **(elo_overrides or {})}
        starting_counts = {**profile_counts, **(match_count_overrides or {})}

        conn.executemany(
            """INSERT OR IGNORE INTO player_elo
               (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    tournament_id,
                    pid,
                    sport,
                    starting_elos.get(pid, DEFAULT_RATING),
                    starting_elos.get(pid, DEFAULT_RATING),
                    starting_counts.get(pid, 0),
                    now,
                )
                for pid in player_ids
            ],
        )


def upsert_tournament_elo(
    tournament_id: str,
    updates: list[EloUpdate],
    sport: str = Sport.PADEL,
    updated_at: str | None = None,
) -> None:
    """Write ELO updates for players after a match.

    *updated_at* should be the match's real scored time (see
    :func:`_match_timestamp`) so a recalculation preserves the original
    chronology instead of overwriting it with the recalc moment.
    """
    now = updated_at or datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.executemany(
            """INSERT INTO player_elo
               (tournament_id, player_id, sport, elo_before, elo_after, matches_played, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (tournament_id, player_id, sport) DO UPDATE SET
                 elo_after = excluded.elo_after,
                 matches_played = excluded.matches_played,
                 updated_at = excluded.updated_at""",
            [
                (
                    tournament_id,
                    u.player_id,
                    sport,
                    u.elo_before,
                    u.elo_after,
                    u.matches_after,
                    now,
                )
                for u in updates
            ],
        )


def get_tournament_elo_timestamps(
    tournament_id: str,
    sport: str = Sport.PADEL,
) -> tuple[dict[str, str], dict[str, str]]:
    """Return ``({match_id: updated_at}, {player_id: updated_at})`` for existing rows.

    Captured before a recalculation wipes the rows so the original per-match
    timestamps can be carried over, keeping the ELO history's chronology intact
    (a recalc must not restamp matches with the moment it ran).
    """
    with get_db() as conn:
        log_rows = conn.execute(
            "SELECT match_id, MIN(updated_at) AS updated_at FROM player_elo_log"
            " WHERE tournament_id = ? AND sport = ? GROUP BY match_id",
            (tournament_id, sport),
        ).fetchall()
        elo_rows = conn.execute(
            "SELECT player_id, updated_at FROM player_elo WHERE tournament_id = ? AND sport = ?",
            (tournament_id, sport),
        ).fetchall()
    return (
        {r["match_id"]: r["updated_at"] for r in log_rows},
        {r["player_id"]: r["updated_at"] for r in elo_rows},
    )


def _match_decider_value(match: object) -> str | None:
    """Decider a set score was recorded under (``None`` for points scores)."""
    if not getattr(match, "sets", None):
        return None
    decider = getattr(match, "decider", None)
    return getattr(decider, "value", decider) or "full_set"


def build_match_log_payload(match: object, updates: list[EloUpdate]) -> dict:
    """The ``match_payload`` of a match's log rows: score, sets and each side's ratings."""
    updates_by_player = {u.player_id: u for u in updates}

    def _serialize_team(team: list[object]) -> list[dict[str, float | str]]:
        serialized: list[dict[str, float | str]] = []
        for p in team:
            player_id = getattr(p, "id", "")
            upd = updates_by_player.get(player_id)
            if not player_id or upd is None:
                continue
            serialized.append(
                {
                    "player_id": player_id,
                    "player_name": getattr(p, "name", "") or player_id,
                    "elo_before": float(upd.elo_before),
                    "elo_after": float(upd.elo_after),
                }
            )
        return serialized

    return {
        "match_id": getattr(match, "id", ""),
        "score": list(getattr(match, "score", []) or []),
        "sets": [list(s) for s in (getattr(match, "sets", None) or [])],
        "decider": _match_decider_value(match),
        "team1": _serialize_team(getattr(match, "team1", []) or []),
        "team2": _serialize_team(getattr(match, "team2", []) or []),
        "round_number": int(getattr(match, "round_number", 0) or 0),
        "round_label": str(getattr(match, "round_label", "") or ""),
    }


def upsert_tournament_elo_log(
    tournament_id: str,
    match: object,
    updates: list[EloUpdate],
    sport: str = Sport.PADEL,
    match_order: int = 0,
    updated_at: str | None = None,
) -> None:
    """Write per-match ELO logs for every participant in a completed match.

    *updated_at* pins the row timestamp (e.g. the value preserved from before a
    recalculation); when omitted it is derived from the match's real scored time.
    """
    payload = build_match_log_payload(match, updates)
    payload_json = json.dumps(payload)

    # Prefer a caller-pinned timestamp (preserved across recalculation); else the
    # match's real scored time — never the recalc moment.
    now = updated_at or _match_timestamp(match)
    with get_db() as conn:
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
            [
                (
                    tournament_id,
                    sport,
                    payload["match_id"],
                    u.player_id,
                    match_order,
                    u.elo_before,
                    u.elo_after,
                    u.elo_after - u.elo_before,
                    payload_json,
                    now,
                )
                for u in updates
            ],
        )


def reset_tournament_elos(tournament_id: str, sport: str = Sport.PADEL) -> None:
    """Delete all ELO rows for a tournament.  Used before full recalculation."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM player_elo WHERE tournament_id = ? AND sport = ?",
            (tournament_id, sport),
        )


def reset_tournament_elo_logs(tournament_id: str, sport: str = Sport.PADEL) -> None:
    """Delete all per-match ELO logs for a tournament/sport pair."""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM player_elo_log WHERE tournament_id = ? AND sport = ?",
            (tournament_id, sport),
        )


def delete_tournament_elos(tournament_id: str) -> None:
    """Remove all ELO data for a tournament (cleanup on deletion)."""
    with get_db() as conn:
        conn.execute("DELETE FROM player_elo WHERE tournament_id = ?", (tournament_id,))
        conn.execute("DELETE FROM player_elo_log WHERE tournament_id = ?", (tournament_id,))


def has_tournament_elo_log(tournament_id: str, sport: str = Sport.PADEL) -> bool:
    """Return True when the tournament has any per-match ELO log rows."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM player_elo_log WHERE tournament_id = ? AND sport = ? LIMIT 1",
            (tournament_id, sport),
        ).fetchone()
    return row is not None


def has_match_elo_log(tournament_id: str, match_id: str, sport: str = Sport.PADEL) -> bool:
    """Return True when *match_id* already has ELO log rows in this tournament.

    Used to tell a score correction (re-recording a match that was already
    rated, which needs a full replay) apart from a brand-new result (which
    only needs an incremental update).
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM player_elo_log WHERE tournament_id = ? AND match_id = ? AND sport = ? LIMIT 1",
            (tournament_id, match_id, sport),
        ).fetchone()
    return row is not None


def get_live_profile_elo_stats(
    profile_ids: list[str] | None = None,
    community_id: str | None = None,
    conn=None,
    *,
    scope: RatingScope | None = None,
) -> dict[str, dict[str, dict[str, float | int | None]]]:
    """Derive per-profile, per-sport ``{matches, elo}`` live from ``player_elo_log``.

    ``matches`` counts non-manual log rows in *scope* across every tournament
    the profile is linked to (via ``player_secrets`` or ``player_history``);
    ``elo`` is the ``elo_after`` of the chronologically latest row.  Without a
    *scope* the log is global, or restricted to *community_id* when given.
    Profiles with no log rows in scope are absent from the result so callers
    can fall back to the stored snapshot.

    The scope rules live in :mod:`.rating_scope`, shared with every
    leaderboard and history view, so all of them agree on these numbers.
    """
    if scope is None:
        scope = RatingScope(community_id=community_id or None)
    if profile_ids is not None and not profile_ids:
        return {}
    if conn is not None:
        stats = scope_stats(conn, scope, profile_ids=profile_ids)
    else:
        with get_db() as c:
            stats = scope_stats(c, scope, profile_ids=profile_ids)
    out: dict[str, dict[str, dict[str, float | int | None]]] = {}
    for (profile_id, sport), st in stats.items():
        out.setdefault(profile_id, {})[sport] = {"matches": st.matches, "elo": st.elo}
    return out


def log_manual_elo_adjustment(
    player_id: str,
    profile_id: str,
    sport: str,
    elo_before: float,
    elo_after: float,
    adjustment_reason: str | None = None,
    adjusted_by: str | None = None,
    club_id: str | None = None,
) -> None:
    """Log a manual ELO adjustment for a player profile.

    Writes a ``player_elo_log`` row with ``is_manual = 1`` so admin-initiated
    changes are tracked separately from match results.  Club-scoped
    adjustments use ``club_id`` as the row's ``tournament_id``; the club
    roster, public club leaderboard and Player Hub club views all honour such
    rows for the *rating* while leaving the match count untouched.

    The row is owned by *profile_id* (``player_elo_log.profile_id``); *player_id*
    is only a legacy key and never decides whose rating it is.
    """
    tournament_id = club_id or "manual-adjustments"
    match_id = f"MANUAL-{uuid4().hex[:12]}"
    updated_at = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO player_elo_log (
                tournament_id, sport, match_id, player_id, match_order,
                elo_before, elo_after, elo_delta, match_payload,
                updated_at, is_manual, adjustment_reason, adjusted_by, profile_id
            ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, '{}', ?, 1, ?, ?, ?)
            """,
            (
                tournament_id,
                sport,
                match_id,
                player_id,
                elo_before,
                elo_after,
                elo_after - elo_before,
                updated_at,
                adjustment_reason,
                adjusted_by,
                profile_id,
            ),
        )


def get_profile_recent_elo_logs(
    profile_id: str,
    limit: int = 20,
    community_id: str | None = None,
    club_id: str | None = None,
    *,
    scope: RatingScope | None = None,
) -> list[dict]:
    """Return recent per-match ELO logs for a profile across linked tournaments.

    Returns up to *limit* rows **per sport** so the frontend can switch
    between padel and tennis without a round-trip.

    The rows are restricted by *scope* (or by *community_id* / *club_id*, which
    build one): a community keeps its tournaments' matches; a club keeps the
    matches of tournaments with that ``club_id`` plus the club's manual
    adjustments; a season keeps its tournaments.  In club and season scope
    every rating -- the row's and each payload participant's -- is the club's
    own rating (:mod:`.club_elo`), and sports the club hides for the profile
    are left out.  The global scope never includes club-only manual rows.
    """
    if scope is None:
        scope = RatingScope(club_id=club_id or None, community_id=community_id or None)
    with get_db() as conn:
        logs = scoped_recent_logs(conn, scope, profile_id, limit)
    if scope.uses_club_chain:
        for log in logs:
            log["match_payload"] = _payload_with_club_ratings(log["match_payload"])
    return logs


def _payload_with_club_ratings(payload_json: str) -> str:
    """Show each match participant's club rating in place of the community one."""
    try:
        payload = json.loads(payload_json or "{}")
    except json.JSONDecodeError:
        return payload_json
    for side in ("team1", "team2"):
        for participant in payload.get(side) or []:
            if participant.get("club_elo_after") is not None:
                participant["elo_before"] = participant["club_elo_before"]
                participant["elo_after"] = participant["club_elo_after"]
    return json.dumps(payload)


# ---------------------------------------------------------------------------
# Profile-level ELO operations
# ---------------------------------------------------------------------------


def get_profile_elo(profile_id: str, community_id: str = DEFAULT_COMMUNITY_ID) -> dict[str, float | int]:
    """Return the current ELO ratings for a player profile in a community.

    Returns:
        Dict with keys ``elo_padel``, ``elo_tennis``,
        ``elo_padel_matches``, ``elo_tennis_matches``.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT sport, elo, matches FROM profile_community_elo WHERE profile_id = ? AND community_id = ?",
            (profile_id, community_id),
        ).fetchall()
    result: dict[str, float | int] = {
        "elo_padel": DEFAULT_RATING,
        "elo_tennis": DEFAULT_RATING,
        "elo_padel_matches": 0,
        "elo_tennis_matches": 0,
    }
    for r in rows:
        sport = r["sport"]
        if sport == Sport.PADEL:
            result["elo_padel"] = r["elo"]
            result["elo_padel_matches"] = r["matches"]
        else:
            result["elo_tennis"] = r["elo"]
            result["elo_tennis_matches"] = r["matches"]
    return result


def get_profile_starting_elos(
    pid_to_profile: dict[str, str],
    community_id: str = DEFAULT_COMMUNITY_ID,
    sport: str = Sport.PADEL,
) -> dict[str, float]:
    """Return ``{player_id: elo}`` for players linked to a profile rated in *community_id*.

    Seeds group/bracket ordering before any match is played.  Communities never
    seed each other, so players without a linked profile or without a rating in
    this community are omitted.
    """
    profile_ids = sorted({prof for prof in pid_to_profile.values() if prof})
    if not profile_ids:
        return {}
    placeholders = ",".join("?" for _ in profile_ids)
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT profile_id, elo FROM profile_community_elo"
            f" WHERE profile_id IN ({placeholders}) AND community_id = ? AND sport = ?",
            [*profile_ids, community_id, sport],
        ).fetchall()
    by_profile = {r["profile_id"]: r["elo"] for r in rows}
    return {pid: by_profile[prof] for pid, prof in pid_to_profile.items() if prof in by_profile}


def _profile_player_ids(conn, profile_id: str) -> list[str]:
    """All ``player_id`` values ever linked to *profile_id* (secrets + history)."""
    rows = conn.execute(
        "SELECT player_id FROM player_secrets WHERE profile_id = ? AND player_id IS NOT NULL"
        " UNION"
        " SELECT player_id FROM player_history"
        "  WHERE profile_id = ? AND entity_type = 'tournament' AND player_id IS NOT NULL",
        (profile_id, profile_id),
    ).fetchall()
    return [r["player_id"] for r in rows]


def refresh_profile_elo(profile_id: str) -> None:
    """Set a profile's stored ratings from its rated matches.

    For each community and sport the rating is the ``elo_after`` of the profile's
    latest match there (the community chain, see :mod:`.community_elo`) and the
    count its number of matches; a community where it has no match left goes back
    to ``DEFAULT_RATING``.  The flat ``player_profiles`` columns follow the
    community it played in last.  Used after a participation moves off the profile.
    """
    with get_db() as conn:
        rows = conn.execute(
            """SELECT COALESCE(t.community_id, ?) AS community_id, l.sport AS sport,
                      l.elo_after AS elo_after, l.updated_at AS updated_at
                 FROM player_elo_log l
            LEFT JOIN tournaments t ON t.id = l.tournament_id
                WHERE l.is_manual = 0
                  AND (EXISTS (SELECT 1 FROM player_secrets ps WHERE ps.tournament_id = l.tournament_id
                                AND ps.player_id = l.player_id AND ps.profile_id = ?)
                       OR EXISTS (SELECT 1 FROM player_history ph WHERE ph.entity_type = 'tournament'
                                AND ph.entity_id = l.tournament_id AND ph.player_id = l.player_id
                                AND ph.profile_id = ?))
             ORDER BY l.updated_at ASC, l.match_order ASC""",
            (DEFAULT_COMMUNITY_ID, profile_id, profile_id),
        ).fetchall()
        chains: dict[tuple[str, str], tuple[float, int]] = {}
        for r in rows:
            key = (r["community_id"], r["sport"])
            chains[key] = (r["elo_after"], chains.get(key, (0.0, 0))[1] + 1)
        stored = conn.execute(
            "SELECT community_id, sport FROM profile_community_elo WHERE profile_id = ?",
            (profile_id,),
        ).fetchall()
        for r in stored:
            if (r["community_id"], r["sport"]) not in chains:
                conn.execute(
                    "UPDATE profile_community_elo SET elo = ?, matches = 0"
                    " WHERE profile_id = ? AND community_id = ? AND sport = ?",
                    (DEFAULT_RATING, profile_id, r["community_id"], r["sport"]),
                )
        for (community_id, sport), (elo, matches) in chains.items():
            conn.execute(
                """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                     elo = excluded.elo, matches = excluded.matches""",
                (profile_id, community_id, sport, elo, matches),
            )
        for sport in (Sport.PADEL, Sport.TENNIS):
            latest = [r for r in rows if r["sport"] == sport]
            elo, matches = chains[(latest[-1]["community_id"], sport)] if latest else (DEFAULT_RATING, 0)
            elo_col = "elo_padel" if sport == Sport.PADEL else "elo_tennis"
            matches_col = "elo_padel_matches" if sport == Sport.PADEL else "elo_tennis_matches"
            conn.execute(
                f"UPDATE player_profiles SET {elo_col} = ?, {matches_col} = ? WHERE id = ?",
                (elo, matches, profile_id),
            )
