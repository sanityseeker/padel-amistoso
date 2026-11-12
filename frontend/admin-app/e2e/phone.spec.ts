import { test, expect, type Page } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin, openTournament, fillNames } from './helpers';

// Phone-width checks (390px) for the two screens where the primary action is easy to lose:
// the create form (its submit bar) and the play-off bracket (round pager and score buttons).

test.use({ viewport: { width: 390, height: 844 } });

const noHorizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test('format info sits beside search on phones and stays in the page header on wider screens', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const lobbyResponse = await request.post('/api/registrations', {
    headers,
    data: { name: `Phone conversion ${Date.now()}`, auto_send_email: false },
  });
  expect(lobbyResponse.ok()).toBeTruthy();
  const lobby = (await lobbyResponse.json()) as { id: string };

  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAdmin(page);
  await page.goto('/admin/new');
  await expect(page.getByRole('button', { name: 'About this format' })).toHaveCount(1);
  await expect(
    page.locator('.app-header').getByRole('button', { name: 'About this format' }),
  ).toHaveCount(0);

  await page.setViewportSize({ width: 375, height: 844 });
  const appHeader = page.locator('.app-header');
  const info = appHeader.getByRole('button', { name: 'About this format' });
  const search = appHeader.getByRole('button', { name: 'Search or jump...' });
  await expect(info).toBeVisible();
  await expect(search).toBeVisible();
  await expect(page.getByRole('button', { name: 'About this format' })).toHaveCount(1);
  const infoBox = (await info.boundingBox())!;
  const searchBox = (await search.boundingBox())!;
  expect(infoBox.x).toBeLessThan(searchBox.x);
  expect(infoBox.height).toBeGreaterThanOrEqual(40);
  expect(
    Math.abs(infoBox.y + infoBox.height / 2 - (searchBox.y + searchBox.height / 2)),
  ).toBeLessThan(2);

  await page.goto(`/admin/new?from=${lobby.id}`);
  await expect(appHeader.getByRole('button', { name: 'About this format' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'About this format' })).toHaveCount(1);
});

