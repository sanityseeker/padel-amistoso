import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import {
  adminHeaders,
  createTournament,
  loginAdmin,
  openMatchTool,
  patchTvSettings,
} from './helpers';

interface Secret {
  name: string;
  passphrase: string;
  token: string;
}
interface TeamMatch {
  id: string;
  team1_ids: string[];
  team2_ids: string[];
  effective_points_target?: number;
  round_label: string;
}

// A Mexicano tournament with `required` confirmation, a Hub profile for Ana and the id and token
// of one opponent (so the other side of a match can act through the API).
async function setup(request: APIRequestContext, label: string) {
  const { id, headers } = await createTournament(request, 'mex', `${label} ${Date.now()}`);
  await patchTvSettings(request, id, { score_confirmation: 'required' });
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, Secret>;
  const [anaId, ana] = Object.entries(secrets).find(([, p]) => p.name === 'Ana')!;
  const profile = await (
    await request.post('/api/player-profile', {
      data: {
        participant_passphrase: ana.passphrase,
        name: 'Ana',
        email: `hub-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
      },
    })
  ).json();
  const matches = (await (await request.get(`/api/tournaments/${id}/mex/matches`)).json())
    .current_matches as TeamMatch[];
  const match = matches.find((m) => [...m.team1_ids, ...m.team2_ids].includes(anaId))!;
  const mySide = match.team1_ids.includes(anaId) ? match.team1_ids : match.team2_ids;
  const otherSide = mySide === match.team1_ids ? match.team2_ids : match.team1_ids;
  const opponent = secrets[otherSide[0]!]!;
  const auth = await (
    await request.post(`/api/tournaments/${id}/player-auth`, { data: { token: opponent.token } })
  ).json();
  return {
    id,
    headers,
    match,
    profile,
    target: match.effective_points_target ?? 24,
    opponent: { Authorization: `Bearer ${auth.access_token}` },
  };
}

// Open the Hub from an email link and wait until the token has been exchanged and the space loaded.
async function openHub(page: Page, token: string) {
  const space = page.waitForResponse(
    (r) => r.url().includes('/api/player-profile/space') && r.ok(),
  );
  await page.goto(`/player#token=${encodeURIComponent(token)}`);
  await space;
}

test('signed-out deep links return to the requested Hub page after login', async ({
  page,
  request,
}) => {
  const { profile, id } = await setup(request, 'Deep link');
  await page.goto('/player/ratings');
  await expect(page.getByRole('heading', { name: 'Player Hub' })).toBeVisible();
  await page.getByLabel(/^Player passphrase/).fill(profile.profile.passphrase);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page).toHaveURL(/\/player\/ratings$/);
  await expect(page.getByRole('heading', { name: 'Ratings', exact: true })).toBeVisible();
  // An email link keeps landing on /player and is stripped from the address bar.
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await page.goto('/player/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('a player corrects the opponent score and the organizer sees it in the history', async ({
  page,
  request,
}) => {
  const { id, match, profile, target, opponent } = await setup(request, 'Correct');
  // The opponent submits 16-8; Ana is the opposing side and sees Confirm / Correct on her Hub.
  expect(
    (
      await request.post(`/api/tournaments/${id}/mex/record`, {
        headers: opponent,
        data: { match_id: match.id, score1: target - 8, score2: 8 },
      })
    ).ok(),
  ).toBeTruthy();
  await openHub(page, profile.access_token);
  const card = page.getByTestId('active-tournament');
  await expect(card.getByRole('button', { name: 'Confirm score' })).toBeVisible();
  await card.getByRole('button', { name: 'Correct score' }).click();
  const sheet = page.getByRole('dialog', { name: 'Correct the score' });
  await sheet.getByLabel(/^First side/).fill(String(target - 10));
  await sheet.getByLabel(/^Second side/).fill('10');
  await sheet.getByRole('button', { name: 'Send correction' }).click();
  await expect(sheet).not.toBeVisible();
  await expect(card.getByText(/Correction sent/)).toBeVisible();
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  const stored = matches.all_matches.find((m: { id: string }) => m.id === match.id);
  expect(stored.disputed).toBe(true);
  expect(stored.dispute_score).toEqual([target - 10, 10]);

  // Organizer side: the review queue and the score history.
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}?view=review`);
  await expect(page.getByTestId('review-queue')).toBeVisible();
  await page.goto(`/admin/t/${id}?filter=all`);
  const row = page.locator(`[data-match-id="${match.id}"]`);
  await expect(row).toBeVisible();
  await openMatchTool(page, row, 'Score history');
  await expect(page.getByTestId('history-list')).toContainText('Correction proposed');
});

test('the submitting player escalates a correction and the organizer sees it', async ({
  page,
  request,
}) => {
  const { id, match, profile, target, opponent, headers } = await setup(request, 'Escalate');
  await openHub(page, profile.access_token);
  const card = page.getByTestId('active-tournament');
  // The card fills in after the space, the status and the matches have loaded: three requests in a row.
  await expect(card.getByRole('button', { name: 'Enter score' })).toBeEnabled({ timeout: 20_000 });
  await card.getByRole('button', { name: 'Enter score' }).click();
  const sheet = page.getByRole('dialog', { name: 'Submit your score' });
  await sheet.getByLabel(/^First side/).fill('15');
  await sheet.getByLabel(/^Second side/).fill(String(target - 15));
  // Wait for the submit round trip, not for a timeout: the card re-renders from the refetch.
  const submitted = page.waitForResponse(
    (r) => r.url().includes('/mex/record') && r.request().method() === 'POST',
  );
  await sheet.getByRole('button', { name: 'Submit score' }).click();
  await sheet.getByRole('button', { name: 'Send this score' }).click();
  expect((await submitted).ok()).toBeTruthy();
  await expect(sheet).not.toBeVisible();
  await expect(card.getByText(/Waiting for the other side/)).toBeVisible();
  // The opponent proposes another score through the API.
  expect(
    (
      await request.post(`/api/tournaments/${id}/matches/${match.id}/correct`, {
        headers: opponent,
        data: { match_id: match.id, score1: 9, score2: target - 9 },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  const refreshed = page.getByTestId('active-tournament');
  await expect(refreshed.getByRole('button', { name: 'Accept correction' })).toBeVisible();
  const escalated = page.waitForResponse(
    (r) => r.url().includes('/escalate-dispute') && r.request().method() === 'POST',
  );
  await refreshed.getByRole('button', { name: 'Escalate to the organizer' }).click();
  expect((await escalated).ok()).toBeTruthy();
  await expect(refreshed.getByText(/organizer is settling/)).toBeVisible();
  const matches = await (
    await request.get(`/api/tournaments/${id}/mex/matches`, { headers })
  ).json();
  expect(matches.all_matches.find((m: { id: string }) => m.id === match.id).dispute_escalated).toBe(
    true,
  );
  await adminHeaders(request);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}?view=review`);
  await expect(page.getByText('Escalated by a player: only you can settle it.')).toBeVisible();
});

test('unlinking an event removes it from the player list', async ({ page, request }) => {
  const { profile, id } = await setup(request, 'Unlink');
  await openHub(page, profile.access_token);
  await expect(page.getByRole('heading', { name: 'Ana', exact: true })).toBeVisible();
  await page.goto('/player/matches');
  const card = page.getByTestId('event-card').first();
  await card.getByRole('button', { name: /^Event options/ }).click();
  await page.getByRole('menuitem', { name: 'Unlink from my profile' }).click();
  await page
    .getByRole('dialog', { name: 'Unlink this event?' })
    .getByRole('button', { name: 'Unlink', exact: true })
    .click();
  await expect(page.getByText('No active events')).toBeVisible();
  void id;
});

test('the tournament path and notifications show on the event page', async ({ page, request }) => {
  const { profile, id } = await setup(request, 'Path');
  await openHub(page, profile.access_token);
  await expect(page.getByRole('heading', { name: 'Ana', exact: true })).toBeVisible();
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByRole('heading', { name: 'Your tournament' })).toBeVisible();
  await expect(
    page.getByTestId('tournament-path').or(page.getByText(/Your path appears|not available/)),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
});

test('recover by participation is offered next to passphrase recovery', async ({ page }) => {
  await page.goto('/player');
  await page.getByRole('button', { name: 'Forgot your passphrase?' }).click();
  await page.getByLabel(/^Email address/).fill('nobody@example.com');
  const request = page.waitForRequest(
    (r) =>
      r.url().endsWith('/api/player-profile/recover-by-participation') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'I played in an event but have no profile' }).click();
  const sent = await request;
  expect(sent.postDataJSON()).toEqual({ email: 'nobody@example.com' });
  expect(sent.headers()['authorization']).toBeUndefined();
});

