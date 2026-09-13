import { test, expect } from '@playwright/test';
import { gotoFeed, cards, cardByTitle, isMobile } from './_helpers.js';

test('card actions: save, open at source, comment chip', async ({ page }) => {
  await gotoFeed(page);
  const card = cardByTitle(page, /Great Barrier Reef/); // no other spec comments on it
  const save = card.getByTestId('card-save');
  await save.click();
  await expect(save).toHaveClass(/is-saved/);
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('meridian:prefs')).saved)).length).toBe(1);
  await save.click();
  await expect(save).not.toHaveClass(/is-saved/);
  const open = card.getByTestId('card-open');
  await expect(open).toHaveAttribute('target', '_blank');
  await expect(open).toHaveAttribute('rel', 'noopener');
  await expect(open).toHaveAttribute('href', /^https:\/\//);
  await expect(card.getByTestId('card-comments')).toBeHidden();
  await expect(card).toHaveAttribute('role', 'button');
  await card.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('preview')).toBeVisible();
});

test('hover tooltip shows the full story on fine pointers only', async ({ page }, testInfo) => {
  await gotoFeed(page);
  const card = cards(page).nth(2);
  if (isMobile(testInfo)) {
    await card.tap();
    await expect(page.getByTestId('tooltip')).toHaveCount(0);
    return;
  }
  // a scroll cancels the pending tooltip, so settle the viewport first
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await card.locator('.card-title').hover();
  await page.waitForTimeout(900);
  const tip = page.getByTestId('tooltip');
  await expect(tip).toHaveClass(/is-on/);
  await expect(tip).toContainText(await card.locator('.card-title').textContent());
  await page.mouse.move(5, 5);
  await expect(tip).not.toHaveClass(/is-on/);
});
