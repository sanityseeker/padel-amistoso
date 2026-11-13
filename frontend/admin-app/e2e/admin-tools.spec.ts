import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin } from './helpers';

async function scoreRound(request: APIRequestContext, id: string, scores: [number, number][]) {
  const headers = await adminHeaders(request);
  const matches = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const [i, match] of matches.current_matches.entries())
    expect(
      (
        await request.post(`/api/tournaments/${id}/mex/record`, {
          headers,
          data: { match_id: match.id, score1: scores[i]![0], score2: scores[i]![1] },
        })
      ).ok(),
    ).toBeTruthy();
}

async function openSettings(page: Page, tab?: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Tournament settings' });
  await expect(drawer).toBeVisible();
  if (tab) await drawer.getByRole('tab', { name: tab, exact: true }).click();
  return drawer;
}

test('Mexicano standings show Avg, mark the deciding column and sort on click', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Avg ${Date.now()}`);
  await scoreRound(request, id, [[16, 8]]);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  const avg = page.getByRole('columnheader', { name: 'Average points per match' });
  await expect(avg).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Total points' })).toHaveAttribute(
    'data-deciding',
    '',
  );
  const first = () =>
    page.getByTestId('standings-pane').or(page.locator('table')).locator('tbody tr').first();
  const backendFirst = await first().innerText();
  await avg.getByRole('button').click();
  await expect(avg).toHaveAttribute('aria-sort', 'descending');
  await avg.getByRole('button').click();
  await expect(avg).toHaveAttribute('aria-sort', 'ascending');
  await avg.getByRole('button').click();
  await expect(avg).not.toHaveAttribute('aria-sort', /./);
  expect(await first().innerText()).toBe(backendFirst);
});

test('settings drawer: alias, courts, scoring and co-editors', async ({ page, request }) => {
  const { id, headers } = await createTournament(request, 'mex', `Settings ${Date.now()}`);
  const username = `coeditor-${Date.now().toString(36)}`;
  expect(
    (
      await request.post('/api/auth/users', {
        headers,
        data: { username, password: 'organizer-test-2026', role: 'user' },
      })
    ).ok(),
  ).toBeTruthy();
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  let drawer = await openSettings(page);
  const alias = `alias-${Date.now().toString(36)}`;
  await drawer.getByLabel('Public address').first().fill(alias);
  await drawer.getByRole('button', { name: 'Save address' }).click();
  await expect
    .poll(async () => {
      const list = (await (await request.get('/api/tournaments', { headers })).json()) as {
        id: string;
        alias?: string;
      }[];
      return list.find((t) => t.id === id)?.alias;
    })
    .toBe(alias);
  await drawer.getByRole('tab', { name: 'TV screen' }).click();
  await drawer.getByLabel('Custom section title').fill('Tournament format');
  await drawer.getByLabel('Custom section description').fill('**Short sets**');
  await drawer.getByRole('button', { name: 'Save custom section' }).click();
  await expect
    .poll(async () => {
      const settings = await (await request.get(`/api/tournaments/${id}/tv-settings`)).json();
      return [settings.custom_info_title, settings.custom_info_text];
    })
    .toEqual(['Tournament format', '**Short sets**']);
  await drawer.getByRole('tab', { name: 'Scoring' }).click();
  await drawer.getByText('Opponent confirms', { exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tournaments/${id}/tv-settings`)).json()).score_confirmation,
    )
    .toBe('required');
  await drawer.getByRole('tab', { name: 'Courts and pairing' }).click();
  await drawer
    .locator('label')
    .filter({ hasText: /^Text$/ })
    .click();
  await drawer.getByRole('textbox', { name: 'Courts' }).fill('Centre\nSide');
  await drawer.getByRole('button', { name: 'Save courts' }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tournaments/${id}/mex/status`)).json()).courts.length,
    )
    .toBe(2);
  await drawer.getByRole('button', { name: 'Save Mexicano settings' }).click();
  await expect(page.getByText('Mexicano settings saved')).toBeVisible();
  await drawer.getByRole('tab', { name: 'General' }).click();
  await drawer.getByLabel('Add a co-editor').fill(username);
  await drawer.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drawer.getByText(username, { exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Recalculate ELO' }).click();
  // One event is safe to recalculate again, so there is no confirm.
  await expect(page.getByText('Ratings recalculated')).toBeVisible();
  await drawer.getByRole('tab', { name: 'Payments' }).click();
  await expect(drawer.getByTestId('stat-collected')).toBeVisible();
  await drawer.getByRole('tab', { name: 'Email' }).click();
  await expect(drawer.getByRole('button', { name: 'Save sender' })).toBeVisible();
  drawer = page.getByRole('dialog', { name: 'Tournament settings' });
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('settings drawer fits the phone viewport without horizontal scrolling', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Phone settings ${Date.now()}`);
  await loginAdmin(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/admin/t/${id}`);
  const drawer = await openSettings(page);
  const dimensions = await drawer.evaluate((element) => {
    const tabs = element.querySelector<HTMLElement>('[role="tablist"]');
    return {
      dialog: element.getBoundingClientRect().width,
      tabsClient: tabs?.clientWidth ?? 0,
      tabsScroll: tabs?.scrollWidth ?? 0,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    };
  });
  expect(dimensions.dialog).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.tabsScroll).toBeLessThanOrEqual(dimensions.tabsClient);
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
});

test('player codes: add a player mid-event, edit contact details, remove', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'mex', `Roster ${Date.now()}`);
  // The round is open, so the new player has no pending match and can leave again.
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  const add = page.getByRole('dialog', { name: 'Add a player' });
  await add.getByLabel('Player name').fill('Late Arrival');
  await add.getByRole('button', { name: 'Add player', exact: true }).click();
  await expect(add.getByText(/joined/)).toBeVisible();
  await add.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByTestId('code-row').filter({ hasText: 'Late Arrival' })).toBeVisible();
  await page.getByRole('button', { name: 'Player options: Late Arrival' }).click();
  await page.getByRole('menuitem', { name: 'Contact and email' }).click();
  const sheet = page.getByRole('dialog', { name: 'Late Arrival' });
  await sheet.getByLabel('Contact details').fill('+34 600 000 000');
  await sheet.getByLabel('Email', { exact: true }).fill('late@example.com');
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(async () => {
      const codes = await (
        await request.get(`/api/tournaments/${id}/player-secrets`, { headers })
      ).json();
      const late = Object.values(
        codes.players as Record<string, { name: string; contact: string; email: string }>,
      ).find((p) => p.name === 'Late Arrival');
      return `${late?.contact}|${late?.email}`;
    })
    .toBe('+34 600 000 000|late@example.com');
  await page.getByRole('button', { name: 'Player options: Late Arrival' }).click();
  await page.getByRole('menuitem', { name: 'Remove from event' }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByTestId('code-row').filter({ hasText: 'Late Arrival' })).toHaveCount(0);
});

test('play-offs dialog: external participant and Gold / Silver split', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'gp', `Split ${Date.now()}`);
  for (let round = 0; round < 8; round++) {
    const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
    for (const list of Object.values(
      groups.matches as Record<string, { id: string; status: string }[]>,
    ))
      for (const m of list.filter((x) => x.status !== 'completed'))
        expect(
          (
            await request.post(`/api/tournaments/${id}/gp/record-group`, {
              headers,
              data: { match_id: m.id, score1: 21, score2: 10 },
            })
          ).ok(),
        ).toBeTruthy();
    if (!groups.has_more_rounds) break;
    expect(
      (
        await request.post(`/api/tournaments/${id}/gp/next-group-round`, { headers, data: {} })
      ).ok(),
    ).toBeTruthy();
  }
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByRole('button', { name: 'Start play-offs' }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.getByText('Gold / Silver split', { exact: true }).click();
  await expect(dialog.getByTestId('playoff-split')).toBeVisible();
  await dialog.getByLabel('External participant name').fill('Guest Star');
  await dialog.getByRole('button', { name: 'Add participant' }).click();
  await expect(dialog.getByText(/Guest Star/)).toBeVisible();
  // Each bracket needs an even number of entries (padel teams).
  await dialog.getByLabel('External participant name').fill('Guest Two');
  await dialog.getByRole('button', { name: 'Add participant' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect
    .poll(async () => (await (await request.get(`/api/tournaments/${id}/gp/status`)).json()).phase)
    .toBe('playoffs');
});

test('lobby: edit a registrant, settings, claims, convert to a tournament', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const lobby = await (
    await request.post('/api/registrations', {
      headers,
      data: {
        name: `Lobby tools ${Date.now()}`,
        auto_send_email: false,
        description: '**Markdown lobby description**',
      },
    })
  ).json();
  for (const name of ['Ana', 'Beto', 'Carla', 'Diego'])
    expect(
      (
        await request.post(`/api/registrations/${lobby.id}/registrant`, {
          headers,
          data: { player_name: name, email: '', answers: {} },
        })
      ).ok(),
    ).toBeTruthy();
  await loginAdmin(page);
  await page.goto(`/admin/lobby/${lobby.id}`);
  await expect(page.getByText('**Markdown lobby description**', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Player options: Ana' }).click();
  await page.getByRole('menuitem', { name: 'Edit', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit player' });
  await edit.getByLabel('Player name').fill('Ana Maria');
  await edit.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Ana Maria', exact: true })).toBeVisible();
  // No claims waiting, so there is no Claims tab to open.
  await expect(page.getByRole('tab', { name: 'Claims' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Player codes' }).click();
  await expect(page.getByTestId('lobby-code-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Lobby settings' });
  await expect(drawer.getByLabel('Description')).toHaveValue('**Markdown lobby description**');
  await drawer.getByLabel('Join code').fill('secret');
  await drawer.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Lobby settings saved')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('**Markdown lobby description**', { exact: true })).toHaveCount(0);
  await page.goto(`/register/${lobby.id}`);
  await expect(page.getByText('Markdown lobby description', { exact: true })).toHaveJSProperty(
    'tagName',
    'STRONG',
  );
  await page.goto(`/admin/lobby/${lobby.id}`);
  await page.getByRole('button', { name: 'Convert to tournament' }).click();
  await expect(page).toHaveURL(/\/admin\/new\?from=/);
  await page.getByRole('radio', { name: 'Mexicano + Play-offs' }).click();
  const registrants = page.getByTestId('convert-registrants');
  for (const name of ['Ana Maria', 'Beto', 'Carla', 'Diego'])
    await expect(registrants.getByRole('checkbox', { name })).toBeChecked();
  await page.getByRole('button', { name: 'Convert to tournament' }).last().click();
  await expect(page).toHaveURL(/\/admin\/t\//);
  const converted = await (await request.get(`/api/registrations/${lobby.id}`, { headers })).json();
  expect(converted.converted_to_tids).toHaveLength(1);
});

test('create form: roster picker adds a past participant', async ({ page, request }) => {
  const { headers } = await createTournament(request, 'mex', `Picker source ${Date.now()}`);
  void headers;
  await loginAdmin(page);
  await page.goto('/admin/new?type=mexicano');
  await page.getByRole('button', { name: 'Add known players' }).click();
  const sheet = page.getByRole('dialog', { name: 'Add known players' });
  await sheet.getByRole('tab', { name: 'Past participants' }).click();
  await sheet.getByLabel('Search').fill('Ana');
  await expect(sheet.getByRole('checkbox').first()).toBeVisible();
  await sheet.getByRole('checkbox').first().check();
  await sheet.getByRole('button', { name: 'Add selected' }).click();
  await expect(page.getByRole('textbox', { name: 'Player 1' })).not.toHaveValue('');
});

test('clubs: club page, tiers, settings and community rename', async ({ page, request }) => {
  const headers = await adminHeaders(request);
  const stamp = Date.now();
  const community = await (
    await request.post('/api/communities', { headers, data: { name: `Org Community ${stamp}` } })
  ).json();
  const club = await (
    await request.post('/api/clubs', {
      headers,
      data: { name: `Org Club ${stamp}`, community_id: community.id },
    })
  ).json();
  await loginAdmin(page);
  await page.goto(`/admin/clubs/${club.id}`);
  await expect(page.getByRole('heading', { name: `Org Club ${stamp}` })).toBeVisible();
  await page.getByRole('tab', { name: 'Skill tiers' }).click();
  await page.getByRole('button', { name: 'Add tier' }).first().click();
  const tier = page.getByRole('dialog', { name: 'Add tier' });
  await tier.getByLabel(/^Name/).fill('Gold tier');
  await tier.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('tier-row').filter({ hasText: 'Gold tier' })).toBeVisible();
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByRole('button', { name: 'Add player' })).toBeVisible();
  await page.getByRole('tab', { name: 'Settings' }).click();
  await page.getByLabel('Club name').fill(`Renamed Club ${stamp}`);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Renamed Club ${stamp}` })).toBeVisible();
  await page.getByLabel('Tagline').fill('Friendly padel');
  await page.getByRole('button', { name: 'Save tagline' }).click();
  await expect(page.getByText('Landing page saved')).toBeVisible();
  await page.goto('/admin/clubs');
  await page.getByRole('button', { name: `Options for Org Community ${stamp}` }).click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('dialog', { name: 'Rename community' });
  await rename.getByLabel(/^Name/).fill(`Org Community ${stamp} B`);
  await rename.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: `Org Community ${stamp} B`, exact: true }),
  ).toBeVisible();
});