test('the Hub bottom navigation on a phone has the Hub sections', async ({ page, request }) => {
  const { profile } = await setup(request, 'Phone');
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, profile.access_token);
  // The email-link token is exchanged first; the Hub sections only exist for a signed-in session.
  await expect(page.getByRole('heading', { name: 'Ana', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Pages' });
  for (const name of ['Events', 'Hub', 'My events', 'Ratings', 'Profile'])
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Profile' }).click();
  await expect(page).toHaveURL(/\/player\/me$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('the community picker heads every Hub page and the sport choice carries across them', async ({
  page,
  request,
}) => {
  const { profile } = await setup(request, 'Filters');
  // A player rated in both sports, with one community to choose from.
  await page.route('**/api/player-profile/space?**', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.profile.elo_padel_matches = 3;
    json.profile.elo_tennis_matches = 2;
    json.player_communities = [{ id: 'north', name: 'North League' }];
    await route.fulfill({ response, json });
  });
  await openHub(page, profile.access_token);
  const filters = page.getByTestId('hub-filters');
  await expect(filters.locator('input[aria-label="Player stats scope"]')).toBeVisible();
  await filters.getByText('Tennis', { exact: true }).click();
  await expect(page.getByTestId('player-card')).toContainText('Tennis rating');

  await page.goto('/player/ratings');
  await expect(filters.getByRole('radio', { name: 'Tennis' })).toBeChecked();
  await page.goto('/player/me');
  await expect(filters.locator('input[aria-label="Player stats scope"]')).toBeVisible();
  // Profile does not split by sport, so only the community picker shows there.
  await expect(filters.getByRole('radio')).toHaveCount(0);
  await page.goto('/player');
  await expect(page.getByTestId('player-card')).toContainText('Tennis rating');
});

// ---- Sport filter (Padel / Tennis / All) -----------------------------------------------------

const SPORT_KEY = 'padel-player-sport';

// Ana with an active padel and an active tennis tournament linked to one Hub profile.
async function mixedSports(request: APIRequestContext, label: string) {
  const base = await setup(request, label);
  const tennisName = `${label} tennis ${Date.now()}`;
  const tennis = await createTournament(request, 'mex', tennisName, { sport: 'tennis' });
  const secrets = (
    await (
      await request.get(`/api/tournaments/${tennis.id}/player-secrets`, { headers: tennis.headers })
    ).json()
  ).players as Record<string, Secret>;
  const ana = Object.values(secrets).find((p) => p.name === 'Ana')!;
  const linked = await request.post('/api/player-profile/link', {
    headers: { Authorization: `Bearer ${base.profile.access_token}` },
    data: { entity_type: 'tournament', entity_id: tennis.id, passphrase: ana.passphrase },
  });
  expect(linked.ok()).toBeTruthy();
  return { ...base, tennisId: tennis.id, tennisName };
}

// One handler for the space request: route.fetch() skips other handlers, so a second route would drop the first.
const rated =
  (
    padel: number,
    tennis: number,
    mutate?: (space: { entries: Record<string, unknown>[] }) => void,
  ) =>
  async (page: Page) =>
    page.route('**/api/player-profile/space?**', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.profile.elo_padel_matches = padel;
      json.profile.elo_tennis_matches = tennis;
      mutate?.(json);
      await route.fulfill({ response, json });
    });

test('the sport filter defaults to All, filters the Hub, survives a reload and is absent on Ratings', async ({
  page,
  request,
}) => {
  const { profile, tennisName } = await mixedSports(request, 'Sport filter');
  await rated(3, 2)(page);
  await openHub(page, profile.access_token);
  const filters = page.getByTestId('hub-filters');
  await expect(filters.getByRole('radio')).toHaveCount(3);
  await expect(filters.getByRole('radio', { name: 'All' })).toBeChecked();
  await expect(page.getByTestId('active-tournament')).toHaveCount(2);
  await expect(page.getByTestId('player-card')).toHaveCount(2);

  await filters.getByText('Tennis', { exact: true }).click();
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);
  await expect(page.getByTestId('active-tournament')).toContainText(tennisName);
  await expect(page.getByTestId('player-card')).toHaveCount(1);
  await filters.getByText('Padel', { exact: true }).click();
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);
  await expect(page.getByTestId('active-tournament')).not.toContainText(tennisName);

  await filters.getByText('Tennis', { exact: true }).click();
  await page.reload();
  await expect(filters.getByRole('radio', { name: 'Tennis' })).toBeChecked();
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);

  // Ratings shows one sport at a time: no All there.
  await page.goto('/player/ratings');
  await expect(filters.getByRole('radio')).toHaveCount(2);
  await expect(filters.getByRole('radio', { name: 'All' })).toHaveCount(0);
  await expect(filters.getByRole('radio', { name: 'Tennis' })).toBeChecked();
  // With All saved, Ratings highlights the first sport and leaves the stored choice alone.
  await page.goto('/player');
  await filters.getByText('All', { exact: true }).click();
  await page.goto('/player/ratings');
  await expect(filters.getByRole('radio', { name: 'Padel' })).toBeChecked();
  expect(await page.evaluate((key) => localStorage.getItem(key), SPORT_KEY)).toBe('all');
});

