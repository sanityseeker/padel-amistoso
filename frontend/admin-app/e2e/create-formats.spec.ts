import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, loginAdmin, fillNames } from './helpers';

// Creation through /admin/new for the formats capabilities.spec.ts does not cover (individual
// entries and tennis). Each test reads the saved tournament back from the API instead of trusting
// the request body or the redirect.

const EIGHT = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fabio', 'Gala', 'Hugo'];
const FOUR = EIGHT.slice(0, 4);

interface ListedTournament {
  id: string;
  name: string;
  type: string;
  sport: string;
  team_mode: boolean;
  phase: string;
  public: boolean;
}

async function listed(request: APIRequestContext, id: string) {
  const list = (await (
    await request.get('/api/tournaments', { headers: await adminHeaders(request) })
  ).json()) as ListedTournament[];
  const found = list.find((t) => t.id === id);
  expect(found, `tournament ${id} is listed`).toBeTruthy();
  return found!;
}

async function chooseSport(page: Page, sport: 'Padel' | 'Tennis') {
  await page.getByRole('radiogroup', { name: 'Sport' }).getByText(sport, { exact: true }).click();
}

async function submit(page: Page, endpoint: string) {
  const sent = page.waitForRequest((r) => r.url().endsWith(endpoint) && r.method() === 'POST');
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const body = (await sent).postDataJSON();
  await expect(page).toHaveURL(/\/admin\/t\/[^/]+$/);
  return { body, id: page.url().split('/').pop()! };
}

const standingNames = async (request: APIRequestContext, id: string) => {
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  const byGroup = groups.standings as Record<string, { player: string }[]>;
  return Object.fromEntries(
    Object.entries(byGroup).map(([g, rows]) => [g, rows.map((r) => r.player)]),
  );
};

test('create: individual Group + Play-off pairs players by the engine and starts the groups', async ({
  page,
  request,
}) => {
  const name = `Create GP solo ${Date.now()}`;
  await loginAdmin(page);
  await page.goto('/admin/new?type=group_playoff');
  await page.getByLabel('Tournament name').fill(name);
  await expect(page.getByRole('radio', { name: 'Padel' })).toBeChecked();
  await fillNames(page, 'players', EIGHT.join('\n'));
  await fillNames(page, 'courts', 'Court 1\nCourt 2');
  await page.getByLabel(/^Groups/).fill('2');
  const { body, id } = await submit(page, '/api/tournaments/group-playoff');
  expect(body).toMatchObject({ team_mode: false, sport: 'padel', num_groups: 2 });
  // Who advances and the bracket format are chosen when the play-offs start, not here.
  expect(body.top_per_group).toBeUndefined();
  expect(body.double_elimination).toBeUndefined();
  expect(body.teams).toBeUndefined();

  expect(await listed(request, id)).toMatchObject({
    name,
    type: 'group_playoff',
    sport: 'padel',
    team_mode: false,
    phase: 'groups',
  });
  const status = await (await request.get(`/api/tournaments/${id}/gp/status`)).json();
  expect(status).toMatchObject({
    num_groups: 2,
    team_mode: false,
    sport: 'padel',
    phase: 'groups',
  });
  expect(status.courts.map((c: { name: string }) => c.name)).toEqual(['Court 1', 'Court 2']);
  // Every typed player landed in exactly one group, and the first round of matches exists.
  const groups = await standingNames(request, id);
  expect(Object.keys(groups)).toHaveLength(2);
  expect(Object.values(groups).flat().sort()).toEqual([...EIGHT].sort());
  const matches = (await (await request.get(`/api/tournaments/${id}/gp/groups`)).json()).matches;
  expect(Object.values(matches).flat().length).toBeGreaterThan(0);
});

