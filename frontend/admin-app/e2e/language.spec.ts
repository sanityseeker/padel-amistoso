import { test, expect } from '@playwright/test';
import { chooseLanguage, fillNames } from './helpers';

test('language selector changes events immediately and preserves filters', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('tab', { name: /^Live/ }).waitFor();
  await page
    .getByRole('radiogroup', { name: 'Sport' })
    .getByText('Tennis', { exact: true })
    .click();
  await chooseLanguage(page, 'Español');
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Tenis', exact: true })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  expect(await page.evaluate(() => localStorage.getItem('amistoso-lang'))).toBe('es');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBeTruthy();
  await chooseLanguage(page, 'English');
  await expect(page.getByRole('tab', { name: /^Live/ })).toBeVisible();
});

test('language survives navigation and login fields are not reset', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await chooseLanguage(page, 'Español');
  await expect(page.getByRole('heading', { name: 'Hola de nuevo' })).toBeVisible();
  await expect(page.getByLabel('Nombre de usuario', { exact: false })).toHaveValue('admin');
  await page.goto('/player');
  await expect(page.getByRole('heading', { name: 'Área del jugador' })).toBeVisible();
  await page.goto('/events');
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  await chooseLanguage(page, 'English');
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('Spanish tournament creation sends unchanged API enums', async ({ page }) => {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  await chooseLanguage(page, 'Español');
  await expect(page.getByRole('heading', { name: 'Torneos', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Nuevo', exact: true }).click();
  await page.getByRole('radio', { name: /Mexicano/ }).click();
  // Changing the format remounts the form, so wait for it before typing into it.
  await expect(page).toHaveURL(/type=mexicano/);
  const dialog = page.locator('form#tournament-form');
  await dialog.getByRole('textbox').nth(0).fill('Spanish Browser Tournament');
  await fillNames(page, 'players', 'Ana\nCarlos\nLucia\nPablo');
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
  await chooseLanguage(page, 'English');
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
  await chooseLanguage(page, 'English');
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
});

test('the Display popover fits a 360 px phone and works in Spanish', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/events');
  await page.evaluate(() => localStorage.setItem('amistoso-lang', 'es'));
  await page.reload();
  await page.getByRole('button', { name: /^Preferencias:/ }).click();
  const panel = page.getByTestId('display-panel');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(360);
  await expect(page.getByRole('radiogroup', { name: 'Idioma' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Tema' })).toBeVisible();
  await page
    .getByRole('radiogroup', { name: 'Tema' })
    .locator('label')
    .filter({ hasText: 'Oscuro' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await page
    .getByRole('radiogroup', { name: 'Idioma' })
    .locator('label')
    .filter({ hasText: 'English' })
    .click();
  await expect(page.getByRole('radiogroup', { name: 'Language' })).toBeVisible();
});

test('a stored Russian choice is applied and kept', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('amistoso-lang', 'ru');
    }
  });
  await page.goto('/events');
  await page.getByRole('tab', { name: /^Идёт/ }).waitFor();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  expect(await page.evaluate(() => localStorage.getItem('amistoso-lang'))).toBe('ru');
  await page.reload();
  await page.getByRole('tab', { name: /^Идёт/ }).waitFor();
  expect(await page.evaluate(() => localStorage.getItem('amistoso-lang'))).toBe('ru');
});

test('a failed Russian bundle shows English and keeps the stored choice', async ({ page }) => {
  await page.route('**/admin-assets/ru-*.js', (route) => route.abort());
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('amistoso-lang', 'ru');
    }
  });
  await page.goto('/events');
  await page.getByRole('tab', { name: /^Live/ }).waitFor();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => localStorage.getItem('amistoso-lang'))).toBe('ru');
});

test('Russian is selectable, stays after reload and fits a phone', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('tab', { name: /^Live/ }).waitFor();
  await chooseLanguage(page, 'Русский');
  await expect(page.getByRole('tab', { name: /^Идёт/ })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ru');
  expect(await page.evaluate(() => localStorage.getItem('amistoso-lang'))).toBe('ru');
  await page.reload();
  await expect(page.getByRole('tab', { name: /^Идёт/ })).toBeVisible();
  for (const width of [390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBeTruthy();
  }
  await chooseLanguage(page, 'English');
  await expect(page.getByRole('tab', { name: /^Live/ })).toBeVisible();
});

test('Russian admin navigation fits a 360 px phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  await chooseLanguage(page, 'Русский');
  await expect(page.getByRole('heading', { name: 'Турниры', exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBeTruthy();
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('nav a, nav button')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent),
  );
  expect(clipped).toEqual([]);
  await chooseLanguage(page, 'English');
});

test('a stored Spanish choice paints Spanish first, with its texts preloaded by the page', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('amistoso-lang', 'es');
    const w = window as unknown as { __firstPaint: string | null };
    w.__firstPaint = null;
    new MutationObserver((_records, observer) => {
      const root = document.getElementById('root');
      if (root && root.childElementCount > 0) {
        w.__firstPaint = root.textContent ?? '';
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('/events');
  await expect(page.getByRole('tab', { name: /^En directo/ })).toBeVisible();
  const first = await page.evaluate(
    () => (window as unknown as { __firstPaint: string | null }).__firstPaint,
  );
  expect(first).toContain('Eventos');
  expect(first).not.toContain('Player Hub');
  // The server-injected script preloads the Spanish chunk next to the entry chunk.
  await expect(page.locator('link[rel="modulepreload"][href*="/es-"]')).toHaveCount(1);
  await expect(page.locator('link[rel="modulepreload"][href*="/ru-"]')).toHaveCount(0);
});
