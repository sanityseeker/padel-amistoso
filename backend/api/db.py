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
CREATE TABLE IF NOT EXISTS communities (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    created_by  TEXT,
    created_at  TEXT NOT NULL
);

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
    sport            TEXT    NOT NULL DEFAULT 'padel',
    community_id     TEXT    NOT NULL DEFAULT 'open' REFERENCES communities(id),
    created_at       TEXT    NOT NULL DEFAULT '',
    season_id        TEXT,
    club_id          TEXT    REFERENCES clubs(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tournaments_alias
    ON tournaments (alias) WHERE alias IS NOT NULL;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT    PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
    username             TEXT    PRIMARY KEY,
    password_hash        TEXT    NOT NULL,
    role                 TEXT    NOT NULL DEFAULT 'user',
    disabled             INTEGER NOT NULL DEFAULT 0,
    email                TEXT,
    default_community_id TEXT    NOT NULL DEFAULT 'open'
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
    community_id      TEXT    NOT NULL DEFAULT 'open' REFERENCES communities(id),
    club_id           TEXT    REFERENCES clubs(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS player_elo (
    tournament_id   TEXT    NOT NULL,
    player_id       TEXT    NOT NULL,
    sport           TEXT    NOT NULL DEFAULT 'padel',
    elo_before      REAL    NOT NULL,
    elo_after       REAL    NOT NULL,
    matches_played  INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT    NOT NULL,
    PRIMARY KEY (tournament_id, player_id, sport)
);

CREATE INDEX IF NOT EXISTS idx_player_elo_player
    ON player_elo (player_id, sport);

CREATE INDEX IF NOT EXISTS idx_player_elo_tournament
    ON player_elo (tournament_id);

CREATE TABLE IF NOT EXISTS player_elo_log (
    tournament_id   TEXT    NOT NULL,
    sport           TEXT    NOT NULL DEFAULT 'padel',
    match_id        TEXT    NOT NULL,
    player_id       TEXT    NOT NULL,
    match_order     INTEGER NOT NULL DEFAULT 0,
    elo_before      REAL    NOT NULL,
    elo_after       REAL    NOT NULL,
    elo_delta       REAL    NOT NULL,
    match_payload   TEXT    NOT NULL,
    updated_at      TEXT    NOT NULL,
    PRIMARY KEY (tournament_id, sport, match_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_player_elo_log_player
    ON player_elo_log (player_id, sport, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_player_elo_log_tournament
    ON player_elo_log (tournament_id, sport, updated_at DESC);

CREATE TABLE IF NOT EXISTS profile_community_elo (
    profile_id    TEXT NOT NULL,
    community_id  TEXT NOT NULL DEFAULT 'open',
    sport         TEXT NOT NULL DEFAULT 'padel',
    elo           REAL NOT NULL DEFAULT 1000,
    matches       INTEGER NOT NULL DEFAULT 0,
    tier_id       TEXT,
    PRIMARY KEY (profile_id, community_id, sport)
);

CREATE INDEX IF NOT EXISTS idx_profile_community_elo_community
    ON profile_community_elo (community_id, sport);

CREATE TABLE IF NOT EXISTS clubs (
    id             TEXT PRIMARY KEY,
    community_id   TEXT NOT NULL REFERENCES communities(id),
    name           TEXT NOT NULL,
    logo_path      TEXT,
    email_settings TEXT,
    created_by     TEXT NOT NULL,
    created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clubs_community_id
    ON clubs (community_id);

CREATE TABLE IF NOT EXISTS profile_club_elo (
    profile_id  TEXT    NOT NULL,
    club_id     TEXT    NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    sport       TEXT    NOT NULL DEFAULT 'padel',
    elo         REAL    NOT NULL DEFAULT 1000,
    matches     INTEGER NOT NULL DEFAULT 0,
    tier_id     TEXT,
    hidden      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (profile_id, club_id, sport)
);

CREATE INDEX IF NOT EXISTS idx_profile_club_elo_club
    ON profile_club_elo (club_id, sport);

CREATE INDEX IF NOT EXISTS idx_profile_club_elo_profile
    ON profile_club_elo (profile_id, sport);

CREATE TABLE IF NOT EXISTS club_shares (
    club_id  TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    PRIMARY KEY (club_id, username)
);

CREATE INDEX IF NOT EXISTS idx_club_shares_club
    ON club_shares (club_id);

CREATE INDEX IF NOT EXISTS idx_club_shares_username
    ON club_shares (username);

CREATE TABLE IF NOT EXISTS club_tiers (
    id       TEXT PRIMARY KEY,
    club_id  TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    name     TEXT NOT NULL,
    sport    TEXT NOT NULL DEFAULT 'padel',
    base_elo REAL NOT NULL DEFAULT 1000,
    position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_club_tiers_club
    ON club_tiers (club_id);

CREATE TABLE IF NOT EXISTS seasons (
    id                TEXT PRIMARY KEY,
    club_id           TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    name              TEXT NOT NULL,
    active            INTEGER NOT NULL DEFAULT 1,
    created_at        TEXT NOT NULL,
    frozen_standings  TEXT,
    archived_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_seasons_club
    ON seasons (club_id);
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
                ("elo_before", "ALTER TABLE player_history ADD COLUMN elo_before REAL"),
                ("elo_after", "ALTER TABLE player_history ADD COLUMN elo_after REAL"),
            ]:
                if col not in ph_cols:
                    conn.execute(ddl)
        # Migrate: add ELO columns to player_profiles if missing
        if pp_cols:
            for col, ddl in [
                ("elo_padel", "ALTER TABLE player_profiles ADD COLUMN elo_padel REAL NOT NULL DEFAULT 1000"),
                ("elo_tennis", "ALTER TABLE player_profiles ADD COLUMN elo_tennis REAL NOT NULL DEFAULT 1000"),
                (
                    "elo_padel_matches",
                    "ALTER TABLE player_profiles ADD COLUMN elo_padel_matches INTEGER NOT NULL DEFAULT 0",
                ),
                (
                    "elo_tennis_matches",
                    "ALTER TABLE player_profiles ADD COLUMN elo_tennis_matches INTEGER NOT NULL DEFAULT 0",
                ),
                ("k_factor_override", "ALTER TABLE player_profiles ADD COLUMN k_factor_override INTEGER"),
            ]:
                if col not in pp_cols:
                    conn.execute(ddl)
        # Migrate: add lang column to registrants, player_secrets, player_profiles
        if rnt_cols and "lang" not in rnt_cols:
            conn.execute("ALTER TABLE registrants ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'")
        if ps_cols and "lang" not in ps_cols:
            conn.execute("ALTER TABLE player_secrets ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'")
        if pp_cols and "lang" not in pp_cols:
            conn.execute("ALTER TABLE player_profiles ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'")
        # Migrate: seed the default 'open' community and add community_id to tournaments
        existing_tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "communities" in existing_tables:
            open_row = conn.execute("SELECT 1 FROM communities WHERE id = 'open'").fetchone()
            if open_row is None:
                conn.execute(
                    "INSERT INTO communities (id, name, created_by, created_at) VALUES (?, ?, NULL, datetime('now'))",
                    ("open", "Open"),
                )
        if "community_id" not in cols:
            conn.execute("ALTER TABLE tournaments ADD COLUMN community_id TEXT NOT NULL DEFAULT 'open'")
        # Ensure index exists (safe to run always; handled here because CREATE INDEX in _DDL
        # would fail on old DBs where the column was added via migration rather than DDL)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tournaments_community ON tournaments (community_id)")
        # Migrate: add community_id to registrations if missing
        reg_cols = {r[1] for r in conn.execute("PRAGMA table_info(registrations)").fetchall()}
        if reg_cols and "community_id" not in reg_cols:
            conn.execute("ALTER TABLE registrations ADD COLUMN community_id TEXT NOT NULL DEFAULT 'open'")
        # Migrate: add default_community_id to users if missing
        user_cols = {r[1] for r in conn.execute("PRAGMA table_info(users)").fetchall()}
        if user_cols and "default_community_id" not in user_cols:
            conn.execute("ALTER TABLE users ADD COLUMN default_community_id TEXT NOT NULL DEFAULT 'open'")
        # Migrate: seed profile_community_elo from flat player_profiles ELO columns
        if "profile_community_elo" in existing_tables and pp_cols:
            pce_count = conn.execute("SELECT COUNT(*) FROM profile_community_elo").fetchone()[0]
            if pce_count == 0:
                conn.execute(
                    "INSERT OR IGNORE INTO profile_community_elo (profile_id, community_id, sport, elo, matches)"
                    " SELECT id, 'open', 'padel', elo_padel, elo_padel_matches"
                    " FROM player_profiles WHERE elo_padel_matches > 0"
                )
                conn.execute(
                    "INSERT OR IGNORE INTO profile_community_elo (profile_id, community_id, sport, elo, matches)"
                    " SELECT id, 'open', 'tennis', elo_tennis, elo_tennis_matches"
                    " FROM player_profiles WHERE elo_tennis_matches > 0"
                )
        # Migrate: add created_at and season_id to tournaments if missing
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tournaments)").fetchall()}
        if "created_at" not in cols:
            conn.execute("ALTER TABLE tournaments ADD COLUMN created_at TEXT NOT NULL DEFAULT ''")
            conn.execute("UPDATE tournaments SET created_at = datetime('now') WHERE created_at = ''")
        if "season_id" not in cols:
            conn.execute("ALTER TABLE tournaments ADD COLUMN season_id TEXT")
        # Migrate: add club_id to tournaments (denormalized from seasons.club_id so a
        # tournament can belong to a club without being attached to a specific season).
        cols = {r[1] for r in conn.execute("PRAGMA table_info(tournaments)").fetchall()}
        if "club_id" not in cols:
            conn.execute("ALTER TABLE tournaments ADD COLUMN club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_tournaments_club ON tournaments (club_id)")
        # Migrate: add season_id to registrations if missing
        reg_cols = {r[1] for r in conn.execute("PRAGMA table_info(registrations)").fetchall()}
        if reg_cols and "season_id" not in reg_cols:
            conn.execute("ALTER TABLE registrations ADD COLUMN season_id TEXT")
        # Migrate: add club_id to registrations (same rationale as tournaments).
        reg_cols = {r[1] for r in conn.execute("PRAGMA table_info(registrations)").fetchall()}
        if reg_cols and "club_id" not in reg_cols:
            conn.execute("ALTER TABLE registrations ADD COLUMN club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_registrations_club ON registrations (club_id)")
        # Backfill: derive club_id from season_id where it is set but club_id is not.
        # Safe to re-run; only updates rows that need it.
        conn.execute(
            """
            UPDATE tournaments
               SET club_id = (
                   SELECT s.club_id FROM seasons s WHERE s.id = tournaments.season_id
               )
             WHERE club_id IS NULL AND season_id IS NOT NULL
            """
        )
        conn.execute(
            """
            UPDATE registrations
               SET club_id = (
                   SELECT s.club_id FROM seasons s WHERE s.id = registrations.season_id
               )
             WHERE club_id IS NULL AND season_id IS NOT NULL
            """
        )
        # Migrate: add tier_id to profile_community_elo if missing
        pce_cols = {r[1] for r in conn.execute("PRAGMA table_info(profile_community_elo)").fetchall()}
        if pce_cols and "tier_id" not in pce_cols:
            conn.execute("ALTER TABLE profile_community_elo ADD COLUMN tier_id TEXT")
        # Migrate: add frozen_standings + archived_at to seasons (snapshot on archive)
        season_cols = {r[1] for r in conn.execute("PRAGMA table_info(seasons)").fetchall()}
        if season_cols and "frozen_standings" not in season_cols:
            conn.execute("ALTER TABLE seasons ADD COLUMN frozen_standings TEXT")
        if season_cols and "archived_at" not in season_cols:
            conn.execute("ALTER TABLE seasons ADD COLUMN archived_at TEXT")
        # Migrate: add sport + base_elo to club_tiers (replaces base_elo_padel/base_elo_tennis)
        ct_cols = {r[1] for r in conn.execute("PRAGMA table_info(club_tiers)").fetchall()}
        if ct_cols and "sport" not in ct_cols:
            conn.execute("ALTER TABLE club_tiers ADD COLUMN sport TEXT NOT NULL DEFAULT 'padel'")
        if ct_cols and "base_elo" not in ct_cols:
            # Seed from base_elo_padel if it existed, otherwise default 1000
            if "base_elo_padel" in ct_cols:
                conn.execute("ALTER TABLE club_tiers ADD COLUMN base_elo REAL NOT NULL DEFAULT 1000")
                conn.execute("UPDATE club_tiers SET base_elo = base_elo_padel")
            else:
                conn.execute("ALTER TABLE club_tiers ADD COLUMN base_elo REAL NOT NULL DEFAULT 1000")
        # Migrate: add email_settings column to clubs if missing
        club_cols = {r[1] for r in conn.execute("PRAGMA table_info(clubs)").fetchall()}
        if club_cols and "email_settings" not in club_cols:
            conn.execute("ALTER TABLE clubs ADD COLUMN email_settings TEXT")
        # Migrate: add is_ghost column to player_profiles if missing
        pp_cols2 = {r[1] for r in conn.execute("PRAGMA table_info(player_profiles)").fetchall()}
        if pp_cols2 and "is_ghost" not in pp_cols2:
            conn.execute("ALTER TABLE player_profiles ADD COLUMN is_ghost INTEGER NOT NULL DEFAULT 0")
        # Migrate: create club_shares table if missing
        all_tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "club_shares" not in all_tables:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS club_shares (
                    club_id  TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
                    username TEXT NOT NULL,
                    PRIMARY KEY (club_id, username)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_club_shares_club ON club_shares (club_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_club_shares_username ON club_shares (username)")
        # Migrate: rebuild clubs table to remove UNIQUE constraint on community_id (multi-club support)
        club_indexes = conn.execute("PRAGMA index_list('clubs')").fetchall()
        has_unique_community_id = any(
            bool(idx[2])  # column 2 = unique flag
            and any(
                info[2] == "community_id"  # column 2 = column name
                for info in conn.execute(f"PRAGMA index_info('{idx[1]}')").fetchall()
            )
            for idx in club_indexes
        )
        if has_unique_community_id:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("DROP TABLE IF EXISTS clubs_migration_new")
            conn.execute(
                """
                CREATE TABLE clubs_migration_new (
                    id             TEXT PRIMARY KEY,
                    community_id   TEXT NOT NULL REFERENCES communities(id),
                    name           TEXT NOT NULL,
                    logo_path      TEXT,
                    email_settings TEXT,
                    created_by     TEXT NOT NULL,
                    created_at     TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                INSERT INTO clubs_migration_new
                SELECT id, community_id, name, logo_path, email_settings, created_by,
                       COALESCE(created_at, datetime('now')) AS created_at
                FROM clubs
                """
            )
            conn.execute("DROP TABLE clubs")
            conn.execute("ALTER TABLE clubs_migration_new RENAME TO clubs")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_clubs_community_id ON clubs (community_id)")
            conn.execute("PRAGMA foreign_keys = ON")
        # Migrate: create profile_club_elo table if missing
        all_tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if "profile_club_elo" not in all_tables:
            conn.execute(
                """
                CREATE TABLE profile_club_elo (
                    profile_id  TEXT    NOT NULL,
                    club_id     TEXT    NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
                    sport       TEXT    NOT NULL DEFAULT 'padel',
                    elo         REAL    NOT NULL DEFAULT 1000,
                    matches     INTEGER NOT NULL DEFAULT 0,
                    tier_id     TEXT,
                    hidden      INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (profile_id, club_id, sport)
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_profile_club_elo_club ON profile_club_elo (club_id, sport)")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_profile_club_elo_profile ON profile_club_elo (profile_id, sport)"
            )

        # Migrate: add hidden column to profile_club_elo if missing
        club_elo_cols = {r[1] for r in conn.execute("PRAGMA table_info(profile_club_elo)").fetchall()}
        if "hidden" not in club_elo_cols:
            conn.execute("ALTER TABLE profile_club_elo ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")

        # Migrate: add manual adjustment tracking columns to player_elo_log if missing
        elo_log_cols = {r[1] for r in conn.execute("PRAGMA table_info(player_elo_log)").fetchall()}
        if "is_manual" not in elo_log_cols:
            conn.execute("ALTER TABLE player_elo_log ADD COLUMN is_manual INTEGER NOT NULL DEFAULT 0")
        if "adjustment_reason" not in elo_log_cols:
            conn.execute("ALTER TABLE player_elo_log ADD COLUMN adjustment_reason TEXT")
        if "adjusted_by" not in elo_log_cols:
            conn.execute("ALTER TABLE player_elo_log ADD COLUMN adjusted_by TEXT")

        if "profile_club_elo" not in all_tables:
            # Backfill existing club data: copy community ELO into club-local ELO for each existing club
            conn.execute(
                """
                INSERT OR IGNORE INTO profile_club_elo (profile_id, club_id, sport, elo, matches, tier_id)
                SELECT pce.profile_id, cl.id, pce.sport, pce.elo, pce.matches, pce.tier_id
                FROM profile_community_elo pce
                JOIN clubs cl ON cl.community_id = pce.community_id
                """
            )


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


# ── Club co-editor / sharing helpers ─────────────────────────────────────────

_club_co_editor_cache: dict[str, list[str]] = {}


def get_club_co_editors(club_id: str) -> list[str]:
    """Return a list of usernames that have co-editor access to *club_id*.

    Results are cached in memory; the cache is invalidated by
    ``add_club_co_editor`` / ``remove_club_co_editor``.
    """
    cached = _club_co_editor_cache.get(club_id)
    if cached is not None:
        return cached
    with get_db() as conn:
        rows = conn.execute(
            "SELECT username FROM club_shares WHERE club_id = ? ORDER BY username",
            (club_id,),
        ).fetchall()
    result = [row["username"] for row in rows]
    _club_co_editor_cache[club_id] = result
    return result


def invalidate_club_co_editor_cache(club_id: str) -> None:
    """Drop the cached co-editor list for *club_id*."""
    _club_co_editor_cache.pop(club_id, None)


def get_shared_club_ids(username: str) -> list[str]:
    """Return club IDs where *username* has been granted co-editor access."""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT club_id FROM club_shares WHERE username = ?",
            (username,),
        ).fetchall()
    return [row["club_id"] for row in rows]


def add_club_co_editor(club_id: str, username: str) -> None:
    """Grant *username* co-editor access to *club_id* (idempotent).

    Invalidates the in-memory cache for this club.
    """
    with get_db() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO club_shares (club_id, username) VALUES (?, ?)",
            (club_id, username),
        )
    invalidate_club_co_editor_cache(club_id)


def remove_club_co_editor(club_id: str, username: str) -> None:
    """Revoke co-editor access for *username* on *club_id*.

    Invalidates the in-memory cache for this club.
    """
    with get_db() as conn:
        conn.execute(
            "DELETE FROM club_shares WHERE club_id = ? AND username = ?",
            (club_id, username),
        )
    invalidate_club_co_editor_cache(club_id)


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
