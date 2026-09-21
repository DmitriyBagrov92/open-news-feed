import { test, expect } from '@playwright/test';
import { gotoFeed, cardByTitle, openSettings, isMobile } from './_helpers.js';

// Whose voice is it: every story names the country its publisher is based in,
// with a round flag that is a real, same-origin image (emoji flags do not
// render on Windows).
const flagLoaded = (locator) => locator.evaluate((img) => img.complete && img.naturalWidth > 0);

test('cells carry a flag, the bare source name and the country', async ({ page }) => {
  await gotoFeed(page);
  const bbc = cardByTitle(page, /Coastal towns brace/);
  await expect(bbc.locator('.card-src')).toHaveText('BBC World');
  await expect(bbc.locator('.byline-country')).toHaveText('United Kingdom');
  const flag = bbc.locator('.byline img.flag');
  await expect(flag).toHaveAttribute('src', 'flags/gb.svg');
  await expect(flag).toHaveAttribute('alt', '');
  await expect.poll(() => flagLoaded(flag)).toBe(true);
  // the dateline and the freshness dot still live in the same meta block
  await expect(bbc.locator('.card-meta .dot')).toHaveCount(1);
  await expect(bbc.locator('.card-meta time[data-published]')).toHaveCount(1);

  const espn = cardByTitle(page, /Shelton sets up US Open/);
  await expect(espn.locator('.byline-country')).toHaveText('United States');
  await expect(espn.locator('.byline img.flag')).toHaveAttribute('src', 'flags/us.svg');
  const alj = cardByTitle(page, /Ceasefire talks resume in Cairo/);
  await expect(alj.locator('.byline-country')).toHaveText('Qatar');

  // every rendered story has a byline, and no flag request failed
  const stats = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#grid .card[data-id]')];
    return { cards: cards.length, bylines: cards.filter((c) => c.querySelector('.byline[data-cc]')).length };
  });
  expect(stats.bylines).toBe(stats.cards);
});

test('the story header and the hover tooltip say it too', async ({ page }, testInfo) => {
  await gotoFeed(page);
  const card = cardByTitle(page, /Coastal towns brace/);
  if (!isMobile(testInfo)) {
    await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await page.waitForTimeout(300);
    const tip = page.getByTestId('tooltip');
    await expect(async () => {
      await page.mouse.move(5, 5);
      await card.locator('.card-title').hover();
      await page.waitForTimeout(800);
      await expect(tip).toHaveClass(/is-on/);
    }).toPass({ timeout: 12_000 });
    await expect(tip.locator('.byline-country')).toHaveText('United Kingdom');
    await expect(tip.locator('img.flag')).toHaveAttribute('src', 'flags/gb.svg');
    await page.mouse.move(5, 5);
  }
  await card.click();
  const meta = page.getByTestId('preview').locator('.modal-meta');
  await expect(meta.locator('.byline-src')).toHaveText('BBC World');
  await expect(meta.locator('.byline-country')).toHaveText('United Kingdom');
  await expect.poll(() => flagLoaded(meta.locator('img.flag'))).toBe(true);
  await expect(meta.locator('.meta-rest')).toContainText('World');
});

test('Settings lists every source with its flag; no single home shows the globe', async ({ page }) => {
  await gotoFeed(page);
  await openSettings(page);
  const row = (id) => page.locator(`[data-testid="source-row"][data-source="${id}"]`);
  await expect(row('tass').locator('img.flag')).toHaveAttribute('src', 'flags/ru.svg');
  await expect(row('tass').locator('img.flag')).toHaveAttribute('title', 'Russia');
  await expect(row('scmp').locator('img.flag')).toHaveAttribute('src', 'flags/hk.svg');
  await expect(row('euronews').locator('img.flag')).toHaveAttribute('title', 'European Union');
  // a pan-regional service is named by its UN region; an aggregator has no home
  await expect(row('allafrica').locator('svg.flag--intl')).toHaveAttribute('title', 'Africa');
  await expect(row('gnews').locator('svg.flag--intl')).toHaveAttribute('title', 'International');
  const flags = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="source-row"]')];
    return { rows: rows.length, flagged: rows.filter((r) => r.querySelector('.flag')).length };
  });
  expect(flags.flagged).toBe(flags.rows);
});

test('a story saved before sources carried a country resolves through the registry', async ({ page }) => {
  const old = {
    id: 'abcdef012345', title: 'Saved long ago: grain corridor talks', description: 'An older saved story.',
    url: 'https://tass.com/fixture/old', image: null, source: { id: 'tass', name: 'TASS', homepage: 'https://tass.com' },
    category: 'world', publishedAt: new Date(Date.now() - 3600_000).toISOString(), language: 'en',
  };
  await gotoFeed(page, { prefs: { category: 'saved', feedSub: 'saved', saved: [old] } });
  const card = page.getByTestId('card').first();
  await expect(card.locator('.card-src')).toHaveText('TASS');
  await expect(card.locator('.byline-country')).toHaveText('Russia');
  await expect(card.locator('img.flag')).toHaveAttribute('src', 'flags/ru.svg');
});
