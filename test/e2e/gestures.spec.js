import { test, expect } from '@playwright/test';
import { gotoFeed, cards, cardByTitle, isMobile, isCompact } from './_helpers.js';

// A horizontal drag with the mouse: on the phone project Chromium reports a
// coarse pointer, so the rows treat it like a finger.
async function drag(page, from, to, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  }
  await page.mouse.up();
}

test.describe('gestures on phones', () => {
  test('swipe a row right to save it, left to translate it', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'rows swipe on coarse pointers');
    await gotoFeed(page, { prefs: { targetLang: 'de', autoTranslate: false } });
    const card = cardByTitle(page, /Great Barrier Reef/);
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const title = card.locator('.card-title');
    let box = await title.boundingBox();
    await drag(page, { x: box.x + 20, y: box.y + box.height / 2 }, { x: box.x + 140, y: box.y + box.height / 2 });
    await expect(card.getByTestId('card-save')).toHaveClass(/is-saved/);
    expect((await page.evaluate(() => JSON.parse(localStorage.getItem('meridian:prefs')).saved)).length).toBe(1);
    // the swipe never opens the story
    await expect(page.getByTestId('preview')).toHaveCount(0);

    box = await title.boundingBox();
    await drag(page, { x: box.x + 160, y: box.y + box.height / 2 }, { x: box.x + 20, y: box.y + box.height / 2 });
    await expect(card).toHaveAttribute('data-translated', 'de', { timeout: 15_000 });
    await expect(page.getByTestId('preview')).toHaveCount(0);
  });

  test('a long press opens the glass menu with the story actions', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'long press is a touch affordance');
    await gotoFeed(page);
    const card = cardByTitle(page, /Bacteria found thriving/);
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const box = await card.locator('.card-title').boundingBox();
    await page.mouse.move(box.x + 30, box.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(650);
    const menu = page.getByTestId('ctxmenu');
    await expect(menu).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('preview')).toHaveCount(0);
    const items = page.getByTestId('ctxmenu-item');
    expect(await items.count()).toBeGreaterThanOrEqual(3);
    await expect(items.first()).toHaveText(/Save story/);
    await items.first().click();
    await expect(menu).toHaveCount(0);
    await expect(card.getByTestId('card-save')).toHaveClass(/is-saved/);
    // Escape closes it too
    await page.mouse.move(box.x + 30, box.y + 10);
    await page.mouse.down();
    await page.waitForTimeout(650);
    await page.mouse.up();
    await expect(page.getByTestId('ctxmenu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('ctxmenu')).toHaveCount(0);
  });

  test('the story: swipe between stories, drag the hero down to dismiss', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the full-screen story is a phone layout');
    await gotoFeed(page);
    const titles = await page.evaluate(() => [...document.querySelectorAll('#grid .card .card-title')].slice(0, 3).map((t) => t.textContent));
    await cards(page).nth(1).click();
    const dialog = page.getByTestId('preview');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.modal-title')).toHaveText(titles[1]);
    const hero = dialog.locator('.modal-media');
    let box = await hero.boundingBox();
    await drag(page, { x: box.x + box.width - 40, y: box.y + box.height / 2 }, { x: box.x + 40, y: box.y + box.height / 2 });
    await expect(dialog.locator('.modal-title')).toHaveText(titles[2]);
    box = await hero.boundingBox();
    await drag(page, { x: box.x + 40, y: box.y + box.height / 2 }, { x: box.x + box.width - 40, y: box.y + box.height / 2 });
    await expect(dialog.locator('.modal-title')).toHaveText(titles[1]);
    // drag down on the hero → dismissed, page unlocked
    box = await hero.boundingBox();
    await drag(page, { x: box.x + box.width / 2, y: box.y + 60 }, { x: box.x + box.width / 2, y: box.y + 320 });
    await expect(dialog).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
  });

  test('the comments live at the end of the story; the dock button scrolls to them', async ({ page }) => {
    await gotoFeed(page);
    await cardByTitle(page, /Coastal towns brace/).click();
    await expect(page.getByTestId('preview-text')).toContainText('Forecasters expect', { timeout: 15_000 });
    const panel = page.getByTestId('preview-comments-panel');
    await expect(panel).toBeAttached();
    await expect(panel).not.toBeInViewport(); // below the article, nothing covering it
    await page.getByTestId('preview-comments').click();
    await expect(panel).toBeInViewport();
    await expect(page.getByTestId('comments-input')).toBeVisible();
    // and simply scrolling the story reaches them too — no control required
    await page.keyboard.press('Escape');
    await cardByTitle(page, /Coastal towns brace/).click();
    await page.getByTestId('comments-input').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('comments-input')).toBeVisible();
  });

  test('the settings sheet drags away on phones', async ({ page }, testInfo) => {
    test.skip(!isMobile(testInfo), 'the sheet is a phone layout');
    await gotoFeed(page);
    await page.getByTestId('settings-toggle').click();
    const sheet = page.getByTestId('settings-sheet');
    await expect(sheet).toHaveClass(/open/);
    await page.waitForTimeout(320);
    const g = await page.locator('#drawerGrab').boundingBox();
    await drag(page, { x: g.x + g.width / 2, y: g.y + g.height / 2 }, { x: g.x + g.width / 2, y: g.y + 300 });
    await expect(sheet).toBeHidden();
    expect(isCompact(page)).toBe(true);
  });
});
