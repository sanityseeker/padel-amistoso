"""
SQLite database bootstrap for the backend.

All tables live in a single ``padel.db`` file under the configured DATA_DIR.
WAL mode is enabled for better concurrent-read performance — multiple readers
can proceed in parallel while a write is in progress.

Schema overview
---------------
tournaments
    Each row is one tournament.  The Python tournament object is stored as a
    pickle BLOB so we preserve the full domain model without a complex ORM
    mapping.  Scalar metadata (name, owner, alias, …) are real columns so
    they can be queried/filtered cheaply.

meta
    Key/value table for process-global counters (e.g. the tournament ID
    sequence number).

users
    One row per registered user.  Passwords are always stored as bcrypt
    hashes — never plaintext.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Generator
from contextlib import contextmanager

from ..config import DATA_DIR

DB_PATH = DATA_DIR / "padel.db"

_DDL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tournaments (
    id               TEXT    PRIMARY KEY,
    name             TEXT    NOT NULL,
    type             TEXT    NOT NULL,
    owner            TEXT    NOT NULL,
    public           INTEGER NOT NULL DEFAULT 1,
    alias            TEXT,
    tv_settings      TEXT,
    tournament_blob  BLOB    NOT NULL,
    version          INTEGER NOT NULL DEFAULT 0,
    sport            TEXT    NOT NULL DEFAULT 'padel'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_alias
    ON tournaments (alias) WHERE alias IS NOT NULL;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT    PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    username      TEXT    PRIMARY KEY,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL DEFAULT 'user',
    disabled      INTEGER NOT NULL DEFAULT 0
);
"""


def init_db() -> None:
    """Create tables and enable WAL mode.

    Idempotent — safe to call on every startup.  Creates the data directory if
    it does not exist yet.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.executescript(_DDL)
        # Migrate: add sport column if missing (existing DBs before multi-sport)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tournaments)").fetchall()}
        if "sport" not in cols:
            conn.execute("ALTER TABLE tournaments ADD COLUMN sport TEXT NOT NULL DEFAULT 'padel'")


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Yield an open SQLite connection; commit on success, rollback on error.

    WAL mode is re-asserted on every connection so new connections created
    before the first ``init_db()`` call (e.g. in tests) still work correctly.

    Usage::

        with get_db() as conn:
            conn.execute("INSERT INTO …", (…,))
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
