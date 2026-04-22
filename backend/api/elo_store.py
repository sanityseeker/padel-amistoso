"""Persistence layer for ELO ratings.

Provides CRUD operations against the ``player_elo`` table and helpers
for reading/writing ELO columns on ``player_profiles`` and
``player_history``.  All database access goes through :func:`get_db`.
"""

from __future__ import annotations

import logging
import json
from datetime import datetime, timezone

from backend.models import Sport
from backend.tournaments.elo import DEFAULT_RATING, EloUpdate

from .db import get_db

logger = logging.getLogger(__name__)

DEFAULT_COMMUNITY_ID = "open"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


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
                # Query community-specific ELO; for specialized communities also fetch
                # the global (open) ELO as a fallback so new community members start
                # from their existing global rating rather than the default 1000.
                if community_id != DEFAULT_COMMUNITY_ID:
                    community_ids_to_query = [community_id, DEFAULT_COMMUNITY_ID]
                else:
                    community_ids_to_query = [community_id]
                community_placeholders = ",".join("?" for _ in community_ids_to_query)
                profiles = conn.execute(
                    f"SELECT profile_id, community_id, elo, matches FROM profile_community_elo"
                    f" WHERE profile_id IN ({placeholders})"
                    f"   AND community_id IN ({community_placeholders}) AND sport = ?",
                    [*profile_ids, *community_ids_to_query, sport],
                ).fetchall()
                # community-specific wins over global fallback
                for p in profiles:
                    player_id = pid_to_player.get(p["profile_id"])
                    if player_id:
                        if player_id not in profile_elos or p["community_id"] == community_id:
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
) -> None:
    """Write ELO updates for players after a match."""
    now = datetime.now(timezone.utc).isoformat()
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


def upsert_tournament_elo_log(
    tournament_id: str,
    match: object,
    updates: list[EloUpdate],
    sport: str = Sport.PADEL,
    match_order: int = 0,
) -> None:
    """Write per-match ELO logs for every participant in a completed match."""

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

    team1 = _serialize_team(getattr(match, "team1", []) or [])
    team2 = _serialize_team(getattr(match, "team2", []) or [])
    payload = {
        "match_id": getattr(match, "id", ""),
        "score": list(getattr(match, "score", []) or []),
        "sets": [list(s) for s in (getattr(match, "sets", None) or [])],
        "team1": team1,
        "team2": team2,
    }
    payload_json = json.dumps(payload)

    now = datetime.now(timezone.utc).isoformat()
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


