import { test, expect, devices, type APIRequestContext } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin } from './helpers';

// A real phone (mobile viewport, touch), not a narrow desktop window: there a page that overflows for
// a single frame is zoomed out to fit, so the layout grows instead of scrolling.

const { defaultBrowserType: _, ...pixel } = devices['Pixel 7'];
test.use(pixel);

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function hubProfile(request: APIRequestContext, id: string, player: string, name: string) {
  const secrets = (
    await (
      await request.get(`/api/tournaments/${id}/player-secrets`, {
        headers: await adminHeaders(request),
      })
    ).json()
  ).players as Record<string, { name: string; passphrase: string }>;
  const secret = Object.values(secrets).find((p) => p.name === player)!;
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: secret.passphrase,
      name,
      email: `touch-${stamp()}@example.com`,
    },
  });
  expect(created.ok()).toBeTruthy();
  return (await created.json()) as { access_token: string };
}

test('a select inside a bottom sheet opens under its field and keeps the page width', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Touch ${stamp()}`);
  const name = `Touch ${stamp()}`;
  await hubProfile(request, id, 'Ana', name);
  await hubProfile(request, id, 'Beto', `${name} B`);
  await loginAdmin(page);
  await page.goto('/admin/players');
  await page.getByLabel('Search players').fill(name);
  await page
    .getByTestId('profile-row')
    .filter({ hasText: name })
    .getByRole('button', { name: /Manage/ })
    .first()
    .tap();
  const width = await page.evaluate(() => innerWidth);
  const field = page.getByRole('dialog', { name }).getByLabel('Profile to merge');
  await field.scrollIntoViewIfNeeded();
  await field.tap();
  const options = page.getByRole('listbox');
  await expect(options.getByRole('option').first()).toBeVisible();
  const [box, list] = [await field.boundingBox(), await options.boundingBox()];
  expect(Math.abs(list!.x - box!.x)).toBeLessThan(8);
  expect(list!.x + list!.width).toBeLessThanOrEqual(width);
  expect(await page.evaluate(() => innerWidth)).toBe(width);
});

test('the player menu opens on screen every time, not only the first', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Touch menu ${stamp()}`);
  const secrets = (
    await (
      await request.get(`/api/tournaments/${id}/player-secrets`, {
        headers: await adminHeaders(request),
      })
    ).json()
  ).players as Record<string, { name: string; passphrase: string }>;
  const ana = Object.values(secrets).find((p) => p.name === 'Ana')!;
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: ana.passphrase,
      name: 'Ana',
      email: `menu-${stamp()}@example.com`,
    },
  });
  const token = (await created.json()).access_token as string;
  const loaded = page.waitForResponse(
    (r) => /\/api\/player-profile\/space\?/.test(r.url()) && r.ok(),
  );
  await page.goto(`/player#token=${encodeURIComponent(token)}`);
  await loaded;
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('link', { name: 'Events' })
    .first()
    .tap();
  await expect(page.getByRole('tab', { name: /^Live/ })).toBeVisible();
  const width = await page.evaluate(() => innerWidth);
  const avatar = page.getByRole('button', { name: 'Player menu' });
  for (let i = 0; i < 3; i++) {
    await avatar.tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem', { name: 'Ratings' })).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => innerWidth)).toBe(width);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
});

