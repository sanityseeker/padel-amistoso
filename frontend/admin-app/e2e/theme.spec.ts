import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { chooseSize, chooseTheme, createTournament, loginAdmin, openDisplay } from './helpers';
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
  await page.goto('/admin');
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  for (const mode of ['light', 'dark'] as const) {
    if (mode === 'dark') await chooseTheme(page, 'Dark');
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
    await expect(page.locator('.login-card')).toHaveCSS(
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

test('theme selection persists across Events, Admin and the Player Hub', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/events');
  await chooseTheme(page, 'Dark');
  expect(await page.evaluate(() => localStorage.getItem('amistoso-theme'))).toBe('dark');
  for (const route of ['/admin', '/player']) {
    await page.goto(route);
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  }
  await page.goto('/events');
  await chooseTheme(page, 'Light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
});

test('interface size scales the page, survives a reload and clears at Normal', async ({ page }) => {
  const rootSize = () =>
    page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.goto('/events');
  expect(await rootSize()).toBeCloseTo(15.2);
  expect(await page.evaluate(() => localStorage.getItem('amistoso-ui-scale'))).toBeNull();
  await chooseSize(page, 'Small');
  expect(await rootSize()).toBeCloseTo(13.6);
  await page.reload();
  expect(await rootSize()).toBeCloseTo(13.6);
  await chooseSize(page, 'Large');
  expect(await rootSize()).toBeCloseTo(17.6);
  expect(await page.evaluate(() => localStorage.getItem('amistoso-ui-scale'))).toBe('110');
  await chooseSize(page, 'Normal');
  expect(await rootSize()).toBeCloseTo(15.2);
  expect(await page.evaluate(() => localStorage.getItem('amistoso-ui-scale'))).toBeNull();
});

for (const [stored, migrated, expected] of [
  ['90', '85', 13.6],
  ['100', '95', 15.2],
  ['110', '110', 17.6],
] as const) {
  test(`saved interface size ${stored} migrates to ${migrated}`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('amistoso-ui-scale', value), stored);
    await page.goto('/events');
    await expect
      .poll(() =>
        page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
      )
      .toBeCloseTo(expected);
    expect(await page.evaluate(() => localStorage.getItem('amistoso-ui-scale'))).toBe(migrated);
    await openDisplay(page);
    await expect(
      page.getByRole('radio', {
        name: migrated === '85' ? 'Small' : migrated === '95' ? 'Normal' : 'Large',
      }),
    ).toBeChecked();
  });
}

test('invalid saved interface size falls back to Normal and clears the invalid value', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('amistoso-ui-scale', 'invalid'));
  await page.goto('/events');
  await expect
    .poll(() =>
      page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)),
    )
    .toBeCloseTo(15.2);
  expect(await page.evaluate(() => localStorage.getItem('amistoso-ui-scale'))).toBeNull();
  await openDisplay(page);
  await expect(page.getByRole('radio', { name: 'Normal' })).toBeChecked();
});

test('interface size updates across open tabs', async ({ page }) => {
  const rootSize = (target: typeof page) =>
    target.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  await page.goto('/events');
  const other = await page.context().newPage();
  await other.goto('/events');
  await chooseSize(page, 'Large');
  await expect.poll(() => rootSize(other)).toBeCloseTo(17.6);
  await openDisplay(other);
  await expect(other.getByRole('radio', { name: 'Large' })).toBeChecked();
  await other.keyboard.press('Escape');
  await chooseSize(other, 'Small');
  await expect.poll(() => rootSize(page)).toBeCloseTo(13.6);
  await other.close();
});

test('Auto removes the saved preference and follows the OS', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('amistoso-theme', 'light');
    }
  });
  await page.goto('/events');
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
  await chooseTheme(page, 'Auto');
  expect(await page.evaluate(() => localStorage.getItem('amistoso-theme'))).toBeNull();
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
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
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', 'light');
});

test('brand fonts, radius, role tokens and legacy token names are applied', async ({ page }) => {
  // Fonts are self-hosted: nothing may be requested from a third-party font host.
  const external: string[] = [];
  page.on('request', (request) => {
    if (/fontshare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(request.url()))
      external.push(request.url());
  });
  await page.goto('/admin');
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const styles = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const paper = document.querySelector('.login-card');
    const button = document.querySelector('.mantine-Button-root');
    return {
      body: getComputedStyle(document.body).fontFamily,
      heading: getComputedStyle(document.querySelector('h2')!).fontFamily,
      fontBody: root.getPropertyValue('--font-body').trim(),
      fontDisplay: root.getPropertyValue('--font-display').trim(),
      paper: paper ? getComputedStyle(paper).borderRadius : '',
      button: button ? getComputedStyle(button).borderRadius : '',
      tapLg: root.getPropertyValue('--tap-lg').trim(),
      radiusCard: root.getPropertyValue('--radius-card').trim(),
      space4: root.getPropertyValue('--space-4').trim(),
    };
  });
  // Every brand font covers Latin and Cyrillic: load each with a sample of both, then check.
  const fonts = await page.evaluate(async () => {
    const samples = ['Ana García l·l', 'Иван Петров Ёё Йй'];
    const out: Record<string, boolean> = {};
    for (const face of ['400 16px "Onest"', '700 24px "Geologica"', '400 16px "JetBrains Mono"'])
      for (const sample of samples) {
        await document.fonts.load(face, sample);
        out[`${face} ${sample}`] = document.fonts.check(face, sample);
      }
    return out;
  });
  for (const [key, ok] of Object.entries(fonts)) expect(ok, key).toBe(true);
  const plain = (v: string) => v.replaceAll('"', '').replaceAll("'", '');
  expect(plain(styles.body)).toBe(plain(styles.fontBody));
  expect(plain(styles.heading)).toBe(plain(styles.fontDisplay));
  expect(styles.body).toContain('Onest');
  expect(styles.heading).toContain('Geologica');
  expect(external).toEqual([]);
  expect(styles.paper).toBe('12px');
  expect(styles.button).toBe('8px');
  expect(styles.tapLg).toBe('44px');
  expect(styles.radiusCard).toBe('0.75rem');
  expect(styles.space4).toBe('1rem');
});

