import { test, expect } from '@playwright/test';
import { gotoFeed, cards, openSettings } from './_helpers.js';

test('settings sheet: trap, sources filter, language mirror, close paths', async ({ page }) => {
  await gotoFeed(page);
  const sheet = await openSettings(page);
  await expect(sheet).toHaveAttribute('aria-modal', 'true');
  await expect(page.getByTestId('settings-close')).toBeFocused();
  for (let i = 0; i < 12; i += 1) await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.closest('#drawer') !== null)).toBe(true);

  const rows = page.getByTestId('source-row');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBeGreaterThan(60);
  const espn = page.locator('[data-testid="source-row"][data-source="espn"] input');
  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/api/news') && r.url().includes('exclude=')),
    espn.uncheck(),
  ]);
  expect(req.url()).toContain('espn');
  await expect(cards(page).first()).toBeVisible();
  expect(await page.evaluate(() => [...document.querySelectorAll('#grid .card .card-src')].some((s) => s.textContent === 'ESPN'))).toBe(false);
  await espn.check();

  // language lives in one place — the globe in the cluster — never here
  await expect(page.getByTestId('lang-select-drawer')).toHaveCount(0);
  await expect(page.getByTestId('auto-translate-drawer')).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('settings-toggle')).toBeFocused();
  await openSettings(page);
  await page.locator('#drawerScrim').click({ position: { x: 10, y: 10 } }); // the scrim, above the sheet on phones
  await expect(sheet).toBeHidden();
});

test('looks right', async ({ page }) => {
  await gotoFeed(page);
  await openSettings(page);
  await page.waitForTimeout(400);
  await expect(page).toHaveScreenshot('settings.png', { mask: [page.getByTestId('wire'), page.getByTestId('feed-date')] });
});
