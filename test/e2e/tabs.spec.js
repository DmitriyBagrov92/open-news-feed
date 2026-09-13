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

test('Your Feed and Bubble Battle are reachable without scrolling anything', async ({ page }, testInfo) => {
  await gotoFeed(page);
  // phones: the floating tab bar; wide screens: the category segment in the cluster
  const root = isMobile(testInfo) ? '#tabbar' : '#tabs';
  await expect(page.locator(`${root} [data-cat="saved"]`).first()).toBeInViewport();
  await expect(page.locator(`${root} [data-cat="battle"]`).first()).toBeInViewport();
  if (isMobile(testInfo)) {
    await expect(page.locator('#tabs [data-cat="saved"]')).toBeHidden(); // not duplicated in the chip row
  } else {
    await expect(page.getByTestId('tabbar')).toBeHidden();
  }
});
