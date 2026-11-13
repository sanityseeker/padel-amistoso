import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, openTournament, PLAYERS } from './helpers';

/** Withdraw sits in each player row's options menu. */
async function openWithdraw(page: Page, player: string) {
  await page.getByRole('button', { name: `Player options: ${player}` }).click();
  await page.getByRole('menuitem', { name: 'Withdraw', exact: true }).click();
}

/** Whether the player's options menu offers Withdraw (the menu is closed again afterwards). */
async function expectNoWithdraw(page: Page, player: string) {
  await page.getByRole('button', { name: `Player options: ${player}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Contact and email' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Withdraw', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
}

// Withdrawal outcomes, chosen by the backend (backend/tournaments/withdrawal.py):
//   - fixed teams / singles group stage: the 50% rule. 2 * played >= total -> walkovers, else annul.
//   - any play-off bracket (also Mexicano play-offs): forfeit, the opponent advances, no undo.
//   - Mexicano rounds: no Withdraw at all; the remove button and DELETE /players/{id} are used.
// The rotating-partner group stage ("exclude") is covered in workspace.spec.ts.

const TEN = [...PLAYERS, 'Irene', 'Jorge'];
const TEAMS = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
const PAIRS = TEAMS.map((_, i) => TEN.slice(i * 2, i * 2 + 2));

interface GroupMatch {
  id: string;
  team1: string[];
  team2: string[];
  status: string;
  walkover: boolean;
}
interface Summary {
  entry_key: string;
  name: string;
  kind: string;
  played: number;
  total: number;
  walkovers: number;
  undo_allowed: boolean;
}

// One group of five fixed teams: every team has four matches, so one played match annuls the entry
// (1 of 4) and two is exactly half (walkovers).
async function fiveTeamGroup(request: APIRequestContext, label: string, playedByAlpha: number) {
  const name = `Withdraw ${label} ${Date.now()}`;
  const { id, headers } = await createTournament(request, 'gp', name, {
    player_names: TEN,
    team_mode: true,
    teams: PAIRS,
    team_names: TEAMS,
    num_groups: 1,
    top_per_group: 4,
  });
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  const all = Object.values(groups.matches as Record<string, GroupMatch[]>).flat();
  const alphas = all.filter((m) => [...m.team1, ...m.team2].includes('Alpha'));
  expect(alphas).toHaveLength(4);
  for (const m of alphas.slice(0, playedByAlpha))
    expect(
      (
        await request.post(`/api/tournaments/${id}/gp/record-group`, {
          headers,
          data: { match_id: m.id, score1: 21, score2: 12 },
        })
      ).ok(),
    ).toBeTruthy();
  return { id, name };
}

const groupMatches = async (request: APIRequestContext, id: string) =>
  Object.values(
    (await (await request.get(`/api/tournaments/${id}/gp/groups`)).json()).matches as Record<
      string,
      GroupMatch[]
    >,
  ).flat();

const withdrawalsOf = async (request: APIRequestContext, id: string, prefix: string) =>
  (await (await request.get(`/api/tournaments/${id}/${prefix}/status`)).json())
    .withdrawals as Summary[];

test('50% rule: exactly half played keeps the results and turns the rest into walkovers', async ({
  page,
  request,
}) => {
  const { id, name } = await fiveTeamGroup(request, 'Half', 2);
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  await openWithdraw(page, 'Ana');
  const dialog = page.getByRole('dialog', { name: /^Withdraw Alpha/ });
  await expect(dialog.getByText('2 of 4 matches already played.')).toBeVisible();
  await expect(
    dialog.getByText('Results already played stand. The remaining matches become walkovers.'),
  ).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annul results and withdraw' })).toHaveCount(0);
  // The two unplayed matches are listed with the default walkover score, winner first.
  const lines = dialog.getByTestId('withdraw-matches').getByText(/→ 6-0$/);
  await expect(lines).toHaveCount(2);
  await expect(dialog.getByLabel('Walkover score: winner')).toHaveValue('6');
  await dialog.getByRole('button', { name: 'Withdraw with walkovers', exact: true }).click();
  await expect(page.getByText('Alpha has withdrawn.')).toBeVisible();

  const [record] = await withdrawalsOf(request, id, 'gp');
  expect(record).toMatchObject({
    name: 'Alpha',
    kind: 'walkover',
    played: 2,
    total: 4,
    walkovers: 2,
  });
  const alphas = (await groupMatches(request, id)).filter((m) =>
    [...m.team1, ...m.team2].includes('Alpha'),
  );
  // Played results stand (4 matches in all), the two others are completed walkovers.
  expect(alphas).toHaveLength(4);
  expect(alphas.filter((m) => m.walkover)).toHaveLength(2);
  expect(alphas.every((m) => m.status === 'completed')).toBeTruthy();
});

test('50% rule: less than half played annuls the entry and removes it from the group', async ({
  page,
  request,
}) => {
  const { id, name } = await fiveTeamGroup(request, 'Annul', 1);
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  await openWithdraw(page, 'Ana');
  const dialog = page.getByRole('dialog', { name: /^Withdraw Alpha/ });
  await expect(
    dialog.getByText('Every result of this entry is annulled and it leaves the standings.'),
  ).toBeVisible();
  // The one played match had ratings, so the dialog says they are recalculated.
  await expect(dialog.getByText('Ratings of the annulled matches are recalculated.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Withdraw with walkovers' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Annul results and withdraw', exact: true }).click();
  await expect(page.getByText('Alpha has withdrawn.')).toBeVisible();

  const [record] = await withdrawalsOf(request, id, 'gp');
  expect(record).toMatchObject({ name: 'Alpha', kind: 'annul', played: 1, total: 4, walkovers: 0 });
  // Alpha and its four matches are gone from the group.
  expect(
    (await groupMatches(request, id)).filter((m) => [...m.team1, ...m.team2].includes('Alpha')),
  ).toHaveLength(0);
  const standings = (await (await request.get(`/api/tournaments/${id}/gp/groups`)).json())
    .standings as Record<string, { player: string }[]>;
  expect(
    Object.values(standings)
      .flat()
      .map((r) => r.player),
  ).not.toContain('Alpha');
});

test('play-off withdrawal forfeits the pending match, advances the opponent and cannot be undone', async ({
  page,
  request,
}) => {
  const name = `Withdraw Bracket ${Date.now()}`;
  const { id, headers } = await createTournament(request, 'gp', name, {
    team_mode: true,
    teams: PAIRS.slice(0, 4),
    team_names: TEAMS.slice(0, 4),
  });
  for (const m of await groupMatches(request, id))
    await request.post(`/api/tournaments/${id}/gp/record-group`, {
      headers,
      data: { match_id: m.id, score1: 21, score2: 10 },
    });
  expect(
    (await request.post(`/api/tournaments/${id}/gp/start-playoffs`, { headers, data: {} })).ok(),
  ).toBeTruthy();
  const semis = (
    (await (await request.get(`/api/tournaments/${id}/gp/playoffs`)).json())
      .matches as (GroupMatch & { round_label: string })[]
  ).filter((m) => m.round_label === 'Semi-Final');
  const leaver = semis[0]!.team2[0]!;
  const opponent = semis[0]!.team1[0]!;
  const member = PAIRS[TEAMS.indexOf(leaver)]![0]!;

  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  await openWithdraw(page, member);
  const dialog = page.getByRole('dialog', { name: new RegExp(`^Withdraw ${leaver}`) });
  await expect(
    dialog.getByText('The entry forfeits its play-off match and the opponent advances.'),
  ).toBeVisible();
  await expect(dialog.getByText(`${opponent} advances without playing.`)).toBeVisible();
  await expect(dialog.getByText('This cannot be undone.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Annul results and withdraw' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Withdraw with walkovers' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Forfeit and withdraw', exact: true }).click();
  await expect(page.getByText(`${leaver} has withdrawn.`)).toBeVisible();

  const [record] = await withdrawalsOf(request, id, 'gp');
  expect(record).toMatchObject({ name: leaver, kind: 'forfeit', undo_allowed: false });
  const bracket = (await (await request.get(`/api/tournaments/${id}/gp/playoffs`)).json())
    .matches as (GroupMatch & { round_label: string })[];
  const forfeited = bracket.find((m) => m.id === semis[0]!.id)!;
  expect(forfeited).toMatchObject({ walkover: true, status: 'completed' });
  // The opponent now waits in the final.
  const final = bracket.find((m) => m.round_label === 'Final')!;
  expect([...final.team1, ...final.team2]).toContain(opponent);
  // No Undo anywhere, and the withdrawn entry has no Withdraw button any more.
  await expect(page.getByText('Withdrawn', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo withdrawal' })).toHaveCount(0);
  await expectNoWithdraw(page, member);
  const undo = await request.delete(`/api/tournaments/${id}/withdrawals/${record!.entry_key}`, {
    headers,
  });
  expect(undo.ok()).toBeFalsy();
});

test('Mexicano: no Withdraw during the rounds, a play-off forfeit afterwards', async ({
  page,
  request,
}) => {
  const name = `Withdraw Mex ${Date.now()}`;
  const { id, headers } = await createTournament(request, 'mex', name, {
    player_names: PLAYERS,
  });
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByTestId('code-row').first()).toBeVisible();
  await expectNoWithdraw(page, PLAYERS[0]!);
  // The backend agrees: the rounds use the remove endpoint.
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, { name: string }>;
  const anaId = Object.entries(secrets).find(([, p]) => p.name === 'Ana')![0];
  const refused = await request.post(`/api/tournaments/${id}/withdrawals`, {
    headers,
    data: { player_id: anaId, expected_kind: 'forfeit' },
  });
  expect(refused.status()).toBe(409);
  expect(await refused.text()).toContain('Use remove player during the Mexicano rounds');

  // Play the only round, end the rounds and start the play-offs with the four best players.
  const round = await (await request.get(`/api/tournaments/${id}/mex/matches`)).json();
  for (const m of round.current_matches)
    await request.post(`/api/tournaments/${id}/mex/record`, {
      headers,
      data: { match_id: m.id, score1: 14, score2: 10 },
    });
  expect(
    (await request.post(`/api/tournaments/${id}/mex/end`, { headers, data: {} })).ok(),
  ).toBeTruthy();
  expect(
    (
      await request.post(`/api/tournaments/${id}/mex/start-playoffs`, {
        headers,
        data: { n_teams: 4 },
      })
    ).ok(),
  ).toBeTruthy();
  const final = (await (await request.get(`/api/tournaments/${id}/mex/playoffs`)).json())
    .matches[0] as GroupMatch;
  expect(final.team1.length + final.team2.length).toBe(4);
  const leaving = final.team2[0]!;
  const stays = final.team1.join(' & ');

  await page.reload();
  await page.getByRole('tab', { name: 'Players' }).click();
  await openWithdraw(page, leaving);
  const dialog = page.getByRole('dialog', { name: /^Withdraw / });
  await expect(
    dialog.getByText('The entry forfeits its play-off match and the opponent advances.'),
  ).toBeVisible();
  await expect(dialog.getByText(`${stays} advances without playing.`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Forfeit and withdraw', exact: true }).click();

  // The forfeit decides the final, so the tournament finishes with the other side as champions.
  await expect
    .poll(async () => (await (await request.get(`/api/tournaments/${id}/mex/status`)).json()).phase)
    .toBe('finished');
  const [record] = await withdrawalsOf(request, id, 'mex');
  expect(record).toMatchObject({ kind: 'forfeit', undo_allowed: false });
  await expect(page.getByText(`Champions: ${stays}`)).toBeVisible();
});

test.afterAll(async ({ request }) => {
  const headers = await adminHeaders(request);
  const list = await (await request.get('/api/tournaments', { headers })).json();
  for (const t of list as { id: string; name: string }[])
    if (/^Withdraw (Half|Annul|Bracket|Mex) /.test(t.name))
      await request.delete(`/api/tournaments/${t.id}`, { headers });
});
