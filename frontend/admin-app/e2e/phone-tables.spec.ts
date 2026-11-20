import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin } from './helpers';

// Tables on phone widths: no sideways page scroll, no scroller that hides the last column, numbers
// in tabular figures, and the Rating summary link reachable on the Clubs page.

const WIDTHS = [360, 390, 430];

async function scoreRound(request: APIRequestContext, id: string) {
  const headers = await adminHeaders(request);
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const match of matches.current_matches)
    expect(
      (
        await request.post(`/api/tournaments/${id}/mex/record`, {
          headers,
          data: { match_id: match.id, score1: 16, score2: 8 },
        })
      ).ok(),
    ).toBeTruthy();
}

async function seedCommunity(request: APIRequestContext) {
  const headers = await adminHeaders(request);
  const stamp = Date.now();
  const community = await (
    await request.post('/api/communities', { headers, data: { name: `Phone Community ${stamp}` } })
  ).json();
  const club = await (
    await request.post('/api/clubs', {
      headers,
      data: { name: `Phone Club ${stamp}`, community_id: community.id },
    })
  ).json();
  const { id } = await createTournament(request, 'mex', `Phone ${stamp}`, {
    community_id: community.id,
    club_id: club.id,
  });
  await scoreRound(request, id);
  return { community, club, stamp };
}

async function expectNoSideways(page: Page) {
  const { overflow, scale } = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    scale: window.visualViewport?.scale ?? 1,
  }));
  expect(overflow).toBeLessThanOrEqual(0);
  expect(scale).toBe(1);
}

/** Every table either fits its box or its last header is inside the viewport. */
async function expectTablesFit(page: Page) {
  const bad = await page.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll('table')].flatMap((table) => {
      const heads = [...table.querySelectorAll('thead th')];
      const last = heads.at(-1)?.getBoundingClientRect();
      return last && last.right > vw + 1 ? [table.getAttribute('data-testid') ?? 'table'] : [];
    });
  });
  expect(bad).toEqual([]);
}

for (const width of WIDTHS) {
  test.describe(`phone ${width}`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });

    test('community summary tables fit and use tabular figures', async ({ page, request }) => {
      const { community, stamp } = await seedCommunity(request);
      await loginAdmin(page);
      await page.goto(`/admin/communities/${community.id}`);
      const entry = page.getByTestId('summary-club').filter({ hasText: `Phone Club ${stamp}` });
      await entry.getByRole('button', { name: /Show players/ }).click();
      const table = entry.getByTestId('summary-club-table');
      await expect(table).toBeVisible();
      // Net change always shows, whatever the width.
      await expect(table.getByRole('columnheader', { name: 'Net change' })).toBeVisible();
      await expectNoSideways(page);
      await expectTablesFit(page);
      const num = table.locator('td[data-num]').first();
      await expect(num).toBeVisible();
      expect(await num.evaluate((el) => getComputedStyle(el).fontVariantNumeric)).toContain(
        'tabular-nums',
      );
      // The phone header names the page and has a back button.
      await expect(page.getByRole('heading', { name: 'Rating summary' }).first()).toBeVisible();
    });

    test('clubs page: Rating summary is reachable without sideways scrolling', async ({
      page,
      request,
    }) => {
      const { community } = await seedCommunity(request);
      await loginAdmin(page);
      await page.goto('/admin/clubs');
      const link = page.locator(`a[href="/admin/communities/${community.id}"]`);
      await expect(link).toBeVisible();
      // Below the club list, so scroll down: the point is that it is not pushed off to the right.
      await link.scrollIntoViewIfNeeded();
      await expect(link).toBeInViewport({ ratio: 1 });
      await expectNoSideways(page);
    });

    test('Player Hub explorer page does not scroll sideways', async ({ page }) => {
      await page.goto('/player');
      await expectNoSideways(page);
    });
  });
}
