import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, openDisplay, patchTvSettings, PLAYERS } from './helpers';

interface Secret {
  name: string;
  passphrase: string;
  token: string;
}
interface Match {
  id: string;
  team1_ids: string[];
  team2_ids: string[];
}

const secretsOf = async (request: APIRequestContext, id: string) =>
  (
    await (
      await request.get(`/api/tournaments/${id}/player-secrets`, {
        headers: await adminHeaders(request),
      })
    ).json()
  ).players as Record<string, Secret>;

// A Hub profile for `name` in tournament `id`; returns the profile session and the player's ids.
async function profileFor(request: APIRequestContext, id: string, name: string, suffix: string) {
  const secrets = await secretsOf(request, id);
  const [playerId, secret] = Object.entries(secrets).find(([, p]) => p.name === name)!;
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: secret.passphrase,
      name,
      email: `event-${suffix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    },
  });
  expect(created.ok()).toBeTruthy();
  return { session: await created.json(), playerId, secrets };
}

async function openHub(page: Page, token: string) {
  // Opening the link takes three requests in order: the link token is read (`/space`), the profile is
  // marked verified, and only then does the signed-in Hub load its own space (`/space?elo_history_limit=...`).
  // The heading exists once that last one is back, so that is the state to wait for. The first response
  // alone arrives long before the Hub can render and a busy server made the 5 s heading check flaky.
  const hubLoaded = page.waitForResponse(
    (r) => /\/api\/player-profile\/space\?/.test(r.url()) && r.ok(),
  );
  await page.goto(`/player#token=${encodeURIComponent(token)}`);
  await hubLoaded;
  await expect(page.getByRole('heading', { name: 'Ana', exact: true })).toBeVisible();
}

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const installPrompt = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event('beforeinstallprompt', { cancelable: true })));

async function expectChromeControls(page: Page, phone: boolean) {
  await installPrompt(page);
  await expect(page.getByRole('button', { name: /^Preferences:/ }).first()).toBeVisible();
  if (phone) {
    await expect(page.getByRole('button', { name: 'Install app', exact: true })).toBeVisible();
  } else {
    await expect(page.getByRole('button', { name: 'Install', exact: true })).toBeVisible();
  }
  await openDisplay(page);
  await expect(page.getByRole('radiogroup', { name: 'Language' })).toBeVisible();
  await page.keyboard.press('Escape');
}

test('Display and Install are in the top bar when signed out, at phone and desktop widths', async ({
  page,
}) => {
  for (const phone of [false, true]) {
    await page.setViewportSize(phone ? PHONE : DESKTOP);
    await page.goto('/player');
    await expect(page.getByRole('heading', { name: 'Player Hub' })).toBeVisible();
    await expectChromeControls(page, phone);
  }
});

