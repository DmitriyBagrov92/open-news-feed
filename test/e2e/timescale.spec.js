import { test, expect } from '@playwright/test';
import { gotoFeed, isMobile, pullForecast, clickUncovered } from './_helpers.js';

test('the time rail maps scroll to story time and seeks on click', async ({ page }, testInfo) => {
  test.skip(isMobile(testInfo), 'the rail is a wide-screen element');
  await gotoFeed(page);
  const rail = page.getByTestId('timescale');
  await expect(rail).not.toHaveClass(/is-empty/);
  await expect(rail.locator('.timescale-tick')).toHaveCount(3);
  const label = page.locator('#timescaleLabel');
  await expect(label).toHaveText('NOW');
  await page.evaluate(() => window.scrollTo(0, 1800));
  await page.waitForTimeout(200);
  await expect(label).not.toHaveText('NOW');
  const topAfter = await page.locator('#timescaleCursor').evaluate((c) => c.style.top);
  expect(topAfter).not.toBe('');
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = await rail.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.5);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

  // the forecast reserves a future band above NOW
  await page.goto('/?forecast=mock');
  await expect(page.getByTestId('card').first()).toBeVisible();
  await pullForecast(page, testInfo);
  await expect(page.getByTestId('forecast')).toBeVisible();
  await expect(rail).toHaveClass(/has-future/);
  await expect(page.getByTestId('timescale-future')).toBeVisible();
  await clickUncovered(page.getByTestId('forecast-close'));
  await expect(rail).not.toHaveClass(/has-future/);
});
