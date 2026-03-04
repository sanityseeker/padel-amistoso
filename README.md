# Padel Tournament Manager

A lightweight Python app for organising padel tournaments.
Two tournament formats are supported:

| Format | Description |
| --- | --- |
| **Group + Play-off** | Round-robin group stage → single or double-elimination bracket |
| **Mexicano + Play-offs** | Rating-based pairing each round, fixed total points per match, with optional seeded play-offs |

**Live demo:** [padel-amistoso.onrender.com](https://padel-amistoso.onrender.com) — login with `admin` / `admin`
> Free tier -- app may take ~30 seconds to wake up after inactivity. Data resets on restart. **DO NOT use for actual tournaments!**

---

## Project status & preamble

This project is currently a **draft/prototype** and is still evolving.

It was built over several hours with **heavy AI assistance** (architecture,
feature iteration, and refactors), then manually reviewed and adjusted.
Expect ongoing changes in behavior, naming, and API details while the design
is refined.

---

## Functional overview

### Frontend capabilities

- Create and manage **Group + Play-off** tournaments
- Create and manage **Mexicano** tournaments (with optional play-offs)
- Record scores as either:
  - raw points, or
  - tennis-style sets (for group/play-off flows where enabled)
- View standings, pending matches, round history, and champion state
- Generate tournament schema diagrams (Tools tab)
- Generate play-off schema directly from the GP play-offs page
- Export tournament outcome as an HTML or PDF document (with embedded bracket)
- Choose UI theme (Dark/Light), persisted in browser storage
- Switch UI language (English/Spanish) from the admin and TV views
  - Default language is **English**
  - Language preference is persisted per browser session/profile (localStorage)
- Display a read-only **TV view** optimised for a guest view of a tournament (`/tv?tid=<id>`)

### Group + Play-off flow

1. Players/teams are distributed into groups.
2. Each group plays round-robin.
3. Top `N` from each group advance.
4. A play-off bracket is seeded and played to champion.

### Double-elimination logic (brief)

- Bracket has a **Winners path** and a **Losers path**.
- A team is eliminated only after **two losses**.
- Teams dropping from winners feed into losers rounds.
- Winners-bracket champion meets losers-bracket champion in Grand Final.
- If needed by format state, a reset/follow-up final may be used to resolve
  the second-loss condition.

### Mexicano flow

1. Each round forms competitive 2v2 matches from ranking state.
2. Scores update cumulative leaderboard.
3. Next-round pairings are proposed/selected (or manually overridden).
4. After configured rounds (or rolling mode), tournament can move to play-offs.
5. In **individual mode**, selected players are paired into teams
   (`#1+#2`, `#3+#4`, …) before entering play-offs.

### TV display mode

Each tournament can be displayed on a secondary screen via the TV view at
`/tv?tid=<tournament-id>`.  Content, layout, and refresh behaviour are
configured in the **Admin → TV Settings** panel:

- Toggle which sections appear: standings/groups, bracket, match list, round history
- Set the **refresh mode**: *On-update* (polls the version counter and reloads
  only when the tournament changes), *Never* (static snapshot), or a fixed
  interval (1 s – 10 min)
- Adjust schema rendering: box scale, line width, arrow scale, title font scale

The TV view is served from `frontend/tv.html` and uses the same REST API as
the main UI.

### UI preferences persistence

The frontend persists user-level display preferences in browser localStorage:

- `padel-theme` → selected theme (`dark` / `light`)
- `padel-lang` → selected language (`en` / `es`)

If no language is stored yet, the app defaults to English.

### Tournament aliases

Each tournament can optionally have a **human-friendly alias** that provides
a short, memorable URL for the TV display mode (or API access).

**Setting an alias:**

*Via the web UI:* Open any tournament and expand the **📺 TV Mode Controls**
card. Enter your desired alias in the input field and click "Set Alias".
The alias is displayed alongside the full URL you can copy.

*Via the API:*

```bash
curl -X PUT http://localhost:8000/api/tournaments/t123/alias \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"alias": "summer-cup"}'
```

**Using the alias:**

Instead of `/tv?tid=t123`, you can now use:
- `/tv?t=summer-cup`

Aliases work in the TV picker as well — you can type an alias directly into
the input field.

**Alias rules:**
- Must be 1-64 characters
- Only alphanumeric characters, hyphens, and underscores: `[a-zA-Z0-9_-]`
- Must be unique across all tournaments
- Can be changed or removed at any time

**Deleting an alias:**

*Via the web UI:* Click the "✕ Remove" button next to the alias input field.

*Via the API:*

```bash
curl -X DELETE http://localhost:8000/api/tournaments/t123/alias \
  -H "Authorization: Bearer <token>"
```

**Resolving an alias** (public endpoint):

```bash
curl http://localhost:8000/api/tournaments/resolve-alias/summer-cup
```

Returns:
```json
{
  "id": "t123",
  "name": "Summer Championship 2026",
  "type": "group_playoff"
}
```

Aliases are particularly useful for TV displays where you want a stable,
memorable URL that won't change even if you need to recreate tournaments
or manage multiple events throughout a season.

### Export outcome

The **Export** card (visible once the tournament has a champion) lets you
download a self-contained summary document:

- **Format**: HTML (single file) or PDF (via browser print)
- **Embedded bracket diagram** — PNG preview of the play-off schema
- **Match history toggle** — optionally include all recorded match results

---

### Mexicano tuning variants (brief)

The engine can be tuned with these parameters:

- `skill_gap`:
  - `None` → snake-draft distribution across courts/groups,
  - integer → groups constrained by absolute estimated-score gap.
- `win_bonus`: flat leaderboard bonus for winners.
- `strength_weight`: scales points by opponent estimated strength.
- `loss_discount`: multiplies losing-team credited points.
- `balance_tolerance`: allows optimizer to trade score-balance strictness for
  matchup novelty.
- `num_rounds = 0` (rolling mode): unlimited rounds until manually advancing.

When players have unequal games played (sit-outs), estimated-score logic is used
to keep grouping/strength effects fair.

---

## Authentication

All tournament mutations (creating tournaments, recording scores, advancing
rounds) require authentication. Read-only endpoints (viewing tournaments,
fetching standings) are public.

### Default credentials

On first startup, a default admin user is created automatically:

- **Username**: `admin`
- **Password**: `admin`

**⚠️ Change this password immediately in production!**

### Logging in

**Via the web UI**: When you try to create a tournament or perform any action
that requires authentication, a login dialog will appear automatically. Enter
your credentials and the JWT token will be stored in your browser's localStorage.

You can also click the **Login** button in the top navigation bar at any time.

**Via the API**: POST credentials to `/api/auth/login`:

```bash
curl -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin"}'
```

Response:
```json
{
  "access_token": "eyJhbGciOi...",
  "token_type": "bearer",
  "username": "admin"
}
```

**Use the token**: Include it in the `Authorization` header for protected endpoints:

```bash
curl -X POST http://localhost:8000/api/tournaments/group-playoff \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

Tokens expire after **7 days** by default.

**Logging out**: Click the **Logout** button in the top navigation bar to clear
your authentication token and return to the logged-out state.

### Managing users

Admin users can create, delete, and change passwords for other users:

```bash
# List all users
GET /api/auth/users

# Get current user info
GET /api/auth/me

# Create a new user
POST /api/auth/users
{
  "username": "referee",
  "password": "secure-password-123"
}

# Change a user's password
PATCH /api/auth/users/{username}/password
{
  "new_password": "new-secure-password"
}

# Delete a user (cannot delete yourself)
DELETE /api/auth/users/{username}
```

All user management endpoints require authentication and are admin-only.

### Security notes

- Passwords are hashed with **bcrypt** before storage
- JWT tokens are signed with **HS256**
- The JWT secret is read from `PADEL_JWT_SECRET` environment variable, or
  auto-generated and persisted to `data/.jwt_secret` on first run
- User data is stored in `data/users.pkl` (separate from tournament data)
- For production use:
  - Set a strong `PADEL_JWT_SECRET` via environment variable
  - Change the default admin password immediately
  - Consider setting up HTTPS with a reverse proxy (e.g., nginx, Caddy)
  - Review `ACCESS_TOKEN_EXPIRE_MINUTES` in `backend/auth/security.py`

---

## Prerequisites

- **Python 3.12+** — check with `python3 --version`
- **[uv](https://docs.astral.sh/uv/)** — fast Python package manager

Install `uv` if you don't have it yet:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

---

## Running locally

```bash
# 1. Clone the repo (or download and unzip)
git clone <repo-url>
cd padel-amistoso

# 2. Install dependencies (creates .venv automatically)
uv sync

# 3. Start the server
uv run uvicorn backend.api:app --reload --port 8000
```

Open <http://localhost:8000> in your browser. The `--reload` flag restarts the
server automatically whenever you edit Python files.

### Stopping and restarting

Press **Ctrl+C** to stop the server. All tournament data is persisted to
`data/tournaments.pkl` automatically after every score entry, round advance,
or play-off action. When you restart, all tournaments resume exactly where
they left off — just open the app and click the tournament you were working on.

You can choose a custom data directory by setting **`PADEL_DATA_DIR`**:

```bash
PADEL_DATA_DIR=/path/to/my/data uv run uvicorn backend.api:app --reload --port 8000
```

If not set, it defaults to `data/` inside the project root.

To **reset all data** (start completely fresh), delete the state file inside
your data directory:

```bash
rm data/tournaments.pkl          # default location
# or
rm /path/to/my/data/tournaments.pkl
```

### Running in a detached screen session

To avoid accidentally stopping the server (e.g. by closing the terminal),
run it inside a [GNU screen](https://www.gnu.org/software/screen/) session:

```bash
screen -dmS padel uv run python -m uvicorn backend.api:app --reload --port 8000
```

Useful screen commands:

| Action | Command |
| --- | --- |
| Attach to the session | `screen -r padel` |
| Detach (keep running) | **Ctrl+A** then **D** |
| Stop the server | `screen -XS padel quit` |
| List sessions | `screen -ls` |


### Running multiple independent instances in parallel

Each server process has its own in-memory state, but by default they all share
`data/tournaments.pkl`.  To run two (or more) truly isolated instances, point
each one at a separate data directory with the `PADEL_DATA_DIR` environment
variable:

```bash
# Instance A — port 8000, data in data/instance_a/
PADEL_DATA_DIR=data/instance_a uv run python -m uvicorn backend.api:app --port 8000

# Instance B — port 8001, data in data/instance_b/
PADEL_DATA_DIR=data/instance_b uv run python -m uvicorn backend.api:app --port 8001
```

Or as detached screen sessions:

```bash
screen -dmS padel_a bash -c 'PADEL_DATA_DIR=data/instance_a uv run python -m uvicorn backend.api:app --port 8000'
screen -dmS padel_b bash -c 'PADEL_DATA_DIR=data/instance_b uv run python -m uvicorn backend.api:app --port 8001'
```

Each instance saves and restores its own tournaments independently.

Then open <http://localhost:8000>.

---

## Project structure

```text
backend/
  models.py                – Core data models (Player, Match, Court, …)
  auth/                    – Authentication (JWT, bcrypt, user management)
    deps.py                – FastAPI dependency: get_current_user
    models.py              – User data model
    routes.py              – Auth endpoints (login, user CRUD)
    schemas.py             – Auth request/response schemas
    security.py            – JWT helpers and password hashing
    store.py               – User persistence (users.pkl)
  tournaments/             – Tournament logic
    group_stage.py         – Group-stage round-robin logic
    pairing.py             – Shared 2v2 pairing and history utilities
    playoff.py             – Single & double elimination brackets
    group_playoff.py       – Orchestrator: groups → play-offs
    mexicano.py            – Mexicano tournament engine (+ play-off support)
  api/                     – FastAPI REST API
    state.py               – In-memory state & pickle persistence
    schemas.py             – Pydantic request/response models
    helpers.py             – Shared serialisation utilities
    routes_crud.py         – List, delete, TV settings, and alias endpoints
    routes_gp.py           – Group+play-off endpoints
    routes_mex.py          – Mexicano endpoints
    routes_schema.py       – Bracket diagram preview endpoint
  viz/                     – Visualisation utilities
    bracket_schema.py      – networkx/matplotlib bracket diagram renderer
data/
  tournaments.pkl          – Auto-generated; persists all tournament state
  users.pkl                – Auto-generated; persists user accounts
frontend/
  index.html               – Single-page admin UI (vanilla HTML/CSS/JS)
  tv.html                  – Read-only TV display view
  auth.js                  – Auth module (login, token storage, API helpers)
  shared.js                – Shared utilities (theme, i18n, HTML escaping)
  i18n.js                  – Internationalisation engine (en/es translations)
tests/
  test_api.py              – Full HTTP API (tournaments, auth, scores)
  test_auth.py             – JWT authentication and user management
  test_group_playoff.py    – Group + playoff flow and bracket seeding
  test_group_stage.py      – Group stage round-robin logic
  test_helpers.py          – Shared helper utilities
  test_mexicano.py         – Mexicano scoring and pairing logic
  test_playoff.py          – Single/double elimination bracket logic
```

## Linting & formatting

This project uses [`ruff`](https://docs.astral.sh/ruff/) for both linting and formatting.

```bash
# Check for lint errors
uv run ruff check .

# Fix auto-fixable lint errors
uv run ruff check . --fix

# Check formatting
uv run ruff format --check .

# Apply formatting
uv run ruff format .
```

A **pre-commit hook** is included to run these checks automatically before every commit:

```bash
# Install the hook (one-time setup after cloning)
uv run pre-commit install

# Run manually against all files
uv run pre-commit run --all-files
```

Once installed, `ruff` will lint and format your staged files on every `git commit`. The commit is blocked if any issues can't be auto-fixed.

---

## Running tests

The test suite uses `pytest` and covers the full API, tournament logic, and
authentication flows via FastAPI's `TestClient` (no running server needed).

```bash
# Run all tests
uv run pytest tests/

# Verbose output (shows each test name)
uv run pytest tests/ -v

# Run a specific test file
uv run pytest tests/test_api.py -v

# Run a specific test class or function
uv run pytest tests/test_api.py::TestGroupPlayoffAPI -v
uv run pytest tests/test_api.py::TestGroupPlayoffAPI::test_create -v

# Run with coverage report
uv run pytest tests/ --cov=backend --cov-report=term-missing

# Stop on first failure
uv run pytest tests/ -x
```

### Test files

| File | What it covers |
| --- | --- |
| `tests/test_api.py` | Full HTTP API (tournaments, auth, scores) |
| `tests/test_auth.py` | JWT authentication, user management |
| `tests/test_group_stage.py` | Group stage round-robin logic |
| `tests/test_group_playoff.py` | Group + playoff flow, bracket seeding |
| `tests/test_mexicano.py` | Mexicano scoring and pairing logic |
| `tests/test_playoff.py` | Single/double elimination bracket logic |
| `tests/test_helpers.py` | Shared helper utilities |

---

## API Documentation

This project uses FastAPI's built-in automatic API documentation. Once the server is running, you can explore and test all endpoints interactively:

- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)  
  Interactive API explorer with request/response schemas and "Try it out" functionality
  
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)  
  Clean, three-panel documentation with search and deep linking

Both interfaces are automatically generated from route definitions and stay in sync with the code.

### Quick Reference

- **Authentication**: JWT-based auth with user management (`/api/auth/*`)
- **Tournaments**: CRUD operations for Group+Playoff and Mexicano formats (`/api/tournaments/*`)
- **Group+Playoff**: Group stage matches, standings, and playoff brackets (`/api/tournaments/{id}/gp/*`)
- **Mexicano**: Round-based scoring, pairing proposals, and optional playoffs (`/api/tournaments/{id}/mex/*`)
- **Visualization**: SVG bracket rendering with customizable styling (`/api/schema/*`)

All endpoints requiring authentication accept a JWT token via the `Authorization: Bearer <token>` header.

## What's next (iteration ideas)

- Replace pickle with SQLite for proper concurrent-safe persistence
- Add player-registration / check-in flow
- WebSocket push for automatic live-table refresh
- Print-friendly draw sheets
- Role-based access control (viewer vs. admin roles)