def get_profile_recent_elo_logs(
    profile_id: str,
    limit: int = 20,
    community_id: str | None = None,
    club_id: str | None = None,
) -> list[dict]:
    """Return recent per-match ELO logs for a profile across linked tournaments.

    Returns up to *limit* rows **per sport** so the frontend can switch
    between padel and tennis without a round-trip.

    When *community_id* is provided, only matches from tournaments in that
    community are returned. When *club_id* is provided, only matches from
    tournaments whose season belongs to that club are returned (manual
    adjustments logged with ``tournament_id == club_id`` are also kept).
    """
    # Build the scope filter. ``club_id`` takes precedence over ``community_id``
    # since clubs are nested inside communities.
    scope_filter = ""
    params: list[str | int] = [profile_id, profile_id, profile_id, profile_id]
    if club_id is not None:
        # Manual adjustments use the club_id as their tournament_id, so accept
        # both real club tournaments and manual log rows targeting this club.
        scope_filter = " AND (t.club_id = ? OR (l.is_manual = 1 AND l.tournament_id = ?))"
        params.append(club_id)
        params.append(club_id)
    elif community_id is not None:
        scope_filter = " AND t.community_id = ?"
        params.append(community_id)
    params.append(limit)

    with get_db() as conn:
        rows = conn.execute(
            f"""
            WITH linked_tournament_players AS (
                SELECT ps.tournament_id AS tournament_id, ps.player_id AS player_id
                  FROM player_secrets ps
                 WHERE ps.profile_id = ?
                UNION
                SELECT ph.entity_id AS tournament_id, ph.player_id AS player_id
                  FROM player_history ph
                 WHERE ph.profile_id = ?
                   AND ph.entity_type = 'tournament'
                UNION
                SELECT DISTINCT l.tournament_id, l.player_id
                  FROM player_elo_log l
                 WHERE l.is_manual = 1
                   AND l.player_id IN (
                       SELECT ps.player_id FROM player_secrets ps WHERE ps.profile_id = ?
                       UNION
                       SELECT ph.player_id FROM player_history ph WHERE ph.profile_id = ?
                   )
            ),
            ranked AS (
                SELECT l.tournament_id,
                       l.sport,
                       l.match_id,
                       l.player_id,
                       l.match_order,
                       l.elo_before,
                       l.elo_after,
                       l.elo_delta,
                       l.match_payload,
                       l.updated_at,
                       l.is_manual,
                       l.adjustment_reason,
                       l.adjusted_by,
                       t.name AS tournament_name,
                       t.alias AS tournament_alias,
                       ROW_NUMBER() OVER (
                           PARTITION BY l.sport
                           ORDER BY l.updated_at DESC, l.match_order DESC
                       ) AS rn
                  FROM player_elo_log l
                  JOIN linked_tournament_players lp
                    ON lp.tournament_id = l.tournament_id
                   AND lp.player_id = l.player_id
                  LEFT JOIN tournaments t
                    ON t.id = l.tournament_id
                 WHERE 1=1{scope_filter}
            )
            SELECT tournament_id, sport, match_id, player_id, match_order,
                   elo_before, elo_after, elo_delta, match_payload,
                   updated_at, tournament_name, tournament_alias,
                   is_manual, adjustment_reason, adjusted_by
              FROM ranked
             WHERE rn <= ?
          ORDER BY updated_at DESC, match_order DESC
            """,
            params,
        ).fetchall()
    return [dict(r) for r in rows]


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


def transfer_elo_to_profile(
    profile_id: str,
    tournament_id: str,
    player_id: str,
    sport: str = Sport.PADEL,
) -> None:
    """Copy a player's final tournament ELO to their community-scoped profile ELO.

    Also updates the ``player_history`` row with ``elo_before`` / ``elo_after``
    and keeps the flat ``player_profiles`` columns in sync for backward
    compatibility.
    """
    with get_db() as conn:
        community_id = _get_tournament_community_id(tournament_id, conn)
        elo_row = conn.execute(
            "SELECT elo_before, elo_after, matches_played FROM player_elo"
            " WHERE tournament_id = ? AND player_id = ? AND sport = ?",
            (tournament_id, player_id, sport),
        ).fetchone()
        if elo_row is None:
            return

        # Upsert into profile_community_elo (community-scoped)
        conn.execute(
            """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                 elo = excluded.elo, matches = excluded.matches""",
            (profile_id, community_id, sport, elo_row["elo_after"], elo_row["matches_played"]),
        )
        # Also mirror into the global (open) community so all tournaments feed the default ranking.
        if community_id != DEFAULT_COMMUNITY_ID:
            conn.execute(
                """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                     elo = excluded.elo, matches = excluded.matches""",
                (profile_id, DEFAULT_COMMUNITY_ID, sport, elo_row["elo_after"], elo_row["matches_played"]),
            )

        # Keep flat player_profiles columns in sync (backward compatibility)
        elo_col = "elo_padel" if sport == Sport.PADEL else "elo_tennis"
        matches_col = "elo_padel_matches" if sport == Sport.PADEL else "elo_tennis_matches"
        conn.execute(
            f"UPDATE player_profiles SET {elo_col} = ?, {matches_col} = ? WHERE id = ?",
            (elo_row["elo_after"], elo_row["matches_played"], profile_id),
        )

        # Update player_history with ELO snapshot
        conn.execute(
            "UPDATE player_history SET elo_before = ?, elo_after = ?"
            " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
            (elo_row["elo_before"], elo_row["elo_after"], profile_id, tournament_id),
        )


