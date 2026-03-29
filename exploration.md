# Padel-Amistoso — Comprehensive Codebase Exploration

> **Version**: 0.4.1 (2026-03-28)
> **Stack**: Python 3.12+, FastAPI, Pydantic v2, SQLite, Vanilla JS frontend

---

## Table of Contents

1. [Database Layer](#1-database-layer)
2. [Domain Models](#2-domain-models)
3. [Tournament Types & Lifecycle](#3-tournament-types--lifecycle)
4. [Mexicano Tournament Engine](#4-mexicano-tournament-engine)
5. [Bracket / Playoff System](#5-bracket--playoff-system)
6. [Pairing & Court Assignment Algorithms](#6-pairing--court-assignment-algorithms)
7. [API Layer](#7-api-layer)
8. [Authentication & Authorization](#8-authentication--authorization)
9. [Registration / Lobby System](#9-registration--lobby-system)
10. [Visualization (Bracket Schema)](#10-visualization-bracket-schema)
11. [Frontend Architecture](#11-frontend-architecture)
12. [Configuration & Deployment](#12-configuration--deployment)
13. [Testing](#13-testing)
14. [Notable Patterns & Concerns](#14-notable-patterns--concerns)

---

## 1. Database Layer

### 1.1 Engine

**SQLite** — single-file database stored at `<DATA_DIR>/padel.db`. No PostgreSQL, no external database service. The Docker Compose file maps `./data:/app/data` as a volume for persistence.

The path is configured via the `AMISTOSO_DATA_DIR` or legacy `PADEL_DATA_DIR` environment variable (`backend/config.py`). Defaults to a `data/` folder at the repo root.

### 1.2 No ORM — Raw SQL + Pickle Blobs

There is **no ORM** (no SQLAlchemy, no Alembic). The project uses:
- **Raw `sqlite3`** from the standard library for all queries.
- **`pickle` BLOBs** for serializing full tournament objects. The complex domain model (`GroupPlayoffTournament`, `MexicanoTournament`, etc.) is serialized wholesale into a `tournament_blob BLOB` column rather than mapped to relational columns.
- **Python `dataclass` models** (`backend/models.py`) for domain objects (`Player`, `Court`, `Match`, `GroupStanding`) — these are not ORM models, just in-memory data structures.
- **Pydantic models** for auth (`backend/auth/models.py`) — `User` with `UserRole` enum.

### 1.3 Complete Schema

All DDL is defined inline in `backend/api/db.py`. Six tables total:

#### `tournaments`
| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `type` | TEXT | NOT NULL |
| `owner` | TEXT | NOT NULL |
| `public` | INTEGER | NOT NULL DEFAULT 1 |
| `alias` | TEXT | nullable |
| `tv_settings` | TEXT | nullable (JSON) |
| `tournament_blob` | BLOB | NOT NULL (pickle) |
| `version` | INTEGER | NOT NULL DEFAULT 0 |
| `sport` | TEXT | NOT NULL DEFAULT 'padel' |
| `assign_courts` | INTEGER | NOT NULL DEFAULT 1 (added via migration) |

**Indexes:**
- `idx_tournaments_alias` — UNIQUE partial index on `alias WHERE alias IS NOT NULL`

#### `meta`
| Column | Type | Constraints |
|---|---|---|
| `key` | TEXT | PRIMARY KEY |
| `value` | INTEGER | NOT NULL DEFAULT 0 |

Used for process-global counters (e.g. `reg_counter` for registration IDs).

#### `users`
| Column | Type | Constraints |
|---|---|---|
| `username` | TEXT | PRIMARY KEY |
| `password_hash` | TEXT | NOT NULL (bcrypt) |
| `role` | TEXT | NOT NULL DEFAULT 'user' |
| `disabled` | INTEGER | NOT NULL DEFAULT 0 |

#### `player_secrets`
| Column | Type | Constraints |
|---|---|---|
| `tournament_id` | TEXT | NOT NULL |
| `player_id` | TEXT | NOT NULL |
| `player_name` | TEXT | NOT NULL DEFAULT '' |
| `passphrase` | TEXT | NOT NULL |
| `token` | TEXT | NOT NULL |
| `contact` | TEXT | NOT NULL DEFAULT '' |

**Primary Key:** `(tournament_id, player_id)`
**Indexes:**
- `idx_ps_tournament` on `tournament_id`
- `idx_ps_token` — UNIQUE on `token`

#### `registrations`
| Column | Type | Constraints |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `name` | TEXT | NOT NULL |
| `owner` | TEXT | NOT NULL |
| `open` | INTEGER | NOT NULL DEFAULT 1 |
| `join_code` | TEXT | nullable |
| `questions` | TEXT | nullable (JSON) |
| `description` | TEXT | nullable |
| `message` | TEXT | nullable |
| `alias` | TEXT | UNIQUE |
| `converted_to_tid` | TEXT | nullable (legacy) |
| `converted_to_tids` | TEXT | NOT NULL DEFAULT '[]' (JSON array) |
| `listed` | INTEGER | NOT NULL DEFAULT 0 |
| `archived` | INTEGER | NOT NULL DEFAULT 0 |
| `sport` | TEXT | NOT NULL DEFAULT 'padel' |
| `created_at` | TEXT | NOT NULL |

#### `registrants`
| Column | Type | Constraints |
|---|---|---|
| `registration_id` | TEXT | NOT NULL |
| `player_id` | TEXT | NOT NULL |
| `player_name` | TEXT | NOT NULL |
| `passphrase` | TEXT | NOT NULL |
| `token` | TEXT | NOT NULL |
| `answers` | TEXT | nullable (JSON) |
| `registered_at` | TEXT | NOT NULL |

**Primary Key:** `(registration_id, player_id)`
**Indexes:**
- `idx_reg_registrants` on `registration_id`
- `idx_reg_token` — UNIQUE on `token`

### 1.4 Connection Management

Defined in the `get_db()` context manager (`backend/api/db.py`):

- **No connection pooling** — a new connection is opened/closed per `with get_db()` call.
- **Auto-commit on success, rollback on exception.**
- **`sqlite3.Row` row factory** for dict-like access.
- **PRAGMAs** set on every connection via `_configure_connection`:
  - `journal_mode = WAL` (concurrent reads while writing)
  - `foreign_keys = ON`
  - `busy_timeout` (default 15000ms, configurable via `PADEL_SQLITE_BUSY_TIMEOUT_MS`)
  - `synchronous` (default NORMAL, configurable via `PADEL_SQLITE_SYNCHRONOUS`)
- **Connection timeout**: configurable via `PADEL_SQLITE_TIMEOUT_SECS` (default 15s).

### 1.5 Migrations

**No migration framework** (no Alembic). Migrations are handled as ad-hoc PRAGMA-based checks in `init_db()`:

The pattern is: check `PRAGMA table_info(table_name)` for missing columns, then `ALTER TABLE ADD COLUMN` if absent.

Migrations handled this way include:
- `tournaments.sport` column
- `tournaments.assign_courts` column
- `player_secrets.contact` column
- Several `registrations` columns (`description`, `message`, `alias`, `listed`, `archived`, `sport`, `converted_to_tids`, `questions`)
- `registrants.answers` column (migrated from `level` column)
- Legacy `level_type`/`level_label`/`level_required` → `questions` JSON migration

All migrations are idempotent ("run on every startup, skip if already applied").

### 1.6 Database Utilities & Patterns

**In-memory cache with write-through persistence:**
- **Tournaments** (`backend/api/state.py`): Loaded from SQLite into `_tournaments` dict on startup. All reads come from memory. Writes go to both the dict and SQLite via `_save_tournament()` (upsert). The full tournament object is pickled.
- **Users** (`backend/auth/store.py`): `UserStore` class keeps an in-memory `_users` dict, loaded from SQLite on startup. Every create/update/delete is written through to SQLite immediately.
- **Player secrets** (`backend/api/player_secret_store.py`): Read directly from SQLite (no caching). Full CRUD module.

**Concurrency control:**
- Per-tournament `asyncio.Lock` prevents interleaved read-modify-save within the same process (`backend/api/state.py`).
- Separate `_id_allocation_lock` for tournament ID generation.
- SQLite's own file locking prevents multi-process corruption.

**Security:**
- A `_RestrictedUnpickler` blocks deserialization of arbitrary classes from pickle blobs — only stdlib, pydantic, and `backend.*` modules are allowed.
- Player secrets are auto-deleted when a tournament reaches the `finished` phase.

**Versioning:**
- Each tournament has a `version` counter bumped on every save. The TV display polls `/{tid}/version` to detect changes without fetching full data.
- A global `_state_version` counter tracks any mutation for the tournament picker.

### 1.7 Initialization & Seeding

Startup sequence in the app lifespan (`backend/api/__init__.py`):

1. `init_db()` — Create tables, run migrations
2. `_load_state()` — Load all tournaments from SQLite into memory
3. `user_store.load()` — Load all users from SQLite into memory
4. `user_store.bootstrap_default_admin()` — Create admin user if store is empty

### 1.8 Test Database Setup

The `_clean_state` fixture (`tests/conftest.py`, autouse) provides complete isolation:

1. Redirects `DB_PATH` to `tmp_path / "test.db"` — each test gets a fresh SQLite file.
2. Calls `init_db()` to create the schema in the temporary database.
3. Clears all in-memory state (`_tournaments`, `_counter`, versions, locks).
4. Stubs out persistence — `_save_tournament` and `_delete_tournament` become no-ops.
5. Mocks player secret store — all CRUD operations are replaced with in-memory dict implementations.
6. Seeds test users — `admin`, `alice`, `bob` with pre-computed bcrypt hashes.
7. Resets rate limiters across all route modules.
8. Full teardown restores all original functions and clears state after each test.

### 1.9 Database Concerns

| Pattern | Notes |
|---|---|
| **Pickle for persistence** | Schema changes to domain models can break deserialization of existing data. The `_RestrictedUnpickler` mitigates security risk but not schema drift. |
| **No migration tooling** | `init_db()` contains growing ad-hoc migration code. |
| **No connection pool** | Every `get_db()` call opens/closes a connection. Fine for SQLite (in-process). |
| **No foreign keys in schema** | Despite `PRAGMA foreign_keys = ON`, no `REFERENCES` clauses exist in the DDL. |
| **No relationships** | `player_secrets.tournament_id` and `registrants.registration_id` are logically foreign keys but have no ON DELETE CASCADE — cleanup is manual. |
| **No `sqlalchemy` dependency** | Zero ORM/DB dependencies. |

---

## 2. Domain Models

**File**: `backend/models.py`

### Enums
| Enum | Values | Purpose |
|------|--------|---------|
| `MatchStatus` | scheduled, in_progress, completed | Match lifecycle |
| `Sport` | padel, tennis | Tennis enables set-based scoring |
| `TournamentType` | group_playoff, mexicano, playoff | Format discriminator |
| `GPPhase` | setup, groups, playoffs, finished | Group+Playoff lifecycle |
| `MexPhase` | mexicano, playoffs, finished | Mexicano lifecycle |
| `POPhase` | playoffs, finished | Standalone playoff lifecycle |

### Core Dataclasses
- **`Player`**: `name: str`, `id: str` (auto-generated 8-char hex via `uuid4().hex[:8]`)
- **`Court`**: `name: str`, `id: str` (auto-generated UUID hex)
- **`Match`**: `id`, `team1/team2: list[Player]`, `score: tuple[int,int] | None`, `sets: list[tuple[int,int]]` (tennis), `status: MatchStatus`, `court/slot_number/round_number/pair_index/comment`, properties: `winner_team`, `loser_team`, `completed`
- **`GroupStanding`**: `player: str`, `player_id`, match stats (W/D/L), `points_for/against/point_diff`, `match_points` (3=win, 1=draw or 3rd-set-loss, 0=loss), `played`, `sets_won/lost` (tennis)

---

## 3. Tournament Types & Lifecycle

### 3.1 Group+Play-off (`GroupPlayoffTournament`)

**File**: `backend/tournaments/group_playoff.py` (~280 lines)

**Lifecycle**: `setup → groups → playoffs → finished`

**Constructor params**: `players`, `num_groups`, `courts`, `top_per_group`, `double_elimination`, `team_mode`, `group_names`, `initial_strength`, `team_roster`, `team_member_names`, `group_assignments`

**Key methods**:
- `generate()`: Creates groups (explicit assignments or snake-draft with strength sorting), generates initial round of matches (team_mode=all round-robin at once; individual=one round at a time)
- `generate_next_group_round()`: Score-based opponent matching for subsequent rounds in individual mode
- `start_playoffs(advancing_ids, extra_players, double_elimination)`: Seeds bracket from group standings; individual mode uses fold pairing (best+worst); supports group-diversity seeding for 3+ groups
- `record_group_result(match_id, score, sets)`: Records a group-stage score, handles re-recording
- `record_playoff_result(match_id, score, sets)`: Records playoff score, advances winner, auto-finishes

**Group distribution**: Snake-draft (strength-sorted) or explicit `group_assignments` dict.

### 3.2 Mexicano+Play-offs (`MexicanoTournament`)

**File**: `backend/tournaments/mexicano/__init__.py` (~914 lines, with mixins)

**Lifecycle**: `mexicano → playoffs → finished` (or `mexicano → finished` via `finish_without_playoffs`)

See [Section 4](#4-mexicano-tournament-engine) for full details.

### 3.3 Standalone Play-off (`PlayoffTournament`)

**File**: `backend/tournaments/playoff_tournament.py` (~130 lines)

**Lifecycle**: `playoffs → finished`

**Constructor**: Accepts pre-ordered teams/participants, optional `initial_strength` for seeding (sorts by combined strength), courts. Immediately generates the bracket.

**Score recording**: Greedy court assignment after each result (free courts assigned to ready matches).

---

## 4. Mexicano Tournament Engine

The most complex tournament type. Uses three mixin classes for separation of concerns.

### Architecture
```
MexicanoTournament
 ├── ScoringMixin     (backend/tournaments/mexicano/scoring.py)
 ├── GroupingMixin     (backend/tournaments/mexicano/grouping.py)
 └── SitOutMixin      (backend/tournaments/mexicano/sit_outs.py)
```

### Configuration Parameters
| Parameter | Description | Default |
|-----------|-------------|---------|
| `total_points_per_match` | Scores must sum to this (e.g., 32) | required |
| `num_rounds` | 0 = rolling (no fixed limit) | 0 |
| `skill_gap` | Max allowed score difference in pairings | None |
| `win_bonus` | Flat bonus points for winners | 0 |
| `strength_weight` | Multiplier scale based on opponent strength (0=off, 1=full) | 0 |
| `loss_discount` | Multiplier for losers' credits (0-1) | 1.0 |
| `balance_tolerance` | Max allowed score imbalance in court matchups | ∞ |
| `team_mode` | Pre-formed pairs vs individual | False |
| `initial_strength` | Starting skill ratings dict | None |

### Core Flow
1. **`propose_pairings(n, forced_sit_outs)`**: Generates `n` pairing proposals using multiple strategies:
   - **Balanced**: Snake-draft groups, then `_best_pairing()` for 2v2 splits within each group
   - **Seeded**: Skill-gap tier grouping, optimized by hill-climbing swaps
   - Each sit-out combination is ranked via `_rank_sit_out_combos()` with weighted objective
2. **`generate_next_round(option_id)`**: Commits chosen proposal, assigns courts
3. **`record_result(match_id, score)`**: Credits scores with modifiers:
   - Raw score → ×strength_multiplier → ×loss_discount (for losers) → +win_bonus (for winners)
   - Re-recording reverses previous credits before applying new ones

### Scoring (ScoringMixin)
- Leaderboard sorted by total_points when all players have equal matches, by avg_points when counts differ
- `_estimated_scores()`: Extrapolates scores for players with fewer matches (used for fair playoff seeding)
- Match credit breakdown tracking per player per match

### Grouping (GroupingMixin)
- Snake-draft groups (default): Players ranked by score, distributed in snake order
- Skill-gap tier groups: `_cluster_by_gap()` → `_optimize_groups()` via hill-climbing swaps
- `_best_pairing()`: Priority ordering: gap_excess → normalized_imbalance → repeats

### Sit-Out Optimization (SitOutMixin)
- `_rank_sit_out_combos()`: Combinatorial optimization capped by `HEURISTIC_BUDGET` (~5000)
- Weighted objective: `skill_gap_violations`, `exact_prev_round_repeats`, `score_imbalance`, `repeat_count`
- Players tracked via `sit_out_history` and `missed_games` counters

### Dynamic Player Management
- `add_player(name)`: Adds mid-tournament (individual mode only, no pending matches)
- `remove_player(player_id)`: Soft-removes (preserves stats, blocked if in pending match)

### Playoff Transition
- `end_mexicano()` → `start_playoffs()`: Pairs by adjacent IDs, sorts by estimated scores
- `finish_without_playoffs()`: Marks finished without playoff bracket

---

## 5. Bracket / Playoff System

**File**: `backend/tournaments/playoff.py` (~613 lines)

### SingleEliminationBracket
- ATP-style interleaved seeding via `_make_seed_order()` (top seed vs worst, 2nd vs 2nd-worst, etc.)
- Automatic byes for non-power-of-2 participant count (highest seeds get byes)
- Winner advancement via `_next_match` mapping
- `record_result()` → advances winner, `champion()` returns winner when final is completed

### DoubleEliminationBracket
- **Winners bracket** (WR): Standard single-elimination
- **Losers bracket** (LR): Alternating minor/major rounds
  - Minor rounds: Pair losers from same source round
  - Major rounds: Cross-bracket (WR dropout vs LR survivor)
- **Grand final**: Winners bracket champion vs Losers bracket champion
- **Optional reset**: If LR champion wins grand final, a reset match is played
- Pre-generated at construction with all future matches (team slots filled as "TBD")
- `_interleave_key()` for display ordering (WR and LR rounds shown side-by-side)
- Automatic bye detection and resolution throughout

---

## 6. Pairing & Court Assignment Algorithms

### Pairing (`backend/tournaments/pairing.py`)
- **`best_2v2_split(group_of_4, history)`**: Evaluates all 3 possible 2v2 splits; priority: minimize score imbalance → minimize repeat count; ties broken randomly
- **`form_playoff_teams(standings)`**: Fold method (strongest+weakest, 2nd+2nd-weakest)
- **`seed_with_group_diversity(teams, groups)`**: Re-orders seeded bracket to maximize cross-group matchups in earliest rounds; accounts for byes
- History tracking: `make_history()`, `update_history()`, `pairing_repeat_count()` with full-match bonus penalty

### Court Assignment (`backend/tournaments/group_stage.py`)
- **Graph-based scheduling**: Builds compatibility graph (matches sharing no players)
- **2 courts**: Maximum matching via `nx.max_weight_matching`
- **3+ courts**: Greedy independent set with rest-aware tie-breaking
- Slots ordered by fullness (most matches first), tie-broken by player rest periods
- Courts assigned round-robin to slot positions

---

## 7. API Layer

**Files**: `backend/api/` directory

### App Configuration (`backend/api/__init__.py`)
- FastAPI with CORS middleware (configurable origins)
- CSRF origin protection on unsafe methods (POST/PUT/PATCH/DELETE)
- Lifespan: `init_db()` → `_load_state()` → `user_store.load()` → `bootstrap_default_admin()`
- Serves frontend files directly (LRU-cached reads) with correct MIME types
- 8 routers attached

### Endpoints Summary

#### Auth (`/api/auth/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/login` | Login → JWT token |
| GET | `/me` | Current user info |
| GET | `/users` | List users (admin only) |
| POST | `/users` | Create user (admin only) |
| DELETE | `/users/{username}` | Delete user (admin only) |
| PATCH | `/users/{username}/password` | Change password |

#### CRUD (`/api/tournaments/`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | List tournaments (filtered by role) |
| DELETE | `/{tid}` | Delete tournament |
| GET | `/{tid}/version` | Per-tournament version (ETag support) |
| GET/PATCH | `/{tid}/tv-settings` | TV display configuration |
| PATCH | `/{tid}/public` | Toggle public visibility |
| PUT/DELETE | `/{tid}/alias` | Set/remove URL alias |
| GET | `/resolve-alias/{alias}` | Resolve alias → tournament ID |
| GET | `/{tid}/meta` | Public metadata (no auth check) |
| PATCH | `/{tid}/match-comment` | Admin comment on matches |

#### Group+Playoff (`/{tid}/gp/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tournaments/group-playoff` | Create GP tournament |
| GET | `/status` | Phase, groups, champion, courts |
| GET | `/groups` | Standings + matches per group |
| POST | `/record-group` | Record group score (points) |
| POST | `/record-group-tennis` | Record group score (sets) |
| PATCH | `/courts` | Replace court list |
| POST | `/next-group-round` | Generate next round (individual mode) |
| GET | `/recommend-playoffs` | Ranked participants for playoff config |
| POST | `/start-playoffs` | Transition to playoffs |
| GET | `/playoffs` | Bracket matches + champion |
| GET | `/playoffs-schema` | Bracket image (PNG/SVG/PDF) |
| POST | `/record-playoff`, `/record-playoff-tennis` | Playoff score recording |

#### Mexicano (`/{tid}/mex/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tournaments/mexicano` | Create Mexicano tournament |
| GET | `/status` | Leaderboard, rounds, sit-outs, champion |
| GET | `/matches` | Current round + all matches + breakdowns |
| POST | `/record` | Score recording with breakdown response |
| PATCH | `/courts` | Replace courts |
| GET | `/propose-pairings` | Generate N proposals |
| POST | `/next-round` | Commit chosen proposal |
| POST | `/custom-round` | Manual pairing commit |
| GET | `/recommend-playoffs` | Recommended playoff teams |
| POST | `/start-playoffs` | Start playoff bracket |
| POST | `/end` | End mexicano phase (prepares for playoffs) |
| POST | `/finish` | Finish without playoffs |
| GET | `/playoffs`, `/playoffs-schema` | Bracket data/image |
| POST | `/record-playoff`, `/record-playoff-tennis` | Playoff scores |

#### Standalone Playoff (`/{tid}/po/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tournaments/playoff` | Create playoff tournament |
| GET | `/status` | Phase, champion, bracket type |
| GET | `/playoffs` | All matches + pending + champion |
| GET | `/playoffs-schema` | Bracket image |
| POST | `/record`, `/record-tennis` | Score recording |

#### Player Auth (`/{tid}/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/player-auth` | Auth via passphrase/token → player JWT |
| POST | `/players` | Add player mid-tournament (Mexicano) |
| DELETE | `/players/{pid}` | Remove player |
| GET | `/player-secrets` | Admin view of all credentials |
| GET | `/player/opponents` | Player's upcoming opponents + contacts |

#### Registration (`/api/registrations/`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/` | Create lobby |
| GET | `/` | List own lobbies |
| GET | `/public` | List open, listed lobbies |
| GET | `/{rid}` | Full admin view |
| PATCH | `/{rid}` | Update settings |
| DELETE | `/{rid}` | Delete lobby |
| POST | `/{rid}/register` | Public registration (with questions) |
| POST | `/{rid}/convert` | Convert to tournament |
| PUT/DELETE | `/{rid}/alias` | Set/remove alias |
| Various | Registrant management | Add/remove/edit registrants |

#### Schema Preview
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/api/schema/preview` | Group+playoff structure diagram |
| GET | `/api/schema/playoff-preview` | Standalone bracket preview |

### Persistence (`backend/api/state.py`, `backend/api/db.py`)
- In-memory `_tournaments` dict synced to SQLite
- Tournament objects are pickle-serialized as BLOBs
- `_RestrictedUnpickler` on load: allows only stdlib + `backend.*` modules (security)
- Per-tournament asyncio locks for concurrent access
- Per-tournament version counters + global `_state_version` for change detection
- Auto-deletes player secrets when tournament reaches finished phase

---

## 8. Authentication & Authorization

**Files**: `backend/auth/` directory

### Admin/User Auth
- **bcrypt** for password hashing
- **PyJWT (HS256)** for JWT tokens
  - Admin tokens: 7-day expiry
  - Player tokens: 24-hour expiry
- JWT secret: from `PADEL_JWT_SECRET` env var, or auto-generated `.jwt_secret` file
- `bootstrap_default_admin()`: Creates admin user on first run (password from `PADEL_ADMIN_PASSWORD` env or random)

### User Roles
| Role | Capabilities |
|------|-------------|
| `admin` | Full access, manage users, see all tournaments |
| `user` | Create/manage own tournaments |
| (guest) | See public tournaments, view TV |

### Player Auth
- Players receive a 3-word passphrase (via `coolname`) + 32-byte URL-safe token
- Passphrase: used for manual login (e.g., "brave-little-tiger")
- Token: used for QR-code auto-login links
- Player JWT contains: `player_id`, `tournament_id`, `player_name`
- Rate-limited: 10 attempts per 60s per IP (bounded LRU cache of 4096 IPs)

### Authorization Hierarchy (for score recording)
1. Admin → always allowed
2. Tournament owner → always allowed
3. Authenticated player in the match (if `allow_player_scoring` is enabled in TV settings)

---

## 9. Registration / Lobby System

**Files**: `backend/api/routes_registration.py` (~1193 lines)

### Flow
1. Admin creates a registration lobby (name, optional join_code, questions, description)
2. Lobby gets a shareable URL (`/register?id=<rid>` or `/register/<alias>`)
3. Players self-register with their name (and answer optional questions)
4. Players receive a passphrase that carries over (used to verify/update)
5. Admin reviews registrants, can add/remove/edit
6. Admin converts lobby → tournament (GP, Mexicano, or Playoff)
7. Player credentials carry over to the tournament
8. Multiple tournaments can be created from same lobby (re-conversion)
9. Lobbies track `assigned_player_ids` to prevent double-assignment

### Question System
- Questions defined as `QuestionDef`: key, label, type (text/choice/multichoice/number), required, choices
- `text` — free-form textarea input
- `number` — numeric input
- `choice` — single-select dropdown from predefined choices
- `multichoice` — multiple-select checkboxes from predefined choices; answers stored as JSON array strings (e.g. `'["Mon","Fri"]'`) within the `dict[str, str]` answers map
- Built-in `contact` question type for player contact info
- Answers stored per registrant, viewable by admin
- Backend validates multichoice values against allowed choices list

---

## 10. Visualization (Bracket Schema)

**File**: `backend/viz/bracket_schema.py` (~1253 lines)

### Capabilities
- Builds `networkx.DiGraph` representing tournament structure
- Two main render modes:
  1. `render_schema()`: Full tournament preview (groups → bracket)
  2. `render_playoff_schema()`: Live bracket with match results overlaid
- Output formats: PNG (rasterized), SVG, PDF
- Configurable scales: box_scale, line_width, arrow_scale, title_font_scale, output_scale
- Match labels overlay: shows current scores/teams on bracket diagram
- Supports both single and double elimination bracket layouts

---

## 11. Frontend Architecture

### Pages
| Page | File | Purpose |
|------|------|---------|
| Admin | `index.html` + `admin.js` (6041 lines) | Tournament management |
| TV View | `public.html` + `tv.js` (1507 lines) | Public display / player view |
| Registration | `register.html` + `register.js` (830 lines) | Self-registration |

### Shared Modules
| File | Purpose |
|------|---------|
| `shared.js` (508 lines) | HTML escaping, theme (dark/light), language persistence, `t()` translation, `applyI18n()` |
| `auth.js` (538 lines) | Token management (localStorage/sessionStorage), `login()`, `logout()`, `apiAuth()` with auto-retry on 401, login dialog |
| `i18n.js` (1333 lines) | `I18N_MESSAGES` catalog with en/es translations for all UI strings |
| `admin.css` | Admin panel styles |
| `tv.css` | TV view + registration page styles |
| `register.css` | Registration-specific styles |

### Admin Panel (`admin.js`)
- **Tabs**: Tournaments (home), Create, View (active tournament), Info
- **Tournament list**: Shows active + finished tournaments + registration lobbies with visibility toggles
- **Multi-tournament chips**: Quick-switch between open tournaments (pinned tabs)
- **Create panel**: Sport toggle (padel/tennis), format subtabs (GP, Mexicano, Playoff, Registration Lobby)
  - Participant manager: Individual fields or paste mode, auto-count, strength bubbles
  - Group preview with color-coded snake-draft distribution
  - Court configuration editor
  - Schema preset buttons (2×4, 3×4, etc.)
- **View panel**: Renders based on tournament type
  - GP: Group standings tables, match cards with score inputs (points or tennis sets), next-round / start-playoffs controls, playoff bracket inline
  - Mexicano: Leaderboard, pairing proposal picker (balanced/seeded strategies), manual pairing editor, sit-out controls, playoff editor with team composition
  - Playoff: Bracket image, match cards, score inputs
  - Registration: Lobby settings, registrant management, question editor, convert-to-tournament button
- **TV Settings controls**: Inline editor for all TV display options
- **Player codes panel**: Shows passphrase/QR for all players
- **Export**: HTML/PDF outcome reports with bracket images
- **Version polling**: Every 15s, auto-refreshes view if version changed (preserves input drafts)

### TV View (`tv.js`)
- **Tournament picker**: When no tournament ID, shows list of public tournaments with alias support
- **Auto-refresh**: Three modes:
  - Timer (configurable interval, countdown display)
  - On-update (polls version endpoint every 3s, refreshes on change)
  - Manual only (no auto-refresh)
- **Player auth**: Login via passphrase or QR token (auto-login from URL param)
- **Player score submission**: Inline score forms for matches the logged-in player is in
- **Sections**: Court assignments → Standings/Leaderboard → Past matches (grouped by round, most recent first)
- **Bracket display**: Inline image with lightbox zoom/download
- **Section open-state persistence**: Remembers collapsed/expanded state in localStorage
- **Player panel**: Shows upcoming opponents with contact info

### Registration Page (`register.js`)
- **Directory mode**: Lists public open lobbies
- **Lobby view**: Registration form with custom questions, join-code validation
- **Returning player**: Lookup by passphrase → edit answers/cancel
- **Polling**: Auto-refreshes registrant list, detects conversion → shows redirect toast
- **Markdown support**: Lobby descriptions rendered via `marked` + `DOMPurify`

### PWA
- `manifest.json` for add-to-homescreen
- `service-worker.js` for offline caching
- Theme-color meta tag

---

## 12. Configuration & Deployment

### Environment Variables
| Variable | Purpose | Default |
|----------|---------|---------|
| `PADEL_JWT_SECRET` | JWT signing secret | Auto-generated file |
| `PADEL_ADMIN_PASSWORD` | Initial admin password | Random (printed to stdout) |
| `AMISTOSO_DATA_DIR` / `PADEL_DATA_DIR` | SQLite database directory | `data/` at repo root |
| `PADEL_DEMO_MODE` | Enable demo banner + restrictions | false |
| `PADEL_FRONTEND` | Custom frontend directory | `frontend/` |
| `PADEL_SQLITE_BUSY_TIMEOUT` | SQLite busy timeout (ms) | 5000 |
| `PADEL_SQLITE_SYNC` | SQLite synchronous level | NORMAL |
| `PADEL_ALLOWED_ORIGINS` | CORS allowed origins (comma-separated) | all |

### Docker (`docker-compose.yml`)
- Single `padel` service, build from Dockerfile
- Ports: 8000:8000
- Volume: `./data:/app/data`
- Environment variables for JWT secret, admin password, demo mode

### Render.com (`render.yaml`)
- Free tier web service with auto-deploy from main branch
- Persistent disk at `/data` for SQLite
- Build command: `pip install .`
- Start command: `uvicorn backend.api:app --host 0.0.0.0 --port $PORT`

### Dependencies (`pyproject.toml`)
- Runtime: fastapi, uvicorn, pydantic, pyjwt, bcrypt, networkx, matplotlib, coolname, segno, python-multipart, aiofiles
- Dev: pytest, httpx, ruff, pre-commit

---

## 13. Testing

**Directory**: `tests/`

### Test Files
| File | Coverage |
|------|----------|
| `test_api.py` | API integration tests (GP, Mex, Playoff, Registration, Strength, GroupAssignments) |
| `test_auth.py` | Auth routes, JWT, user management |
| `test_group_playoff.py` | GroupPlayoffTournament unit tests |
| `test_group_stage.py` | Group class, standings, round-robin |
| `test_helpers.py` | API helper functions |
| `test_mexicano.py` | MexicanoTournament comprehensive tests |
| `test_playoff.py` | Single/double elimination bracket tests |
| `test_player_auth.py` | Player authentication flow |
| `test_convert_registration.py` | Registration → tournament conversion |
| `test_banner_comments.py` | Banner text and match comments |

### Test Infrastructure (`tests/conftest.py`)
- **`_clean_state` fixture** (autouse): Resets all in-memory state between tests
- Uses `tmp_path` for isolated SQLite database per test
- Disables persistence (`_save_tournament` → noop)
- Mocks player secret store (in-memory dict instead of SQLite)
- Pre-computed bcrypt hashes for speed
- Fixtures: `client` (TestClient), `admin_headers`, `user_headers`, `admin_token`, helper functions

---

## 14. Notable Patterns & Concerns

### Architectural Patterns
1. **Pickle serialization**: Tournament objects stored as pickle BLOBs. `_RestrictedUnpickler` mitigates deserialization attacks but pickle is inherently fragile across code changes.
2. **In-memory + SQLite**: Tournaments live in-memory dict, synced to SQLite on every mutation. Fast reads, but single-process only.
3. **Asyncio locks**: Per-tournament locks prevent concurrent mutations via `_tournament_lock(tid)`.
4. **Version polling**: Lightweight change detection via monotonic version counters + ETag/304.
5. **Frontend-served-by-backend**: No separate frontend build — JS/CSS/HTML served directly by FastAPI with LRU-cached file reads.
6. **Rate limiting**: Bounded LRU-based rate limiter (4096 IPs max) for creation and auth endpoints.

### Design Decisions
- **No ORM**: Direct SQLite via `sqlite3` module — simple and sufficient for the use case.
- **No frontend framework**: Vanilla JS with string-based HTML generation — keeps dependencies zero but admin.js is 6000+ lines.
- **Pydantic for API schemas only**: Internal tournament objects use dataclasses, not Pydantic.
- **Sport-aware scoring**: Tennis mode uses set-based scoring throughout; game totals computed from sets for standings, but W/L determined by sets won.

### Potential Concerns
1. **admin.js size**: 6041 lines in a single file — could benefit from module splitting.
2. **Pickle fragility**: Renaming/restructuring classes breaks deserialization of existing tournaments.
3. **Single-process**: No horizontal scaling possible due to in-memory state.
4. **No WebSockets**: Real-time updates via polling (every 3-15s) rather than push.
5. **No database migrations framework**: Ad-hoc column additions via `_ensure_columns()`.
6. **Frontend HTML generation**: Large amounts of HTML built via string concatenation in JS — XSS risk if `esc()` is ever missed.

---

## 15. Email Notification System

### 15.1 Overview

Optional SMTP-based email notifications added via `aiosmtplib`. Gracefully degrades when SMTP is not configured — `is_configured()` returns `False`, all send functions are silent no-ops, and frontend hides email UI elements.

### 15.2 Configuration

Seven environment variables in `backend/config.py`:
- `AMISTOSO_SMTP_HOST` — SMTP server hostname (required for email to work)
- `AMISTOSO_SMTP_PORT` — default `587`
- `AMISTOSO_SMTP_USER` / `AMISTOSO_SMTP_PASS` — optional credentials
- `AMISTOSO_FROM_EMAIL` — sender address (required)
- `AMISTOSO_SMTP_USE_TLS` — default `true`
- `AMISTOSO_SITE_URL` — base URL for links in emails

Config normalization note:
- Placeholder strings like `None` / `null` / empty are treated as **unset** for optional SMTP values.
- This allows Docker placeholders to keep email disabled by default.

### 15.3 Module: `backend/email.py`

| Function | Purpose |
|---|---|
| `is_configured()` | Checks `SMTP_HOST` and `SMTP_FROM` are set |
| `is_valid_email(value)` | Minimal regex validation |
| `send_email(to, subject, html_body)` | Async SMTP send, returns `bool` |
| `send_email_background(to, subject, html_body)` | Fire-and-forget via `asyncio.create_task` |
| `render_registration_confirmation(...)` | HTML template for registration confirm |
| `render_credentials_email(...)` | HTML template for credentials reminder |
| `render_tournament_started_email(...)` | HTML template for tournament-started |

### 15.4 Database Changes

- `registrants` table: added `email TEXT NOT NULL DEFAULT ''`
- `registrations` table: added `auto_send_email INTEGER NOT NULL DEFAULT 0`
- `player_secrets` table: added `email TEXT NOT NULL DEFAULT ''`
- Migrations in `init_db()` via `PRAGMA table_info` checks

### 15.5 API Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/tournaments/email-status` | Returns `{configured: bool}` |
| `POST` | `/api/registrations/{rid}/send-email/{player_id}` | Send credentials to one registrant |
| `POST` | `/api/registrations/{rid}/send-all-emails` | Bulk send to all registrants with email |
| `POST` | `/api/registrations/{rid}/send-message-emails` | Send current organizer message to all registrants with email |
| `POST` | `/api/tournaments/{tid}/notify-players` | Send "tournament started" to all players with email |

### 15.6 Frontend Integration

- **Registration form** (`register.js`): Optional email field
- **Admin panel** (`admin.js`):
  - `window._emailConfigured` flag fetched on startup from `/api/tournaments/email-status`
  - Auto-send email checkbox in lobby settings (conditional on flag)
  - Email column in registrants table
  - Per-row send button + "Send all emails" bulk button
  - Prompt to notify players after lobby-to-tournament conversion
- **i18n** (`i18n.js`): 18 new strings in EN and ES

### 15.7 Rate Limiting

- `_email_send_rate_limiter`: 30 attempts / 60s per IP (registration email endpoints)
- `_notify_rate_limiter`: 10 attempts / 60s per IP (tournament notification)

### 15.8 Tests

`tests/test_email.py` — 38 tests covering:
- Email validation, HTML escape, configuration detection
- Template rendering (registration confirmation, credentials, tournament started)
- Email status endpoint
- Registrant email CRUD (register, patch, admin-add)
- Auto-send email setting (create, toggle)
- Send-email endpoint (unconfigured, no email, success, wrong player)
- Send-all-emails endpoint (counts: sent/skipped/failed)
- Send-message-emails endpoint (unconfigured, no message set, counts)
- Notify-players endpoint (unconfigured, not found, no emails)
- Email carriage through lobby-to-tournament conversion
---

## 16. Registration Timeline (multi-tournament from one lobby)

### 16.1 Feature Overview

Allows creating multiple tournaments from the same registration lobby, with the same (or overlapping) player pools.

### 16.2 Backend Changes

**`backend/api/routes_registration.py`**

- `_get_player_tournament_map(tids)`: New helper returning `{player_id: [tid, ...]}` for all players across linked tournaments
- `convert_registration` endpoint:
  - **Overlap players are now allowed** (removed the 400-rejection guard)
  - When a player already has a token in a previous tournament, a **fresh token is generated** for the new tournament (avoids UNIQUE constraint on `player_secrets.token`)
  - Response now includes `overlapping_players: list[str]` (names of players already in a previous tournament)

**`backend/api/schemas.py`**

- `RegistrationAdminOut` now includes `player_tournament_map: dict[str, list[str]]` field (player_id → list of tournament IDs)

### 16.3 Frontend Changes

**`frontend/admin.js`**

- `_renderRegDetailInline`: Now shows both **🔒 Close registration** and **🔓 Open registration** toggle buttons alongside the convert button. The convert button is disabled (with tooltip) when registration is closed.
- `_toggleRegOpen(rid, currentlyOpen)`: Updated to re-render the registration detail inline after toggling (previously only refreshed the list).
- `_renderConvPlayerList`: **Previously-assigned players are now selectable** (with checkbox). They show a yellow ⚠ dot with a tooltip listing which linked tournaments they're already in. An inline hint text shows below the row.
- `_convSelectAll` / `_convDeselectAll`: Updated to include all registrants (not just unassigned ones).
- `_updateConvSelectedCount`: Updated to count from all registrants.
- `_getConvPlayerNames`: Updated to include all selected registrants (including previously-assigned).
- `_renderConvertPanel`: Initial selection still defaults to unassigned-only; the player count header shows total registrants.
- `_submitConvert`: Displays an informational `alert-warning` banner if the API returns overlapping player names.

**`frontend/admin.css`**

- `.conv-player-row.assigned`: Changed from greyed-out/unclickable to a yellow left-border style.
- Added `.conv-player-overlap-dot`: Yellow ⚠ indicator icon.
- Added `.conv-player-overlap-hint`: Small amber hint text below the player row.

**`frontend/i18n.js`**

- Added `txt_reg_player_in_tournaments`: "Already in: {tournaments}"
- Added `txt_reg_closed_cannot_convert`: Tooltip when convert is disabled due to closed registration
- Added `txt_reg_overlap_notice`: Post-conversion banner mentioning overlapping players

### 16.4 Data Flow

1. Admin creates one registration lobby and collects registrants
2. Admin manually closes the lobby when done (🔒 button) — or it can remain open
3. Admin clicks "Create another tournament" (enabled as long as lobby is open)
4. In the convert panel, unassigned players are selected by default; previously-assigned players appear with a ⚠ warning — can still be selected
5. On submit, backend creates the new tournament; if any overlapping players were included, a new token is generated for each (preserving their passphrase)
6. Response includes `overlapping_players` list; frontend shows a notice if non-empty
7. When all registrants are assigned the lobby auto-closes (open=0) but is NOT auto-archived; archiving must be done manually

### 16.5 Tests

`tests/test_convert_registration.py` — `test_convert_overlap_allowed_with_warning`:
- Verifies a player can be included in a second tournament from the same lobby
- Checks `overlapping_players` list in response
- Verifies the player appears in the new tournament's `player_secrets`

### 16.6 Registration Admin Screen Grouping & Spoiler UX (2026-03-29)

**`frontend/admin.js`**

- Registration detail rendering is centralized in `_renderRegDetailInline(rid)`.
- Admin-facing registration controls are rendered as three `details.reg-section` blocks in this order: settings, organizer message, and question editor.
- Registrant data is rendered separately afterward: registrants table and question answers panel (`_renderAnswersPanel`).
- `details` open/close state restoration is index-based (`details.reg-section` order), so preserving section order is important when inserting wrappers.
- Choice-type question individual answers are nested in `details.reg-answer-spoiler` within `_renderAnswersPanel`.

**`frontend/admin.css`**

- Collapsible registration sections hide native markers, so explicit chevrons must be provided for discoverability.
- Added grouping support via `.reg-sections-group` spacing to visually separate admin controls from player-data sections.
- Added explicit chevron indicators for both `.reg-section-summary` and `.reg-answer-spoiler-summary` to make expandability clear.

### 16.7 Registration Screen Emoji Cleanup (2026-03-29)

**`frontend/admin.js`**

- In registration detail (`_renderRegDetailInline`) and answers (`_renderAnswersPanel`), action labels and section titles no longer prepend emojis.
- In registration conversion (`_renderConvertPanel`, `_renderConvGroupPreview`, `_cancelConvGroupPreview`), headings and CTA labels were aligned to text-only style.
- Copy-link button fallback text now restores to `txt_reg_copy_link` instead of an emoji glyph.

Result: registration admin management now uses consistent text-first labels while retaining explicit chevrons for all collapsible controls.