import { test, expect, type Page } from '@playwright/test';
import { adminHeaders, loginAdmin, fillNames } from './helpers';

// Admin capabilities that the legacy admin had and the React admin gained in the parity pass:
// fixed teams and the team builder, the group draw preview, Mexicano creation options, the lobby
// participant filter and convert panel, own default community, the demo login, club pins, the Info
// page and the lobby QR code.

const post = (page: Page, path: string) =>
  page.waitForRequest((r) => r.url().endsWith(path) && r.method() === 'POST');

test('create: fixed teams from the team builder and a previewed group draw', async ({ page }) => {
  await loginAdmin(page);
  await page.goto('/admin/new?type=group_playoff');
  await page.getByLabel('Tournament name').fill(`Teams GP ${Date.now()}`);
  await page
    .getByRole('radiogroup', { name: 'Entries' })
    .getByText('Team', { exact: true })
    .click();
  await expect(page.getByTestId('team-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Add team' }).click();
  await page.getByRole('button', { name: 'Add team' }).click();
  const people = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fabio', 'Gala', 'Hugo'];
  for (let team = 0; team < 4; team++)
    for (let slot = 0; slot < 2; slot++)
      await page
        .getByLabel(`Team ${team + 1}, player ${slot + 1}`, { exact: true })
        .fill(people[team * 2 + slot]!);
  await page.getByLabel('Team 1 name', { exact: true }).fill('The Aces');
  await expect(page.getByText('4 teams')).toBeVisible();

  await page.getByRole('button', { name: 'Group names and draw' }).click();
  await page.getByRole('button', { name: 'Preview the draw' }).click();
  const draw = page.getByTestId('group-draw');
  await expect(draw).toBeVisible();
  await expect(draw.getByText('The Aces')).toBeVisible();
  // Move the first team of the first group over to the other one.
  // With two groups the menu collapses to one direct "Move <team> to <group>" button.
  await draw
    .getByRole('button', { name: /^Move .+ to / })
    .first()
    .click();

  const request = post(page, '/api/tournaments/group-playoff');
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.team_mode).toBe(true);
  expect(body.teams).toHaveLength(4);
  expect(body.team_names).toEqual(['The Aces', '', '', '']);
  expect(Object.keys(body.group_assignments).sort()).toEqual(['A', 'B']);
  expect(Object.values<string[]>(body.group_assignments).flat().sort()).toEqual(
    ['Carla & Diego', 'Elena & Fabio', 'Gala & Hugo', 'The Aces'].sort(),
  );
  await expect(page).toHaveURL(/\/admin\/t\//);
});

test('create: a padel play-off is built from teams and offers winners, a 3rd-place match and a preview', async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto('/admin/new?type=playoff');
  // Padel play-offs are always teams: no Individual / Team switch.
  await expect(page.getByRole('radio', { name: 'Individual', exact: true })).toHaveCount(0);
  await page.getByLabel('Tournament name').fill(`Teams PO ${Date.now()}`);
  await page.getByRole('button', { name: 'Add team' }).click();
  await page.getByRole('button', { name: 'Add team' }).click();
  const people = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fabio', 'Gala', 'Hugo'];
  for (let team = 0; team < 4; team++)
    for (let slot = 0; slot < 2; slot++)
      await page
        .getByLabel(`Team ${team + 1}, player ${slot + 1}`, { exact: true })
        .fill(people[team * 2 + slot]!);
  await page.getByRole('combobox', { name: 'Number of winners' }).click();
  await page.getByRole('option', { name: /^3 — Semi-Finals/ }).click();
  await expect(page.getByRole('switch', { name: '3rd-place match' })).toBeChecked();
  await page.getByRole('button', { name: 'Preview bracket' }).click();
  await expect(page.getByTestId('schema-image').first()).toBeVisible({ timeout: 30_000 });
  await page.keyboard.press('Escape');

  const request = post(page, '/api/tournaments/playoff');
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const body = (await request).postDataJSON();
  expect(body.team_mode).toBe(true);
  expect(body.participant_names).toEqual(people);
  expect(body.teams).toHaveLength(4);
  expect(body.num_winners).toBe(3);
  expect(body.third_place).toBe(true);
  await expect(page).toHaveURL(/\/admin\/t\//);
});

