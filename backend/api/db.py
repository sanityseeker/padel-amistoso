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

import os
import sqlite3
import threading
from collections.abc import Generator
from contextlib import contextmanager

from ..config import DATA_DIR
from ..models import QuestionType

import json

DB_PATH = DATA_DIR / "padel.db"
SQLITE_TIMEOUT_SECS = float(os.environ.get("PADEL_SQLITE_TIMEOUT_SECS", "15"))
SQLITE_BUSY_TIMEOUT_MS = int(os.environ.get("PADEL_SQLITE_BUSY_TIMEOUT_MS", "15000"))
SQLITE_SYNCHRONOUS = os.environ.get("PADEL_SQLITE_SYNCHRONOUS", "NORMAL").upper()

_VALID_SYNCHRONOUS_LEVELS = {"OFF", "NORMAL", "FULL", "EXTRA"}

_DDL = """
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
    disabled      INTEGER NOT NULL DEFAULT 0,
    email         TEXT
);

CREATE TABLE IF NOT EXISTS pending_auth_tokens (
    token_hash   TEXT    PRIMARY KEY,
    email        TEXT    NOT NULL,
    token_type   TEXT    NOT NULL,
    role         TEXT,
    expires_at   REAL    NOT NULL,
    used_at      REAL
);

CREATE INDEX IF NOT EXISTS idx_pat_email
    ON pending_auth_tokens (email);

CREATE TABLE IF NOT EXISTS tournament_shares (
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    username      TEXT NOT NULL,
    PRIMARY KEY (tournament_id, username)
);

CREATE INDEX IF NOT EXISTS idx_tournament_shares_tid
    ON tournament_shares (tournament_id);

CREATE INDEX IF NOT EXISTS idx_tournament_shares_username
    ON tournament_shares (username);

CREATE TABLE IF NOT EXISTS player_secrets (
    tournament_id TEXT    NOT NULL,
    player_id     TEXT    NOT NULL,
    player_name   TEXT    NOT NULL DEFAULT '',
    passphrase    TEXT    NOT NULL,
    token         TEXT    NOT NULL,
    contact       TEXT    NOT NULL DEFAULT '',
    email         TEXT    NOT NULL DEFAULT '',
    PRIMARY KEY (tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_ps_tournament
    ON player_secrets (tournament_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ps_token
    ON player_secrets (token);

CREATE TABLE IF NOT EXISTS registrations (
    id                TEXT    PRIMARY KEY,
    name              TEXT    NOT NULL,
    owner             TEXT    NOT NULL,
    open              INTEGER NOT NULL DEFAULT 1,
    join_code         TEXT,
    questions         TEXT,
    description       TEXT,
    message           TEXT,
    alias             TEXT    UNIQUE,
    converted_to_tid  TEXT,
    converted_to_tids TEXT    NOT NULL DEFAULT '[]',
    listed            INTEGER NOT NULL DEFAULT 0,
    archived          INTEGER NOT NULL DEFAULT 0,
    sport             TEXT    NOT NULL DEFAULT 'padel',
    auto_send_email   INTEGER NOT NULL DEFAULT 0,
    email_requirement TEXT    NOT NULL DEFAULT 'optional',
    created_at        TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS registrants (
    registration_id TEXT    NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    player_id       TEXT    NOT NULL,
    player_name     TEXT    NOT NULL,
    passphrase      TEXT    NOT NULL,
    token           TEXT    NOT NULL,
    answers         TEXT,
    email           TEXT    NOT NULL DEFAULT '',
    registered_at   TEXT    NOT NULL,
    PRIMARY KEY (registration_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_reg_registrants
    ON registrants (registration_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_token
    ON registrants (token);

CREATE TABLE IF NOT EXISTS registration_shares (
    registration_id TEXT NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
    username        TEXT NOT NULL,
    PRIMARY KEY (registration_id, username)
);

CREATE INDEX IF NOT EXISTS idx_registration_shares_rid
    ON registration_shares (registration_id);

CREATE INDEX IF NOT EXISTS idx_registration_shares_username
    ON registration_shares (username);

CREATE TABLE IF NOT EXISTS player_profiles (
    id          TEXT PRIMARY KEY,
    passphrase  TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    email_verified_at TEXT,
    contact     TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_player_profiles_passphrase
    ON player_profiles (passphrase);

CREATE TABLE IF NOT EXISTS player_history (
    profile_id      TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       TEXT NOT NULL,
    entity_name     TEXT NOT NULL DEFAULT '',
    player_id       TEXT NOT NULL,
    player_name     TEXT NOT NULL DEFAULT '',
    finished_at     TEXT NOT NULL,
    rank            INTEGER,
    total_players   INTEGER,
    wins            INTEGER NOT NULL DEFAULT 0,
    losses          INTEGER NOT NULL DEFAULT 0,
    draws           INTEGER NOT NULL DEFAULT 0,
    points_for      INTEGER NOT NULL DEFAULT 0,
    points_against  INTEGER NOT NULL DEFAULT 0,
    sport           TEXT    NOT NULL DEFAULT 'padel',
    top_partners    TEXT,
    top_rivals      TEXT,
    all_partners    TEXT,
    all_rivals      TEXT,
    PRIMARY KEY (profile_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_player_history_profile
    ON player_history (profile_id);

CREATE TABLE IF NOT EXISTS player_tournament_path_cache (
    profile_id         TEXT    NOT NULL,
    entity_id          TEXT    NOT NULL,
    player_id          TEXT    NOT NULL,
    tournament_version INTEGER NOT NULL,
    payload            TEXT    NOT NULL,
    updated_at         TEXT    NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (profile_id, entity_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_path_cache_profile
    ON player_tournament_path_cache (profile_id);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    tournament_id      TEXT NOT NULL,
    player_id          TEXT NOT NULL,
    endpoint           TEXT NOT NULL,
    subscription_json   TEXT NOT NULL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tournament_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_push_sub_tid
    ON push_subscriptions (tournament_id);

CREATE INDEX IF NOT EXISTS idx_push_sub_endpoint
    ON push_subscriptions (endpoint);
"""


