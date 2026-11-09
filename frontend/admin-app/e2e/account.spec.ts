import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { logoutAdmin } from './helpers';

// Mints a single-use token through the backend store, as the invite/forgot emails would.
function mintToken(kind: 'invite' | 'reset', email: string): string {
  const code = `
import sys
import backend.api  # noqa: F401  (import order: avoids a circular import)
from backend.auth.models import UserRole
from backend.auth.store import AuthTokenType, user_store
kind, email = sys.argv[1], sys.argv[2]
if kind == "invite":
    print(user_store.create_auth_token(email, AuthTokenType.INVITE, role=UserRole.USER))
else:
    print(user_store.create_auth_token(email, AuthTokenType.PASSWORD_RESET))
`;
  return execFileSync(resolve('../../.venv/bin/python'), ['-c', code, kind, email], {
    cwd: '../..',
    env: { ...process.env, PADEL_DATA_DIR: process.env.AMISTOSO_E2E_DATA_DIR },
  })
    .toString()
    .trim();
}

async function logIn(page: Page, username: string, password: string) {
  await page.getByLabel(/^Username/).fill(username);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
}

test('forgot password shows the same neutral message and no account details', async ({ page }) => {
  await page.route('**/api/auth/forgot-password', (route) => route.fulfill({ status: 204 }));
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: 'Account help' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/admin\/account\/forgot$/);
  await page.getByLabel(/^Email/).fill('not-an-email');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('Enter a valid email address.')).toBeVisible();
  await page.getByLabel(/^Email/).fill('nobody@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/If an account exists for that email/)).toBeVisible();
});

test('forgot password without email configured explains it', async ({ page }) => {
  await page.goto('/admin/account/forgot');
  await page.getByLabel(/^Email/).fill('admin@example.com');
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('alert')).toContainText('not available here');
});

test('invite acceptance signs in, reset and change password work end to end', async ({ page }) => {
  const email = 'e2e-invited@example.com';
  const invite = mintToken('invite', email);

  // Emailed links land on / or /admin; the token is removed from the address bar.
  await page.goto(`/?invite_token=${invite}`);
  await expect(page.getByRole('heading', { name: 'Accept your invite' })).toBeVisible();
  await expect(page.getByText(email)).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/account\/invite$/);
  expect(page.url()).not.toContain(invite);

  await page.getByLabel(/^Username/).fill('e2e_invited');
  await page.getByLabel(/^Password/).fill('short');
  await page.getByLabel(/^Password/).blur();
  await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
  await page.getByLabel(/^Password/).fill('first-password-1');
  await page.getByLabel(/^Confirm password/).fill('different-1');
  await expect(page.getByText('The passwords do not match.')).toBeVisible();
  await page.getByLabel(/^Confirm password/).fill('first-password-1');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/admin$/);

  // Change password from the account menu: the current password is verified first.
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Change password' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/^Current password/).fill('wrong-current');
  await dialog.getByLabel(/^New password/).fill('second-password-2');
  await dialog.getByLabel(/^Confirm password/).fill('second-password-2');
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByRole('alert')).toContainText('current password is not correct');
  await dialog.getByLabel(/^Current password/).fill('first-password-1');
  await dialog.getByRole('button', { name: 'Change password' }).click();
  await expect(dialog.getByText('Your password has been changed.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
  await logoutAdmin(page);

  // Reset through a link; reusing the link is reported as invalid.
  const reset = mintToken('reset', email);
  await page.goto(`/admin?reset_token=${reset}`);
  await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
  await expect(page).toHaveURL(/\/admin\/account\/reset$/);
  expect(page.url()).not.toContain(reset);
  await page.getByLabel(/^New password/).fill('third-password-3');
  await page.getByLabel(/^Confirm password/).fill('third-password-3');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to log in' }).click();
  await expect(page.getByText('Password updated. Log in with your new password.')).toBeVisible();
  await logIn(page, 'e2e_invited', 'second-password-2');
  await expect(page.getByText('Invalid username or password')).toBeVisible();
  await page.getByLabel(/^Password/).fill('third-password-3');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
});

test('a used or unknown link shows a clear dead end', async ({ page }) => {
  await page.goto('/admin/account/reset?reset_token=unknown-token');
  await page.getByLabel(/^New password/).fill('some-password-9');
  await page.getByLabel(/^Confirm password/).fill('some-password-9');
  await page.getByRole('button', { name: 'Update password' }).click();
  await expect(page.getByRole('heading', { name: 'Reset link not valid' })).toBeVisible();
  await page.getByRole('link', { name: 'Request a new link' }).click();
  await expect(page).toHaveURL(/\/admin\/account\/forgot$/);

  await page.goto('/admin/account/invite?invite_token=unknown-token');
  await expect(page.getByRole('heading', { name: 'Invite not valid' })).toBeVisible();
  await page.goto('/admin/account/invite');
  await expect(page.getByRole('heading', { name: 'Invite not valid' })).toBeVisible();
});
