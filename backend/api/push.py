"""
Web Push notification support.

Provides VAPID key management, push-subscription persistence, and a
non-blocking helper to dispatch push messages to subscribed players.

VAPID keys are auto-generated on first startup and stored in the SQLite
``meta`` table — no manual configuration needed.  Operators who prefer
explicit control can set ``AMISTOSO_VAPID_PRIVATE_KEY`` (PEM) and
``AMISTOSO_VAPID_PUBLIC_KEY`` (URL-safe base64 uncompressed point) in
the environment; these take precedence over auto-generated keys.

Design principles:
- Fire-and-forget delivery — push failures never block API responses.
- Stale subscriptions (expired/unsubscribed endpoints) are automatically
  removed when the push service returns 404/410.
- All public functions are safe to call even when push is not configured
  (e.g. ``cryptography`` missing); they degrade gracefully to no-ops.
"""

from __future__ import annotations

import base64
import json
import logging
import sqlite3
from concurrent.futures import ThreadPoolExecutor

from .db import get_db

logger = logging.getLogger(__name__)

# ────────────────────────────────────────────────────────────────────────────
# VAPID key management
# ────────────────────────────────────────────────────────────────────────────

_vapid_private_pem: str | None = None
_vapid_public_b64: str | None = None

# A small thread-pool so ``pywebpush`` (which uses blocking ``requests``)
# never blocks the asyncio event loop.
_push_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="webpush")

# Claim ``sub`` must be a mailto: or https: URI.  Operators can override via
# ``AMISTOSO_VAPID_CONTACT`` env-var.
_vapid_claims_contact: str = "mailto:admin@example.com"


def shutdown_push() -> None:
    """Shut down the push thread pool without waiting for in-flight tasks."""
    _push_executor.shutdown(wait=False)


def _generate_vapid_keys() -> tuple[str, str]:
    """Generate a fresh ECDSA P-256 key pair and return (private_pem, public_b64url)."""
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization

    private_key = ec.generate_private_key(ec.SECP256R1())
    private_pem = private_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_raw = private_key.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    public_b64 = base64.urlsafe_b64encode(public_raw).rstrip(b"=").decode()
    return private_pem, public_b64


def init_push() -> None:
    """Initialise VAPID keys — auto-generate and persist if needed.

    Called once from the application lifespan startup.  Safe to call
    multiple times (idempotent).
    """
    global _vapid_private_pem, _vapid_public_b64, _vapid_claims_contact

    import os

    # Allow operators to override via environment variables.
    env_private = os.environ.get("AMISTOSO_VAPID_PRIVATE_KEY", "").strip()
    env_public = os.environ.get("AMISTOSO_VAPID_PUBLIC_KEY", "").strip()
    env_contact = os.environ.get("AMISTOSO_VAPID_CONTACT", "").strip()

    if env_contact:
        _vapid_claims_contact = env_contact

    if env_private and env_public:
        _vapid_private_pem = env_private
        _vapid_public_b64 = env_public
        logger.info("Web Push: using VAPID keys from environment")
        return

    # Try to load from the meta table.
    try:
        with get_db() as conn:
            row = conn.execute("SELECT value FROM meta WHERE key = 'vapid_private_pem'").fetchone()
            if row:
                _vapid_private_pem = row[0] if isinstance(row[0], str) else row[0].decode()
                row2 = conn.execute("SELECT value FROM meta WHERE key = 'vapid_public_b64'").fetchone()
                _vapid_public_b64 = (row2[0] if isinstance(row2[0], str) else row2[0].decode()) if row2 else None
                if _vapid_private_pem and _vapid_public_b64:
                    logger.info("Web Push: loaded VAPID keys from database")
                    return
    except sqlite3.Error as exc:
        logger.warning("Could not read VAPID keys from DB: %s", exc)

    # Generate fresh keys and persist them.
    try:
        private_pem, public_b64 = _generate_vapid_keys()
    except Exception:
        logger.warning("Web Push: cryptography library unavailable — push disabled")
        return

    try:
        with get_db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('vapid_private_pem', ?)",
                (private_pem,),
            )
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('vapid_public_b64', ?)",
                (public_b64,),
            )
    except sqlite3.Error as exc:
        logger.warning("Could not persist VAPID keys: %s", exc)

    _vapid_private_pem = private_pem
    _vapid_public_b64 = public_b64
    logger.info("Web Push: generated and stored new VAPID key pair")


def get_vapid_public_key() -> str | None:
    """Return the VAPID public key as URL-safe base64, or ``None`` if push is not available."""
    return _vapid_public_b64


def is_push_available() -> bool:
    """Return ``True`` if VAPID keys are initialised and push can be sent."""
    return _vapid_private_pem is not None and _vapid_public_b64 is not None


# ────────────────────────────────────────────────────────────────────────────
# Push subscription storage
# ────────────────────────────────────────────────────────────────────────────


def save_subscription(tournament_id: str, player_id: str, subscription_info: dict) -> None:
    """Persist a push subscription for a player in a tournament.

    Args:
        tournament_id: Tournament ID.
        player_id: Player ID.
        subscription_info: The PushSubscription JSON object from the browser
            (``endpoint``, ``keys.p256dh``, ``keys.auth``).
    """
    endpoint = subscription_info.get("endpoint", "")
    payload = json.dumps(subscription_info)
    try:
        with get_db() as conn:
            conn.execute(
                """INSERT OR REPLACE INTO push_subscriptions
                   (tournament_id, player_id, endpoint, subscription_json)
                   VALUES (?, ?, ?, ?)""",
                (tournament_id, player_id, endpoint, payload),
            )
    except sqlite3.Error as exc:
        logger.warning("Could not save push subscription for %s/%s: %s", tournament_id, player_id, exc)


