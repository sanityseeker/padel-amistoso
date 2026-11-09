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
  is the important bit — serves the React shell (`_spa_response`) and the `/admin-assets/`
  files. It serves the legacy pages by hardcoded per-file routes (`/admin-mex.js`,
  `/theme.css`, etc.), not a generic static-files mount. **A new top-level React section
  needs a route here** (see Frontend). A new legacy file needs its own route too, or it 404s.
  - `state.py` — in-memory tournament state (the source of truth while running) +
    version counter for SSE/polling clients; persists to SQLite on every mutation.
  - `db.py` — SQLite connection/schema management (`get_db()`, `init_db()`).
  - Routes are split by feature: `routes_gp.py` (Group+Playoff), `routes_mex.py`
    (Mexicano), `routes_playoff.py`, `routes_registration.py` (lobbies),
    `routes_player_auth.py` (passphrase/QR login), `routes_player_space.py` (Player
    Hub), `routes_clubs.py` / `routes_communities.py` / `routes_seasons.py`
    (community/club hierarchy — see README's "Communities and clubs"),
    `routes_admin_players.py`, `routes_score_actions.py` (score submit/confirm/dispute),
    `routes_share.py` (HTML/PDF export), `routes_push.py` (web push), `sse.py` (live
    update stream), `routes_schema.py` (bracket diagram preview),
    `routes_payments.py` (fees, payment status, player self-report),
    `routes_withdrawals.py` (withdraw a participant; the engine is
    `tournaments/withdrawal.py`), `routes_crud.py` (list/delete tournaments, TV settings).
  - `player_merge.py` — shared merge functions for player profiles. The admin players
    routes and the club routes both use them.
  - `elo_recalc.py` — recalculates ratings after a participation changes its profile
    link. Code calls `mark_elo_dirty`. The HTTP middleware flushes the recalculation
    before the response goes out.
  - `demo_cleanup.py` — background task that deletes demo accounts and their data after
    `AMISTOSO_DEMO_TTL_DAYS` days (demo instance only).
  - `elo_integration.py` / `elo_store.py` — wire the ELO engine into match completion
    and persist rating history.
  - `club_elo.py` — each club's own rating chain, stored per player on
    `player_elo_log` (`club_identity`, `club_elo_*`, `club_matches_after`); tier/manual
    club ratings act as seeds; never touches community/global ratings. New scores are
    rated alone from the players' latest club rows; history-rewriting changes (score
    corrections, link changes, club moves/deletes) replay the whole club.
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

