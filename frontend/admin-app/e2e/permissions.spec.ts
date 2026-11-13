import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders } from './helpers';

// Organizer permissions, as the backend intends them (backend/api/helpers.py, routes_share.py,
// routes_crud.py, routes_communities.py, routes_clubs.py):
//   - An organizer lists only tournaments they own or that were shared with them (admins see all).
//   - Owner, admin and co-editors may edit: score, settings, withdraw, publish.
//   - Only the owner (or an admin) may delete, manage co-editors, move the community or recalculate ratings.
//   - Communities that hold a club are listed only to admins and to that club's owner and co-editors.

const PASSWORD = 'organizer-test-2026';
const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

interface Organizer {
  username: string;
  headers: Record<string, string>;
}

async function organizer(request: APIRequestContext, label: string): Promise<Organizer> {
  const username = `${label}-${stamp()}`;
  const created = await request.post('/api/auth/users', {
    headers: await adminHeaders(request),
    data: { username, password: PASSWORD, role: 'user' },
  });
  expect(created.ok()).toBeTruthy();
  const login = await request.post('/api/auth/login', { data: { username, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  return { username, headers: { Authorization: `Bearer ${(await login.json()).access_token}` } };
}

async function logIn(page: Page, who: Organizer) {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill(who.username);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
}

async function tournamentOf(request: APIRequestContext, owner: Organizer, name: string) {
  const created = await request.post('/api/tournaments/group-playoff', {
    headers: owner.headers,
    data: {
      name,
      player_names: ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fabio', 'Gala', 'Hugo'],
      num_groups: 2,
      top_per_group: 2,
      court_names: ['Court 1', 'Court 2'],
    },
  });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).id as string;
}

const visibleTo = async (request: APIRequestContext, who: Organizer, id: string) =>
  (
    (await (await request.get('/api/tournaments', { headers: who.headers })).json()) as {
      id: string;
    }[]
  ).some((t) => t.id === id);

const completedGroupMatches = async (request: APIRequestContext, id: string) =>
  Object.values(
    (await (await request.get(`/api/tournaments/${id}/gp/groups`)).json()).matches as Record<
      string,
      { status: string }[]
    >,
  )
    .flat()
    .filter((m) => m.status === 'completed').length;

test('another organizer neither sees nor can change a tournament they do not own', async ({
  page,
  request,
}) => {
  const owner = await organizer(request, 'own');
  const other = await organizer(request, 'oth');
  const name = `Perm Owned ${stamp()}`;
  const mine = `Perm Mine ${stamp()}`;
  const id = await tournamentOf(request, owner, name);
  await tournamentOf(request, other, mine);
  expect(await visibleTo(request, owner, id)).toBe(true);
  expect(await visibleTo(request, other, id)).toBe(false);

  await logIn(page, other);
  await expect(page.getByText(mine).first()).toBeVisible();
  await expect(page.getByText(name)).toHaveCount(0);
  // A direct link shows the not-found state, with no workspace controls.
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByText('Tournament not found')).toBeVisible();
  await expect(
    page.getByText('It may have been removed or you may not have access.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Workspace menu' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name })).toHaveCount(0);

  // The API refuses every write with 403 and leaves the tournament as it was.
  const h = other.headers;
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  const match = (Object.values(groups.matches) as { id: string }[][]).flat()[0]!;
  const refusals = [
    request.patch(`/api/tournaments/${id}/tv-settings`, {
      headers: h,
      data: { score_confirmation: 'required' },
    }),
    request.patch(`/api/tournaments/${id}/public`, { headers: h, data: { public: false } }),
    request.post(`/api/tournaments/${id}/gp/record-group`, {
      headers: h,
      data: { match_id: match.id, score1: 21, score2: 5 },
    }),
    request.post(`/api/tournaments/${id}/gp/next-group-round`, { headers: h, data: {} }),
    request.post(`/api/tournaments/${id}/withdrawals`, {
      headers: h,
      data: { player_id: 'x', expected_kind: 'exclude' },
    }),
    request.post(`/api/tournaments/${id}/collaborators`, {
      headers: h,
      data: { username: other.username },
    }),
    request.patch(`/api/tournaments/${id}/community`, {
      headers: h,
      data: { community_id: 'open' },
    }),
    request.delete(`/api/tournaments/${id}`, { headers: h }),
  ];
  for (const res of await Promise.all(refusals)) expect(res.status()).toBe(403);
  expect(await completedGroupMatches(request, id)).toBe(0);
  expect(await visibleTo(request, owner, id)).toBe(true);
});

