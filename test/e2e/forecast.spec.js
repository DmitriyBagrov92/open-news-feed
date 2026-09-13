import { test, expect } from '@playwright/test';
import { gotoFeed, pullForecast, openSettings, clickUncovered } from './_helpers.js';

test.describe('AI forecast (mock model)', () => {
  test('pull past the top reveals skeletons, then four grounded forecasts outside the grid', async ({ page }, testInfo) => {
    await gotoFeed(page, { query: '?forecast=mock' });
    const hint = page.getByTestId('forecast-hint');
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(/PULL DOWN FOR AN AI FORECAST/);
    const section = page.getByTestId('forecast');
    await expect(section).toBeHidden();

    await pullForecast(page, testInfo);
    await expect(section).toBeVisible();
    await expect(page.locator('#forecastGrid .fcard:not(.fcard--skeleton)')).toHaveCount(4, { timeout: 10_000 });
    const facts = await page.evaluate(() => {
      const list = [...document.querySelectorAll('.fcard:not(.fcard--skeleton)')];
      return {
        insideGrid: document.querySelectorAll('#grid .fcard').length,
        areCards: list.filter((c) => c.classList.contains('card')).length,
        due: list.every((c) => c.querySelector('time[data-due]')),
        badges: list.every((c) => /AI-GENERATED/.test(c.querySelector('.fcard-badge').textContent)),
        chips: list.every((c) => c.querySelectorAll('.fcard-chip').length >= 1),
      };
    });
    expect(facts).toEqual({ insideGrid: 0, areCards: 0, due: true, badges: true, chips: true });
    await expect(page.getByTestId('forecast-badge')).toHaveText(/MOCK/);
    await expect(hint).toBeHidden();

    // expand a card in place, open a real basis story from its chip
    const first = page.getByTestId('fcard').first();
    await first.click();
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await first.locator('.fcard-chip').first().click();
    await expect(page.getByTestId('preview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('preview')).toBeHidden();

    // regenerate → skeletons → a fresh set; close → hidden, hint back
    await clickUncovered(page.getByTestId('forecast-regen'));
    await expect(page.locator('#forecastGrid .fcard--skeleton')).toHaveCount(4);
    await expect(page.locator('#forecastGrid .fcard:not(.fcard--skeleton)')).toHaveCount(4, { timeout: 10_000 });
    await clickUncovered(page.getByTestId('forecast-close'));
    await expect(section).toBeHidden();
    await expect(hint).toBeVisible();
    // the hint is a real button (keyboard / assistive tech path) and the cache makes it instant
    await hint.click();
    await expect(page.locator('#forecastGrid .fcard:not(.fcard--skeleton)')).toHaveCount(4);
    await expect(section).not.toHaveClass(/is-thinking/);
  });

  test('a model that still needs downloading only opens from a click', async ({ page }, testInfo) => {
    await gotoFeed(page, { query: '?forecast=mock-download' });
    const hint = page.getByTestId('forecast-hint');
    await expect(hint).toHaveText(/ENABLE AI FORECAST/);
    await pullForecast(page, testInfo);
    await expect(page.getByTestId('forecast')).toBeHidden();
    await hint.click();
    await expect(page.getByTestId('forecast-status')).toHaveText(/DOWNLOADING/);
    await expect(page.locator('#forecastGrid .fcard:not(.fcard--skeleton)')).toHaveCount(4, { timeout: 15_000 });
  });

  test('the setting switches the feature off and on', async ({ page }) => {
    await gotoFeed(page, { query: '?forecast=mock' });
    await openSettings(page);
    const row = page.getByTestId('forecast-setting');
    await expect(row).toBeVisible();
    await page.getByTestId('forecast-toggle').uncheck();
    await expect(page.getByTestId('forecast-hint')).toBeHidden();
    await page.getByTestId('forecast-toggle').check();
    await page.getByTestId('settings-close').click();
    await expect(page.getByTestId('forecast-hint')).toBeVisible();
  });
});

test('without the Prompt API nothing forecast-related exists', async ({ page }) => {
  await gotoFeed(page);
  await expect(page.getByTestId('forecast-hint')).toBeHidden();
  await openSettings(page);
  await expect(page.getByTestId('forecast-setting')).toBeHidden();
});
