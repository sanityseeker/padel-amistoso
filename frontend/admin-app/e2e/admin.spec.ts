import { test, expect, type Page } from '@playwright/test';
import { logoutAdmin, fillNames } from './helpers';

async function login(page: Page) {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
}

test('authentication, persisted session, responsive navigation and logout', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('wrong-password');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByText('Invalid username or password')).toBeVisible();
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: 'Tournaments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await logoutAdmin(page);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('create a Mexicano, save scores, advance a round and filter tournaments', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'New', exact: true }).click();
  await page.getByRole('radio', { name: 'Mexicano + Play-offs' }).click();
  // The format lives in the URL and the form remounts when it changes: type only once it has switched,
  // or the remount drops the name and the tournament gets the default one.
  await expect(page.getByRole('radio', { name: 'Mexicano + Play-offs' })).toBeChecked();
  const dialog = page.locator('form#tournament-form');
  await dialog.getByLabel('Tournament name').fill('Browser Test Mexicano');
  await fillNames(page, 'players', 'Ana\nCarlos\nLucia\nPablo\nMarta\nDiego\nElena\nJavier');
  await dialog.getByRole('button', { name: 'Create tournament', exact: true }).click();
  // The workspace loads several requests after the redirect; a busy CI runner needs more than 5 s.
  await expect(page).toHaveURL(/\/admin\/t\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Browser Test Mexicano' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Start first round' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page
    .getByRole('button', { name: /^(Record score|More scoring options)/ })
    .first()
    .click();
  // Desktop scoring is inline in the match row; phones get a sheet. Both carry this test id.
  const scoreDialog = page.getByTestId('score-sheet');
  await scoreDialog.getByRole('textbox').nth(0).fill('20');
  await scoreDialog.getByRole('textbox').nth(1).fill('12');
  await scoreDialog.getByRole('button', { name: 'Save score' }).click();
  await expect(scoreDialog).not.toBeVisible();
  await page
    .getByRole('button', { name: /^(Record score|More scoring options)/ })
    .first()
    .click();
  await page.getByTestId('score-sheet').getByRole('textbox').nth(0).fill('18');
  await page.getByTestId('score-sheet').getByRole('textbox').nth(1).fill('14');
  await page.getByRole('button', { name: 'Save score' }).click();
  await page.getByRole('button', { name: 'Next round' }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByText('Round 2 of 6', { exact: true })).toBeVisible();
  // ELO is a low-priority column: it shows when the table has room (a full-width tab on a tablet).
  await page.setViewportSize({ width: 820, height: 900 });
  await page.getByRole('tab', { name: 'Standings' }).click();
  await expect(page.getByRole('columnheader', { name: 'ELO' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Administration' })
    .getByRole('link', { name: 'Tournaments', exact: true })
    .click();
  await page.getByLabel('Search tournaments').fill('does not exist');
  await expect(page.getByText('No tournaments found', { exact: true })).toBeVisible();
});

test('create a lobby, add a player, update fee and payment status', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'New', exact: true }).click();
  await page.getByRole('radio', { name: 'Lobby', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Lobby', exact: true })).toBeChecked();
  await page.getByLabel('Event name').fill('Browser Test Social');
  await page.getByRole('button', { name: 'Create lobby', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Browser Test Social' })).toBeVisible();
  await page.getByRole('button', { name: 'Add player', exact: true }).click();
  await page.getByLabel('Player name').fill('Sample Player');
  await page.getByRole('dialog').getByRole('button', { name: 'Add player', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Sample Player', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Payments' }).click();
  await page.getByRole('button', { name: 'Payment settings' }).click();
  await page.getByLabel('Fee per player (EUR)').fill('15');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await page.getByRole('button', { name: 'Mark paid', exact: true }).click();
  await page.getByRole('dialog').getByText('Cash', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Mark paid', exact: true }).click();
  await expect(page.getByText(/15.*/).first()).toBeVisible();
  await expect(page.getByTestId('stat-collected')).toContainText('15');
  // Close / Reopen and Archive live in the header's "More actions" menu.
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Close registration' }).click();
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Reopen registration' })).toBeVisible();
  await page.keyboard.press('Escape');
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
  await page.getByRole('link', { name: 'Manage club' }).first().click();
  await page.getByRole('tab', { name: 'Seasons' }).click();
  await page.getByLabel('New season').fill('Autumn League');
  await page.getByRole('button', { name: 'Add season' }).click();
  await expect(page.getByText('Autumn League', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await page.getByRole('button', { name: 'Add user' }).click();
  await page
    .getByRole('dialog')
    .getByLabel(/^Username/)
    .fill('browser-organizer');
  await page.getByLabel('Temporary password').fill('organizer-test-2026');
  await page.getByRole('button', { name: 'Create user', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'browser-organizer', exact: true })).toBeVisible();
});

test('players and courts are a list by default and can be typed as text', async ({ page }) => {
  await login(page);
  await page.getByRole('link', { name: 'New', exact: true }).click();
  await page.getByRole('radio', { name: 'Mexicano + Play-offs' }).click();
  // Changing the format remounts the form, so wait for it before typing into it.
  await expect(page).toHaveURL(/type=mexicano/);
  const form = page.locator('form#tournament-form');
  const name = (n: string) => form.getByRole('textbox', { name: n, exact: true });
  await name('Player 1').fill('Ana');
  await form.getByRole('button', { name: 'Add player' }).click();
  await name('Player 2').fill('Bea');
  await form.getByRole('button', { name: 'Add player' }).click();
  await name('Player 3').fill('Cleo');
  await form
    .locator('label', { hasText: /^Text$/ })
    .first()
    .click();
  await expect(form.getByLabel('Players', { exact: true })).toHaveValue('Ana\nBea\nCleo');
  await form.getByLabel('Players', { exact: true }).fill('Ana\nBea\nCleo\nDana');
  await form
    .locator('label', { hasText: /^List$/ })
    .first()
    .click();
  await expect(name('Player 4')).toHaveValue('Dana');
  await expect(name('Court 2')).toHaveValue('Court 2');
  await form.getByRole('button', { name: 'Add court' }).click();
  await name('Court 3').fill('Centre');
  await form
    .locator('label', { hasText: /^Text$/ })
    .last()
    .click();
  await expect(form.getByLabel('Courts', { exact: true })).toHaveValue('Court 1\nCourt 2\nCentre');
});
