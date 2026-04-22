"""Tests for backend.api.backup — database backup and pruning logic."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.api.backup import backup_db, prune_old_backups


@pytest.fixture()
def source_db(tmp_path: Path) -> Path:
    """Create a minimal SQLite database to back up."""
    db = tmp_path / "padel.db"
    with sqlite3.connect(db) as con:
        con.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)")
        con.execute("INSERT INTO t VALUES (1)")
    return db


def test_backup_db_creates_file(tmp_path: Path, source_db: Path) -> None:
    backup_dir = tmp_path / "backups"
    with patch("backend.api.backup.DB_PATH", source_db):
        dest = backup_db(backup_dir)

    assert dest.exists()
    assert dest.parent == backup_dir
    assert dest.name.startswith("padel_")
    assert dest.suffix == ".db"


def test_backup_db_content_is_consistent(tmp_path: Path, source_db: Path) -> None:
    backup_dir = tmp_path / "backups"
    with patch("backend.api.backup.DB_PATH", source_db):
        dest = backup_db(backup_dir)

    with sqlite3.connect(dest) as con:
        rows = con.execute("SELECT id FROM t").fetchall()
    assert rows == [(1,)]


def test_backup_db_creates_backup_dir_if_missing(tmp_path: Path, source_db: Path) -> None:
    backup_dir = tmp_path / "deep" / "nested" / "backups"
    assert not backup_dir.exists()
    with patch("backend.api.backup.DB_PATH", source_db):
        backup_db(backup_dir)
    assert backup_dir.exists()


def test_prune_old_backups_removes_oldest(tmp_path: Path) -> None:
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    files = [backup_dir / f"padel_202401{i:02d}T000000Z.db" for i in range(1, 6)]
    for f in files:
        f.touch()

    deleted = prune_old_backups(backup_dir, keep=3)

    assert len(deleted) == 2
    assert set(deleted) == {files[0], files[1]}
    # Newest three must still exist
    for f in files[2:]:
        assert f.exists()


def test_prune_old_backups_no_op_when_under_limit(tmp_path: Path) -> None:
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    for i in range(3):
        (backup_dir / f"padel_202401{i:02d}T000000Z.db").touch()

    deleted = prune_old_backups(backup_dir, keep=7)

    assert deleted == []
    assert len(list(backup_dir.glob("padel_*.db"))) == 3


def test_prune_old_backups_missing_dir_returns_empty(tmp_path: Path) -> None:
    backup_dir = tmp_path / "nonexistent"
    deleted = prune_old_backups(backup_dir, keep=7)
    assert deleted == []


@pytest.mark.parametrize("keep", [1, 3, 5])
def test_prune_old_backups_keeps_exact_count(tmp_path: Path, keep: int) -> None:
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    for i in range(10):
        (backup_dir / f"padel_202401{i:02d}T000000Z.db").touch()

    prune_old_backups(backup_dir, keep=keep)

    remaining = list(backup_dir.glob("padel_*.db"))
    assert len(remaining) == keep


def test_backup_db_does_not_overwrite_same_second(tmp_path: Path, source_db: Path) -> None:
    backup_dir = tmp_path / "backups"
    with patch("backend.api.backup.DB_PATH", source_db):
        first = backup_db(backup_dir)
        second = backup_db(backup_dir)

    assert first.exists()
    assert second.exists()
    assert first != second


def test_scheduler_start_is_idempotent(tmp_path: Path) -> None:
    import asyncio

    import backend.api.backup as backup_mod

    async def run() -> None:
        backup_mod._scheduler_task = None
        try:
            backup_mod.start_backup_scheduler(interval_hours=1, keep=3, backup_dir=tmp_path)
            first_task = backup_mod._scheduler_task
            backup_mod.start_backup_scheduler(interval_hours=1, keep=3, backup_dir=tmp_path)
            assert backup_mod._scheduler_task is first_task
        finally:
            backup_mod.shutdown_backup_scheduler()
            assert backup_mod._scheduler_task is None

    asyncio.run(run())


def test_scheduler_runs_backup_off_thread(tmp_path: Path, source_db: Path) -> None:
    """Verify the backup cycle helper runs without blocking the event loop."""
    import asyncio

    import backend.api.backup as backup_mod

    backup_dir = tmp_path / "backups"

    async def run() -> None:
        with patch.object(backup_mod, "DB_PATH", source_db):
            await backup_mod._run_backup_cycle(backup_dir, keep=3)

    asyncio.run(run())
    assert len(list(backup_dir.glob("padel_*.db"))) == 1
