import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminHeaders, chooseLanguage, expectFooter } from './helpers';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function club(request: APIRequestContext) {
  const headers = await adminHeaders(request);
  const s = stamp();
  const community = await (
    await request.post('/api/communities', { headers, data: { name: `Landing community ${s}` } })
  ).json();
  const created = await (
    await request.post('/api/clubs', {
      headers,
      data: { name: `Landing Club ${s}`, community_id: community.id },
    })
  ).json();
  const slug = `lc${s}`.slice(0, 24).toLowerCase();
  expect(
    (await request.patch(`/api/clubs/${created.id}/slug`, { headers, data: { slug } })).ok(),
  ).toBeTruthy();
  const scope = { community_id: community.id, club_id: created.id };
  const make = async (name: string, extra: Record<string, unknown> = {}) =>
    (
      await (
        await request.post('/api/tournaments/mexicano', {
          headers,
          data: {
            ...scope,
            name,
            player_names: ['Ana', 'Beto', 'Carla', 'Diego'],
            num_rounds: 3,
            ...extra,
          },
        })
      ).json()
    ).id as string;
  const first = await make(`Landing first ${s}`);
  const pinned = await make(`Landing pinned ${s}`);
  await make(`Landing private ${s}`, { public: false });
  await request.post('/api/registrations', {
    headers,
    data: { ...scope, name: `Landing sign-up ${s}`, listed: true, auto_send_email: false },
  });
  const tagline = `The home of tests ${s}`;
  expect(
    (
      await request.patch(`/api/clubs/${created.id}/landing`, {
        headers,
        data: { description: tagline, pinned_tournament_ids: [`tn:${pinned}`] },
      })
    ).ok(),
  ).toBeTruthy();
  return {
    id: created.id as string,
    slug,
    s,
    first,
    pinned,
    tagline,
    name: `Landing Club ${s}`,
    headers,
  };
}

const PORT = process.env.AMISTOSO_E2E_PORT ?? '8011';

test('a club subdomain serves the landing page: identity, tagline, pinned first, no private events', async ({
  page,
  request,
}) => {
  const c = await club(request);
  await page.goto(`http://${c.slug}.localhost:${PORT}/`);
  await expect(page.getByTestId('club-page')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: c.name })).toBeVisible();
  await expect(page.getByText(c.tagline)).toBeVisible();
  const rows = page.getByTestId('club-event');
  await expect(rows.filter({ hasText: `Landing first ${c.s}` })).toHaveCount(1);
  await expect(rows.filter({ hasText: `Landing sign-up ${c.s}` })).toHaveCount(1);
  await expect(page.getByText(`Landing private ${c.s}`)).toHaveCount(0);
  // The pinned event leads its group.
  await expect(rows.first()).toContainText(`Landing pinned ${c.s}`);
  await expectFooter(page);
  // Anonymous visitors see no leaderboard.
  await expect(page.getByTestId('club-leaderboard')).toHaveCount(0);
  // Sport filter and the lookup box.
  await page
    .getByRole('radiogroup', { name: 'Sport' })
    .locator('label')
    .filter({ hasText: 'Tennis' })
    .click();
  await expect(rows).toHaveCount(0);
  await page
    .getByRole('radiogroup', { name: 'Sport' })
    .locator('label')
    .filter({ hasText: 'All' })
    .click();
  await page.getByLabel(/^Tournament \/ registration ID or alias/).fill(c.first);
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/tv/${c.first}`));
});

test('the same page is served by path, and a signed-in player sees the leaderboard', async ({
  page,
  request,
}) => {
  const c = await club(request);
  const headers = await adminHeaders(request);
  void headers;
  await page.goto(`/club/${c.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: c.name })).toBeVisible();
  // Any Player Hub session is enough to read the members-only leaderboard.
  const secrets = (
    await (
      await request.get(`/api/tournaments/${c.first}/player-secrets`, { headers: c.headers })
    ).json()
  ).players as Record<string, { name: string; passphrase: string }>;
  const ana = Object.values(secrets).find((p) => p.name === 'Ana')!;
  const profile = await (
    await request.post('/api/player-profile', {
      data: {
        participant_passphrase: ana.passphrase,
        name: 'Ana Landing',
        email: `landing-${stamp()}@example.com`,
      },
    })
  ).json();
  await page.evaluate(
    ({ token, data }) => {
      localStorage.setItem('padel-player-profile', token);
      localStorage.setItem('padel-player-profile-data', JSON.stringify(data));
    },
    { token: profile.access_token, data: profile.profile },
  );
  await page.reload();
  await expect(page.getByTestId('club-leaderboard')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Leaderboard' })).toBeVisible();
  await chooseLanguage(page, 'Español');
  await expect(page.getByRole('heading', { name: 'Eventos' })).toBeVisible();
});

test('an unknown club leads to the not-found page', async ({ page }) => {
  await page.goto('/club/no-such-club-here');
  await expect(page).toHaveURL(/\/404\?/);
  await expect(page.getByTestId('not-found-reason')).toContainText('Club not found');
});

test('an unknown subdomain gets the not-found page with a 404 status', async ({ page }) => {
  const response = await page.goto(`http://nosuchclub.localhost:${PORT}/`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('the club page fits a phone', async ({ page, request }) => {
  const c = await club(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`http://${c.slug}.localhost:${PORT}/`);
  await expect(page.getByTestId('club-page')).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
