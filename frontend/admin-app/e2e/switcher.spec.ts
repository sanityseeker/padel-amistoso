import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin, PLAYERS } from './helpers';

// Opens a workspace and waits until the app has registered it as open (a bare goto can be replaced
// by the next one before the page has hydrated).
async function visit(page: Page, id: string, name: string) {
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

const dockNav = (page: Page) => page.getByRole('navigation', { name: 'Open tournaments' });

async function twoTournaments(request: APIRequestContext, prefix: string) {
  const a = await createTournament(request, 'mex', `${prefix} Alpha`);
  const b = await createTournament(request, 'gp', `${prefix} Bravo`);
  return { a: a.id, b: b.id, headers: a.headers };
}

async function cleanup(request: APIRequestContext, ids: string[]) {
  const headers = await adminHeaders(request);
  for (const id of ids) await request.delete(`/api/tournaments/${id}`, { headers });
}

test('Ctrl+K opens the palette, searches the cache and jumps to a tournament', async ({
  page,
  request,
}) => {
  const prefix = `Pal ${Date.now()}`;
  const { a, b } = await twoTournaments(request, prefix);
  await loginAdmin(page);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('Search or jump...').fill(`${prefix} bravo`);
  await expect(dialog.getByRole('button', { name: new RegExp(`${prefix} Bravo`) })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/admin/t/${b}$`));
  await expect(page.getByRole('heading', { name: `${prefix} Bravo` })).toBeVisible();
  // Exact id match wins, and the english command labels are indexed too.
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByPlaceholder('Search or jump...').fill(a);
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/admin/t/${a}$`));
  // Preferences work from the palette and survive a reload through the normal storage keys.
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByPlaceholder('Search or jump...').fill('language espanol');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Torneos', exact: true }).first()).toBeVisible();
  await page.keyboard.press('Control+k');
  await page
    .getByRole('dialog')
    .getByPlaceholder(/^Buscar o ir a/)
    .fill('log out');
  await expect(
    page.getByRole('dialog').getByRole('button', { name: /Cerrar sesión/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.setItem('amistoso-lang', 'en'));
  await cleanup(request, [a, b]);
});

test('Alt+1 jumps to dock slot 1, Alt+Down cycles and Alt+Backspace goes back', async ({
  page,
  request,
}) => {
  const prefix = `Slot ${Date.now()}`;
  const { a, b } = await twoTournaments(request, prefix);
  await loginAdmin(page);
  await visit(page, a, `${prefix} Alpha`);
  await visit(page, b, `${prefix} Bravo`);
  await page.keyboard.press('Alt+1');
  await expect(page).toHaveURL(new RegExp(`/admin/t/${a}$`));
  await page.keyboard.press('Alt+2');
  await expect(page).toHaveURL(new RegExp(`/admin/t/${b}$`));
  await page.keyboard.press('Alt+Backspace');
  await expect(page).toHaveURL(new RegExp(`/admin/t/${a}$`));
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(new RegExp(`/admin/t/${b}$`));
  await expect(
    dockNav(page).getByRole('link', { name: `${prefix} Bravo`, exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  // g then c goes to Clubs; bare keys are ordinary typing elsewhere.
  await page.keyboard.press('g');
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/admin\/clubs$/);
  await cleanup(request, [a, b]);
});

test('switching away and back restores the view, filter and scroll position', async ({
  page,
  request,
}) => {
  const prefix = `View ${Date.now()}`;
  const { a, b } = await twoTournaments(request, prefix);
  await loginAdmin(page);
  await page.setViewportSize({ width: 1280, height: 520 });
  await visit(page, a, `${prefix} Alpha`);
  await visit(page, b, `${prefix} Bravo`);
  await page.locator('label', { hasText: 'All matches' }).click();
  await expect(page).toHaveURL(/filter=all/);
  await expect(page.getByTestId('match-row').first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 260));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  // The position is saved from a scroll listener: wait until it is in the stored view state.
  await expect
    .poll(() =>
      page.evaluate((tid) => {
        const stored = JSON.parse(sessionStorage.getItem('amistoso-admin-view') ?? '{}');
        return stored[tid]?.scrollY ?? 0;
      }, b),
    )
    .toBeGreaterThan(100);
  // Away, then back through the dock: no query string, same place.
  await dockNav(page)
    .getByRole('link', { name: `${prefix} Alpha`, exact: true })
    .click();
  await expect(page.getByRole('heading', { name: `${prefix} Alpha` })).toBeVisible();
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page).toHaveURL(/view=players/);
  await dockNav(page)
    .getByRole('link', { name: `${prefix} Bravo`, exact: true })
    .click();
  await expect(page).toHaveURL(/filter=all/);
  await expect(page.getByRole('radio', { name: 'All matches' })).toBeChecked();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await dockNav(page)
    .getByRole('link', { name: `${prefix} Alpha`, exact: true })
    .click();
  await expect(page.getByRole('tab', { name: 'Players' })).toHaveAttribute('aria-selected', 'true');
  // A deep link wins over memory, and a view the tournament does not have falls back quietly.
  await page.goto(`/admin/t/${a}?view=matches`);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto(`/admin/t/${a}?view=nonsense`);
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await cleanup(request, [a, b]);
});

test('Next round through the palette opens the confirmation and does nothing until confirmed', async ({
  page,
  request,
}) => {
  const name = `Next ${Date.now()}`;
  const { id, headers } = await createTournament(request, 'mex', name);
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const match of matches.current_matches ?? matches.all_matches)
    expect(
      (
        await request.post(`/api/tournaments/${id}/mex/record`, {
          headers,
          data: { match_id: match.id, score1: 14, score2: 10 },
        })
      ).ok(),
    ).toBeTruthy();
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByRole('button', { name: 'Next round' })).toBeVisible();
  const rounds = async () =>
    (await (await request.get(`/api/tournaments/${id}/mex/status`)).json()).current_round as number;
  const before = await rounds();
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').getByPlaceholder('Search or jump...').fill('next round');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Next round\.\.\./ })
    .click();
  const confirm = page.getByRole('dialog', { name: 'Generate the next round?' });
  await expect(confirm).toBeVisible();
  expect(await rounds()).toBe(before);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toHaveCount(0);
  expect(await rounds()).toBe(before);
  await cleanup(request, [id]);
});

