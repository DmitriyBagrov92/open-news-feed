// Shared steps for the end-to-end specs. Everything here is behavioural
// plumbing, not assertions: block the two external requests the page makes
// (web fonts, article images) so runs are offline and deterministic, seed
// preferences before boot, and drive the gestures the app understands.
import { expect } from '@playwright/test';

export const AUTHOR = '123e4567-e89b-12d3-a456-426614174000';

export async function blockExternal(page) {
  await page.route(/^https?:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|images\.example\.net)\//, (route) => route.abort());
  // The test browser may ship Chrome's built-in AI (Summarizer, Translator,
  // LanguageModel). Real models are slow and non-deterministic: hide them so
  // the brief takes the local rung, translation the stubbed server rung and
  // the forecast only its mock — exactly what a browser without them does.
  await page.addInitScript(() => {
    for (const name of ['Summarizer', 'Translator', 'LanguageDetector', 'LanguageModel', 'Writer', 'Rewriter']) {
      try { delete self[name]; } catch { /* non-configurable */ }
      if (name in self) Object.defineProperty(self, name, { value: undefined, configurable: true });
    }
  });
}

// Find a story card by (part of) its title — the feed order can shift while
// another spec raises fresh stories, so content-sensitive specs never rely
// on an index.
export const cardByTitle = (page, re) => page.getByTestId('card').filter({ has: page.locator('.card-title', { hasText: re }) }).first();

export async function seedPrefs(page, prefs) {
  await page.addInitScript((p) => {
    localStorage.setItem('meridian:prefs', JSON.stringify(p));
  }, prefs);
}

// Open the feed and wait for the first page of stories to be in the grid.
export async function gotoFeed(page, { query = '', prefs } = {}) {
  await blockExternal(page);
  if (prefs) await seedPrefs(page, prefs);
  await page.goto('/' + query);
  await expect(page.getByTestId('card').first()).toBeVisible();
  await expect(page.locator('#grid .card--skeleton')).toHaveCount(0);
}

export const cards = (page) => page.getByTestId('card');

export async function openPreview(page, index = 0) {
  await cards(page).nth(index).click();
  const dialog = page.getByTestId('preview');
  await expect(dialog).toBeVisible();
  return dialog;
}

// Click a control at a point that really receives pointer events. At
// 900–1400px the fixed time rail overlaps the right-hand controls (gear,
// brief refresh, forecast close); chrome.spec pins that as a known gap the
// redesign shell removes. Until then the suite clicks the uncovered part.
export async function clickUncovered(locator) {
  await locator.scrollIntoViewIfNeeded();
  const point = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    // pushed past the viewport edge, or the page overflowed sideways and
    // the phone zoomed out (the forecast header does this today): screen
    // and layout coordinates no longer agree, so no point is trustworthy
    const zoomedOut = window.visualViewport && window.visualViewport.scale < 0.999;
    const viewportW = Math.min(window.innerWidth, document.documentElement.clientWidth);
    if (zoomedOut || r.left < 0 || r.right > viewportW) return null;
    for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9]) {
      for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) {
        const x = r.x + r.width * fx;
        const y = r.y + r.height * fy;
        const hit = document.elementFromPoint(x, y);
        if (hit && (hit === el || el.contains(hit))) return { x: r.width * fx, y: r.height * fy };
      }
    }
    return null;
  });
  if (point) await locator.click({ position: point });
  else await locator.dispatchEvent('click'); // fully covered: the handler still runs
}

export async function openSettings(page) {
  await clickUncovered(page.getByTestId('settings-toggle'));
  const sheet = page.getByTestId('settings-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toHaveClass(/open/);
  return sheet;
}

export const isMobile = (testInfo) => testInfo.project.name === 'mobile';
export const isReduced = (testInfo) => testInfo.project.name === 'reduced-motion';

// The forecast pull: mouse wheel at the top of the page on desktop, a
// synthetic touch drag on the phone (page.touchscreen only taps).
export async function pullForecast(page, testInfo) {
  await page.evaluate(() => window.scrollTo(0, 0));
  if (isMobile(testInfo)) {
    await page.evaluate(() => {
      const touch = (type, y) => {
        const t = new Touch({ identifier: 1, target: document.body, clientX: 100, clientY: y });
        window.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true }));
      };
      touch('touchstart', 100);
      for (let y = 110; y <= 460; y += 50) touch('touchmove', y);
      touch('touchend', 460);
    });
    return;
  }
  for (let i = 0; i < 6; i += 1) {
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(40);
  }
}

// Raise three newer stories on the server (the "new stories" fixture) and
// undo it afterwards so parallel specs keep a stable feed.
export async function withFreshStories(request, fn) {
  await request.post('/__fixture/advance');
  try {
    await fn();
  } finally {
    await request.post('/__fixture/reset');
  }
}
