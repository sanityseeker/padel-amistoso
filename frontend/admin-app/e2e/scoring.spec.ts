import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminHeaders, createTournament, openTournament, patchTvSettings } from './helpers';

interface ApiMatch {
  id: string;
  score: [number, number] | null;
  sets: [number, number][] | null;
  status: string;
  format_override: { mode: string | null; decider: string | null } | null;
  court: string | null;
}

async function matchesOf(request: APIRequestContext, id: string, path: string) {
  const res = await request.get(`/api/tournaments/${id}/${path}`);
  const body = await res.json();
  const raw = body.all_matches ?? body.matches;
  return (Array.isArray(raw) ? raw : Object.values(raw).flat()) as ApiMatch[];
}

// Desktop scoring happens inline in the match row; phones use a bottom sheet. Both carry this hook.
const sheet = (page: import('@playwright/test').Page) => page.getByTestId('score-sheet');
const scoreButtons = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: /^(Record score|More scoring options):/ });

test('group match: keyboard entry, Enter saves, Undo clears, a recorded score can be corrected', async ({
  page,
  request,
}) => {
  const name = `Score GP ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  await openTournament(page, id, name);
  await scoreButtons(page).first().click();
  await expect(sheet(page)).toBeVisible();
  // Numeric keypad on phones; focus starts in the first box; Tab then Enter.
  await expect(page.getByTestId('score-1')).toHaveAttribute('inputmode', 'numeric');
  await expect(page.getByTestId('score-1')).toBeFocused();
  await page.keyboard.type('6');
  await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await expect(sheet(page)).toBeHidden();
  const toast = page.getByText('Saved 6-3');
  await expect(toast).toBeVisible();
  await expect
    .poll(
      async () =>
        (await matchesOf(request, id, 'gp/groups')).filter((m) => m.score?.[0] === 6).length,
    )
    .toBe(1);

  // Undo is a toast action, not a confirm dialog: the match goes back to unplayed.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(async () => (await matchesOf(request, id, 'gp/groups')).filter((m) => m.score).length)
    .toBe(0);

  // Record again, then correct it from the Completed filter.
  await scoreButtons(page).first().click();
  await page.keyboard.type('4');
  await page.keyboard.press('Tab');
  await page.keyboard.type('6');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Saved 4-6')).toBeVisible();
  await page.getByText('Completed', { exact: true }).click();
  await page
    .getByRole('button', { name: /^Edit score:/ })
    .first()
    .click();
  await expect(page.getByTestId('score-1')).toHaveValue('4');
  await page.getByTestId('score-1').fill('7');
  await page.getByTestId('score-2').fill('5');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await matchesOf(request, id, 'gp/groups')).find((m) => m.score)?.score)
    .toEqual([7, 5]);
  // Undoing the correction restores the previous score.
  await expect(page.getByText('Saved 7-5')).toBeVisible();
  await page
    .getByText('Saved 7-5')
    .locator('xpath=ancestor::*[.//button[normalize-space()="Undo"]][1]')
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect
    .poll(async () => (await matchesOf(request, id, 'gp/groups')).find((m) => m.score)?.score)
    .toEqual([4, 6]);
});

test('Escape cancels the score sheet without saving', async ({ page, request }) => {
  const name = `Score Esc ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  await openTournament(page, id, name);
  await scoreButtons(page).first().click();
  await page.getByTestId('score-1').fill('6');
  await page.keyboard.press('Escape');
  await expect(sheet(page)).toBeHidden();
  expect((await matchesOf(request, id, 'gp/groups')).filter((m) => m.score)).toHaveLength(0);
});

test('sets scoring with a match tie-break enforces the same rules as the backend', async ({
  page,
  request,
}) => {
  const name = `Score Sets ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  await patchTvSettings(request, id, {
    score_mode: { 'gp-group': 'sets' },
    set_decider: 'match_tiebreak',
  });
  await openTournament(page, id, name);
  await scoreButtons(page).first().click();
  await expect(page.getByTestId('set-1-1')).toBeVisible();
  // A level set is refused client-side.
  await page.getByTestId('set-1-1').fill('6');
  await page.getByTestId('set-1-2').fill('6');
  await page.getByRole('button', { name: 'Save score' }).click();
  await expect(page.getByRole('alert')).toContainText('Set 1 cannot end level.');
  // A third set after two straight sets is refused.
  await page.getByTestId('set-1-2').fill('4');
  await page.getByTestId('set-2-1').fill('6');
  await page.getByTestId('set-2-2').fill('3');
  await page.getByTestId('set-3-1').fill('10');
  await page.getByTestId('set-3-2').fill('8');
  await page.getByRole('button', { name: 'Save score' }).click();
  await expect(page.getByRole('alert')).toContainText('only played when the first two are split');
  // Split sets, tie-break to 10 with a 2-point lead is accepted.
  await page.getByTestId('set-2-1').fill('3');
  await page.getByTestId('set-2-2').fill('6');
  await page.getByTestId('set-3-2').fill('9');
  await page.getByRole('button', { name: 'Save score' }).click();
  await expect(page.getByRole('alert')).toContainText('2-point lead');
  await page.getByTestId('set-3-2').fill('8');
  await page.keyboard.press('Enter');
  await expect(sheet(page)).toBeHidden();
  await expect
    .poll(async () => (await matchesOf(request, id, 'gp/groups')).find((m) => m.sets)?.sets)
    .toEqual([
      [6, 4],
      [3, 6],
      [10, 8],
    ]);
  // The list shows the tie-break set separately from the games.
  await page.getByText('Completed', { exact: true }).click();
  await expect(page.getByTestId('match-row').first().locator('.is-tb')).toHaveCount(2);
});

test('typing one digit in a set cell moves on; the match tie-break cell takes two', async ({
  page,
  request,
}) => {
  const name = `Score Advance ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  await patchTvSettings(request, id, {
    score_mode: { 'gp-group': 'sets' },
    set_decider: 'match_tiebreak',
  });
  await openTournament(page, id, name);
  await scoreButtons(page).first().click();
  await expect(page.getByTestId('set-1-1')).toBeFocused();
  await page.keyboard.type('6');
  await expect(page.getByTestId('set-1-2')).toBeFocused();
  await page.keyboard.type('4');
  await expect(page.getByTestId('set-2-1')).toBeFocused();
  await page.keyboard.type('3');
  await expect(page.getByTestId('set-2-2')).toBeFocused();
  await page.keyboard.type('6');
  await expect(page.getByTestId('set-3-1')).toBeFocused();
  // Tie-break cell: two digits stay in the cell.
  await page.keyboard.type('10');
  await expect(page.getByTestId('set-3-1')).toHaveValue('10');
  await expect(page.getByTestId('set-3-1')).toBeFocused();
});