def bulk_transfer_elos_to_profiles(
    tournament_id: str,
    sport: str = Sport.PADEL,
) -> None:
    """Transfer ELO for all linked players in a finished tournament.

    Looks up which players have profiles via ``player_secrets`` or
    ``player_history`` and calls :func:`transfer_elo_to_profile` for each.
    """
    linked = _get_linked_profiles(tournament_id)

    for row in linked:
        transfer_elo_to_profile(row["profile_id"], tournament_id, row["player_id"], sport)


def sync_live_elos_to_profiles(
    tournament_id: str,
    sport: str = Sport.PADEL,
) -> None:
    """Sync current tournament ELO to linked player profiles (live, mid-tournament).

    Unlike :func:`bulk_transfer_elos_to_profiles`, this does NOT touch
    ``player_history`` rows — those are written only on tournament finish.
    Writes to ``profile_community_elo`` (community-scoped) and keeps the
    flat ``player_profiles`` columns in sync for backward compatibility.
    """
    elo_col = "elo_padel" if sport == Sport.PADEL else "elo_tennis"
    matches_col = "elo_padel_matches" if sport == Sport.PADEL else "elo_tennis_matches"

    with get_db() as conn:
        community_id = _get_tournament_community_id(tournament_id, conn)
        linked = _get_linked_profiles(tournament_id, conn)
        profile_by_pid = {r["player_id"]: r["profile_id"] for r in linked}
        if not profile_by_pid:
            return
        rows = conn.execute(
            "SELECT player_id, elo_after, matches_played FROM player_elo WHERE tournament_id = ? AND sport = ?",
            (tournament_id, sport),
        ).fetchall()
        for r in rows:
            profile_id = profile_by_pid.get(r["player_id"])
            if profile_id is None:
                continue

            # Check whether a later tournament (in the same community) already
            # produced a more recent ELO for this player/profile pair.  Uses
            # LEFT JOIN + COALESCE so tournaments without a `tournaments` row
            # (in-memory-only or test data) default to DEFAULT_COMMUNITY_ID.
            this_updated = conn.execute(
                "SELECT updated_at FROM player_elo WHERE tournament_id = ? AND player_id = ? AND sport = ?",
                (tournament_id, r["player_id"], sport),
            ).fetchone()
            later_in_community = (
                conn.execute(
                    "SELECT 1 FROM player_elo pe"
                    " LEFT JOIN tournaments t ON t.id = pe.tournament_id"
                    " WHERE pe.sport = ? AND pe.tournament_id != ?"
                    " AND pe.updated_at > ?"
                    " AND COALESCE(t.community_id, ?) = ? AND ("
                    "   EXISTS (SELECT 1 FROM player_secrets ps"
                    "     WHERE ps.tournament_id = pe.tournament_id AND ps.player_id = pe.player_id"
                    "       AND ps.profile_id = ?)"
                    "   OR EXISTS (SELECT 1 FROM player_history ph"
                    "     WHERE ph.entity_type = 'tournament' AND ph.entity_id = pe.tournament_id"
                    "       AND ph.player_id = pe.player_id AND ph.profile_id = ?)"
                    " ) LIMIT 1",
                    (
                        sport,
                        tournament_id,
                        this_updated["updated_at"],
                        DEFAULT_COMMUNITY_ID,
                        community_id,
                        profile_id,
                        profile_id,
                    ),
                ).fetchone()
                if this_updated
                else None
            )

            if later_in_community is None:
                # Most recent for this community — write community ELO, global mirror,
                # and flat profile columns.
                conn.execute(
                    """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                         elo = excluded.elo, matches = excluded.matches""",
                    (profile_id, community_id, sport, r["elo_after"], r["matches_played"]),
                )
                if community_id != DEFAULT_COMMUNITY_ID:
                    conn.execute(
                        """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                           VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                             elo = excluded.elo, matches = excluded.matches""",
                        (profile_id, DEFAULT_COMMUNITY_ID, sport, r["elo_after"], r["matches_played"]),
                    )
                conn.execute(
                    f"UPDATE player_profiles SET {elo_col} = ?, {matches_col} = ? WHERE id = ?",
                    (r["elo_after"], r["matches_played"], profile_id),
                )


