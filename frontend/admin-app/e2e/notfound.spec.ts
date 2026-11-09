import { test, expect } from '@playwright/test';
import { expectFooter } from './helpers';

test('an unknown address is a 404 page with the illustration, a way home, and the footer', async ({
  page,
  request,
}) => {
  expect((await request.get('/definitely/not/a/page')).status()).toBe(404);
  const response = await page.goto('/definitely/not/a/page');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByAltText('404: page not found')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go home now' })).toBeVisible();
  // The server named home, so the page counts down.
  await expect(page.getByRole('status')).toContainText(/Redirecting in \d seconds/);
  await expectFooter(page);
});

test('a reason and a same-site target are shown, and an off-site target is ignored', async ({
  page,
}) => {
  await page.goto('/404?m=Gone%20fishing&to=//evil.example.com/');
  await expect(page.getByTestId('not-found-reason')).toHaveText('Gone fishing');
  await expect(page.getByRole('link', { name: 'Go home now' })).not.toHaveAttribute(
    'href',
    /evil\.example\.com/,
  );
});
