import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminHeaders, createTournament, openTournament } from './helpers';

interface Secret {
  name: string;
  passphrase: string;
  token: string;
  hub_account_linked: boolean;
}
const secretsOf = async (request: APIRequestContext, id: string) =>
  (
    await (
      await request.get(`/api/tournaments/${id}/player-secrets`, {
        headers: await adminHeaders(request),
      })
    ).json()
  ).players as Record<string, Secret>;

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('lists every player with passphrase, QR code and share link', async ({ page, request }) => {
  const name = `Codes List ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  const secrets = Object.values(await secretsOf(request, id));
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  await expect(page.getByTestId('code-row')).toHaveCount(secrets.length);
  for (const s of secrets) await expect(page.getByTestId('codes-list')).toContainText(s.passphrase);

  // The QR comes from the backend endpoint (no client library) and decodes as an image.
  await page.getByRole('button', { name: `QR code: ${secrets[0].name}` }).click();
  const qr = page.getByRole('dialog').getByRole('img', { name: 'QR code' });
  await expect(qr).toBeVisible();
  await expect
    .poll(() => qr.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(50);
  await page.keyboard.press('Escape');

  // Clicking a passphrase copies it; "Copy all" copies name: passphrase lines.
  await page.getByRole('button', { name: secrets[1].passphrase }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(secrets[1].passphrase);
  await page.getByRole('button', { name: 'Copy all codes' }).click();
  const all = await page.evaluate(() => navigator.clipboard.readText());
  for (const s of secrets) expect(all).toContain(`${s.name}: ${s.passphrase}`);
});

test('shows a compact marker beside players linked to a real Player Hub account', async ({
  page,
  request,
}) => {
  const name = `Codes Hub ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  const player = Object.values(await secretsOf(request, id))[0]!;
  const linked = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: player.passphrase,
      name: player.name,
      email: `codes-hub-${Date.now()}@example.com`,
    },
  });
  expect(linked.ok()).toBeTruthy();
  const updatedPlayer = Object.values(await secretsOf(request, id)).find(
    (p) => p.name === player.name,
  );
  expect(updatedPlayer?.hub_account_linked).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  const row = page.getByTestId('code-row').filter({ hasText: player.name });
  await expect(row.getByText('Hub account')).toBeVisible();
  await expect(page.getByTestId('code-row').getByText('Hub account')).toHaveCount(1);
});

test('share uses the Web Share API when present and copies the link otherwise', async ({
  page,
  request,
}) => {
  const name = `Codes Share ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  const [first] = Object.values(await secretsOf(request, id));
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  const expected = `${new URL(page.url()).origin}/tv/${id}?player_token=${encodeURIComponent(first.token)}`;

  // Clipboard fallback (desktop Chromium without navigator.share).
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }),
  );
  await page.getByRole('button', { name: `Share link: ${first.name}` }).click();
  await expect(page.getByText('Link copied')).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected);

  // Web Share.
  await page.evaluate(() => {
    (window as unknown as { shared: unknown[] }).shared = [];
    Object.defineProperty(navigator, 'share', {
      value: (data: unknown) => {
        (window as unknown as { shared: unknown[] }).shared.push(data);
        return Promise.resolve();
      },
      configurable: true,
    });
  });
  await page.getByRole('button', { name: `Share link: ${first.name}` }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { shared: { url: string }[] }).shared[0]?.url),
    )
    .toBe(expected);
});

test('regenerating one code or all codes changes the passphrases', async ({ page, request }) => {
  const name = `Codes Regen ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  const before = await secretsOf(request, id);
  const entries = Object.entries(before);
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.getByRole('button', { name: `Regenerate: ${entries[0][1].name}` }).click();
  await expect
    .poll(async () => (await secretsOf(request, id))[entries[0][0]].passphrase)
    .not.toBe(entries[0][1].passphrase);
  expect((await secretsOf(request, id))[entries[1][0]].passphrase).toBe(entries[1][1].passphrase);
  await expect(page.getByTestId('codes-list')).not.toContainText(entries[0][1].passphrase);

  await page.getByRole('button', { name: 'Regenerate all', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Regenerate all' }).click();
  await expect
    .poll(async () => (await secretsOf(request, id))[entries[1][0]].passphrase)
    .not.toBe(entries[1][1].passphrase);
});

test('print builds one sheet with every QR and passphrase', async ({ page, request }) => {
  const name = `Codes Print ${Date.now()}`;
  const { id } = await createTournament(request, 'gp', name);
  const secrets = Object.values(await secretsOf(request, id));
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      const w = window as unknown as { printed: number; sheet: string };
      w.printed += 1;
      w.sheet = document.querySelector('.codes-print')?.textContent ?? '';
    };
  });
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Players' }).click();
  await page.getByRole('button', { name: 'Print all codes' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
    .toBe(1);
  const sheet = page.getByTestId('codes-print');
  await expect(sheet.locator('.codes-print__card')).toHaveCount(secrets.length);
  await expect(sheet.locator('img')).toHaveCount(secrets.length);
  const text = await page.evaluate(() => (window as unknown as { sheet: string }).sheet);
  for (const s of secrets) expect(text).toContain(s.passphrase);
  // Everything else is hidden while printing, and the sheet is hidden on screen otherwise.
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.app-shell')).toBeHidden();
  await expect(sheet).toBeVisible();
});