test('My events follows the sport filter, with All included', async ({ page, request }) => {
  const { profile } = await mixedSports(request, 'My events sport');
  await rated(3, 2)(page);
  await openHub(page, profile.access_token);
  await page.goto('/player/matches');
  const filters = page.getByTestId('hub-filters');
  await expect(filters.getByRole('radio')).toHaveCount(3);
  await expect(filters.getByRole('radio', { name: 'All' })).toBeChecked();
  await expect(page.getByTestId('event-card')).toHaveCount(2);
  await expect(page.getByText('Active (2)', { exact: true })).toBeVisible();
  await filters.getByText('Tennis', { exact: true }).click();
  await expect(page.getByTestId('event-card')).toHaveCount(1);
  await expect(page.getByText('Active (1)', { exact: true })).toBeVisible();
});

test('a filter that hides every active tournament offers to show all sports', async ({
  page,
  request,
}) => {
  const { profile } = await mixedSports(request, 'Sport empty');
  // The padel tournament counts as finished here, so padel has nothing active.
  await rated(3, 2, (space) => {
    for (const entry of space.entries)
      if (entry.sport === 'padel') {
        entry.status = 'finished';
        entry.finished_at = new Date().toISOString();
      }
  })(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'padel'), SPORT_KEY);
  await openHub(page, profile.access_token);
  await expect(page.getByText('No active tournaments in this sport.')).toBeVisible();
  await expect(page.getByTestId('active-tournament')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show all sports' }).click();
  await expect(page.getByTestId('hub-filters').getByRole('radio', { name: 'All' })).toBeChecked();
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);
});

