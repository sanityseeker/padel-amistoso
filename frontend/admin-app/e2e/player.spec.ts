import { test, expect, type APIRequestContext } from '@playwright/test';
import { expectFooter } from './helpers';

interface Secret {
  name: string;
  passphrase: string;
  token: string;
}
async function fixture(request: APIRequestContext, suffix: string) {
  const login = await request.post('/api/auth/login', {
    data: { username: 'admin', password: 'test-admin-2026' },
  });
  expect(login.ok()).toBeTruthy();
  const admin = (await login.json()).access_token as string;
  const headers = { Authorization: `Bearer ${admin}` };
  const created = await request.post('/api/tournaments/mexicano', {
    headers,
    data: {
      name: `Player Browser Cup ${suffix}`,
      player_names: [
        'Anna Player',
        'Carlos',
        'Lucia',
        'Pablo',
        'Marta',
        'Diego',
        'Elena',
        'Javier',
      ],
      court_names: ['Court 1', 'Court 2'],
      num_rounds: 3,
    },
  });
  expect(created.ok()).toBeTruthy();
  const tid = (await created.json()).id as string;
  expect(
    (await request.post(`/api/tournaments/${tid}/mex/next-round`, { headers, data: {} })).ok(),
  ).toBeTruthy();
  const secrets = (
    await (await request.get(`/api/tournaments/${tid}/player-secrets`, { headers })).json()
  ).players as Record<string, Secret>;
  const [pid, secret] = Object.entries(secrets).find(([, p]) => p.name === 'Anna Player')!;
  return { tid, pid, secret, headers };
}

test('player signup, profile editing, mobile layout and separate organizer login', async ({
  page,
  request,
}) => {
  const { secret } = await fixture(request, 'signup');
  await page.addInitScript(() =>
    localStorage.setItem('padel-auth-token', 'separate-organizer-session'),
  );
  await page.goto('/player');
  await expect(page.getByRole('heading', { name: 'Player Hub' })).toBeVisible();
  await page.getByLabel(/^Player passphrase/).fill(secret.passphrase);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create player profile' })).toBeVisible();
  await page.getByLabel(/^Email address/).fill('browser-player-signup@example.com');
  await page.getByRole('button', { name: 'Create player profile' }).click();
  await expect(page.getByRole('heading', { name: 'Anna Player' })).toBeVisible();
  // Profile settings live on /player/me.
  await page.goto('/player/me');
  await expect(page.getByRole('heading', { name: 'Anna Player' })).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.getByLabel(/^Display name/).fill('Anna Updated');
  await page.getByLabel(/^Contact details/).fill('Prefer messages before 18:00');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await expect(page.getByText('Profile updated', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Anna Updated' })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  // Measure once the web fonts have settled: a swap re-flows the text.
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByRole('main').getByRole('button', { name: 'Log out of Player Hub' }).click();
  await expect(page.getByRole('heading', { name: 'Player Hub' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('padel-auth-token'))).toBe(
    'separate-organizer-session',
  );
  expect(await page.evaluate(() => localStorage.getItem('padel-player-profile'))).toBeNull();
});

test('player logs in, sees only their matches and submits a tournament score', async ({
  page,
  request,
}) => {
  const { tid, pid, secret, headers } = await fixture(request, 'scores');
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: secret.passphrase,
      name: 'Anna Player',
      email: 'browser-player-scores@example.com',
    },
  });
  expect(created.ok()).toBeTruthy();
  await page.goto('/player');
  await page.getByLabel(/^Player passphrase/).fill(secret.passphrase);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Anna Player' })).toBeVisible();
  await expectFooter(page);
  await expect(page.getByRole('link', { name: /My Hub/ })).toBeVisible();
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    window.dispatchEvent(event);
  });
  // Install lives in the top bar only: no card on the Hub.
  await expect(page.getByRole('button', { name: 'Install', exact: true })).toBeVisible();
  await expect(page.getByText('Install the app on this phone')).toHaveCount(0);
  await expect(page.getByTestId('todo-card').filter({ hasText: /Install/ })).toHaveCount(0);
  // Hub order: the active tournaments come first, then rating and statistics.
  const active = page.getByRole('heading', { name: 'Your active tournaments' });
  const rating = page.getByRole('heading', { name: 'Rating and statistics' });
  await expect(active).toBeVisible();
  expect((await active.boundingBox())!.y).toBeLessThan((await rating.boundingBox())!.y);
  await expect(page.getByTestId('active-tournament')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Enter score' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Enter score' }).click();
  const score = page.getByRole('dialog', { name: 'Submit your score' });
  await score.getByLabel(/^First side/).fill('20');
  await score.getByLabel(/^Second side/).fill('12');
  await score.getByRole('button', { name: 'Submit score' }).click();
  await score.getByRole('button', { name: 'Send this score' }).click();
  await expect(score).not.toBeVisible();
  const payload = await (
    await request.get(`/api/tournaments/${tid}/mex/matches`, { headers })
  ).json();
  const mine = payload.all_matches.find((m: { team1_ids: string[]; team2_ids: string[] }) =>
    [...m.team1_ids, ...m.team2_ids].includes(pid),
  );
  expect(mine.score).toEqual([20, 12]);
  const others = payload.all_matches.filter((m: { id: string }) => m.id !== mine.id);
  expect(others.every((m: { score: unknown }) => m.score === null)).toBeTruthy();
  // The event page lists the player's matches; the leaderboard moved to /player/ratings.
  await page.getByRole('link', { name: /Player Browser Cup scores/ }).click();
  await expect(page).toHaveURL(new RegExp(`/player/matches/tournament/${tid}$`));
  await expect(page.getByRole('heading', { name: 'Played' })).toBeVisible();
  await expect(page.getByText('20', { exact: true }).first()).toBeVisible();
  await page.goto('/player/ratings');
  await expect(page.getByRole('heading', { name: 'Community leaderboard' })).toBeVisible();
});