test('a co-editor can score and settle the tournament but not delete or share it, and loses access when removed', async ({
  page,
  request,
}) => {
  const owner = await organizer(request, 'own');
  const coeditor = await organizer(request, 'coe');
  const name = `Perm Shared ${stamp()}`;
  const id = await tournamentOf(request, owner, name);
  expect(await visibleTo(request, coeditor, id)).toBe(false);
  const added = await request.post(`/api/tournaments/${id}/collaborators`, {
    headers: owner.headers,
    data: { username: coeditor.username },
  });
  expect((await added.json()).collaborators).toEqual([coeditor.username]);
  expect(await visibleTo(request, coeditor, id)).toBe(true);

  // In the browser the shared tournament is listed and can be scored.
  await logIn(page, coeditor);
  await expect(page.getByText(name).first()).toBeVisible();
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page
    .getByRole('button', { name: /^(Record score|More scoring options):/ })
    .first()
    .click();
  await page.getByTestId('score-1').fill('21');
  await page.getByTestId('score-2').fill('9');
  await page.keyboard.press('Enter');
  await expect.poll(() => completedGroupMatches(request, id)).toBe(1);
  await expect(page.getByRole('tab', { name: 'Players' })).toBeVisible();

  // Editing routes work for the co-editor ...
  const h = coeditor.headers;
  expect(
    (
      await request.patch(`/api/tournaments/${id}/public`, { headers: h, data: { public: false } })
    ).ok(),
  ).toBeTruthy();
  expect(
    (await request.get(`/api/tournaments/${id}/collaborators`, { headers: h })).ok(),
  ).toBeTruthy();
  // ... owner-only routes do not.
  for (const res of await Promise.all([
    request.post(`/api/tournaments/${id}/collaborators`, {
      headers: h,
      data: { username: owner.username },
    }),
    request.delete(`/api/tournaments/${id}/collaborators/${coeditor.username}`, { headers: h }),
    request.patch(`/api/tournaments/${id}/community`, {
      headers: h,
      data: { community_id: 'open' },
    }),
    request.post(`/api/tournaments/${id}/elo/recalculate`, { headers: h }),
    request.delete(`/api/tournaments/${id}`, { headers: h }),
  ]))
    expect(res.status()).toBe(403);
  expect(await visibleTo(request, owner, id)).toBe(true);

  // Removing the co-editor ends their access everywhere.
  const removed = await request.delete(
    `/api/tournaments/${id}/collaborators/${coeditor.username}`,
    {
      headers: owner.headers,
    },
  );
  expect((await removed.json()).collaborators).toEqual([]);
  expect(await visibleTo(request, coeditor, id)).toBe(false);
  expect(
    (
      await request.patch(`/api/tournaments/${id}/public`, { headers: h, data: { public: true } })
    ).status(),
  ).toBe(403);
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByText('Tournament not found')).toBeVisible();
});

