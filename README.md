# Torneos Amistosos

Torneos Amistosos is an app to organize **padel** and **tennis** events. With this app, you can:

- Run tournaments in three formats.
- Open registration lobbies with custom questions.
- Share a live public view with all players.

Did you find a bug or unexpected behavior, or do you have a suggestion? [Open an issue on GitHub](https://github.com/sanityseeker/padel-amistoso/issues/new).

The app supports three tournament formats:

| Format | Description |
| --- | --- |
| **Group + Play-off** | Round-robin groups, then a single-elimination or double-elimination bracket |
| **Mexicano** | New pairings each round from the ratings, a fixed total of points per match, and optional seeded play-offs |
| **Direct Play-offs** | No group stage: seed the players and play a bracket immediately |

You can try the app on two demo sites:

**Quick demo:** [demo.amistoso.club](https://demo.amistoso.club). Use this site to test the match generation: create a tournament, enter scores, and see how the app makes the next rounds and the brackets. When you arrive, the site creates a **temporary demo account** for you. You do not have to sign up. The login screen of the main site also has the button **Open the demo sandbox**, which opens this site. The account has these limits:

- It can have only **one active tournament** at a time.
- It has a limited set of admin functions.
- The app **deletes the account and all its data automatically after 3 days**.

**Full sandbox:** [padel-amistoso.onrender.com](https://padel-amistoso.onrender.com). Log in with `admin` / `admin` to use all features (lobbies, clubs, communities, Player Hub, custom addresses, and more).

> The full sandbox runs on a free tier. After a period with no use, the app can need approximately 30 s to start. **Do not use the demo sites for real tournaments.**

## Project status

This project is a prototype and it continues to change. One data scientist with basic frontend knowledge built it, with much help from AI tools. Bugs and API changes are possible.

---

## Contents

**If you are a new user, read [Quick start](#quick-start) first. Then read [Using the app](#using-the-app). The detailed settings and formulas are in [Reference](#reference).**

- [Quick start](#quick-start) — requirements, local installation, stop and restart
- [Using the app](#using-the-app) — the usual workflow for organizers and players
  - [For organizers](#for-organizers)
  - [For players](#for-players)
- [Reference](#reference) — the detailed settings and formulas
  - [Mexicano advanced settings](#mexicano-advanced-settings)
  - [Seeding logic (play-offs)](#seeding-logic-play-offs)
  - [ELO rating system](#elo-rating-system)
  - [Authentication & API](#authentication--api)
- [Deployment & operations](#deployment--operations)
- [Development](#development)
- [License](#license)

> Tip: the app has an **Info** tab in the top navigation. This tab gives the same information as steps for players and for organizers. It is frequently the fastest way to learn the app.

---

## Quick start

### Prerequisites

- **Python 3.12+** — to see your version, run `python3 --version`.
- **[uv](https://docs.astral.sh/uv/)** — a fast Python package manager.

If you do not have `uv`, install it:

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

# 3. Build the React admin (Node.js 22.12+; Node 24 recommended)
npm --prefix frontend/admin-app ci
npm --prefix frontend/admin-app run build

# 4. Start the server
uv run uvicorn backend.api:app --reload --port 8000
```

1. Open <http://localhost:8000> in your browser.
2. Log in as `admin` with the initial password printed in the server terminal
   (or the value of `PADEL_ADMIN_PASSWORD`, if set). To change this account,
   see [Authentication](#authentication--api).

The interactive API documentation is at `/docs` (Swagger) and `/redoc`. With the `--reload` flag, the server restarts automatically when you change a Python file.

### Stopping and restarting

To stop the server, push **Ctrl+C**.

The app saves all tournament data to `data/padel.db` (SQLite) automatically. It saves after each score entry, each new round, and each play-off action. When you restart the server, all tournaments continue from the same point. Open the app and click the tournament that you want to continue.

To use a different data directory, set **`PADEL_DATA_DIR`**:

```bash
PADEL_DATA_DIR=/path/to/my/data uv run uvicorn backend.api:app --reload --port 8000
```

If you do not set this variable, the app uses `data/` in the project root.

To **delete all data** and start again with an empty app, delete the database file in your data directory:

```bash
rm data/padel.db          # default location
# or
rm /path/to/my/data/padel.db
```

---

## Using the app

## For organizers

### Creating a tournament

When you create a tournament, select a **format** and a **sport** (Padel or Tennis). The engine is the same for the two sports. Only the labels change: Team mode and Player mode become Doubles and Singles.

**Group + Play-off:**

1. The app puts the players or teams into groups. Each group plays a round-robin.
2. The top N of each group go to a bracket (single elimination or double elimination).
3. In double elimination, a team is out after two losses. The champion of the winners' bracket and the champion of the losers' bracket play a Grand Final.

**Mexicano:**

1. In each round, the app makes new pairings from the current rankings.
2. After each round, the scores update a cumulative leaderboard.
3. The app proposes the pairings for the next round automatically. You can change them.
4. After a set number of rounds, the tournament goes to a seeded play-off. In rolling mode, you decide when this happens.
5. In individual mode, the app puts the top players into teams (#1+#2, #3+#4, …) before the bracket starts.

Mexicano has many settings for scoring and pairing. See [Mexicano advanced settings](#mexicano-advanced-settings) in the Reference section.

**Direct Play-offs:** there is no group stage. Seed the players in the order that you want, and play the bracket immediately.

### Registration lobbies

1. Create a sign-up lobby.
2. Send the link to the players. Players register themselves with their name and answer the custom questions that you set.
3. When the registration closes, convert the lobby into a tournament with one click. The player passphrases stay the same.

You can also add **co-editors** (collaborators) to a registration lobby. Then more than one organizer can manage the registrations.

Tip for organizers: tell players to link their registrations to the passphrase of their **Player Hub** profile, or to use the same email. Then the events show automatically on their `/player` dashboard.

### Collecting payments

The app does not process money. It only records which players paid the organizer or the club directly.

1. **Set the fee** on a lobby (Settings > Payments), or on a tournament without a lobby (Settings > Payments). The fee is per player, and it is the same for all players. To give a discount or a waiver, change the amount on the row of that player.
2. **Add the payment methods** that players must use: Bizum phone number, IBAN, Revolut or PayPal.me link, cash at the court, or free text. By default, a player sees the methods only after registration. This is because otherwise each person with the lobby link can see a phone number or an IBAN. To show the methods on the public page, select "always".
3. **Monitor the status** in the Payments panel. Each player has one status: unpaid, reported, paid, waived, refund due, or refunded. To change a status, use the "Mark paid" chips (cash, Bizum, transfer, other) or the status drop-down list. A summary badge shows the number of players who paid and the total amount. The app records each change in an audit log, with the name of the organizer.
4. **Send a reminder to unpaid players** by email with one click. The message contains the amount, the methods, and the transfer reference of the player. The panel lists players without an email as unreachable.

Each player gets a short **transfer reference**, for example `PADEL-SUMMER-ANA`. The player writes it on the Bizum payment or the bank transfer. Then the lines on your bank statement match the names in the panel.

Payment data stays valid for the full life of an event:

- When you convert a lobby into a tournament, the fee and all statuses stay the same. The two views show the same list.
- In these cases, a paid row changes to **refund due**: you delete a registered player, a player cancels, or you delete the lobby. The app does not delete the row. It shows the row in a "Refunds pending" section.
- Many groups pay after the event. Thus players can see and report payments in their Player Hub, also after the registration link stops working.

### Communities and clubs

The app has two levels of scope:

- **Community**: the base scope of tournaments and registration lobbies.
- **Club**: an optional level on top of a community. A club adds branding, player-list tools, tiers, seasons, and tools for club teams.

Recommended setup:

1. Create one community for each venue, league, or group of events.
2. Set your default community. Then the app assigns new events to the correct community.
3. When an active community needs a logo and long-term progression, change it into a club.
4. Put the events into club seasons. Then the standings stay meaningful over time.

Operational notes:

- When you move a tournament or a lobby to a different community, the change is immediate. Use this function to clean up or migrate data.
- Use clubs for organizer teams that run regular events, for player tier ladders, and for club communications.

### Player codes

The app gives each player a unique **passphrase** (for example, `brave-little-tiger`) and a **QR code** automatically. In the Players tab (Admin → Settings → Players), you can see, copy, print, or generate again the passphrase of each player. The same tab has the **Withdraw** action (see [Withdrawing a participant](#withdrawing-a-participant)).

### During the tournament

- **Record scores** as points or as best-of-3 sets (if the format supports it).
- **Scoring format of each match**: each match row has a format chip. The chip opens a popover with these settings:
  - The input mode (points or sets).
  - The points target (for Mexicano rounds). The app scales the standings to the total of the tournament.
  - The **third-set decider**: a full set, or a **match tie-break**. A match tie-break is a super tie-break to 10, with a 2-point lead to win. You enter it in the third-set boxes, and the app shows it as `6-4 3-6 [10-8]`. In the standings, the ELO margins, and the Player Hub, a match tie-break counts as one game, not as its points.

  The default decider of the tournament is in Admin → Settings → Scoring. A match with its own format keeps that format. If you change the target or the decider of a finished match, you must enter its score again.
- **Confirmation of player scores**: select how the app processes scores from players:
  - **Immediate**: the app applies the score immediately.
  - **Required**: the score stays pending until the opponent team does one of these actions: it accepts the score, it sends a correction, or it sends the score to the organizer.
- **Match comments**: add a short note to a match (for example, "Moved to Court 2"). The public screen shows the note.
- **Announcement banner**: show a message to all players on the public screen.
- **Co-editing**: share a tournament with other registered users as co-editors. Co-editors can manage rounds and scores. Only the owner or an admin can delete the tournament or manage the collaborators.
- **Player list changes**: you can add players during the tournament (in Mexicano, and in Group + Play-off during the group phase). In Mexicano rounds, you can also remove a player if the player has no pending match. In the other cases, use [Withdraw](#withdrawing-a-participant).
- **Player contacts and email**: record the contact data and email of each player. If SMTP is configured, the app can send these emails: passphrase reminders, round schedules, organizer announcements, and final results.

### Withdrawing a participant

In Admin → Settings → **Players**, each row has a **Withdraw** button (Withdraw team for a team member). The confirm dialog shows what changes before you confirm. The app selects the rule from the format and the phase:

| Where | What happens | Undo |
|---|---|---|
| Group stage, fixed teams or singles | **The 50% rule.** If the entry played fewer than half of its group matches, all its group results are **annulled** and it leaves the group. If it played half or more, the played results stand and its remaining matches become **walkovers (W/O)** for the opponents. | Yes, during the group stage, while the group roster does not change |
| Group stage, rotating partners | The person is **left out of all following rounds**. Played matches stay. If the person has an unplayed match in the current round, that match is removed and its other three players sit out this round (they play first in the next round). | Yes, until the next round is generated |
| Any play-off bracket (Group + Play-off, Play-offs, Mexicano play-offs) | **Forfeit.** The pending match becomes a walkover and the opponent advances. If the opponent is not known yet, the walkover is recorded as soon as it is known. In double elimination, the entry does not play in the losers bracket: that opponent also advances by walkover. The same applies to a 3rd-place match. | No |
| Mexicano rounds | Use the existing remove button (unchanged). | No |

Rules for all cases:

- Withdrawing a member of a team withdraws the **whole team**.
- The **walkover score** is entered winner first. The defaults are 6-0 (points) and 6-0 6-0 (sets). You can edit it; the app checks it against the match format (for example, a match tie-break must be won 10-8 or better).
- **Walkovers count in the standings but are never ELO-rated.** Annulled results are removed from the ELO history (the app recalculates the tournament and the club ratings).
- A withdrawal is blocked while one of the entry's scores waits for confirmation, is disputed, or waits for a format review. Settle that score first.
- Withdrawn entries stay in the standings (struck through, last, with a "Withdrawn" badge) and cannot be selected for the play-offs. Annulled entries disappear from the table and leave a note under the group.
- The withdrawn player's login code stays active. The app sends no push notification about the withdrawal. If a walkover decides the final, the usual champion notification is sent.
- If you clear or change the result of a match that fed a walkover, the app clears that walkover first and records it again once the new opponent is known. A match that was really played after it still blocks the clear.
- A walkover score is captured when you withdraw. If you change a stage's score mode later, walkovers that are created later still use the captured mode (unless the match has its own format).

### TV display

Each tournament has a public TV view at `/tv/<id>`, or at a custom alias, for example `/tv/summer-cup`. In the Admin → TV Settings panel, you can set:

- The sections that the page shows (standings, bracket, match list).
- The refresh mode.
- The bracket rendering.
- The confirmation mode of player scores.

### Exporting results

When the tournament has a champion, you can export a self-contained HTML or PDF summary. The summary contains a bracket diagram and, optionally, all match results.

## For players

### Self-registration

If the organizer opened a registration lobby, open the link from the organizer and enter your name to register.

**Did you play before but you do not have your code?** On the registration page, the "Played before?" section gives three ways to identify yourself:

1. Your passphrase or QR code.
2. A magic link that the app sends to your email.
3. If you have neither: a search by name in the past players of the same club or community.

A name match does not link automatically, because names are not unique and not secret. Instead, the search sends a claim to the organizer. The organizer approves the claim in the admin panel of the lobby. After approval, the app merges the participation (and its ELO and history) into your Player Hub profile.

### Paying for an event

If the organizer set a fee, the registration confirmation and your returning-player view show:

- The amount and the due date.
- The accepted methods, with copy buttons.
- Your personal transfer reference.

Pay the organizer directly. Then click **I've paid**. Your entry shows as reported until the organizer confirms it. Open payments also show in a "Pending payments" card in your Player Hub, so you can pay after the event.

### Public TV view

The TV view (`/tv/<tournament-id-or-alias>`) shows live standings, the bracket, and match results. You cannot change data on this page, and you do not have to log in. The page is good for a large screen.

### Self-scoring

Players can enter the scores of their own matches without an admin account:

1. On the public view, click **Login**. Enter your passphrase, or scan the QR code from the organizer.
2. After you log in, a "Record Score" form shows on your pending matches.
3. If score confirmation is **Required**, the opponent team examines the score. The team can accept it, send a correction, or send it to the organizer for a decision.

The organizer can disable self-scoring at any time in the TV Settings panel.

### Player Hub

Each player can use a personal **Player Hub** at `/player`. The Hub shows all the linked events of the player in one place.

- **Access**: log in with your profile passphrase. If configured, you can also use a magic link by email.
- **Dashboard**: see your active and finished tournaments and registrations, with a link to each event.
- **Career stats**: total wins, losses, and draws, points for and against, your best teammates, and your strongest rivals.
- **Participant lookup**: find a player that you played with or against. See your records as partners and as opponents, and your win rate in each case.
- **Linking events**: link an event with its passphrase from the registration, or use "Link existing" in the Player Hub. The app can link registrations with the same email automatically.

---

## Reference

This section gives the detailed settings and formulas. You do not need this section to run a basic event. Use it to tune Mexicano, to understand seeding, to read the ELO calculation, or to write scripts for the API.

### Mexicano advanced settings

You can set all the settings below when you create the tournament. You can change them later in **Admin → Settings** or with the `PATCH /{tid}/mex/settings` API. The default values are in parentheses.

#### Structural

| Setting | Default | Description |
| --- | --- | --- |
| `total_points_per_match` | `32` | The fixed total of points in each match. The two teams share this total (for example, 21-11 or 16-16). |
| `num_rounds` | `8` | The number of Mexicano rounds before the play-offs. Set `0` for **rolling mode**: the rounds continue until the organizer starts the play-offs. |

#### Grouping & court balance

**`skill_gap`** (default: `null` — disabled)

This setting sets the maximum difference in estimated score between two players on the same court.

- `null` — the app groups players with a **snake draft** (rank 1 and rank 2 in the same group, then rank 3 and rank 4, and so on). The score difference has no effect.
- Example: `skill_gap = 10` — the engine puts two players on the same court only if the difference between their estimated scores is 10 points or less. If the top player has 60 points and a different player has 75 points, they do not play on the same court.

> Sometimes many players are near the top and some players are far behind. In this case, a `skill_gap` prevents matches between beginners and much stronger players in the later rounds.

**`balance_tolerance`** (default: `0.2`)

The cross-group optimizer moves players between courts to decrease repeated pairings. This setting limits the score imbalance that the optimizer can add to get new pairings.

- `0.2` — the optimizer accepts a move only if the total court imbalance increases by 20% or less above the initial proposal.
- `0.0` — the optimizer never accepts a move that increases the imbalance (very conservative).
- `1.0` — the optimizer accepts up to 100% more imbalance to prevent repeats.

#### Scoring modifiers

**`win_bonus`** (default: `0`)

A fixed number of points that the app adds to the total of the winning team. The margin has no effect.

Example with `total_points_per_match = 32` and `win_bonus = 3`:

| Result | Winner credited | Loser credited |
| --- | --- | --- |
| 20-12 | 20 + 3 = **23** | 12 |
| 17-15 | 17 + 3 = **20** | 15 |

> A win bonus gives more value to a close win than the point difference alone. Thus the win is important, not only the points.

**`strength_weight`** (default: `0.0`, range `0.0–1.0`)

This setting increases the points for a win against a stronger opponent. The multiplier is `1.0 + strength_weight × relative_strength`. The relative strength is how much higher the average per match of the opponents is than the average of your team. The value is clamped to `[0, 1]`.

- `0.0` — disabled. The app uses the points without change.
- `0.5` — if the average of your opponents is approximately 50% higher than your average, the app multiplies your points by approximately 1.5.
- `1.0` — maximum effect. Against much stronger opponents, your points are approximately two times higher.

> Use this setting in open-level events to give more value to unexpected wins. Without it, players who play weaker opponents can get an advantage.

**`strength_min_matches`** (default: `4`, range `0+`)

The app applies the strength multiplier only when each player in the match played this number of matches or more. Skipped matches do not count.

- `0` — always enabled, from round 1.
- `4` — the multiplier starts when the ratings are more stable.

> This setting prevents large changes in the early rounds, especially when players join late or sit out.

**`strength_win_factor` / `strength_draw_factor` / `strength_loss_factor`** (defaults: `1.0` / `0.75` / `0.5`, range `0.0-1.0`)

These factors set the part of the strength effect that the app applies for each result:

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

> A usual setup is `1.0 / 0.75 / 0.5`: the full effect on wins, a medium effect on draws, and a smaller effect on losses.

**`loss_discount`** (default: `1.0`, range `0.0–1.0`)

A multiplier for the points of the losing team. The app never decreases the points of the winning team.

- `1.0` — no change. The losing team gets all its points.
- `0.5` — the leaderboard counts only 50% of the points of the losing team.
- `0.0` — the losing team gets 0 points, for all scores.

Example with `total_points_per_match = 32`, `loss_discount = 0.5`:

| Result | Winner credited | Loser credited |
| --- | --- | --- |
| 20-12 | 20 | round(12 × 0.5) = **6** |
| 17-15 | 17 | round(15 × 0.5) = **8** |

> If you use `win_bonus` together with `loss_discount < 1.0`, the difference between winners and losers increases. The leaderboard then rewards wins much more than points.

#### Repeat-avoidance weights

The engine records the partner history and the opponent history. When it proposes the next round, it gives a penalty to repeated pairings.

**`teammate_repeat_weight`** (default: `2.0`)  
**`opponent_repeat_weight`** (default: `1.0`)

These settings set the penalty for a repeated **partnership** or a repeated **opponent matchup**. With higher values, the engine tries harder to prevent these repeats. With the defaults 2.0 / 1.0, the penalty for the same partner is two times the penalty for the same opponent.

**`repeat_decay`** (default: `0.5`)

This setting makes old repeats count less than recent repeats. A repeat from K rounds before has the weight `decay^K`, not the full weight.

- `0.5` — a repeat from 2 rounds before has `0.25×` the weight of a repeat from the last round.
- `1.0` — all past repeats have the same penalty, at all ages.
- `0.0` — the engine uses only the pairings of the last round.

> With many players (12 or more), repeats are less important, so you can decrease these weights. With 8 players and many rounds, these weights are very important. Without them, the same players often play on the same court.

**`partner_balance_weight`** (default: `0.0`)

An extra penalty for two partners of very different strength in one team. An example is the tournament leader as the partner of the last-place player.

- `0.0` — disabled. The engine uses only the balance between the teams and the repeat history.
- `0.5` — in the pairing quality score, the partner balance in each team has 50% of the weight of the balance between the teams.
- `2.0` — a strong preference for partners of similar strength.

> This setting has no effect in team mode, because the partners are fixed. In individual mode, it adds to `skill_gap`. `skill_gap` is a hard limit on court assignment. `partner_balance_weight` is a soft preference for partners of equal strength on a court.

### Seeding logic (play-offs)

- **Group + Play-off seeding** uses the finishing position in each group first: a 1st place gets a higher seed than a 2nd place. Then it uses performance tie-breakers.
- If more than one group goes into the bracket, the first-round pairings try to prevent matches between players of the same group.
- **Mexicano seeding** uses the leaderboard at the time when the play-offs start.
  - If players played different numbers of matches (for example, because of sit-outs), the ranking uses **average points per match** first. Then it uses total points and Buchholz.
  - If all players played the same number of matches, the ranking uses **total points** first. Then it uses average points and Buchholz.
- In Mexicano **individual mode**, the app puts the selected players into teams of adjacent seeds (#1+#2, #3+#4, …). Then it puts the teams into the bracket in the order of their combined seed strength.
- Organizers can replace the automatic selection: they can select the play-off participants manually. They can also add external participants with a seed score.

### ELO rating system

An ELO rating measures the relative skill of each player across tournaments. The rating changes after each completed match. The **Player Hub** shows it in the career stats.

#### Core formula

The engine uses a **margin-aware** version of classic ELO. The actual result is not only a win or a loss. It combines a binary value with a continuous score ratio:

$$S = \alpha \cdot W + (1 - \alpha) \cdot R$$

| Symbol | Meaning |
| --- | --- |
| $W$ | Binary result: 1 (win), 0.5 (draw), 0 (loss) |
| $R$ | Continuous ratio: $0.5 + (a - b) \;/\; (2 \cdot (a + b))$ |
| $\alpha$ | Blend weight (default **0.5**). A higher value gives more weight to the result. A lower value gives more weight to the margin. |

The expected score uses the standard ELO formula:

$$E = \frac{1}{1 + 10^{(R_{opp} - R_{player}) \;/\; 400}}$$

New players start at **1000**.

#### K-factor tiers

The K-factor sets how fast a rating changes. The ratings of new players change faster. The ratings of experienced players are more stable.

| Matches played | K |
| --- | --- |
| ≤ 20 | 40 |
| ≤ 40 | 20 |
| > 40 | 10 |

#### 1v1 update

$$R'_{player} = R_{player} + K \cdot (S - E)$$

#### 2v2 update (partner-adjusted)

In doubles, the expected score uses the average rating of each team:

$$E = E\!\left(\frac{R_{player} + R_{partner}}{2},\; \frac{R_{opp1} + R_{opp2}}{2}\right)$$

A **partner-strength adjustment** corrects for partners with different ratings:

$$\text{adj} = \text{clamp}\!\left(1.0 - 0.25 \cdot \frac{R_{partner} - R_{player}}{400},\;\; 0.5,\;\; 1.5\right)$$

- Weaker partner: adj > 1. Wins give more points, and losses cost fewer points.
- Stronger partner: adj < 1.

$$\Delta = K \cdot \text{adj} \cdot (S - E)$$

#### Minimum delta clamping

A winner always gets at least **+1** ELO. A loser always loses at least **−1** ELO. This rule applies for all margins and expected scores. Thus each result changes the rating.

#### Tennis matches

For tennis (scoring by sets), the app adds the games of all sets into one score pair. Then it calculates the ELO change.

#### Where the displayed numbers come from

The app calculates the match counts and the current ratings from the ELO log of each match. These numbers show in the admin **Players** tab, in the headers and chips of the Player Hub, and on all leaderboards. Thus the numbers are always the same in all places.

- **Global** is the total across all communities and clubs. Its rating is the rating after the most recent rated match.
- **Community** scope counts only the matches in tournaments of that community.
- **Club** scope uses a separate rating for each club. The app replays all the matches of the club's tournaments in the order they were played. A player's first club match starts from their community rating at that time. After that, only matches in that club change the club rating. Club ratings never change the community or global ratings. To rebuild them, use **Recalculate club ELO** in the club's leaderboard card. It recalculates every tournament of the club in order.
- A manual club ELO override, or the base ELO of a tier, becomes the current club rating of the player immediately. The next club match of the player starts from it, also when the player has not played in the club yet. The ELO history of the player shows it as a manual adjustment. It does not count as a match. It does not change the community or global ratings.

### Authentication & API

All actions that change tournaments need authentication. Examples are: create a tournament, record a score, and start the next round. Read-only endpoints are public. Examples are: view a tournament, and get the standings.

#### Default credentials

At the first start, the app creates a default admin user automatically:

- **Username**: `admin`
- **Password**: `admin`

**Warning: in production, change this password immediately.**

#### Logging in

**In the web UI**: when you try to do an action that needs authentication (for example, create a tournament), a login dialog opens automatically. Enter your credentials. The browser keeps the JWT token in localStorage.

You can also click the **Login** button in the top navigation bar at any time.

**With the API**: send the credentials with POST to `/api/auth/login`:

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

**Use the token**: for protected endpoints, put the token in the `Authorization` header:

```bash
curl -X POST http://localhost:8000/api/tournaments/group-playoff \
  -H "Authorization: Bearer eyJhbGciOi..." \
  -H "Content-Type: application/json" \
  -d '{ ... }'
```

By default, a token expires after **7 days**.

**Logging out**: click the **Logout** button in the top navigation bar. The app deletes your authentication token, and you are logged out.

#### Managing users

Admin users can create users, delete users, and change the passwords of other users:

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

All user-management endpoints need authentication. Only admins can use them.

#### Password reset by email

If SMTP is configured, users can reset a forgotten password without help from an admin:

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

You can use a reset link only one time. The link expires automatically.

#### Security notes

- The app hashes passwords with **bcrypt** before it saves them.
- The app signs JWT tokens with **HS256**.
- The app reads the JWT secret from the `PADEL_JWT_SECRET` environment variable. If this variable is not set, the app generates a secret at the first start and saves it to `data/.jwt_secret`.
- The app saves user data in `data/padel.db` (the same SQLite database as the tournaments).
- For production:
  - Set a strong `PADEL_JWT_SECRET` in the environment.
  - Change the default admin password immediately.
  - Use HTTPS through a reverse proxy (for example, nginx or Caddy).
  - Examine `ACCESS_TOKEN_EXPIRE_MINUTES` in `backend/auth/security.py`.
  - Use **one app worker or process** for each instance. The state is local to the process.
  - To tune how SQLite handles lock contention, use these variables:
    - `PADEL_SQLITE_TIMEOUT_SECS` (default: `15`)
    - `PADEL_SQLITE_BUSY_TIMEOUT_MS` (default: `15000`)
    - `PADEL_SQLITE_SYNCHRONOUS` (`NORMAL` by default)

#### Payment endpoints

Organizer endpoints need a JWT of a lobby editor or of the tournament owner. They are available under `/api/registrations/{rid}` and under `/api/tournaments/{tid}`:

- `GET`/`PATCH .../payment-settings` — fee, currency, due date, instructions, methods, and visibility.
- `GET .../payments` — the rows with their status, and a summary.
- `PATCH .../payments/{player_id}` — set the status, method, amount override, or note.
- `POST .../payments/remind-unpaid` — send an email to each player with the status unpaid or reported.

Player endpoints:

- `POST /api/registrations/{rid}/player-payment-report` — needs the lobby passphrase or token. It changes the status from unpaid to reported.
- `GET`/`POST /api/player-profile/payments[/{key}/report]` — needs the JWT of the Player Hub profile.

Public and TV payloads never contain the payment data of a player.

---

## Deployment & operations

### SMTP email notifications (disabled by default)

Email notifications are **disabled by default**. They work only when SMTP is configured.

- In `.env.example` and in the two Docker Compose files, the SMTP values are `None` placeholders.
- `backend/config.py` treats `None`, `null`, and empty values as not set. Thus email stays disabled.

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

For Gmail, use a **Google App Password**, not your usual account password. An App Password needs 2-step verification.

Docker Compose notes:

- `docker-compose.yml` uses `${VAR:-None}` defaults. Thus SMTP stays disabled until you set real values in your shell or in the `.env` file.
- `docker-compose.nas.yml` also has `"None"` placeholders, for the same reason.

### Running in a detached screen session

If you close the terminal, the server stops. To prevent this, run the server in a [GNU screen](https://www.gnu.org/software/screen/) session:

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

- Run one server process for each instance. **Do not** use more than one uvicorn worker for one data directory.
- The app keeps the state of active tournaments in process memory, and it saves the state to SQLite.
- This setup is usually sufficient for approximately 50 concurrent users if the polling intervals stay moderate.
- If the traffic increases, run more isolated instances (each with a different `PADEL_DATA_DIR`). Do not add workers to the same process.

### Running multiple independent instances in parallel

Each server process has its own state in memory. But by default, all processes use the same file `data/padel.db`. To run two or more fully isolated instances, give each instance a different data directory with the `PADEL_DATA_DIR` environment variable:

```bash
# Instance A — port 8000, data in data/instance_a/
PADEL_DATA_DIR=data/instance_a uv run python -m uvicorn backend.api:app --port 8000

# Instance B — port 8001, data in data/instance_b/
PADEL_DATA_DIR=data/instance_b uv run python -m uvicorn backend.api:app --port 8001
```

You can also run them as detached screen sessions:

```bash
screen -dmS padel_a bash -c 'PADEL_DATA_DIR=data/instance_a uv run python -m uvicorn backend.api:app --port 8000'
screen -dmS padel_b bash -c 'PADEL_DATA_DIR=data/instance_b uv run python -m uvicorn backend.api:app --port 8001'
```

Each instance saves and restores its own tournaments.

### Running a demo instance

Demo mode is a second, fully isolated instance. It gives temporary sandbox accounts to visitors. The procedure is:

1. On the core instance, the login dialog has the link "Open the demo sandbox". This link opens the admin page of `AMISTOSO_DEMO_URL` (`/admin` is added when the URL has no path), so the visitor goes directly to the "Start a sandbox" dialog. A note gives the name of the separate host, so the visitor knows that the demo does not change the core site. There is no automatic login. Thus a visitor can always log out and log in again on the demo instance.
2. On the demo instance, the visitor sees a short "Your demo sandbox" explanation and a "Start a N-day sandbox" button.
3. When the visitor clicks the button, the app creates a `demo-xxxxxx` account and opens the Create tab. A banner shows the generated passphrase. This passphrase is the account password. The visitor can use it to log in from other devices.
4. Returning demo users and the instance admin use "Already have a demo login? Log in" to open the username and password form.
5. A device that created or logged in to a sandbox shows the username of the visitor in the dialog, and puts the cursor in the password field. If the sandbox expired, the dialog tells the visitor. The device keeps only the username, never the passphrase.

A sandbox can run one tournament at a time, and it has a limited set of admin functions. It has no lobbies, clubs, communities, custom addresses, or Player Hub profiles. The demo instance hides all Player Hub entry points (page selector, login links, "create a profile" offers), greys out the Hub link buttons, and redirects `/player` to `/events`.

The app permanently deletes the demo account and all its data 3 days after it creates the account. The variable `AMISTOSO_DEMO_TTL_DAYS` sets this period. The frontend gets the value as `demo_ttl_days` from `/api/config`. The demo instance has its own data directory, so the delete job never changes the core database.

The demo instance also has these limits:

- It sends `X-Robots-Tag: noindex` on its HTML pages.
- Club subdomains are fully disabled:
  - Changes to the slug and the landing page return 403.
  - `by-slug` lookups return 404.
  - A `{slug}.{domain}` request for the root page goes to the apex. All other `{slug}.{domain}` requests return 404.

```bash
# Core — port 8000; the login dialog links to the demo instance
AMISTOSO_DATA_DIR=data/core AMISTOSO_DEMO_URL=https://demo.example.com \
  uv run python -m uvicorn backend.api:app --port 8000

# Demo — port 8001, isolated data dir, purge job enabled
AMISTOSO_DATA_DIR=data/demo AMISTOSO_DEMO_INSTANCE=1 PADEL_ADMIN_PASSWORD=... \
  uv run python -m uvicorn backend.api:app --port 8001
```

Note: the endpoint that creates demo accounts has a rate limit for each client IP: 5 sandboxes per hour. A 429 response contains `Retry-After`. Behind a reverse proxy, the client address is the address of the proxy, unless the proxy forwards the client headers correctly. The login rate limit has the same limitation.

Then open <http://localhost:8000>.

---

## Development

### React admin, Player Hub, and Events

The admin at `/` and `/admin`, the Player Hub at `/player`, and public Events at `/events` use
**React, TypeScript, Vite, and Mantine**. They call the existing FastAPI API and
use the same SQLite database. Registration, club landing, and TV
pages still use their existing frontend.

For frontend development, run the Python server above, then in another terminal:

```bash
cd frontend/admin-app
npm ci
npm run dev
```

Open <http://localhost:5173> for admin, <http://localhost:5173/player> for the
Player Hub, or <http://localhost:5173/events> for public Events. Vite proxies API requests to port 8000 and reloads
the UI when source files change. To update the UI served directly by FastAPI,
run `npm run build` in `frontend/admin-app`. Docker builds it automatically.
The development proxy forwards public-page links to FastAPI as well.

React colors are defined centrally in `frontend/admin-app/src/theme.ts`, using
the legacy **Hardcourt Nights** palette from `frontend/theme.css`: court blue,
cool concrete surfaces, Penn-ball green, and semantic success/warning/error
colors. Mantine components use the `court`, `tennis`, `success`, `warning`, and
`danger` palettes; custom CSS uses the shared `--app-*` tokens. Headers and login
screens include a light/dark toggle. The `amistoso-theme` preference is shared
with legacy pages, and the older `padel-theme` key is migrated. With no saved
preference, the UI follows the OS. Browser tests compare the React tokens with
the actual legacy stylesheet in both modes.

An **EN / ES** language selector sits beside the theme button in React headers
and login screens. React uses i18next, `src/i18n.ts`, and `src/locales/es.json`;
shared wording reuses the legacy translation catalog. The `amistoso-lang`
preference is shared with legacy pages, with migration from `padel-lang`.
Language changes update the interface without resetting forms or sessions.
Dates and amounts follow the selected locale; event names and API enum values
remain unchanged.

The React admin currently supports login, tournament lists and creation, raw
score entry, round progression, standings, registration lobbies and entrants,
payment settings and statuses, communities, clubs, seasons, and user creation.
Use **Advanced admin** (`/legacy-admin`) for fixed-team setup, set-score entry,
bracket customization, player profiles/codes, event conversion, exports, email,
collaborators, detailed club settings, and other advanced workflows. The two
admin interfaces share the browser login on the same origin. Demo onboarding
and invite/password-reset links continue to use the existing interface.
Without a React build, FastAPI falls back to the existing admin.

The React Player Hub supports player/event passphrase login, profile creation,
email login and verification links, recovery requests, event linking, active
events and history, own-match scores and opponent confirmation, ratings and
leaderboards by club/community, outstanding payments and payment reporting,
and profile editing. Player sessions use `padel-player-profile` and remain
independent of organizer login. Tournament scoring exchanges an entry's token
for its own player credential; it never uses an organizer token. Score entry
respects organizer settings and match format overrides, including set deciders.
Full event views retain corrections, disputes, and bracket tools; **Detailed
player tools** (`/legacy-player`) retains deeper player comparisons and history
tools. Both player interfaces share the existing player session keys.

Public Events uses the anonymous `/api/public-events` feed, without organizer
or player credentials. It includes live/upcoming tournaments, public sign-up
lobbies, finished results, sport/club/community filters, search, and exact
ID/alias lookup. Filters are shareable through the URL. SSE and a 30-second
poll keep listings fresh. Private events and unlisted lobbies stay out of the
directory. Existing `/tv/{slug}` and `/register/{slug}` links still open their
event views; old `/events?tid=...` and `?t=...` links redirect to the TV route.
The old directory is available at `/legacy-events`, and remains the fallback
when there is no React build. Demo Events keeps its no-index behavior.

Frontend checks:

```bash
cd frontend/admin-app
npm run typecheck
npm run format:check
npx playwright install chromium
npm run test:e2e
```

Browser tests use an isolated temporary database and a separate server on port
8011. They do not modify your local data. Install Python dependencies first;
the browser test server uses the repo's `.venv`.

### Project structure

The app now has much more than tournaments: registration lobbies, a community and club hierarchy, a Player Hub with ELO, live TV views, and more. A file-by-file tree in this README becomes incorrect quickly. The file **[`CLAUDE.md`](CLAUDE.md)** in the repo root has the current description of each backend and frontend module. Summary:

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

This project uses [`ruff`](https://docs.astral.sh/ruff/) for linting and for formatting.

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

The project includes a **pre-commit hook**. The hook runs these checks automatically before each commit:

```bash
# Install the hook (one-time setup after cloning)
uv run pre-commit install

# Run manually against all files
uv run pre-commit run --all-files
```

After you install the hook, `ruff` lints and formats your staged files at each `git commit`. If `ruff` cannot fix a problem automatically, the commit stops.

### Running tests

The test suite uses `pytest`. It tests the full API, the tournament logic, and the authentication flows with FastAPI's `TestClient`. You do not have to start a server.

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

**Test files:** there are more than 30 files in `tests/`. Each file has the name of the feature that it tests, not the name of one source module. For example, `test_registration_recovery.py` and `test_convert_registration.py` each test more than one `routes_*.py` file. Before you add a new fixture, look at the shared fixtures in `tests/conftest.py`.

### Releasing a new version

This project uses [`commitizen`](https://commitizen-tools.github.io/commitizen/). Commitizen increases the version, updates the changelog, and creates the git tag automatically.

Write your commits in the [Conventional Commits](https://www.conventionalcommits.org/) format:

```bash
# Interactive commit prompt (guides you through the format)
uv run cz commit

# Or write manually: feat:, fix:, chore:, docs:, refactor:, etc.
git commit -m "feat: add round-robin scheduling"
```

To make a release:

```bash
# Preview what version and tag would be created
uv run cz bump --dry-run

# Bump version in pyproject.toml, update CHANGELOG.md, and create a git tag
uv run cz bump

# Push the commit and the tag — this triggers the CI release pipeline
git push && git push --tags
```

The version increases by semver rules, from the commit history:

- `fix:` → patch (`0.3.0` → `0.3.1`)
- `feat:` → minor (`0.3.0` → `0.4.0`)
- `feat!:` or a `BREAKING CHANGE:` footer → major (`0.3.0` → `1.0.0`)

---

## License

This project uses the **GNU General Public License v3.0**.

For the full terms, see the [LICENSE](LICENSE) file.