One React SPA serves `/` (redirects), `/events`, `/player`, `/admin/*` (including the public
`/admin/info` guide and the demo instance's login) with **React + TypeScript + Vite +
Mantine** in `frontend/admin-app/`. Run `npm ci` and `npm run dev` there (port 5173, API proxy
to 8000), or `npm run build` to produce `dist/`. FastAPI serves the built shell with `no-cache`
+ ETag (the demo instance gets the `demo-instance` class on `<html>`) and hashed
`/admin-assets/` files; Docker builds it in a Node stage. API contracts and SQLite storage are
unchanged. **A new top-level SPA section needs a FastAPI route**: `backend/api/__init__.py` has
`_spa_response(request)` plus catch-alls for `/admin/{rest:path}`, `/player/{rest:path}` and
`/events/{rest:path}`; any other prefix 404s until added there. Old `/admin#/...` hash links
are mapped at boot (`shell/hashMigration.ts`; `/player#token=...` is never touched). Nothing in
the React app or in any link the backend generates (e-mails, QR codes, redirects) points at the old
UI any more; it is only reachable by typing `/legacy/*` (see below).
`tests/test_react_frontend_guards.py` fails if `/legacy` appears in `src/`. Browser checks:
`npm run test:e2e` (isolated temporary database; port 8011, plus a demo instance on 8012).

`frontend/admin-app/src/` layout:

- `app/` providers (query client, Mantine, theme sync, notifications); `router.tsx` is the
  route tree (`createBrowserRouter`, lazy pages).
- `theme/` is the whole design system: `palette.ts`/`tokens.ts`/`resolver.ts` (color ramps,
  `--app-*`/`--color-*` variables, light and dark), `theme.ts` and `components.ts` (Mantine
  component defaults and variants, styled by `components.module.css`: `Paper variant="row"`,
  `Text variant="eyebrow" | "score"`, scrolling `Tabs.List`), `sport.ts` + `sport.css` (the padel-blue / tennis-green accent: put `data-sport` on a row or page via `sportProps()`, read `var(--sport-accent)`, never hand-pick the colors; `color="live"` is the separate live signal) and fonts (Onest body, Geologica headings, JetBrains Mono codes; all with Cyrillic, so Russian names match Latin ones). Use `court` for primary UI,
  `tennis` for that sport and the semantic success/warning/danger colors; no screen-specific hex
  colors.
- `ui/` reusable presentational components (`PageHeader`, `Section`, `EmptyState`, `EventRow`,
  `StatusBadge`, `StatTile`, `ResponsiveSheet`/`BottomDrawer`, `ConfirmAction`, `CopyField`,
  `QrSheet`, `ScoreDigits`, `ScoreStepper`, `MutationError`). Check here before building a new one.
- `shell/` the chrome: `AppLayout` (Mantine `AppShell`), `TopBar`, `PagesNav`, bottom nav,
  menu sheet, `SupportFooter` (Ko-fi + GitHub, on every page, keep it), display menu.
- `features/` one folder per area: `hub` (admin home), `create` (tournament form: team builder,
  group draw, play-off options, convert-from-lobby), `mexicano` (shared scoring options),
  `tournaments` (workspace, match cards, standings, bracket, scoring), `lobbies`, `organization`
  (clubs, club events and pins, communities, users), `players` (admin profiles), `player` (Player
  Hub), `events` (public directory), `switcher` (dock, palette, open items), `info` (guide and
  schema generator). `admin/` holds the tournament settings drawer, player codes, play-offs and
  account pages; `player/` the Hub session and API; `events/` the anonymous events API.
- `i18n.ts` + `locales/es.json` and `locales/ru.json`: English text is the key; every new `t('...')`
  string (and every `success:`/thrown message) needs a Spanish and a Russian entry, checked by
  `scripts/check_react_i18n.py` and `scripts/check_ru_style.py`.
  Never translate API enum values, IDs, routes or user-entered names. Language, theme and interface size live in
  `shell/DisplayMenu.tsx` (`amistoso-lang`, `amistoso-theme`, `amistoso-ui-scale`).
- `auth.tsx` (admin session, `padel-auth-*` keys, demo start) and `player/session.tsx` (Hub session)
  stay separate: query keys `['admin', ...]`, `['player', ...]`, `['public', ...]`; `playerApi` must
  never read `padel-auth-token` (guarded by `tests/test_react_frontend_guards.py`).

CSS budget: styling is the theme plus CSS modules next to components. The only global CSS is
`src/app.css` and the player-codes print sheet (`admin/tournament/tournament.css`), at most 80
lines together, and no `.mantine-*` selectors outside `src/theme/`. Both are enforced by
`tests/test_react_frontend_guards.py`.

PWA: `backend/api` templates `/service-worker.js` from `frontend/service-worker.js`
(`CACHE_NAME` gets a hash of the built `index.html`; `/*__SPA_ASSETS__*/` becomes the list of
hashed shell files in `dist/.vite/manifest.json`; the chart and Info chunks are left out of the
precache and cached on first use). Bump `CACHE_NAME` when the worker itself changes.
`src/pwa/install.ts` holds the `beforeinstallprompt` listener behind `useInstall()`.

Domain notes: the Player Hub (`features/player`, `player/`) uses `padel-player-profile*` keys
independently of organizer auth; entry tokens are exchanged at `/{tid}/player-auth` before score
submission, and an admin JWT is never passed to a player action. The public event directory
(`features/events`, `/api/public-events`) is anonymous and must not attach tokens; private
tournaments and unlisted/closed registrations stay absent.

`src/features/tv`, `src/features/register` and `src/features/club` are the public spectator screen (`/tv/:slug`),
sign-up (`/register/:slug`) and club landing (`{club}.{domain}/` and `/club/:slug`); `shell/NotFound.tsx` is the 404 page.
All are anonymous: they use `publicApi` or `playerApi` with an explicit token and never read `padel-auth-token`.
`backend/api/__init__.py` serves each through `_spa_response` (legacy page when there is no build): `/tv/{rest:path}`,
`/register/{rest:path}`, `/club/{rest:path}`; the `subdomain_router` middleware serves the shell with
`<meta name="amistoso-club" content="slug">` for a known club, and `_serve_404_page` serves it with status 404 and
`<meta name="amistoso-home">`. The TV page names its tournament to the one shell SSE connection with
`shell/followTournament.ts` (it never opens its own stream). TV type uses the `--fs-tv-*` tokens and `size="tv"`
(theme/tokens.ts); the TV route hides the app header and keeps the Ko-fi + GitHub footer, as the legacy page did.
Own-score actions on the TV page reuse `features/player/MatchActions` and `ScoreSheet` with the tournament token
(`useTvPlayer`, stored under the legacy `padel-player-<tid>` key). Tests: `e2e/tv|register|club|notfound.spec.ts`,
`tests/test_public_spa_routes.py`.

The legacy pages (vanilla JS, HTML, CSS, no build step) are the no-build fallback. Do not add features to them.
FastAPI serves them at `/legacy/admin`, `/legacy/events`, `/legacy/player`, `/legacy/tv/{slug}`,
`/legacy/register/{alias}` and `/legacy/club` (`/legacy` -> `/legacy/admin`; old `/legacy-*` paths 308 there).
**Nothing links to them**: the React app has no `/legacy` link, demo onboarding and invite / password-reset links
land on `/admin/...` React routes, and `manifest.json` / `service-worker.js` start and cache the React shell.
They are not deleted. Removing them is a separate decision. The files are `index.html` and `admin-*.js` (admin),
`player.html`/`player.js`, `public.html`/`tv.js`, `register.html`/`register.js` and `club.html`/`club.js`.
Shared files: `shared.js`, `auth.js`, `i18n.js`, `theme.css`. `tests/test_static_assets.py` and
`tests/js/legacy_language.mjs` guard them.

It's a working PWA (`manifest.json` + `service-worker.js`, cache-first static/
network-first HTML). Any new or renamed static file must be added to `service-worker.js`
`STATIC_ASSETS`/`SHELL` with `CACHE_NAME` bumped, or clients on a stale cache won't see it. `SPA_PREFIXES` lists the
React sections (`/admin /player /events /tv /register /club`).

`react-plan.md` (repo root, untracked) is the status document for the React migration. `refresh-plan.md` is the
old Petite-Vue plan. It applies to the legacy pages only.

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
  behavior, and the legacy pages. `tests/test_react_frontend_guards.py` and
  `tests/test_public_spa_routes.py` guard the React shell and its routes.

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
