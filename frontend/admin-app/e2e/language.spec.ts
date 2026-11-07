import { test, expect } from '@playwright/test';

test('language selector changes events immediately and preserves filters', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('combobox', { name: 'Language', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Tennis', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('es');
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tenis', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  expect(await page.evaluate(() => localStorage.getItem('amistoso-lang'))).toBe('es');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBeTruthy();
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await expect(page.getByRole('tab', { name: /^Live/ })).toBeVisible();
});

test('language survives navigation and login fields are not reset', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('es');
  await expect(page.getByRole('heading', { name: 'Hola de nuevo' })).toBeVisible();
  await expect(page.getByLabel('Nombre de usuario', { exact: false })).toHaveValue('admin');
  await page.goto('/player');
  await expect(page.getByRole('heading', { name: 'Espacio del jugador' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Idioma', exact: true })).toHaveValue('es');
  await page.goto('/events');
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('Spanish tournament creation sends unchanged API enums', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('es');
  await expect(page.getByRole('heading', { name: 'Torneos' })).toBeVisible();
  await page.getByRole('link', { name: 'Nuevo torneo', exact: true }).click();
  await page.getByRole('tab', { name: /Mexicano/ }).click();
  const dialog = page.locator('form');
  await dialog.getByRole('textbox').nth(0).fill('Spanish Browser Tournament');
  await dialog.getByLabel(/^Jugadores/).fill('Ana\nCarlos\nLucia\nPablo');
  const responsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/tournaments/mexicano') &&
      response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: /Crear Torneo/i, exact: true }).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const body = response.request().postDataJSON();
  expect(body.sport).toBe('padel');
  expect(body.community_id).toBe('open');
  expect(body.name).toBe('Spanish Browser Tournament');
  await expect(
    page.getByRole('heading', { name: 'Spanish Browser Tournament', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iniciar primera ronda' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await expect(page.getByRole('button', { name: 'Start first round' })).toBeVisible();
});

test('older language preference migrates without changing user theme', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('amistoso-lang')) localStorage.setItem('padel-lang', 'es');
    localStorage.setItem('amistoso-theme', 'dark');
  });
  await page.goto('/events');
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('padel-lang'))).toBeNull();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
});