def get_tournament_elo_snapshots(
    tournament_id: str,
    sport: str = Sport.PADEL,
) -> dict[str, tuple[float, int]]:
    """Return ``{player_id: (elo_before, matches_played_at_start)}`` for a tournament.

    The values represent the player's state *before* the first match in the
    tournament was played, which is exactly what a retroactive recalculation
    needs to restore as the starting point.

    ``matches_played_at_start`` is inferred as
    ``current matches_played − number_of_elo_log_entries`` for the player in
    this tournament, since each completed match adds exactly one log row.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT pe.player_id, pe.elo_before, pe.matches_played,"
            "       (SELECT COUNT(*) FROM player_elo_log el"
            "         WHERE el.tournament_id = pe.tournament_id"
            "           AND el.sport = pe.sport"
            "           AND el.player_id = pe.player_id) AS log_count"
            " FROM player_elo pe"
            " WHERE pe.tournament_id = ? AND pe.sport = ?",
            (tournament_id, sport),
        ).fetchall()
    return {r["player_id"]: (r["elo_before"], r["matches_played"] - r["log_count"]) for r in rows}


def safe_transfer_elos_to_profiles(
    tournament_id: str,
    sport: str = Sport.PADEL,
) -> None:
    """Transfer ELO to profiles only when this tournament is the player's latest.

    For each linked player, we check whether any *other* tournament (in the
    same community) produced a more recent ``player_elo`` row (by
    ``updated_at``).  If so, we skip the profile update for that player so
    that later tournament results are not overwritten.  The
    ``player_history`` row for *this* tournament is always updated regardless.
    """
    elo_col = "elo_padel" if sport == Sport.PADEL else "elo_tennis"
    matches_col = "elo_padel_matches" if sport == Sport.PADEL else "elo_tennis_matches"

    with get_db() as conn:
        community_id = _get_tournament_community_id(tournament_id, conn)
        linked = _get_linked_profiles(tournament_id, conn)

        for row in linked:
            pid, profile_id = row["player_id"], row["profile_id"]
            elo_row = conn.execute(
                "SELECT elo_before, elo_after, matches_played FROM player_elo"
                " WHERE tournament_id = ? AND player_id = ? AND sport = ?",
                (tournament_id, pid, sport),
            ).fetchone()
            if elo_row is None:
                continue

            # Always update the history snapshot for this tournament
            conn.execute(
                "UPDATE player_history SET elo_before = ?, elo_after = ?"
                " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                (elo_row["elo_before"], elo_row["elo_after"], profile_id, tournament_id),
            )

            # Only update the profile if no later tournament (in same community) exists.
            this_updated = conn.execute(
                "SELECT updated_at FROM player_elo WHERE tournament_id = ? AND player_id = ? AND sport = ?",
                (tournament_id, pid, sport),
            ).fetchone()
            later = conn.execute(
                "SELECT 1 FROM player_elo pe"
                " JOIN tournaments t ON t.id = pe.tournament_id"
                " WHERE pe.sport = ? AND pe.tournament_id != ?"
                " AND pe.updated_at > ? AND t.community_id = ? AND ("
                "   EXISTS (SELECT 1 FROM player_secrets ps"
                "     WHERE ps.tournament_id = pe.tournament_id AND ps.player_id = pe.player_id"
                "       AND ps.profile_id = ?)"
                "   OR EXISTS (SELECT 1 FROM player_history ph"
                "     WHERE ph.entity_type = 'tournament' AND ph.entity_id = pe.tournament_id"
                "       AND ph.player_id = pe.player_id AND ph.profile_id = ?)"
                " ) LIMIT 1",
                (sport, tournament_id, this_updated["updated_at"], community_id, profile_id, profile_id),
            ).fetchone()
            if later is None:
                # Upsert community-scoped ELO
                conn.execute(
                    """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                         elo = excluded.elo, matches = excluded.matches""",
                    (profile_id, community_id, sport, elo_row["elo_after"], elo_row["matches_played"]),
                )
                # Also mirror into global (open) community.
                if community_id != DEFAULT_COMMUNITY_ID:
                    conn.execute(
                        """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                           VALUES (?, ?, ?, ?, ?)
                           ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                             elo = excluded.elo, matches = excluded.matches""",
                        (profile_id, DEFAULT_COMMUNITY_ID, sport, elo_row["elo_after"], elo_row["matches_played"]),
                    )
                # Keep flat profile columns in sync
                conn.execute(
                    f"UPDATE player_profiles SET {elo_col} = ?, {matches_col} = ? WHERE id = ?",
                    (elo_row["elo_after"], elo_row["matches_played"], profile_id),
                )


def retroactive_transfer_elo(profile_id: str, player_id: str) -> None:
    """Transfer ELO from all tournaments a player participated in.

    Used when a player claims a profile after tournaments have already
    finished.  Applies ELO updates chronologically, grouped by community.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT pe.tournament_id, pe.sport, pe.elo_before, pe.elo_after, pe.matches_played,"
            "       COALESCE(t.community_id, 'open') AS community_id"
            " FROM player_elo pe"
            " LEFT JOIN tournaments t ON t.id = pe.tournament_id"
            " WHERE pe.player_id = ? ORDER BY pe.updated_at ASC",
            (player_id,),
        ).fetchall()

    if not rows:
        return

    # Track per-community cumulative state across tournaments (chronological order).
    community_elos: dict[str, dict[str, float]] = {}  # {community_id: {sport: latest elo}}
    community_counts: dict[str, dict[str, int]] = {}  # {community_id: {sport: latest cumulative matches}}
    global_elos: dict[str, float] = {}  # {sport: latest elo} — cross-community running latest
    global_counts: dict[str, int] = {}  # {sport: latest cumulative matches (already global)}

    for row in rows:
        cid = row["community_id"]
        sport = row["sport"]
        community_elos.setdefault(cid, {})[sport] = row["elo_after"]
        # matches_played is already cumulative (seeded from prior profile count at tournament start)
        community_counts.setdefault(cid, {})[sport] = row["matches_played"]
        # Keep global (open) state up-to-date via chronological ordering
        global_elos[sport] = row["elo_after"]
        global_counts[sport] = row["matches_played"]

        # Update player_history with ELO snapshot
        with get_db() as conn:
            conn.execute(
                "UPDATE player_history SET elo_before = ?, elo_after = ?"
                " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                (row["elo_before"], row["elo_after"], profile_id, row["tournament_id"]),
            )

    # Write community-scoped ELOs and global (open) ELO.
    with get_db() as conn:
        for cid, sport_elos in community_elos.items():
            for sport, elo in sport_elos.items():
                matches = community_counts.get(cid, {}).get(sport, 0)
                conn.execute(
                    """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                         elo = excluded.elo, matches = excluded.matches""",
                    (profile_id, cid, sport, elo, matches),
                )
        # Write global (open) ELO — represents ALL tournaments across all communities.
        for sport, elo in global_elos.items():
            matches = global_counts.get(sport, 0)
            conn.execute(
                """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                     elo = excluded.elo, matches = excluded.matches""",
                (profile_id, DEFAULT_COMMUNITY_ID, sport, elo, matches),
            )

        # Keep flat player_profiles columns in sync using the globally latest values.
        padel_elo = DEFAULT_RATING
        tennis_elo = DEFAULT_RATING
        padel_matches = global_counts.get(Sport.PADEL, 0)
        tennis_matches = global_counts.get(Sport.TENNIS, 0)
        if Sport.PADEL in global_elos:
            padel_elo = global_elos[Sport.PADEL]
        if Sport.TENNIS in global_elos:
            tennis_elo = global_elos[Sport.TENNIS]
        conn.execute(
            "UPDATE player_profiles"
            " SET elo_padel = ?, elo_tennis = ?, elo_padel_matches = ?, elo_tennis_matches = ?"
            " WHERE id = ?",
            (padel_elo, tennis_elo, padel_matches, tennis_matches, profile_id),
        )


