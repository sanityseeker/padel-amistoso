"""
Persistence layer for player secrets.

Provides CRUD operations against the ``player_secrets`` table, fully
decoupled from the tournament pickle/BLOB storage.  Secrets are written
once at tournament creation and queried at player-auth time.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from collections import defaultdict
from types import SimpleNamespace

from ..tournaments.player_secrets import PlayerSecret, generate_secrets_for_players
from .db import get_db

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# In-memory caches — populated on first read, invalidated on every write.
# Eliminates a SQLite round-trip on every player-auth and opponent lookup.
# ────────────────────────────────────────────────────────────────────────────

_secrets_cache: dict[str, dict[str, dict]] = {}
_contacts_cache: dict[str, dict[str, str]] = {}


def invalidate_secrets_cache(tournament_id: str) -> None:
    """Drop cached secrets and contacts for *tournament_id*."""
    _secrets_cache.pop(tournament_id, None)
    _contacts_cache.pop(tournament_id, None)


def _clear_all_secrets_caches() -> None:
    """Drop all cached data (e.g. after a bulk purge)."""
    _secrets_cache.clear()
    _contacts_cache.clear()


# ────────────────────────────────────────────────────────────────────────────
# Write helpers
# ────────────────────────────────────────────────────────────────────────────


def create_secrets_for_tournament(
    tournament_id: str,
    players: list[dict[str, str]],
    contacts: dict[str, str] | None = None,
    emails: dict[str, str] | None = None,
) -> dict[str, PlayerSecret]:
    """Generate and persist secrets for every player in a tournament.

    Args:
        tournament_id: The tournament ID (e.g. ``"t5"``).
        players: List of dicts with ``"id"`` and ``"name"`` keys.
        contacts: Optional mapping of player_id → contact string. Missing
            entries default to an empty string.
        emails: Optional mapping of player_id → email address. Missing
            entries default to an empty string.

    Returns:
        Mapping of player_id → ``PlayerSecret``.
    """
    player_ids = [p["id"] for p in players]
    secrets = generate_secrets_for_players(player_ids)
    name_map = {p["id"]: p["name"] for p in players}
    contact_map = contacts or {}
    email_map = emails or {}

    with get_db() as conn:
        conn.executemany(
            """
            INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, contact, email)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(tournament_id, player_id) DO UPDATE SET
                passphrase  = excluded.passphrase,
                token       = excluded.token,
                player_name = excluded.player_name,
                contact     = excluded.contact,
                email       = excluded.email
            """,
            [
                (
                    tournament_id,
                    pid,
                    name_map.get(pid, ""),
                    sec.passphrase,
                    sec.token,
                    contact_map.get(pid, ""),
                    email_map.get(pid, ""),
                )
                for pid, sec in secrets.items()
            ],
        )

    invalidate_secrets_cache(tournament_id)
    return secrets


def extract_history_stats(t_data: dict) -> dict[str, dict]:
    """Build a per-player stats snapshot from a live tournament data dict.

    Supports Mexicano, Group-Playoff and pure Playoff tournaments.
    Returns an empty dict on any error so callers can proceed safely.

    Args:
        t_data: The value stored in ``_tournaments[tid]``, containing at
            minimum ``"type"`` and ``"tournament"`` keys.

    Returns:
        Mapping of ``player_id`` → dict with keys
        ``rank``, ``total_players``, ``wins``, ``losses``, ``draws``,
        ``points_for``, ``points_against``.
    """
    t = t_data.get("tournament")
    t_type = t_data.get("type", "")
    stats: dict[str, dict] = {}
    if t is None:
        return stats
    try:
        if t_type in ("mexicano", "mex-playoff"):
            board = t.leaderboard()
            active = [e for e in board if not e.get("removed")]
            total = len(active)
            for entry in active:
                stats[entry["player_id"]] = {
                    "rank": entry.get("rank"),
                    "total_players": total,
                    "wins": entry.get("wins", 0),
                    "losses": entry.get("losses", 0),
                    "draws": entry.get("draws", 0),
                    "points_for": int(entry.get("total_points", 0)),
                    "points_against": 0,
                }
        elif t_type == "group_playoff":
            all_standings = t.group_standings()
            rows = [row for grp_rows in all_standings.values() for row in grp_rows]
            rows.sort(
                key=lambda r: (
                    -r["wins"],
                    -r.get("sets_diff", 0),
                    -r.get("point_diff", 0),
                    -r.get("points_for", 0),
                )
            )
            total = len(rows)
            for i, row in enumerate(rows):
                stats[row["player_id"]] = {
                    "rank": i + 1,
                    "total_players": total,
                    "wins": row.get("wins", 0),
                    "losses": row.get("losses", 0),
                    "draws": row.get("draws", 0),
                    "points_for": row.get("points_for", 0),
                    "points_against": row.get("points_against", 0),
                }
        elif t_type == "playoff":
            champion = t.champion()
            champion_ids = {p.id for p in (champion or [])}
            all_players = [p for team in getattr(t, "original_teams", []) for p in team]
            total = len(all_players)
            for p in all_players:
                stats[p.id] = {
                    "rank": 1 if p.id in champion_ids else None,
                    "total_players": total,
                    "wins": 0,
                    "losses": 0,
                    "draws": 0,
                    "points_for": 0,
                    "points_against": 0,
                }

            matches = _collect_all_completed_matches(t)
            for m in matches:
                s1, s2 = m.score
                team1_ids = [p.id for p in m.team1 if p.id in stats]
                team2_ids = [p.id for p in m.team2 if p.id in stats]

                for pid in team1_ids:
                    stats[pid]["points_for"] += s1
                    stats[pid]["points_against"] += s2
                for pid in team2_ids:
                    stats[pid]["points_for"] += s2
                    stats[pid]["points_against"] += s1

                if s1 > s2:
                    for pid in team1_ids:
                        stats[pid]["wins"] += 1
                    for pid in team2_ids:
                        stats[pid]["losses"] += 1
                elif s2 > s1:
                    for pid in team2_ids:
                        stats[pid]["wins"] += 1
                    for pid in team1_ids:
                        stats[pid]["losses"] += 1
                else:
                    for pid in team1_ids + team2_ids:
                        stats[pid]["draws"] += 1
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not extract history stats: %s", exc)

    # Expand composite team stats to individual members so that Player Hub
    # histories are keyed by real (per-person) PIDs, not synthetic team PIDs.
    team_roster: dict[str, list[str]] = getattr(t, "team_roster", None) or {}
    for team_pid, member_ids in team_roster.items():
        team_entry = stats.get(team_pid)
        if team_entry:
            for mid in member_ids:
                if mid not in stats:
                    stats[mid] = dict(team_entry)

    return stats


def _collect_all_completed_matches(t: object) -> list:
    """Gather all scored Match objects from any tournament type.

    Handles Mexicano (``t.all_matches()``), Group-Playoff
    (``t.groups[i].matches`` + ``t.playoff_bracket``), and pure Playoff
    (``t.all_matches()``).  Deduplicates by match id.

    Args:
        t: Tournament domain object.

    Returns:
        Deduplicated list of Match objects that have a recorded score.
    """
    raw: list = []
    for g in getattr(t, "groups", []):
        raw.extend(getattr(g, "matches", []))
    if hasattr(t, "all_matches"):
        raw.extend(t.all_matches())
    pb = getattr(t, "playoff_bracket", None)
    if pb is not None:
        if hasattr(pb, "all_matches"):
            raw.extend(pb.all_matches())
        elif hasattr(pb, "matches"):
            raw.extend(pb.matches)
    seen: set[str] = set()
    result: list = []
    for m in raw:
        if m.id not in seen and m.score is not None:
            seen.add(m.id)
            result.append(m)
    return result


def _expand_team_matches(
    matches: list,
    team_roster: dict[str, list[str]],
    team_member_names: dict[str, list[str]],
) -> list:
    """Expand composite team Players to individual members in matches.

    In team mode, each match side contains a single synthetic Player whose
    id is in ``team_roster``.  This helper replaces those synthetic entries
    with one lightweight player-like object per real member so that
    partner/rival stats are computed for individuals.

    When *team_roster* is empty the original list is returned unchanged.

    Args:
        matches: Scored match objects with ``.team1``, ``.team2``,
            ``.score``, and ``.id`` attributes.
        team_roster: Mapping of composite team PID → individual member PIDs.
        team_member_names: Mapping of composite team PID → individual member names.

    Returns:
        List of match-like ``SimpleNamespace`` objects (or the originals if
        no expansion is needed).
    """
    if not team_roster:
        return matches
    expanded: list = []
    for m in matches:
        new_team1: list = []
        for p in m.team1:
            if p.id in team_roster:
                member_ids = team_roster[p.id]
                member_names = team_member_names.get(p.id, [p.name] * len(member_ids))
                for mid, mname in zip(member_ids, member_names):
                    new_team1.append(SimpleNamespace(id=mid, name=mname))
            else:
                new_team1.append(p)
        new_team2: list = []
        for p in m.team2:
            if p.id in team_roster:
                member_ids = team_roster[p.id]
                member_names = team_member_names.get(p.id, [p.name] * len(member_ids))
                for mid, mname in zip(member_ids, member_names):
                    new_team2.append(SimpleNamespace(id=mid, name=mname))
            else:
                new_team2.append(p)
        expanded.append(SimpleNamespace(team1=new_team1, team2=new_team2, score=m.score, id=m.id))
    return expanded


def extract_partner_rival_stats(t_data: dict) -> dict[str, dict]:
    """Build per-player teammate and rival stats from completed matches.

    Returns the top-3 best teammates (highest win % when paired together)
    and top-3 toughest rivals (lowest own win % when facing them) for each
    player in the tournament.

    Args:
        t_data: Tournament state dict with a ``"tournament"`` key.

    Returns:
        Mapping of player_id → ``{"top_partners": [...], "top_rivals": [...]}``.
        Each list entry is
        ``{"id": str, "name": str, "games": int, "wins": int, "win_pct": int}``.
        Returns an empty dict on any error.
    """
    t = t_data.get("tournament")
    if t is None:
        return {}
    try:
        matches = _collect_all_completed_matches(t)
        # Expand composite team players to individual members so that
        # partner/rival stats reflect real per-person relationships.
        team_roster: dict[str, list[str]] = getattr(t, "team_roster", None) or {}
        team_member_names: dict[str, list[str]] = getattr(t, "team_member_names", None) or {}
        matches = _expand_team_matches(matches, team_roster, team_member_names)
        _zero = lambda: {"name": "", "games": 0, "wins": 0}  # noqa: E731
        partners: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(_zero))
        rivals: dict[str, dict[str, dict]] = defaultdict(lambda: defaultdict(_zero))

        for m in matches:
            s1, s2 = m.score
            for my_team, opp_team, i_win in (
                (m.team1, m.team2, s1 > s2),
                (m.team2, m.team1, s2 > s1),
            ):
                for p in my_team:
                    for partner in my_team:
                        if partner.id == p.id:
                            continue
                        e = partners[p.id][partner.id]
                        e["name"] = partner.name
                        e["games"] += 1
                        if i_win:
                            e["wins"] += 1
                    for rival in opp_team:
                        e = rivals[p.id][rival.id]
                        e["name"] = rival.name
                        e["games"] += 1
                        if i_win:
                            e["wins"] += 1

        def _entries(stat_map: dict) -> list[dict]:
            return [
                {
                    "id": oid,
                    "name": v["name"],
                    "games": v["games"],
                    "wins": v["wins"],
                    "win_pct": round(v["wins"] / v["games"] * 100) if v["games"] > 0 else 0,
                }
                for oid, v in stat_map.items()
                if v["games"] > 0
            ]

        result: dict[str, dict] = {}
        for pid in set(partners) | set(rivals):
            all_partners = sorted(_entries(dict(partners[pid])), key=lambda e: (-e["games"], -e["wins"], e["name"]))
            all_rivals = sorted(_entries(dict(rivals[pid])), key=lambda e: (-e["games"], -e["wins"], e["name"]))
            top_partners = sorted(
                all_partners,
                key=lambda e: (-e["win_pct"], -e["wins"], -e["games"]),
            )[:3]
            top_rivals = sorted(all_rivals, key=lambda e: (e["win_pct"], -e["games"]))[:3]
            result[pid] = {
                "top_partners": top_partners,
                "top_rivals": top_rivals,
                "all_partners": all_partners,
                "all_rivals": all_rivals,
            }
        return result
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not extract partner/rival stats: %s", exc)
        return {}


def upsert_live_stats(
    tournament_id: str,
    t_data: dict,
) -> None:
    """Write or update in-progress stats for linked Player Hub profiles.

    Called when a round completes (all current-round matches scored) so
    that players see their W/L/D progress in the Hub while the tournament
    is still running.  Only players who have linked a Hub profile get rows.

    In-progress rows use ``finished_at = ''`` (empty string) to distinguish
    them from real finished rows.  The existing primary key
    ``(profile_id, entity_type, entity_id)`` ensures each player has at most
    one row per tournament, and ``INSERT OR REPLACE`` overwrites the previous
    snapshot on every round completion.

    Args:
        tournament_id: The tournament whose stats should be snapshot.
        t_data: The value stored in ``_tournaments[tid]``.
    """
    entity_name = t_data.get("name", "")
    sport = t_data.get("sport", "padel")
    ps = extract_history_stats(t_data)
    if not ps:
        return
    try:
        with get_db() as conn:
            linked = conn.execute(
                "SELECT profile_id, player_id, player_name"
                " FROM player_secrets"
                " WHERE tournament_id = ? AND profile_id IS NOT NULL AND finished_at IS NULL",
                (tournament_id,),
            ).fetchall()
            if not linked:
                return
            conn.executemany(
                """INSERT OR REPLACE INTO player_history
                   (profile_id, entity_type, entity_id, entity_name,
                    player_id, player_name, finished_at,
                    rank, total_players, wins, losses, draws, points_for, points_against,
                    sport, top_partners, top_rivals, all_partners, all_rivals)
                   VALUES (?, 'tournament', ?, ?, ?, ?, '',
                           ?, ?, ?, ?, ?, ?, ?,
                           ?, '[]', '[]', '[]', '[]')""",
                [
                    (
                        row["profile_id"],
                        tournament_id,
                        entity_name,
                        row["player_id"],
                        row["player_name"],
                        ps.get(row["player_id"], {}).get("rank"),
                        ps.get(row["player_id"], {}).get("total_players"),
                        ps.get(row["player_id"], {}).get("wins", 0),
                        ps.get(row["player_id"], {}).get("losses", 0),
                        ps.get(row["player_id"], {}).get("draws", 0),
                        ps.get(row["player_id"], {}).get("points_for", 0),
                        ps.get(row["player_id"], {}).get("points_against", 0),
                        sport,
                    )
                    for row in linked
                ],
            )
    except sqlite3.Error as exc:
        logger.warning("Could not upsert live stats for %s: %s", tournament_id, exc)


def delete_secrets_for_tournament(
    tournament_id: str,
    *,
    entity_name: str = "",
    player_stats: dict[str, dict] | None = None,
    sport: str = "padel",
    partner_rival_stats: dict[str, dict] | None = None,
) -> None:
    """Mark tournament player secrets as finished and persist linked history.

    Any secrets linked to a Player Hub profile are written to
    ``player_history`` so the player's dashboard retains a finished record.
    The ``player_secrets`` rows are preserved (with ``finished_at`` and
    snapshots) so the admin Players panel can still show participants after
    a tournament ends.

    Args:
        tournament_id: The tournament whose secrets should be purged.
        entity_name: Human-readable tournament name stored in the history row
            so it survives after the tournament itself is deleted.
        player_stats: Optional per-player stats snapshot produced by
            ``extract_history_stats``.  When provided, rank/W/L/D/points are
            persisted alongside the history row.
        sport: Sport string (``"padel"`` or ``"tennis"``) stored in the row.
        partner_rival_stats: Optional per-player partner/rival snapshot
            produced by ``extract_partner_rival_stats``.
    """
    from datetime import datetime, timezone

    finished_at = datetime.now(timezone.utc).isoformat()
    ps = player_stats or {}
    pr = partner_rival_stats or {}
    try:
        with get_db() as conn:
            linked = conn.execute(
                "SELECT profile_id, player_id, player_name"
                " FROM player_secrets WHERE tournament_id = ? AND profile_id IS NOT NULL",
                (tournament_id,),
            ).fetchall()
            if linked:
                conn.executemany(
                    """INSERT OR REPLACE INTO player_history
                       (profile_id, entity_type, entity_id, entity_name,
                        player_id, player_name, finished_at,
                        rank, total_players, wins, losses, draws, points_for, points_against,
                        sport, top_partners, top_rivals, all_partners, all_rivals)
                       VALUES (?, 'tournament', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    [
                        (
                            row["profile_id"],
                            tournament_id,
                            entity_name,
                            row["player_id"],
                            row["player_name"],
                            finished_at,
                            ps.get(row["player_id"], {}).get("rank"),
                            ps.get(row["player_id"], {}).get("total_players"),
                            ps.get(row["player_id"], {}).get("wins", 0),
                            ps.get(row["player_id"], {}).get("losses", 0),
                            ps.get(row["player_id"], {}).get("draws", 0),
                            ps.get(row["player_id"], {}).get("points_for", 0),
                            ps.get(row["player_id"], {}).get("points_against", 0),
                            sport,
                            json.dumps(pr.get(row["player_id"], {}).get("top_partners", [])),
                            json.dumps(pr.get(row["player_id"], {}).get("top_rivals", [])),
                            json.dumps(pr.get(row["player_id"], {}).get("all_partners", [])),
                            json.dumps(pr.get(row["player_id"], {}).get("all_rivals", [])),
                        )
                        for row in linked
                    ],
                )
            # Stamp finished metadata for every player_secrets row so both linked
            # and unlinked participants remain visible in organizer views.
            rows = conn.execute(
                "SELECT player_id FROM player_secrets WHERE tournament_id = ?",
                (tournament_id,),
            ).fetchall()
            if rows:
                conn.executemany(
                    """UPDATE player_secrets
                       SET finished_at            = ?,
                           tournament_name        = ?,
                           finished_sport         = ?,
                           finished_stats         = ?,
                           finished_top_partners  = ?,
                           finished_top_rivals    = ?,
                           finished_all_partners  = ?,
                           finished_all_rivals    = ?
                       WHERE tournament_id = ? AND player_id = ?""",
                    [
                        (
                            finished_at,
                            entity_name,
                            sport,
                            json.dumps(ps.get(row["player_id"], {})),
                            json.dumps(pr.get(row["player_id"], {}).get("top_partners", [])),
                            json.dumps(pr.get(row["player_id"], {}).get("top_rivals", [])),
                            json.dumps(pr.get(row["player_id"], {}).get("all_partners", [])),
                            json.dumps(pr.get(row["player_id"], {}).get("all_rivals", [])),
                            tournament_id,
                            row["player_id"],
                        )
                        for row in rows
                    ],
                )
    except sqlite3.Error as exc:
        logger.warning("Could not delete player secrets for %s: %s", tournament_id, exc)
    finally:
        invalidate_secrets_cache(tournament_id)


