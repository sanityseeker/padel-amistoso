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


# ---------------------------------------------------------------------------
# Tournament-scoped ELO operations
# ---------------------------------------------------------------------------


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
        rows = conn.execute(
            "SELECT ps.player_id, pp.k_factor_override"
            " FROM player_secrets ps"
            " JOIN player_profiles pp ON pp.id = ps.profile_id"
            " WHERE ps.tournament_id = ? AND pp.k_factor_override IS NOT NULL",
            (tournament_id,),
        ).fetchall()
    return {r["player_id"]: r["k_factor_override"] for r in rows}


def initialize_tournament_elos(
    tournament_id: str,
    player_ids: list[str],
    sport: str = Sport.PADEL,
    *,
    elo_overrides: dict[str, float] | None = None,
    match_count_overrides: dict[str, int] | None = None,
) -> None:
    """Seed ELO rows for every player at tournament start.

    For players linked to a profile, their current profile ELO is used.
    Unlinked players start at ``DEFAULT_RATING``.

    When ``elo_overrides`` / ``match_count_overrides`` are supplied (e.g.
    during a retroactive recalculation), those values take precedence over
    the player-profile lookup so the original pre-tournament state is
    restored exactly.
    """
    now = datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        # Look up profile ELO for linked players (skipped when overrides cover everyone)
        profile_elos: dict[str, float] = {}
        profile_counts: dict[str, int] = {}
        if elo_overrides is None:
            linked = conn.execute(
                "SELECT player_id, profile_id FROM player_secrets WHERE tournament_id = ? AND profile_id IS NOT NULL",
                (tournament_id,),
            ).fetchall()
            if linked:
                elo_col = "elo_padel" if sport == Sport.PADEL else "elo_tennis"
                matches_col = "elo_padel_matches" if sport == Sport.PADEL else "elo_tennis_matches"
                profile_ids = [r["profile_id"] for r in linked]
                pid_to_player = {r["profile_id"]: r["player_id"] for r in linked}
                placeholders = ",".join("?" for _ in profile_ids)
                profiles = conn.execute(
                    f"SELECT id, {elo_col}, {matches_col} FROM player_profiles WHERE id IN ({placeholders})",
                    profile_ids,
                ).fetchall()
                for p in profiles:
                    player_id = pid_to_player[p["id"]]
                    profile_elos[player_id] = p[elo_col]
                    profile_counts[player_id] = p[matches_col]

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


def get_profile_recent_elo_logs(profile_id: str, limit: int = 20) -> list[dict]:
    """Return recent per-match ELO logs for a profile across linked tournaments."""
    with get_db() as conn:
        rows = conn.execute(
            """
            WITH linked_tournament_players AS (
                SELECT ps.tournament_id AS tournament_id, ps.player_id AS player_id
                  FROM player_secrets ps
                 WHERE ps.profile_id = ?
                UNION
                SELECT ph.entity_id AS tournament_id, ph.player_id AS player_id
                  FROM player_history ph
                 WHERE ph.profile_id = ?
                   AND ph.entity_type = 'tournament'
            )
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
                   t.name AS tournament_name,
                   t.alias AS tournament_alias
              FROM player_elo_log l
              JOIN linked_tournament_players lp
                ON lp.tournament_id = l.tournament_id
               AND lp.player_id = l.player_id
              LEFT JOIN tournaments t
                ON t.id = l.tournament_id
          ORDER BY l.updated_at DESC, l.match_order DESC
             LIMIT ?
            """,
            (profile_id, profile_id, limit),
        ).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------------------
# Profile-level ELO operations
# ---------------------------------------------------------------------------


def get_profile_elo(profile_id: str) -> dict[str, float | int]:
    """Return the current ELO ratings for a player profile.

    Returns:
        Dict with keys ``elo_padel``, ``elo_tennis``,
        ``elo_padel_matches``, ``elo_tennis_matches``.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT elo_padel, elo_tennis, elo_padel_matches, elo_tennis_matches FROM player_profiles WHERE id = ?",
            (profile_id,),
        ).fetchone()
    if row is None:
        return {
            "elo_padel": DEFAULT_RATING,
            "elo_tennis": DEFAULT_RATING,
            "elo_padel_matches": 0,
            "elo_tennis_matches": 0,
        }
    return dict(row)


def transfer_elo_to_profile(
    profile_id: str,
    tournament_id: str,
    player_id: str,
    sport: str = Sport.PADEL,
) -> None:
    """Copy a player's final tournament ELO to their profile.

    Also updates the ``player_history`` row with ``elo_before`` / ``elo_after``.
    """
    with get_db() as conn:
        elo_row = conn.execute(
            "SELECT elo_before, elo_after, matches_played FROM player_elo"
            " WHERE tournament_id = ? AND player_id = ? AND sport = ?",
            (tournament_id, player_id, sport),
        ).fetchone()
        if elo_row is None:
            return

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

    Looks up which players have profiles via ``player_secrets`` and
    calls :func:`transfer_elo_to_profile` for each.
    """
    with get_db() as conn:
        linked = conn.execute(
            "SELECT player_id, profile_id FROM player_secrets WHERE tournament_id = ? AND profile_id IS NOT NULL",
            (tournament_id,),
        ).fetchall()

    for row in linked:
        transfer_elo_to_profile(row["profile_id"], tournament_id, row["player_id"], sport)


