import { readFileSync } from 'node:fs';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin, patchTvSettings } from './helpers';

// Group stage and Mexicano rounds stay readable after the play-offs start (Player Hub, TV,
// workspace), and the export covers every phase and both stages.

interface M {
  id: string;
  status: string;
}

async function finishGroups(request: APIRequestContext, id: string) {
  const headers = await adminHeaders(request);
  for (let round = 0; round < 8; round++) {
    const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
    for (const list of Object.values(groups.matches as Record<string, M[]>))
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
  return headers;
}

async function gpInPlayoffs(request: APIRequestContext, name: string) {
  const { id } = await createTournament(request, 'gp', name);
  const headers = await finishGroups(request, id);
  expect(
    (await request.post(`/api/tournaments/${id}/gp/start-playoffs`, { headers, data: {} })).ok(),
  ).toBeTruthy();
  return id;
}

async function mexInPlayoffs(request: APIRequestContext, name: string) {
  const { id, headers } = await createTournament(request, 'mex', name);
  const round = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of round.current_matches)
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
  expect((await request.post(`/api/tournaments/${id}/mex/end`, { headers })).ok()).toBeTruthy();
  expect(
    (
      await request.post(`/api/tournaments/${id}/mex/start-playoffs`, {
        headers,
        data: { n_teams: 4 },
      })
    ).ok(),
  ).toBeTruthy();
  return id;
}

/** Opens the workspace, exports an HTML report and returns its text. */
async function exportedReport(page: Page, id: string) {
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
  return { text: readFileSync((await file.path())!, 'utf8'), filename: file.suggestedFilename() };
}

const at = (text: string, needle: string) => {
  const index = text.indexOf(needle);
  expect(index, `"${needle}" is in the report`).toBeGreaterThanOrEqual(0);
  return index;
};

test('export in the group stage is a snapshot with upcoming matches and group tables', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'gp', `Export groups ${Date.now()}`);
  const { text, filename } = await exportedReport(page, id);
  expect(filename).toMatch(/-standings-\d{8}-\d{4}\.html$/);
  expect(text).toContain('Standings snapshot');
  expect(text).toContain('Group stage');
  expect(text).toMatch(/\d+ of \d+ matches played/);
  expect(text).toContain('Upcoming matches');
  expect(text).toContain('Group A');
  expect(text).not.toContain('Play-offs');
});

test('export in the play-offs keeps the group stage after the bracket stage', async ({
  page,
  request,
}) => {
  const id = await gpInPlayoffs(request, `Export playoffs ${Date.now()}`);
  const { text } = await exportedReport(page, id);
  // Order: upcoming, play-offs, then the group stage with its own table and matches.
  const upcoming = at(text, 'Upcoming matches');
  const playoffs = at(text, '<h2>Play-offs</h2>');
  const groupStage = at(text, '<h2>Group stage</h2>');
  expect(upcoming).toBeLessThan(playoffs);
  expect(playoffs).toBeLessThan(groupStage);
  const groupPart = text.slice(groupStage);
  expect(groupPart).toContain('Group A');
  expect(groupPart).toContain('Group B');
  expect(groupPart).toContain('class="standings"');
  expect(groupPart).toContain('Match history');
  // Each stage counts its own matches.
  expect(text.match(/\d+ of \d+ matches played/g)!.length).toBeGreaterThanOrEqual(2);
});

