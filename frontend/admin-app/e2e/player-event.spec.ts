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

async function openHub(page: Page, token: string, name = 'Ana') {
  // Opening the link takes three requests in order: the link token is read (`/space`), the profile is
  // marked verified, and only then does the signed-in Hub load its own space (`/space?elo_history_limit=...`).
  // The heading exists once that last one is back, so that is the state to wait for. The first response
  // alone arrives long before the Hub can render and a busy server made the 5 s heading check flaky.
  const hubLoaded = page.waitForResponse(
    (r) => /\/api\/player-profile\/space\?/.test(r.url()) && r.ok(),
  );
  await page.goto(`/player#token=${encodeURIComponent(token)}`);
  await hubLoaded;
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

test('standings fit a phone and reveal the hidden statistics', async ({ page, request }) => {
  const { id } = await createTournament(request, 'mex', `Standings ${Date.now()}`);
  const { session } = await profileFor(request, id, 'Ana', 'standings');
  await page.setViewportSize(PHONE);
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  const table = page.getByRole('table');
  await expect(table).toBeVisible();
  const ana = table.getByRole('button', { name: 'Ana', exact: true });
  await expect(ana).toHaveAttribute('aria-expanded', 'false');
  // A phone shows P and one W–L record instead of separate W and L columns.
  for (const title of ['Matches played', 'Wins and losses'])
    await expect(table.getByRole('columnheader', { name: new RegExp(title) })).toBeVisible();
  await ana.click();
  await expect(ana).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByTestId('standings-legend')).toContainText('Wins and losses');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('set-scored standings on a 360px phone keep P, the W–L record and game difference', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'gp', `Sets table ${Date.now()}`);
  await patchTvSettings(request, id, { score_mode: { 'gp-group': 'sets' } });
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  const raw = groups.all_matches ?? groups.matches;
  const matches = (Array.isArray(raw) ? raw : Object.values(raw).flat()) as Match[];
  const { session, playerId } = await profileFor(request, id, 'Ana', 'sets-table');
  const anaMatch = matches.find((m) => [...m.team1_ids, ...m.team2_ids].includes(playerId))!;
  const saved = await request.post(`/api/tournaments/${id}/gp/record-group-tennis`, {
    headers,
    data: {
      match_id: anaMatch.id,
      sets: [
        [6, 4],
        [6, 3],
      ],
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.setViewportSize({ width: 360, height: 800 });
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  const table = page.getByRole('table').filter({ hasText: 'Ana' });
  await expect(table).toBeVisible();
  for (const title of ['Matches played', 'Wins and losses', 'Game difference'])
    await expect(table.getByRole('columnheader', { name: new RegExp(title) })).toBeVisible();
  for (const title of ['Set difference', 'Points for', 'Games for'])
    await expect(table.getByRole('columnheader', { name: new RegExp(title) })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

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

test('a signed-in player has one menu in the header: profile, the organizer door and log out', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Menu ${Date.now()}`);
  const { session } = await profileFor(request, id, 'Ana', 'menu');
  for (const phone of [true, false]) {
    await page.setViewportSize(phone ? PHONE : DESKTOP);
    await openHub(page, session.access_token);
    const header = page.locator('.app-header');
    await expect(header.getByRole('link', { name: 'Admin sign in' })).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'Log out of Player Hub' })).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'Player menu' })).toHaveCount(1);
    await header.getByRole('button', { name: 'Player menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Admin sign in' })).toHaveAttribute(
      'href',
      '/admin',
    );
    // The same sections as the phone's tab bar, with the current one marked.
    const sections = page.getByRole('menuitem');
    for (const name of ['Events', 'Hub', 'My events', 'Ratings', 'Profile'])
      await expect(sections.filter({ hasText: new RegExp(`^${name}$`) })).toHaveCount(1);
    await expect(page.getByRole('menuitem', { name: 'Hub', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.getByRole('menuitem', { name: 'Profile', exact: true }).click();
    await expect(page).toHaveURL(/\/player\/me$/);
  }
  await page.locator('.app-header').getByRole('button', { name: 'Player menu' }).click();
  await page.getByRole('menuitem', { name: 'Log out of Player Hub' }).click();
  await expect(page.getByLabel('Player passphrase')).toBeVisible();
});

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
  // No actions on a played row; only the names open the players' cards.
  await expect(played.locator('button:not([data-testid="player-name"])')).toHaveCount(0);
  await expect(played.getByTestId('player-name').first()).toBeVisible();
  // Played rows lead with the result; Ana's own pair is always the first line, with her score.
  await expect(page.getByTestId('played-summary')).toHaveText(/^(1 won · 0 lost|0 won · 1 lost)$/);
  const row = played.getByTestId('player-match');
  await expect(row).toHaveAttribute('data-result', /^(won|lost)$/);
  await expect(row.getByTestId('played-own')).toContainText('Ana');
  await expect(row.getByTestId('played-own').getByText('You', { exact: true })).toBeVisible();
  await expect(row.getByTestId('played-other')).not.toContainText('Ana');
  // The viewer's own name is plain text; every other name still opens a card.
  await expect(
    played.getByRole('button', { name: 'Open profile for Ana', exact: true }),
  ).toHaveCount(0);
  await expect(
    next.getByTestId('player-match').getByRole('button', { name: 'Open profile for Ana' }),
  ).toHaveCount(0);
  await expect(row.getByTestId('played-other').getByTestId('player-name').first()).toBeVisible();
  // The round's rank comes from the path, on the row itself.
  await expect(row.getByTestId('played-rank')).toContainText(/^#\d+/);
});

test('a hidden schedule leaves the event page without Up next or Later', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Hidden ${Date.now()}`);
  await patchTvSettings(request, id, { hide_schedule: true });
  const { session } = await profileFor(request, id, 'Ana', 'hidden');
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByText('The organizer has not published the schedule yet.')).toBeVisible();
  await expect(page.getByTestId('event-up-next')).toHaveCount(0);
  await expect(page.getByTestId('event-later')).toHaveCount(0);
});

test('a round sat out has its own row, and a tap on the rank chart shows that round', async ({
  page,
  request,
}) => {
  const names = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fabio', 'Gala', 'Hugo', 'Ines', 'Jon'];
  const { id, headers } = await createTournament(request, 'mex', `Sit out ${Date.now()}`, {
    player_names: names,
    court_names: ['Court 1', 'Court 2'],
  });
  const first = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  const playing = new Set(
    (first.current_matches as Match[]).flatMap((m) => [...m.team1_ids, ...m.team2_ids]),
  );
  const secrets = await secretsOf(request, id);
  const resting = Object.entries(secrets).find(([pid]) => !playing.has(pid))![1].name;
  for (let round = 0; round < 2; round++) {
    const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
    for (const m of matches.current_matches as Match[])
      await request.post(`/api/tournaments/${id}/mex/record`, {
        headers,
        data: { match_id: m.id, score1: 14, score2: 10 },
      });
    await request.post(`/api/tournaments/${id}/mex/next-round`, { headers, data: {} });
  }
  const { session } = await profileFor(request, id, resting, 'sitout');
  await openHub(page, session.access_token, resting);
  await page.goto(`/player/matches/tournament/${id}`);
  const played = page.getByTestId('event-played');
  const satOut = played.getByTestId('played-sat-out');
  await expect(satOut.first()).toContainText('Sat out');
  await expect(satOut.first().getByTestId('played-rank')).toContainText(/^#\d+/);
  // The overview comes before the rounds.
  const overview = page.getByTestId('tournament-path');
  expect((await overview.boundingBox())!.y).toBeLessThan((await played.boundingBox())!.y);
  const chart = overview.locator('svg[role="img"]');
  const box = (await chart.boundingBox())!;
  await page.mouse.click(box.x + 40, box.y + box.height / 2);
  await expect(played.locator('[data-flash]')).toHaveAttribute('data-round', 'Round 1');
  // Running: the table sits below, and the overview's rank leads to your row in it.
  const standings = page.getByTestId('event-standings');
  await expect(standings.getByRole('heading', { name: 'Standings', exact: true })).toBeVisible();
  expect((await standings.boundingBox())!.y).toBeGreaterThan((await played.boundingBox())!.y);
  await page.getByTestId('path-headline').click();
  await expect(standings.locator('tr[data-self][data-flash]')).toHaveCount(1);
});

test("the Hub match card shows the organizer's note and no court placeholder when courts are off", async ({
  page,
  request,
}) => {
  // No court names: the organizer does not assign courts.
  const { id, headers } = await createTournament(request, 'mex', `Note ${Date.now()}`);
  const { session, playerId } = await profileFor(request, id, 'Ana', 'note');
  const current = (await (await request.get(`/api/tournaments/${id}/mex/matches`)).json())
    .current_matches as Match[];
  const mine = current.find((m) => [...m.team1_ids, ...m.team2_ids].includes(playerId))!;
  const noted = await request.patch(`/api/tournaments/${id}/match-comment`, {
    headers,
    data: { match_id: mine.id, comment: 'Court 3 is wet, play on Court 1' },
  });
  expect(noted.ok()).toBeTruthy();
  await openHub(page, session.access_token);
  const card = page.getByTestId('active-tournament');
  await expect(card.getByTestId('match-comment')).toContainText('Court 3 is wet');
  await expect(card).not.toContainText('Waiting for a court');
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByTestId('event-up-next')).not.toContainText('Waiting for a court');
});

test('Up next follows the real court assignments; a queued match waits under Later', async ({
  page,
  request,
}) => {
  // Two groups on one court: one match is on court, the others wait in the queue.
  const { id } = await createTournament(request, 'gp', `Queue ${Date.now()}`, {
    court_names: ['Court 1'],
  });
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  const raw = groups.all_matches ?? groups.matches;
  const matches = (Array.isArray(raw) ? raw : Object.values(raw).flat()) as (Match & {
    court: string | null;
  })[];
  const secrets = await secretsOf(request, id);
  const playing = new Set(
    matches.filter((m) => m.court).flatMap((m) => [...m.team1_ids, ...m.team2_ids]),
  );
  const queuedName = Object.entries(secrets).find(([pid]) => !playing.has(pid))![1].name;
  const { session } = await profileFor(request, id, queuedName, 'queue');
  await openHub(page, session.access_token, queuedName);
  // The home card has no match to show, only why: the match waits for a court.
  const card = page.getByTestId('active-tournament');
  await expect(card.getByTestId('active-tournament-idle')).toHaveText('Waiting for a court');
  await expect(card.getByTestId('player-match')).toHaveCount(0);
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByTestId('event-later')).toContainText('Waiting for a court');
  await expect(page.getByTestId('event-up-next')).toHaveCount(0);
  // A match without a court shows no round number: the queue does not follow round order.
  await expect(page.getByTestId('event-later')).toContainText(/Group [A-Z]/);
  await expect(page.getByTestId('event-later')).not.toContainText(/\bR\d+\b/);
  // Once a match holds a court, its round label shows.
  const onCourt = matches.find((m) => m.court)!;
  const playingName = secrets[onCourt.team1_ids[0]!]!.name;
  const onCourtProfile = await profileFor(request, id, playingName, 'queue-on-court');
  await openHub(page, onCourtProfile.session.access_token, playingName);
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByTestId('event-up-next')).toContainText(/\bR\d+\b/);
});

test('the next match card shows the contacts the other players shared, and tap copies one', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'mex', `Contacts ${Date.now()}`);
  const { session, playerId, secrets } = await profileFor(request, id, 'Ana', 'contacts');
  const current = (await (await request.get(`/api/tournaments/${id}/mex/matches`)).json())
    .current_matches as Match[];
  const mine = current.find((m) => [...m.team1_ids, ...m.team2_ids].includes(playerId))!;
  const own = mine.team1_ids.includes(playerId) ? mine.team1_ids : mine.team2_ids;
  const partner = own.find((p) => p !== playerId)!;
  const [rival, silent] = mine.team1_ids.includes(playerId) ? mine.team2_ids : mine.team1_ids;
  await openHub(page, session.access_token);
  const card = page.getByTestId('active-tournament');
  await expect(card.getByTestId('player-match')).toBeVisible();
  // Nobody shared a contact yet: no button.
  await expect(card.getByTestId('match-contacts-button')).toHaveCount(0);
  for (const [pid, contact] of [
    [partner, '+34 611 111 111'],
    [rival, 'rival@example.com'],
  ]) {
    const put = await request.put(`/api/tournaments/${id}/player-secrets/${pid}/contact`, {
      headers,
      data: { contact },
    });
    expect(put.ok()).toBeTruthy();
  }
  await page.reload();
  await card.getByTestId('match-contacts-button').click();
  const list = page.getByTestId('match-contacts');
  await expect(list).toContainText(secrets[partner].name);
  await expect(list).toContainText('Partner');
  await expect(list).toContainText('+34 611 111 111');
  await expect(list).toContainText(secrets[rival].name);
  await expect(list).toContainText('Opponent');
  await expect(list).not.toContainText(secrets[silent].name);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await list.getByRole('button', { name: `Copy the contact of ${secrets[rival].name}` }).click();
  await expect(list).toContainText('Copied');
  // The event page offers the same button on Up next.
  await page.goto(`/player/matches/tournament/${id}`);
  await page.getByTestId('event-up-next').getByTestId('match-contacts-button').click();
  await expect(page.getByTestId('match-contacts')).toContainText('rival@example.com');
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
  // The status badge says it is finished; there is no repeated notice.
  await expect(page.getByTestId('event-status')).toBeVisible();
  await expect(page.getByTestId('event-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enter score' })).toHaveCount(0);
  await expect(page.getByTestId('event-played')).toBeVisible();
});

