# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A FastAPI + vanilla-JS web app for running padel/tennis tournaments (Group+Playoff,
Mexicano, and Direct Playoffs formats), registration lobbies, a Player Hub with an ELO
rating system, and live TV/spectator views. Single-process app: in-memory tournament
state persisted to SQLite (`data/padel.db`) after every mutation. See `README.md` for
full user-facing feature docs (Mexicano tuning knobs, ELO formula, auth flows) — it's
accurate for *behavior* but its "Project structure" section is stale/incomplete; trust
the actual code layout described below instead.

## Commands

```bash
# Install deps (creates .venv)
uv sync

# Run the dev server (auto-reloads on file changes)
uv run uvicorn backend.api:app --reload --port 8000

# Lint / format (ruff does both)
uv run ruff check .
uv run ruff check . --fix
uv run ruff format .
uv run ruff format --check .

# Tests (pytest + FastAPI TestClient, no server needed)
uv run pytest tests/
uv run pytest tests/test_mexicano.py -v
uv run pytest tests/test_api.py::TestGroupPlayoffAPI::test_create -v
uv run pytest tests/ --cov=backend --cov-report=term-missing
uv run pytest tests/ -x

# Pre-commit (runs ruff on staged files before every commit)
uv run pre-commit install
uv run pre-commit run --all-files
```

Version bumps use `commitizen` (`uv run cz bump`) driven by Conventional Commits
(`feat:`, `fix:`, `feat!:`/`BREAKING CHANGE:`) — see README's "Releasing a new version"
section.

## Architecture

### Backend (`backend/`)

- `models.py` — core dataclasses/enums shared by every tournament type (`Player`,
  `Match`, `Court`, `Sport`, `TournamentType`, phase enums, etc.).