test('a player rated only in padel still sees an active tennis tournament', async ({
  page,
  request,
}) => {
  const { profile, tennisName } = await mixedSports(request, 'Sport unrated');
  await rated(3, 0)(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'padel'), SPORT_KEY);
  await openHub(page, profile.access_token);
  // One rated sport: no switcher, and the saved padel choice does not hide the tennis event.
  await expect(page.getByTestId('hub-filters')).toHaveCount(0);
  await expect(page.getByTestId('active-tournament')).toHaveCount(2);
  await expect(page.getByText(tennisName)).toBeVisible();
});

test('an empty stored sport reads as All', async ({ page, request }) => {
  const { profile } = await mixedSports(request, 'Sport blank');
  await rated(3, 2)(page);
  await page.addInitScript((key) => localStorage.setItem(key, ''), SPORT_KEY);
  await openHub(page, profile.access_token);
  await expect(page.getByTestId('hub-filters').getByRole('radio', { name: 'All' })).toBeChecked();
  await expect(page.getByTestId('active-tournament')).toHaveCount(2);
});

// The red dot on one item of the Hub navigation.
const navDot = (page: Page, item: string) =>
  page
    .getByRole('navigation', { name: 'Player Hub' })
    .getByRole('link', { name: item, exact: true })
    .getByTestId('nav-dot');

// ---- Entry fee badge --------------------------------------------------------------------------

