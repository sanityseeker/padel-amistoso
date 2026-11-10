import { test, expect } from '@playwright/test';

// iPhone browsers have no install event. Since iOS 16.4 Safari, Chrome, Edge and Firefox all add a page
// to the home screen from their Share menu, so Install opens the how-to; in-app browsers cannot.

const IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const AGENTS = {
  safari: `${IOS} Version/18.5 Mobile/15E148 Safari/604.1`,
  chrome: `${IOS} CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1`,
  instagram: `${IOS} Mobile/15E148 Instagram 389.0.0.38.84 (iPhone15,2; iOS 18_5; en_US)`,
};

for (const [name, userAgent] of Object.entries(AGENTS))
  test(`iPhone ${name}: ${name === 'instagram' ? 'no Install button' : 'Install opens the how-to'}`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      userAgent,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    await page.goto('/events');
    await expect(page.getByRole('tab', { name: /^Live/ })).toBeVisible();
    const install = page
      .locator('.app-header')
      .getByRole('button', { name: 'Install app', exact: true });
    if (name === 'instagram') {
      await expect(install).toHaveCount(0);
    } else {
      await install.tap();
      const guide = page.getByRole('dialog', { name: 'Install the app' });
      await expect(guide).toContainText('Tap Share');
      await expect(guide).toContainText('Add to Home Screen');
    }
    await context.close();
  });
