# Torneos Amistosos

A lightweight Python app for organising **padel** and **tennis** tournaments. Three formats are supported:

| Format | Description |
| --- | --- |
| **Group + Play-off** | Round-robin groups → single or double-elimination bracket |
| **Mexicano** | Rating-based pairing each round, fixed total points per match, with optional seeded play-offs |
| **Direct Play-offs** | Skip the group stage — seed participants and play a bracket immediately |

**Live demo:** [padel-amistoso.onrender.com](https://padel-amistoso.onrender.com) — login with `admin` / `admin`
> Free tier — app may take ~30 s to wake up after inactivity. Data resets on restart. **Don't use for real tournaments!**

---

## Project status

Prototype, still evolving. Built with heavy AI assistance by one DS person with very basic knowledge of frontend. Expect bugs and API changes.

---

## For organizers

### Creating a tournament

Pick a **format** and **sport** (Padel or Tennis) at creation time. The engine is identical for both — labels adapt accordingly (Team/Player mode → Doubles/Singles).

**Group + Play-off:**
1. Players/teams are split into groups for round-robin play.
2. Top N from each group advance to a bracket (single or double elimination).
3. In double elimination, a team needs two losses to be knocked out — the winners- and losers-bracket champions meet in a Grand Final.

**Mexicano:**
1. Each round pairs players dynamically based on current rankings.
2. Scores update a cumulative leaderboard after each round.
3. Pairings for the next round are proposed automatically (or can be overridden).
4. After a set number of rounds (or in rolling mode, whenever you decide), the tournament moves to a seeded play-off.
5. In individual mode, top players are paired into teams (#1+#2, #3+#4, …) before entering the bracket.

The engine has several tuning knobs (skill-gap grouping, win bonus, strength weighting, etc.) — see the API docs for details.

**Direct Play-offs:** skip the group stage and go straight to a bracket.

### Registration lobbies

Create a sign-up lobby and share the link with participants. Players self-register with their name (and any custom questions you configure). Once sign-ups close, convert the lobby to a real tournament with one click — player credentials carry over automatically.

### Player codes

Every player automatically gets a unique **passphrase** (e.g. `brave-little-tiger`) and a **QR code**. Open the 🔑 Player Codes panel to view, copy, print, or regenerate credentials for individual players.

### During the tournament

- **Record scores** as points or best-of-3 sets (where the format supports it).
- **Match comments**: add a short note to any match (e.g. "Moved to Court 2") — visible on the public screen.
- **Announcement banner**: broadcast a message to all participants on the public screen.

### TV display

Each tournament has a public TV view at `/tv/<id>`, or a custom alias like `/tv/summer-cup`. Configure which sections appear (standings, bracket, match list), the refresh mode, and bracket rendering from the Admin → TV Settings panel.

### Exporting results

Once a champion is determined, export a self-contained HTML or PDF summary with an embedded bracket diagram and optional full match history.

---

## For players

### Self-registration

If the organizer opened a registration lobby, visit the shared link and fill in your name to sign up.

### Public TV view

The read-only TV view (`/tv/<tournament-id-or-alias>`) shows live standings, the bracket, and match results — no login needed. Works well on a big screen.

### Self-scoring

Players can submit scores for their own matches without an admin account:

1. On the public view, click **Login** and enter your passphrase (or scan the QR code the organizer shared with you).
2. Once logged in, a "Record Score" form appears on your pending matches.

The organizer can disable self-scoring at any time from the TV Settings panel.

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
- User data is stored in `data/padel.db` (same SQLite database as tournaments)
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

Open <http://localhost:8000> in your browser. Interactive API docs are at `/docs` (Swagger) and `/redoc`. The `--reload` flag restarts the
server automatically whenever you edit Python files.

### Stopping and restarting

Press **Ctrl+C** to stop the server. All tournament data is persisted to
`data/padel.db` (SQLite) automatically after every score entry, round advance,
or play-off action. When you restart, all tournaments resume exactly where
they left off — just open the app and click the tournament you were working on.

You can choose a custom data directory by setting **`PADEL_DATA_DIR`**:

```bash
PADEL_DATA_DIR=/path/to/my/data uv run uvicorn backend.api:app --reload --port 8000
```

If not set, it defaults to `data/` inside the project root.

To **reset all data** (start completely fresh), delete the database file inside
your data directory:

```bash
rm data/padel.db          # default location
# or
rm /path/to/my/data/padel.db
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
`data/padel.db`.  To run two (or more) truly isolated instances, point
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
    store.py               – User persistence (SQLite)
  tournaments/             – Tournament logic
    group_stage.py         – Group-stage round-robin logic
    pairing.py             – Shared 2v2 pairing and history utilities
    playoff.py             – Single & double elimination brackets
    group_playoff.py       – Orchestrator: groups → play-offs
    mexicano.py            – Mexicano tournament engine (+ play-off support)
    player_secrets.py      – Passphrase & token generation for player auth
  api/                     – FastAPI REST API
    state.py               – In-memory state & SQLite persistence
    schemas.py             – Pydantic request/response models
    helpers.py             – Shared serialisation utilities
    routes_crud.py         – List, delete, TV settings, and alias endpoints
    routes_gp.py           – Group+play-off endpoints
    routes_mex.py          – Mexicano endpoints
    routes_player_auth.py  – Player self-scoring auth (passphrase, QR, secrets)
    routes_schema.py       – Bracket diagram preview endpoint
    player_secret_store.py – CRUD for player passphrase/token secrets (SQLite)
  viz/                     – Visualisation utilities
    bracket_schema.py      – networkx/matplotlib bracket diagram renderer
data/
  padel.db                 – Auto-generated; SQLite database (tournaments + users)
frontend/
  index.html               – Single-page admin UI (vanilla HTML/CSS/JS)
  public.html              – Read-only TV display view
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
  test_player_auth.py      – Player self-scoring authentication
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
| `tests/test_player_auth.py` | Player self-scoring authentication |
| `tests/test_playoff.py` | Single/double elimination bracket logic |
| `tests/test_helpers.py` | Shared helper utilities |

---

## License

This project is licensed under the **GNU General Public License v3.0**.

See the [LICENSE](LICENSE) file for full terms.