test('create: Mexicano scoring and pairing options are saved with the tournament', async ({
  page,
  request,
}) => {
  await loginAdmin(page);
  await page.goto('/admin/new?type=mexicano');
  await page.getByLabel('Tournament name').fill(`Mex options ${Date.now()}`);
  await fillNames(page, 'players', 'Ana\nBeto\nCarla\nDiego');
  await page.getByRole('button', { name: 'Advanced settings' }).click();
  await page.getByLabel('Win bonus', { exact: true }).fill('5');
  await page.getByLabel('Rival strength', { exact: true }).fill('0.5');
  await page.getByLabel('Teammate repeat weight', { exact: true }).fill('3');
  await page.getByLabel('Partner balance weight', { exact: true }).fill('0.4');
  const sent = post(page, '/api/tournaments/mexicano');
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const body = (await sent).postDataJSON();
  expect(body).toMatchObject({
    win_bonus: 5,
    strength_weight: 0.5,
    teammate_repeat_weight: 3,
    partner_balance_weight: 0.4,
    loss_discount: 1,
    balance_tolerance: 0.2,
    team_mode: false,
  });
  await expect(page).toHaveURL(/\/admin\/t\//);
  const id = page.url().split('/').pop()!;
  const status = await (
    await request.get(`/api/tournaments/${id}/mex/status`, { headers: await adminHeaders(request) })
  ).json();
  expect(status).toMatchObject({ win_bonus: 5, strength_weight: 0.5, teammate_repeat_weight: 3 });
});

async function seedLobby(request: import('@playwright/test').APIRequestContext) {
  const headers = await adminHeaders(request);
  const name = `Filter lobby ${Date.now()}`;
  const lobby = await (
    await request.post('/api/registrations', {
      headers,
      data: {
        name,
        auto_send_email: false,
        questions: [
          {
            key: 'level',
            label: 'Level',
            type: 'choice',
            required: false,
            choices: ['Beginner', 'Advanced'],
          },
        ],
      },
    })
  ).json();
  const people: [string, string][] = [
    ['Ana', 'Advanced'],
    ['Beto', 'Beginner'],
    ['Carla', 'Advanced'],
    ['Diego', 'Advanced'],
    ['Elena', 'Beginner'],
  ];
  for (const [name, level] of people)
    expect(
      (
        await request.post(`/api/registrations/${lobby.id}/registrant`, {
          headers,
          data: { player_name: name, email: '', answers: { level } },
        })
      ).ok(),
    ).toBeTruthy();
  return { id: lobby.id as string, name, headers };
}

test('lobby: the participant filter previews, saves and preselects people on convert', async ({
  page,
  request,
}) => {
  const { id, headers } = await seedLobby(request);
  await loginAdmin(page);
  await page.goto(`/admin/lobby/${id}`);
  await expect(page.getByRole('tab', { name: 'Recent answer changes' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Eligibility' }).click();
  const editor = page.getByTestId('participant-filter');
  await editor.getByText('Advanced', { exact: true }).click();
  await expect(page.getByTestId('filter-result')).toContainText('3 / 5');
  await expect(page.getByTestId('filter-result')).toContainText('Ana');
  await expect(page.getByTestId('filter-result')).not.toContainText('Beto');
  await editor.getByRole('button', { name: 'Save filter' }).click();
  await expect(page.getByText('Filter saved')).toBeVisible();
  const saved = await (await request.get(`/api/registrations/${id}`, { headers })).json();
  expect(saved.participant_filter).toHaveLength(1);
  expect(saved.participant_filter[0]).toMatchObject({
    key: 'level',
    op: 'any_of',
    values: ['Advanced'],
  });
  expect(saved.eligible_player_ids).toHaveLength(3);
  // The players tab marks who is not eligible.
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByText('Not eligible')).toHaveCount(2);

  // Converting preselects only the eligible registrants.
  await page.goto(`/admin/new?from=${id}&type=group_playoff`);
  const list = page.getByTestId('convert-registrants');
  await expect(list.getByRole('checkbox', { name: 'Ana' })).toBeChecked();
  await expect(list.getByRole('checkbox', { name: 'Beto' })).not.toBeChecked();
  await expect(page.getByText('3 of 5 selected')).toBeVisible();
  // Clearing the filter from the editor returns everyone.
  await page.goto(`/admin/lobby/${id}`);
  await page.getByRole('tab', { name: 'Eligibility' }).click();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.getByText('Filter cleared')).toBeVisible();
});

test('convert: pick registrants, form fixed teams from them and add an extra player', async ({
  page,
  request,
}) => {
  const { id, headers } = await seedLobby(request);
  await loginAdmin(page);
  await page.goto(`/admin/new?from=${id}&type=mexicano`);
  await page
    .getByRole('radiogroup', { name: 'Entries' })
    .getByText('Team', { exact: true })
    .click();
  const list = page.getByTestId('convert-registrants');
  await list.getByRole('checkbox', { name: 'Elena' }).uncheck();
  await page.getByRole('button', { name: 'Auto pair' }).click();
  await expect(page.getByTestId('team-row')).toHaveCount(2);
  await page.getByRole('button', { name: 'Show answers: Ana' }).click();
  await expect(page.getByText('Advanced').first()).toBeVisible();
  const sent = post(page, `/api/registrations/${id}/convert`);
  await page.getByRole('button', { name: 'Convert to tournament' }).last().click();
  const body = (await sent).postDataJSON();
  expect(body.tournament_type).toBe('mexicano');
  expect(body.team_mode).toBe(true);
  expect(body.teams).toEqual([
    ['Ana', 'Beto'],
    ['Carla', 'Diego'],
  ]);
  expect(body.player_names).toEqual(['Ana', 'Beto', 'Carla', 'Diego']);
  await expect(page).toHaveURL(/\/admin\/t\//);
  const lobby = await (await request.get(`/api/registrations/${id}`, { headers })).json();
  expect(lobby.converted_to_tids).toHaveLength(1);
});

test('lobby: answers summary, CSV download and a sign-up QR code', async ({ page, request }) => {
  const { id, name, headers } = await seedLobby(request);
  const registration = await request.post(`/api/registrations/${id}/register`, {
    data: { player_name: 'Zara', answers: { level: 'Advanced' } },
  });
  expect(registration.ok()).toBeTruthy();
  const { passphrase } = await registration.json();
  const update = await request.patch(`/api/registrations/${id}/player-answers`, {
    data: { passphrase, answers: { level: 'Beginner' } },
  });
  expect(update.ok()).toBeTruthy();
  const lobbies = await (
    await request.get('/api/registrations?include_archived=true', { headers })
  ).json();
  expect(
    lobbies.find((lobby: { id: string }) => lobby.id === id).latest_answer_change_id,
  ).toBeGreaterThan(0);

  await loginAdmin(page);
  await page.goto('/admin');
  const lobbyRow = page.getByTestId('event-row').filter({ hasText: name });
  await expect(lobbyRow.getByText('New answers')).toBeVisible();
  await lobbyRow.getByRole('link', { name }).click();
  await expect(page).toHaveURL(`/admin/lobby/${id}`);
  await expect(page.getByRole('tab', { name: 'Recent answer changes' })).toBeVisible();
  await page.getByRole('tab', { name: 'Recent answer changes' }).click();
  const changes = page.getByTestId('answer-changes');
  await expect(changes.getByText('Changed the answer to Level')).toBeVisible();
  await expect(changes.getByText('From: Advanced')).toBeVisible();
  await expect(changes.getByText('To: Beginner')).toBeVisible();
  await expect(changes.getByText(/^Zara ·/)).toHaveCount(2);
  await page.goto('/admin');
  await expect(
    page.getByTestId('event-row').filter({ hasText: name }).getByText('New answers'),
  ).toHaveCount(0);
  await page.goto(`/admin/lobby/${id}`);
  await page.getByRole('tab', { name: 'Answers' }).click();
  const panel = page.getByTestId('answers-panel');
  await expect(panel.getByRole('progressbar', { name: 'Advanced: 3' })).toBeVisible();
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download answers (CSV)' }).click();
  expect((await download).suggestedFilename()).toMatch(/^answers_.*\.csv$/);

  await page.getByRole('button', { name: 'QR code', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Sign-up QR code' });
  const qr = dialog.getByTestId('qr-image');
  await expect(qr).toBeVisible();
  await expect(qr).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(dialog.getByRole('link', { name: 'Download QR code' })).toHaveAttribute(
    'download',
    /signup-qr\.svg$/,
  );
});

test('clubs: your default community is saved on the account', async ({ page, request }) => {
  const headers = await adminHeaders(request);
  const community = await (
    await request.post('/api/communities', {
      headers,
      data: { name: `Default community ${Date.now()}` },
    })
  ).json();
  await loginAdmin(page);
  await page.goto('/admin/clubs');
  const select = page.getByRole('combobox', { name: 'Community' });
  await select.click();
  await page.getByRole('option', { name: community.name }).click();
  const patch = page.waitForRequest(
    (r) => r.url().endsWith('/api/auth/me/settings') && r.method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await patch).postDataJSON()).toEqual({ default_community_id: community.id });
  await expect(page.getByText('Default community saved')).toBeVisible();
  const me = await (await request.get('/api/auth/me', { headers })).json();
  expect(me.default_community_id).toBe(community.id);
  // New tournaments start in it.
  await page.goto('/admin/new');
  await expect(page.getByRole('combobox', { name: 'Community' })).toHaveValue(community.name);
  // Put the shared account back so other specs see the global default.
  expect(
    (
      await request.patch('/api/auth/me/settings', {
        headers,
        data: { default_community_id: 'open' },
      })
    ).ok(),
  ).toBeTruthy();
});

test('club events: pin, reorder and unpin on the club page, and attach an existing event', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const stamp = Date.now();
  const community = await (
    await request.post('/api/communities', { headers, data: { name: `Pin community ${stamp}` } })
  ).json();
  const club = await (
    await request.post('/api/clubs', {
      headers,
      data: { name: `Pin club ${stamp}`, community_id: community.id },
    })
  ).json();
  const make = async (name: string, extra: Record<string, unknown>) =>
    (
      await (
        await request.post('/api/tournaments/playoff', {
          headers,
          data: {
            name,
            participant_names: ['Ana / Beto', 'Carla / Diego'],
            team_mode: true,
            court_names: ['Court 1'],
            community_id: community.id,
            ...extra,
          },
        })
      ).json()
    ).id as string;
  const first = await make(`Pin first ${stamp}`, { club_id: club.id });
  const second = await make(`Pin second ${stamp}`, { club_id: club.id });
  await make(`Pin loose ${stamp}`, {});
  await loginAdmin(page);
  await page.goto(`/admin/clubs/${club.id}`);
  const pins = async () =>
    (
      (await (await request.get('/api/clubs', { headers })).json()) as {
        id: string;
        pinned_tournament_ids: string[];
      }[]
    ).find((c) => c.id === club.id)!.pinned_tournament_ids;
  await page.getByRole('button', { name: `Pin on club page: Pin first ${stamp}` }).click();
  await expect.poll(pins).toEqual([`tn:${first}`]);
  await page.getByRole('button', { name: `Pin on club page: Pin second ${stamp}` }).click();
  await expect.poll(pins).toEqual([`tn:${first}`, `tn:${second}`]);
  await expect(page.getByRole('region', { name: 'Pinned on club page' })).toBeVisible();
  await page.getByRole('button', { name: `Move down: Pin first ${stamp}` }).click();
  await expect.poll(pins).toEqual([`tn:${second}`, `tn:${first}`]);
  await page.getByRole('button', { name: `Unpin from club page: Pin second ${stamp}` }).click();
  await expect.poll(pins).toEqual([`tn:${first}`]);

  // Attach: the loose event joins the club.
  await page.getByRole('button', { name: 'Attach existing' }).click();
  const row = page.getByTestId('attach-row').filter({ hasText: `Pin loose ${stamp}` });
  await row.getByRole('button', { name: 'Attach' }).click();
  await expect(
    page.getByTestId('club-event-row').filter({ hasText: `Pin loose ${stamp}` }),
  ).toBeVisible();
});

test('Info: the guide is public and draws a bracket schema', async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/admin/info');
  await expect(page.getByTestId('info-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tournament formats' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ELO rating system' })).toBeVisible();
  await page.getByText('3×4', { exact: true }).click();
  await page.getByRole('button', { name: 'Generate schema' }).click();
  await expect(page.getByTestId('schema-image')).toBeVisible({ timeout: 30_000 });
  await context.close();
});

test.describe('demo instance', () => {
  test.use({ baseURL: 'http://127.0.0.1:8012' });

  test('one click starts a sandbox and shows its passphrase once', async ({ page }) => {
    await page.goto('/admin');
    await page.getByTestId('start-demo').click();
    const banner = page.getByTestId('demo-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Demo sandbox: demo-/);
    const token = await page.evaluate(() => localStorage.getItem('padel-auth-token'));
    expect(token).toBeTruthy();
    await banner.getByRole('button', { name: 'Dismiss' }).click();
    await expect(banner.getByText(/Your passphrase is the account password/)).toHaveCount(0);
    // The admin session is a demo account: the API says so.
    const me = await page.evaluate(async (t) => {
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${t}` } });
      return res.json();
    }, token);
    expect(me.is_demo).toBe(true);
  });
});