def purge_expired_secrets() -> None:
    """Delete finished player secrets older than 30 days.

    Called once on startup.  Secrets are preserved for 30 days after a
    tournament finishes so that unregistered players can still create a
    Player Hub profile and have their history backfilled.
    """
    from datetime import datetime, timezone

    cutoff = datetime.now(timezone.utc).isoformat()
    try:
        with get_db() as conn:
            conn.execute(
                "DELETE FROM player_secrets WHERE finished_at IS NOT NULL AND finished_at < datetime(?, '-30 days')",
                (cutoff,),
            )
        _clear_all_secrets_caches()
    except sqlite3.Error as exc:
        logger.warning("Could not purge expired player secrets: %s", exc)


def regenerate_secret(tournament_id: str, player_id: str) -> PlayerSecret | None:
    """Regenerate passphrase and token for a single player.

    Returns the new ``PlayerSecret`` or ``None`` if the row does not exist.
    """
    from ..tournaments.player_secrets import generate_passphrase, generate_token

    new = PlayerSecret(passphrase=generate_passphrase(), token=generate_token())
    with get_db() as conn:
        cur = conn.execute(
            """
            UPDATE player_secrets SET passphrase = ?, token = ?
            WHERE tournament_id = ? AND player_id = ?
            """,
            (new.passphrase, new.token, tournament_id, player_id),
        )
        if cur.rowcount == 0:
            return None
    invalidate_secrets_cache(tournament_id)
    return new


