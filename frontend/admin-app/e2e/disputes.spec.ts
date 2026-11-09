import { test, expect, type APIRequestContext } from '@playwright/test';
import { createTournament, openTournament, patchTvSettings } from './helpers';

interface Seeded {
  id: string;
  matchId: string;
  team1: string;
  team2: string;
  headers1: Record<string, string>;
  headers2: Record<string, string>;
  admin: Record<string, string>;
}

// A group tournament where players score for themselves, plus one match with a player on each side.
async function seed(request: APIRequestContext, name: string, confirmation = 'required') {
  const { id, headers: admin } = await createTournament(request, 'gp', name);
  await patchTvSettings(request, id, { score_confirmation: confirmation });
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers: admin })).json()
  ).players as Record<string, { passphrase: string }>;
  const groups = (await (await request.get(`/api/tournaments/${id}/gp/groups`)).json())
    .matches as Record<
    string,
    { id: string; team1_ids: string[]; team2_ids: string[]; team1: string[]; team2: string[] }[]
  >;
  const match = Object.values(groups).flat()[0];
  const login = async (pid: string) => {
    const res = await request.post(`/api/tournaments/${id}/player-auth`, {
      data: { passphrase: secrets[pid].passphrase },
    });
    expect(res.ok()).toBeTruthy();
    return { Authorization: `Bearer ${(await res.json()).access_token}` };
  };
  return {
    id,
    matchId: match.id,
    team1: match.team1.join(' & '),
    team2: match.team2.join(' & '),
    headers1: await login(match.team1_ids[0]),
    headers2: await login(match.team2_ids[0]),
    admin,
  } satisfies Seeded;
}

const apiMatch = async (request: APIRequestContext, s: Seeded) => {
  const groups = (await (await request.get(`/api/tournaments/${s.id}/gp/groups`)).json())
    .matches as Record<string, Record<string, unknown>[]>;
  return Object.values(groups)
    .flat()
    .find((m) => m.id === s.matchId)!;
};

async function submit(request: APIRequestContext, s: Seeded, score: [number, number]) {
  const res = await request.post(`/api/tournaments/${s.id}/gp/record-group`, {
    headers: s.headers1,
    data: { match_id: s.matchId, score1: score[0], score2: score[1] },
  });
  expect(res.ok()).toBeTruthy();
}

async function dispute(request: APIRequestContext, s: Seeded, score: [number, number]) {
  const res = await request.post(`/api/tournaments/${s.id}/matches/${s.matchId}/correct`, {
    headers: s.headers2,
    data: { match_id: s.matchId, score1: score[0], score2: score[1] },
  });
  expect(res.ok()).toBeTruthy();
}

test('a player score waiting for confirmation is counted on the tab and the header', async ({
  page,
  request,
}) => {
  const name = `Disp Pending ${Date.now()}`;
  const s = await seed(request, name);
  await submit(request, s, [6, 3]);
  await openTournament(page, s.id, name);
  await expect(page.getByRole('button', { name: '1 to review' })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Review/ })).toContainText('1');
  await page.getByRole('tab', { name: /Review/ }).click();
  const queue = page.getByTestId('review-queue');
  await expect(queue).toContainText(s.team1);
  await expect(queue).toContainText('Awaiting confirmation');
  await queue.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('review-queue')).toHaveCount(0);
  await expect(page.getByText('Nothing to review.')).toBeVisible();
  await expect.poll(async () => (await apiMatch(request, s)).score_confirmed).toBe(true);
  expect((await apiMatch(request, s)).status).toBe('completed');
  // The badge is gone with the last item.
  await expect(page.getByRole('button', { name: /to review$/ })).toHaveCount(0);
});

test('rejecting an unconfirmed score returns the match to unplayed', async ({ page, request }) => {
  const name = `Disp Reject ${Date.now()}`;
  const s = await seed(request, name);
  await submit(request, s, [6, 3]);
  await openTournament(page, s.id, name);
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByTestId('review-queue').getByRole('button', { name: 'Reject' }).click();
  await expect.poll(async () => (await apiMatch(request, s)).score).toBeNull();
});