test('create: individual tennis Direct Playoffs are singles matches', async ({ page, request }) => {
  const name = `Create PO tennis ${Date.now()}`;
  await loginAdmin(page);
  await page.goto('/admin/new?type=playoff');
  await page.getByLabel('Tournament name').fill(name);
  await chooseSport(page, 'Tennis');
  // Tennis play-offs offer the Individual / Team switch and start as singles.
  await expect(
    page.getByRole('radiogroup', { name: 'Entries' }).getByRole('radio', { name: 'Individual' }),
  ).toBeChecked();
  await fillNames(page, 'players', FOUR.join('\n'));
  const { body, id } = await submit(page, '/api/tournaments/playoff');
  expect(body).toMatchObject({ team_mode: false, sport: 'tennis', participant_names: FOUR });
  expect(body.teams).toBeUndefined();

  expect(await listed(request, id)).toMatchObject({
    name,
    type: 'playoff',
    sport: 'tennis',
    team_mode: false,
  });
  const status = await (await request.get(`/api/tournaments/${id}/po/status`)).json();
  expect(status).toMatchObject({ sport: 'tennis', phase: 'playoffs' });
  // Singles: each side of each first-round match is one named player, and all four are drawn.
  const matches = (await (await request.get(`/api/tournaments/${id}/po/playoffs`)).json())
    .matches as { team1: string[]; team2: string[]; round_label: string }[];
  const first = matches.filter((m) => m.team1.length && m.team2.length);
  expect(first).toHaveLength(2);
  for (const m of first) {
    expect(m.team1).toHaveLength(1);
    expect(m.team2).toHaveLength(1);
  }
  expect(first.flatMap((m) => [...m.team1, ...m.team2]).sort()).toEqual([...FOUR].sort());
});

test('create: tennis Group + Play-off keeps every player as their own entry', async ({
  page,
  request,
}) => {
  const name = `Create GP tennis ${Date.now()}`;
  await loginAdmin(page);
  await page.goto('/admin/new?type=group_playoff');
  await page.getByLabel('Tournament name').fill(name);
  await chooseSport(page, 'Tennis');
  await fillNames(page, 'players', EIGHT.join('\n'));
  await page.getByLabel(/^Groups/).fill('2');
  const { body, id } = await submit(page, '/api/tournaments/group-playoff');
  // Tennis group stages always play fixed sides, so "individual" is sent as team_mode with singles.
  expect(body).toMatchObject({ team_mode: true, sport: 'tennis', num_groups: 2 });
  expect(body.teams).toBeUndefined();

  expect(await listed(request, id)).toMatchObject({
    name,
    type: 'group_playoff',
    sport: 'tennis',
    team_mode: true,
    phase: 'groups',
  });
  const status = await (await request.get(`/api/tournaments/${id}/gp/status`)).json();
  expect(status).toMatchObject({ sport: 'tennis', team_mode: true, num_groups: 2 });
  const groups = await standingNames(request, id);
  expect(Object.values(groups).flat().sort()).toEqual([...EIGHT].sort());
  // Fixed sides: each group plays a full round robin, 4 players -> 6 matches per group.
  const matches = (await (await request.get(`/api/tournaments/${id}/gp/groups`)).json())
    .matches as Record<string, unknown[]>;
  expect(Object.values(matches).map((g) => g.length)).toEqual([6, 6]);
});

test.afterAll(async ({ request }) => {
  const headers = await adminHeaders(request);
  const list = await (await request.get('/api/tournaments', { headers })).json();
  for (const t of list as { id: string; name: string }[])
    if (/^Create (GP|PO)/.test(t.name))
      await request.delete(`/api/tournaments/${t.id}`, { headers });
});

// Seeding: ratings prefill the strength of linked players, edits override them, and the draw preview
// and the request follow the chosen mode. The profile list and ratings are stubbed (the lookup itself
// is covered by tests/test_club_elo.py).
async function addLinkedPlayers(page: Page) {
  await page.route('**/api/admin/player-profiles?*', (route) =>
    route.fulfill({
      json: [
        { id: 'seed-ana', name: 'Ana', email: '', is_ghost: false },
        { id: 'seed-beto', name: 'Beto', email: '', is_ghost: false },
      ],
    }),
  );
  await page.getByRole('button', { name: 'Add known players' }).click();
  await page.getByRole('tab', { name: 'Player profiles' }).click();
  await page.getByRole('checkbox', { name: 'Ana' }).check();
  await page.getByRole('checkbox', { name: 'Beto' }).check();
  await page.getByRole('button', { name: 'Add selected' }).click();
}

