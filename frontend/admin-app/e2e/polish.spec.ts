import { test, expect } from '@playwright/test';
import { adminHeaders, expectFooter, loginAdmin } from './helpers';

test('convert to tournament opens /admin/new?from=<lobby> with the lobby players preselected', async ({
  page,
  request,
}) => {
  const headers = await adminHeaders(request);
  const lobby = await (
    await request.post('/api/registrations', {
      headers,
      data: { name: `Convert source ${Date.now()}`, auto_send_email: false },
    })
  ).json();
  const names = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena'];
  for (const name of names)
    expect(
      (
        await request.post(`/api/registrations/${lobby.id}/registrant`, {
          headers,
          data: { player_name: name, email: '', answers: {} },
        })
      ).ok(),
    ).toBeTruthy();
  await loginAdmin(page);
  await page.goto(`/admin/lobby/${lobby.id}`);
  await page.getByRole('button', { name: 'Convert to tournament' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/new\\?from=${lobby.id}(&|$)`));
  await expect(page.getByRole('heading', { name: 'Convert to tournament' }).first()).toBeVisible();
  const list = page.getByTestId('convert-registrants');
  for (const name of names) await expect(list.getByRole('checkbox', { name })).toBeChecked();
  await expect(page.getByText('5 of 5 selected')).toBeVisible();
});

test('state badges are plain text pills: no dot variant anywhere', async ({ page }) => {
  await page.goto('/events');
  await expect(page.getByTestId('public-event').first())
    .toBeVisible()
    .catch(() => undefined);
  expect(await page.locator('[data-variant="dot"]').count()).toBe(0);
  await loginAdmin(page);
  expect(await page.locator('[data-variant="dot"]').count()).toBe(0);
});

test('the Ko-fi and GitHub pills sit side by side at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/events');
  await expectFooter(page);
  const coffee = page.getByRole('link', { name: /Buy me a coffee/ });
  const github = page.getByRole('link', { name: /Contribute on GitHub/ });
  const a = (await coffee.boundingBox())!;
  const b = (await github.boundingBox())!;
  expect(Math.abs(a.y - b.y)).toBeLessThan(4);
  expect(a.height).toBeLessThan(40);
  expect(b.x + b.width).toBeLessThanOrEqual(360);
});
