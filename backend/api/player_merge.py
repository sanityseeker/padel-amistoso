"""
Shared player-profile merge primitives.

Used by both the admin players endpoints (``routes_admin_players``) and the
club players endpoints (``routes_clubs``) so ghost/Hub profile consolidation
behaves identically everywhere: reassign all participations/history from a
secondary profile onto a primary one, list the combined tournament player_ids
for ELO recomputation, and materialize raw past-participants (players who
appear only in ``player_secrets``/``player_history`` with no profile row) into
ghost profiles so they can take part in a merge.
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata

_PUNCT_RE = re.compile(r"[^\w\s]", flags=re.UNICODE)
_WS_RE = re.compile(r"\s+")


def normalize_name(name: str) -> str:
    """Accent/case/punctuation-insensitive key for grouping likely-duplicate names.

    Strips diacritics (NFKD), lowercases, drops punctuation, and collapses
    whitespace: ``"José M. Ruiz"`` and ``"jose m ruiz"`` share a key. Used only
    for *suggesting* merges — never to merge automatically.
    """
    decomposed = unicodedata.normalize("NFKD", name or "")
    without_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    lowered = without_accents.lower()
    no_punct = _PUNCT_RE.sub(" ", lowered)
    return _WS_RE.sub(" ", no_punct).strip()


def reassign_profile_data(conn: sqlite3.Connection, primary_id: str, secondary_id: str) -> None:
    """Move all participations/history from ``secondary_id`` to ``primary_id``.

    Reassigns ``player_secrets``, ``registrants`` and ``player_history`` rows,
    drops the secondary profile's per-scope ELO rows, and deletes the secondary
    profile itself.  The caller is responsible for recomputing ELO
    (``consolidate_ghost_elos``) afterwards.
    """
    conn.execute(
        "UPDATE player_secrets SET profile_id = ? WHERE profile_id = ?",
        (primary_id, secondary_id),
    )
    conn.execute(
        "UPDATE registrants SET profile_id = ? WHERE profile_id = ?",
        (primary_id, secondary_id),
    )
    # Remove history rows that would conflict with existing primary rows, then
    # reassign the rest.
    conn.execute(
        """DELETE FROM player_history
           WHERE profile_id = ?
             AND entity_type = 'tournament'
             AND entity_id IN (
                 SELECT entity_id FROM player_history
                  WHERE profile_id = ? AND entity_type = 'tournament'
             )""",
        (secondary_id, primary_id),
    )
    conn.execute(
        "UPDATE player_history SET profile_id = ? WHERE profile_id = ?",
        (primary_id, secondary_id),
    )
    # Community and club ELO will be fully recomputed by the caller.
    conn.execute("DELETE FROM profile_community_elo WHERE profile_id = ?", (secondary_id,))
    conn.execute("DELETE FROM profile_club_elo WHERE profile_id = ?", (secondary_id,))
    conn.execute("DELETE FROM player_profiles WHERE id = ?", (secondary_id,))


def combined_player_ids(conn: sqlite3.Connection, profile_id: str) -> list[str]:
    """All distinct tournament ``player_id``s now owned by ``profile_id``."""
    return [
        r["player_id"]
        for r in conn.execute(
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
    ]


def materialize_participants(player_ids: list[str]) -> list[str]:
    """Turn raw past-participant ``player_id``s into ghost profile ids.

    For each ``player_id`` that has no linked profile, creates (idempotently) a
    deterministic ``ghost_<player_id>`` profile, linking its ``player_secrets``
    and ``player_history`` rows and backfilling ELO.  ``player_id``s that
    already resolve to a profile are returned as that profile's id.

    Returns the list of profile ids (ghost or existing) corresponding to the
    input ``player_ids``, de-duplicated and order-preserving.  Unknown
    ``player_id``s (no participation anywhere) are skipped.

    The ``_get_or_create_ghost_profile`` import is local to avoid an import
    cycle with the route modules.
    """
    from .routes_player_auth import _get_or_create_ghost_profile  # noqa: PLC0415
    from .db import get_db  # noqa: PLC0415

    resolved: list[str] = []
    seen: set[str] = set()
    for pid in player_ids:
        if not pid:
            continue
        with get_db() as conn:
            # If this player_id already belongs to a profile, reuse it directly.
            existing = conn.execute(
                """
                SELECT profile_id FROM (
                    SELECT profile_id FROM player_secrets
                     WHERE player_id = ? AND profile_id IS NOT NULL
                    UNION
                    SELECT profile_id FROM player_history
                     WHERE player_id = ? AND profile_id IS NOT NULL
                ) LIMIT 1
                """,
                (pid, pid),
            ).fetchone()
            name_row = conn.execute(
                """
                SELECT player_name FROM (
                    SELECT player_name, finished_at AS ts FROM player_secrets WHERE player_id = ?
                    UNION ALL
                    SELECT player_name, finished_at AS ts FROM player_history WHERE player_id = ?
                )
                WHERE player_name IS NOT NULL AND player_name != ''
                ORDER BY ts DESC LIMIT 1
                """,
                (pid, pid),
            ).fetchone()

        if existing is not None and existing["profile_id"]:
            resolved_id = existing["profile_id"]
        elif name_row is not None:
            resolved_id = _get_or_create_ghost_profile(pid, name_row["player_name"])
        else:
            # No participation record at all — nothing to merge.
            continue

        if resolved_id not in seen:
            seen.add(resolved_id)
            resolved.append(resolved_id)
    return resolved
