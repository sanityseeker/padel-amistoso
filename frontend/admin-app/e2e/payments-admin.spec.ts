import { test, expect } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin } from './helpers';

const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

test('the Payments tab appears once a fee is set and leads from Settings', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `PayTab ${stamp()}`);
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByRole('tab', { name: 'Players', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Payments', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Tournament settings' });
  await drawer.getByRole('tab', { name: 'Payments', exact: true }).click();
  await expect(drawer.getByRole('button', { name: 'Open payments' })).toHaveCount(0);
  await drawer.getByLabel(/^Fee per player/).fill('12');
  await drawer.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Payment settings saved')).toBeVisible();
  await drawer.getByRole('button', { name: 'Open payments' }).click();
  await expect(drawer).toBeHidden();
  const tab = page.getByRole('tab', { name: 'Payments', exact: true });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(/view=payments/);

  // Mark paid updates the collected total.
  await expect(page.getByTestId('stat-collected')).toContainText('0');
  await page.getByRole('button', { name: 'Mark paid', exact: true }).first().click();
  await page.getByRole('dialog').getByText('Cash', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(page.getByTestId('stat-collected')).toContainText('12');

  // A reload with the deep link lands on the tab.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Payments', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId('stat-collected')).toBeVisible();
});

test('a user without access to a tournament sees no Payments tab and requests no payments', async ({
  page,
  request,
}) => {
  const { id, headers } = await createTournament(request, 'mex', `PayHidden ${stamp()}`);
  const fee = await request.patch(`/api/tournaments/${id}/payment-settings`, {
    headers,
    data: { fee_cents: 1000 },
  });
  expect(fee.ok()).toBeTruthy();
  const username = `viewer-${stamp()}`;
  const password = 'organizer-test-2026';
  const created = await request.post('/api/auth/users', {
    headers: await adminHeaders(request),
    data: { username, password, role: 'user' },
  });
  expect(created.ok()).toBeTruthy();
  const requested: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/payments')) requested.push(r.url());
  });
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill(username);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  await page.goto(`/admin/t/${id}?view=payments`);
  await expect(page.getByText('Tournament not found')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Payments', exact: true })).toHaveCount(0);
  expect(requested).toEqual([]);
});
