import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, openTournament } from './helpers';

// Full tournaments on the real backend (no route stubs): groups seeded through the API, then the
// play-offs are started, scored and advanced through the admin UI.

interface BracketMatch {
  id: string;
  team1: string[];
  team2: string[];
  status: string;
  round_label: string;
  score: [number, number] | null;
}
interface Secret {
  name: string;
  passphrase: string;
}

const TEAMS: Record<string, string[]> = {
  Alpha: ['Ana', 'Beto'],
  Bravo: ['Carla', 'Diego'],
  Charlie: ['Elena', 'Fabio'],
  Delta: ['Gala', 'Hugo'],
};

const bracketOf = async (request: APIRequestContext, id: string, prefix: 'gp' | 'po') =>
  (await (await request.get(`/api/tournaments/${id}/${prefix}/playoffs`)).json())
    .matches as BracketMatch[];

const statusOf = async (request: APIRequestContext, id: string, prefix: 'gp' | 'po') =>
  await (await request.get(`/api/tournaments/${id}/${prefix}/status`)).json();

async function playOutGroups(request: APIRequestContext, id: string) {
  const headers = await adminHeaders(request);
  const groups = await (await request.get(`/api/tournaments/${id}/gp/groups`)).json();
  for (const list of Object.values(groups.matches as Record<string, { id: string }[]>))
    for (const m of list)
      expect(
        (
          await request.post(`/api/tournaments/${id}/gp/record-group`, {
            headers,
            data: { match_id: m.id, score1: 21, score2: 10 },
          })
        ).ok(),
      ).toBeTruthy();
}