test("a tap on another player's name in the standings opens their card with their matches", async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'mex', `Card ${Date.now()}`);
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of matches.current_matches as Match[])
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
  const { session } = await profileFor(request, id, 'Ana', 'card');
  await page.setViewportSize(DESKTOP);
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  const standings = page.getByTestId('event-standings');
  await standings.getByRole('button', { name: 'Beto', exact: true }).click();
  const card = page.getByRole('dialog');
  await expect(card.getByTestId('tv-player-card')).toBeVisible();
  await expect(card.getByTestId('tv-card-match')).toHaveCount(1);
  // On a phone the name expands the row; the card button next to it opens the card.
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await page.setViewportSize(PHONE);
  await standings.getByRole('button', { name: 'Open profile for Carla' }).click();
  await expect(page.getByRole('dialog').getByTestId('tv-player-card')).toBeVisible();
});

test('a tap on an opponent in Up next opens their card, and its club tab widens it', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const s = `${Date.now()}`;
  const community = await (
    await request.post('/api/communities', { headers, data: { name: `Scout community ${s}` } })
  ).json();
  const club = await (
    await request.post('/api/clubs', {
      headers,
      data: { name: `Scout Club ${s}`, community_id: community.id },
    })
  ).json();
  const { id } = await createTournament(request, 'mex', `Scout ${s}`, {
    community_id: community.id,
    club_id: club.id,
  });
  // Round one is played; Ana's round-two match is Up next.
  const first = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of first.current_matches as Match[])
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
  expect(
    (await request.post(`/api/tournaments/${id}/mex/next-round`, { headers, data: {} })).ok(),
  ).toBeTruthy();
  const { session, playerId, secrets } = await profileFor(request, id, 'Ana', 'scout');
  const next = (await (await request.get(`/api/tournaments/${id}/mex/matches`)).json())
    .current_matches as Match[];
  const mine = next.find((m) => [...m.team1_ids, ...m.team2_ids].includes(playerId))!;
  const opponentId = (mine.team1_ids.includes(playerId) ? mine.team2_ids : mine.team1_ids)[0]!;
  const opponent = secrets[opponentId]!.name;
  // The opponent has a profile too, so their card can widen to the club.
  await profileFor(request, id, opponent, 'scout-opp');
  await page.setViewportSize(DESKTOP);
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  await page
    .getByTestId('event-up-next')
    .getByRole('button', { name: `Open profile for ${opponent}` })
    .click();
  const card = page.getByRole('dialog');
  await expect(card.getByTestId('tv-player-card')).toBeVisible();
  await expect(card.getByTestId('tv-card-match')).toHaveCount(1);
  // Signed in: the card widens to the event's club (never further).
  const scope = card.getByTestId('card-scope');
  await expect(scope).toContainText('This event');
  await scope.getByText(`Scout Club ${s}`).click();
  const wide = card.getByTestId('scoped-player-card');
  await expect(wide).toBeVisible();
  await expect(wide.getByTestId('tv-card-match')).toHaveCount(1);
  await expect(wide.getByTestId('card-match-event')).toHaveText(`Scout ${s}`);
  await expect(wide.getByTestId('card-opponents')).toBeVisible();
});