def retroactive_transfer_all_elos(profile_id: str) -> None:
    """Transfer ELO for every player_id linked to a profile.

    Gathers all ``player_id`` values from ``player_secrets`` and
    ``player_history`` for the given profile, then calls
    :func:`retroactive_transfer_elo` for each one.  Safe to call multiple
    times — idempotent.
    """
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT DISTINCT player_id FROM (
                SELECT player_id FROM player_secrets
                 WHERE profile_id = ? AND player_id IS NOT NULL
                UNION
                SELECT player_id FROM player_history
                 WHERE profile_id = ? AND entity_type = 'tournament'
                   AND player_id IS NOT NULL
            )
            """,
            (profile_id, profile_id),
        ).fetchall()
    for row in rows:
        retroactive_transfer_elo(profile_id, row["player_id"])


def consolidate_ghost_elos(primary_profile_id: str, player_ids: list[str]) -> None:
    """Recalculate ELO for a merged ghost profile from multiple player_ids.

    Processes ``player_elo`` rows for ALL provided player_ids in global
    chronological order so the most-recent tournament's ELO is correctly
    reflected in the merged profile.  Used after merging several ghost
    profiles into a single canonical one.

    Updates:
    - ``player_history`` ELO snapshots for the primary profile
    - ``profile_community_elo`` per community the player participated in
    - Flat ``elo_padel`` / ``elo_tennis`` columns on ``player_profiles``

    Args:
        primary_profile_id: The id of the surviving ghost profile.
        player_ids: All player_ids (from every merged ghost) whose
            ``player_elo`` rows now belong to the primary profile.
    """
    if not player_ids:
        return

    placeholders = ",".join("?" for _ in player_ids)
    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT pe.tournament_id, pe.sport, pe.elo_before, pe.elo_after, pe.matches_played,
                   COALESCE(t.community_id, '{DEFAULT_COMMUNITY_ID}') AS community_id
              FROM player_elo pe
              LEFT JOIN tournaments t ON t.id = pe.tournament_id
             WHERE pe.player_id IN ({placeholders})
             ORDER BY pe.updated_at ASC
            """,
            player_ids,
        ).fetchall()

    if not rows:
        return

    community_elos: dict[str, dict[str, float]] = {}
    community_counts: dict[str, dict[str, int]] = {}
    global_elos: dict[str, float] = {}
    global_counts: dict[str, int] = {}
    history_updates: list[tuple] = []

    for row in rows:
        cid = row["community_id"]
        sport = row["sport"]
        community_elos.setdefault(cid, {})[sport] = row["elo_after"]
        community_counts.setdefault(cid, {})[sport] = row["matches_played"]
        global_elos[sport] = row["elo_after"]
        global_counts[sport] = row["matches_played"]
        history_updates.append((row["elo_before"], row["elo_after"], primary_profile_id, row["tournament_id"]))

    with get_db() as conn:
        for elo_before, elo_after, profile_id, tournament_id in history_updates:
            conn.execute(
                "UPDATE player_history SET elo_before = ?, elo_after = ?"
                " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                (elo_before, elo_after, profile_id, tournament_id),
            )

        for cid, sport_elos in community_elos.items():
            for sport, elo in sport_elos.items():
                matches = community_counts.get(cid, {}).get(sport, 0)
                conn.execute(
                    """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                         elo = excluded.elo, matches = excluded.matches""",
                    (primary_profile_id, cid, sport, elo, matches),
                )

        for sport, elo in global_elos.items():
            matches = global_counts.get(sport, 0)
            conn.execute(
                """INSERT INTO profile_community_elo (profile_id, community_id, sport, elo, matches)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT (profile_id, community_id, sport) DO UPDATE SET
                     elo = excluded.elo, matches = excluded.matches""",
                (primary_profile_id, DEFAULT_COMMUNITY_ID, sport, elo, matches),
            )

        padel_elo = global_elos.get(Sport.PADEL, DEFAULT_RATING)
        tennis_elo = global_elos.get(Sport.TENNIS, DEFAULT_RATING)
        padel_matches = global_counts.get(Sport.PADEL, 0)
        tennis_matches = global_counts.get(Sport.TENNIS, 0)
        conn.execute(
            "UPDATE player_profiles"
            " SET elo_padel = ?, elo_tennis = ?, elo_padel_matches = ?, elo_tennis_matches = ?"
            " WHERE id = ?",
            (padel_elo, tennis_elo, padel_matches, tennis_matches, primary_profile_id),
        )
