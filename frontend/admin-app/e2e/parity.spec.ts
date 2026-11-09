import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  adminHeaders,
  chooseTheme,
  createTournament,
  loginAdmin,
  openTournament,
  patchTvSettings,
} from './helpers';

// Gaps found by the code-level parity audit against the old interface, one test each. The scenarios
// that need data a fresh server does not have (a finished career, a club with past participants) stub
// the read endpoint only; every write goes to the real server unless the test says otherwise.

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

interface Secret {
  name: string;
  passphrase: string;
  token: string;
}
const secretsOf = async (request: APIRequestContext, id: string, headers: Record<string, string>) =>
  (await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json())
    .players as Record<string, Secret>;

// ---- Player scoring ------------------------------------------------------------------------------

test('a player picks the match tie-break in the format chip and reviews the score before sending', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'po', `Chip ${stamp()}`, {
    sport: 'tennis',
  });
  await patchTvSettings(request, id, { refresh_interval: 0, allow_player_scoring: true });
  const secrets = await secretsOf(request, id, headers);
  const ana = Object.values(secrets).find((p) => p.name === 'Ana')!;
  await page.goto(`/tv/${id}?player_token=${encodeURIComponent(ana.token)}`);
  await page.getByRole('button', { name: 'Enter score' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Submit your score' });
  const chip = sheet.getByTestId('format-chip');
  await expect(chip).toHaveText(/Points/);
  await chip.click();
  await sheet.getByTestId('format-sets_tb').click();
  await expect(chip).toHaveText(/Sets \+ match tie-break/);
  // Off the organizer's format: the notice names the match's own format.
  await expect(sheet.getByText(/This match is set to Points\./)).toBeVisible();
  await sheet.getByTestId('set-1-1').fill('6');
  await sheet.getByTestId('set-1-2').fill('4');
  await sheet.getByTestId('set-2-1').fill('3');
  await sheet.getByTestId('set-2-2').fill('6');
  // The third row is the match tie-break, with the rule as its tooltip.
  await expect(sheet.getByText('Tie-break', { exact: true })).toBeVisible();
  await sheet.getByTestId('set-3-1').fill('10');
  await sheet.getByTestId('set-3-2').fill('8');
  await sheet.getByRole('button', { name: 'Submit score' }).click();
  // Nothing is sent yet: a last look at the score, with the review warning.
  const review = sheet.getByTestId('score-review');
  await expect(review.getByTestId('review-score')).toHaveText('6-4 / 3-6 / [10-8]');
  await expect(review.getByText(/counts once the organizer approves it/)).toBeVisible();
  const sent = page.waitForRequest(
    (r) => r.url().includes('/po/record-tennis') && r.method() === 'POST',
  );
  await review.getByRole('button', { name: 'Back' }).click();
  await expect(sheet.getByTestId('set-3-1')).toHaveValue('10');
  await sheet.getByRole('button', { name: 'Submit score' }).click();
  await sheet.getByRole('button', { name: 'Send this score' }).click();
  const body = (await sent).postDataJSON();
  expect(body.decider).toBe('match_tiebreak');
  expect(body.sets).toEqual([
    [6, 4],
    [3, 6],
    [10, 8],
  ]);
  await expect(sheet).not.toBeVisible();
});

