"""
Demo-instance data lifecycle.

On the demo instance (``AMISTOSO_DEMO_INSTANCE=1``) every demo account and
everything it created is permanently purged ``AMISTOSO_DEMO_TTL_DAYS`` days
(default 3) after the account was minted.  A background task modeled on
:mod:`backend.api.backup` runs a sweep on startup and then every
``AMISTOSO_DEMO_PURGE_INTERVAL_HOURS`` hours.

Unlike the normal tournament delete chain (``routes_crud.delete_tournament``),
which snapshots per-player history into ``player_history`` before removing the
tournament, the demo purge intentionally erases every trace: player secrets,
tournament ELO + logs, ``player_history`` rows, and ghost profiles.

Heavier imports (state, stores) stay inside functions: this module is imported
by ``backend.auth.routes`` while the ``backend.api`` package is still
initialising, and the lazy imports also keep test monkeypatching of
``state._delete_tournament`` etc. effective.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

from .. import config

if TYPE_CHECKING:
    from ..auth.models import User

log = logging.getLogger(__name__)

_scheduler_task: asyncio.Task | None = None


def demo_expires_at(user: User) -> str | None:
    """Return the ISO-8601 expiry (created_at + TTL) for a demo user, else None."""
    if not user.is_demo or not user.created_at:
        return None
    try:
        created = datetime.fromisoformat(user.created_at)
    except ValueError:
        return None
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    return (created + timedelta(days=config.DEMO_TTL_DAYS)).isoformat()


def _expired_demo_usernames(now: datetime | None = None) -> list[str]:
    """Return usernames of demo accounts whose TTL has elapsed."""
    from ..auth.store import user_store  # noqa: PLC0415

    now = now or datetime.now(timezone.utc)
    expired: list[str] = []
    for user in user_store.list_users():
        exp = demo_expires_at(user)
        if exp is not None and datetime.fromisoformat(exp) <= now:
            expired.append(user.username)
    return expired


def _purge_tournament_blocking(tid: str) -> None:
    """Erase one demo tournament and every trace of its players.

    Caller must hold ``state.get_tournament_lock(tid)`` and run this off the
    event loop (``asyncio.to_thread``), mirroring ``routes_crud``.
    """
    from . import state  # noqa: PLC0415
    from .db import get_db  # noqa: PLC0415
    from .elo_store import delete_tournament_elos  # noqa: PLC0415
    from .routes_admin_players import (  # noqa: PLC0415
        _purge_profile_record,
        list_ghost_profiles_for_tournament,
    )

    # Ghost ids must be collected while player_secrets rows still exist.
    ghost_ids = [g["id"] for g in list_ghost_profiles_for_tournament(tid)]
    state._tournaments.pop(tid, None)
    state._delete_tournament(tid)
    delete_tournament_elos(tid)
    with get_db() as conn:
        conn.execute(
            "DELETE FROM player_history WHERE entity_type = 'tournament' AND entity_id = ?",
            (tid,),
        )
        for gid in ghost_ids:
            row = conn.execute(
                "SELECT 1 FROM player_profiles WHERE id = ? AND is_ghost = 1",
                (gid,),
            ).fetchone()
            if row is not None:
                _purge_profile_record(conn, gid, is_ghost=True)


def _purge_user_registrations_blocking(username: str) -> int:
    """Remove registration lobbies owned by *username* (defensive — demo users can't create them)."""
    from .db import get_db  # noqa: PLC0415

    with get_db() as conn:
        rids = [r["id"] for r in conn.execute("SELECT id FROM registrations WHERE owner = ?", (username,)).fetchall()]
        for rid in rids:
            conn.execute("DELETE FROM registrants WHERE registration_id = ?", (rid,))
            conn.execute("DELETE FROM registration_shares WHERE registration_id = ?", (rid,))
            conn.execute("DELETE FROM registrations WHERE id = ?", (rid,))
    return len(rids)


async def purge_expired_demo_data(now: datetime | None = None) -> dict[str, int]:
    """Delete every expired demo account together with all data it created.

    Only tournaments whose ``owner`` is an expired demo username are touched.
    Returns counts for logging/tests.
    """
    from . import state  # noqa: PLC0415
    from ..auth.store import user_store  # noqa: PLC0415

    usernames = _expired_demo_usernames(now)
    tournaments_purged = 0
    for username in usernames:
        owned = [tid for tid, data in state._tournaments.items() if data.get("owner") == username]
        for tid in owned:
            async with state.get_tournament_lock(tid):
                if tid not in state._tournaments:
                    continue
                await asyncio.to_thread(_purge_tournament_blocking, tid)
                tournaments_purged += 1
        await asyncio.to_thread(_purge_user_registrations_blocking, username)
        try:
            user_store.delete_user(username)
        except KeyError:
            pass
    if usernames:
        log.info(
            "Demo purge: removed %d expired account(s) and %d tournament(s)",
            len(usernames),
            tournaments_purged,
        )
    return {"users": len(usernames), "tournaments": tournaments_purged}


async def _demo_purge_loop(interval_hours: float) -> None:
    """Run a purge sweep immediately (startup sweep), then on the interval."""
    interval_secs = interval_hours * 3600
    while True:
        try:
            await purge_expired_demo_data()
        except Exception as exc:  # noqa: BLE001
            log.error("Demo purge failed: %s", exc)
        await asyncio.sleep(interval_secs)


def start_demo_purge_scheduler(interval_hours: float | None = None) -> None:
    """Start the background demo purge task (no-op if already running)."""
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        return
    hours = interval_hours if interval_hours is not None else config.DEMO_PURGE_INTERVAL_HOURS
    _scheduler_task = asyncio.create_task(
        _demo_purge_loop(hours),
        name="demo-purge-scheduler",
    )
    log.info(
        "Demo purge scheduler started (ttl=%.1fd, interval=%.1fh)",
        config.DEMO_TTL_DAYS,
        hours,
    )


def shutdown_demo_purge_scheduler() -> None:
    """Cancel the background demo purge task (safe when never started)."""
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        _scheduler_task.cancel()
        log.info("Demo purge scheduler stopped")
    _scheduler_task = None
