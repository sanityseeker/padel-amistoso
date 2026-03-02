# Padel Tournament Manager

A lightweight Python app for organising padel tournaments.
Two tournament formats are supported:

| Format | Description |
| --- | --- |
| **Group + Play-off** | Round-robin group stage → single or double-elimination bracket |
| **Mexicano + Play-offs** | Rating-based pairing each round, fixed total points per match, with optional seeded play-offs |

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
- Display a read-only **TV view** optimised for a wall screen (`/tv?tid=<id>`)

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

### Export outcome

The **Export** card (visible once the tournament has a champion) lets you
download a self-contained summary document:

- **Format**: HTML (single file) or PDF (via browser print)
- **Embedded bracket diagram** — PNG preview of the play-off schema
- **Match history toggle** — optionally include all recorded match results

---

### Mexicano tuning variants (brief)

The engine can be tuned with these parameters:

- `randomness`: adds jitter to reduce deterministic repeat pairings.
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
screen -dmS padel uv run uvicorn backend.api:app --reload --port 8000
```

Useful screen commands:

| Action | Command |
| --- | --- |
| Attach to the session | `screen -r padel` |
| Detach (keep running) | **Ctrl+A** then **D** |
| Stop the server | `screen -XS padel quit` |
| List sessions | `screen -ls` |

### Running on a different port

```bash
uv run uvicorn backend.api:app --reload --port 9000
```

### Running multiple independent instances in parallel

Each server process has its own in-memory state, but by default they all share
`data/tournaments.pkl`.  To run two (or more) truly isolated instances, point
each one at a separate data directory with the `PADEL_DATA_DIR` environment
variable:

```bash
# Instance A — port 8000, data in data/instance_a/
PADEL_DATA_DIR=data/instance_a uv run uvicorn backend.api:app --port 8000

# Instance B — port 8001, data in data/instance_b/
PADEL_DATA_DIR=data/instance_b uv run uvicorn backend.api:app --port 8001
```

Or as detached screen sessions:

```bash
screen -dmS padel_a bash -c 'PADEL_DATA_DIR=data/instance_a uv run uvicorn backend.api:app --port 8000'
screen -dmS padel_b bash -c 'PADEL_DATA_DIR=data/instance_b uv run uvicorn backend.api:app --port 8001'
```

Each instance saves and restores its own tournaments independently.

Then open <http://localhost:9000>.

---

## Project structure

```text
backend/
  models.py                – Core data models (Player, Match, Court, …)
  tournaments/             – Tournament logic
    group_stage.py         – Group-stage round-robin logic
    playoff.py             – Single & double elimination brackets
    group_playoff.py       – Orchestrator: groups → play-offs
    mexicano.py            – Mexicano tournament engine (+ play-off support)
  api/                     – FastAPI REST API
    state.py               – In-memory state & pickle persistence
    schemas.py             – Pydantic request/response models
    helpers.py             – Shared serialisation utilities
    routes_crud.py         – List & delete tournaments
    routes_gp.py           – Group+play-off endpoints
    routes_mex.py          – Mexicano endpoints
    routes_schema.py       – Bracket diagram preview endpoint
  viz/                     – Visualisation utilities
    bracket_schema.py      – networkx/matplotlib bracket diagram renderer
data/
  tournaments.pkl          – Auto-generated; persists all tournament state
frontend/
  index.html               – Single-page UI (vanilla HTML/CSS/JS)
  tv.html                  – Read-only TV display view
api-playground/
  index.html               – Interactive API request tester (manual calls)
tests/
  test_api.py
  test_group_playoff.py
  test_group_stage.py
  test_mexicano.py
  test_playoff.py
