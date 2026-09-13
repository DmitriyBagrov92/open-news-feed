import { test, expect } from '@playwright/test';
import { gotoFeed, cards } from './_helpers.js';

test.describe('feed grid', () => {
  test('renders the first page as cards in time order with the mosaic variants', async ({ page }) => {
    await gotoFeed(page);
    await expect(cards(page)).toHaveCount(30);
    // every card is a direct child of #grid — the invariant prev/next,
    // the rail and prepend anchoring all rely on
    const shape = await page.evaluate(() => {
      const list = [...document.querySelectorAll('#grid > .card[data-id]')];
      return {
        direct: list.length,
        times: list.map((c) => c.querySelector('time[data-published]').dataset.published),
        ids: list.map((c) => c.dataset.id),
        firstIsHero: list[0].classList.contains('card--hero') && !!list[0].querySelector('.card-media'),
        textCardsWithoutMedia: list.filter((c) => c.classList.contains('card--text')).every((c) => !c.querySelector('.card-media')),
        dots: list.every((c) => /^dot dot--(live|recent|stale)$/.test(c.querySelector('.card-meta .dot').className)),
      };
    });
    expect(shape.direct).toBe(30);
    expect(new Set(shape.ids).size).toBe(30);
    for (let i = 1; i < shape.times.length; i += 1) expect(shape.times[i - 1] >= shape.times[i]).toBe(true);
    expect(shape.firstIsHero).toBe(true);
    expect(shape.textCardsWithoutMedia).toBe(true);
    expect(shape.dots).toBe(true);
    await expect(page.getByTestId('source-count')).toHaveText(/\d+ SOURCES/);
  });

  test('looks right above the fold', async ({ page }) => {
    await gotoFeed(page);
    await expect(page.getByTestId('brief-body').locator('.bullets li').first()).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveScreenshot('feed-top.png', { mask: [page.getByTestId('wire')] });
  });
});