test('email login link is stripped and player can report a pending payment', async ({
  page,
  request,
}) => {
  const { secret, headers } = await fixture(request, 'payments');
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: secret.passphrase,
      name: 'Anna Player',
      email: 'browser-player-payments@example.com',
    },
  });
  expect(created.ok()).toBeTruthy();
  const session = await created.json();
  const lobby = await (
    await request.post('/api/registrations', {
      headers,
      data: { name: 'Player Payment Social', auto_send_email: false },
    })
  ).json();
  expect(
    (
      await request.post(`/api/registrations/${lobby.id}/registrant`, {
        headers,
        data: { player_name: 'Anna Player', profile_id: session.profile.id },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.patch(`/api/registrations/${lobby.id}/payment-settings`, {
        headers,
        data: { fee_cents: 1500, currency: 'EUR', instructions: 'Pay the organizer in cash.' },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/player#token=${encodeURIComponent(session.access_token)}`);
  await expect(page.getByRole('heading', { name: 'Anna Player' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('');
  // A payment due shows as a to-do card on the Hub and in full on /player/me.
  await expect(page.getByText('Payment due', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Pay or report' }).click();
  await expect(page).toHaveURL(/\/player\/me#payments$/);
  await expect(page.getByRole('heading', { name: 'Player Payment Social' })).toBeVisible();
  await page.getByRole('button', { name: 'I’ve paid' }).click();
  await page.getByLabel(/^Payment reference/).fill('Cash at reception');
  await page.getByRole('button', { name: 'Report payment', exact: true }).click();
  await expect(page.getByText('Awaiting confirmation', { exact: true })).toBeVisible();
});

test('player links another event and respects organizer scoring controls', async ({
  page,
  request,
}) => {
  const first = await fixture(request, 'link-first');
  const second = await fixture(request, 'link-second');
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: first.secret.passphrase,
      name: 'Anna Player',
      email: 'browser-player-link@example.com',
    },
  });
  expect(created.ok()).toBeTruthy();
  const session = await created.json();
  await page.goto(`/player#token=${encodeURIComponent(session.access_token)}`);
  await expect(page.getByRole('heading', { name: 'Anna Player' })).toBeVisible();
  await page.goto('/player/matches');
  await page.getByRole('button', { name: 'Link event', exact: true }).click();
  await page.getByLabel(/^Event passphrase/).fill(second.secret.passphrase);
  await page.getByRole('button', { name: 'Find event' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Link event', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Player Browser Cup link-second' })).toBeVisible();
  expect(
    (
      await request.patch(`/api/tournaments/${second.tid}/tv-settings`, {
        headers: second.headers,
        data: { allow_player_scoring: false },
      })
    ).ok(),
  ).toBeTruthy();
  const card = page
    .getByTestId('event-card')
    .filter({ has: page.getByRole('link', { name: 'Player Browser Cup link-second' }) });
  await card.getByRole('link', { name: 'My matches' }).click();
  await expect(page.getByRole('heading', { name: 'Up next' })).toBeVisible();
  await expect(page.getByText('Anna Player', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enter score' })).toHaveCount(0);
  await expect(page.getByTestId('event-banner')).toHaveText(
    'Your organizer enters the scores for this event.',
  );
});
