import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Compare against the actual legacy source, so future palette drift is caught
// without repeating the React implementation as expected values.
const source = readFileSync(resolve(process.cwd(), '../theme.css'), 'utf8');
function legacy(mode: 'light' | 'dark', name: string) {
  const block = source.match(
    mode === 'light' ? /:root\s*\{([\s\S]*?)\n\}/ : /html\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/,
  )?.[1];
  const value = block?.match(new RegExp(`--color-${name}:\\s*([^;]+);`))?.[1].trim();
  if (!value) throw new Error(`Legacy color missing: ${mode}/${name}`);
  return value;
}

test('React surfaces and semantic tokens match the legacy light and dark palettes', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/events');
  await page.getByRole('tab', { name: /^Live/ }).waitFor();
  for (const mode of ['light', 'dark'] as const) {
    if (mode === 'dark') await page.getByRole('button', { name: 'Switch to dark mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', mode);
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    const tokens = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          'bg',
          'surface',
          'surface-2',
          'border',
          'text',
          'muted',
          'primary',
          'primary-hover',
          'primary-active',
          'success',
          'warning',
          'error',
          'tennis',
          'gold',
        ].map((key) => [key, css.getPropertyValue(`--app-${key}`).trim()]),
      );
    });
    for (const [app, original] of Object.entries({
      bg: 'bg',
      surface: 'surface',
      'surface-2': 'surface-2',
      border: 'border',
      text: 'text',
      muted: 'text-muted',
      primary: 'primary',
      'primary-hover': 'primary-hover',
      'primary-active': 'primary-active',
      success: 'success',
      warning: 'warning',
      error: 'error',
      tennis: 'sport-tennis',
      gold: 'yellow',
    })) {
      expect(tokens[app]).toBe(legacy(mode, original));
    }
    const rgb = (hex: string) =>
      `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    await expect(page.locator('body')).toHaveCSS('background-color', rgb(legacy(mode, 'bg')));
    await expect(page.locator('.compact-event-row').first()).toHaveCSS(
      'background-color',
      rgb(legacy(mode, 'surface')),
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.mouse.move(0, 0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBeTruthy();
});

test('theme selection persists across React and legacy pages', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/events');
  await page.getByRole('button', { name: 'Switch to dark mode' }).click();
  expect(await page.evaluate(() => localStorage.getItem('amistoso-theme'))).toBe('dark');
  for (const route of ['/admin', '/player']) {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
    await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  }
  await page.goto('/legacy-events', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.goto('/events');
  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
});

test('older saved theme is migrated and an unset preference follows the OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript(() => {
    if (!localStorage.getItem('amistoso-theme')) localStorage.setItem('padel-theme', 'dark');
  });
  await page.goto('/events');
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('padel-theme'))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem('amistoso-theme'))).toBe('dark');
});

test('system dark mode is used without a saved theme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/events');
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
});