def remove_subscription(tournament_id: str, player_id: str) -> None:
    """Remove a player's push subscription for a tournament."""
    try:
        with get_db() as conn:
            conn.execute(
                "DELETE FROM push_subscriptions WHERE tournament_id = ? AND player_id = ?",
                (tournament_id, player_id),
            )
    except sqlite3.Error as exc:
        logger.warning("Could not remove push subscription for %s/%s: %s", tournament_id, player_id, exc)


def _remove_subscription_by_endpoint(endpoint: str) -> None:
    """Remove a stale subscription by endpoint URL (called when pushes fail with 404/410)."""
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
    except sqlite3.Error as exc:
        logger.warning("Could not remove stale push subscription: %s", exc)


def get_subscriptions_for_tournament(tournament_id: str) -> list[tuple[str, dict]]:
    """Return ``[(player_id, subscription_info), ...]`` for all subscribers of a tournament."""
    try:
        with get_db() as conn:
            rows = conn.execute(
                "SELECT player_id, subscription_json FROM push_subscriptions WHERE tournament_id = ?",
                (tournament_id,),
            ).fetchall()
        return [(r[0], json.loads(r[1])) for r in rows]
    except sqlite3.Error as exc:
        logger.warning("Could not load push subscriptions for %s: %s", tournament_id, exc)
        return []


def get_subscriptions_for_players(tournament_id: str, player_ids: set[str]) -> list[tuple[str, dict]]:
    """Return subscriptions only for the given player IDs in a tournament."""
    if not player_ids:
        return []
    try:
        with get_db() as conn:
            placeholders = ",".join("?" for _ in player_ids)
            rows = conn.execute(
                f"SELECT player_id, subscription_json FROM push_subscriptions "
                f"WHERE tournament_id = ? AND player_id IN ({placeholders})",
                (tournament_id, *player_ids),
            ).fetchall()
        return [(r[0], json.loads(r[1])) for r in rows]
    except sqlite3.Error as exc:
        logger.warning("Could not load push subscriptions for players in %s: %s", tournament_id, exc)
        return []


# ────────────────────────────────────────────────────────────────────────────
# Push sending
# ────────────────────────────────────────────────────────────────────────────


def _do_send_push(subscription_info: dict, payload: str) -> None:
    """Blocking push send — runs in the thread pool.

    Handles 404/410 (subscription expired) by removing the stale record.
    All other errors are logged and swallowed.
    """
    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return

    try:
        webpush(
            subscription_info=subscription_info,
            data=payload,
            vapid_private_key=_vapid_private_pem,
            vapid_claims={"sub": _vapid_claims_contact},
        )
    except WebPushException as exc:
        status = getattr(exc, "response", None)
        status_code = getattr(status, "status_code", 0) if status else 0
        if status_code in (404, 410):
            endpoint = subscription_info.get("endpoint", "")
            _remove_subscription_by_endpoint(endpoint)
            logger.debug("Removed stale push subscription (HTTP %s): %s", status_code, endpoint[:80])
        else:
            logger.warning("Web Push failed: %s", exc)
    except Exception as exc:
        logger.warning("Web Push unexpected error: %s", exc)


def send_push_to_players(
    tournament_id: str,
    player_ids: set[str],
    title: str,
    body: str,
    url: str | None = None,
    tag: str | None = None,
) -> None:
    """Send a push notification to specific players in a tournament.

    Non-blocking — dispatches to the thread pool and returns immediately.
    Safe to call from sync code (``_save_tournament`` path).

    Args:
        tournament_id: Tournament ID.
        player_ids: Set of player IDs to notify.
        title: Notification title.
        body: Notification body text.
        url: Optional URL to open when the notification is clicked.
        tag: Optional tag to collapse repeated notifications.
    """
    if not is_push_available() or not player_ids:
        return

    subs = get_subscriptions_for_players(tournament_id, player_ids)
    if not subs:
        return

    payload = json.dumps(
        {
            "title": title,
            "body": body,
            "url": url or "/",
            "tag": tag or f"{tournament_id}-update",
        }
    )

    for _pid, sub_info in subs:
        _push_executor.submit(_do_send_push, sub_info, payload)


def send_push_to_tournament(
    tournament_id: str,
    title: str,
    body: str,
    url: str | None = None,
    tag: str | None = None,
) -> None:
    """Send a push notification to ALL subscribers of a tournament.

    Non-blocking — dispatches to the thread pool.
    """
    if not is_push_available():
        return

    subs = get_subscriptions_for_tournament(tournament_id)
    if not subs:
        return

    payload = json.dumps(
        {
            "title": title,
            "body": body,
            "url": url or "/",
            "tag": tag or f"{tournament_id}-update",
        }
    )

    for _pid, sub_info in subs:
        _push_executor.submit(_do_send_push, sub_info, payload)


# ────────────────────────────────────────────────────────────────────────────
# Test helpers
# ────────────────────────────────────────────────────────────────────────────


def _clear_push_state() -> None:
    """Reset module-level state — for tests only."""
    global _vapid_private_pem, _vapid_public_b64
    _vapid_private_pem = None
    _vapid_public_b64 = None
