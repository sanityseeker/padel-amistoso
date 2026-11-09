import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin } from './helpers';

async function scoreCurrentRound(request: APIRequestContext, id: string) {
  const headers = await adminHeaders(request);
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const match of matches.current_matches)
    expect(
      (
        await request.post(`/api/tournaments/${id}/mex/record`, {
          headers,
          data: { match_id: match.id, score1: 14, score2: 10 },
        })
      ).ok(),
    ).toBeTruthy();
  return headers;
}

test('header shows the next step disabled with a reason until the round is played', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Header ${Date.now()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  const next = page.getByRole('button', { name: 'Next round' });
  await expect(next).toBeVisible();
  await expect(next).toBeDisabled();
  await expect(page.getByTestId('workspace-header')).toBeVisible();
  // Mexicano rounds double as navigation.
  await expect(page.getByRole('radio', { name: 'R1' })).toBeChecked({ checked: false });
  await scoreCurrentRound(request, id);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Next round' })).toBeEnabled();
});

test('Mexicano round tools: suggested pairings, manual round and end/undo', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Round tools ${Date.now()}`);
  await scoreCurrentRound(request, id);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('button', { name: 'Next round' }).click();
  const dialog = page.getByRole('dialog', { name: 'Generate the next round?' });
  await expect(dialog.getByTestId('proposal').first()).toBeVisible();
  await expect(dialog.getByText('Recommended', { exact: true })).toBeVisible();
  // Manual round: pick all four players for the single match.
  await dialog.getByRole('tab', { name: 'Manual round' }).click();
  // The editor starts from the proposal that was chosen; clear it to pick the players by hand.
  await expect(dialog.getByTestId('round-summary')).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear all' }).click();
  const slots = ['Team 1, player 1', 'Team 1, player 2', 'Team 2, player 1', 'Team 2, player 2'];
  const names = ['Ana', 'Beto', 'Carla', 'Diego'];
  for (const [i, slot] of slots.entries()) {
    await dialog.getByLabel(`Match 1: ${slot}`).click();
    await page.getByRole('option', { name: names[i]!, exact: true }).click();
  }
  await dialog.getByRole('button', { name: 'Start this round' }).click();
  await expect(page.getByText('Round 2 of 3', { exact: true })).toBeVisible();
  const status = await (await request.get(`/api/tournaments/${id}/mex/status`)).json();
  expect(status.current_round).toBe(2);

  // End the rounds from the workspace menu, then undo it.
  await scoreCurrentRound(request, id);
  await page.reload();
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  // One tap: no confirm dialog, and the toast offers Undo.
  await page.getByRole('menuitem', { name: 'End rounds' }).click();
  await expect(page.getByRole('button', { name: 'Start play-offs' })).toBeVisible();
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Undo end of rounds' }).click();
  await expect(page.getByRole('button', { name: 'Next round' })).toBeVisible();
  expect(
    (await (await request.get(`/api/tournaments/${id}/mex/status`)).json()).mexicano_ended,
  ).toBe(false);
});

test('recommended play-offs for a Mexicano tournament', async ({ page, request }) => {
  const { id } = await createTournament(request, 'mex', `Playoffs ${Date.now()}`);
  const headers = await scoreCurrentRound(request, id);
  expect((await request.post(`/api/tournaments/${id}/mex/end`, { headers })).ok()).toBeTruthy();
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('button', { name: 'Start play-offs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start the play-offs?' });
  await expect(dialog.getByTestId('playoff-candidates')).toBeVisible();
  await expect(dialog.getByRole('checkbox').first()).toBeChecked();
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Bracket' })).toBeVisible();
  expect((await (await request.get(`/api/tournaments/${id}/mex/status`)).json()).phase).toBe(
    'playoffs',
  );
});

test('bracket renders for a direct play-off and shows the diagram', async ({ page, request }) => {
  const { id } = await createTournament(request, 'po', `Bracket ${Date.now()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('tab', { name: 'Bracket' }).click();
  const bracket = page.getByTestId('bracket');
  await expect(bracket).toBeVisible();
  // Two semi-finals and a final.
  await expect(bracket.getByTestId('bracket-slot')).toHaveCount(3);
  await expect(bracket.getByText('Final', { exact: true }).first()).toBeVisible();
  const diagram = page.waitForResponse(
    (r) => r.url().includes('/po/playoffs-schema') && r.status() === 200,
    { timeout: 30_000 },
  );
  await bracket.getByText('Diagram', { exact: true }).click();
  await diagram;
  await expect(bracket.getByRole('img', { name: 'Play-off bracket' })).toBeVisible();
});