test('picking a community keeps the page where it was', async ({ page, request }) => {
  const { id, headers } = await createTournament(request, 'mex', `Scope ${stamp()}`);
  // A rating (one scored round) is what puts the rating card and its community picker on the Hub.
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of matches.current_matches as { id: string }[])
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
  const session = await hubProfile(request, id, 'Ana', 'Ana');
  // Two communities to choose from, added to the Hub's own response. Each answers with the full data, so
  // the page keeps its height and any movement could only come from reloading it.
  await page.route('**/api/player-profile/space?**', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.delete('community_id');
    const response = await route.fetch({ url: url.toString() });
    const json = await response.json();
    json.player_communities = [
      { id: 'north', name: 'North League' },
      { id: 'south', name: 'South League' },
    ];
    await route.fulfill({ response, json });
  });
  await page.route('**/api/player-profile/leaderboard**', async (route) => {
    const url = new URL(route.request().url());
    url.searchParams.delete('community_id');
    await route.fulfill({ response: await route.fetch({ url: url.toString() }) });
  });
  await page.setViewportSize({ width: 412, height: 560 });
  const loaded = page.waitForResponse(
    (r) => /\/api\/player-profile\/space\?/.test(r.url()) && r.ok(),
  );
  await page.goto(`/player#token=${encodeURIComponent(session.access_token)}`);
  await loaded;
  const picker = page.locator('input[aria-label="Player stats scope"]');
  await expect(picker).toBeVisible();
  // Halfway down the page, as a player reaching the rating card would be.
  await picker.evaluate((el) =>
    window.scrollBy(0, el.getBoundingClientRect().top - innerHeight / 2),
  );
  const before = await page.evaluate(() => scrollY);
  expect(before).toBeGreaterThan(0);
  const top = (await picker.boundingBox())!.y;
  const scoped = page.waitForResponse((r) => r.url().includes('community_id=south') && r.ok());
  await picker.tap();
  await page.getByRole('option', { name: 'South League' }).tap();
  await scoped;
  await expect(picker).toHaveValue('South League');
  // The bug sent the page back to the top (here about 180px up); the picker stays where it was.
  expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(40);
  expect(Math.abs((await picker.boundingBox())!.y - top)).toBeLessThan(40);
  await expect(picker).toBeInViewport();
});

test('fields are at least 16 px on a touch screen, so iOS does not zoom in on focus', async ({
  page,
}) => {
  // The default interface size is 95 %, which makes 1 rem 15.2 px. Radios and checkboxes (the
  // segmented controls) take no text, so iOS never zooms for them.
  const smallest = () =>
    page.evaluate(() =>
      Math.min(
        ...[
          ...document.querySelectorAll(
            'input:not([type=hidden], [type=radio], [type=checkbox]), select, textarea',
          ),
        ]
          .filter((el) => (el as HTMLElement).offsetParent !== null)
          .map((el) => parseFloat(getComputedStyle(el).fontSize)),
      ),
    );
  await page.goto('/player');
  await expect(page.getByLabel(/^Player passphrase/)).toBeVisible();
  expect(await smallest()).toBeGreaterThanOrEqual(16);
  await page.goto('/events');
  await expect(page.getByRole('textbox').first()).toBeVisible();
  expect(await smallest()).toBeGreaterThanOrEqual(16);
});

// Two fingers through the Chrome DevTools protocol: Playwright's touchscreen only taps.
async function pinch(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  from: number,
  to: number,
) {
  const cdp = await page.context().newCDPSession(page);
  const points = (d: number) => [
    { x: x - d / 2, y, id: 1 },
    { x: x + d / 2, y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(from) });
  for (let i = 1; i <= 10; i++)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: points(from + ((to - from) * i) / 10),
    });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const scaleOf = (img: import('@playwright/test').Locator) =>
  img.evaluate((el) => Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1]));

test('bracket pictures zoom with a pinch and a double tap, on the workspace and the TV', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'po', `Zoom ${stamp()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByTestId('bracket').getByText('Diagram', { exact: true }).click();
  const img = page.getByTestId('bracket-diagram').getByRole('img');
  await expect(img).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).complete)).toBe(true);
  const box = (await img.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.touchscreen.tap(cx, cy);
  await page.touchscreen.tap(cx, cy);
  await expect.poll(() => scaleOf(img)).toBe(2.5);
  await page.touchscreen.tap(cx, cy);
  await page.touchscreen.tap(cx, cy);
  await expect.poll(() => scaleOf(img)).toBe(1);
  await pinch(page, cx, cy, 60, 180);
  await expect.poll(() => scaleOf(img)).toBeGreaterThan(2);

  await page.goto(`/tv/${id}`);
  await page.getByTestId('tv-bracket').getByRole('button').first().click();
  const zoom = page.getByTestId('tv-bracket-zoom').getByRole('img');
  await expect(zoom).toBeVisible();
  const lb = (await zoom.boundingBox())!;
  await pinch(page, lb.x + lb.width / 2, lb.y + lb.height / 2, 60, 180);
  await expect.poll(() => scaleOf(zoom)).toBeGreaterThan(2);
  await page.getByRole('button', { name: 'Reset zoom' }).click();
  await expect.poll(() => scaleOf(zoom)).toBe(1);
});
