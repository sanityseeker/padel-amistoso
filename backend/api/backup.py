"""
Automatic SQLite backup scheduler.

Creates a timestamped copy of ``padel.db`` once per configurable interval
(default: every 24 hours) using SQLite's built-in online backup API, which
is safe for WAL-mode databases and does not require any write lock.

Env vars
--------
AMISTOSO_BACKUP_INTERVAL_HOURS  How often to run a backup (default: 24).
AMISTOSO_BACKUP_KEEP            How many backups to keep; oldest are pruned
                                first (default: 7).
AMISTOSO_BACKUP_DIR             Directory for backup files.  Defaults to
                                ``<DATA_DIR>/backups/``.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from .db import DB_PATH
from ..config import DATA_DIR

log = logging.getLogger(__name__)

_BACKUP_DIR: Path = Path(os.environ.get("AMISTOSO_BACKUP_DIR", DATA_DIR / "backups"))
_BACKUP_INTERVAL_HOURS: float = float(os.environ.get("AMISTOSO_BACKUP_INTERVAL_HOURS", "24"))
_BACKUP_KEEP: int = int(os.environ.get("AMISTOSO_BACKUP_KEEP", "7"))

_scheduler_task: asyncio.Task | None = None


def backup_db(backup_dir: Path = _BACKUP_DIR) -> Path:
    """Create a point-in-time copy of the database.

    Uses ``sqlite3.Connection.backup()`` so it works safely with WAL mode
    and concurrent readers/writers.

    Args:
        backup_dir: Directory where the backup file will be written.

    Returns:
        Path to the newly created backup file.
    """
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(tz=timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest = backup_dir / f"padel_{timestamp}.db"
    # Avoid clobbering an existing backup if two runs land in the same second.
    suffix = 1
    while dest.exists():
        dest = backup_dir / f"padel_{timestamp}_{suffix}.db"
        suffix += 1

    with sqlite3.connect(DB_PATH) as src, sqlite3.connect(dest) as dst:
        src.backup(dst)

    log.info("Database backed up to %s", dest)
    return dest


def prune_old_backups(backup_dir: Path = _BACKUP_DIR, keep: int = _BACKUP_KEEP) -> list[Path]:
    """Remove the oldest backup files, keeping only *keep* most recent ones.

    Args:
        backup_dir: Directory containing backup files.
        keep: Number of most-recent backups to retain.

    Returns:
        List of deleted backup paths.
    """
    if not backup_dir.exists():
        return []

    backups = sorted(backup_dir.glob("padel_*.db"))
    to_delete = backups[: max(0, len(backups) - keep)]

    for path in to_delete:
        try:
            path.unlink()
            log.info("Pruned old backup: %s", path)
        except OSError as exc:
            log.warning("Could not delete backup %s: %s", path, exc)

    return to_delete


async def _run_backup_cycle(backup_dir: Path, keep: int) -> None:
    """Run a backup + prune cycle off the event loop thread."""
    await asyncio.to_thread(backup_db, backup_dir)
    await asyncio.to_thread(prune_old_backups, backup_dir, keep)


async def _backup_loop(interval_hours: float, keep: int, backup_dir: Path) -> None:
    """Async loop that runs backup + prune on the given interval."""
    interval_secs = interval_hours * 3600
    while True:
        await asyncio.sleep(interval_secs)
        try:
            await _run_backup_cycle(backup_dir, keep)
        except Exception as exc:  # noqa: BLE001
            log.error("Scheduled backup failed: %s", exc)


def start_backup_scheduler(
    interval_hours: float = _BACKUP_INTERVAL_HOURS,
    keep: int = _BACKUP_KEEP,
    backup_dir: Path = _BACKUP_DIR,
) -> None:
    """Start the background backup scheduler task.

    Safe to call multiple times — a second call is a no-op if a scheduler
    is already running.

    Args:
        interval_hours: Backup frequency in hours.
        keep: Number of backups to retain.
        backup_dir: Directory for backup files.
    """
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        return
    _scheduler_task = asyncio.create_task(
        _backup_loop(interval_hours, keep, backup_dir),
        name="db-backup-scheduler",
    )
    log.info(
        "DB backup scheduler started (interval=%.1fh, keep=%d, dir=%s)",
        interval_hours,
        keep,
        backup_dir,
    )


def shutdown_backup_scheduler() -> None:
    """Cancel the background backup scheduler task."""
    global _scheduler_task
    if _scheduler_task is not None and not _scheduler_task.done():
        _scheduler_task.cancel()
        log.info("DB backup scheduler stopped")
    _scheduler_task = None
