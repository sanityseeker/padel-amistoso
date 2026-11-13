import { expect, type APIRequestContext, type Page } from '@playwright/test';

const MOBILE_MAX = 767;
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1280) <= MOBILE_MAX;

// The Display control (language, theme, size) is a small sliders button in the header that opens an anchored
// popover, at every width. The one exception is the admin on a phone: there the Menu sheet shows the
// same controls inline, so opening Display means opening the sheet.
export async function openDisplay(page: Page) {
  const trigger = page.getByRole('button', {
    name: /^(Preferences|Preferencias|Настройки):/,
  });
  if (await trigger.count()) await trigger.first().click();
  else
    await page
      .getByRole('navigation', { name: /^(Administration|Administración|Администрирование)$/ })
      .getByRole('button', { name: /^(Menu|Menú|Меню)$/ })
      .click();
}

export async function chooseLanguage(page: Page, language: 'English' | 'Español' | 'Русский') {
  await openDisplay(page);
  await page
    .getByRole('radiogroup', { name: /^(Language|Idioma|Язык)$/ })
    .locator('label')
    .filter({ hasText: language })
    .click();
  await page.keyboard.press('Escape');
}

export async function chooseSize(page: Page, size: 'Small' | 'Normal' | 'Large') {
  await openDisplay(page);
  await page
    .getByRole('radiogroup', { name: /^(Size|Tamaño|Размер)$/ })
    .locator('label')
    .filter({ hasText: size })
    .click();
  await page.keyboard.press('Escape');
}

export async function chooseTheme(page: Page, theme: 'Auto' | 'Light' | 'Dark') {
  const label = { Auto: /Auto/, Light: /Light|Claro/, Dark: /Dark|Oscuro/ }[theme];
  await openDisplay(page);
  await page
    .getByRole('radiogroup', { name: /^(Theme|Tema)$/ })
    .locator('label')
    .filter({ hasText: label })
    .click();
  await page.keyboard.press('Escape');
}

export async function logoutAdmin(page: Page) {
  if (isMobile(page)) {
    // The admin chrome has one menu on a phone: the Menu sheet, which holds the account items.
    await page
      .getByRole('navigation', { name: /^(Administration|Administración|Администрирование)$/ })
      .getByRole('button', { name: /^(Menu|Menú|Меню)$/ })
      .click();
    await page.getByRole('button', { name: /^(Log out|Cerrar sesión)$/ }).click();
    return;
  } else {
    await page.getByRole('button', { name: /^(Account menu|Menú de la cuenta)$/ }).click();
  }
  await page.getByRole('menuitem', { name: /^(Log out|Cerrar sesión)$/ }).click();
}

export async function expectFooter(page: Page) {
  await expect(
    page.getByRole('link', { name: /Buy me a coffee|Invítame a un café/ }),
  ).toHaveAttribute('href', 'https://ko-fi.com/torneosamistosos');
  await expect(
    page.getByRole('link', { name: /Contribute on GitHub|Contribuye en GitHub/ }),
  ).toHaveAttribute('href', 'https://github.com/sanityseeker/padel-amistoso');
}

// ---- Seeding through the real API (admin-tournament specs) ----------------------------------

export const ADMIN = { username: 'admin', password: 'test-admin-2026' };
export const PLAYERS = ['Ana', 'Beto', 'Carla', 'Diego', 'Elena', 'Fabio', 'Gala', 'Hugo'];

export async function adminHeaders(request: APIRequestContext) {
  const login = await request.post('/api/auth/login', { data: ADMIN });
  expect(login.ok()).toBeTruthy();
  return { Authorization: `Bearer ${(await login.json()).access_token}` };
}

export async function createTournament(
  request: APIRequestContext,
  kind: 'gp' | 'mex' | 'po',
  name: string,
  extra: Record<string, unknown> = {},
) {
  const headers = await adminHeaders(request);
  const spec = {
    gp: {
      url: '/api/tournaments/group-playoff',
      data: {
        name,
        player_names: PLAYERS,
        num_groups: 2,
        top_per_group: 2,
        court_names: ['Court 1', 'Court 2'],
      },
    },
    mex: {
      url: '/api/tournaments/mexicano',
      data: { name, player_names: PLAYERS.slice(0, 4), num_rounds: 3, total_points_per_match: 24 },
    },
    po: {
      url: '/api/tournaments/playoff',
      data: { name, participant_names: PLAYERS.slice(0, 4), court_names: ['Court 1'] },
    },
  }[kind];
  const created = await request.post(spec.url, { headers, data: { ...spec.data, ...extra } });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).id as string;
  if (kind === 'mex') {
    const round = await request.post(`/api/tournaments/${id}/mex/next-round`, {
      headers,
      data: {},
    });
    expect(round.ok()).toBeTruthy();
  }
  return { id, headers };
}

export async function patchTvSettings(
  request: APIRequestContext,
  id: string,
  settings: Record<string, unknown>,
) {
  const res = await request.patch(`/api/tournaments/${id}/tv-settings`, {
    headers: await adminHeaders(request),
    data: settings,
  });
  expect(res.ok()).toBeTruthy();
}

export async function loginAdmin(page: Page) {
  await page.goto('/admin');
  await page.getByLabel(/^Username/).fill(ADMIN.username);
  await page.getByLabel(/^Password/).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tournaments', exact: true })).toBeVisible();
}

export async function openTournament(page: Page, id: string, name: string) {
  await loginAdmin(page);
  await page.goto(`/admin/t/${id}`);
  await expect(page.getByRole('heading', { name })).toBeVisible();
}

/** The create form shows players and courts as a list by default; type them as text instead. */
export async function fillNames(page: Page, field: 'players' | 'courts', value: string) {
  const toggle = page.locator('label', { hasText: /^(Text|Texto|Текст)$/ });
  await (field === 'players' ? toggle.first() : toggle.last()).click();
  await page
    .getByLabel(field === 'players' ? /^(Players|Jugadores|Игроки)/ : /^(Courts|Pistas|Корты)$/)
    .fill(value);
}