```

## API section

### Interactive API testing

This repo includes a dedicated interactive tester at:

- `/api-playground`

It is served from:

- `api-playground/index.html`

Use it to manually test endpoints with custom method/path/body and inspect raw
responses quickly. It also includes a few starter presets (list tournaments,
create GP, create Mexicano).

### OpenAPI docs

FastAPI auto-docs are also available:

- `/docs` (Swagger UI)
- `/redoc` (ReDoc)

## Running tests

```bash
uv run pytest tests/ -v
```

---

## API overview

| Method | Endpoint | Purpose |
| --- | --- | --- |
| **CRUD** | | |
| `GET` | `/api/tournaments` | List all tournaments |
| `POST` | `/api/tournaments/group-playoff` | Create group+playoff tournament |
| `POST` | `/api/tournaments/mexicano` | Create Mexicano tournament |
| `DELETE` | `/api/tournaments/{id}` | Delete a tournament |
| `GET` | `/api/tournaments/{id}/version` | Version counter (TV polling) |
| `GET` | `/api/tournaments/{id}/tv-settings` | Get TV display settings |
| `PATCH` | `/api/tournaments/{id}/tv-settings` | Update TV display settings |
| **Group + Play-off** | | |
| `GET` | `/api/tournaments/{id}/gp/status` | GP phase & champion status |
| `GET` | `/api/tournaments/{id}/gp/groups` | Group standings & matches |
| `POST` | `/api/tournaments/{id}/gp/record-group` | Record a group match score |
| `POST` | `/api/tournaments/{id}/gp/record-group-tennis` | Record group score from tennis sets |
| `POST` | `/api/tournaments/{id}/gp/start-playoffs` | Transition to play-offs |
| `GET` | `/api/tournaments/{id}/gp/playoffs` | Play-off bracket & matches |
| `GET` | `/api/tournaments/{id}/gp/playoffs-schema` | Render play-off bracket image |
| `POST` | `/api/tournaments/{id}/gp/record-playoff` | Record a play-off match score |
| `POST` | `/api/tournaments/{id}/gp/record-playoff-tennis` | Record play-off score from tennis sets |
| **Mexicano** | | |
| `GET` | `/api/tournaments/{id}/mex/status` | Leaderboard, phase & champion |
| `GET` | `/api/tournaments/{id}/mex/matches` | Current & past matches |
| `POST` | `/api/tournaments/{id}/mex/record` | Record a Mexicano match score |
| `GET` | `/api/tournaments/{id}/mex/propose-pairings` | Propose pairing options |
| `POST` | `/api/tournaments/{id}/mex/next-round` | Commit next Mexicano round |
| `POST` | `/api/tournaments/{id}/mex/custom-round` | Commit manually edited next round |
| `POST` | `/api/tournaments/{id}/mex/end` | End Mexicano rounds (open play-off decision) |
| `POST` | `/api/tournaments/{id}/mex/finish` | Finish tournament without play-offs |
| `GET` | `/api/tournaments/{id}/mex/recommend-playoffs` | Suggest play-off seeds |
| `POST` | `/api/tournaments/{id}/mex/start-playoffs` | Start Mexicano play-offs |
| `GET` | `/api/tournaments/{id}/mex/playoffs` | Play-off bracket & matches |
| `GET` | `/api/tournaments/{id}/mex/playoffs-schema` | Render Mexicano play-off bracket image |
| `POST` | `/api/tournaments/{id}/mex/record-playoff` | Record Mexicano play-off score |
| `POST` | `/api/tournaments/{id}/mex/record-playoff-tennis` | Record Mexicano play-off score from tennis sets |
| **Schema / Visualisation** | | |
| `GET` | `/api/schema/preview` | Bracket diagram (query params) |
| `POST` | `/api/schema/preview` | Bracket diagram (JSON body) |

All `*-schema` endpoints accept optional query parameters to control rendering:
`box_scale`, `line_width`, `arrow_scale`, `title_font_scale`.

## What's next (iteration ideas)

- Replace pickle with SQLite for proper concurrent-safe persistence
- Add player-registration / check-in flow
- WebSocket push for automatic live-table refresh
- Print-friendly draw sheets
- Authentication for tournament admins