test('Display and Install are in the top bar when signed in, and Me has neither', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Chrome ${Date.now()}`);
  const { session } = await profileFor(request, id, 'Ana', 'chrome');
  for (const phone of [false, true]) {
    await page.setViewportSize(phone ? PHONE : DESKTOP);
    await openHub(page, session.access_token);
    await expectChromeControls(page, phone);
    // No install card or Display panel on the Hub itself.
    await expect(page.getByTestId('todo-card').filter({ hasText: /Install/ })).toHaveCount(0);
    await page.goto('/player/me');
    await expect(page.getByRole('heading', { name: 'Ana', exact: true })).toBeVisible();
    await installPrompt(page);
    await expect(
      page.getByRole('main').getByRole('button', { name: 'Install app', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole('radiogroup', { name: 'Language' })).toHaveCount(0);
    await expect(page.getByText('This device')).toHaveCount(0);
    await expect(
      page.getByRole('main').getByRole('button', { name: 'Log out of Player Hub' }),
    ).toBeVisible();
  }
});

test('the event page lists Up next first, then Played', async ({ page, request }) => {
  const { id, headers } = await createTournament(request, 'mex', `Order ${Date.now()}`);
  const { session } = await profileFor(request, id, 'Ana', 'order');
  // Round 1 is played, round 2 is next.
  const round = (await (await request.get(`/api/tournaments/${id}/mex/matches`)).json())
    .current_matches as Match[];
  for (const m of round)
    expect(
      (
        await request.post(`/api/tournaments/${id}/mex/record`, {
          headers,
          data: { match_id: m.id, score1: 14, score2: 10 },
        })
      ).ok(),
    ).toBeTruthy();
  expect(
    (await request.post(`/api/tournaments/${id}/mex/next-round`, { headers, data: {} })).ok(),
  ).toBeTruthy();
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  const next = page.getByTestId('event-up-next');
  const played = page.getByTestId('event-played');
  await expect(next.getByTestId('player-match')).toHaveCount(1);
  await expect(played.getByTestId('player-match')).toHaveCount(1);
  await expect(page.getByTestId('event-later')).toHaveCount(0);
  expect((await next.boundingBox())!.y).toBeLessThan((await played.boundingBox())!.y);
  await expect(page.getByTestId('event-banner')).toHaveCount(0);
  await expect(next.getByRole('button', { name: 'Enter score' })).toBeVisible();
  await expect(played.getByRole('button')).toHaveCount(0);
});

test('a player whose opponent is not decided yet cannot enter a score', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'po', `Bracket ${Date.now()}`);
  const { session, playerId } = await profileFor(request, id, 'Ana', 'bracket');
  const headers = await adminHeaders(request);
  const pending = (await (await request.get(`/api/tournaments/${id}/po/playoffs`)).json())
    .pending as Match[];
  const semi = pending.find((m) => [...m.team1_ids, ...m.team2_ids].includes(playerId))!;
  const wins = semi.team1_ids.includes(playerId);
  expect(
    (
      await request.post(`/api/tournaments/${id}/po/record`, {
        headers,
        data: { match_id: semi.id, score1: wins ? 6 : 3, score2: wins ? 3 : 6 },
      })
    ).ok(),
  ).toBeTruthy();
  await openHub(page, session.access_token);
  const card = page.getByTestId('active-tournament');
  await expect(card.getByText('Waiting for your opponent')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Enter score' })).toHaveCount(0);
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(
    page.getByTestId('event-later').getByText('Waiting for your opponent'),
  ).toBeVisible();
  await expect(page.getByTestId('event-played').getByTestId('player-match')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Enter score' })).toHaveCount(0);
});

test('a Mexicano player who sits out sees one banner and no score button', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Sit out ${Date.now()}`, {
    player_names: PLAYERS.slice(0, 5),
    court_names: ['Court 1'],
  });
  const status = await (await request.get(`/api/tournaments/${id}/mex/status`)).json();
  expect(status.current_sit_out_ids).toHaveLength(1);
  const name = status.players.find((p: { id: string }) => p.id === status.current_sit_out_ids[0])
    .name as string;
  const { session } = await profileFor(request, id, name, 'sitout');
  const space = page.waitForResponse(
    (r) => r.url().includes('/api/player-profile/space') && r.ok(),
  );
  await page.goto(`/player#token=${encodeURIComponent(session.access_token)}`);
  await space;
  await expect(
    page.getByTestId('active-tournament').getByText('You sit out this round'),
  ).toBeVisible();
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByTestId('event-banner')).toHaveText('You sit out this round');
  await expect(page.getByTestId('event-banner')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Enter score' })).toHaveCount(0);
});

