import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminHeaders, createTournament, openTournament } from './helpers';

// Organizer announcements: posted from the workspace, read on the Player Hub event page and the TV
// screen (both live, no reload), and flagged on the Hub card until the player has seen them.

async function hubProfile(request: APIRequestContext, id: string, name: string) {
  const res = await request.get(`/api/tournaments/${id}/player-secrets`, {
    headers: await adminHeaders(request),
  });
  const secrets = (await res.json()).players as Record<
    string,
    { name: string; passphrase: string }
  >;
  const secret = Object.values(secrets).find((p) => p.name === name)!;
  const created = await request.post('/api/player-profile', {
    data: {
      participant_passphrase: secret.passphrase,
      name,
      email: `announce-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    },
  });
  expect(created.ok()).toBeTruthy();
  return (await created.json()).access_token as string;
}

async function openHub(page: Page, token: string, name: string) {
  const loaded = page.waitForResponse(
    (r) => /\/api\/player-profile\/space\?/.test(r.url()) && r.ok(),
  );
  await page.goto(`/player#token=${encodeURIComponent(token)}`);
  await loaded;
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

const noSideScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

async function post(page: Page, text: string, notify = true) {
  await page.getByLabel('New announcement').fill(text);
  const box = page.getByRole('checkbox', { name: 'Notify players' });
  if ((await box.isChecked()) !== notify) await box.click();
  await page.getByTestId('announcement-post').click();
  await expect(page.getByLabel('New announcement')).toHaveValue('');
}

test('an organizer posts announcements; the Hub and the TV show them live and the card flags new ones', async ({
  page,
  browser,
  request,
}) => {
  const name = `Announce ${Date.now()}`;
  const { id } = await createTournament(request, 'mex', name);
  const token = await hubProfile(request, id, 'Ana');

  // The player on a 375px phone, on the event page; the TV on its own screen.
  const playerContext = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const player = await playerContext.newPage();
  await openHub(player, token, 'Ana');
  await expect(player.getByTestId('active-tournament')).toHaveCount(1);
  await expect(player.getByTestId('active-tournament-announcement')).toHaveCount(0);
  await player.goto(`/player/matches/tournament/${id}`);
  await expect(player.getByTestId('event-up-next')).toBeVisible();
  await expect(player.getByTestId('event-announcements')).toHaveCount(0);

  const tvContext = await browser.newContext();
  const tv = await tvContext.newPage();
  await tv.goto(`/tv/${id}`);
  await expect(tv.getByTestId('tv-page').getByRole('heading', { level: 1, name })).toBeVisible();
  await expect(tv.getByTestId('tv-announcements')).toHaveCount(0);

  // The organizer posts from the workspace's Announcements tab.
  await openTournament(page, id, name);
  await page.getByRole('tab', { name: 'Announcements' }).click();
  await expect(page.getByRole('checkbox', { name: 'Notify players' })).toBeChecked();
  await post(page, 'Lunch at **one**\n- Court 1 first\n- Then [the bar](https://example.com)');
  const posted = page.getByTestId('admin-announcement');
  await expect(posted).toHaveCount(1);
  await expect(posted.getByText('one', { exact: true })).toHaveJSProperty('tagName', 'STRONG');

  // The event page and the TV update on the live stream, without a reload.
  const list = player.getByTestId('event-announcements');
  await expect(list).toContainText('Lunch at one');
  await expect(list.getByText('one', { exact: true })).toHaveJSProperty('tagName', 'STRONG');
  await expect(list.getByRole('listitem')).toHaveCount(2);
  await expect(list.getByRole('link', { name: 'the bar' })).toHaveAttribute(
    'href',
    'https://example.com',
  );
  await expect(list.locator('time')).toHaveText(/now|second|minute/i);
  expect(await noSideScroll(player)).toBeTruthy();
  const tvList = tv.getByTestId('tv-announcements');
  await expect(tvList).toContainText('Lunch at one');
  await expect(tvList.getByText('one', { exact: true })).toHaveJSProperty('tagName', 'STRONG');

  // The player saw it on the event page: the Hub card shows the badge, not as new.
  await player.goto('/player');
  const badge = player.getByTestId('active-tournament-announcement');
  await expect(badge).toHaveText('Announcement');
  await expect(badge).not.toHaveAttribute('data-new', /.*/);
  await expect(player.getByTestId('active-tournament')).not.toContainText('Lunch');

  // A later post is new until the player marks it seen from the card...
  await post(page, 'Final starts at **six**', false);
  await expect(posted).toHaveCount(2);
  await player.reload();
  await expect(badge).toHaveText('New announcement');
  await expect(badge).toHaveAttribute('data-new', 'true');
  expect(await noSideScroll(player)).toBeTruthy();
  await player.getByTestId('active-tournament-announcement-seen').click();
  await expect(badge).toHaveText('Announcement');

  // ...or opens it: the badge leads to the announcements on the event page, newest first.
  await post(page, 'Prize giving at **seven**', false);
  await player.reload();
  await expect(badge).toHaveText('New announcement');
  await badge.click();
  await expect(player).toHaveURL(new RegExp(`/player/matches/tournament/${id}#announcements$`));
  await expect(list.getByTestId('announcement').first()).toContainText('Prize giving at seven');
  await expect(list.getByTestId('announcement')).toHaveCount(3);
  await player.goto('/player');
  await expect(badge).toHaveText('Announcement');

  // Pinning moves a post to the top everywhere; deleting removes it.
  const lunch = posted.filter({ hasText: 'Lunch at one' });
  await lunch.getByRole('button', { name: 'Pin' }).click();
  await expect(tvList.getByTestId('announcement').first()).toContainText('Lunch at one');
  await expect(tvList.getByTestId('announcement').first()).toHaveAttribute('data-pinned', 'true');
  await lunch.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(posted).toHaveCount(2);
  await expect(tvList).not.toContainText('Lunch at one');

  await playerContext.close();
  await tvContext.close();
});