test('export of a Mexicano in its rounds has the leaderboard and the current round', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Export mex ${Date.now()}`);
  const { text } = await exportedReport(page, id);
  expect(text).toContain('Standings snapshot');
  expect(text).toContain('Leaderboard');
  expect(text).toContain('Upcoming matches');
  expect(text).toContain('Mexicano rounds');
});

test('export of a Mexicano in the play-offs keeps the leaderboard and the round history', async ({
  page,
  request,
}) => {
  const id = await mexInPlayoffs(request, `Export mex playoffs ${Date.now()}`);
  const { text } = await exportedReport(page, id);
  const playoffs = at(text, '<h2>Play-offs</h2>');
  const rounds = at(text, '<h2>Mexicano rounds</h2>');
  expect(playoffs).toBeLessThan(rounds);
  const roundsPart = text.slice(rounds);
  expect(roundsPart).toContain('Leaderboard');
  expect(roundsPart).toContain('Match history');
  expect(roundsPart).toContain('14-10');
});

test('the workspace lists the earlier stage behind a switch, read-only', async ({
  page,
  request,
}) => {
  const id = await gpInPlayoffs(request, `Stage switch ${Date.now()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  const stage = page.getByTestId('stage-switch');
  await expect(stage).toBeVisible();
  await stage.getByText('Group stage', { exact: true }).click();
  const earlier = page.getByTestId('earlier-stage-matches');
  await expect(earlier.getByTestId('match-row').first()).toBeVisible();
  await expect(earlier.getByRole('button', { name: /^(Enter score|Edit score)/ })).toHaveCount(0);
  await stage.getByText('Play-offs', { exact: true }).click();
  await expect(page.getByTestId('earlier-stage-matches')).toHaveCount(0);
});

test('the Mexicano workspace keeps the rounds behind the stage switch', async ({
  page,
  request,
}) => {
  const id = await mexInPlayoffs(request, `Mex stage ${Date.now()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await page.getByTestId('stage-switch').getByText('Mexicano rounds', { exact: true }).click();
  await expect(
    page.getByTestId('earlier-stage-matches').getByTestId('match-row').first(),
  ).toBeVisible();
});

test('the TV keeps the group tables after the bracket once the play-offs run', async ({
  page,
  request,
}) => {
  const id = await gpInPlayoffs(request, `TV groups later ${Date.now()}`);
  await patchTvSettings(request, id, { refresh_interval: 0, show_standings: true });
  await page.goto(`/tv/${id}`);
  const standings = page.locator('[data-section="standings"]');
  await expect(standings).toBeVisible();
  await expect(standings.getByText('Group stage', { exact: true })).toBeVisible();
  await expect(standings.getByRole('table').first()).toBeVisible();
  const bracket = page.locator('[data-section="bracket"]');
  if (await bracket.count())
    expect((await bracket.boundingBox())!.y).toBeLessThan((await standings.boundingBox())!.y);
});

test('the Hub event page keeps the group stage under the play-offs, with its table', async ({
  page,
  request,
}) => {
  const id = await gpInPlayoffs(request, `Hub stages ${Date.now()}`);
  const secrets = (
    await (
      await request.get(`/api/tournaments/${id}/player-secrets`, {
        headers: await adminHeaders(request),
      })
    ).json()
  ).players as Record<string, { name: string; passphrase: string }>;
  const [, secret] = Object.entries(secrets)[0]!;
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: secret.passphrase,
      name: secret.name,
      email: `stages-${Date.now()}@example.com`,
    },
  });
  expect(created.ok()).toBeTruthy();
  const session = await created.json();
  const hubLoaded = page.waitForResponse(
    (r) => /\/api\/player-profile\/space\?/.test(r.url()) && r.ok(),
  );
  await page.goto(`/player#token=${encodeURIComponent(session.access_token)}`);
  await hubLoaded;
  await page.goto(`/player/matches/tournament/${id}`);
  const earlier = page.getByTestId('event-earlier-stage');
  await expect(earlier).toBeVisible();
  // The stage title is the collapsible section's header, just outside the stage's content.
  await expect(page.getByRole('heading', { name: 'Group stage', level: 2 })).toBeVisible();
  await expect(earlier.getByRole('heading', { name: 'Group standings' })).toBeVisible();
  await expect(earlier.getByRole('table').first()).toBeVisible();
  await expect(earlier.getByTestId('player-match').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Final standings' })).toHaveCount(0);
});