// DELETE and the collaborator routes are owner/admin-only, so the workspace offers a co-editor
// neither "Delete tournament" nor the "Add a co-editor" form, while the owner keeps both.
test('the workspace menu offers a co-editor no Delete, which the API refuses', async ({
  page,
  request,
}) => {
  const owner = await organizer(request, 'own');
  const coeditor = await organizer(request, 'coe');
  const name = `Perm Menu ${stamp()}`;
  const id = await tournamentOf(request, owner, name);
  await request.post(`/api/tournaments/${id}/collaborators`, {
    headers: owner.headers,
    data: { username: coeditor.username },
  });
  await logIn(page, coeditor);
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export results' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete tournament' })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // Settings stay available to the co-editor, without the owner-only controls.
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('No co-editors yet')).toHaveCount(0);
  await expect(page.getByText(coeditor.username).first()).toBeVisible();
  await expect(page.getByText('Add a co-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: `Remove ${coeditor.username}` })).toHaveCount(0);
  await expect(page.getByText('Player ratings')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Community' })).toBeDisabled();

  // The owner still gets both controls.
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await logIn(page, owner);
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.getByRole('button', { name: 'Workspace menu' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete tournament' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('Add a co-editor')).toBeVisible();
  await expect(page.getByRole('button', { name: `Remove ${coeditor.username}` })).toBeVisible();
  await expect(page.getByText('Player ratings')).toBeVisible();
});

test('communities that hold a club are hidden from organizers who cannot edit that club', async ({
  page,
  request,
}) => {
  const admin = await adminHeaders(request);
  const owner = await organizer(request, 'cown');
  const stranger = await organizer(request, 'cstr');
  const communityName = `Perm Community ${stamp()}`;
  const community = await (
    await request.post('/api/communities', { headers: admin, data: { name: communityName } })
  ).json();
  const club = await (
    await request.post('/api/clubs', {
      headers: owner.headers,
      data: { name: `Perm Club ${stamp()}`, community_id: community.id },
    })
  ).json();
  const listedIds = async (who: Record<string, string>) =>
    (
      (await (await request.get('/api/communities', { headers: who })).json()) as { id: string }[]
    ).map((c) => c.id);
  expect(await listedIds(owner.headers)).toContain(community.id);
  expect(await listedIds(admin)).toContain(community.id);
  expect(await listedIds(stranger.headers)).not.toContain(community.id);

  // The stranger cannot edit the club or its settings.
  expect(
    (
      await request.patch(`/api/clubs/${club.id}`, {
        headers: stranger.headers,
        data: { name: 'Hijacked' },
      })
    ).status(),
  ).toBe(403);
  expect(
    (await request.delete(`/api/clubs/${club.id}`, { headers: stranger.headers })).status(),
  ).toBe(403);

  // The create form offers the stranger no way to pick that community.
  await logIn(page, stranger);
  await page.goto('/admin/new?type=group_playoff');
  await expect(page.getByLabel('Tournament name')).toBeVisible();
  await page.getByRole('combobox', { name: 'Community' }).click();
  await expect(page.getByRole('option', { name: 'Open' })).toBeVisible();
  await expect(page.getByRole('option', { name: communityName })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

// App inconsistency: club communities are hidden from strangers and club edits answer 403, but
// POST /tournaments/* accepts any `club_id` (helpers._store_tournament only aligns scope, it never
// checks club editor access), so a stranger can file a tournament inside someone else's club.
test('a tournament cannot be filed in a club the organizer cannot edit', async ({ request }) => {
  const owner = await organizer(request, 'cown');
  const stranger = await organizer(request, 'cstr');
  const community = await (
    await request.post('/api/communities', {
      headers: await adminHeaders(request),
      data: { name: `Perm Community ${stamp()}` },
    })
  ).json();
  const club = await (
    await request.post('/api/clubs', {
      headers: owner.headers,
      data: { name: `Perm Club ${stamp()}`, community_id: community.id },
    })
  ).json();
  const intruder = await request.post('/api/tournaments/group-playoff', {
    headers: stranger.headers,
    data: {
      name: `Perm Intruder ${stamp()}`,
      player_names: ['Ana', 'Beto', 'Carla', 'Diego'],
      num_groups: 1,
      community_id: community.id,
      club_id: club.id,
    },
  });
  expect(intruder.status()).toBe(403);
});

test.afterAll(async ({ request }) => {
  const headers = await adminHeaders(request);
  const list = await (await request.get('/api/tournaments', { headers })).json();
  for (const t of list as { id: string; name: string }[])
    if (/^Perm /.test(t.name)) await request.delete(`/api/tournaments/${t.id}`, { headers });
});
