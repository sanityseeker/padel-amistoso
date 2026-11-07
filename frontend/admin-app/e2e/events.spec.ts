import { test, expect, type APIRequestContext } from '@playwright/test';

let prefix: string;
let headers: Record<string, string>;
let clubName: string;
let liveId: string;
let registrationId: string;
let privateId: string;

test.beforeAll(async ({ request }) => {
  prefix = `Events Browser ${Date.now()}`;
  const login = await request.post('/api/auth/login', {
    data: { username: 'admin', password: 'test-admin-2026' },
  });
  expect(login.ok()).toBeTruthy();
  headers = { Authorization: `Bearer ${(await login.json()).access_token}` };
  const community = await (
    await request.post('/api/communities', { headers, data: { name: `${prefix} Community` } })
  ).json();
  clubName = `${prefix} Club`;
  const club = await (
    await request.post('/api/clubs', {
      headers,
      data: { name: clubName, community_id: community.id },
    })
  ).json();
  const scope = { community_id: community.id, club_id: club.id };
  const live = await request.post('/api/tournaments/mexicano', {
    headers,
    data: {
      ...scope,
      name: `${prefix} Padel Live`,
      player_names: ['Ana', 'Carlos', 'Lucia', 'Pablo'],
      num_rounds: 3,
    },
  });
  expect(live.ok()).toBeTruthy();
  liveId = (await live.json()).id;
  const finished = await (
    await request.post('/api/tournaments/playoff', {
      headers,
      data: {
        ...scope,
        name: `${prefix} Tennis Final`,
        sport: 'tennis',
        participant_names: ['Elena', 'Javier'],
        team_mode: false,
      },
    })
  ).json();
  const matches = await (await request.get(`/api/tournaments/${finished.id}/po/playoffs`)).json();
  expect(
    (
      await request.post(`/api/tournaments/${finished.id}/po/record`, {
        headers,
        data: { match_id: matches.pending[0].id, score1: 6, score2: 3 },
      })
    ).ok(),
  ).toBeTruthy();
  const registration = await request.post('/api/registrations', {
    headers,
    data: {
      ...scope,
      name: `${prefix} Padel Sign-up`,
      listed: true,
      join_code: 'sample-join',
      auto_send_email: false,
    },
  });
  expect(registration.ok()).toBeTruthy();
  registrationId = (await registration.json()).id;
  const privateTournament = await request.post('/api/tournaments/mexicano', {
    headers,
    data: {
      ...scope,
      name: `${prefix} Private`,
      public: false,
      player_names: ['A', 'B', 'C', 'D'],
    },
  });
  privateId = (await privateTournament.json()).id;
  expect(
    (
      await request.post('/api/registrations', {
        headers,
        data: { ...scope, name: `${prefix} Unlisted`, listed: false, auto_send_email: false },
      })
    ).ok(),
  ).toBeTruthy();
});

async function browse(request: APIRequestContext, name: string) {
  const response = await request.get('/api/public-events');
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { id: string; name: string }[]).find(
    (event) => event.name === name,
  );
}

test('compact legacy directory keeps two tabs, sport filters and anonymous visibility', async ({
  page,
  request,
}) => {
  const authHeaders: (string | undefined)[] = [];
  await page.addInitScript(() =>
    localStorage.setItem('padel-auth-token', 'organizer-must-not-be-used'),
  );
  await page.route('**/api/public-events', async (route) => {
    authHeaders.push(route.request().headers().authorization);
    await route.continue();
  });
  await page.goto('/events');
  await expect(page.getByRole('link').filter({ hasText: prefix + ' Padel Live' })).toBeVisible();
  await expect(page.getByRole('link').filter({ hasText: prefix + ' Private' })).toHaveCount(0);
  await expect(page.getByRole('link').filter({ hasText: prefix + ' Unlisted' })).toHaveCount(0);
  await expect(
    page.getByRole('link').filter({ hasText: prefix + ' Padel Sign-up' }),
  ).toHaveAttribute('href', '/register/' + registrationId);
  await expect(page.getByRole('tab')).toHaveCount(2);
  await expect(page.locator('.hero-banner, .events-stat, .events-organizer-cta')).toHaveCount(0);
  await expect(page.getByText('Code required', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^Finished/ }).click();
  await page.getByRole('button', { name: 'Tennis', exact: true }).click();
  await expect(page.getByRole('link').filter({ hasText: prefix + ' Tennis Final' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tennis', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'Padel', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByRole('tab', { name: /^Finished/ })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(authHeaders.length).toBeGreaterThan(0);
  expect(authHeaders.every((header) => header === undefined)).toBeTruthy();
  expect(await browse(request, prefix + ' Private')).toBeUndefined();
});

test('exact event-code lookup works and legacy links preserve their destination', async ({
  page,
}) => {
  await page.goto('/events');
  await page.getByLabel('Event ID or alias').fill('not-a-real-event-id');
  await page.getByRole('button', { name: 'Find event', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No event found with that ID or alias');
  await page.getByLabel('Event ID or alias').fill(registrationId);
  await page.getByRole('button', { name: 'Find event', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/register/${registrationId}$`));
  await page.goto(`/events?tid=${liveId}&player_token=example`, { waitUntil: 'domcontentloaded' });
  expect(new URL(page.url()).pathname).toBe(`/tv/${liveId}`);
});

test('directory shows load failures, recovers, and fits a mobile screen', async ({ page }) => {
  await page.route('**/api/public-events', (route) =>
    route.fulfill({ status: 503, json: { detail: 'Event service temporarily unavailable' } }),
  );
  await page.goto('/events');
  await expect(page.getByRole('alert', { name: 'Something went wrong' })).toContainText(
    'Event service temporarily unavailable',
  );
  await expect(page.getByRole('heading', { name: 'No events found' })).toHaveCount(0);
  await page.unroute('**/api/public-events');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByRole('link').filter({ hasText: `${prefix} Padel Live` })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await expect(page.getByRole('link').filter({ hasText: `${prefix} Padel Sign-up` })).toBeVisible();
});

test('live listings update after a tournament is made public', async ({ page, request }) => {
  await page.goto(`/events?q=${encodeURIComponent(prefix)}`);
  await expect(page.getByRole('link').filter({ hasText: `${prefix} Padel Live` })).toBeVisible();
  expect(
    (
      await request.patch(`/api/tournaments/${privateId}/public`, {
        headers,
        data: { public: true },
      })
    ).ok(),
  ).toBeTruthy();
  await expect(page.getByRole('link').filter({ hasText: `${prefix} Private` })).toBeVisible({
    timeout: 10_000,
  });
});