test('a disputed score can take the correction', async ({ page, request }) => {
  const name = `Disp Resolve ${Date.now()}`;
  const s = await seed(request, name);
  await submit(request, s, [6, 3]);
  await dispute(request, s, [3, 6]);
  expect((await apiMatch(request, s)).disputed).toBe(true);
  await openTournament(page, s.id, name);
  await page.getByRole('tab', { name: /Review/ }).click();
  const row = page.getByTestId('review-queue').getByRole('listitem');
  await expect(row).toContainText('Dispute');
  await expect(row).toContainText('6-3');
  await expect(row).toContainText('3-6');

  // Use the correction.
  await row.getByRole('button', { name: 'Use correction' }).click();
  await expect.poll(async () => (await apiMatch(request, s)).score).toEqual([3, 6]);
  expect((await apiMatch(request, s)).disputed).toBe(false);
});

test('a dispute can be overridden with a custom score', async ({ page, request }) => {
  const name = `Disp Override ${Date.now()}`;
  const s = await seed(request, name);
  await submit(request, s, [6, 3]);
  await dispute(request, s, [2, 6]);
  await openTournament(page, s.id, name);
  await page.getByRole('tab', { name: /Review/ }).click();
  await expect(page.getByTestId('review-queue').getByRole('listitem')).toContainText('2-6');
  await page.getByTestId('review-queue').getByRole('button', { name: 'Override' }).click();
  await page.getByTestId('score-1').fill('5');
  await page.getByTestId('score-2').fill('7');
  await page.getByRole('button', { name: 'Resolve dispute' }).click();
  await expect.poll(async () => (await apiMatch(request, s)).score).toEqual([5, 7]);
  await expect(page.getByText('Nothing to review.')).toBeVisible();
});

test('keeping the original closes the dispute', async ({ page, request }) => {
  const name = `Disp Original ${Date.now()}`;
  const s = await seed(request, name);
  await submit(request, s, [6, 3]);
  await dispute(request, s, [3, 6]);
  await openTournament(page, s.id, name);
  await page.getByRole('tab', { name: /Review/ }).click();
  await page.getByRole('button', { name: 'Keep original' }).click();
  await expect.poll(async () => (await apiMatch(request, s)).disputed).toBe(false);
  expect((await apiMatch(request, s)).score).toEqual([6, 3]);
});

test('a score entered in another format waits for approval', async ({ page, request }) => {
  const name = `Disp Format ${Date.now()}`;
  const s = await seed(request, name, 'immediate');
  const res = await request.post(`/api/tournaments/${s.id}/gp/record-group-tennis`, {
    headers: s.headers1,
    data: {
      match_id: s.matchId,
      sets: [
        [6, 4],
        [6, 3],
      ],
    },
  });
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).review).toBe(true);
  await openTournament(page, s.id, name);
  await page.getByRole('tab', { name: /Review/ }).click();
  const row = page.getByTestId('review-queue').getByRole('listitem');
  await expect(row).toContainText('Needs review');
  await expect(row).toContainText('6-4 6-3');
  await row.getByRole('button', { name: 'Approve' }).click();
  await expect
    .poll(async () => (await apiMatch(request, s)).sets)
    .toEqual([
      [6, 4],
      [6, 3],
    ]);
});

test('live updates add a new submission without a reload', async ({ page, request }) => {
  const name = `Disp Live ${Date.now()}`;
  const s = await seed(request, name);
  await openTournament(page, s.id, name);
  await expect(page.getByRole('button', { name: /to review$/ })).toHaveCount(0);
  await submit(request, s, [6, 1]);
  await expect(page.getByRole('button', { name: '1 to review' })).toBeVisible({ timeout: 15_000 });
});

test.afterAll(async ({ request }) => {
  const { adminHeaders } = await import('./helpers');
  const headers = await adminHeaders(request);
  const list = (await (await request.get('/api/tournaments', { headers })).json()) as {
    id: string;
    name: string;
  }[];
  for (const t of list)
    if (/^(Disp|Score|Codes) /.test(t.name))
      await request.delete(`/api/tournaments/${t.id}`, { headers });
});