def _normalized_synchronous_level(level: str) -> str:
    if level in _VALID_SYNCHRONOUS_LEVELS:
        return level
    return "NORMAL"


def _configure_connection(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(f"PRAGMA busy_timeout = {SQLITE_BUSY_TIMEOUT_MS}")
    conn.execute(f"PRAGMA synchronous = {_normalized_synchronous_level(SQLITE_SYNCHRONOUS)}")


def init_db() -> None:
    """Create tables and enable WAL mode.

    Idempotent — safe to call on every startup.  Creates the data directory if
    it does not exist yet.
    """
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH, timeout=SQLITE_TIMEOUT_SECS) as conn:
        _configure_connection(conn)
        conn.executescript(_DDL)
        # Migrate: add sport column if missing (existing DBs before multi-sport)
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tournaments)").fetchall()}
        if "sport" not in cols:
            conn.execute("ALTER TABLE tournaments ADD COLUMN sport TEXT NOT NULL DEFAULT 'padel'")
        if "assign_courts" not in cols:
            conn.execute("ALTER TABLE tournaments ADD COLUMN assign_courts INTEGER NOT NULL DEFAULT 1")
        if "email_settings" not in cols:
            conn.execute("ALTER TABLE tournaments ADD COLUMN email_settings TEXT")
        # Migrate: add contact column to player_secrets if missing
        ps_cols = {r[1] for r in conn.execute("PRAGMA table_info(player_secrets)").fetchall()}
        if ps_cols and "contact" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN contact TEXT NOT NULL DEFAULT ''")
        if ps_cols and "email" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN email TEXT NOT NULL DEFAULT ''")
        # Migrate: add registration columns if missing (existing DBs before lobby features)
        reg_cols = {r[1] for r in conn.execute("PRAGMA table_info(registrations)").fetchall()}
        if reg_cols:  # table exists
            for col in ("description", "message", "converted_to_tid", "alias"):
                if col not in reg_cols:
                    conn.execute(f"ALTER TABLE registrations ADD COLUMN {col} TEXT")
            if "listed" not in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN listed INTEGER NOT NULL DEFAULT 0")
            if "archived" not in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0")
            if "sport" not in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN sport TEXT NOT NULL DEFAULT 'padel'")
            if "auto_send_email" not in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN auto_send_email INTEGER NOT NULL DEFAULT 0")
            if "email_requirement" not in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN email_requirement TEXT NOT NULL DEFAULT 'optional'")
            if "email_settings" not in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN email_settings TEXT")
            if "converted_to_tids" not in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN converted_to_tids TEXT NOT NULL DEFAULT '[]'")
                # Back-fill from the legacy single converted_to_tid column
                rows = conn.execute(
                    "SELECT id, converted_to_tid FROM registrations WHERE converted_to_tid IS NOT NULL"
                ).fetchall()
                for row in rows:
                    conn.execute(
                        "UPDATE registrations SET converted_to_tids = ? WHERE id = ?",
                        (json.dumps([row[1]]), row[0]),
                    )
            # Migrate level_type/level_label/level_required → questions JSON
            if "questions" not in reg_cols and "level_type" in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN questions TEXT")
                rows = conn.execute("SELECT id, level_type, level_label, level_required FROM registrations").fetchall()
                for row in rows:
                    rid, ltype, llabel, lreq = row
                    if ltype:
                        q = {
                            "key": "level",
                            "label": llabel or "Level",
                            "type": QuestionType.CHOICE if ltype == "category" else QuestionType.TEXT,
                            "required": bool(lreq),
                            "choices": [],
                        }
                        conn.execute(
                            "UPDATE registrations SET questions = ? WHERE id = ?",
                            (json.dumps([q]), rid),
                        )
            elif "questions" not in reg_cols:
                conn.execute("ALTER TABLE registrations ADD COLUMN questions TEXT")
        # Migrate: create tournament_shares table if missing (existing DBs before sharing feature)
        share_tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "tournament_shares" not in share_tables:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS tournament_shares (
                    tournament_id TEXT NOT NULL,
                    username      TEXT NOT NULL,
                    PRIMARY KEY (tournament_id, username)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tournament_shares_tid ON tournament_shares (tournament_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tournament_shares_username ON tournament_shares (username)")
        # Migrate: create registration_shares table if missing
        if "registration_shares" not in share_tables:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS registration_shares (
                    registration_id TEXT NOT NULL,
                    username        TEXT NOT NULL,
                    PRIMARY KEY (registration_id, username)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_registration_shares_rid ON registration_shares (registration_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_registration_shares_username ON registration_shares (username)"
            )
        # Migrate registrants: level → answers JSON
        rnt_cols = {r[1] for r in conn.execute("PRAGMA table_info(registrants)").fetchall()}
        if rnt_cols:
            if "answers" not in rnt_cols and "level" in rnt_cols:
                conn.execute("ALTER TABLE registrants ADD COLUMN answers TEXT")
                rows = conn.execute("SELECT registration_id, player_id, level FROM registrants").fetchall()
                for row in rows:
                    reg_id, pid, level = row
                    if level:
                        conn.execute(
                            "UPDATE registrants SET answers = ? WHERE registration_id = ? AND player_id = ?",
                            (json.dumps({"level": level}), reg_id, pid),
                        )
            elif "answers" not in rnt_cols:
                conn.execute("ALTER TABLE registrants ADD COLUMN answers TEXT")
            if "email" not in rnt_cols:
                conn.execute("ALTER TABLE registrants ADD COLUMN email TEXT NOT NULL DEFAULT ''")
            if "profile_id" not in rnt_cols:
                conn.execute("ALTER TABLE registrants ADD COLUMN profile_id TEXT")
        # Migrate: add contact column to player_profiles if missing
        pp_cols = {r[1] for r in conn.execute("PRAGMA table_info(player_profiles)").fetchall()}
        if pp_cols and "contact" not in pp_cols:
            conn.execute("ALTER TABLE player_profiles ADD COLUMN contact TEXT NOT NULL DEFAULT ''")
        if pp_cols and "email_verified_at" not in pp_cols:
            conn.execute("ALTER TABLE player_profiles ADD COLUMN email_verified_at TEXT")
        # Migrate: add profile_id to player_secrets if missing
        if ps_cols and "profile_id" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN profile_id TEXT")
        # Migrate: keep finished secrets for 30 days so players can still claim them;
        # stats columns store the result snapshot so backfill works even after restart.
        if ps_cols and "finished_at" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN finished_at TEXT")
        if ps_cols and "tournament_name" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN tournament_name TEXT NOT NULL DEFAULT ''")
        if ps_cols and "finished_sport" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN finished_sport TEXT NOT NULL DEFAULT 'padel'")
        if ps_cols and "finished_stats" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN finished_stats TEXT")
        if ps_cols and "finished_top_partners" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN finished_top_partners TEXT")
        if ps_cols and "finished_top_rivals" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN finished_top_rivals TEXT")
        if ps_cols and "finished_all_partners" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN finished_all_partners TEXT")
        if ps_cols and "finished_all_rivals" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN finished_all_rivals TEXT")
        # Migrate: add stats columns to player_history if missing
        ph_cols = {r[1] for r in conn.execute("PRAGMA table_info(player_history)").fetchall()}
        if ph_cols:
            for col, ddl in [
                ("entity_name", "ALTER TABLE player_history ADD COLUMN entity_name TEXT NOT NULL DEFAULT ''"),
                ("rank", "ALTER TABLE player_history ADD COLUMN rank INTEGER"),
                ("total_players", "ALTER TABLE player_history ADD COLUMN total_players INTEGER"),
                ("wins", "ALTER TABLE player_history ADD COLUMN wins INTEGER NOT NULL DEFAULT 0"),
                ("losses", "ALTER TABLE player_history ADD COLUMN losses INTEGER NOT NULL DEFAULT 0"),
                ("draws", "ALTER TABLE player_history ADD COLUMN draws INTEGER NOT NULL DEFAULT 0"),
                ("points_for", "ALTER TABLE player_history ADD COLUMN points_for INTEGER NOT NULL DEFAULT 0"),
                ("points_against", "ALTER TABLE player_history ADD COLUMN points_against INTEGER NOT NULL DEFAULT 0"),
                ("sport", "ALTER TABLE player_history ADD COLUMN sport TEXT NOT NULL DEFAULT 'padel'"),
                ("top_partners", "ALTER TABLE player_history ADD COLUMN top_partners TEXT"),
                ("top_rivals", "ALTER TABLE player_history ADD COLUMN top_rivals TEXT"),
                ("all_partners", "ALTER TABLE player_history ADD COLUMN all_partners TEXT"),
                ("all_rivals", "ALTER TABLE player_history ADD COLUMN all_rivals TEXT"),
            ]:
                if col not in ph_cols:
                    conn.execute(ddl)


# ── Co-editor / sharing helpers ─────────────────────────────────────────────

# In-memory caches — populated on first access, invalidated on writes.
# Eliminates a SQLite round-trip on every _require_editor_access() call.
_co_editor_cache: dict[str, list[str]] = {}
_reg_co_editor_cache: dict[str, list[str]] = {}


def get_co_editors(tournament_id: str) -> list[str]:
    """Return a list of usernames that have co-editor access to *tournament_id*.

    Results are cached in memory; the cache is invalidated by
    ``add_co_editor`` / ``remove_co_editor``.
    """
    cached = _co_editor_cache.get(tournament_id)
    if cached is not None:
        return cached
    with get_db() as conn:
        rows = conn.execute(
            "SELECT username FROM tournament_shares WHERE tournament_id = ? ORDER BY username",
            (tournament_id,),
        ).fetchall()
    result = [row["username"] for row in rows]
    _co_editor_cache[tournament_id] = result
    return result


def invalidate_co_editor_cache(tournament_id: str) -> None:
    """Drop the cached co-editor list for *tournament_id*."""
    _co_editor_cache.pop(tournament_id, None)


def get_shared_tournament_ids(username: str) -> list[str]:
    """Return tournament IDs where *username* has been granted co-editor access."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT tournament_id FROM tournament_shares WHERE username = ?",
            (username,),
        ).fetchall()
    return [row["tournament_id"] for row in rows]


def add_co_editor(tournament_id: str, username: str) -> None:
    """Grant *username* co-editor access to *tournament_id* (idempotent).

    Invalidates the in-memory cache for this tournament.
    """
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO tournament_shares (tournament_id, username) VALUES (?, ?)",
            (tournament_id, username),
        )
    invalidate_co_editor_cache(tournament_id)


def remove_co_editor(tournament_id: str, username: str) -> None:
    """Revoke co-editor access for *username* on *tournament_id*.

    Invalidates the in-memory cache for this tournament.
    """
    with get_db() as conn:
        conn.execute(
            "DELETE FROM tournament_shares WHERE tournament_id = ? AND username = ?",
            (tournament_id, username),
        )
    invalidate_co_editor_cache(tournament_id)


# ── Registration co-editor / sharing helpers ─────────────────────────────────


def get_registration_co_editors(registration_id: str) -> list[str]:
    """Return a list of usernames that have co-editor access to *registration_id*.

    Results are cached in memory; the cache is invalidated by
    ``add_registration_co_editor`` / ``remove_registration_co_editor``.
    """
    cached = _reg_co_editor_cache.get(registration_id)
    if cached is not None:
        return cached
    with get_db() as conn:
        rows = conn.execute(
            "SELECT username FROM registration_shares WHERE registration_id = ? ORDER BY username",
            (registration_id,),
        ).fetchall()
    result = [row["username"] for row in rows]
    _reg_co_editor_cache[registration_id] = result
    return result


def invalidate_reg_co_editor_cache(registration_id: str) -> None:
    """Drop the cached co-editor list for *registration_id*."""
    _reg_co_editor_cache.pop(registration_id, None)


def get_shared_registration_ids(username: str) -> list[str]:
    """Return registration IDs where *username* has been granted co-editor access."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT registration_id FROM registration_shares WHERE username = ?",
            (username,),
        ).fetchall()
    return [row["registration_id"] for row in rows]


def add_registration_co_editor(registration_id: str, username: str) -> None:
    """Grant *username* co-editor access to *registration_id* (idempotent).

    Invalidates the in-memory cache for this registration.
    """
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO registration_shares (registration_id, username) VALUES (?, ?)",
            (registration_id, username),
        )
    invalidate_reg_co_editor_cache(registration_id)


def remove_registration_co_editor(registration_id: str, username: str) -> None:
    """Revoke co-editor access for *username* on *registration_id*.

    Invalidates the in-memory cache for this registration.
    """
    with get_db() as conn:
        conn.execute(
            "DELETE FROM registration_shares WHERE registration_id = ? AND username = ?",
            (registration_id, username),
        )
    invalidate_reg_co_editor_cache(registration_id)


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Yield an open SQLite connection; commit on success, rollback on error.

    Connections are cached in a thread-local so PRAGMAs (WAL, foreign_keys,
    busy_timeout, synchronous) are only run once per thread instead of on
    every call.  The cached connection is automatically invalidated when
    ``DB_PATH`` changes (e.g. between tests) or after a connection error.

    Usage::

        with get_db() as conn:
            conn.execute("INSERT INTO …", (…,))
    """
    conn = _get_thread_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


# ── Thread-local connection pool ─────────────────────────────────────────────

_thread_local = threading.local()


def _get_thread_connection() -> sqlite3.Connection:
    """Return the thread-local SQLite connection, creating it if needed."""
    db_path = str(DB_PATH)
    conn: sqlite3.Connection | None = getattr(_thread_local, "conn", None)
    cached_path: str | None = getattr(_thread_local, "conn_path", None)
    if conn is not None and cached_path == db_path:
        return conn
    # Close stale connection if DB_PATH changed (e.g. between tests).
    if conn is not None:
        try:
            conn.close()
        except sqlite3.Error:
            pass
    conn = sqlite3.connect(db_path, timeout=SQLITE_TIMEOUT_SECS)
    conn.row_factory = sqlite3.Row
    _configure_connection(conn)
    _thread_local.conn = conn
    _thread_local.conn_path = db_path
    return conn


def close_thread_db() -> None:
    """Close and discard the thread-local connection (if any).

    Call this during test teardown or when shutting down a thread pool to
    avoid leaked file handles.
    """
    conn: sqlite3.Connection | None = getattr(_thread_local, "conn", None)
    if conn is not None:
        try:
            conn.close()
        except sqlite3.Error:
            pass
    _thread_local.conn = None
    _thread_local.conn_path = None