// The element is fully inside the visible viewport, not merely in the DOM.
async function expectInViewport(page: Page, locator: ReturnType<Page['locator']>) {
  await expect(locator).toBeVisible();
  const box = (await locator.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(view.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
}

test('create form: the submit bar stays on screen, nothing overflows and the tournament is created', async ({
  page,
  request,
}) => {
  const name = `Phone Create ${Date.now()}`;
  await loginAdmin(page);
  await page.goto('/admin/new?type=group_playoff');
  await page.getByLabel('Tournament name').fill(name);
  await fillNames(page, 'players', 'Ana\nBeto\nCarla\nDiego\nElena\nFabio\nGala\nHugo');
  await expect.poll(() => noHorizontalOverflow(page)).toBe(true);

  // On a phone the Summary column becomes a bar fixed at the bottom: reachable without scrolling,
  // at the top of the form and after scrolling to its end.
  const create = page.getByRole('button', { name: 'Create tournament', exact: true });
  await expectInViewport(page, create);
  expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expectInViewport(page, create);
  expect(await noHorizontalOverflow(page)).toBe(true);

  await create.click();
  await expect(page).toHaveURL(/\/admin\/t\/[^/]+$/);
  const id = page.url().split('/').pop()!;
  const listed = (await (
    await request.get('/api/tournaments', { headers: await adminHeaders(request) })
  ).json()) as { id: string; name: string }[];
  expect(listed.find((t) => t.id === id)?.name).toBe(name);
});

test('bracket: the round pager and Score buttons work on a phone and a winner advances', async ({
  page,
  request,
}) => {
  const name = `Phone Bracket ${Date.now()}`;
  const { id } = await createTournament(request, 'po', name);
  await openTournament(page, id, name);
  // On a phone the bracket carries the match cards, under the Matches tab.
  await page.getByRole('tab', { name: 'Matches' }).click();
  await expect(page.getByTestId('bracket')).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);

  const matches = (await (await request.get(`/api/tournaments/${id}/po/playoffs`)).json())
    .matches as { id: string; team1: string[]; team2: string[]; round_label: string }[];
  const semi = matches.find((m) => m.round_label === 'Semi-Final')!;
  const pager = page.getByRole('radiogroup', { name: 'Round' });
  // The pager opens on "To play": every match that can be scored now.
  await expect(pager.getByRole('radio', { name: 'To play' })).toBeChecked();
  await expect(pager.getByRole('radio', { name: 'Semi-Final' })).toHaveCount(1);
  const finalTab = pager.locator('label').filter({ hasText: /^Final$/ });
  await expectInViewport(page, finalTab);
  expect(await noHorizontalOverflow(page)).toBe(true);

  // The first-round Score button is on screen and opens the bottom sheet.
  const score = page.getByRole('button', {
    name: `Score: ${semi.team1.join(' & ')} vs ${semi.team2.join(' & ')}`,
  });
  await score.scrollIntoViewIfNeeded();
  await expectInViewport(page, score);
  await score.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByTestId('score-1').fill('21');
  await page.getByTestId('score-2').fill('7');
  await page.keyboard.press('Enter');
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`/api/tournaments/${id}/po/playoffs`)).json()).matches as {
            id: string;
            score: number[] | null;
          }[]
        ).find((m) => m.id === semi.id)?.score,
    )
    .toEqual([21, 7]);

  // Final round: the semi-final winner is already in the final card.
  await finalTab.click();
  await expect(pager.getByRole('radio', { name: 'Final', exact: true })).toBeChecked();
  await expect(page.getByTestId('bracket-slot')).toHaveCount(1);
  await expect(page.getByTestId('bracket-slot')).toContainText(semi.team1.join(' & '));
  await expect(page.getByTestId('bracket-slot')).not.toContainText(semi.team2.join(' & '));
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test.afterAll(async ({ request }) => {
  const headers = await adminHeaders(request);
  const list = await (await request.get('/api/tournaments', { headers })).json();
  for (const t of list as { id: string; name: string }[])
    if (/^Phone (Create|Bracket) /.test(t.name))
      await request.delete(`/api/tournaments/${t.id}`, { headers });
});

// A drawer's scroll area is as wide as its content's min-content width, so its row of tabs must wrap.
test('the tournament and lobby settings drawers fit the phone width', async ({ page, request }) => {
  const { id } = await createTournament(request, 'mex', `Drawer ${Date.now()}`);
  const headers = await adminHeaders(request);
  const lobby = await (
    await request.post('/api/registrations', {
      headers,
      data: { name: `Drawer lobby ${Date.now()}`, auto_send_email: false },
    })
  ).json();
  const fits = (dialog: ReturnType<Page['getByRole']>) =>
    dialog.evaluate((el) =>
      Array.from(el.querySelectorAll<HTMLElement>('*')).every(
        (child) => child.getBoundingClientRect().right <= innerWidth + 1,
      ),
    );

  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const tournament = page.getByRole('dialog', { name: 'Tournament settings' });
  await tournament.getByRole('tab', { name: 'TV screen', exact: true }).click();
  await expect(tournament.getByLabel('Custom section title')).toBeVisible();
  expect(await fits(tournament)).toBe(true);
  // Every tab stays reachable.
  await tournament.getByRole('tab', { name: 'Payments', exact: true }).click();
  await expect(tournament.getByRole('tab', { name: 'Payments', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.keyboard.press('Escape');

  await page.goto(`/admin/lobby/${lobby.id}`);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const lobbyDrawer = page.getByRole('dialog');
  await expect(lobbyDrawer.getByRole('tab', { name: 'Details' })).toBeVisible();
  expect(await fits(lobbyDrawer)).toBe(true);
  await lobbyDrawer.getByRole('tab', { name: 'Email' }).click();
  await expect(lobbyDrawer.getByRole('tab', { name: 'Email' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(await noHorizontalOverflow(page)).toBe(true);
});
