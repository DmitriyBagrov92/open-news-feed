import { test, expect } from '@playwright/test';
import { gotoFeed, cards, cardByTitle, openPreview, isMobile, isCompact } from './_helpers.js';

test.describe('story preview', () => {
  test('extracts the article, summarises, translates, votes and returns focus', async ({ page }) => {
    await gotoFeed(page, { prefs: { targetLang: 'de', autoTranslate: false } }); // manual translation only
    const card = cardByTitle(page, /Coastal towns brace/); // resolves to a fixture page
    await card.click();
    const dialog = page.getByTestId('preview');
    await expect(dialog).toBeVisible();
    // phones: a full-screen layer over a locked page; wide: a pane beside the live feed
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(isCompact(page) ? 'hidden' : '');
    await expect(page.locator('body')).toHaveClass(/story-open/);
    await expect(page.getByTestId('preview-close')).toBeFocused();

    const text = page.getByTestId('preview-text');
    await expect(text).toContainText('Forecasters expect Storm Idris', { timeout: 15_000 });
    await expect(text.locator('h3, h4')).not.toHaveCount(0);
    await expect(text.locator('ul li')).not.toHaveCount(0);
    await expect(text.locator('blockquote')).toHaveCount(1);
    await expect(text.locator('a.modal-link')).toHaveAttribute('href', /fixture\/story-b/);

    await page.getByTestId('preview-summarize').click();
    await expect(page.getByTestId('preview-summary').locator('.bullets li').first()).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('preview-translate').click();
    await expect(page.getByTestId('preview-chip')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.locator('.modal-title')).toHaveText(/^\[/);
    await page.getByTestId('preview-chip').click();
    await expect(dialog.locator('.modal-title')).not.toHaveText(/^\[/);

    // votes live on the shared server, so the count is relative to before
    const before = Number((await card.getByTestId('card-vote-up').locator('span').textContent()) || 0);
    await page.getByTestId('preview-vote-up').click();
    await expect(page.getByTestId('preview-vote-up')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('preview-vote-up').locator('span')).toHaveText(String(before + 1));
    await expect(card.getByTestId('card-vote-up').locator('span')).toHaveText(String(before + 1));

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview')).toBeHidden();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe('');
    await expect(page.locator('body')).not.toHaveClass(/story-open/);
    await expect(card).toBeFocused();
  });

  test('falls back to the description when the page cannot be fetched and keeps the trap', async ({ page }) => {
    await gotoFeed(page);
    // the Wrexham story's page 404s in fixture mode → the RSS description stands in
    await cardByTitle(page, /Wrexham suffer/).click();
    const dialog = page.getByTestId('preview');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('preview-note')).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText('West Ham ran riot');
    // Tab never leaves the dialog
    for (let i = 0; i < 25; i += 1) await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement.closest('.modal') !== null)).toBe(true);
    await page.getByTestId('preview-close').click();
    await expect(page.getByTestId('preview')).toBeHidden();
  });

  test('comments: post, count on the card, vote, sort, draft survives Escape', async ({ page }) => {
    await gotoFeed(page);
    const card = cardByTitle(page, /Rail strike enters/);
    await card.click();
    await expect(page.getByTestId('preview')).toBeVisible();
    // comments rise as a sheet from the dock
    await page.getByTestId('preview-comments').click();
    await expect(page.getByTestId('preview-dialog')).toHaveAttribute('data-pane', 'comments');
    const input = page.getByTestId('comments-input');
    await expect(input).toBeVisible();
    await input.fill('First take from the suite');
    await page.getByTestId('comments-post').click();
    await expect(page.getByTestId('comment').first()).toContainText('First take from the suite');
    await expect(card.getByTestId('card-comments')).toBeVisible();
    // the three browser profiles share one server, so the count only grows
    await expect(card.getByTestId('card-comments').locator('span')).toHaveText(/^[1-9]\d*$/);
    await page.getByTestId('comment').first().getByTestId('comment-vote-up').click();
    await expect(page.getByTestId('comment').first().getByTestId('comment-vote-up')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('comments-sort-top').click();
    await expect(page.getByTestId('comments-sort-top')).toHaveClass(/is-active/);
    // a non-empty draft is not lost to a reflexive Escape
    await input.fill('a draft');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview')).toBeVisible();
    await expect(input).not.toBeFocused();
    // the next Escape lowers the sheet, the one after closes the story
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview-dialog')).not.toHaveAttribute('data-pane', /.+/);
    await expect(page.getByTestId('preview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview')).toBeHidden();
  });

  test('prev/next walks the feed in order', async ({ page }, testInfo) => {
    await gotoFeed(page);
    const titles = await page.evaluate(() => [...document.querySelectorAll('#grid .card .card-title')].slice(0, 3).map((t) => t.textContent));
    const dialog = await openPreview(page, 1);
    await expect(dialog.locator('.modal-title')).toHaveText(titles[1]);
    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('.modal-title')).toHaveText(titles[2]);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.locator('.modal-title')).toHaveText(titles[0]);
    if (isMobile(testInfo)) {
      test.fixme(true, 'swipe navigation arrives with the sheet redesign (phase 3)');
    } else {
      await page.getByTestId('preview-next').click();
      await expect(dialog.locator('.modal-title')).toHaveText(titles[1]);
    }
  });

  test('looks right', async ({ page }) => {
    await gotoFeed(page);
    await cardByTitle(page, /Coastal towns brace/).click();
    await expect(page.getByTestId('preview-text')).toContainText('Forecasters expect', { timeout: 15_000 });
    await expect(page).toHaveScreenshot('preview.png', { mask: [page.getByTestId('wire'), page.getByTestId('feed-date')] });
  });
});
