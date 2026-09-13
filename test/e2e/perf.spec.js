import { test, expect } from '@playwright/test';
import { gotoFeed, cardByTitle } from './_helpers.js';

// Liquid Glass has a budget: every backdrop-filter surface is a compositor
// layer, and nothing may animate while the reader is just reading.
const glassCount = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('*')].filter((el) => {
      if (!(el instanceof HTMLElement) || el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
      const bf = cs.backdropFilter || cs.webkitBackdropFilter;
      return bf && bf !== 'none';
    }).length
  );

const runningAnimations = (page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && !(a.effect?.target?.closest?.('.brief-card.is-thinking'))).length);

test('glass surfaces stay within budget and nothing animates at rest', async ({ page }) => {
  await gotoFeed(page);
  await expect(page.getByTestId('brief-body').locator('.bullets li').first()).toBeVisible({ timeout: 20_000 });
  expect(await glassCount(page)).toBeLessThanOrEqual(14);
  await page.waitForTimeout(3000);
  expect(await runningAnimations(page)).toBe(0);

  await cardByTitle(page, /Coastal towns brace/).click();
  await expect(page.getByTestId('preview')).toBeVisible();
  await expect(page.getByTestId('preview-text')).toContainText('Forecasters expect', { timeout: 15_000 });
  expect(await glassCount(page)).toBeLessThanOrEqual(18);
  await page.waitForTimeout(3000);
  expect(await runningAnimations(page)).toBe(0);
});

test('the page never scrolls sideways', async ({ page }) => {
  await gotoFeed(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