test('a payment badge on the active tournament card opens the payment sheet', async ({
  page,
  request,
}) => {
  const { id, profile, headers } = await setup(request, 'Hub fee');
  expect(
    (
      await request.patch(`/api/tournaments/${id}/payment-settings`, {
        headers,
        data: { fee_cents: 1500, currency: 'EUR', instructions: 'Pay the organizer.' },
      })
    ).ok(),
  ).toBeTruthy();
  await openHub(page, profile.access_token);
  const card = page.getByTestId('active-tournament');
  const badge = card.getByTestId('payment-badge');
  await expect(badge).toHaveText('Payment due');
  // A tournament badge is on the Hub, so the Hub item lights; My events shows no badge of its own here.
  await expect(navDot(page, 'Hub')).toHaveCount(1);
  await expect(navDot(page, 'My events')).toHaveCount(0);
  await badge.click();
  const sheet = page.getByRole('dialog', { name: 'Entry fee' });
  await expect(sheet).toContainText('Pay the organizer.');
  // The payment method is required before "I've paid".
  await expect(sheet.getByRole('button', { name: "I've paid" })).toBeDisabled();
  await sheet.getByRole('combobox', { name: 'Payment method' }).click();
  await page.getByRole('option', { name: 'Bizum (phone)', exact: true }).click();
  await sheet.getByLabel('Reference or note').fill('Bizum done');
  await sheet.getByRole('button', { name: "I've paid" }).click();
  await expect(sheet.getByRole('status')).toContainText('Reported');
  await page.keyboard.press('Escape');
  await expect(badge).toHaveText('Payment reported');
  // A reported payment waits for the organizer: no dot.
  await expect(navDot(page, 'Hub')).toHaveCount(0);
  // The organizer's confirmation removes the badge and the event page says so in one line.
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, Secret>;
  const anaId = Object.entries(secrets).find(([, p]) => p.name === 'Ana')![0];
  expect(
    (
      await request.patch(`/api/tournaments/${id}/payments/${anaId}`, {
        headers,
        data: { status: 'paid' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByTestId('payment-settled')).toHaveText('Entry fee: paid');
  await expect(page.getByTestId('payment-badge')).toHaveCount(0);
  await page.goto('/player');
  await expect(page.getByTestId('payment-badge')).toHaveCount(0);
});

test('a lobby payment lights the My events dot, not the Hub dot', async ({ page, request }) => {
  const { profile, headers } = await setup(request, 'Lobby dot');
  const lobby = await (
    await request.post('/api/registrations', {
      headers,
      data: { name: `Dot lobby ${Date.now()}`, auto_send_email: false },
    })
  ).json();
  expect(
    (
      await request.post(`/api/registrations/${lobby.id}/registrant`, {
        headers,
        data: { player_name: 'Ana', profile_id: profile.profile.id },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.patch(`/api/registrations/${lobby.id}/payment-settings`, {
        headers,
        data: { fee_cents: 1500, currency: 'EUR' },
      })
    ).ok(),
  ).toBeTruthy();
  await openHub(page, profile.access_token);
  // The lobby's badge is on My events only, so that item lights and the Hub item does not.
  await expect(navDot(page, 'My events')).toHaveCount(1);
  await expect(navDot(page, 'Hub')).toHaveCount(0);
  await page.goto('/player/matches');
  await expect(
    page.getByTestId('event-card').filter({ hasText: 'Dot lobby' }).getByTestId('payment-badge'),
  ).toHaveText('Payment due');
});

test('an open payment stays on the Hub when the sport filter hides its sport', async ({
  page,
  request,
}) => {
  const { profile, headers, tennisId, tennisName } = await mixedSports(request, 'Filter fee');
  expect(
    (
      await request.patch(`/api/tournaments/${tennisId}/payment-settings`, {
        headers,
        data: { fee_cents: 1000, currency: 'EUR' },
      })
    ).ok(),
  ).toBeTruthy();
  await rated(3, 2)(page);
  await page.addInitScript((key) => localStorage.setItem(key, 'padel'), SPORT_KEY);
  await openHub(page, profile.access_token);
  const filters = page.getByTestId('hub-filters');
  await expect(filters.getByRole('radio', { name: 'Padel' })).toBeChecked();
  // The tennis tournament is outside the Padel filter but owes a fee: it stays, with its badge.
  const owing = page.getByTestId('active-tournament').filter({ hasText: tennisName });
  await expect(owing.getByTestId('payment-badge')).toHaveText('Payment due');
  await expect(page.getByTestId('active-tournament')).toHaveCount(2);
  await expect(navDot(page, 'Hub')).toHaveCount(1);
  // Once it is paid the filter applies again.
  const secrets = (
    await (await request.get(`/api/tournaments/${tennisId}/player-secrets`, { headers })).json()
  ).players as Record<string, Secret>;
  const anaId = Object.entries(secrets).find(([, p]) => p.name === 'Ana')![0];
  expect(
    (
      await request.patch(`/api/tournaments/${tennisId}/payments/${anaId}`, {
        headers,
        data: { status: 'paid' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.reload();
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);
});
