import { test, expect } from '@playwright/test';
import { gotoFeed, cards, isMobile, isCompact, blockExternal, openSettings } from './_helpers.js';

test('appearance: auto follows the system, an explicit choice wins and is applied before first paint', async ({ page }) => {
  await gotoFeed(page);
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', /.+/); // auto by default
  const systemDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(systemDark ? 'rgb(0, 0, 0)' : 'rgb(255, 255, 255)');

  await openSettings(page);
  await page.getByTestId('appearance-dark').click();
  await expect(html).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('appearance-dark')).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(0, 0, 0)');
  await page.getByTestId('appearance-light').click();
  await expect(html).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(255, 255, 255)');
  await page.getByTestId('appearance-auto').click();
  await expect(html).not.toHaveAttribute('data-theme', /.+/);
  await page.getByTestId('appearance-dark').click();
  await page.getByTestId('settings-close').click();

  // boot.js applies the saved choice synchronously in <head>
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => { window.__themeAtDcl = document.documentElement.getAttribute('data-theme'); });
  });
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  expect(await page.evaluate(() => window.__themeAtDcl)).toBe('dark');
});

test('the theme circle flips the effective theme on wide screens', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), 'phones choose the appearance in Settings');
  await gotoFeed(page);
  const html = page.locator('html');
  const systemDark = await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', systemDark ? 'light' : 'dark');
  await page.getByTestId('theme-toggle').click();
  await expect(html).toHaveAttribute('data-theme', systemDark ? 'dark' : 'light');
});

test('the glass slider is applied live and persists', async ({ page }) => {
  await gotoFeed(page);
  await openSettings(page);
  const range = page.getByTestId('glass-range');
  await range.fill('90');
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass').trim())).toBe('0.9');
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('meridian:prefs')));
  expect(prefs.glass).toBeCloseTo(0.9, 5);
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--glass').trim())).toBe('0.9');
});

test('the top cluster floats over content: nothing covers its controls, --sticky-top is measured, the frost band and category pill appear on scroll', async ({ page }) => {
  await gotoFeed(page);
  // every control is reachable at its centre — no rail, no bar overlaps it
  await page.getByTestId('settings-toggle').click();
  await expect(page.getByTestId('settings-sheet')).toBeVisible();
  await page.getByTestId('settings-close').click();
  await expect(page.getByTestId('settings-sheet')).toBeHidden();

  const measured = await page.evaluate(() => ({
    sticky: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top')),
    bottom: document.getElementById('chromeTop').getBoundingClientRect().bottom,
  }));
  expect(Math.abs(measured.sticky - measured.bottom)).toBeLessThan(2);

  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-scrolled', /.*/);
  await page.evaluate(() => window.scrollTo(0, 900));
  await expect(html).toHaveAttribute('data-scrolled', '');
  await expect(page.locator('.frost')).toHaveCSS('opacity', '1');
  if (isCompact(page)) {
    // phones: the current category morphs into the cluster and takes you back up
    await expect(page.getByTestId('cat-pill')).toHaveCSS('opacity', '1');
    await expect(page.getByTestId('cat-pill')).toHaveText(/Today/);
    await page.getByTestId('cat-pill').click();
  } else {
    await expect(page.getByTestId('cat-pill')).toBeHidden(); // the segment already says it
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(10);
  await expect(html).not.toHaveAttribute('data-scrolled', /.*/);
  await expect(page.locator('.frost')).toHaveCSS('opacity', '0');
});

test('card size: keyboard and drag change the density, the choice persists', async ({ page }) => {
  await gotoFeed(page);
  await openSettings(page); // the slider lives in Settings (and in the cluster on very wide screens)
  const slider = page.getByTestId('size-slider-drawer');
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

test('the world ticker ticks and thins out on phones', async ({ page }, testInfo) => {
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

test('no third-party requests, no vendored 3D, no console errors', async ({ page }) => {
  const requests = [];
  const errors = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  await gotoFeed(page);
  await page.waitForTimeout(800);
  expect(requests.filter((u) => /fonts\.googleapis|fonts\.gstatic|three/.test(u))).toEqual([]);
  expect(requests.filter((u) => !u.startsWith('http://127.0.0.1') && !u.startsWith('http://localhost') && !u.startsWith('data:') && !/images\.example\.net/.test(u))).toEqual([]);
  expect(errors).toEqual([]);
});
