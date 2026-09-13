import { test, expect } from '@playwright/test';
import { gotoFeed, clickUncovered } from './_helpers.js';

// The local digest is instant, so the thinking state can be shorter than
// one expect poll: a MutationObserver records that it happened at all.
async function armThinkingWatch(page) {
  await page.evaluate(() => {
    const card = document.querySelector('.brief-card');
    window.__briefThought = false;
    window.__briefObserver?.disconnect();
    window.__briefObserver = new MutationObserver(() => { if (card.classList.contains('is-thinking')) window.__briefThought = true; });
    window.__briefObserver.observe(card, { attributes: true, attributeFilter: ['class'] });
  });
}
const thought = (page) => page.evaluate(() => window.__briefThought);

test('the daily brief thinks, then summarises the current view and follows the tab', async ({ page }) => {
  await gotoFeed(page);
  const body = page.getByTestId('brief-body');
  await expect(body.locator('.bullets li').first()).toBeVisible({ timeout: 20_000 });
  expect(await body.locator('.bullets li').count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId('brief-badge')).toHaveText(/LOCAL DIGEST/); // no on-device model in a headless browser
  await expect(page.getByTestId('brief')).not.toHaveClass(/is-thinking/);

  await armThinkingWatch(page);
  await clickUncovered(page.getByTestId('brief-refresh'));
  await expect(body.locator('.bullets li').first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => thought(page)).toBe(true);

  await armThinkingWatch(page);
  await page.locator('#tabs [data-cat="sports"]').click();
  await expect(body.locator('.bullets li').first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => thought(page)).toBe(true);
  const text = await body.textContent();
  expect(text).toMatch(/Shelton|Solheim|Wrexham/);
});