// A Hub profile linked to a tournament participant (through the participant's own passphrase).
async function linkedProfile(
  request: APIRequestContext,
  id: string,
  playerName: string,
  headers: Record<string, string>,
) {
  const secrets = (
    await (await request.get(`/api/tournaments/${id}/player-secrets`, { headers })).json()
  ).players as Record<string, Secret>;
  const secret = Object.values(secrets).find((p) => p.name === playerName)!;
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: secret.passphrase,
      name: playerName,
      email: `flow-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    },
  });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).access_token as string;
}

async function hubRating(request: APIRequestContext, token: string) {
  const space = await request.get('/api/player-profile/space', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(space.ok()).toBeTruthy();
  return (await space.json()).profile as { elo_padel: number | null; elo_padel_matches: number };
}

// Score one bracket match from the Bracket tab; `first` is the score of the side listed first.
// Play-off matches are scored in the Match centre: the row's own score boxes, or the score dialog.
async function scoreInMatches(page: Page, m: BracketMatch, first: number, second: number) {
  const [a, b] = [m.team1.join(' & '), m.team2.join(' & ')];
  const box = page.getByLabel(`Score: ${a}`, { exact: true });
  const record = page.getByRole('button', { name: `Record score: ${a} vs ${b}`, exact: true });
  await expect(box.or(record)).toBeVisible();
  if (await box.isVisible()) {
    await box.fill(String(first));
    await page.getByLabel(`Score: ${b}`, { exact: true }).fill(String(second));
    await page.getByRole('button', { name: `Save result: ${a} vs ${b}`, exact: true }).click();
    return;
  }
  await record.click();
  await page.getByTestId('score-1').fill(String(first));
  await page.getByTestId('score-2').fill(String(second));
  await page.keyboard.press('Enter');
}

const finalOf = async (request: APIRequestContext, id: string, prefix: 'gp' | 'po') =>
  (await bracketOf(request, id, prefix)).find((m) => m.round_label === 'Final')!;
const finalTeams = async (request: APIRequestContext, id: string, prefix: 'gp' | 'po') => {
  const f = await finalOf(request, id, prefix);
  return [...f.team1, ...f.team2].join(' | ');
};

test('Group + Play-offs: groups, bracket advancement, final, champion and a rating change', async ({
  page,
  request,
}) => {
  const name = `Flow GP ${Date.now()}`;
  const { id, headers } = await createTournament(request, 'gp', name, {
    team_mode: true,
    teams: Object.values(TEAMS),
    team_names: Object.keys(TEAMS),
  });
  await playOutGroups(request, id);

  // Start the plain single-elimination play-offs from the UI.
  await openTournament(page, id, name);
  await page.getByRole('button', { name: 'Start play-offs' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start the play-offs?' });
  await expect(dialog.getByRole('radio', { name: 'Single elimination' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(async () => (await statusOf(request, id, 'gp')).phase).toBe('playoffs');

  const semis = (await bracketOf(request, id, 'gp')).filter((m) => m.round_label === 'Semi-Final');
  expect(semis).toHaveLength(2);
  // The first semi-final's first-listed team goes through the whole bracket.
  const champion = semis[0]!.team1[0]!;
  const beaten = semis[0]!.team2[0]!;

  // Rate one member of the champion team and one of the team it beats in the semi-final.
  const winnerToken = await linkedProfile(request, id, TEAMS[champion]![0]!, headers);
  const loserToken = await linkedProfile(request, id, TEAMS[beaten]![0]!, headers);

  await page.getByRole('tab', { name: /^(Matches|Overview)$/ }).click();
  expect(await finalTeams(request, id, 'gp')).not.toContain(champion);

  await scoreInMatches(page, semis[0]!, 21, 12);
  // The semi-final winner moves into the final.
  await expect.poll(() => finalTeams(request, id, 'gp')).toContain(champion);
  expect(await finalTeams(request, id, 'gp')).not.toContain(beaten);

  await scoreInMatches(page, semis[1]!, 21, 14);
  await expect.poll(() => finalTeams(request, id, 'gp')).toContain(semis[1]!.team1[0]!);
  const finalMatch = await finalOf(request, id, 'gp');
  expect(finalMatch.team1.concat(finalMatch.team2).sort()).toEqual(
    [semis[0]!.team1[0]!, semis[1]!.team1[0]!].sort(),
  );
  expect((await statusOf(request, id, 'gp')).champion).toBeNull();

  // The champion team wins the final, whichever side of the row it is on.
  const championFirst = finalMatch.team1[0] === champion;
  await scoreInMatches(page, finalMatch, championFirst ? 21 : 9, championFirst ? 9 : 21);

  await expect.poll(async () => (await statusOf(request, id, 'gp')).phase).toBe('finished');
  await expect(page.getByText(`Champions: ${champion}`)).toBeVisible();
  // The standing on the Matches tab no longer offers a next step.
  await expect(page.getByRole('button', { name: 'Start play-offs' })).toHaveCount(0);

  // Ratings: the champion member gained, the beaten semi-finalist lost, both from the 1000 start.
  await expect
    .poll(async () => (await hubRating(request, winnerToken)).elo_padel_matches)
    .toBeGreaterThanOrEqual(3);
  const gained = await hubRating(request, winnerToken);
  const lost = await hubRating(request, loserToken);
  expect(gained.elo_padel).toBeGreaterThan(1000);
  expect(lost.elo_padel).toBeLessThan(1000);
});

test('Direct Playoffs: winners advance round by round to the champion', async ({
  page,
  request,
}) => {
  const name = `Flow PO ${Date.now()}`;
  const { id } = await createTournament(request, 'po', name);
  await openTournament(page, id, name);
  const semis = (await bracketOf(request, id, 'po')).filter((m) => m.round_label === 'Semi-Final');
  expect(semis).toHaveLength(2);
  const [a, b] = [semis[0]!.team2, semis[1]!.team2];

  // Second-listed sides win, so a lower seed advances.
  await scoreInMatches(page, semis[0]!, 8, 21);
  await expect.poll(() => finalTeams(request, id, 'po')).toContain(a[0]!);
  await scoreInMatches(page, semis[1]!, 11, 21);
  await expect.poll(() => finalTeams(request, id, 'po')).toContain(b[0]!);
  const finalMatch = await finalOf(request, id, 'po');
  expect(finalMatch.team1.length + finalMatch.team2.length).toBe(a.length + b.length);

  // The Bracket tab shows the picture of the same bracket.
  await page.getByRole('tab', { name: 'Bracket' }).click();
  await expect(
    page.getByTestId('bracket').getByRole('img', { name: 'Play-off bracket' }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('tab', { name: /^(Matches|Overview)$/ }).click();
  await scoreInMatches(page, finalMatch, 21, 17);
  await expect.poll(async () => (await statusOf(request, id, 'po')).phase).toBe('finished');
  await expect(page.getByText(`Champions: ${finalMatch.team1.join(' & ')}`)).toBeVisible();
});

test.afterAll(async ({ request }) => {
  const headers = await adminHeaders(request);
  const list = await (await request.get('/api/tournaments', { headers })).json();
  for (const t of list as { id: string; name: string }[])
    if (/^Flow /.test(t.name)) await request.delete(`/api/tournaments/${t.id}`, { headers });
});