test('users: delete an account; the invite needs mail so it explains the error', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const username = `temp-${Date.now().toString(36)}`;
  expect(
    (
      await request.post('/api/auth/users', {
        headers,
        data: { username, password: 'organizer-test-2026', role: 'user' },
      })
    ).ok(),
  ).toBeTruthy();
  await loginAdmin(page);
  await page.goto('/admin/users');
  await page.getByRole('button', { name: `Options for ${username}` }).click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('cell', { name: username, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Invite by email' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Email').fill('new-organizer@example.com');
  await sheet.getByRole('button', { name: 'Send invitation' }).last().click();
  await expect(sheet.getByRole('alert')).toBeVisible();
});

test('player profiles: search and edit a profile', async ({ page, request }) => {
  const { id, headers } = await createTournament(request, 'mex', `Profiles ${Date.now()}`);
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, { name: string; passphrase: string }>;
  const ana = Object.values(secrets).find((p) => p.name === 'Ana')!;
  const email = `profile-${Date.now()}@example.com`;
  expect(
    (
      await request.post('/api/player-profile', {
        data: { participant_passphrase: ana.passphrase, name: 'Ana Profile', email },
      })
    ).ok(),
  ).toBeTruthy();
  await loginAdmin(page);
  await page.goto('/admin/players');
  await page.getByLabel('Search players').fill(email);
  const row = page.getByTestId('profile-row').filter({ hasText: 'Ana Profile' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: /Manage/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Ana Profile' });
  await sheet.getByLabel('Name', { exact: true }).fill('Ana Renamed');
  await sheet.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByText('Name updated')).toBeVisible();
});

test('settings drawer: preferred courts per group', async ({ page, request }) => {
  const { id } = await createTournament(request, 'gp', `Group courts ${Date.now()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  const drawer = await openSettings(page, 'Courts');
  const perGroup = drawer.getByRole('switch', { name: /Courts per group/ });
  await perGroup.click();
  await expect(perGroup).toBeChecked();
  await drawer.getByRole('combobox', { name: 'Group A' }).click();
  await page.getByRole('option', { name: 'Court 2' }).click();
  await page.keyboard.press('Escape');
  await drawer.getByRole('button', { name: 'Save courts' }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tournaments/${id}/gp/status`)).json()).group_courts,
    )
    .toEqual({ A: ['Court 2'] });
});