test('a concurrent submit shows the error and the card refreshes', async ({ page, request }) => {
  const { id } = await createTournament(request, 'mex', `Race ${Date.now()}`);
  // Required confirmation keeps the card in place when the opponent scores first.
  await patchTvSettings(request, id, { score_confirmation: 'required' });
  const { session, playerId, secrets } = await profileFor(request, id, 'Ana', 'race');
  const current = (await (await request.get(`/api/tournaments/${id}/mex/matches`)).json())
    .current_matches as Match[];
  const match = current.find((m) => [...m.team1_ids, ...m.team2_ids].includes(playerId))!;
  const otherSide = match.team1_ids.includes(playerId) ? match.team2_ids : match.team1_ids;
  const auth = await (
    await request.post(`/api/tournaments/${id}/player-auth`, {
      data: { token: secrets[otherSide[0]!]!.token },
    })
  ).json();
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  await page.getByRole('button', { name: 'Enter score' }).click();
  const sheet = page.getByRole('dialog', { name: 'Submit your score' });
  await sheet.getByLabel(/^First side/).fill('10');
  await sheet.getByLabel(/^Second side/).fill('14');
  // The opponent gets there first.
  expect(
    (
      await request.post(`/api/tournaments/${id}/mex/record`, {
        headers: { Authorization: `Bearer ${auth.access_token}` },
        data: { match_id: match.id, score1: 12, score2: 12 },
      })
    ).ok(),
  ).toBeTruthy();
  await sheet.getByRole('button', { name: 'Submit score' }).click();
  await sheet.getByRole('button', { name: 'Send this score' }).click();
  await expect(sheet.getByRole('alert')).toContainText('A score was already submitted');
  // The review step stays open with the error; go back to the form, then close the sheet.
  await sheet.getByRole('button', { name: 'Back' }).click();
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  // The card was refreshed by the failed submit: the opponent's score now waits for Ana.
  await expect(page.getByRole('button', { name: 'Enter score' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm score' })).toBeVisible();
});

test('active and past tournaments are separate sections and a past one opens read-only', async ({
  page,
  request,
}) => {
  const past = await createTournament(request, 'po', `Past ${Date.now()}`);
  const live = await createTournament(request, 'mex', `Live ${Date.now()}`);
  const { session } = await profileFor(request, past.id, 'Ana', 'past');
  const livePass = await secretsOf(request, live.id);
  const [, liveSecret] = Object.entries(livePass).find(([, p]) => p.name === 'Ana')!;
  const link = await request.post('/api/player-profile/link', {
    headers: { Authorization: `Bearer ${session.access_token}` },
    data: { entity_type: 'tournament', entity_id: live.id, passphrase: liveSecret.passphrase },
  });
  expect(link.ok()).toBeTruthy();
  // Finish the play-off.
  for (let round = 0; round < 4; round++) {
    const pending = (await (await request.get(`/api/tournaments/${past.id}/po/playoffs`)).json())
      .pending as Match[];
    for (const m of pending.filter((x) => x.team1_ids.length && x.team2_ids.length))
      await request.post(`/api/tournaments/${past.id}/po/record`, {
        headers: past.headers,
        data: { match_id: m.id, score1: 6, score2: 3 },
      });
  }
  await openHub(page, session.access_token);
  const active = page.getByRole('region', { name: 'Your active tournaments' });
  const pastSection = page.getByRole('region', { name: 'Past tournaments' });
  await expect(active.getByTestId('active-tournament')).toHaveCount(1);
  await expect(active.getByText(/Live /)).toBeVisible();
  await expect(active.getByText(/Past /)).toHaveCount(0);
  await expect(pastSection.getByTestId('past-tournament')).toHaveCount(1);
  await expect(pastSection.getByText(/Past /).first()).toBeVisible();
  expect((await active.boundingBox())!.y).toBeLessThan((await pastSection.boundingBox())!.y);
  await pastSection.getByRole('link', { name: /Past / }).first().click();
  await expect(page).toHaveURL(new RegExp(`/player/matches/tournament/${past.id}$`));
  await expect(page.getByTestId('event-banner')).toHaveText(
    'This event is finished. Matches are shown for reference.',
  );
  await expect(page.getByRole('button', { name: 'Enter score' })).toHaveCount(0);
  await expect(page.getByTestId('event-played')).toBeVisible();
});

test('a picked community scope does not hide tournaments in progress', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Scope ${Date.now()}`);
  const { session } = await profileFor(request, id, 'Ana', 'scope');
  await page.addInitScript(() =>
    localStorage.setItem('padel-player-community', 'community:no-such-community'),
  );
  await openHub(page, session.access_token);
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await expect(page.getByText('Event not found')).toHaveCount(0);
});
