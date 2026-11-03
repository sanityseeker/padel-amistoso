"""
Shared player-profile merge primitives.

Used by both the admin players endpoints (``routes_admin_players``) and the
club players endpoints (``routes_clubs``) so ghost/Hub profile consolidation
behaves identically everywhere: reassign all participations/history from a
secondary profile onto a primary one, and materialize raw past-participants (players who
appear only in ``player_secrets``/``player_history`` with no profile row) into
ghost profiles so they can take part in a merge.  Merging two registered (Hub)
profiles goes through :func:`merge_hub_profile_data`, guarded by
:func:`shared_tournaments`.
"""

from __future__ import annotations

import re
import sqlite3
import unicodedata
from collections.abc import Sequence

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
    profile itself.  The caller marks the primary for ELO recalculation
    (``elo_recalc.mark_elo_dirty``) afterwards.
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


def profile_tournament_ids(conn: sqlite3.Connection, profile_id: str) -> list[str]:
    """All distinct tournament ids ``profile_id`` took part in (secrets + history)."""
    return [
        r["tid"]
        for r in conn.execute(
            """
            SELECT tournament_id AS tid FROM player_secrets WHERE profile_id = ?
            UNION
            SELECT entity_id FROM player_history WHERE profile_id = ? AND entity_type = 'tournament'
            """,
            (profile_id, profile_id),
        ).fetchall()
    ]


def shared_tournaments(conn: sqlite3.Connection, profile_a: str, profile_b: str) -> list[tuple[str, str]]:
    """Tournaments both profiles took part in, as ``(tournament_id, name)`` sorted by name.

    Two profiles that played the same tournament are two different
    participants of it, so they can never be the same person.
    """
    rows = conn.execute(
        """
        WITH parts AS (
            SELECT profile_id, tournament_id AS tid, NULLIF(tournament_name, '') AS name
              FROM player_secrets WHERE profile_id IN (?, ?)
            UNION
            SELECT profile_id, entity_id, NULLIF(entity_name, '')
              FROM player_history WHERE entity_type = 'tournament' AND profile_id IN (?, ?)
        )
        SELECT p.tid AS tid, COALESCE(t.name, MAX(p.name), p.tid) AS name
          FROM parts p
          LEFT JOIN tournaments t ON t.id = p.tid
         GROUP BY p.tid
        HAVING COUNT(DISTINCT p.profile_id) = 2
         ORDER BY name COLLATE NOCASE
        """,
        (profile_a, profile_b, profile_a, profile_b),
    ).fetchall()
    return [(r["tid"], r["name"]) for r in rows]


def merge_hub_profile_data(conn: sqlite3.Connection, primary_id: str, secondary_id: str) -> None:
    """Fold registered profile ``secondary_id`` into registered profile ``primary_id``.

    The caller must have checked :func:`shared_tournaments` is empty.  On top
    of :func:`reassign_profile_data` this keeps what a real account owns: the
    primary's name/email/contact/K-factor stay, with blanks filled from the
    secondary; club memberships the primary lacks move over (the primary's
    tier/visibility wins where both are members); pending participation
    claims move; the secondary's path cache is dropped.  The secondary's
    passphrase and sessions stop working once its row is deleted.  The caller
    marks the primary for ELO recalculation afterwards.
    """
    primary = conn.execute(
        "SELECT name, email, email_verified_at, contact, k_factor_override FROM player_profiles WHERE id = ?",
        (primary_id,),
    ).fetchone()
    secondary = conn.execute(
        "SELECT name, email, email_verified_at, contact, k_factor_override FROM player_profiles WHERE id = ?",
        (secondary_id,),
    ).fetchone()
    fill: dict[str, object] = {}
    if not primary["name"] and secondary["name"]:
        fill["name"] = secondary["name"]
    if not primary["email"] and secondary["email"]:
        fill["email"] = secondary["email"]
        fill["email_verified_at"] = secondary["email_verified_at"]
    if not primary["contact"] and secondary["contact"]:
        fill["contact"] = secondary["contact"]
    if primary["k_factor_override"] is None and secondary["k_factor_override"] is not None:
        fill["k_factor_override"] = secondary["k_factor_override"]
    if fill:
        set_clause = ", ".join(f"{col} = ?" for col in fill)
        conn.execute(f"UPDATE player_profiles SET {set_clause} WHERE id = ?", (*fill.values(), primary_id))

    # Rows the primary already has for that (club, sport) are skipped here and
    # dropped by reassign_profile_data.
    conn.execute(
        "UPDATE OR IGNORE profile_club_elo SET profile_id = ? WHERE profile_id = ?",
        (primary_id, secondary_id),
    )
    conn.execute(
        "UPDATE participation_claims SET profile_id = ? WHERE profile_id = ?",
        (primary_id, secondary_id),
    )
    conn.execute("DELETE FROM player_tournament_path_cache WHERE profile_id = ?", (secondary_id,))
    reassign_profile_data(conn, primary_id, secondary_id)


def resolve_current_identities(conn: sqlite3.Connection, player_ids: Sequence[str]) -> dict[str, tuple[str, str]]:
    """Map historical tournament ``player_id``s to their *current* profile identity.

    Returns ``player_id -> (profile_id, profile_name)``.  Because
    :func:`reassign_profile_data` repoints ``player_secrets``/``player_history``
    at the primary profile on merge, this resolves to the post-merge account
    even for participations recorded under an old name — which is what lets
    career-wide stats group a renamed/merged player as one person.

    ``player_id``s with no linked profile are absent from the result; callers
    fall back to the historical name snapshot (see :func:`normalize_name`).
    """
    resolved: dict[str, tuple[str, str]] = {}
    unique = [pid for pid in dict.fromkeys(player_ids) if pid]
    # Each chunk is bound twice (once per UNION arm), so stay well under
    # SQLite's default 999-variable limit.
    for start in range(0, len(unique), 400):
        chunk = unique[start : start + 400]
        placeholders = ",".join("?" * len(chunk))
        rows = conn.execute(
            f"""
            SELECT link.player_id AS player_id, pp.id AS profile_id, pp.name AS profile_name
              FROM (
                    SELECT player_id, profile_id FROM player_secrets
                     WHERE player_id IN ({placeholders}) AND profile_id IS NOT NULL
                    UNION
                    SELECT player_id, profile_id FROM player_history
                     WHERE player_id IN ({placeholders}) AND profile_id IS NOT NULL
                   ) AS link
              JOIN player_profiles pp ON pp.id = link.profile_id
            """,
            (*chunk, *chunk),
        ).fetchall()
        for row in rows:
            resolved.setdefault(row["player_id"], (row["profile_id"], row["profile_name"] or ""))
    return resolved


def materialize_participants(player_ids: list[str]) -> list[str]:
    """Turn raw past-participant ``player_id``s into ghost profile ids.

    For each ``player_id`` that has no linked profile, creates (idempotently) a
    deterministic ``ghost_<player_id>`` profile, linking its ``player_secrets``
    and ``player_history`` rows and rebuilding its ELO.  ``player_id``s that
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