# ────────────────────────────────────────────────────────────────────────────
# Read / lookup helpers
# ────────────────────────────────────────────────────────────────────────────


def add_player_secret(
    tournament_id: str,
    player_id: str,
    player_name: str,
    passphrase: str,
    token: str,
) -> None:
    """Insert a single player's secret into the player_secrets table.

    Args:
        tournament_id: The tournament the player belongs to.
        player_id: Unique player hex ID.
        player_name: Display name.
        passphrase: Human-readable passphrase.
        token: URL token for QR-code login.
    """
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token, contact)
            VALUES (?, ?, ?, ?, ?, '')
            ON CONFLICT(tournament_id, player_id) DO UPDATE SET
                passphrase  = excluded.passphrase,
                token       = excluded.token,
                player_name = excluded.player_name
            """,
            (tournament_id, player_id, player_name, passphrase, token),
        )
    invalidate_secrets_cache(tournament_id)


def remove_player_secret(tournament_id: str, player_id: str) -> bool:
    """Delete a single player's secret row.

    Returns:
        True if a row was deleted, False if it did not exist.
    """
    with get_db() as conn:
        cur = conn.execute(
            "DELETE FROM player_secrets WHERE tournament_id = ? AND player_id = ?",
            (tournament_id, player_id),
        )
    invalidate_secrets_cache(tournament_id)
    return cur.rowcount > 0


def get_secrets_for_tournament(tournament_id: str) -> dict[str, dict]:
    """Return all secrets for a tournament as ``{player_id: {name, passphrase, token, contact, email, profile_id}}``.

    Results are cached in memory; the cache is invalidated by any write
    operation on the same tournament's secrets.
    """
    cached = _secrets_cache.get(tournament_id)
    if cached is not None:
        return cached
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT player_id, player_name, passphrase, token, contact, email, profile_id"
                " FROM player_secrets WHERE tournament_id = ? AND finished_at IS NULL",
                (tournament_id,),
            ).fetchall()
    except sqlite3.Error as exc:
        logger.warning("Could not load secrets for %s: %s", tournament_id, exc)
        return {}
    result = {
        row["player_id"]: {
            "name": row["player_name"],
            "passphrase": row["passphrase"],
            "token": row["token"],
            "contact": row["contact"] or "",
            "email": row["email"] if "email" in row.keys() else "",
            "profile_id": row["profile_id"] if "profile_id" in row.keys() else None,
        }
        for row in rows
    }
    _secrets_cache[tournament_id] = result
    return result


def update_contact(tournament_id: str, player_id: str, contact: str) -> bool:
    """Update the contact string for a single player.

    Args:
        tournament_id: The tournament ID.
        player_id: The player ID.
        contact: New contact value (may be empty).

    Returns:
        ``True`` if the row was found and updated, ``False`` otherwise.
    """
    try:
        with get_db() as conn:
            cur = conn.execute(
                "UPDATE player_secrets SET contact = ? WHERE tournament_id = ? AND player_id = ?",
                (contact, tournament_id, player_id),
            )
            return cur.rowcount > 0
    except sqlite3.Error as exc:
        logger.warning("Could not update contact for %s/%s: %s", tournament_id, player_id, exc)
        return False
    finally:
        invalidate_secrets_cache(tournament_id)


def update_email(tournament_id: str, player_id: str, email: str) -> dict:
    """Update the email address for a single player and auto-link a Player Hub profile.

    If the email matches an existing ``player_profiles`` row the ``profile_id``
    is set on the secret so the tournament appears in that player's Player Hub
    immediately.  When the email is empty or matches no profile the
    ``profile_id`` is cleared (unlinked).

    Args:
        tournament_id: The tournament ID.
        player_id: The player ID.
        email: New email address (may be empty to clear).

    Returns:
        Dict with keys ``updated`` (bool) and ``profile_linked`` (bool).
    """
    try:
        with get_db() as conn:
            profile_id: str | None = None
            profile_name: str | None = None
            profile_contact: str | None = None
            if email:
                row = conn.execute(
                    "SELECT id, name, contact FROM player_profiles WHERE email = ?",
                    (email,),
                ).fetchone()
                if row:
                    profile_id = row["id"]
                    profile_name = row["name"]
                    profile_contact = row["contact"]
            if profile_id is not None:
                cur = conn.execute(
                    """
                    UPDATE player_secrets
                    SET email = ?, profile_id = ?, player_name = ?, contact = ?
                    WHERE tournament_id = ? AND player_id = ?
                    """,
                    (email, profile_id, profile_name, profile_contact, tournament_id, player_id),
                )
            else:
                cur = conn.execute(
                    "UPDATE player_secrets SET email = ?, profile_id = ? WHERE tournament_id = ? AND player_id = ?",
                    (email, profile_id, tournament_id, player_id),
                )
            return {
                "updated": cur.rowcount > 0,
                "profile_linked": profile_id is not None,
                "player_name": profile_name,
                "contact": profile_contact,
            }
    except sqlite3.Error as exc:
        logger.warning("Could not update email for %s/%s: %s", tournament_id, player_id, exc)
        return {"updated": False, "profile_linked": False, "player_name": None, "contact": None}
    finally:
        invalidate_secrets_cache(tournament_id)


def get_contacts_for_tournament(tournament_id: str) -> dict[str, str]:
    """Return a ``{player_id: contact}`` mapping for all players in a tournament.

    Results are cached in memory; the cache is invalidated by any write
    operation on the same tournament's secrets.
    """
    cached = _contacts_cache.get(tournament_id)
    if cached is not None:
        return cached
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT player_id, contact FROM player_secrets WHERE tournament_id = ?",
                (tournament_id,),
            ).fetchall()
    except sqlite3.Error as exc:
        logger.warning("Could not load contacts for %s: %s", tournament_id, exc)
        return {}
    result = {row["player_id"]: row["contact"] or "" for row in rows}
    _contacts_cache[tournament_id] = result
    return result


def lookup_by_passphrase(tournament_id: str, passphrase: str) -> dict | None:
    """Find a player by passphrase within a tournament.

    Returns ``{"player_id": ..., "player_name": ...}`` or ``None``.
    Checks both direct tournament secrets and the global profile passphrase
    (unified auth fallback for players who linked via Player Hub).
    """
    try:
        with get_db() as conn:
            # Direct match: the player's tournament-specific passphrase
            row = conn.execute(
                "SELECT player_id, player_name FROM player_secrets WHERE tournament_id = ? AND passphrase = ?",
                (tournament_id, passphrase),
            ).fetchone()
            if row is not None:
                return {"player_id": row["player_id"], "player_name": row["player_name"]}

            # Global passphrase fallback: passphrase belongs to a profile and
            # that profile has a linked row in player_secrets for this tournament.
            profile_row = conn.execute(
                "SELECT id FROM player_profiles WHERE passphrase = ?",
                (passphrase,),
            ).fetchone()
            if profile_row is None:
                return None

            linked_row = conn.execute(
                "SELECT player_id, player_name FROM player_secrets WHERE tournament_id = ? AND profile_id = ?",
                (tournament_id, profile_row["id"]),
            ).fetchone()
            if linked_row is None:
                return None
            return {"player_id": linked_row["player_id"], "player_name": linked_row["player_name"]}
    except sqlite3.Error as exc:
        logger.warning("Passphrase lookup failed for %s: %s", tournament_id, exc)
        return None


def lookup_registrant_by_passphrase(registration_id: str, passphrase: str) -> dict | None:
    """Find a registrant in a lobby by passphrase.

    Checks both the registrant's own passphrase and the global profile
    passphrase (unified auth fallback for players who linked via Player Hub).

    Returns ``{"player_id", "player_name", "passphrase", "token", "answers", "registered_at"}``
    or ``None`` if not found.
    """
    try:
        with get_db() as conn:
            # Direct match: the registrant's own passphrase
            row = conn.execute(
                "SELECT player_id, player_name, passphrase, token, answers, registered_at"
                " FROM registrants WHERE registration_id = ? AND passphrase = ?",
                (registration_id, passphrase),
            ).fetchone()

            # Global passphrase fallback: passphrase belongs to a profile and
            # that profile has a linked registrant row in this lobby.
            if row is None:
                profile_row = conn.execute(
                    "SELECT id FROM player_profiles WHERE passphrase = ?",
                    (passphrase,),
                ).fetchone()
                if profile_row is not None:
                    row = conn.execute(
                        "SELECT player_id, player_name, passphrase, token, answers, registered_at"
                        " FROM registrants WHERE registration_id = ? AND profile_id = ?",
                        (registration_id, profile_row["id"]),
                    ).fetchone()
    except sqlite3.Error as exc:
        logger.warning("Registrant passphrase lookup failed for %s: %s", registration_id, exc)
        return None
    if row is None:
        return None
    import json as _json

    answers: dict = {}
    if row["answers"]:
        try:
            answers = _json.loads(row["answers"])
        except (json.JSONDecodeError, ValueError):
            pass
    return {
        "player_id": row["player_id"],
        "player_name": row["player_name"],
        "passphrase": row["passphrase"],
        "token": row["token"],
        "answers": answers,
        "registered_at": row["registered_at"],
    }


def lookup_registrant_by_token(registration_id: str, token: str) -> dict | None:
    """Find a registrant in a lobby by their unique token.

    Returns ``{"player_id", "player_name", "passphrase", "token", "answers", "registered_at"}``
    or ``None`` if not found.
    """
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT player_id, player_name, passphrase, token, answers, registered_at"
                " FROM registrants WHERE registration_id = ? AND token = ?",
                (registration_id, token),
            ).fetchone()
    except sqlite3.Error as exc:
        logger.warning("Registrant token lookup failed for %s: %s", registration_id, exc)
        return None
    if row is None:
        return None
    import json as _json

    answers: dict = {}
    if row["answers"]:
        try:
            answers = _json.loads(row["answers"])
        except (json.JSONDecodeError, ValueError):
            pass
    return {
        "player_id": row["player_id"],
        "player_name": row["player_name"],
        "passphrase": row["passphrase"],
        "token": row["token"],
        "answers": answers,
        "registered_at": row["registered_at"],
    }


def lookup_by_token(token: str) -> dict | None:
    """Find a player by their unique URL token (used for QR code auth).

    Returns ``{"tournament_id": ..., "player_id": ..., "player_name": ...}`` or ``None``.
    """
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT tournament_id, player_id, player_name FROM player_secrets WHERE token = ?",
                (token,),
            ).fetchone()
    except sqlite3.Error as exc:
        logger.warning("Token lookup failed: %s", exc)
        return None
    if row is None:
        return None
    return {
        "tournament_id": row["tournament_id"],
        "player_id": row["player_id"],
        "player_name": row["player_name"],
    }


def lookup_profile_by_passphrase(passphrase: str) -> dict | None:
    """Look up a Player Hub profile by its global passphrase.

    Returns ``{"id": ..., "name": ..., "email": ..., "created_at": ...}`` or ``None``.
    """
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT id, passphrase, name, email, contact, created_at FROM player_profiles WHERE passphrase = ?",
                (passphrase,),
            ).fetchone()
    except sqlite3.Error as exc:
        logger.warning("Profile passphrase lookup failed: %s", exc)
        return None
    if row is None:
        return None
    return dict(row)


def resolve_passphrase(passphrase: str) -> dict:
    """Resolve a passphrase against hub profiles, tournaments, and registrations.

    Returns a dict with ``"type"`` being one of:
    - ``"profile"`` — passphrase belongs to a Player Hub profile.
    - ``"participation"`` — passphrase found in tournament or registration participations
      (but no hub profile exists). Includes ``"matches"`` list.
    - ``"not_found"`` — passphrase not recognised anywhere.
    """
    try:
        with get_db() as conn:
            # 1. Check hub profiles first
            profile_row = conn.execute(
                "SELECT id FROM player_profiles WHERE passphrase = ?",
                (passphrase,),
            ).fetchone()
            if profile_row is not None:
                return {"type": "profile"}

            # 2. Check tournament participations
            matches: list[dict] = []
            tournament_rows = conn.execute(
                """
                SELECT ps.tournament_id, ps.player_id, ps.player_name, t.name AS tournament_name
                FROM player_secrets ps
                JOIN tournaments t ON t.id = ps.tournament_id
                WHERE ps.passphrase = ?
                """,
                (passphrase,),
            ).fetchall()
            for row in tournament_rows:
                matches.append(
                    {
                        "entity_type": "tournament",
                        "entity_id": row["tournament_id"],
                        "entity_name": row["tournament_name"],
                        "player_name": row["player_name"],
                    }
                )

            # 3. Check registration participations
            registration_rows = conn.execute(
                """
                SELECT r.registration_id, r.player_id, r.player_name, reg.name AS registration_name
                FROM registrants r
                JOIN registrations reg ON reg.id = r.registration_id
                WHERE r.passphrase = ?
                """,
                (passphrase,),
            ).fetchall()
            for row in registration_rows:
                matches.append(
                    {
                        "entity_type": "registration",
                        "entity_id": row["registration_id"],
                        "entity_name": row["registration_name"],
                        "player_name": row["player_name"],
                    }
                )

            if matches:
                return {"type": "participation", "matches": matches}

            return {"type": "not_found"}
    except sqlite3.Error as exc:
        logger.warning("Passphrase resolve failed: %s", exc)
        return {"type": "not_found"}
