# Torneos Amistosos

A platform for organising **padel** and **tennis** events. Run structured tournaments in multiple formats, open registration lobbies with custom questionnaires, and share a live public view with all participants — all from a single lightweight app.

Found a bug, unexpected behaviour, or have a suggestion? [Open an issue on GitHub](https://github.com/sanityseeker/padel-amistoso/issues/new).

Three tournament formats are supported:

| Format | Description |
| --- | --- |
| **Group + Play-off** | Round-robin groups → single or double-elimination bracket |
| **Mexicano** | Rating-based pairing each round, fixed total points per match, with optional seeded play-offs |
| **Direct Play-offs** | Skip the group stage — seed participants and play a bracket immediately |

**Live demo:** [padel-amistoso.onrender.com](https://padel-amistoso.onrender.com) — login with `admin` / `admin` for the full feature set (lobbies, clubs, communities, Player Hub, custom addresses, ...). On instances configured with a demo site, the login screen's **Open the demo sandbox** button takes you to a separate practice site that mints a **throwaway demo account** for you on arrival: no signup, but it's capped to **one active tournament** and a minimal admin surface, and the account plus all its data is **automatically deleted after 3 days**.
> Free tier — app may take ~30 s to wake up after inactivity. **Don't use for real tournaments!**

## Project status

Prototype, still evolving. Built with heavy AI assistance by one DS person with very basic knowledge of frontend. Expect bugs and API changes.

---

## Contents

**New here? Start with [Quick start](#quick-start), then skim [Using the app](#using-the-app). The deeper tuning and math live under [Reference](#reference).**

- [Quick start](#quick-start) — prerequisites, run it locally, stop/restart
- [Using the app](#using-the-app) — the day-to-day workflow for organizers and players
  - [For organizers](#for-organizers)
  - [For players](#for-players)
- [Reference](#reference) — the deep settings and formulas
  - [Mexicano advanced settings](#mexicano-advanced-settings)
  - [Seeding logic (play-offs)](#seeding-logic-play-offs)
  - [ELO rating system](#elo-rating-system)
  - [Authentication & API](#authentication--api)
- [Deployment & operations](#deployment--operations)
- [Development](#development)
- [License](#license)

> Tip: the running app has an in-app **Info** tab (top navigation) that walks through the same material with a guided player/organizer flow — often the fastest way to get oriented.

---

## Quick start

### Prerequisites

- **Python 3.12+** — check with `python3 --version`
- **[uv](https://docs.astral.sh/uv/)** — fast Python package manager

Install `uv` if you don't have it yet:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Run it locally

```bash
# 1. Clone the repo (or download and unzip)
git clone <repo-url>
cd padel-amistoso

# 2. Install dependencies (creates .venv automatically)
uv sync

# 3. Start the server
uv run uvicorn backend.api:app --reload --port 8000
```

Open <http://localhost:8000> in your browser and log in with the default `admin` / `admin`
account (see [Authentication](#authentication--api) to change it). Interactive API docs are
at `/docs` (Swagger) and `/redoc`. The `--reload` flag restarts the server automatically
whenever you edit Python files.

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

---

## Using the app

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

Mexicano has extensive scoring and pairing tuning knobs — see [Mexicano advanced settings](#mexicano-advanced-settings) in the Reference section.

**Direct Play-offs:** skip the group stage and go straight to a bracket — seed participants in the desired order and play immediately.

### Registration lobbies

Create a sign-up lobby and share the link with participants. Players self-register with their name (and any custom questions you configure). Once sign-ups close, convert the lobby to a real tournament with one click — player credentials carry over automatically.

You can also add **co-editors** (collaborators) to a registration lobby so multiple organizers can manage sign-ups together.

Tip for organizers: encourage players to link registrations to their **Player Hub** profile passphrase (or use matching email) so events appear automatically in their `/player` dashboard.

### Collecting payments

The platform never handles money. Instead, it keeps track of who has paid the organizer or club directly.

1. **Set the fee** on a lobby (Settings > Payments) or on a tournament created without a lobby (Settings > Payments). The fee is per player and the same for everyone; you can override the amount on a single row for a discount or waiver.
2. **Add payment methods** players should use: Bizum phone number, IBAN, Revolut or PayPal.me link, cash at the court, or free text. By default methods are shown only after a player has registered, since a phone number or IBAN is otherwise visible to anyone with the lobby link. Switch to "always" if you want them on the public page.
3. **Track status** from the Payments panel: each player shows as unpaid, reported, paid, waived, refund due or refunded. Use the "Mark paid" chips (cash, Bizum, transfer, other) or the status dropdown. A summary badge shows how many have paid and the total collected, and every change is written to an audit log with the organizer's name.
4. **Remind unpaid players** by email with one click. The message includes the amount, the methods and the player's transfer concept. Players without an email are listed as unreachable.

Each player gets a short **transfer concept** such as `PADEL-SUMMER-ANA` to write on their Bizum or bank transfer, so the lines on your statement match the names in the panel.

Payments survive the whole lifecycle of an event. Converting a lobby to a tournament carries the fee and all statuses over, and the same list is reachable from both views. Deleting a registrant, a player cancelling, or deleting the lobby flips paid rows to **refund due** instead of losing them, and they appear in a "Refunds pending" section. Because many groups settle after the event, players can still see and report payments from their Player Hub long after the registration link has gone stale.

### Communities and clubs

The app separates organizational scope into two layers:

- **Community**: the base scope used by tournaments and registration lobbies.
- **Club**: an optional layer on top of a community that adds branding, roster tools, tiers, seasons, and club-level collaboration workflows.

Recommended setup:

1. Create communities for each venue/league/event family.
2. Set your default community so new events are pre-assigned correctly.
3. Upgrade active communities to clubs when you need logo identity and long-term progression.
4. Organize events into club seasons to keep standings meaningful over time.

Operational notes:

- Community reassignment for tournaments and lobbies is immediate and intended for cleanup/migration.
- Clubs are the right place for recurring organizer teams, player tier ladders, and club-specific communications.

### Player codes

Every player automatically gets a unique **passphrase** (e.g. `brave-little-tiger`) and a **QR code**. Open the 🔑 Player Codes panel to view, copy, print, or regenerate credentials for individual players.

### During the tournament

- **Record scores** as points or best-of-3 sets (where the format supports it).
- **Per-match scoring format**: each match row has a format chip that opens a popover to set
  that match's input mode (points / sets), its points target (Mexicano rounds, standings are
  scaled to the tournament total) and its **third-set decider**: a full set, or a **match
  tie-break** (super tie-break to 10, win by 2, entered in the third-set boxes and shown as
  `6-4 3-6 [10-8]`). A match tie-break counts as one game in standings, ELO margins and the
  Player Hub instead of its raw points. The tournament-wide default decider lives in Admin →
  Settings → Scoring; matches with their own format keep it. Changing the target or decider
  of a finished match requires re-entering its score.
- **Player score confirmation flow**: choose how player-submitted scores are handled:
  - **Immediate**: submitted score is applied right away.
  - **Required**: submitted score stays pending until the opposing team accepts it, sends a correction, or escalates to the organizer.
- **Match comments**: add a short note to any match (e.g. "Moved to Court 2") — visible on the public screen.
- **Announcement banner**: broadcast a message to all participants on the public screen.
- **Co-editing**: share tournaments with other registered users as co-editors. Co-editors can manage rounds and scores, but only the owner/admin can delete the tournament or manage collaborators.
- **Roster updates**: add players mid-tournament (Mexicano and Group + Play-off during group phase), and remove players mid-tournament in Mexicano when they are not assigned to pending matches.
- **Player contacts + email delivery**: store player contact/email info and (when SMTP is configured) send credential reminders, round schedules, organizer announcements, and final results by email.

### TV display

Each tournament has a public TV view at `/tv/<id>`, or a custom alias like `/tv/summer-cup`. Configure which sections appear (standings, bracket, match list), the refresh mode, bracket rendering, and player score confirmation mode from the Admin → TV Settings panel.

### Exporting results

Once a champion is determined, export a self-contained HTML or PDF summary with an embedded bracket diagram and optional full match history.

## For players

### Self-registration

If the organizer opened a registration lobby, visit the shared link and fill in your name to sign up.

**Played before but forgot your code?** The registration page's "Played before?" section offers three ways back in: your passphrase/QR code, an email-based magic-link recovery, or — if you have neither — searching by name among past participants at the same club/community. A name match can't auto-link (names aren't unique or secret), so it raises a claim that the organizer approves from the lobby's admin panel; once approved, the participation (and its ELO/history) is merged into your Player Hub profile.

### Paying for an event

If the organizer set a fee, the registration confirmation and your returning-player view show the amount, the due date, the accepted methods with copy buttons, and your personal transfer concept. Pay the organizer directly, then press **I've paid**; your entry shows as reported until the organizer confirms it. Outstanding payments also appear in a "Pending payments" card in your Player Hub, so you can settle up after the event.

### Public TV view

The read-only TV view (`/tv/<tournament-id-or-alias>`) shows live standings, the bracket, and match results — no login needed. Works well on a big screen.

### Self-scoring

Players can submit scores for their own matches without an admin account:

1. On the public view, click **Login** and enter your passphrase (or scan the QR code the organizer shared with you).
2. Once logged in, a "Record Score" form appears on your pending matches.
3. If score confirmation is set to **Required**, the opposing team reviews the submission and can accept it, propose a correction, or escalate it for organizer resolution.

The organizer can disable self-scoring at any time from the TV Settings panel.

### Player Hub

Players can use a personal **Player Hub** at `/player` to track all their linked events in one place.

- **Access**: log in with your profile passphrase (and, if configured, email-based magic link).
- **Dashboard**: see active and finished tournaments/registrations, with quick links back to each event.
- **Career stats**: aggregated wins/losses/draws, points for/against, plus best teammates and toughest rivals.
- **Participant lookup**: search any participant you've played with/against and view together-vs-against records and win rates.
- **Linking events**: link by passphrase from registrations or use "Link existing" inside Player Hub; matching-email registrations can be auto-linked.

---

## Reference

Deeper knobs and formulas. You don't need any of this to run a basic event — reach for it
when you want to tune Mexicano, understand seeding, read the ELO math, or script the API.

### Mexicano advanced settings

All settings below can be provided at creation time and changed later via **Admin → Settings** (or the `PATCH /{tid}/mex/settings` API). Defaults are shown in parentheses.

#### Structural

| Setting | Default | Description |
| --- | --- | --- |
| `total_points_per_match` | `32` | Fixed point pool split between the two teams each match (e.g. 21-11, 16-16). |
| `num_rounds` | `8` | How many Mexicano rounds to play before moving to play-offs. Set to `0` for **rolling mode** — rounds continue until the organizer manually starts play-offs. |

#### Grouping & court balance

**`skill_gap`** (default: `null` — disabled)

Controls the maximum allowed estimated-score difference between any two players on the same court.

- `null` — players are grouped with a **snake draft** (rank 1 and 2 in the same group, then 3 and 4, etc.) regardless of score spread.
- e.g. `skill_gap = 10` — the engine only puts two players on the same court if their estimated scores differ by at most 10 points. If the top player has 60 pts and another has 75 pts, they will not share a court.

> When many players cluster near the top and a few are far behind, setting a `skill_gap` prevents beginners from being paired against much stronger players in later rounds.

**`balance_tolerance`** (default: `0.2`)

The cross-group optimizer tries to swap players between courts to reduce repeat pairings. This setting limits how much score imbalance the optimizer is allowed to introduce in exchange for pairing novelty.

- `0.2` — the optimizer accepts swaps that raise total court imbalance by at most 20% above the initial proposal.
- `0.0` — the optimizer never makes a swap that worsens imbalance at all (very conservative).
- `1.0` — the optimizer freely sacrifices up to 100% extra imbalance to avoid repeats.

#### Scoring modifiers

**`win_bonus`** (default: `0`)

Extra points added flat to the winning team's total, regardless of the margin.

Example with `total_points_per_match = 32` and `win_bonus = 3`:

| Result | Winner credited | Loser credited |
| --- | --- | --- |
| 20-12 | 20 + 3 = **23** | 12 |
| 17-15 | 17 + 3 = **20** | 15 |

> A win bonus rewards teams that win close matches more than just the raw point differential does, making winning (not just scoring) matter.

**`strength_weight`** (default: `0.0`, range `0.0–1.0`)

Scales points up for beating a stronger opponent. The multiplier is `1.0 + strength_weight × relative_strength`, where relative strength measures how much higher the opponents' per-match average is compared to your own team's (clamped to `[0, 1]`).

- `0.0` — disabled; raw points are credited as-is.
- `0.5` — if your opponents' average is ~50% above yours, your raw score is multiplied by ~1.5.
- `1.0` — maximum amplification; points roughly double when playing against much stronger opposition.

> Useful in open-level events where you want to reward upsets, not just reward players who happen to face weaker opponents.

**`strength_min_matches`** (default: `4`, range `0+`)

The strength multiplier is applied only when every player in the match has played at least this many non-skipped matches.

- `0` - always enabled from round 1.
- `4` - waits until ratings are more stable before scaling starts.

> Helps avoid large early-round swings, especially with late joins or sit-outs.

**`strength_win_factor` / `strength_draw_factor` / `strength_loss_factor`** (defaults: `1.0` / `0.75` / `0.5`, range `0.0-1.0`)

These factors control how much of the strength effect is kept for each outcome:

- Win: `strength_win_factor`
- Draw: `strength_draw_factor`
- Loss: `strength_loss_factor`

Applied multiplier:

`1.0 + strength_weight × relative_strength × outcome_factor`

Example with `strength_weight = 0.6` and `relative_strength = 0.5`:

| Outcome | Outcome factor | Multiplier |
| --- | --- | --- |
| Win | `1.0` | `1 + 0.6 × 0.5 × 1.0 = 1.30` |
| Draw | `0.75` | `1 + 0.6 × 0.5 × 0.75 = 1.225` |
| Loss | `0.5` | `1 + 0.6 × 0.5 × 0.5 = 1.15` |

> Common setup: `1.0 / 0.75 / 0.5` gives full effect on wins, medium on draws, and lower effect on losses.

**`loss_discount`** (default: `1.0`, range `0.0–1.0`)

Multiplier applied to losers' credited points (winners are never discounted).

- `1.0` — no change; losers get their raw points credited normally.
- `0.5` — losers only count 50% of their raw points toward the leaderboard.
- `0.0` — losers score 0 points regardless of how many they won.

Example with `total_points_per_match = 32`, `loss_discount = 0.5`:

| Result | Winner credited | Loser credited |
| --- | --- | --- |
| 20-12 | 20 | round(12 × 0.5) = **6** |
| 17-15 | 17 | round(15 × 0.5) = **8** |

> Combining `win_bonus` with `loss_discount < 1.0` creates a more pronounced gap between winners and losers, making it a "win-or-go-home" style leaderboard.

#### Repeat-avoidance weights

The engine tracks partner and opponent history and penalizes repeat pairings when proposing the next round.

**`teammate_repeat_weight`** (default: `2.0`)  
**`opponent_repeat_weight`** (default: `1.0`)

How heavily a repeated **partnership** or **opponent matchup** is penalized. Higher values → the engine works harder to avoid those repeats. The default of 2.0 / 1.0 means re-playing with the same partner is penalized twice as much as facing the same opponent again.

**`repeat_decay`** (default: `0.5`)

Makes distant repeats count less than recent ones. A repeat from K rounds ago carries weight `decay^K` instead of the full weight.

- `0.5` — a repeat from 2 rounds ago counts as `0.25×` the weight of a repeat from last round.
- `1.0` — all past repeats are equally penalized regardless of how long ago they occurred.
- `0.0` — only the immediately preceding round's pairings are considered.

> With many players (12+), repeat avoidance matters less, so you can lower these weights. With 8 players playing many rounds, it becomes critical to avoid people always landing on the same court.

**`partner_balance_weight`** (default: `0.0`)

Extra penalty for forming mismatched partner pairs within a team (e.g., pairing the tournament leader with the last-place player as partners).

- `0.0` — disabled; only cross-team balance and repeat history are considered.
- `0.5` — within-team partner balance contributes 50% as much as cross-team balance to the pairing quality score.
- `2.0` — strong pressure to pair players of similar strength as partners.

> Has no effect in team mode (partners are fixed). In individual mode it complements `skill_gap` — `skill_gap` is a hard cut-off on court assignment, while `partner_balance_weight` softly prefers equal-strength partnerships within a court.

### Seeding logic (play-offs)

- **Group + Play-off seeding** prioritizes finishing position inside each group (1st place seeds above 2nd place), then uses performance tie-breakers.
- When multiple groups feed a bracket, first-round pairing aims to avoid same-group collisions where possible.
- **Mexicano seeding** uses the leaderboard at the moment play-offs start.
  - If players have played different numbers of matches (e.g. sit-outs), ranking is driven primarily by **average points per match**, then total points and Buchholz.
  - If all players have played the same number of matches, ranking is driven primarily by **total points**, then average points and Buchholz.
- In Mexicano **individual mode**, selected players are converted into teams by pairing adjacent seeds (#1+#2, #3+#4, …); teams are then ordered by combined seed strength for bracket placement.
- Organizers can override automatic selection by explicitly choosing playoff participants, and can include external participants with a seed score.

### ELO rating system

An ELO rating tracks each player's relative skill across tournaments. Ratings update after every completed match and are visible in the **Player Hub** career stats.

#### Core formula

The engine uses a **margin-aware** variant of classic ELO. Instead of a pure win/loss binary, the actual outcome blends a binary component with a continuous score ratio:

$$S = \alpha \cdot W + (1 - \alpha) \cdot R$$

| Symbol | Meaning |
| --- | --- |
| $W$ | Binary result: 1 (win), 0.5 (draw), 0 (loss) |
| $R$ | Continuous ratio: $0.5 + (a - b) \;/\; (2 \cdot (a + b))$ |
| $\alpha$ | Blend weight (default **0.5**) — higher = more binary, lower = more margin-sensitive |

The expected score uses the standard ELO formula:

$$E = \frac{1}{1 + 10^{(R_{opp} - R_{player}) \;/\; 400}}$$

New players start at **1000**.

#### K-factor tiers

The K-factor controls how fast ratings change. New players move faster; experienced players are more stable.

| Matches played | K |
| --- | --- |
| ≤ 20 | 40 |
| ≤ 40 | 20 |
| > 40 | 10 |

#### 1v1 update

$$R'_{player} = R_{player} + K \cdot (S - E)$$

#### 2v2 update (partner-adjusted)

In doubles, the expected score uses team-average ratings:

$$E = E\!\left(\frac{R_{player} + R_{partner}}{2},\; \frac{R_{opp1} + R_{opp2}}{2}\right)$$

A **partner-strength adjustment** compensates for mismatched partnerships:

$$\text{adj} = \text{clamp}\!\left(1.0 - 0.25 \cdot \frac{R_{partner} - R_{player}}{400},\;\; 0.5,\;\; 1.5\right)$$

- Weaker partner → adj > 1 (amplifies wins, softens losses)
- Stronger partner → adj < 1

$$\Delta = K \cdot \text{adj} \cdot (S - E)$$

#### Minimum delta clamping

Winners always gain at least **+1** ELO and losers always lose at least **−1**, regardless of margin or expected score. This guarantees every result is meaningful.

#### Tennis matches

For tennis (set-based scoring), total games across all sets are summed into a single score pair before the ELO calculation.

#### Where the displayed numbers come from

Match counts and current ratings shown in the admin **Players** tab, the Player Hub
headers and chips, and every leaderboard are derived from the per-match ELO log, so
they always agree with each other:

- **Global** is the total across all communities and clubs, with the rating from the
  most recent rated match anywhere.
- **Community** and **club** scopes only count matches played in tournaments of that
  scope.
- A manual club ELO override (or applying a tier's base ELO) becomes the player's current
  club rating immediately and is listed in their ELO history as a manual adjustment. It
  does not count as a match, and the next rated match continues from the player's
  tournament rating.

### Authentication & API

All tournament mutations (creating tournaments, recording scores, advancing
rounds) require authentication. Read-only endpoints (viewing tournaments,
fetching standings) are public.

#### Default credentials

On first startup, a default admin user is created automatically:

- **Username**: `admin`
- **Password**: `admin`

**⚠️ Change this password immediately in production!**

#### Logging in

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

#### Managing users

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

#### Password reset by email

If SMTP is configured, users can reset forgotten passwords without admin intervention:

```bash
# Request reset link (always returns 204)
POST /api/auth/forgot-password
{
  "email": "user@example.com"
}

# Use token from email to set a new password
POST /api/auth/reset-password/{token}
{
  "new_password": "new-secure-password"
}
```

Reset links are single-use and expire automatically.

#### Security notes

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
  - Keep a **single app worker/process** per instance (state is process-local)
  - Tune SQLite contention handling via:
    - `PADEL_SQLITE_TIMEOUT_SECS` (default: `15`)
    - `PADEL_SQLITE_BUSY_TIMEOUT_MS` (default: `15000`)
    - `PADEL_SQLITE_SYNCHRONOUS` (`NORMAL` by default)

#### Payment endpoints

Organizer endpoints (JWT, lobby editor or tournament owner), available under both `/api/registrations/{rid}` and `/api/tournaments/{tid}`:

- `GET`/`PATCH .../payment-settings` — fee, currency, due date, instructions, methods, visibility.
- `GET .../payments` — rows with status plus a summary; `PATCH .../payments/{player_id}` — set status, method, amount override, note.
- `POST .../payments/remind-unpaid` — email everyone who is unpaid or reported.

Player endpoints: `POST /api/registrations/{rid}/player-payment-report` (lobby passphrase or token, moves unpaid to reported) and `GET`/`POST /api/player-profile/payments[/{key}/report]` (Player Hub profile JWT). Per-player payment data never appears in public or TV payloads.

---

## Deployment & operations

### SMTP email notifications (disabled by default)

Email notifications are **off by default** unless SMTP is configured.

- In `.env.example` and both Docker Compose files, SMTP values are set to `None` placeholders.
- In `backend/config.py`, `None` / `null` / empty values are treated as unset, so email stays disabled.

To enable SMTP, set these environment variables:

```bash
AMISTOSO_SMTP_HOST=smtp.gmail.com
AMISTOSO_SMTP_PORT=587
AMISTOSO_SMTP_USE_TLS=true
AMISTOSO_SMTP_USER=your_gmail_address@gmail.com
AMISTOSO_SMTP_PASS=your_google_app_password
AMISTOSO_FROM_EMAIL=your_gmail_address@gmail.com
AMISTOSO_SITE_URL=https://your-domain.com
```

For Gmail, use a **Google App Password** (not your normal account password), which requires 2-step verification.

Docker Compose note:
- `docker-compose.yml` uses `${VAR:-None}` defaults, so SMTP remains disabled unless you set real values in your shell or `.env` file.
- `docker-compose.nas.yml` also ships with `"None"` placeholders for the same reason.

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

### Production run notes (concurrency)

- Run one server process per instance (do **not** use multiple uvicorn workers for one data directory).
- This app keeps active tournament state in process memory and persists to SQLite.
- For ~50 concurrent users, this is typically sufficient when polling intervals remain moderate.
- If traffic grows, scale by running multiple isolated instances (different `PADEL_DATA_DIR`), not by adding workers to the same process.

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

### Running a demo instance

Demo mode is a second, fully isolated instance that hands out throwaway
sandbox accounts. The flow:

1. On the core instance's login dialog, "Open the demo sandbox" links to
   `AMISTOSO_DEMO_URL` with a `#start-demo` hash (and a note naming the
   separate host, so it's clear nothing on the core site is touched).
2. The demo instance sees `#start-demo`, strips it from the URL, and mints a
   `demo-xxxxxx` account straight away (once per browser tab), dropping the
   visitor on the Create tab. A banner shows the generated passphrase, which
   is the account password — usable to log in from other devices.
3. Visiting the demo instance directly shows a short "Your demo sandbox"
   explainer with a "Start a N-day sandbox" button. Returning demo users and
   the instance admin open the username/password form with "Already have a
   demo login? Log in". On a device that minted (or logged into) a sandbox,
   the dialog greets the visitor by username with the password field focused,
   or explains that the sandbox expired. Only the username is remembered
   locally, never the passphrase.

A sandbox can run one tournament at a time with a minimal admin surface — no
lobbies, clubs, communities, custom addresses, or Player Hub profiles. The demo
account and everything it created are permanently purged 3 days after the
account was minted (`AMISTOSO_DEMO_TTL_DAYS`, exposed to the frontend as
`demo_ttl_days` in `/api/config`). Because the demo instance has its own data
directory, the purge job never touches the core database. The demo instance
also sends `X-Robots-Tag: noindex` on its HTML pages, and club subdomains are
disabled entirely there: slug and landing-page edits return 403, `by-slug`
lookups 404, and any `{slug}.{domain}` request is redirected to the apex (root
page) or refused with 404 (everything else).

```bash
# Core — port 8000; the login dialog links to the demo instance
AMISTOSO_DATA_DIR=data/core AMISTOSO_DEMO_URL=https://demo.example.com \
  uv run python -m uvicorn backend.api:app --port 8000

# Demo — port 8001, isolated data dir, purge job enabled
AMISTOSO_DATA_DIR=data/demo AMISTOSO_DEMO_INSTANCE=1 PADEL_ADMIN_PASSWORD=... \
  uv run python -m uvicorn backend.api:app --port 8001
```

Note: the demo mint endpoint rate-limits by client IP (5 sandboxes per hour;
a 429 carries `Retry-After`); behind a reverse proxy the client address is the
proxy's unless forwarded headers are handled upstream (same caveat as the
login rate limit).

Then open <http://localhost:8000>.

---

## Development

### Project structure

The app has grown well beyond tournaments-only — registration lobbies, a
community/club hierarchy, a Player Hub with ELO, live TV views, and more — so
a file-by-file tree here would just go stale again. **[`CLAUDE.md`](CLAUDE.md)**
in the repo root has the maintained, current breakdown of every backend and
frontend module. At a glance:

```text
backend/
  models.py, auth/, tournaments/, api/, viz/  — engine, auth, REST layer, bracket diagrams
data/
  padel.db          – auto-generated SQLite database (tournaments, users, players)
frontend/
  index.html (admin), player.html (Player Hub), public.html (TV), register.html (lobbies), club.html
tests/
  pytest suite against the real app via FastAPI's TestClient — see tests/conftest.py for fixtures
```

### Linting & formatting

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

### Running tests

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

**Test files:** 30+ files under `tests/`, named after the feature area they cover rather than
a specific source module (e.g. `test_registration_recovery.py` and
`test_convert_registration.py` both cut across several `routes_*.py` files).
Check `tests/conftest.py` for shared fixtures before adding new ones.

### Releasing a new version

This project uses [`commitizen`](https://commitizen-tools.github.io/commitizen/) to automate version bumping, changelog generation, and git tagging.

Write commits using [Conventional Commits](https://www.conventionalcommits.org/) format:

```bash
# Interactive commit prompt (guides you through the format)
uv run cz commit

# Or write manually: feat:, fix:, chore:, docs:, refactor:, etc.
git commit -m "feat: add round-robin scheduling"
```

When ready to cut a release:

```bash
# Preview what version and tag would be created
uv run cz bump --dry-run

# Bump version in pyproject.toml, update CHANGELOG.md, and create a git tag
uv run cz bump

# Push the commit and the tag — this triggers the CI release pipeline
git push && git push --tags
```

Version increments follow semver based on commit history:
- `fix:` → patch (`0.3.0` → `0.3.1`)
- `feat:` → minor (`0.3.0` → `0.4.0`)
- `feat!:` or `BREAKING CHANGE:` footer → major (`0.3.0` → `1.0.0`)

---

## License

This project is licensed under the **GNU General Public License v3.0**.

See the [LICENSE](LICENSE) file for full terms.