test('a finished team event keeps team cards with matches and a stage switch', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'gp', `Team card ${Date.now()}`, {
    team_mode: true,
    teams: [
      ['Ana', 'Beto'],
      ['Carla', 'Diego'],
      ['Elena', 'Fabio'],
      ['Gala', 'Hugo'],
    ],
    num_groups: 1,
    top_per_group: 2,
  });
  const { session, playerId } = await profileFor(request, id, 'Ana', 'teamcard');
  const status = await (await request.get(`/api/tournaments/${id}/gp/status`)).json();
  const team = Object.entries(status.team_roster as Record<string, string[]>).find(([, members]) =>
    members.includes(playerId),
  )![0];
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  for (const m of Object.values(groups.matches).flat() as Match[]) {
    const mine = m.team2_ids.includes(team);
    expect(
      (
        await request.post(`/api/tournaments/${id}/gp/record-group`, {
          headers,
          data: { match_id: m.id, score1: mine ? 2 : 6, score2: mine ? 6 : 2 },
        })
      ).ok(),
    ).toBeTruthy();
  }
  expect(
    (await request.post(`/api/tournaments/${id}/gp/start-playoffs`, { headers, data: {} })).ok(),
  ).toBeTruthy();
  const pending = (await (await request.get(`/api/tournaments/${id}/gp/playoffs`)).json())
    .pending as Match[];
  for (const m of pending)
    expect(
      (
        await request.post(`/api/tournaments/${id}/gp/record-playoff`, {
          headers,
          data: { match_id: m.id, score1: 6, score2: 3 },
        })
      ).ok(),
    ).toBeTruthy();
  await page.setViewportSize(DESKTOP);
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  await page
    .getByTestId('event-standings')
    .getByRole('button', { name: 'Ana & Beto', exact: true })
    .click();
  const card = page.getByRole('dialog');
  await expect(card.getByTestId('tv-player-card')).toBeVisible();
  // This stage: the three group matches. Whole event: the final too.
  await expect(card.getByTestId('tv-card-match')).toHaveCount(3);
  await expect(card.getByTestId('tv-card-members')).toContainText('Beto');
  await card.getByText('Whole event', { exact: true }).click();
  await expect(card.getByTestId('tv-card-match')).toHaveCount(4);
  await card.getByText('This stage', { exact: true }).click();
  await expect(card.getByTestId('tv-card-match')).toHaveCount(3);
});