test('create: seeding by rating prefills linked players and seeds the group draw', async ({
  page,
}) => {
  await loginAdmin(page);
  let asked: { profile_ids: string[] } | null = null;
  await page.route('**/api/tournaments/starting-ratings', async (route) => {
    asked = route.request().postDataJSON();
    await route.fulfill({ json: { ratings: { 'seed-ana': 1400.4, 'seed-beto': 1300 } } });
  });
  await page.goto('/admin/new?type=group_playoff');
  await page.getByLabel('Tournament name').fill(`Seeded GP ${Date.now()}`);
  await fillNames(page, 'players', EIGHT.slice(2).join('\n'));
  await addLinkedPlayers(page);
  await fillNames(page, 'courts', 'Court 1\nCourt 2');
  await page.getByLabel(/^Groups/).fill('2');

  await expect(page.getByRole('radio', { name: 'By rating' })).toBeChecked();
  await page.getByRole('button', { name: /starting strength/ }).click();
  await expect(page.getByLabel('Starting strength for Ana')).toHaveValue('1400');
  await expect(page.getByLabel('Starting strength for Beto')).toHaveValue('1300');
  await expect(page.getByLabel('Starting strength for Carla')).toHaveValue('');
  expect(asked!.profile_ids).toEqual(['seed-ana', 'seed-beto']);
  await page.getByLabel('Starting strength for Beto').fill('1250');

  // Snake draft: the two strongest open the two groups.
  await page.getByRole('button', { name: 'Group names and draw' }).click();
  await page.getByRole('button', { name: 'Preview the draw' }).click();
  const draw = page.getByTestId('group-draw');
  await expect(draw.getByText('Ana · 1400')).toBeVisible();
  await expect(draw.getByText('Beto · 1250')).toBeVisible();
  await expect(draw.getByText('Carla · 1000')).toHaveCount(0);
  const target = async (name: string) =>
    (await draw
      .getByRole('button', { name: new RegExp(`^Move ${name} to `) })
      .getAttribute('aria-label'))!.replace(/^Move \S+ to /, '');
  expect(await target('Ana')).not.toBe(await target('Beto'));

  const sent = page.waitForRequest(
    (r) => r.url().endsWith('/api/tournaments/group-playoff') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const body = (await sent).postDataJSON();
  expect(body.seeding).toBe('elo');
  expect(body.player_strengths).toEqual({ Ana: 1400, Beto: 1250 });
});

test('create: manual seeding ignores ratings and no seeding sends no strengths', async ({
  page,
}) => {
  await loginAdmin(page);
  await page.route('**/api/tournaments/starting-ratings', (route) =>
    route.fulfill({ json: { ratings: { 'seed-ana': 1400 } } }),
  );
  await page.goto('/admin/new?type=mexicano');
  await page.getByLabel('Tournament name').fill(`Unseeded Mexicano ${Date.now()}`);
  await fillNames(page, 'players', EIGHT.slice(2).join('\n'));
  await addLinkedPlayers(page);
  await fillNames(page, 'courts', 'Court 1\nCourt 2');

  await page.getByRole('radiogroup', { name: 'Seeding' }).getByText('Manual').click();
  await page.getByRole('button', { name: /starting strength/ }).click();
  await expect(page.getByLabel('Starting strength for Ana')).toHaveValue('');
  await page.getByLabel('Starting strength for Carla').fill('1100');

  await page.getByRole('radiogroup', { name: 'Seeding' }).getByText('No seeding').click();
  await expect(page.getByLabel('Starting strength for Carla')).toHaveCount(0);
  const sent = page.waitForRequest(
    (r) => r.url().endsWith('/api/tournaments/mexicano') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Create tournament', exact: true }).click();
  const body = (await sent).postDataJSON();
  expect(body.seeding).toBe('none');
  expect(body.player_strengths).toBeUndefined();
  await expect(page).toHaveURL(/\/admin\/t\/[^/]+$/);
});
