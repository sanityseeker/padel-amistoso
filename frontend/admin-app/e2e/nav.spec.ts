import { test, expect, type Page } from '@playwright/test';
import { chooseLanguage, expectFooter, logoutAdmin } from './helpers';

async function loginAdmin(page: Page, path = '/admin') {
  await page.goto(path);
  await page.getByLabel(/^Username/).fill('admin');
  await page.getByLabel(/^Password/).fill('test-admin-2026');
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Administration' })).toBeVisible();
}

test('the support footer is on every route, including logins and 404', async ({ page }) => {
  for (const path of ['/events', '/player', '/admin', '/events/does/not/exist']) {
    await page.goto(path);
    await expect(page.locator('.app-header')).toBeVisible();
    await expectFooter(page);
  }
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await loginAdmin(page);
  await expectFooter(page);
});

test('anonymous visitors get a player Sign in; the organizer door is on the player login', async ({
  page,
}) => {
  await page.goto('/events');
  const nav = page.getByRole('navigation', { name: 'Pages' });
  await expect(nav.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Player Hub' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Admin' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Admin sign in' })).toHaveCount(0);
  await expect(page.getByText('Administration', { exact: true })).toHaveCount(0);
  await page.locator('.app-header').getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Player Hub' })).toBeVisible();
  // The login form is the page now, so the header does not offer Sign in again.
  await expect(
    page.locator('.app-header').getByRole('link', { name: 'Sign in', exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Admin sign in' })).toHaveAttribute('href', '/admin');
});

test('the login offers password recovery and no separate account help', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.getByRole('link', { name: 'Account help' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Forgot your password?' }).click();
  await expect(page).toHaveURL(/\/admin\/account\/forgot$/);
});

test('React boot marks the browser session as started', async ({ page }) => {
  await page.goto('/events');
  expect(await page.evaluate(() => sessionStorage.getItem('amistoso-session-active'))).toBe('1');
});

test('switching Events, Player Hub and Admin never reloads the document', async ({ page }) => {
  await loginAdmin(page);
  const boot = await page.evaluate(() => window.__bootId);
  expect(boot).toBeTruthy();
  const nav = page.getByRole('navigation', { name: 'Pages' });
  await nav.getByRole('link', { name: 'Player Hub' }).click();
  await expect(page).toHaveURL(/\/player$/);
  await expect(page.getByRole('heading', { name: 'Player Hub' })).toBeVisible();
  await nav.getByRole('link', { name: 'Events' }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole('tab', { name: /^Live/ })).toBeVisible();
  await nav.getByRole('link', { name: 'Admin' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__bootId)).toBe(boot);
  expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
  // Language is shared, and logging out of admin leaves the Player Hub area usable.
  await chooseLanguage(page, 'Español');
  await expect(page.getByRole('heading', { name: 'Torneos', exact: true })).toBeVisible();
  await chooseLanguage(page, 'English');
  await logoutAdmin(page);
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await page.evaluate(() => window.__bootId)).toBe(boot);
});

test('root redirects by session and last page', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/events$/);
  await page.evaluate(() => localStorage.setItem('amistoso-last-page', 'player'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/player$/);
  await loginAdmin(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/admin$/);
});

test('old hash admin links are mapped to path routes', async ({ page }) => {
  await page.goto('/admin#/tournaments/abc123');
  await expect(page).toHaveURL(/\/admin\/t\/abc123$/);
  await page.goto('/#/registrations/rg_1');
  await expect(page).toHaveURL(/\/admin\/lobby\/rg_1$/);
  await page.goto('/admin#/create');
  await expect(page).toHaveURL(/\/admin\/new$/);
});

test('deep admin links resume after login and unknown admin paths fall back', async ({ page }) => {
  await loginAdmin(page, '/admin/clubs');
  await expect(page).toHaveURL(/\/admin\/clubs$/);
  await page.goto('/admin/nothing-here');
  await expect(page).toHaveURL(/\/admin$/);
});

test('phone header has one small Display button and keeps the admin entry in the overflow menu', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/events');
  const header = page.locator('.app-header');
  // On phones the Pages switch is the bottom navigation, not part of the header.
  await expect(header.getByRole('navigation', { name: 'Pages' })).toHaveCount(0);
  const pages = page.getByRole('navigation', { name: 'Pages' });
  await expect(pages).toBeVisible();
  await expect(pages.getByRole('link', { name: 'Events' })).toHaveAttribute('aria-current', 'page');
  // Preferences: a 44 px sliders button in the header that opens an anchored popover, not a sheet.
  const display = header.getByRole('button', { name: /^Preferences:/ });
  expect((await display.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await display.click();
  const panel = page.getByTestId('display-panel');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeLessThanOrEqual(240);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  await page.keyboard.press('Escape');
  await expect(header.getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
    'href',
    '/player',
  );
  await expect(header.getByRole('link', { name: 'Admin sign in' })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

test('phone Menu sheet display controls fit a narrow Russian viewport at 110%', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await loginAdmin(page, '/admin');
  await page.evaluate(() => {
    localStorage.setItem('amistoso-lang', 'ru');
    localStorage.setItem('amistoso-ui-scale', '110');
  });
  await page.reload();
  await page
    .getByRole('navigation', { name: 'Администрирование' })
    .getByRole('button', { name: 'Меню' })
    .click();
  const menu = page.getByRole('dialog', { name: 'Меню' });
  const panel = menu.getByTestId('display-panel');
  await expect(panel).toBeVisible();
  const box = (await panel.boundingBox())!;
  expect(box.width).toBeGreaterThan(240);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(320);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});

for (const [language, label] of [
  ['en', 'English'],
  ['es', 'Español'],
  ['ru', 'Русский'],
] as const) {
  test(`phone admin bottom navigation labels fit at 360 px (${language})`, async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await loginAdmin(page, '/admin');
    await page.evaluate((lang) => localStorage.setItem('amistoso-lang', lang), language);
    await page.reload();
    const nav = page.getByRole('navigation', {
      name: /^(Administration|Administración|Администрирование)$/,
    });
    await expect(nav).toBeVisible();
    // Tournaments, New, Clubs, Menu.
    const tabs = nav.locator('a, button');
    expect(await tabs.count(), label).toBe(4);
    for (let i = 0; i < 4; i++) {
      const text = tabs.nth(i).locator('span').last();
      const clipped = await text.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
      expect(clipped, await text.innerText()).toBe(false);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBeTruthy();
  });
}

async function fireInstallPrompt(page: Page) {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    event.prompt = async () => {
      (window as unknown as { __prompted: boolean }).__prompted = true;
    };
    event.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(event);
  });
}

test('Install appears only after beforeinstallprompt and invokes the browser prompt', async ({
  page,
}) => {
  await page.goto('/events');
  await page.getByRole('tab', { name: /^Live/ }).waitFor();
  const install = page.locator('.app-header').getByRole('button', { name: 'Install', exact: true });
  await expect(install).toHaveCount(0);
  await fireInstallPrompt(page);
  await expect(install).toBeVisible();
  await install.click();
  await expect
    .poll(() => page.evaluate(() => (window as never as { __prompted?: boolean }).__prompted))
    .toBe(true);
  await expect(install).toHaveCount(0);
});

test('Install is a header button on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/events');
  await fireInstallPrompt(page);
  await expect(
    page.locator('.app-header').getByRole('button', { name: 'Install app', exact: true }),
  ).toBeVisible();
});

test('Install stays hidden when the app already runs standalone', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/events');
  await page.getByRole('tab', { name: /^Live/ }).waitFor();
  await fireInstallPrompt(page);
  await expect(page.locator('.app-header').getByRole('button', { name: 'Install' })).toHaveCount(0);
});

test.describe('iOS Safari', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  test('Install explains Add to Home Screen in a two-step dialog', async ({ page }) => {
    await page.goto('/events');
    const install = page
      .locator('.app-header')
      .getByRole('button', { name: 'Install', exact: true });
    await expect(install).toBeVisible();
    await install.click();
    const dialog = page.getByRole('dialog', { name: 'Install the app' });
    await expect(dialog).toContainText('Share');
    await expect(dialog).toContainText('Add to Home Screen');
    await expect(dialog.locator('svg[aria-hidden="true"][stroke="currentColor"]')).toBeVisible();
  });
});

test('the service worker precaches the React build under a build-hashed cache', async ({
  page,
}) => {
  await page.goto('/events');
  const cached = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    const names = await caches.keys();
    const current = names.find((n) => /^amistoso-v\d+-[0-9a-f]{10}$/.test(n));
    const cache = current ? await caches.open(current) : null;
    const entries = cache ? (await cache.keys()).map((r) => new URL(r.url).pathname) : [];
    return { current, entries };
  });
  expect(cached.current).toBeTruthy();
  expect(cached.entries.filter((p) => p.startsWith('/admin-assets/')).length).toBeGreaterThan(3);
  for (const shell of ['/', '/events', '/player', '/admin'])
    expect(cached.entries).toContain(shell);
  expect(cached.entries.some((p) => p.startsWith('/api/'))).toBe(false);
});
