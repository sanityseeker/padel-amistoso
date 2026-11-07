import { test, expect, type Page } from '@playwright/test';

async function login(page: Page) {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments' })).toBeVisible();
}

test('authentication, persisted session, responsive navigation and logout', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('wrong-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('Invalid username or password')).toBeVisible();
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tournaments' })).toBeVisible();
  await expect(page.locator('.hero-banner, .stat-card, .mantine-AppShell-navbar')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Tournaments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.getByText('Log out', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('create a Mexicano, save scores, advance a round and filter tournaments', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'New Tournament', exact: true }).click();
  await page.getByRole('tab', { name: 'Mexicano + Play-offs' }).click();
  const dialog = page.locator('form');
  await dialog.getByLabel('Tournament name').fill('Browser Test Mexicano');
  await dialog
    .getByLabel(/^Players/)
    .fill('Ana\nCarlos\nLucia\nPablo\nMarta\nDiego\nElena\nJavier');
  await dialog.getByRole('button', { name: 'Create tournament', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser Test Mexicano' })).toBeVisible();
  await page.getByRole('button', { name: 'Start first round' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Record score', exact: true }).first().click();
  const scoreDialog = page.getByRole('dialog');
  await scoreDialog.getByRole('textbox').nth(0).fill('20');
  await scoreDialog.getByRole('textbox').nth(1).fill('12');
  await scoreDialog.getByRole('button', { name: 'Save score' }).click();
  await expect(scoreDialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Record score', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('textbox').nth(0).fill('18');
  await page.getByRole('dialog').getByRole('textbox').nth(1).fill('14');
  await page.getByRole('button', { name: 'Save score' }).click();
  await page.getByRole('button', { name: 'Next round' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Round 2 of 6', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Standings' }).click();
  await expect(page.getByRole('columnheader', { name: 'ELO' })).toBeVisible();
  await page.getByRole('link', { name: 'All tournaments' }).click();
  await page.getByLabel('Search tournaments').fill('does not exist');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.getByText('No tournaments found', { exact: true })).toBeVisible();
});

test('create a lobby, add a player, update fee and payment status', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'New Tournament', exact: true }).click();
  await page.getByRole('tab', { name: 'Lobby', exact: true }).click();
  await page.getByLabel('Event name').fill('Browser Test Social');
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser Test Social' })).toBeVisible();
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  await page.getByLabel('Player name').fill('Sample Player');
  await page.getByRole('dialog').getByRole('button', { name: 'Add player', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Sample Player' })).toBeVisible();
  await page.getByRole('tab', { name: 'Payments' }).click();
  await page.getByRole('button', { name: 'Payment settings' }).click();
  await page.getByLabel('Fee per player (EUR)').fill('15');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('combobox', { name: 'Payment status for Sample Player' }).click();
  await page.getByRole('option', { name: 'paid', exact: true }).click();
  await expect(page.getByRole('heading', { name: /15.*collected/ })).toBeVisible();
  await page.getByRole('button', { name: 'Close registration' }).click();
  await expect(page.getByRole('button', { name: 'Reopen registration' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Public sign-up' })).toHaveAttribute(
    'href',
    /\/register\/rg_/,
  );
});

test('create a community, club, season and organizer account', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'Clubs & communities' }).click();
  await page.getByRole('button', { name: 'New community' }).click();
  await page.getByRole('dialog').getByLabel(/^Name/).fill('Browser Test Community');
  await page.getByRole('button', { name: 'Create community', exact: true }).click();
  await expect(
    page.getByRole('cell', { name: 'Browser Test Community', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create club', exact: true }).click();
  await page.getByRole('dialog').getByLabel(/^Name/).fill('Browser Test Club');
  await page
    .getByRole('dialog')
    .getByLabel(/^Community/)
    .click();
  await page.getByRole('option', { name: 'Browser Test Community' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Create club' }).click();
  await page.getByRole('button', { name: 'Manage club' }).click();
  await page.getByLabel('New season').fill('Autumn League');
  await page.getByRole('button', { name: 'Add season' }).click();
  await expect(page.getByText('Autumn League', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await page.getByRole('button', { name: 'Add user' }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Username/)
    .fill('browser-organizer');
  await page.getByLabel('Temporary password').fill('organizer-test-2026');
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'browser-organizer' })).toBeVisible();
});
