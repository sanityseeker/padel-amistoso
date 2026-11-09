import { test, expect } from '@playwright/test';
import { adminHeaders, createTournament, openTournament } from './helpers';

// Behaviour added by the UX review: a round chip shows its matches, Continue stays in view on a
// phone, the desktop row scores in place, and tabs only exist while they have a purpose.

async function playRound(request: Parameters<typeof adminHeaders>[0], id: string) {
  const headers = await adminHeaders(request);
  const status = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of status.current_matches as { id: string }[])
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
}

test.describe('desktop', () => {
  test('a round chip lists that round without a second tap, and a pending row scores in place', async ({
    page,
    request,
  }) => {
    const name = `UX round ${Date.now()}`;
    const { id, headers } = await createTournament(request, 'mex', name);
    await playRound(request, id);
    await request.post(`/api/tournaments/${id}/mex/next-round`, { headers, data: {} });
    await openTournament(page, id, name);
    await page.getByRole('radiogroup', { name: 'Round' }).getByText('R1', { exact: true }).click();
    await expect(page.getByTestId('match-row').first()).toBeVisible();
    await expect(page.getByText('Every point is in.')).toHaveCount(0);

    // Pending rows show their score boxes directly.
    await page.getByRole('radiogroup', { name: 'Round' }).getByText('All', { exact: true }).click();
    await page.getByText('To play', { exact: true }).click();
    const box1 = page.getByTestId('quick-score-1').first();
    await box1.fill('15');
    // Enter in the first box only moves on; it cannot save half a row.
    await box1.press('Enter');
    await expect(page.getByTestId('quick-score-2').first()).toBeFocused();
    await expect(page.getByTestId('quick-score-2').first()).toHaveValue('9');
    await page.getByTestId('quick-score-2').first().press('Enter');
    await expect(page.getByText('Saved 15-9')).toBeVisible();
  });

  test('Review and Standings tabs are absent while they have nothing to show', async ({
    page,
    request,
  }) => {
    const name = `UX tabs ${Date.now()}`;
    const { id } = await createTournament(request, 'po', name);
    await openTournament(page, id, name);
    await expect(page.getByRole('tab', { name: 'Review' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Standings' })).toHaveCount(0);
    await expect(page.getByTestId('standings-pane')).toHaveCount(0);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('Continue is in the viewport in the next-round dialog', async ({ page, request }) => {
    const name = `UX continue ${Date.now()}`;
    const { id } = await createTournament(request, 'mex', name);
    await playRound(request, id);
    await openTournament(page, id, name);
    await page.getByRole('button', { name: 'Next round' }).click();
    const cont = page.getByRole('button', { name: 'Continue', exact: true });
    await expect(cont).toBeVisible();
    const box = (await cont.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(844);
  });

  test('the top bar has no second menu next to the Menu sheet', async ({ page, request }) => {
    const name = `UX menu ${Date.now()}`;
    const { id } = await createTournament(request, 'po', name);
    await openTournament(page, id, name);
    await expect(page.locator('.app-header').getByRole('button', { name: 'More' })).toHaveCount(0);
  });
});
