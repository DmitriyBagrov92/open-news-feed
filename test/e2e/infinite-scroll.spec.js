import { test, expect } from '@playwright/test';
import { gotoFeed, cards } from './_helpers.js';

test('scrolling to the sentinel loads the next page without duplicates', async ({ page }) => {
  await gotoFeed(page);
  await expect(cards(page)).toHaveCount(30);
  for (let i = 0; i < 6; i += 1) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(250);
  }
  await expect.poll(() => cards(page).count(), { timeout: 15_000 }).toBeGreaterThan(30);
  await expect(page.locator('#grid .card--skeleton')).toHaveCount(0);
  const ids = await page.evaluate(() => [...document.querySelectorAll('#grid .card[data-id]')].map((c) => c.dataset.id));
  expect(new Set(ids).size).toBe(ids.length);
});