def sync_live_elos_to_profiles(
    tournament_id: str,
    sport: str = Sport.PADEL,
) -> None:
    """Sync current tournament ELO to linked player profiles (live, mid-tournament).

    Unlike :func:`bulk_transfer_elos_to_profiles`, this does NOT touch
    ``player_history`` rows — those are written only on tournament finish.
    """
    elo_col = "elo_padel" if sport == Sport.PADEL else "elo_tennis"
    matches_col = "elo_padel_matches" if sport == Sport.PADEL else "elo_tennis_matches"

    with get_db() as conn:
        rows = conn.execute(
            """SELECT pe.player_id, pe.elo_after, pe.matches_played, ps.profile_id
                 FROM player_elo pe
                 JOIN player_secrets ps
                   ON ps.tournament_id = pe.tournament_id
                  AND ps.player_id = pe.player_id
                WHERE pe.tournament_id = ?
                  AND pe.sport = ?
                  AND ps.profile_id IS NOT NULL""",
            (tournament_id, sport),
        ).fetchall()
        for r in rows:
            conn.execute(
                f"UPDATE player_profiles SET {elo_col} = ?, {matches_col} = ? WHERE id = ?",
                (r["elo_after"], r["matches_played"], r["profile_id"]),
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

    For each linked player, we check whether any *other* tournament produced
    a more recent ``player_elo`` row (by ``updated_at``).  If so, we skip the
    profile update for that player so that later tournament results are not
    overwritten.  The ``player_history`` row for *this* tournament is always
    updated regardless.
    """
    elo_col = "elo_padel" if sport == Sport.PADEL else "elo_tennis"
    matches_col = "elo_padel_matches" if sport == Sport.PADEL else "elo_tennis_matches"

    with get_db() as conn:
        linked = conn.execute(
            "SELECT player_id, profile_id FROM player_secrets WHERE tournament_id = ? AND profile_id IS NOT NULL",
            (tournament_id,),
        ).fetchall()

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

            # Only update the profile if no later tournament exists for this player
            later = conn.execute(
                "SELECT 1 FROM player_elo pe"
                " JOIN player_secrets ps"
                "   ON ps.tournament_id = pe.tournament_id AND ps.player_id = pe.player_id"
                " WHERE ps.profile_id = ? AND pe.sport = ?"
                "   AND pe.tournament_id != ? AND pe.updated_at > ("
                "     SELECT updated_at FROM player_elo"
                "      WHERE tournament_id = ? AND player_id = ? AND sport = ?"
                "   )"
                " LIMIT 1",
                (profile_id, sport, tournament_id, tournament_id, pid, sport),
            ).fetchone()
            if later is None:
                conn.execute(
                    f"UPDATE player_profiles SET {elo_col} = ?, {matches_col} = ? WHERE id = ?",
                    (elo_row["elo_after"], elo_row["matches_played"], profile_id),
                )


def retroactive_transfer_elo(profile_id: str, player_id: str) -> None:
    """Transfer ELO from all tournaments a player participated in.

    Used when a player claims a profile after tournaments have already
    finished.  Applies ELO updates chronologically.
    """
    with get_db() as conn:
        rows = conn.execute(
            "SELECT tournament_id, sport, elo_before, elo_after, matches_played"
            " FROM player_elo WHERE player_id = ? ORDER BY updated_at ASC",
            (player_id,),
        ).fetchall()

    if not rows:
        return

    # Apply chronologically — last tournament's elo_after becomes the profile ELO
    padel_elo = DEFAULT_RATING
    tennis_elo = DEFAULT_RATING
    padel_matches = 0
    tennis_matches = 0

    for row in rows:
        sport = row["sport"]
        if sport == Sport.PADEL:
            padel_elo = row["elo_after"]
            padel_matches = row["matches_played"]
        else:
            tennis_elo = row["elo_after"]
            tennis_matches = row["matches_played"]

        # Update player_history with ELO snapshot
        with get_db() as conn:
            conn.execute(
                "UPDATE player_history SET elo_before = ?, elo_after = ?"
                " WHERE profile_id = ? AND entity_type = 'tournament' AND entity_id = ?",
                (row["elo_before"], row["elo_after"], profile_id, row["tournament_id"]),
            )

    with get_db() as conn:
        conn.execute(
            "UPDATE player_profiles"
            " SET elo_padel = ?, elo_tennis = ?, elo_padel_matches = ?, elo_tennis_matches = ?"
            " WHERE id = ?",
            (padel_elo, tennis_elo, padel_matches, tennis_matches, profile_id),
        )