test('sets are typed directly and Enter saves them', async ({ page, request }) => {
  const name = `Score Sets ${Date.now()}`;
  const { id } = await createTournament(request, 'po', name);
  await patchTvSettings(request, id, { score_mode: { 'po-playoff': 'sets' } });
  await openTournament(page, id, name);
  await scoreButtons(page).first().click();
  await expect(page.getByRole('button', { name: '6-3 6-3', exact: true })).toHaveCount(0);
  await page.getByTestId('set-1-1').fill('3');
  await page.getByTestId('set-1-2').fill('6');
  await page.getByTestId('set-2-1').fill('3');
  await page.getByTestId('set-2-2').fill('6');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await matchesOf(request, id, 'po/playoffs')).find((m) => m.sets)?.sets)
    .toEqual([
      [3, 6],
      [3, 6],
    ]);
});

test('Mexicano round: scores add up to the target and the other side fills in', async ({
  page,
  request,
}) => {
  const name = `Score Mex ${Date.now()}`;
  const { id } = await createTournament(request, 'mex', name);
  await openTournament(page, id, name);
  await scoreButtons(page).first().click();
  await expect(page.getByText('Scores must add up to 24.')).toBeVisible();
  // No Points/Sets switch: Mexicano rounds are points only.
  await expect(page.getByRole('radio', { name: 'Sets' })).toHaveCount(0);
  await page.getByTestId('score-1').fill('15');
  await expect(page.getByTestId('score-2')).toHaveValue('9');
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await matchesOf(request, id, 'mex/matches')).find((m) => m.score)?.score)
    .toEqual([15, 9]);
});

test('per-match format override can switch one match to sets', async ({ page, request }) => {
  const name = `Score Format ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  await openTournament(page, id, name);
  await scoreButtons(page).first().click();
  await expect(page.getByTestId('score-1')).toBeVisible();
  await page.getByText('Match format', { exact: true }).click();
  await page
    .getByText('Tennis sets', { exact: false })
    .first()
    .isVisible()
    .catch(() => undefined);
  await sheet(page).getByText('Sets', { exact: true }).last().click();
  await page.getByRole('button', { name: 'Apply format' }).click();
  await expect(page.getByTestId('set-1-1')).toBeVisible();
  await expect
    .poll(
      async () =>
        (await matchesOf(request, id, 'gp/groups')).find((m) => m.format_override)?.format_override
          ?.mode,
    )
    .toBe('sets');
  await page.getByRole('button', { name: 'Use tournament default' }).click();
  await expect
    .poll(
      async () =>
        (await matchesOf(request, id, 'gp/groups')).filter((m) => m.format_override).length,
    )
    .toBe(0);
});

test('a refused save rolls the list back and explains why', async ({ page, request }) => {
  const name = `Score Rollback ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  await openTournament(page, id, name);
  await page.route('**/api/tournaments/*/gp/record-group', (route) =>
    route.fulfill({ status: 400, json: { detail: 'Scores are locked.' } }),
  );
  const before = await scoreButtons(page).count();
  await scoreButtons(page).first().click();
  await page.getByTestId('score-1').fill('6');
  await page.getByTestId('score-2').fill('2');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Scores are locked.')).toBeVisible();
  await expect(scoreButtons(page)).toHaveCount(before);
  expect((await matchesOf(request, id, 'gp/groups')).filter((m) => m.score)).toHaveLength(0);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('the score sheet is a bottom drawer with 44px tap targets', async ({ page, request }) => {
    const name = `Score Phone ${Date.now()}`;
    const { id } = await createTournament(request, 'gp', name);
    await openTournament(page, id, name);
    await scoreButtons(page).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.y + box!.height).toBeGreaterThan(844 - 4);
    expect(box!.width).toBeGreaterThanOrEqual(388);
    for (const control of [
      page.getByTestId('score-1'),
      page.getByTestId('score-2'),
      page.getByRole('button', { name: 'Save score' }),
      page.getByRole('button', { name: 'Cancel' }),
    ]) {
      expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(43.5);
    }
    // Mobile rows keep the list dense: a match row stays under 170px even with the actions on their own line.
    await page.keyboard.press('Escape');
    expect((await page.getByTestId('match-row').first().boundingBox())!.height).toBeLessThan(170);
  });
});

test.afterAll(async ({ request }) => {
  // Keep the shared data directory tidy for the specs that follow.
  const headers = await adminHeaders(request);
  const list = await (await request.get('/api/tournaments', { headers })).json();
  for (const t of list as { id: string; name: string }[])
    if (/^Score /.test(t.name)) await request.delete(`/api/tournaments/${t.id}`, { headers });
});
