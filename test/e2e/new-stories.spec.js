import { test, expect } from '@playwright/test';
import { gotoFeed, cards, withFreshStories } from './_helpers.js';

test('the poll announces new stories in a pill and prepends them on click', async ({ page, request }) => {
  await page.clock.install({ time: Date.now() });
  await gotoFeed(page);
  const firstBefore = await cards(page).first().getAttribute('data-id');
  await withFreshStories(request, async () => {
    await page.clock.runFor(31_000); // the 30 s poll fires once
    const pill = page.getByTestId('new-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveText(/3 NEW STORIES/);
    await pill.click();
    await expect(pill).toBeHidden();
    await expect(page.locator('#grid > .card--fresh')).toHaveCount(3);
    const order = await page.evaluate(() => [...document.querySelectorAll('#grid > .card[data-id]')].slice(0, 4).map((c) => c.querySelector('.card-title').textContent));
    expect(order.slice(0, 3).every((t) => t.startsWith('Breaking'))).toBe(true);
    expect(await cards(page).nth(3).getAttribute('data-id')).toBe(firstBefore);
  });
});
