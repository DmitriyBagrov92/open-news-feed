import { test, expect } from '@playwright/test';
import { gotoFeed, cards, isMobile, blockExternal } from './_helpers.js';

test('theme toggle persists and is applied before first paint', async ({ page }) => {
  await gotoFeed(page);
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  // boot.js applies the saved theme synchronously in <head>
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { window.__themeAtDcl = document.documentElement.getAttribute('data-theme'); });
  });
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  expect(await page.evaluate(() => window.__themeAtDcl)).toBe('dark');
});

test('masthead controls are never covered by the time rail', async ({ page }, testInfo) => {
  test.fixme(!isMobile(testInfo), 'at 900–1400px the fixed rail overlaps the settings gear — the redesign shell fixes it');
  await gotoFeed(page);
  await page.getByTestId('settings-toggle').click(); // no force: the centre must be reachable
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
});

test('card size slider changes the density from the keyboard and by dragging', async ({ page }, testInfo) => {
  test.fixme(isMobile(testInfo), 'the slider is hidden on phones today — the redesign moves it into Settings');
  await gotoFeed(page);
  const slider = page.getByTestId('size-slider');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('html')).toHaveAttribute('data-grid-size', '1');
  await expect(slider).toHaveAttribute('aria-valuenow', '4');
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width * 0.05, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.02, box.y + box.height / 2);
  await page.mouse.up();
  await expect(page.locator('html')).toHaveAttribute('data-grid-size', '-2');
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-grid-size', '-2');
});

test('wire clocks tick and thin out on phones', async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-09-13T10:20:30Z') });
  await gotoFeed(page);
  const utc = page.locator('[data-tz="UTC"]');
  await expect(utc).toHaveText('10:20:30');
  await page.clock.runFor(2000);
  await expect(utc).toHaveText('10:20:32');
  const visible = await page.getByTestId('wire-clock').evaluateAll((els) => els.filter((e) => e.offsetParent !== null).length);
  expect(visible).toBe(isMobile(testInfo) ? 3 : 6);
});

test('offline banner appears when the network drops', async ({ page, context }) => {
  await gotoFeed(page);
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByTestId('offline-banner')).toBeVisible();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByTestId('offline-banner')).toBeHidden();
});

test('server-rendered headlines serve crawlers and no-JS readers', async ({ browser, request }) => {
  const html = await (await request.get('/')).text();
  expect(html).not.toMatch(/__PUBLIC_URL__|__SSR_HEADLINES__|__SITE_VERIFICATION__/);
  expect((html.match(/<li>/g) || []).length).toBe(30);
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const page = await ctx.newPage();
  await blockExternal(page);
  await page.goto('/');
  await expect(page.locator('.ssr-list li')).toHaveCount(30);
  await expect(page.locator('.noscript')).toBeVisible();
  await ctx.close();
});

test('the app removes the crawler list once it boots, and the PWA manifest resolves', async ({ page, request }) => {
  await gotoFeed(page);
  await expect(page.getByTestId('ssr')).toHaveCount(0);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.short_name).toBe('Meridian');
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
});
