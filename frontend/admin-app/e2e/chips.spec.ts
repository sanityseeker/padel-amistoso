import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

async function createTournaments(request: APIRequestContext, prefix: string, count: number) {
  const login = await request.post('/api/auth/login', {
    data: { username: 'admin', password: 'test-admin-2026' },
  });
  const headers = { Authorization: `Bearer ${(await login.json()).access_token}` };
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const created = await request.post('/api/tournaments/mexicano', {
      headers,
      data: {
        name: `${prefix} ${i}`,
        player_names: ['Ana', 'Carlos', 'Lucia', 'Pablo'],
        num_rounds: 3,
      },
    });
    expect(created.ok()).toBeTruthy();
    ids.push((await created.json()).id);
  }
  return { headers, ids };
}

async function loginAdmin(page: Page) {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
}

test('open tournaments become persisted chips that switch client-side', async ({
  page,
  request,
}) => {
  const prefix = `Chips ${Date.now()}`;
  const { ids, headers } = await createTournaments(request, prefix, 3);
  await loginAdmin(page);
  const chips = page.getByRole('navigation', { name: 'Open tournaments' });
  await expect(chips).toHaveCount(0);
  const boot = await page.evaluate(() => window.__bootId);
  for (let i = 1; i <= 3; i++) {
    await page
      .getByRole('link', { name: `${prefix} ${i}`, exact: true })
      .first()
      .click();
    await expect(page.getByRole('heading', { name: `${prefix} ${i}` })).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Administration' })
      .getByRole('link', { name: 'Tournaments', exact: true })
      .click();
  }
  await expect(chips.getByRole('link')).toHaveCount(3);
  await expect(page.evaluate(() => localStorage.getItem('amistoso-admin-open'))).resolves.toContain(
    ids[0],
  );
  // Switching is client-side.
  await chips.getByRole('link', { name: `${prefix} 2`, exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/t/${ids[1]}$`));
  await expect(chips.getByRole('link', { name: `${prefix} 2`, exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(await page.evaluate(() => window.__bootId)).toBe(boot);
  // They survive a reload.
  await page.reload();
  await expect(chips.getByRole('link')).toHaveCount(3);
  // Closing the active chip moves to the last remaining one.
  await chips.getByRole('button', { name: `Close ${prefix} 2` }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/t/${ids[2]}$`));
  await expect(chips.getByRole('link')).toHaveCount(2);
  // Closing an inactive chip leaves the current page alone.
  await chips.getByRole('button', { name: `Close ${prefix} 1` }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/t/${ids[2]}$`));
  // Closing the last one goes to the tournaments list and hides the row.
  await chips.getByRole('button', { name: `Close ${prefix} 3` }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(chips).toHaveCount(0);
  for (const id of ids) await request.delete(`/api/tournaments/${id}`, { headers });
});

test('chips drop tournaments the server no longer has', async ({ page, request }) => {
  const { ids, headers } = await createTournaments(request, `Gone ${Date.now()}`, 1);
  await page.addInitScript((id) => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    const many = Array.from({ length: 10 }, (_, i) => ({
      id: `missing-${i}`,
      kind: 'tournament',
      name: `Missing ${i}`,
    }));
    localStorage.setItem(
      'amistoso-admin-open',
      JSON.stringify([...many, { id, kind: 'tournament', name: 'Stale name' }]),
    );
  }, ids[0]);
  await loginAdmin(page);
  const chips = page.getByRole('navigation', { name: 'Open tournaments' });
  // Entries the server no longer has are pruned; the real one keeps its fresh name.
  await expect(chips.getByRole('link')).toHaveCount(1);
  await expect(chips.getByRole('link')).not.toHaveText('Stale name');
  await page.goto(`/admin/t/${ids[0]}`);
  await request.delete(`/api/tournaments/${ids[0]}`, { headers });
  await page.reload();
  await expect(page.getByText('Tournament not found')).toBeVisible();
  await expect(chips.getByRole('link')).toHaveCount(0);
});

test('one live-update stream is open at a time and follows the route', async ({
  page,
  request,
}) => {
  const { ids, headers } = await createTournaments(request, `Live ${Date.now()}`, 1);
  await page.addInitScript(() => {
    const Native = window.EventSource;
    const open = new Set<EventSource>();
    (window as unknown as { __openStreams: () => string[] }).__openStreams = () =>
      [...open].filter((s) => s.readyState !== 2).map((s) => new URL(s.url).pathname);
    window.EventSource = class extends Native {
      constructor(url: string | URL, init?: EventSourceInit) {
        super(url, init);
        open.add(this);
      }
    } as typeof EventSource;
  });
  const streams = () =>
    page.evaluate(() => (window as unknown as { __openStreams: () => string[] }).__openStreams());
  await page.goto('/events');
  await page.getByRole('tab', { name: /^Live/ }).waitFor();
  await expect.poll(streams).toEqual(['/api/events']);
  await loginPlain(page);
  await page
    .getByRole('link', { name: /^Live \d+ 1$/ })
    .first()
    .click();
  await expect.poll(streams).toEqual([`/api/tournaments/${ids[0]}/events`]);
  await page
    .getByRole('navigation', { name: 'Pages' })
    .getByRole('link', { name: 'Events' })
    .click();
  await expect.poll(streams).toEqual(['/api/events']);
  await request.delete(`/api/tournaments/${ids[0]}`, { headers });
});

async function loginPlain(page: Page) {
  // Events -> Sign in (Player Hub login) -> the organizer link, all client-side.
  await page.locator('.app-header').getByRole('link', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Admin sign in' }).click();
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
}

test('open tabs keep exact names, describe their status, and pinned items lead the order', async ({
  page,
  request,
}) => {
  const prefix = `Dock ${Date.now()}`;
  const { ids, headers } = await createTournaments(request, prefix, 3);
  await loginAdmin(page);
  for (let i = 1; i <= 3; i++) {
    await page.goto(`/admin/t/${ids[i - 1]}`);
    await expect(page.getByRole('heading', { name: `${prefix} ${i}` })).toBeVisible();
  }
  const dock = page.getByRole('navigation', { name: 'Open tournaments' });
  const names = () =>
    dock.getByRole('link').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  // Recents keep the order they were opened in, so dock slots do not move while switching.
  await expect.poll(names).toEqual([`${prefix} 1`, `${prefix} 2`, `${prefix} 3`]);
  // Status goes in aria-describedby; the accessible name stays the tournament name.
  const second = dock.getByRole('link', { name: `${prefix} 2`, exact: true });
  const describedBy = await second.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  await expect(page.locator(`[id="${describedBy}"]`)).toContainText(/MEXICANO/i);
  // Pin the last one through its context menu: it moves to the front and is marked pinned.
  await dock.getByRole('link', { name: `${prefix} 3`, exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  await expect.poll(names).toEqual([`${prefix} 3`, `${prefix} 1`, `${prefix} 2`]);
  await expect(dock.getByText('Pinned')).toHaveCount(1);
  // A reload keeps the pin; unpinning sends it back to the recents.
  await page.reload();
  await expect.poll(names).toEqual([`${prefix} 3`, `${prefix} 1`, `${prefix} 2`]);
  await page.getByRole('button', { name: `Options for ${prefix} 3` }).click();
  await page.getByRole('menuitem', { name: 'Unpin' }).click();
  await expect(dock.getByText('Pinned')).toHaveCount(0);
  for (const id of ids) await request.delete(`/api/tournaments/${id}`, { headers });
});
