import { test, expect } from '@playwright/test';
import { gotoFeed, cards, isMobile, navTo } from './_helpers.js';

test('taste onboarding → recommended feed → saved stories', async ({ page }, testInfo) => {
  await gotoFeed(page);
  // save a story first so the Saved sub-tab has something to show
  const saveBtn = cards(page).nth(2).getByTestId('card-save');
  const savedTitle = await cards(page).nth(2).locator('.card-title').textContent();
  await saveBtn.click();
  await expect(saveBtn).toHaveClass(/is-saved/);

  await navTo(page, 'saved');
  const onboard = page.getByTestId('onboard');
  await expect(onboard).toBeVisible();
  await expect(page.getByTestId('onboard-card')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/onboard-mode/);
  await expect(page.getByTestId('grid')).toBeHidden();

  // like, skip, keyboard, drag — five ratings finish the batch. A rating
  // is ignored while the previous card still flies off, so each one waits
  // for the progress dots to advance.
  const done = page.locator('#onboardProgress .onboard-dots i.is-done');
  const rate = async (n, action) => {
    await expect(page.getByTestId('onboard-card')).toBeVisible();
    await page.waitForTimeout(450); // fly-off + swap-in settle
    await action();
    await expect(done).toHaveCount(n);
  };
  await rate(1, () => page.getByTestId('onboard-like').click());
  await rate(2, () => page.getByTestId('onboard-skip').click());
  await rate(3, () => page.keyboard.press('ArrowRight'));
  await rate(4, () => page.keyboard.press('ArrowLeft'));
  await rate(5, async () => {
    if (isMobile(testInfo)) {
      await page.getByTestId('onboard-like').tap();
      return;
    }
    const box = await page.getByTestId('onboard-card').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) await page.mouse.move(box.x + box.width / 2 + i * 25, box.y + box.height / 2);
    await page.mouse.up();
  });

  await expect(onboard).toBeHidden({ timeout: 10_000 });
  await expect(page.getByTestId('feed-subtabs')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/onboard-mode/);
  await expect(cards(page).first()).toBeVisible();
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('meridian:prefs')));
  expect(prefs.taste.count).toBe(5);
  expect(prefs.taste.rated).toHaveLength(5);

  // a like IS a save: the bookmark plus the three liked stories
  await page.locator('#feedTabs [data-sub="saved"]').click();
  await expect(cards(page)).toHaveCount(4);
  const bookmarked = cards(page).filter({ has: page.locator('.card-title', { hasText: savedTitle }) });
  await expect(bookmarked).toHaveCount(1);
  // un-saving from here drops the card
  await bookmarked.getByTestId('card-save').click();
  await expect(cards(page)).toHaveCount(3);
  await expect(bookmarked).toHaveCount(0);

  await page.locator('#feedTabs [data-sub="recommended"]').click();
  await expect(page.getByTestId('tune-more')).toBeVisible();
  await page.getByTestId('tune-more').click();
  await expect(onboard).toBeVisible();
});