test('role tokens exist in both schemes and match frontend/theme.css', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/admin');
  await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
  const names = [
    'ball',
    'on-ball',
    'ball-ink',
    'focus',
    'court-panel',
    'rank-1',
    'rank-2',
    'rank-3',
  ];
  for (const mode of ['light', 'dark'] as const) {
    if (mode === 'dark') await chooseTheme(page, 'Dark');
    await expect(page.locator('html')).toHaveAttribute('data-mantine-color-scheme', mode);
    const tokens = await page.evaluate(
      (list) =>
        Object.fromEntries(
          list.map((n) => [
            n,
            getComputedStyle(document.documentElement).getPropertyValue(`--color-${n}`).trim(),
          ]),
        ),
      names,
    );
    for (const name of names) {
      expect(tokens[name]).not.toBe('');
      expect(tokens[name]).toBe(legacy(mode, name));
    }
  }
});

test('Cyrillic and Latin names are drawn by the same font and weight', async ({
  page,
  request,
}) => {
  const { id } = await createTournament(request, 'mex', `Fonts ${Date.now()}`, {
    player_names: ['Иван Петров', 'Ana García', 'Юлия Ёлкина', 'Marc Font'],
  });
  const fonts: string[] = [];
  page.on('request', (r) => {
    if (/\.woff2?(\?|$)/.test(r.url())) fonts.push(new URL(r.url()).pathname);
  });
  await loginAdmin(page);
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto(`/admin/t/${id}?view=standings`);
  await expect(page.getByRole('columnheader', { name: 'Total points' })).toBeVisible();
  const names = page.locator('tbody tr td:nth-child(2) span').filter({ hasText: /./ });
  const style = (text: string) =>
    names
      .filter({ hasText: text })
      .first()
      .evaluate((el) => {
        const css = getComputedStyle(el);
        return { family: css.fontFamily, weight: css.fontWeight, size: css.fontSize };
      });
  const cyrillic = await style('Иван Петров');
  const latin = await style('Ana García');
  expect(cyrillic).toEqual(latin);
  expect(cyrillic.family).toContain('Onest');
  // Both scripts come from the bundled Onest faces; the Cyrillic file was loaded and nothing is external.
  await page.evaluate(() => document.fonts.ready);
  expect(fonts.some((f) => /onest-cyrillic/.test(f))).toBe(true);
  expect(fonts.every((f) => f.startsWith('/admin-assets/'))).toBe(true);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`padel is blue and tennis is green (${scheme})`, async ({ page, request }) => {
    const stamp = Date.now();
    const padel = await createTournament(request, 'po', `Sport padel ${stamp}`);
    const tennis = await createTournament(request, 'po', `Sport tennis ${stamp}`, {
      sport: 'tennis',
      team_mode: false,
    });
    await page.emulateMedia({ colorScheme: scheme });
    await loginAdmin(page);
    await page.goto(`/admin/t/${padel.id}`);
    await expect(page.getByRole('heading', { name: `Sport padel ${stamp}` })).toBeVisible();
    await page.goto(`/admin/t/${tennis.id}`);
    await expect(page.getByRole('heading', { name: `Sport tennis ${stamp}` })).toBeVisible();
    const accent = (locator: import('@playwright/test').Locator) =>
      locator.evaluate((el) => getComputedStyle(el).getPropertyValue('--sport-accent').trim());
    // Open tabs: each open tournament carries its own sport accent.
    const dock = page.getByRole('navigation', { name: 'Open tournaments' });
    const padelRow = dock
      .locator('[data-sport]')
      .filter({ hasText: `Sport padel ${stamp}` })
      .first();
    const tennisRow = dock
      .locator('[data-sport]')
      .filter({ hasText: `Sport tennis ${stamp}` })
      .first();
    await expect(padelRow).toHaveAttribute('data-sport', 'padel');
    await expect(tennisRow).toHaveAttribute('data-sport', 'tennis');
    const [blue, green] = [await accent(padelRow), await accent(tennisRow)];
    expect(blue).not.toBe(green);
    // The hub list row does too.
    await page.goto('/admin');
    await page.getByLabel('Search tournaments').fill(`Sport `);
    // A live tournament of yours is a card, the rest are table rows: both carry the sport scope.
    const hubPadel = page
      .locator('[data-sport]')
      .filter({ hasText: `Sport padel ${stamp}` })
      .first();
    const hubTennis = page
      .locator('[data-sport]')
      .filter({ hasText: `Sport tennis ${stamp}` })
      .first();
    await expect(hubPadel).toBeVisible();
    expect(await accent(hubPadel)).toBe(blue);
    expect(await accent(hubTennis)).toBe(green);
    // Outside a sport scope the accent is the neutral primary, not tennis green.
    const base = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--sport-accent').trim(),
    );
    expect(base).not.toBe(green);
  });
}
