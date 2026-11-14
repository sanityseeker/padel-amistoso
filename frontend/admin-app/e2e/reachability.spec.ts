import { test, expect, type Page } from '@playwright/test';
import { adminHeaders, createTournament, loginAdmin, openDisplay } from './helpers';

// Proposal section 3.3 "Every admin route and action stays reachable": every row of that table must
// be reachable with the navigation that exists at each width, and from the command palette.
const WIDTHS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1000 },
  { name: 'desktop', width: 1366, height: 900 },
] as const;

const adminNav = (page: Page) => page.getByRole('navigation', { name: 'Administration' });

for (const size of WIDTHS) {
  test(`every admin route and action is reachable at ${size.name} (${size.width}px)`, async ({
    page,
    request,
  }) => {
    const phone = size.name === 'phone';
    await page.setViewportSize({ width: size.width, height: size.height });
    const name = `Reach ${size.name} ${Date.now()}`;
    const { id, headers } = await createTournament(request, 'mex', name);
    const lobby = await (
      await request.post('/api/registrations', {
        headers: await adminHeaders(request),
        data: { name: `${name} Lobby`, auto_send_email: false },
      })
    ).json();
    await loginAdmin(page);

    const openMenuSheet = async () => {
      await adminNav(page).getByRole('button', { name: 'Menu' }).click();
      return page.getByRole('dialog', { name: 'Menu' });
    };
    // A destination link at this width: bottom tabs or the Menu sheet on phones, dock or rail otherwise.
    const reach = async (label: string, url: RegExp, viaMenu = false) => {
      if (phone && viaMenu) {
        const sheet = await openMenuSheet();
        await sheet.getByRole('link', { name: label, exact: true }).click();
      } else {
        await adminNav(page).getByRole('link', { name: label, exact: true }).click();
      }
      await expect(page).toHaveURL(url);
    };

    // Routes: /admin, /admin/new, /admin/clubs, /admin/users. Lobbies are the hub's type filter.
    if (phone) await reach('New', /\/admin\/new$/);
    else {
      // One primary New link goes straight to the create form; the format row picks tournament or lobby.
      await page.getByRole('link', { name: 'New', exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/new$/);
      await page.getByRole('radio', { name: 'Lobby', exact: true }).click();
      await expect(page.getByRole('radio', { name: 'Lobby', exact: true })).toBeChecked();
    }
    await reach(phone ? 'Clubs' : 'Clubs & communities', /\/admin\/clubs$/);
    await reach('Users', /\/admin\/users$/, true);
    await reach('Tournaments', /\/admin$/);
    // The old Lobbies page redirects to the hub, filtered to lobbies.
    await page.goto('/admin/lobbies');
    await expect(page).toHaveURL(/\/admin$/);
    // Phones keep Ownership and Type behind the "Filters" button.
    if (phone) await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.getByRole('radio', { name: 'Lobbies', exact: true })).toBeChecked();
    await expect(page.getByText(`${name} Lobby`).first()).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Type' }).getByText('All', { exact: true }).click();
    if (phone) await page.keyboard.press('Escape');

    // /admin/t/:id and /admin/lobby/:id: from the hub, then as open tabs or the sheet.
    await page.getByRole('link', { name, exact: true }).first().click();
    await expect(page).toHaveURL(new RegExp(`/admin/t/${id}$`));
    await expect(page.getByRole('heading', { name })).toBeVisible();
    await page.goto(`/admin/lobby/${lobby.id}`);
    await expect(page.getByRole('heading', { name: `${name} Lobby` })).toBeVisible();
    if (phone) {
      await page
        .locator('.app-header')
        .getByRole('button', { name: /^Switch tournament/ })
        .click();
      const sheet = page.getByRole('dialog', { name: 'Switch tournament' });
      await expect(sheet.getByRole('link', { name, exact: true })).toBeVisible();
      await sheet.getByRole('link', { name, exact: true }).click();
    } else {
      const open = page.getByRole('navigation', { name: 'Open tournaments' });
      await expect(open.getByRole('link', { name: `${name} Lobby`, exact: true })).toBeVisible();
      await open.getByRole('link', { name, exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`/admin/t/${id}$`));

    // Per-tournament actions: TV view and Advanced admin on the workspace.
    await page.getByRole('button', { name: 'Workspace menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'TV view' })).toHaveAttribute('href', /\/tv/);
    // The legacy admin is no longer linked from the app: every capability has a React home.
    await expect(page.getByRole('menuitem', { name: 'Advanced admin' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    // Info and Legacy admin: dock footer, rail menu or Menu sheet.
    const quiet = async (label: string, href: string) => {
      if (phone) {
        const sheet = await openMenuSheet();
        await expect(sheet.getByRole('link', { name: label, exact: true })).toHaveAttribute(
          'href',
          href,
        );
        await page.keyboard.press('Escape');
      } else if (size.name === 'tablet') {
        await page.getByRole('button', { name: 'Navigation menu' }).click();
        await expect(page.getByRole('menuitem', { name: label })).toHaveAttribute('href', href);
        await page.keyboard.press('Escape');
      } else {
        await expect(page.getByRole('link', { name: label, exact: true })).toHaveAttribute(
          'href',
          href,
        );
      }
    };
    await quiet('Info', '/admin/info');
    await expect(page.getByRole('link', { name: 'Legacy admin' })).toHaveCount(0);

    // Display (language and theme) and the account items.
    await openDisplay(page);
    await expect(page.getByRole('radiogroup', { name: 'Language' })).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Theme' })).toBeVisible();
    await page.keyboard.press('Escape');
    if (phone) {
      // One menu on a phone: the Menu sheet, with no second "..." menu in the top bar.
      await expect(page.locator('.app-header').getByRole('button', { name: 'More' })).toHaveCount(
        0,
      );
      const sheet = await openMenuSheet();
      await expect(sheet.getByRole('button', { name: 'Change password' })).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Log out' })).toBeVisible();
    } else {
      await page.getByRole('button', { name: 'Account menu' }).click();
      await expect(page.getByRole('menuitem', { name: 'Change password' })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Log out' })).toBeVisible();
    }
    await page.keyboard.press('Escape');

    // Events and Player Hub: header Pages switch, or the Menu sheet on phones.
    const pagesNav = phone
      ? (await openMenuSheet()).getByRole('navigation', { name: 'Pages' })
      : page.getByRole('navigation', { name: 'Pages' });
    await expect(pagesNav.getByRole('link', { name: 'Events' })).toHaveAttribute('href', '/events');
    await expect(pagesNav.getByRole('link', { name: 'Player Hub' })).toHaveAttribute(
      'href',
      '/player',
    );
    // Admin is the Tournaments dock / tab already, so the switch does not repeat it.
    await expect(pagesNav.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    if (phone) await page.keyboard.press('Escape');

    // The palette lists every destination and preference too.
    await page.keyboard.press('Control+k');
    const palette = page.getByRole('dialog');
    const search = palette.getByPlaceholder('Search or jump...');
    for (const [query, label] of [
      ['tournaments', /^Tournaments/],
      ['lobbies', /^Lobbies/],
      ['new tournament', /^New tournament/],
      ['new lobby', /^New lobby/],
      ['clubs', /^Clubs & communities/],
      ['users', /^Users/],
      ['info', /^Info/],
      ['events', /^Events/],
      ['player hub', /^Player Hub/],
      ['tv view', /^Open TV view/],
      ['change password', /^Change password/],
      ['log out', /^Log out/],
      ['theme dark', /^Theme: Dark/],
    ] as const) {
      await search.fill(query);
      await expect(palette.getByRole('button', { name: label }).first(), query).toBeVisible();
    }
    await page.keyboard.press('Escape');

    await request.delete(`/api/tournaments/${id}`, { headers });
    await request.delete(`/api/registrations/${lobby.id}`, {
      headers: await adminHeaders(request),
    });
  });
}
