"""
Persistence layer for player secrets.

Provides CRUD operations against the ``player_secrets`` table, fully
decoupled from the tournament pickle/BLOB storage.  Secrets are written
once at tournament creation and queried at player-auth time.
"""

from __future__ import annotations

import logging

from ..tournaments.player_secrets import PlayerSecret, generate_secrets_for_players
from .db import get_db

logger = logging.getLogger(__name__)


# ────────────────────────────────────────────────────────────────────────────
# Write helpers
# ────────────────────────────────────────────────────────────────────────────


def create_secrets_for_tournament(
    tournament_id: str,
    players: list[dict[str, str]],
) -> dict[str, PlayerSecret]:
    """Generate and persist secrets for every player in a tournament.

    Args:
        tournament_id: The tournament ID (e.g. ``"t5"``).
        players: List of dicts with ``"id"`` and ``"name"`` keys.

    Returns:
        Mapping of player_id → ``PlayerSecret``.
    """
    player_ids = [p["id"] for p in players]
    secrets = generate_secrets_for_players(player_ids)
    name_map = {p["id"]: p["name"] for p in players}

    try:
        with get_db() as conn:
            conn.executemany(
                """
                INSERT INTO player_secrets (tournament_id, player_id, player_name, passphrase, token)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(tournament_id, player_id) DO UPDATE SET
                    passphrase  = excluded.passphrase,
                    token       = excluded.token,
                    player_name = excluded.player_name
                """,
                [
                    (tournament_id, pid, name_map.get(pid, ""), sec.passphrase, sec.token)
                    for pid, sec in secrets.items()
                ],
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not persist player secrets for %s: %s", tournament_id, exc)

    return secrets


def delete_secrets_for_tournament(tournament_id: str) -> None:
    """Remove all player secrets for a tournament."""
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM player_secrets WHERE tournament_id = ?", (tournament_id,))
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not delete player secrets for %s: %s", tournament_id, exc)


def regenerate_secret(tournament_id: str, player_id: str) -> PlayerSecret | None:
    """Regenerate passphrase and token for a single player.

    Returns the new ``PlayerSecret`` or ``None`` if the row does not exist.
    """
    from ..tournaments.player_secrets import generate_passphrase, generate_token

    new = PlayerSecret(passphrase=generate_passphrase(), token=generate_token())
    try:
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
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not regenerate secret for %s/%s: %s", tournament_id, player_id, exc)
        return None
    return new


# ────────────────────────────────────────────────────────────────────────────
# Read / lookup helpers
# ────────────────────────────────────────────────────────────────────────────


def get_secrets_for_tournament(tournament_id: str) -> dict[str, dict]:
    """Return all secrets for a tournament as ``{player_id: {name, passphrase, token}}``."""
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT player_id, player_name, passphrase, token FROM player_secrets WHERE tournament_id = ?",
                (tournament_id,),
            ).fetchall()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Could not load secrets for %s: %s", tournament_id, exc)
        return {}
    return {
        row["player_id"]: {
            "name": row["player_name"],
            "passphrase": row["passphrase"],
            "token": row["token"],
        }
        for row in rows
    }


def lookup_by_passphrase(tournament_id: str, passphrase: str) -> dict | None:
    """Find a player by passphrase within a tournament.

    Returns ``{"player_id": ..., "player_name": ...}`` or ``None``.
    """
    try:
        with get_db() as conn:
            row = conn.execute(
                "SELECT player_id, player_name FROM player_secrets WHERE tournament_id = ? AND passphrase = ?",
                (tournament_id, passphrase),
            ).fetchone()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Passphrase lookup failed for %s: %s", tournament_id, exc)
        return None
    if row is None:
        return None
    return {"player_id": row["player_id"], "player_name": row["player_name"]}


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
    except Exception as exc:  # noqa: BLE001
        logger.warning("Token lookup failed: %s", exc)
        return None
    if row is None:
        return None
    return {
        "tournament_id": row["tournament_id"],
        "player_id": row["player_id"],
        "player_name": row["player_name"],
    }
