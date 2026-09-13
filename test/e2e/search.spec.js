import { test, expect } from '@playwright/test';
import { gotoFeed, cards, openSearch } from './_helpers.js';

test('search filters the feed, shows an empty state, and Escape clears it', async ({ page }) => {
  await gotoFeed(page);
  await openSearch(page);
  const input = page.getByTestId('search-input');
  await input.fill('Storm Idris');
  await expect.poll(() => cards(page).count()).toBeLessThan(10);
  const titles = await page.evaluate(() => [...document.querySelectorAll('#grid .card')].map((c) => c.querySelector('.card-title').textContent + ' ' + c.querySelector('.card-desc').textContent));
  expect(titles.every((t) => /storm idris/i.test(t))).toBe(true);

  await input.fill('zzzzqqq');
  await expect(page.getByTestId('empty')).toBeVisible();
  await expect(page.getByTestId('empty')).toContainText('zzzzqqq');

  await page.keyboard.press('Escape');
  await expect(input).toHaveValue('');
  await expect(cards(page)).toHaveCount(30);
  await expect(page.getByTestId('empty')).toBeHidden();
});
