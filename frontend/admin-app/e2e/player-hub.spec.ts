import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin, patchTvSettings } from './helpers';

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
  await page
    .locator(`[data-match-id="${match.id}"]`)
    .getByRole('button', { name: 'Score history' })
    .click();
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
  await expect(page.getByRole('heading', { name: 'Your path' })).toBeVisible();
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
  for (const name of ['Events', 'Hub', 'My events', 'Ratings', 'Me'])
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  await nav.getByRole('link', { name: 'Me' }).click();
  await expect(page).toHaveURL(/\/player\/me$/);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
