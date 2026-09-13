import { test, expect } from '@playwright/test';
import { gotoFeed, cards, isMobile } from './_helpers.js';

test('category tabs filter the feed and the choice survives a reload', async ({ page }) => {
  await gotoFeed(page);
  for (const cat of ['sports', 'technology']) {
    await page.locator(`#tabs [data-cat="${cat}"]`).click();
    await expect(page.locator(`#tabs [data-cat="${cat}"]`)).toHaveAttribute('aria-current', 'true');
    await expect(cards(page).first()).toBeVisible();
    const cats = await page.evaluate(() => [...document.querySelectorAll('#grid .card .card-cat')].map((c) => c.textContent.trim()));
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats).size).toBe(1);
  }
  await page.reload();
  await expect(page.locator('#tabs [data-cat="technology"]')).toHaveAttribute('aria-current', 'true');
  await page.locator('#tabs [data-cat="all"]').click();
  await expect(cards(page)).toHaveCount(30);
});

test('Your Feed and Bubble Battle are reachable without scrolling the tab strip', async ({ page }, testInfo) => {
  test.fixme(isMobile(testInfo), 'the strip pushes Saved/Battle off-screen on phones — fixed by the redesign shell');
  await gotoFeed(page);
  await expect(page.locator('#tabs [data-cat="saved"]')).toBeInViewport();
  await expect(page.locator('#tabs [data-cat="battle"]')).toBeInViewport();
});
