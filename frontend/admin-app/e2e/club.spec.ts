import { test, expect, type APIRequestContext } from '@playwright/test';
import { ADMIN, adminHeaders, chooseLanguage, createTournament, expectFooter } from './helpers';

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
    communityId: community.id as string,
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

test('the admin on a club subdomain lists only that club and links to the platform admin', async ({
  page,
  request,
}) => {
  const c = await club(request);
  const elsewhere = `Elsewhere ${c.s}`;
  await createTournament(request, 'mex', elsewhere);
  await page.goto(`http://${c.slug}.localhost:${PORT}/admin`);
  await page.getByLabel(/^Username/).fill(ADMIN.username);
  await page.getByLabel(/^Password/).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByPlaceholder('Search tournaments').fill(c.s);
  await expect(page.getByText(`Landing first ${c.s}`).first()).toBeVisible();
  await expect(page.getByText(`Landing sign-up ${c.s}`).first()).toBeVisible();
  await expect(page.getByText(elsewhere)).toHaveCount(0);
  // No banner: the way out is the account menu, and it changes the domain.
  await expect(page.getByText(/You are managing/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Account menu' }).first().click();
  await expect(page.getByRole('menuitem', { name: 'Open platform admin' })).toHaveAttribute(
    'href',
    `http://localhost:${PORT}/admin`,
  );
});

test('a leaderboard row opens a card for that board sport only', async ({ page, request }) => {
  const c = await club(request);
  const row = (rank: number, name: string, profile_id: string) => ({
    rank,
    name,
    elo: 1100 - rank,
    tier_name: null,
    matches: 3,
    profile_id,
  });
  let cardUrl = '';
  await page.route('**/api/clubs/*/public-leaderboard*', (route) =>
    route.fulfill({
      json: { padel: [row(1, 'Pala Pro', 'pp_pala')], tennis: [row(1, 'Net Ace', 'pp_net')] },
    }),
  );
  await page.route('**/api/clubs/*/players/*/public-card*', (route) => {
    cardUrl = route.request().url();
    return route.fulfill({
      json: {
        profile_id: 'pp_pala',
        name: 'Pala Pro',
        elo_padel: 1099,
        elo_tennis: null,
        matches_padel: 3,
        matches_tennis: 0,
        tier_name_padel: null,
        tier_name_tennis: null,
        rank_padel: 1,
        rank_tennis: null,
        recent_matches: [],
        elo_history_padel: [1090, 1099],
        elo_history_tennis: [],
        scope: { sport: 'padel', season_id: null },
      },
    });
  });
  await page.goto(`/club/${c.slug}`);
  await page.evaluate(() => localStorage.setItem('padel-player-profile', 'any-session-is-mocked'));
  await page.reload();
  await page.getByRole('button', { name: 'Open profile for Pala Pro' }).first().click();
  const card = page.getByTestId('club-player-card');
  await expect(card).toBeVisible();
  expect(cardUrl).toContain('sport=padel');
  // Only the padel panel: no tennis panel on a padel card.
  await expect(card.getByText('Padel', { exact: true })).toHaveCount(1);
  await expect(card.getByText('Tennis', { exact: true })).toHaveCount(0);
});

test('the Player Hub on a club subdomain keeps to that club, profile page included', async ({
  page,
  request,
}) => {
  const c = await club(request);
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
        name: 'Ana Club',
        email: `club-hub-${stamp()}@example.com`,
      },
    })
  ).json();
  // One fee in this club and one elsewhere: only the club's own shows here.
  const payment = (entity_id: string, entity_name: string) => ({
    key: `tournament:${entity_id}:p`,
    entity_type: 'tournament',
    entity_id,
    entity_name,
    player_id: 'p',
    status: 'unpaid',
    amount_cents: 1000,
    currency: 'EUR',
    due_at: null,
    instructions: null,
    methods: [],
    concept: entity_name,
    reference: null,
  });
  await page.route('**/api/player-profile/payments', (route) =>
    route.fulfill({
      json: [payment(c.first, `Club fee ${c.s}`), payment('elsewhere', `Other fee ${c.s}`)],
    }),
  );
  // A community picked on the main site must not carry over to the club's Hub.
  await page.addInitScript(() =>
    localStorage.setItem('padel-player-community', 'community:somewhere-else'),
  );
  const spaceUrls: string[] = [];
  page.on('request', (r) => {
    // The data loads (the bare call is the one-time exchange of the e-mail link for a session).
    if (r.url().includes('/api/player-profile/space?')) spaceUrls.push(r.url());
  });
  await page.goto(
    `http://${c.slug}.localhost:${PORT}/player#token=${encodeURIComponent(profile.access_token)}`,
  );
  await expect(page.getByRole('heading', { name: 'Your active tournaments' })).toBeVisible();
  await page.goto(`http://${c.slug}.localhost:${PORT}/player/me`);
  await expect(page.getByRole('heading', { name: 'Pending payments' })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Club fee ${c.s}` })).toBeVisible();
  await expect(page.getByText(`Other fee ${c.s}`)).toHaveCount(0);
  // The club is the scope: no picker to move it, and every request asked for the club.
  await expect(page.locator('input[aria-label="Player stats scope"]')).toHaveCount(0);
  expect(spaceUrls.length).toBeGreaterThan(0);
  for (const url of spaceUrls) expect(url).toContain(`club_id=${c.id}`);
});

test('on a club subdomain the Hub shows only the sports the player has in that club', async ({
  page,
  request,
}) => {
  const c = await club(request);
  // Ana plays tennis in this club and padel elsewhere, one scored round in each.
  const scored = async (id: string, headers: Record<string, string>) => {
    const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
    for (const m of matches.current_matches as { id: string }[])
      await request.post(`/api/tournaments/${id}/mex/record`, {
        headers,
        data: { match_id: m.id, score1: 14, score2: 10 },
      });
  };
  const passphraseOf = async (id: string, headers: Record<string, string>) =>
    Object.values(
      (await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json())
        .players as Record<string, { name: string; passphrase: string }>,
    ).find((p) => p.name === 'Ana')!.passphrase;
  const tennis = await createTournament(request, 'mex', `Club tennis ${c.s}`, {
    sport: 'tennis',
    community_id: c.communityId,
    club_id: c.id,
  });
  await scored(tennis.id, tennis.headers);
  const padel = await createTournament(request, 'mex', `Elsewhere padel ${c.s}`);
  await scored(padel.id, padel.headers);
  const profile = await (
    await request.post('/api/player-profile', {
      data: {
        participant_passphrase: await passphraseOf(tennis.id, tennis.headers),
        name: 'Ana Tennis',
        email: `club-sport-${stamp()}@example.com`,
      },
    })
  ).json();
  const linked = await request.post('/api/player-profile/link', {
    headers: { Authorization: `Bearer ${profile.access_token}` },
    data: {
      entity_type: 'tournament',
      entity_id: padel.id,
      passphrase: await passphraseOf(padel.id, padel.headers),
    },
  });
  expect(linked.ok()).toBeTruthy();
  const hub = `#token=${encodeURIComponent(profile.access_token)}`;

  // The main site has both sports, so the toggle shows.
  await page.goto(`/player${hub}`);
  await expect(page.getByTestId('player-card')).toBeVisible();
  await expect(page.getByTestId('hub-filters').getByRole('radio')).toHaveCount(2);

  // The club has tennis only: no toggle, tennis everywhere, even with padel saved.
  await page.evaluate(() => localStorage.setItem('padel-player-sport', 'padel'));
  const clubHost = `http://${c.slug}.localhost:${PORT}`;
  await page.goto(`${clubHost}/player${hub}`);
  await expect(page.getByTestId('player-card')).toContainText('Tennis rating');
  await expect(page.getByRole('radio', { name: 'Padel' })).toHaveCount(0);
  await expect(page.getByText(`Elsewhere padel ${c.s}`)).toHaveCount(0);
  await page.goto(`${clubHost}/player/ratings`);
  await expect(
    page
      .getByRole('heading', { name: 'Recent rating trend' })
      .or(page.getByRole('heading', { name: 'Community leaderboard' }))
      .first(),
  ).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Padel' })).toHaveCount(0);
});