test('a 0 - 0 score gets a warning on the review step', async ({ page, request }) => {
  const { id, headers } = await createTournament(request, 'po', `Zero ${stamp()}`);
  await patchTvSettings(request, id, { refresh_interval: 0, allow_player_scoring: true });
  const secrets = await secretsOf(request, id, headers);
  const ana = Object.values(secrets).find((p) => p.name === 'Ana')!;
  await page.goto(`/tv/${id}?player_token=${encodeURIComponent(ana.token)}`);
  await page.getByRole('button', { name: 'Enter score' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Submit your score' });
  await sheet.getByLabel(/^First side/).fill('0');
  await sheet.getByLabel(/^Second side/).fill('0');
  await sheet.getByRole('button', { name: 'Submit score' }).click();
  await expect(sheet.getByTestId('review-score')).toHaveText('0 – 0');
  await expect(sheet.getByText(/This is 0 – 0/)).toBeVisible();
  await sheet.getByRole('button', { name: 'Back' }).click();
  await expect(sheet.getByLabel(/^First side/)).toBeVisible();
});

test('the submitter sees the correction window count down under a score awaiting confirmation', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'mex', `Window ${stamp()}`);
  await patchTvSettings(request, id, {
    refresh_interval: 0,
    allow_player_scoring: true,
    score_confirmation: 'required',
    correction_window_seconds: 90,
  });
  const secrets = await secretsOf(request, id, headers);
  const [anaId, ana] = Object.entries(secrets).find(([, p]) => p.name === 'Ana')!;
  const round = (await (await request.get(`/api/tournaments/${id}/mex/matches`)).json())
    .current_matches as { id: string; team1_ids: string[]; team2_ids: string[] }[];
  const match = round.find((m) => [...m.team1_ids, ...m.team2_ids].includes(anaId))!;
  const auth = await (
    await request.post(`/api/tournaments/${id}/player-auth`, { data: { token: ana.token } })
  ).json();
  expect(
    (
      await request.post(`/api/tournaments/${id}/mex/record`, {
        headers: { Authorization: `Bearer ${auth.access_token}` },
        data: { match_id: match.id, score1: 14, score2: 10 },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/tv/${id}?player_token=${encodeURIComponent(ana.token)}`);
  const line = page.getByTestId('correction-window').first();
  await expect(line).toContainText(/Correction window: \d+s remaining/);
  const first = Number(/(\d+)s/.exec((await line.textContent()) ?? '')![1]);
  expect(first).toBeLessThanOrEqual(90);
  await expect
    .poll(async () => Number(/(\d+)s/.exec((await line.textContent()) ?? '')![1]), {
      timeout: 5000,
    })
    .toBeLessThan(first);
});

test('the double-elimination legend names the bracket colours', async ({ page, request }) => {
  const { id } = await createTournament(request, 'po', `Legend ${stamp()}`, {
    double_elimination: true,
  });
  await patchTvSettings(request, id, { refresh_interval: 0 });
  await page.goto(`/tv/${id}`);
  await page.getByRole('button', { name: 'About double elimination' }).click();
  const legend = page.getByText(/Orange/).locator('..');
  await expect(legend).toContainText('Orange = Winners Bracket');
  await expect(legend).toContainText('Red = Losers Bracket');
});

// ---- Polish ---------------------------------------------------------------------------------------

test('the in-progress pill is legible in light and dark', async ({ page, request }) => {
  const name = `Pill ${stamp()}`;
  await createTournament(request, 'mex', name);
  await page.goto('/events');
  const row = page.getByTestId('public-event').filter({ hasText: name });
  const pill = row.locator('.mantine-Badge-root', { hasText: 'In progress' });
  await expect(pill).toBeVisible();
  for (const scheme of ['Light', 'Dark'] as const) {
    await chooseTheme(page, scheme);
    const styles = await pill.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        color: cs.color,
        background: cs.backgroundColor,
        text: getComputedStyle(document.body).color,
      };
    });
    // The label is the page's text color: dark on a light pill, light on a dark one.
    expect(styles.color).toBe(styles.text);
    // The fill is a translucent tint, never a solid block.
    const alpha = /\/\s*([\d.]+)\)/.exec(styles.background)?.[1];
    expect(Number(alpha ?? 1)).toBeLessThan(0.4);
  }
});

test('on a phone the TV leaderboard keeps a long name on one line', async ({ page, request }) => {
  const long = 'Alexandra Maximiliana Fernandez-Gonzalez de la Vega';
  const headers = await adminHeaders(request);
  const created = await request.post('/api/tournaments/mexicano', {
    headers,
    data: {
      name: `Long names ${stamp()}`,
      player_names: [long, 'Beto', 'Carla', 'Diego'],
      num_rounds: 3,
      total_points_per_match: 24,
    },
  });
  const id = (await created.json()).id as string;
  await request.post(`/api/tournaments/${id}/mex/next-round`, { headers, data: {} });
  await patchTvSettings(request, id, { refresh_interval: 0 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tv/${id}`);
  const name = page
    .locator('[data-section="standings"] [class*="nameText"]')
    .filter({ hasText: long })
    .first();
  await expect(name).toBeVisible();
  const info = await name.evaluate((el) => ({
    whiteSpace: getComputedStyle(el).whiteSpace,
    height: el.getBoundingClientRect().height,
    lineHeight: parseFloat(getComputedStyle(el).lineHeight) || 0,
    clipped: el.scrollWidth > el.clientWidth,
  }));
  expect(info.whiteSpace).toBe('nowrap');
  expect(info.clipped).toBe(true);
  expect(info.height).toBeLessThan(info.lineHeight * 1.6 || 60);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});

// ---- Mexicano rounds and play-offs ----------------------------------------------------------------

test('suggested pairings show their numbers, sections and repeat details', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Proposals ${stamp()}`);
  const headers = await adminHeaders(request);
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of matches.current_matches)
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('button', { name: 'Next round' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate the next round?' });
  await expect(dialog.getByTestId('proposal').first()).toBeVisible();
  await expect(dialog.getByText('Best', { exact: true })).toBeVisible();
  await expect(dialog.getByTestId('metrics').first()).toContainText('Score gap');
  // With four players every pairing repeats someone: the toggle lists who.
  await expect(dialog.getByTestId('repeat-details')).toHaveCount(0);
  await dialog.getByLabel('Show per-player repeat details').check({ force: true });
  await expect(dialog.getByTestId('repeat-details').first()).toBeVisible();
  // The manual editor starts from the chosen proposal and sums the round up.
  await dialog.getByRole('tab', { name: 'Manual round' }).click();
  await expect(dialog.getByTestId('round-summary')).toContainText('Score gap');
  await dialog.getByRole('button', { name: 'Add a match' }).click();
  await expect(dialog.getByLabel('Match 2: Team 1, player 1')).toBeVisible();
  await dialog.getByRole('button', { name: 'Remove a match' }).click();
  await expect(dialog.getByLabel('Match 2: Team 1, player 1')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Clear all' }).click();
  await expect(dialog.getByTestId('round-summary')).toHaveCount(0);
  await expect(dialog.getByTestId('manual-sitout')).toContainText('Sitting out: Ana');
});

test('the play-offs dialog estimates the matches and marks estimated Mexicano points', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Estimate ${stamp()}`);
  const headers = await adminHeaders(request);
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of matches.current_matches)
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
  expect((await request.post(`/api/tournaments/${id}/mex/end`, { headers })).ok()).toBeTruthy();
  await page.route('**/mex/recommend-playoffs*', async (route) => {
    const real = await (await route.fetch()).json();
    real.recommended_teams = real.recommended_teams.map((r: Record<string, unknown>) => ({
      ...r,
      ranked_by_avg: true,
      estimated_points: 31.5,
    }));
    await route.fulfill({ json: real });
  });
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('button', { name: 'Start play-offs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start the play-offs?' });
  await expect(dialog.getByText('31.5* pts').first()).toBeVisible();
  await expect(dialog.getByText(/Estimated points/)).toBeVisible();
  await expect(dialog.getByTestId('playoff-estimate')).toContainText('~1 matches');
  await dialog.getByText('Double elimination', { exact: true }).click();
  await expect(dialog.getByTestId('playoff-estimate')).toContainText('~2 matches');
  await expect(dialog.getByTestId('playoff-estimate')).toContainText('Winners bracket');
});