- `tournaments/` — pure tournament-engine logic, no FastAPI/HTTP concerns:
  - `group_stage.py` — round-robin group logic.
  - `playoff.py` / `playoff_tournament.py` — single/double-elimination brackets.
  - `group_playoff.py` — orchestrates groups → playoffs.
  - `mexicano/` — Mexicano engine, split into `grouping.py` (pairing/skill-gap/repeat
    avoidance), `scoring.py` (win bonus/strength weighting/loss discount), `sit_outs.py`.
  - `pairing.py` — shared 2v2 pairing + partner/opponent history utilities.
  - `elo.py` — margin-aware ELO (see README's "ELO Rating System" for the formula).
  - `player_secrets.py` — passphrase/QR generation for player self-scoring auth.
- `api/` — FastAPI layer. `__init__.py` builds the `app`, wires middleware, and — this
  is the important bit — serves the **entire frontend via hardcoded per-file routes**
  (`/admin-mex.js`, `/theme.css`, etc.), not a generic static-files mount. **Adding a new
  frontend file requires adding a route for it here too**, or it 404s.
  - `state.py` — in-memory tournament state (the source of truth while running) +
    version counter for SSE/polling clients; persists to SQLite on every mutation.
  - `db.py` — SQLite connection/schema management (`get_db()`, `init_db()`).
  - Routes are split by feature: `routes_gp.py` (Group+Playoff), `routes_mex.py`
    (Mexicano), `routes_playoff.py`, `routes_registration.py` (lobbies),
    `routes_player_auth.py` (passphrase/QR login), `routesg_player_space.py` (Player
    Hub), `routes_clubs.py` / `routes_communities.py` / `routes_seasons.py`
    (community/club hierarchy — see README's "Communities and clubs"),
    `routes_admin_players.py`, `routes_score_actions.py` (score submit/confirm/dispute),
    `routes_share.py` (HTML/PDF export), `routes_push.py` (web push), `sse.py` (live
    update stream), `routes_schema.py` (bracket diagram preview).
  - `elo_integration.py` / `elo_store.py` — wire the ELO engine into match completion
    and persist rating history.
  - `backup.py` — periodic SQLite backup scheduler (started/stopped in the app lifespan).
  - `rate_limit.py`, `leaderboard_cache.py`, `push_events.py`, `push.py` — supporting
    infra for the above.
  - The app also has middleware for **subdomain routing**: `{club-slug}.{domain}` serves
    `club.html` directly (resolved against the `clubs` table), `admin.{domain}` redirects
    to the apex — see the `subdomain_router` middleware in `api/__init__.py`.
- `auth/` — JWT (`pyjwt`, HS256) + bcrypt user auth, independent of player passphrase
  auth. `deps.py` has the `get_current_user` FastAPI dependency; `store.py` persists
  users to the same SQLite DB.
- `viz/bracket_schema.py` — renders bracket diagrams with networkx/matplotlib.
- `config.py` — env var parsing (SMTP, data dir, JWT secret, etc. — see README's env
  var tables).

### Frontend (`frontend/`)

**Vanilla JS + HTML + CSS, no build step, no Node/npm anywhere in the stack.** Each
major view is a standalone HTML page + its own JS file(s), all loaded via fixed
`<script>` tags (there's no bundler/router to route around):

| Page | HTML | JS |
|---|---|---|
| Admin | `index.html` | `admin-*.js` (split by feature, see filenames) |
| Player Hub | `player.html` | `player.js` |
| TV / spectator | `public.html` | `tv.js` |
| Registration | `register.html` | `register.js` |
| Club landing | `club.html` | `club.js` |

Shared utilities: `shared.js`, `auth.js`, `i18n.js` (en/es, `txt_*` key convention).
`theme.css` defines the design system — a deliberate "Hardcourt Nights" identity
(DecoTurf blue, Penn-ball yellow-green, light/dark modes) via `--color-*`/`--radius-*`/
`--space-*` tokens. **Read `.github/skills/frontend-dev/SKILL.md` before touching any
frontend code** — it covers the token system, the incremental **Petite-Vue** migration
convention (which views are converted vs. still legacy `innerHTML` string-building),
i18n requirements, and a list of "AI-tool default" patterns to avoid (Inter font,
purple/blue gradients, shadcn-style cards, emoji icons).

It's a working PWA (`manifest.json` + `service-worker.js`, cache-first static/
network-first HTML). Any new or renamed static file must be added to `service-worker.js`
`STATIC_ASSETS`/`SHELL` with `CACHE_NAME` bumped, or clients on a stale cache won't see it.

`refresh-plan.md` (repo root, untracked) is the living status doc for the ongoing
Petite-Vue migration — check it for which views are currently islands vs. legacy before
assuming either pattern applies to a given file.

### Data model / persistence

- Tournament state lives in memory (`backend/api/state.py`) for speed, written through
  to SQLite (`data/padel.db`, override via `PADEL_DATA_DIR`) after every mutation so a
  restart resumes exactly where it left off.
- **Run exactly one process/worker per data directory** — state is process-local, not
  shared across workers. Scale by running multiple instances with distinct
  `PADEL_DATA_DIR`s, not multiple uvicorn workers.
- Two independent auth systems share the same DB: JWT admin/organizer accounts
  (`backend/auth/`) and per-player passphrase/QR credentials (`tournaments/player_secrets.py`
  + `api/player_secret_store.py`) for self-scoring.

## Testing conventions

- `tests/` uses FastAPI's `TestClient` against the real app — no server process needed.
- Test file names mirror the feature area, not always the exact source module (e.g.
  `test_score_actions.py`, `test_convert_registration.py`, `test_registration_recovery.py`
  cut across multiple `routes_*.py` files). Check `tests/conftest.py` for shared fixtures
  before adding new ones.
- `tests/test_static_assets.py` guards frontend-serving concerns: compression, ETag/304
  behavior, and — as the Petite-Vue migration progresses — that each converted view still
  has its expected reactive bindings and island-mount call.

## Project-specific conventions (from `.github/copilot-instructions.md`)

- No emojis in padel/tennis-facing content unless explicitly requested.
- Check for existing similar patterns/utilities in the codebase before adding new ones —
  this codebase already has a lot of surface area (30+ backend route files, a dozen+
  frontend JS files); grep first.
- `exploration.md` (repo root, untracked) accumulates prior codebase-investigation notes
  across sessions — check it for relevant prior findings before re-exploring, and append
  new findings there rather than losing them.
- Type hints on function signatures, `from __future__ import annotations`, `str | None`
  union syntax, pydantic models for structured data (never bare dicts/tuples) — standard
  across `backend/`.
