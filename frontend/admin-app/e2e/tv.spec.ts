import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminHeaders, chooseLanguage, expectFooter, patchTvSettings, PLAYERS } from './helpers';

// The spectator screen (/tv/<alias or id>): public data, the organizer's display flags, live refresh,
// and a player scoring their own match with the tournament token.

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function mexicano(
  request: APIRequestContext,
  name: string,
  extra: Record<string, unknown> = {},
) {
  const headers = await adminHeaders(request);
  const created = await request.post('/api/tournaments/mexicano', {
    headers,
    data: {
      name,
      player_names: PLAYERS,
      num_rounds: 3,
      total_points_per_match: 24,
      court_names: ['Court 1', 'Court 2'],
      ...extra,
    },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id as string;
  expect(
    (await request.post(`/api/tournaments/${id}/mex/next-round`, { headers, data: {} })).ok(),
  ).toBeTruthy();
  return { id, headers };
}

test('the spectator screen shows the courts and the leaderboard, in both languages', async ({
  page,
  request,
}) => {
  const name = `TV Cup ${stamp()}`;
  const { id, headers } = await mexicano(request, name);
  await request.put(`/api/tournaments/${id}/alias`, { headers, data: { alias: `tv-${stamp()}` } });
  await patchTvSettings(request, id, { banner_text: 'Doors close at nine', refresh_interval: 0 });
  await page.goto(`/tv/${id}`);
  await expect(page.getByTestId('tv-page').getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByTestId('tv-banner')).toContainText('Doors close at nine');
  await expect(page.getByTestId('tv-court')).toHaveCount(2);
  const board = page.locator('[data-section="standings"]');
  await expect(board.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  // Avg and Bh are real columns with sortable headers.
  await expect(board.getByRole('button', { name: 'Average points per match' })).toBeVisible();
  await expect(board.getByRole('columnheader', { name: 'Total points' })).toBeVisible();
  await expect(page.getByText('Manual only')).toBeVisible();
  await expectFooter(page);
  // The app header is not shown on the display screen.
  await expect(page.locator('.app-header')).toHaveCount(0);
  await chooseLanguage(page, 'Español');
  await expect(page.getByRole('heading', { name: 'Clasificación' })).toBeVisible();
  await expect(page.getByText('Solo manual')).toBeVisible();
});

test('the organizer display flags and an old query link are honoured', async ({
  page,
  request,
}) => {
  const { id } = await mexicano(request, `TV Flags ${stamp()}`);
  await patchTvSettings(request, id, {
    show_standings: false,
    show_courts: false,
    refresh_interval: 0,
  });
  await page.goto(`/tv?tid=${id}`);
  await expect(page).toHaveURL(new RegExp(`/tv/${id}$`));
  await expect(page.getByTestId('tv-page')).toBeVisible();
  await expect(page.locator('[data-section="standings"]')).toHaveCount(0);
  await expect(page.getByTestId('tv-court')).toHaveCount(0);
  await patchTvSettings(request, id, { show_standings: true, show_courts: true });
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await expect(page.locator('[data-section="standings"]')).toBeVisible();
  await expect(page.getByTestId('tv-court')).toHaveCount(2);
});

test('an unknown tournament leads to the not-found page with the reason', async ({ page }) => {
  await page.goto('/tv/no-such-event-xyz');
  await expect(page).toHaveURL(/\/404\?/);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByTestId('not-found-reason')).toContainText('Tournament data not found');
});

test('a score entered by the organizer appears without a reload (on update)', async ({
  page,
  request,
}) => {
  const { id, headers } = await mexicano(request, `TV Live ${stamp()}`);
  await patchTvSettings(request, id, { refresh_interval: -1, show_past_matches: true });
  // The shell fires this window event for every message of the followed stream, the first one
  // (the current version, sent on connect) included.
  await page.addInitScript(() => {
    const w = window as unknown as { __tvMessages: number };
    w.__tvMessages = 0;
    window.addEventListener('amistoso:tournament-update', () => void (w.__tvMessages += 1));
  });
  const seeded = page.waitForResponse(
    (r) => r.url().includes(`/api/tournaments/${id}/version`) && r.ok(),
  );
  await page.goto(`/tv/${id}`);
  await expect(page.getByTestId('tv-court')).toHaveCount(2);
  const round = (await (await request.get(`/api/tournaments/${id}/mex/matches`)).json())
    .current_matches as { id: string }[];
  // The stream must be connected and the shown version seeded before the change, or the first
  // message only seeds the version and the change is not noticed.
  await seeded;
  await page.waitForFunction(
    () => (window as unknown as { __tvMessages: number }).__tvMessages >= 1,
  );
  const done = await request.post(`/api/tournaments/${id}/mex/record`, {
    headers,
    data: { match_id: round[0].id, score1: 15, score2: 9 },
  });
  expect(done.ok()).toBeTruthy();
  await expect(
    page.locator('[data-section="past-mexicano"]').getByText('15', { exact: true }),
  ).toBeVisible();
});

test('a player scores their own match from the spectator screen', async ({ page, request }) => {
  const { id, headers } = await mexicano(request, `TV Score ${stamp()}`);
  await patchTvSettings(request, id, { refresh_interval: 0, allow_player_scoring: true });
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, { name: string; token: string }>;
  const [playerId, me] = Object.entries(secrets).find(([, p]) => p.name === 'Ana')!;
  // The QR / e-mail link signs the player in and is taken out of the address bar.
  const auth = page.waitForResponse((r) => r.url().includes(`/api/tournaments/${id}/player-auth`));
  await page.goto(`/tv/${id}?player_token=${encodeURIComponent(me.token)}`);
  expect((await auth).ok()).toBeTruthy();
  await expect(page).toHaveURL(new RegExp(`/tv/${id}$`));
  await expect(page.getByRole('button', { name: /Ana/ }).first()).toBeVisible();
  const mine = page.getByTestId('tv-court').filter({ hasText: 'Your match' });
  await expect(mine).toHaveCount(1);
  // The match on a court card is not repeated in a list of the player's own matches.
  await expect(page.locator('[data-testid="tv-match"][data-yours]')).toHaveCount(0);
  await mine.getByRole('button', { name: 'Enter score' }).click();
  const sheet = page.getByRole('dialog', { name: 'Submit your score' });
  await sheet.getByLabel(/^First side/).fill('14');
  await sheet.getByLabel(/^Second side/).fill('10');
  await sheet.getByRole('button', { name: 'Submit score' }).click();
  await sheet.getByRole('button', { name: 'Send this score' }).click();
  await expect(sheet).not.toBeVisible();
  const payload = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  const played = payload.all_matches.find((m: { team1_ids: string[]; team2_ids: string[] }) =>
    [...m.team1_ids, ...m.team2_ids].includes(playerId),
  );
  expect(played.score).toEqual([14, 10]);
  // The login is remembered for this tournament, and the player can sign out.
  await page.reload();
  await expect(page.getByRole('button', { name: /Ana/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Ana/ }).first().click();
  await page.getByRole('button', { name: 'Logout' }).click();
  await expect(page.getByRole('button', { name: 'Player Login' })).toBeVisible();
});

test('a signed-in player sees their scheduled matches highlighted', async ({ page, request }) => {
  const { id, headers } = await mexicano(request, `TV Highlight ${stamp()}`);
  await patchTvSettings(request, id, {
    refresh_interval: 0,
    allow_player_scoring: true,
    show_pending_matches: true,
  });
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, { name: string; token: string }>;
  const me = Object.values(secrets).find((p) => p.name === 'Ana')!;
  const highlighted = page.locator('[data-testid="tv-match"][data-yours]');

  await page.goto(`/tv/${id}`);
  await expect(page.getByTestId('tv-match').first()).toBeVisible();
  await expect(highlighted).toHaveCount(0);

  await page.goto(`/tv/${id}?player_token=${encodeURIComponent(me.token)}`);
  await expect(highlighted).toHaveCount(1);
  await expect(highlighted).toContainText('Ana');
  await expect(highlighted).toContainText('Your match');
});

test('with the pending list off, only a signed-in player sees their own matches', async ({
  page,
  request,
}) => {
  const { id, headers } = await mexicano(request, `TV Own ${stamp()}`, {
    assign_courts: false,
    court_names: [],
  });
  await patchTvSettings(request, id, {
    refresh_interval: 0,
    allow_player_scoring: true,
    show_pending_matches: false,
  });
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, { name: string; token: string }>;
  const me = Object.values(secrets).find((p) => p.name === 'Ana')!;

  await page.goto(`/tv/${id}`);
  await expect(page.getByRole('button', { name: 'Player Login' })).toBeVisible();
  await expect(page.getByTestId('tv-match')).toHaveCount(0);

  await page.goto(`/tv/${id}?player_token=${encodeURIComponent(me.token)}`);
  const own = page.getByTestId('tv-match');
  await expect(own).toHaveCount(1);
  await expect(own).toContainText('Ana');
  await expect(own).toContainText('Your match');
  await expect(own.getByRole('button', { name: 'Enter score' })).toBeVisible();
});

test('a player signs in on the spectator screen with the passphrase', async ({ page, request }) => {
  const { id, headers } = await mexicano(request, `TV Login ${stamp()}`);
  await patchTvSettings(request, id, { refresh_interval: 0, allow_player_scoring: true });
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, { name: string; passphrase: string }>;
  const me = Object.values(secrets).find((p) => p.name === 'Beto')!;
  await page.goto(`/tv/${id}`);
  await page.getByRole('button', { name: 'Player Login' }).click();
  const dialog = page.getByRole('dialog', { name: 'Player Login' });
  await dialog.getByLabel('Passphrase').fill('definitely-not-a-code');
  await dialog.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByLabel('Passphrase').fill(me.passphrase);
  await dialog.getByRole('button', { name: 'Login', exact: true }).click();
  await expect(page.getByRole('button', { name: /Beto/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /Beto/ }).first().click();
  await expect(page.getByTestId('tv-player-panel')).toBeVisible();
});

test('with player scoring off, nobody can sign in on the screen', async ({ page, request }) => {
  const { id } = await mexicano(request, `TV Off ${stamp()}`);
  await patchTvSettings(request, id, { refresh_interval: 0, allow_player_scoring: false });
  await page.goto(`/tv/${id}`);
  await expect(page.getByTestId('tv-court')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Player Login' })).toHaveCount(0);
});

test('a standings name opens the player card', async ({ page, request }) => {
  const { id } = await mexicano(request, `TV Card ${stamp()}`);
  await patchTvSettings(request, id, { refresh_interval: 0 });
  await page.goto(`/tv/${id}`);
  await page.getByRole('button', { name: 'Open profile for Ana' }).click();
  const card = page.getByRole('dialog');
  await expect(card.getByTestId('tv-player-card')).toBeVisible();
  await expect(card.getByText('Match history')).toBeVisible();
});

test('the phone layout has no sideways scroll and keeps the footer', async ({ page, request }) => {
  const { id } = await mexicano(request, `TV Phone ${stamp()}`);
  await patchTvSettings(request, id, { refresh_interval: 0 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tv/${id}`);
  await expect(page.getByTestId('tv-court')).toHaveCount(2);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await expectFooter(page);
});