// ---- Deleting a tournament ------------------------------------------------------------------------

test('deleting a tournament offers to purge its ghost profiles', async ({ page, request }) => {
  const name = `Purge ${stamp()}`;
  const { id } = await createTournament(request, 'mex', name);
  await page.route(`**/api/tournaments/${id}/ghost-profiles`, (route) =>
    route.fulfill({
      json: {
        count: 2,
        profiles: [
          { id: 'g1', name: 'Ghost One' },
          { id: 'g2', name: 'Ghost Two' },
        ],
      },
    }),
  );
  await openTournament(page, id, name);
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Delete tournament' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete tournament' });
  await expect(dialog.getByText('Ghost One')).toBeVisible();
  await dialog.getByLabel(/Also permanently delete 2 ghost profile/).check({ force: true });
  const deleted = page.waitForRequest((r) => r.method() === 'DELETE' && r.url().includes(id));
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await deleted).url()).toContain('purge_ghosts=true');
  await expect(page).toHaveURL(/\/admin$/);
});

// ---- Lobbies --------------------------------------------------------------------------------------

test('a closed lobby can be archived and restored', async ({ page, request }) => {
  const headers = await adminHeaders(request);
  const created = await request.post('/api/registrations', {
    headers,
    data: { name: `Archive ${stamp()}`, sport: 'padel' },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id as string;
  await loginAdmin(page);
  await page.goto(`/admin/lobby/${id}`);
  await page.getByRole('button', { name: 'Close registration' }).click();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/registrations/${id}`, { headers })).json()).archived,
    )
    .toBe(true);
  await expect(page.getByRole('button', { name: 'Unarchive' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen registration' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Unarchive' }).click();
  await expect(page.getByRole('button', { name: 'Reopen registration' })).toBeVisible();
});

test('answers show every individual answer and can be narrowed to one choice', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const created = await request.post('/api/registrations', {
    headers,
    data: {
      name: `Answers ${stamp()}`,
      sport: 'padel',
      questions: [
        {
          key: 'level',
          label: 'Level',
          type: 'choice',
          choices: ['Beginner', 'Advanced'],
          required: false,
        },
        { key: 'note', label: 'Note', type: 'text', choices: [], required: false },
      ],
    },
  });
  expect(created.ok()).toBeTruthy();
  const lobby = await created.json();
  const id = lobby.id as string;
  for (const [name, level, note] of [
    ['Uno', 'Beginner', 'Left-handed'],
    ['Dos', 'Advanced', ''],
    ['Tres', 'Beginner', ''],
  ])
    expect(
      (
        await request.post(`/api/registrations/${id}/register`, {
          data: { player_name: name, answers: { level, ...(note ? { note } : {}) } },
        })
      ).ok(),
    ).toBeTruthy();
  await loginAdmin(page);
  await page.goto(`/admin/lobby/${id}`);
  await page.getByRole('tab', { name: 'Answers' }).click();
  const panel = page.getByTestId('answers-panel');
  await expect(panel.getByText('Left-handed')).toBeVisible();
  await expect(panel.getByTestId('answer-list').nth(1)).toContainText('Uno');
  // Tap a choice bar: only the people who chose it are listed.
  await panel.getByRole('button', { name: /^Advanced/ }).click();
  const list = panel.getByTestId('answer-list').first();
  await expect(list).toContainText('Dos');
  await expect(list).not.toContainText('Uno');
  await panel.getByRole('button', { name: 'Clear filter' }).click();
  // The participant filter narrows every card.
  await panel.getByLabel('Participant').first().fill('tres');
  await expect(panel.getByText('Uno')).toHaveCount(0);
});

// ---- Admin players and clubs ----------------------------------------------------------------------

async function profileOf(request: APIRequestContext, id: string, headers: Record<string, string>) {
  const secrets = await secretsOf(request, id, headers);
  const ana = Object.values(secrets).find((p) => p.name === 'Ana')!;
  const name = `Linked ${stamp()}`;
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: ana.passphrase,
      name,
      email: `link-${stamp()}@example.com`,
    },
  });
  expect(created.ok()).toBeTruthy();
  return { name, profileId: (await created.json()).profile.id as string };
}

test('an administrator links a profile to another player of a tournament', async ({
  page,
  request,
}) => {
  const tname = `Link ${stamp()}`;
  const { id, headers } = await createTournament(request, 'mex', tname);
  const { name, profileId } = await profileOf(request, id, headers);
  await loginAdmin(page);
  await page.goto('/admin/players');
  await page.getByLabel('Search players').fill(name);
  await page
    .getByTestId('profile-row')
    .filter({ hasText: name })
    .getByRole('button', { name: /Manage/ })
    .click();
  const sheet = page.getByRole('dialog', { name });
  await sheet.getByRole('button', { name: 'Link a participation' }).click();
  await sheet.getByLabel('Tournament').click();
  await page.getByRole('option', { name: new RegExp(tname) }).click();
  await sheet.getByLabel('Player').click();
  await page.getByRole('option', { name: 'Beto', exact: true }).click();
  await sheet.getByRole('button', { name: 'Link', exact: true }).click();
  // The profile already has Ana here: moving it asks first.
  const confirm = page.getByRole('dialog', { name: 'Move the link?' });
  await expect(confirm).toContainText('already linked');
  const linked = page.waitForResponse(
    (r) => r.url().includes(`/link/${id}/`) && r.request().method() === 'POST',
  );
  await confirm.getByRole('button', { name: 'Link', exact: true }).click();
  expect((await linked).ok()).toBeTruthy();
  // One participation, and it is now the player that was Beto, not Ana.
  const detail = await (
    await request.get(`/api/admin/player-profiles/${profileId}`, { headers })
  ).json();
  expect(detail.participations).toHaveLength(1);
  const players = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, { profile_id: string | null }>;
  expect(Object.values(players).filter((p) => p.profile_id === profileId)).toHaveLength(1);
  expect(players[detail.participations[0].player_id]!.profile_id).toBe(profileId);
});

test('past participants can be merged into a profile, with players who never had a profile', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'mex', `Fold ${stamp()}`);
  const { name, profileId } = await profileOf(request, id, headers);
  await page.route('**/api/admin/player-profiles/*/merge-candidates', (route) =>
    route.fulfill({ json: [{ id: 'ghost-1', name: 'Old Ghost', is_ghost: true }] }),
  );
  await page.route('**/api/admin/player-profiles/past-participants*', (route) =>
    route.fulfill({
      json: [{ player_id: 'raw-1', name: 'Nameless Nico', last_tournament_name: 'Old Cup' }],
    }),
  );
  await loginAdmin(page);
  await page.goto('/admin/players');
  await page.getByLabel('Search players').fill(name);
  await page
    .getByTestId('profile-row')
    .filter({ hasText: name })
    .getByRole('button', { name: /Manage/ })
    .click();
  const sheet = page.getByRole('dialog', { name });
  const fold = sheet.getByTestId('fold-into');
  await fold.getByLabel('Old Ghost').check({ force: true });
  await fold.getByLabel('Search past participants').fill('nic');
  await fold.getByLabel(/Nameless Nico/).check({ force: true });
  await fold.getByRole('button', { name: 'Merge profiles' }).click();
  const confirm = page.getByRole('dialog', { name: 'Merge profiles' });
  await expect(confirm).toContainText('Old Ghost, Nameless Nico');
  const body = page.waitForRequest((r) => r.url().includes('/consolidate-ghosts'));
  await page.route('**/consolidate-ghosts', (route) => route.fulfill({ json: { name } }));
  await confirm.getByRole('button', { name: 'Merge profiles' }).click();
  expect((await body).postDataJSON()).toEqual({
    source_ids: [profileId, 'ghost-1'],
    source_player_ids: ['raw-1'],
    name: null,
  });
});

test('the club roster lists past participants who are not members yet', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const community = await (
    await request.post('/api/communities', {
      headers,
      data: { name: `Roster community ${stamp()}` },
    })
  ).json();
  const club = await (
    await request.post('/api/clubs', {
      headers,
      data: { name: `Roster Club ${stamp()}`, community_id: community.id },
    })
  ).json();
  const ghosts = [
    {
      profile_id: 'gh-1',
      name: 'Past Pablo',
      elo_padel: 1100,
      elo_tennis: null,
      matches_padel: 7,
      matches_tennis: 0,
    },
    {
      profile_id: 'gh-2',
      name: 'Past Paula',
      elo_padel: 1000,
      elo_tennis: null,
      matches_padel: 3,
      matches_tennis: 0,
    },
  ];
  await page.route(`**/api/clubs/${club.id}/players/possible-members`, (route) =>
    route.fulfill({ json: ghosts }),
  );
  await loginAdmin(page);
  await page.goto(`/admin/clubs/${club.id}`);
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.getByRole('button', { name: 'Duplicates and merging' }).click();
  const list = page.getByTestId('possible-members');
  await expect(list).toContainText('2 past participants are not on the roster');
  await list.getByPlaceholder('Search past participants').fill('paula');
  await expect(list.getByText('Past Pablo')).toHaveCount(0);
  const add = page.waitForRequest(
    (r) => r.url().includes(`/clubs/${club.id}/players`) && r.method() === 'POST',
  );
  await page.route(`**/api/clubs/${club.id}/players`, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: { ok: true } }) : route.fallback(),
  );
  await list.getByRole('button', { name: 'Add to roster' }).click();
  expect((await add).postDataJSON()).toEqual({ profile_id: 'gh-2' });
});

// ---- Player Hub -----------------------------------------------------------------------------------

const counterpart = (name: string, games: number, wins: number) => ({
  name,
  current_name: name,
  games,
  wins,
  win_pct: Math.round((wins / games) * 100),
});
const entry = (over: Record<string, unknown>) => ({
  entity_type: 'tournament',
  entity_id: `t-${over.entity_name}`,
  player_id: 'p-ana',
  player_name: 'Ana',
  status: 'finished',
  alias: null,
  auto_login_token: null,
  sport: 'padel',
  tournament_type: 'group_playoff',
  entity_deleted: false,
  rank: null,
  total_players: 8,
  wins: 0,
  losses: 0,
  draws: 0,
  elo_before: 1000,
  elo_after: 1000,
  community_id: null,
  club_id: null,
  finished_at: '2026-05-01T10:00:00Z',
  playoff_stage: null,
  playoff_stage_rank: null,
  top_partners: [],
  top_rivals: [],
  all_partners: [],
  all_rivals: [],
  ...over,
});
const side = (name: string, before: number, after: number, id = name) => ({
  player_id: id,
  player_name: name,
  elo_before: before,
  elo_after: after,
});
const SPACE = {
  profile: {
    id: 'p-ana',
    name: 'Ana',
    email: 'ana@example.com',
    email_verified: true,
    contact: '',
    passphrase: 'one-two-three',
    elo_padel: 1043,
    elo_tennis: null,
    elo_padel_matches: 12,
    elo_tennis_matches: 0,
  },
  access_token: 'stub-token',
  entries: [
    entry({
      entity_name: 'Spring Cup',
      rank: 2,
      wins: 4,
      losses: 1,
      playoff_stage: 'Final',
      playoff_stage_rank: 2,
      elo_before: 1000,
      elo_after: 1043,
      top_partners: [counterpart('Luis', 4, 3)],
      top_rivals: [counterpart('Pablo', 3, 1)],
      all_partners: [counterpart('Luis', 4, 3), counterpart('Marta', 2, 0)],
      all_rivals: [counterpart('Pablo', 3, 1), counterpart('Zoe', 2, 2)],
    }),
    entry({
      entity_name: 'Winter League',
      rank: 1,
      wins: 5,
      losses: 0,
      finished_at: '2026-02-01T10:00:00Z',
      all_partners: [counterpart('Luis', 3, 3)],
      all_rivals: [counterpart('Pablo', 2, 1)],
    }),
  ],
  elo_history: [
    {
      tournament_id: 't-Spring Cup',
      tournament_name: 'Spring Cup',
      tournament_alias: null,
      match_id: 'm1',
      match_order: 3,
      sport: 'padel',
      updated_at: '2026-05-01T10:00:00Z',
      player_id: 'p-ana',
      elo_before: 1030,
      elo_after: 1043,
      elo_delta: 13,
      score: [],
      sets: [
        [6, 4],
        [6, 3],
      ],
      decider: 'full_set',
      is_manual: false,
      adjustment_reason: null,
      team1: [side('Ana', 1030, 1043, 'p-ana'), side('Luis', 1010, 1021)],
      team2: [side('Pablo', 1050, 1038), side('Zoe', 990, 981)],
    },
    {
      tournament_id: 't-Spring Cup',
      tournament_name: 'Rating correction',
      match_id: 'adj',
      sport: 'padel',
      updated_at: '2026-04-01T10:00:00Z',
      elo_before: 1000,
      elo_after: 1030,
      elo_delta: 30,
      score: [],
      sets: [],
      is_manual: true,
      adjustment_reason: 'Seeded by club level',
      adjusted_by: 'admin',
      team1: [],
      team2: [],
    },
  ],
  player_communities: [],
  player_clubs: [],
};

async function stubHub(page: Page) {
  await page.addInitScript((profile) => {
    localStorage.setItem('padel-player-profile', 'stub-token');
    localStorage.setItem('padel-player-profile-data', JSON.stringify(profile));
  }, SPACE.profile);
  await page.route('**/api/player-profile/space*', (route) => route.fulfill({ json: SPACE }));
  await page.route('**/api/player-profile/leaderboard*', (route) =>
    route.fulfill({ json: { padel: [], tennis: [] } }),
  );
  await page.route('**/api/player-profile/payments*', (route) => route.fulfill({ json: [] }));
}

test('the Hub shows teammates, rivals, everyone met and the best results', async ({ page }) => {
  await stubHub(page);
  await page.goto('/player');
  const career = page.getByTestId('career-stats');
  await expect(career).toBeVisible();
  await expect(career.getByTestId('social-line')).toContainText('Best teammates: Luis 86%');
  await expect(career.getByTestId('social-line')).toContainText('Toughest rivals: Pablo 40%');
  const explorer = career.getByTestId('participant-explorer');
  await explorer.getByRole('button', { name: 'Players you have met' }).click();
  await expect(explorer.getByRole('row')).toHaveCount(5);
  await explorer.getByLabel('Search players').fill('pab');
  await expect(explorer.getByRole('row')).toHaveCount(2);
  await expect(explorer.getByRole('row').nth(1)).toContainText('5 games · 40% won');
  await explorer.getByLabel('Search players').fill('');
  await explorer.getByLabel('Sort by').click();
  await page.getByRole('option', { name: 'Name' }).click();
  await expect(explorer.getByRole('row').nth(1)).toContainText('Luis');
  const best = page.getByTestId('best-results');
  await expect(best).toContainText('Final: Spring Cup');
  await expect(best).toContainText('1st place: Winter League');
});

test('My events shows the place, record, rating change and partners of a finished event', async ({
  page,
}) => {
  await stubHub(page);
  await page.goto('/player/matches?tab=finished');
  const card = page.getByTestId('event-card').filter({ hasText: 'Spring Cup' });
  await expect(card.getByTestId('entry-stats')).toContainText('#2 of 8');
  await expect(card.getByTestId('entry-stats')).toContainText('4W 1L');
  await expect(card.getByTestId('entry-stats')).toContainText('+43 ELO');
  await expect(card.getByTestId('social-line')).toContainText('Best teammates: Luis 75%');
});

test('Ratings shows both teams with their rating changes, manual adjustments and a row limit', async ({
  page,
}) => {
  await stubHub(page);
  await page.goto('/player/ratings');
  const row = page.getByTestId('elo-row').first();
  await expect(row).toContainText('1030 → 1043');
  await expect(row).toContainText('Pablo');
  await expect(row).toContainText('Zoe');
  await expect(row).toContainText('6-4, 6-3');
  const manual = page.locator('[data-testid="elo-row"][data-manual]');
  await expect(manual).toContainText('Manual adjustment');
  await expect(manual).toContainText('Adjusted by admin');
  await expect(manual).toContainText('Seeded by club level');
  await page.getByTestId('elo-limit').click();
  await page.getByRole('option', { name: '5', exact: true }).click();
  await expect(page.getByTestId('elo-row')).toHaveCount(2);
  // The info button explains the rating.
  await page.getByRole('button', { name: 'About ELO ratings' }).click();
  await expect(page.getByRole('dialog', { name: 'About ELO ratings' })).toContainText(
    'Everyone starts at 1000',
  );
});

test('the new-event form explains the formats', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/admin/new');
  await page.getByRole('button', { name: 'About this format' }).click();
  await expect(page.getByRole('dialog', { name: 'About this format' })).toBeVisible();
});

test('the main site offers the demo sandbox when a demo site is configured', async ({ page }) => {
  await page.route('**/api/config', async (route) => {
    const real = await (await route.fetch()).json();
    await route.fulfill({ json: { ...real, demo_url: 'https://demo.example.test' } });
  });
  await page.goto('/admin');
  const link = page.getByRole('link', { name: 'Open the demo sandbox' });
  await expect(link).toHaveAttribute('href', 'https://demo.example.test/admin');
  await expect(page.getByText('Opens demo.example.test, a separate practice site')).toBeVisible();
  await expect(page.getByText('or log in to your account')).toBeVisible();
});

test.describe('demo sandbox restrictions', () => {
  test.use({ baseURL: 'http://127.0.0.1:8012' });

  test('the new-event form greys out what a sandbox cannot use', async ({ page }) => {
    await page.goto('/admin');
    await page.getByTestId('start-demo').click();
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await page.goto('/admin/new');
    await expect(page.getByRole('radio', { name: 'Group + Play-off' })).toBeVisible();
    // No sign-up lobbies in a sandbox.
    await expect(page.getByRole('radio', { name: 'Lobby' })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Community' })).toBeDisabled();
    await expect(page.getByText('Not available in demo mode').first()).toBeVisible();
  });
});
