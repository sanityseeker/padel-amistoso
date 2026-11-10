import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminHeaders, chooseLanguage, expectFooter } from './helpers';

const stamp = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function lobby(request: APIRequestContext, extra: Record<string, unknown> = {}) {
  const headers = await adminHeaders(request);
  const name = `Sign-up ${stamp()}`;
  const created = await request.post('/api/registrations', {
    headers,
    data: {
      name,
      auto_send_email: false,
      description: '**Welcome** to the cup.',
      questions: [
        {
          key: 'level',
          label: 'Level',
          required: true,
          type: 'choice',
          choices: ['Beginner', 'Advanced'],
        },
        {
          key: 'notes',
          label: 'Anything we should know',
          required: false,
          type: 'text',
          choices: [],
        },
      ],
      ...extra,
    },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id as string;
  const alias = `join-${stamp()}`;
  expect(
    (await request.put(`/api/registrations/${id}/alias`, { headers, data: { alias } })).ok(),
  ).toBeTruthy();
  return { id, alias, name, headers };
}

async function signUp(page: import('@playwright/test').Page, who: string, level = 'Advanced') {
  await page.getByRole('textbox', { name: /^Your name/ }).fill(who);
  await page.getByRole('combobox', { name: /^Level/ }).click();
  await page.getByRole('option', { name: level }).click();
  await page.getByRole('button', { name: 'Register', exact: true }).click();
}

test('a full sign-up: form, passphrase, edit the answers, withdraw, and come back with the passphrase', async ({
  page,
  request,
}) => {
  const { alias, name, id, headers } = await lobby(request, { join_code: 'open-sesame' });
  await page.goto(`/register/${alias}`);
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(page.getByText('Welcome', { exact: true })).toHaveJSProperty('tagName', 'STRONG');
  await expectFooter(page);
  // The join code and the required question are enforced before anything is sent.
  await page.getByRole('textbox', { name: /^Your name/ }).fill('Lola Test');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByTestId('register-error')).toContainText('Join code is required');
  await page.getByLabel(/^Join code/).fill('wrong-code');
  await signUp(page, 'Lola Test');
  await expect(page.getByTestId('register-error')).toBeVisible();
  await page.getByLabel(/^Join code/).fill('open-sesame');
  await page.getByRole('button', { name: 'Register', exact: true }).click();
  await expect(page.getByRole('heading', { name: "You're registered, Lola Test!" })).toBeVisible();
  const passphrase = (await page.getByTestId('entry-passphrase').textContent())!.trim();
  expect(passphrase.split('-').length).toBeGreaterThanOrEqual(3);
  const stored = await (await request.get(`/api/registrations/${id}`, { headers })).json();
  expect(stored.registrants[0]).toMatchObject({
    player_name: 'Lola Test',
    answers: { level: 'Advanced' },
  });
  // The QR code of the entry link.
  await page.getByRole('button', { name: 'QR code' }).click();
  await expect(page.getByTestId('qr-image')).toBeVisible();
  await page.keyboard.press('Escape');
  // Edit the answers.
  await page.getByRole('button', { name: 'Edit answers' }).click();
  await page.getByLabel(/^Anything we should know/).fill('Left-handed');
  await page.getByRole('button', { name: 'Save answers' }).click();
  await expect
    .poll(async () => {
      const lobbyNow = await (await request.get(`/api/registrations/${id}`, { headers })).json();
      return lobbyNow.registrants[0].answers.notes;
    })
    .toBe('Left-handed');
  // Withdraw (with a confirmation), then come back with the passphrase.
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('button', { name: 'Keep my spot' }).click();
  await expect(page.getByRole('button', { name: 'Yes, withdraw' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Withdraw', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, withdraw' }).click();
  await expect(page.getByRole('textbox', { name: /^Your name/ })).toBeVisible();
  const emptied = await (await request.get(`/api/registrations/${id}`, { headers })).json();
  expect(emptied.registrants).toHaveLength(0);
  await page.getByLabel(/^Join code/).fill('open-sesame');
  await signUp(page, 'Lola Test');
  await expect(page.getByRole('heading', { name: "You're registered, Lola Test!" })).toBeVisible();
  const again = (await page.getByTestId('entry-passphrase').textContent())!.trim();
  await page.evaluate(() => localStorage.clear());
  await page.goto(`/register/${alias}`);
  await page.getByRole('button', { name: /Returning\? Log in to autofill or edit/ }).click();
  await page.getByLabel(/^Your passphrase/).fill('wrong-wrong-wrong');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('Passphrase not found')).toBeVisible();
  await page.getByLabel(/^Your passphrase/).fill(again);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: "You're registered, Lola Test!" })).toBeVisible();
});

test('a taken name points to recovery, and the recovery options answer', async ({
  page,
  request,
}) => {
  const { alias, id, headers } = await lobby(request);
  expect(
    (
      await request.post(`/api/registrations/${id}/registrant`, {
        headers,
        data: { player_name: 'Ana Taken', email: '', answers: { level: 'Beginner' } },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/register/${alias}`);
  await signUp(page, 'Ana Taken');
  await expect(page.getByTestId('register-error')).toContainText('already registered');
  // The recovery section opened by itself.
  await page.getByRole('tab', { name: 'Find me by email' }).click();
  await page
    .getByLabel(/^Email/)
    .first()
    .fill('someone@example.com');
  await page.getByRole('button', { name: 'Email me a login link' }).click();
  await expect(page.getByText(/we've sent a login link/)).toBeVisible();
  await page.getByRole('tab', { name: /find me by name/ }).click();
  await page.getByLabel('Your name').first().fill('Zzyzx Nobody');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('No matching past registrations found')).toBeVisible();
});

test('a closed registration says so, and an unknown one leads to the not-found page', async ({
  page,
  request,
}) => {
  const { alias, id, headers } = await lobby(request);
  expect(
    (await request.patch(`/api/registrations/${id}`, { headers, data: { open: false } })).ok(),
  ).toBeTruthy();
  await page.goto(`/register/${alias}`);
  await expect(page.getByText('Registration is closed.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: /^Your name/ })).toHaveCount(0);
  await page.goto('/register/not-a-lobby-xyz');
  await expect(page).toHaveURL(/\/404\?/);
  await expect(page.getByTestId('not-found-reason')).toContainText('Registration data not found');
});

test('the entry fee and payment report', async ({ page, request }) => {
  const { alias, id, headers } = await lobby(request);
  const fee = await request.patch(`/api/registrations/${id}/payment-settings`, {
    headers,
    data: {
      fee_cents: 1500,
      currency: 'EUR',
      instructions: 'Pay before the first match',
      methods: [{ kind: 'iban', label: null, value: 'ES00 1234' }],
      show_methods: 'always',
    },
  });
  expect(fee.ok()).toBeTruthy();
  await page.goto(`/register/${alias}`);
  await expect(page.getByTestId('fee-notice')).toContainText('15');
  await signUp(page, 'Pay Player');
  const panel = page.getByTestId('payment-panel');
  await expect(panel).toContainText('Pay before the first match');
  await panel.getByPlaceholder('Reference or note (optional)').fill('bank ref 77');
  await panel.getByRole('button', { name: "I've paid" }).click();
  await expect(panel.getByText('Reported — waiting for the organizer to confirm.')).toBeVisible();
});

test('the sign-up page works in Spanish and on a phone', async ({ page, request }) => {
  const { alias } = await lobby(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/register/${alias}`);
  await chooseLanguage(page, 'Español');
  await expect(page.getByRole('button', { name: 'Registrarse', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