test('single-key shortcuts are ignored while typing in a score input', async ({
  page,
  request,
}) => {
  const name = `Keys ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page
    .getByRole('button', { name: /^(Record score|More scoring options):/ })
    .first()
    .click();
  const input = page.getByTestId('score-1');
  await expect(input).toBeFocused();
  for (const key of ['g', 'c', 'j', 's', '?', '/']) await page.keyboard.press(key);
  await page.keyboard.type('7');
  await expect(page).toHaveURL(new RegExp(`/admin/t/${id}$`));
  await expect(input).toHaveValue('7');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  // With nothing focused, j selects a match and ? lists the shortcuts.
  await page.locator('body').click({ position: { x: 5, y: 400 } });
  await page.keyboard.press('j');
  await expect(page.locator('[data-testid="match-row"][data-selected]')).toHaveCount(1);
  await page.keyboard.press('Shift+/');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await cleanup(request, [id]);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('switcher sheet searches, switches and the swipe strip has tap controls', async ({
    page,
    request,
  }) => {
    const prefix = `Sheet ${Date.now()}`;
    const { a, b } = await twoTournaments(request, prefix);
    await loginAdmin(page);
    await visit(page, a, `${prefix} Alpha`);
    await visit(page, b, `${prefix} Bravo`);
    const bottom = page.getByRole('navigation', { name: 'Administration' });
    await expect(bottom.getByRole('link', { name: 'Tournaments', exact: true })).toBeVisible();
    // The strip exists with two open items, and its arrow is the non-gesture way to switch.
    const strip = page.getByTestId('swipe-strip');
    await expect(strip).toBeVisible();
    await strip.getByRole('button', { name: 'Previous tournament' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/t/${a}$`));
    // The sheet: open from the title in the header (the bottom nav has no Switch tab), search, tap a result.
    await page
      .locator('.app-header')
      .getByRole('button', { name: /^Switch tournament:/ })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Switch tournament' });
    await expect(sheet.getByRole('link', { name: `${prefix} Bravo`, exact: true })).toBeVisible();
    await sheet.getByPlaceholder('Search or jump...').fill('bravo');
    await sheet.getByRole('link', { name: new RegExp(`${prefix} Bravo`) }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/t/${b}$`));
    await expect(sheet).toHaveCount(0);
    // The title opens the same sheet.
    await page
      .locator('.app-header')
      .getByRole('button', { name: /^Switch tournament:/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Switch tournament' })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
    await cleanup(request, [a, b]);
  });

  test('the Menu sheet holds the Pages switch, the less frequent destinations and the account', async ({
    page,
  }) => {
    await loginAdmin(page);
    await page
      .getByRole('navigation', { name: 'Administration' })
      .getByRole('button', { name: 'Menu' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Menu' });
    await expect(
      sheet.getByRole('navigation', { name: 'Pages' }).getByRole('link', { name: 'Admin' }),
    ).toHaveCount(0);
    await expect(sheet.getByRole('link', { name: 'Player profiles' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Users' })).toBeVisible();
    await expect(sheet.getByRole('link', { name: 'Info' })).toHaveAttribute('href', '/admin/info');
    await expect(sheet.getByRole('link', { name: 'Legacy admin' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Change password' })).toBeVisible();
    // Language and theme are inline in the sheet: no second drawer.
    await expect(sheet.getByRole('radiogroup', { name: 'Language' })).toBeVisible();
    await expect(sheet.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
  });
});

test('players of the open tournament are in the palette', async ({ page, request }) => {
  const name = `Plyr ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('Search or jump...').fill(PLAYERS[2]);
  await dialog.getByRole('button', { name: new RegExp(`^${PLAYERS[2]}`) }).click();
  await expect(page.getByTestId('match-row').first()).toBeVisible();
  await expect(page.locator('[data-testid="match-row"][data-selected]')).toHaveCount(1);
  await cleanup(request, [id]);
});
