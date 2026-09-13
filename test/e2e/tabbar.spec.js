import { test, expect } from '@playwright/test';
import { gotoFeed, cards, isMobile } from './_helpers.js';

test.describe('floating tab bar (phones)', () => {
  test('four sections and a search island, minimising while scrolling down', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the tab bar exists on compact screens only');
    await gotoFeed(page);
    const bar = page.getByTestId('tabbar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.tabbar-item')).toHaveCount(4);
    await expect(bar.locator('.tabbar-item[data-cat="all"]')).toHaveAttribute('aria-current', 'true');
    const fullHeight = (await bar.locator('.tabbar').boundingBox()).height;
    expect(fullHeight).toBeGreaterThanOrEqual(60);
    // content never hides under the bar: the feed keeps room for it
    const padding = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('main.feed')).paddingBottom));
    expect(padding).toBeGreaterThanOrEqual(fullHeight);

    // scroll down → a pill with the active tab only; scroll up → the full bar
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(80);
    await page.evaluate(() => window.scrollTo(0, 900));
    await expect(page.locator('html')).toHaveAttribute('data-scroll', 'down');
    await expect.poll(async () => (await bar.locator('.tabbar').boundingBox()).height).toBeLessThanOrEqual(50);
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(page.locator('html')).not.toHaveAttribute('data-scroll', /.*/);
    await expect.poll(async () => (await bar.locator('.tabbar').boundingBox()).height).toBeGreaterThanOrEqual(60);
  });

  test('the items navigate: Your Feed, Battle, Saved, and the island opens search', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the tab bar exists on compact screens only');
    await gotoFeed(page);
    const bar = page.getByTestId('tabbar');
    await bar.locator('[data-cat="battle"]').click();
    await expect(page.getByTestId('battle')).toBeVisible();
    await expect(bar.locator('[data-cat="battle"]')).toHaveAttribute('aria-current', 'true');
    await expect(page.getByTestId('feed-title')).toHaveText('Bubble Battle');

    await bar.locator('[data-sub="saved"]').click();
    await expect(page.getByTestId('feed-subtabs')).toBeVisible();
    await expect(page.locator('#feedTabs [data-sub="saved"]')).toHaveAttribute('aria-current', 'true');
    await expect(bar.locator('[data-sub="saved"]')).toHaveAttribute('aria-current', 'true');
    await expect(bar.locator('[data-sub="recommended"]')).not.toHaveAttribute('aria-current', /.*/);

    await bar.locator('[data-cat="all"]').click();
    await expect(cards(page).first()).toBeVisible();
    await expect(page.getByTestId('feed-title')).toHaveText('Today');

    await page.getByTestId('tabbar-search').click();
    await expect(page.getByTestId('search-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('search-input')).not.toBeFocused();
  });

  test('a short, wide compact screen (iPhone Duo closed) puts the bar on the side', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'compact screens only');
    await page.setViewportSize({ width: 466, height: 678 });
    await gotoFeed(page);
    const bar = page.getByTestId('tabbar');
    const box = await bar.boundingBox();
    expect(box.x).toBeGreaterThan(466 - 90); // hugs the right edge
    expect(box.height).toBeGreaterThan(box.width); // stacked vertically
    // the feed leaves room for it
    const row = await cards(page).nth(1).boundingBox();
    expect(row.x + row.width).toBeLessThan(box.x);
  });

  test('wide screens have no tab bar; the category segment lives in the top cluster', async ({ page }, testInfo) => {
    test.skip(isMobile(testInfo), 'compact screens have the tab bar');
    await gotoFeed(page);
    await expect(page.getByTestId('tabbar')).toBeHidden();
    const tabs = await page.getByTestId('tabs').boundingBox();
    const cluster = await page.getByTestId('topbar').boundingBox();
    expect(Math.abs(tabs.y - cluster.y)).toBeLessThan(6); // same row as the cluster
    await expect(page.locator('#tabs [data-cat="saved"]')).toBeInViewport();
  });
});
