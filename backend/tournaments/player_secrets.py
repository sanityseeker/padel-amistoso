"""
Player secret generation for tournament self-scoring.

Each player in a tournament receives a unique passphrase (human-friendly,
docker-style word combo via ``coolname``) and a cryptographic URL token
for QR-code-based auto-login. Together they allow players to authenticate
against *their own* matches without requiring a platform account.
"""

from __future__ import annotations

import secrets

import coolname
from pydantic import BaseModel


class PlayerSecret(BaseModel, frozen=True):
    """Credentials assigned to a single tournament player."""

    passphrase: str
    token: str


def generate_passphrase() -> str:
    """Return a 3-word docker-style passphrase, e.g. ``'brave-little-tiger'``."""
    return "-".join(coolname.generate(3))


def generate_token() -> str:
    """Return a URL-safe random token (32 bytes of entropy)."""
    return secrets.token_urlsafe(32)


def generate_secrets_for_players(player_ids: list[str]) -> dict[str, PlayerSecret]:
    """Generate unique ``PlayerSecret`` instances for each player ID.

    Passphrases are guaranteed unique within the returned set. Collisions
    are resolved by regeneration (extremely unlikely with coolname's ~10^5
    3-word combinations and typical tournament sizes of 4-32 players).

    Args:
        player_ids: List of player IDs to generate secrets for.

    Returns:
        Mapping of player_id to ``PlayerSecret``.
    """
    used_passphrases: set[str] = set()
    result: dict[str, PlayerSecret] = {}

    for pid in player_ids:
        passphrase = generate_passphrase()
        # Retry on collision (vanishingly rare)
        while passphrase in used_passphrases:
            passphrase = generate_passphrase()
        used_passphrases.add(passphrase)
        result[pid] = PlayerSecret(passphrase=passphrase, token=generate_token())

    return result