test('a team card widens to the record of the pair together, not a member list', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const s = `${Date.now()}`;
  const community = await (
    await request.post('/api/communities', { headers, data: { name: `Pair community ${s}` } })
  ).json();
  const { id } = await createTournament(request, 'gp', `Pair ${s}`, {
    community_id: community.id,
    team_mode: true,
    teams: [
      ['Ana', 'Beto'],
      ['Carla', 'Diego'],
      ['Elena', 'Fabio'],
      ['Gala', 'Hugo'],
    ],
    num_groups: 1,
    top_per_group: 2,
  });
  const { session, playerId } = await profileFor(request, id, 'Ana', 'pair-a');
  await profileFor(request, id, 'Beto', 'pair-b');
  const status = await (await request.get(`/api/tournaments/${id}/gp/status`)).json();
  const team = Object.entries(status.team_roster as Record<string, string[]>).find(([, members]) =>
    members.includes(playerId),
  )![0];
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  for (const m of Object.values(groups.matches).flat() as Match[]) {
    const mine = m.team2_ids.includes(team);
    expect(
      (
        await request.post(`/api/tournaments/${id}/gp/record-group`, {
          headers,
          data: { match_id: m.id, score1: mine ? 2 : 6, score2: mine ? 6 : 2 },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await page.setViewportSize(DESKTOP);
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  await page
    .getByTestId('event-standings')
    .getByRole('button', { name: 'Ana & Beto', exact: true })
    .click();
  const card = page.getByRole('dialog');
  await expect(card.getByTestId('tv-card-members')).toContainText('Beto');
  await card.getByTestId('card-scope').getByText(`Pair community ${s}`).click();
  const pair = card.getByTestId('scoped-player-card');
  await expect(pair).toHaveAttribute('data-pair', '');
  await expect(pair.getByTestId('card-team-member')).toHaveCount(2);
  await expect(pair.getByTestId('tv-card-match')).toHaveCount(3);
  await expect(pair.getByTestId('card-opponents')).toBeVisible();
  await expect(pair).toContainText('Record together');
  await expect(pair).not.toContainText('Ratings belong');
  // Three matches: no length choice. A member's name opens their own card; Back returns to the pair.
  await expect(card.getByTestId('history-limit')).toHaveCount(0);
  await pair.getByTestId('card-team-member').getByRole('button', { name: 'Beto' }).click();
  await expect(card.getByTestId('scoped-player-card')).not.toHaveAttribute('data-pair', '');
  await card.getByTestId('card-back').click();
  await expect(card.getByTestId('scoped-player-card')).toHaveAttribute('data-pair', '');
});

test('a finished event leads with its final standings', async ({ page, request }) => {
  const { id, headers } = await createTournament(request, 'mex', `Final ${Date.now()}`);
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of matches.current_matches as Match[])
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
  expect((await request.post(`/api/tournaments/${id}/mex/end`, { headers })).ok()).toBeTruthy();
  expect((await request.post(`/api/tournaments/${id}/mex/finish`, { headers })).ok()).toBeTruthy();
  const { session } = await profileFor(request, id, 'Ana', 'final');
  await openHub(page, session.access_token);
  await page.goto(`/player/matches/tournament/${id}`);
  const standings = page.getByTestId('event-standings');
  await expect(standings.getByRole('heading', { name: 'Final standings' })).toBeVisible();
  const played = page.getByTestId('event-played');
  await expect(played).toBeVisible();
  expect((await standings.boundingBox())!.y).toBeLessThan((await played.boundingBox())!.y);
});

test('a picked community scope narrows the active tournaments but keeps deep links', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Scope ${Date.now()}`);
  const { session } = await profileFor(request, id, 'Ana', 'scope');
  // A second community to choose from (the tournament is in the open one).
  await page.route('**/api/player-profile/space?**', async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    json.player_communities = [
      { id: 'north', name: 'North League' },
      { id: 'open', name: 'Open' },
    ];
    await route.fulfill({ response, json });
  });
  await page.addInitScript(() => localStorage.setItem('padel-player-community', 'community:north'));
  await openHub(page, session.access_token);
  // The tournament is outside the picked community: the Hub hides it and offers its community.
  await expect(page.getByTestId('active-tournament')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open community' }).click();
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);
  await page.evaluate(() => localStorage.setItem('padel-player-community', 'community:north'));
  await page.goto('/player/matches');
  await expect(page.getByTestId('event-card')).toHaveCount(0);
  // Its own page still opens by link, and its push notifications stay on the profile page.
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await expect(page.getByText('Event not found')).toHaveCount(0);
  await page.goto('/player/me');
  await expect(page.getByRole('heading', { name: 'Notifications' })).toBeVisible();
});

test('a pinned announcement and the custom information show on the event page and as a badge on the card', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'mex', `Notes ${Date.now()}`);
  const { session } = await profileFor(request, id, 'Ana', 'notes');
  await page.setViewportSize({ width: 375, height: 800 });
  await openHub(page, session.access_token);
  const card = page.getByTestId('active-tournament');
  await expect(card).toHaveCount(1);
  // Nothing written: no badge, no link, no sections.
  await expect(card.getByTestId('active-tournament-announcement')).toHaveCount(0);
  await expect(card.getByTestId('active-tournament-info')).toHaveCount(0);
  await page.goto(`/player/matches/tournament/${id}`);
  await expect(page.getByTestId('event-up-next')).toBeVisible();
  await expect(page.getByTestId('event-announcements')).toHaveCount(0);
  await expect(page.getByTestId('event-custom-info')).toHaveCount(0);

  const posted = await request.post(`/api/tournaments/${id}/announcements`, {
    headers,
    data: { text: 'Doors close at **nine**', notify: false },
  });
  expect(posted.ok()).toBeTruthy();
  const { id: aid } = await posted.json();
  const pinned = await request.patch(`/api/tournaments/${id}/announcements/${aid}`, {
    headers,
    data: { pinned: true },
  });
  expect(pinned.ok()).toBeTruthy();
  await patchTvSettings(request, id, {
    custom_info_title: 'Tournament format',
    custom_info_text: '**Short sets**\nNo-ad scoring',
  });
  await page.reload();
  const banner = page.getByTestId('event-announcements');
  await expect(banner).toContainText('Doors close at nine');
  await expect(banner.getByText('Pinned post')).toBeVisible();
  await expect(banner.getByText('nine', { exact: true })).toHaveJSProperty('tagName', 'STRONG');
  const info = page.getByTestId('event-custom-info');
  await expect(info.getByText('Short sets', { exact: true })).toHaveJSProperty('tagName', 'STRONG');
  await expect(info).toContainText('No-ad scoring');
  await expect(page.getByRole('heading', { name: 'Tournament format' })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();

  await page.goto('/player');
  // The card has no Information link any more: the event page shows the text.
  await expect(page.getByTestId('active-tournament-info')).toHaveCount(0);
  const badge = page.getByTestId('active-tournament').getByTestId('active-tournament-announcement');
  await expect(badge).toHaveText('Announcement');
  // The card shows the badge only, never the text.
  await expect(page.getByTestId('active-tournament')).not.toContainText('Doors close');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await badge.click();
  await expect(page).toHaveURL(new RegExp(`/player/matches/tournament/${id}#announcements$`));
  await expect(page.getByTestId('event-announcements')).toBeVisible();

  // Cleared again: both disappear.
  expect(
    (await request.delete(`/api/tournaments/${id}/announcements/${aid}`, { headers })).ok(),
  ).toBeTruthy();
  await patchTvSettings(request, id, { custom_info_text: '' });
  await page.reload();
  await expect(page.getByTestId('event-up-next')).toBeVisible();
  await expect(page.getByTestId('event-announcements')).toHaveCount(0);
  await expect(page.getByTestId('event-custom-info')).toHaveCount(0);
});

test('a saved scope the player no longer has falls back to their first community', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Stale scope ${Date.now()}`);
  const { session } = await profileFor(request, id, 'Ana', 'stale');
  await page.addInitScript(() =>
    localStorage.setItem('padel-player-community', 'community:no-such-community'),
  );
  await openHub(page, session.access_token);
  // Ratings never mix communities, so the Hub never shows "all of them": it opens on the open one,
  // where this tournament is.
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('padel-player-community'))).toBe(
    'community:open',
  );
});