test('match comment and score history beside the score button', async ({ page, request }) => {
  const { id } = await createTournament(request, 'gp', `Comment ${Date.now()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  const first = page.getByTestId('match-row').first();
  await first.getByRole('button', { name: 'Add comment' }).click();
  const dialog = page.getByRole('dialog', { name: 'Match comment' });
  await dialog.getByLabel('Comment').fill('Court 2 has a wet corner');
  await dialog.getByRole('button', { name: 'Save comment' }).click();
  await expect(page.getByTestId('match-comment').first()).toHaveText(/Court 2 has a wet corner/);
  const matches = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  const all = Object.values(matches.matches as Record<string, { comment: string }[]>).flat();
  expect(all.some((m) => m.comment === 'Court 2 has a wet corner')).toBeTruthy();
  await page
    .getByTestId('match-row')
    .first()
    .getByRole('button', { name: 'Score history' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Score history' })).toBeVisible();
  await expect(page.getByTestId('history-empty')).toBeVisible();
});

test('a wide screen shows matches and standings together under one Overview tab', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'gp', `Panes ${Date.now()}`);
  await page.setViewportSize({ width: 1366, height: 800 });
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByTestId('standings-pane')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('tab', { name: 'Standings' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Matches' })).toHaveCount(0);
});

test('group standings keep their position on selection and live refresh', async ({
  page,
  request,
}) => {
  const name = `Stable standings ${Date.now()}`;
  const { id, headers } = await createTournament(request, 'gp', name);
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  const groupNames = Object.keys(
    groups.matches as Record<string, { id: string; status: string }[]>,
  );
  const selectedGroup = groupNames[1]!;
  const match = (groups.matches as Record<string, { id: string; status: string }[]>)[
    selectedGroup
  ]!.find((candidate) => candidate.status !== 'completed')!;

  await page.setViewportSize({ width: 1366, height: 650 });
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}?view=standings`);
  const pane = page.getByTestId('standings-pane');
  const position = () =>
    page.evaluate(() => {
      const element = document.querySelector<HTMLElement>('[data-testid="standings-pane"]');
      if (!element) throw new Error('Standings pane is missing');
      const header = document.querySelector<HTMLElement>('.app-header');
      if (!header) throw new Error('App header is missing');
      return {
        top: element.getBoundingClientRect().top,
        scrollY: window.scrollY,
        headerHeight: header.getBoundingClientRect().height,
      };
    });

  await expect(pane).toBeVisible();
  await expect(pane.locator('table')).toHaveAttribute('data-density', 'compact');
  await expect(
    page.getByRole('navigation', { name: 'Open tournaments' }).getByRole('link', { name }),
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(pane).toBeFocused();
  await page.evaluate(() => window.scrollTo(0, 0));
  const beforeSelection = await position();
  const groupSelector = pane.getByRole('radio', { name: `Group ${selectedGroup}` });
  await pane.getByText(`Group ${selectedGroup}`, { exact: true }).click();
  await expect(groupSelector).toBeChecked();
  await expect(groupSelector).toBeFocused();
  const afterSelection = await position();
  expect(Math.abs(afterSelection.top - beforeSelection.top)).toBeLessThan(2);
  expect(afterSelection.scrollY).toBe(beforeSelection.scrollY);
  expect(afterSelection.headerHeight).toBe(beforeSelection.headerHeight);

  await page.evaluate(() => window.scrollTo(0, 0));
  const beforeRefresh = await position();
  const refreshedGroups = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/tournaments/${id}/gp/groups`) &&
      response.request().method() === 'GET',
  );
  expect(
    (
      await request.post(`/api/tournaments/${id}/gp/record-group`, {
        headers,
        data: { match_id: match.id, score1: 21, score2: 10 },
      })
    ).ok(),
  ).toBeTruthy();
  await refreshedGroups;
  await expect(pane.locator('tbody')).toContainText('21');
  await expect(groupSelector).toBeFocused();
  const afterRefresh = await position();
  expect(Math.abs(afterRefresh.top - beforeRefresh.top)).toBeLessThan(2);
  expect(afterRefresh.scrollY).toBe(beforeRefresh.scrollY);
  expect(afterRefresh.headerHeight).toBe(beforeRefresh.headerHeight);
});

test('withdrawing a player in a rotating-partner group stage leaves them out of the next rounds, and can be undone', async ({
  page,
  request,
}) => {
  // The default Group + Play-off is individual (rotating partners): the rule is "exclude", never the
  // 50% rule, and Ana has an unplayed round-1 match, so the other three players of it sit out.
  const { id } = await createTournament(request, 'gp', `Withdraw ${Date.now()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.getByRole('button', { name: 'Withdraw: Ana' }).click();
  const dialog = page.getByRole('dialog', { name: /^Withdraw Ana/ });
  await expect(
    dialog.getByText('The entry is left out of the next rounds. Results stay.'),
  ).toBeVisible();
  await expect(dialog.getByText(/^Sitting out: /)).toBeVisible();
  await expect(dialog.getByText('You can undo this until the situation changes.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annul results and withdraw' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Withdraw with walkovers' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Withdraw from next rounds', exact: true }).click();
  await expect(page.getByText('Withdrawn', { exact: true }).first()).toBeVisible();
  const status = await (await request.get(`/api/tournaments/${id}/gp/status`)).json();
  expect(status.withdrawals).toHaveLength(1);
  expect(status.withdrawals[0]).toMatchObject({ name: 'Ana', kind: 'exclude', undo_allowed: true });
  await page.getByRole('button', { name: 'Undo withdrawal' }).first().click();
  await page
    .getByRole('dialog', { name: 'Undo withdrawal' })
    .getByRole('button', { name: 'Undo withdrawal' })
    .click();
  await expect(page.getByRole('button', { name: 'Withdraw: Ana' })).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tournaments/${id}/gp/status`)).json()).withdrawals.length,
    )
    .toBe(0);
});

test('export downloads an HTML report', async ({ page, request }) => {
  const { id } = await createTournament(request, 'gp', `Export ${Date.now()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await page.getByRole('menuitem', { name: 'Export results' }).click();
  const download = page.waitForEvent('download');
  await page
    .getByRole('dialog', { name: 'Export results' })
    .getByRole('button', { name: 'Export HTML' })
    .click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/\.html$/);
});

test('standings drop columns in a narrow pane and show them all when there is room', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Columns ${Date.now()}`);
  await loginAdmin(page);
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto(`/admin/t/${id}`);
  const pane = page.getByTestId('standings-pane');
  await expect(pane.getByRole('columnheader', { name: 'Total points' })).toBeVisible();
  await expect(pane.getByRole('columnheader', { name: 'Buchholz tie-break' })).toHaveCount(0);
  // Names stay on one line.
  const name = pane.locator('tbody tr').first().locator('td').nth(1);
  const box = await name.boundingBox();
  expect(box!.height).toBeLessThan(80);
  // A wide, full-width table shows every column.
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto(`/admin/t/${id}?view=standings`);
  await expect(page.getByRole('columnheader', { name: 'Total points' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Buchholz tie-break' })).toBeVisible();
});
