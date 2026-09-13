import { test, expect } from '@playwright/test';
import { gotoFeed, cards, openSettings } from './_helpers.js';

test('one language setting: both controls mirror it and the feed auto-translates', async ({ page }) => {
  await gotoFeed(page);
  await page.getByTestId('lang-toggle').click();
  await expect(page.getByTestId('lang-popover')).toBeVisible();
  await page.getByTestId('lang-select').selectOption('de');
  await expect(page.getByTestId('auto-translate')).toBeChecked();
  await expect(page.getByTestId('lang-select-drawer')).toHaveValue('de');
  await expect(page.getByTestId('auto-translate-drawer')).toBeChecked();
  // visible cards pick up the (stubbed) server translation
  await expect(cards(page).first()).toHaveAttribute('data-translated', 'de', { timeout: 15_000 });
  await expect(cards(page).first().locator('.card-title')).toHaveText(/^\[de\] /);
  await expect(cards(page).first().getByTestId('card-translate')).toHaveClass(/is-translated/);
  const prefs = await page.evaluate(() => JSON.parse(localStorage.getItem('meridian:prefs')));
  expect(prefs.targetLang).toBe('de');
  expect(prefs.autoTranslate).toBe(true);
  expect(prefs.uiLocale).toBeUndefined();

  // switching auto-translate off from the settings sheet reverts and mirrors
  await page.keyboard.press('Escape');
  await openSettings(page);
  await page.getByTestId('auto-translate-drawer').uncheck();
  await expect(page.getByTestId('auto-translate')).not.toBeChecked();
  await expect(cards(page).first()).not.toHaveAttribute('data-translated', /.+/);
  await expect(cards(page).first().locator('.card-title')).not.toHaveText(/^\[de\] /);
  await page.getByTestId('settings-close').click();

  // the card button translates one story on demand, and toggles back
  const card = cards(page).nth(1);
  await card.getByTestId('card-translate').click();
  await expect(card).toHaveAttribute('data-translated', 'de');
  await card.getByTestId('card-translate').click();
  await expect(card).not.toHaveAttribute('data-translated', /.+/);
});

test('picking English while English is the source only nudges', async ({ page }) => {
  await gotoFeed(page);
  await cards(page).first().getByTestId('card-translate').click();
  await expect(page.getByTestId('toast')).toHaveText(/Choose a target language/);
});
