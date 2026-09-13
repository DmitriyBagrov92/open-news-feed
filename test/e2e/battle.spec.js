import { test, expect } from '@playwright/test';
import { gotoFeed, isReduced, navTo } from './_helpers.js';

test('Bubble Battle clusters the fixture stories across leans', async ({ page }, testInfo) => {
  await gotoFeed(page);
  await navTo(page, 'battle');
  const battle = page.getByTestId('battle');
  await expect(battle).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/battle-mode/);
  await expect(page.getByTestId('grid')).toBeHidden();
  await expect(page.getByTestId('brief')).toBeHidden();

  const bubbles = page.getByTestId('bubble');
  await expect.poll(() => bubbles.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(6);
  const leans = await page.evaluate(() => [...new Set([...document.querySelectorAll('.bubble')].map((b) => b.dataset.lean))]);
  expect(leans.length).toBeGreaterThanOrEqual(2);

  if (isReduced(testInfo)) {
    await expect(battle).toHaveClass(/battle--static/);
    await expect(page).toHaveScreenshot('battle-static.png', { fullPage: false, mask: [page.getByTestId('wire'), page.getByTestId('feed-date')] });
  } else {
    await expect(battle).not.toHaveClass(/battle--static/);
    // a drag moves a bubble (physics); a click opens its story
    const bubble = bubbles.first();
    await expect(bubble).toBeVisible();
    const before = await bubble.evaluate((b) => b.style.transform);
    const box = await bubble.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(box.x + box.width / 2 + i * 20, box.y + box.height / 2 + i * 10);
    await page.waitForTimeout(450);
    await page.mouse.up();
    await expect.poll(() => bubble.evaluate((b) => b.style.transform)).not.toBe(before);
  }

  await bubbles.nth(1).click({ force: true }); // physics keeps bubbles moving — never "stable"
  await expect(page.getByTestId('preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('preview')).toBeHidden();

  await navTo(page, 'all');
  await expect(battle).toBeHidden();
  await expect(page.getByTestId('grid')).toBeVisible();
});
