import { test, expect } from '@playwright/test';
import { gotoFeed, isReduced, navTo } from './_helpers.js';

test('Bubble Battle clusters the fixture stories across leans', async ({ page }, testInfo) => {
  await gotoFeed(page);
  await navTo(page, 'battle');
  const battle = page.getByTestId('battle');
  await expect(battle).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/battle-mode/);
  await expect(page.getByTestId('grid')).toBeHidden();
  await expect(page.getByTestId('brief')).toBeHidden();

  const bubbles = page.getByTestId('bubble');
  await expect.poll(() => bubbles.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(6);
  const leans = await page.evaluate(() => [...new Set([...document.querySelectorAll('.bubble')].map((b) => b.dataset.lean))]);
  expect(leans.length).toBeGreaterThanOrEqual(2);

  if (isReduced(testInfo)) {
    await expect(battle).toHaveClass(/battle--static/);
    await expect(page).toHaveScreenshot('battle-static.png', { fullPage: false, mask: [page.getByTestId('wire'), page.getByTestId('feed-date')] });
  } else {
    await expect(battle).not.toHaveClass(/battle--static/);
    // a drag moves a bubble (physics); a click opens its story
    const bubble = bubbles.first();
    await expect(bubble).toBeVisible();
    const before = await bubble.evaluate((b) => b.style.transform);
    const box = await bubble.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i += 1) await page.mouse.move(box.x + box.width / 2 + i * 20, box.y + box.height / 2 + i * 10);
    await page.waitForTimeout(450);
    await page.mouse.up();
    await expect.poll(() => bubble.evaluate((b) => b.style.transform)).not.toBe(before);
  }

  await bubbles.nth(1).click({ force: true }); // physics keeps bubbles moving — never "stable"
  await expect(page.getByTestId('preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('preview')).toBeHidden();

  await navTo(page, 'all');
  await expect(battle).toBeHidden();
  await expect(page.getByTestId('grid')).toBeVisible();
});

test('Bubble Battle links are drawn between the bubbles, not stretched over the page', async ({ page }, testInfo) => {
  test.skip(isReduced(testInfo), 'the static layout draws no links');
  await gotoFeed(page);
  await navTo(page, 'battle');
  const bubbles = page.getByTestId('bubble');
  await expect.poll(() => bubbles.count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(6);
  await bubbles.first().evaluate((b) => b.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(1500); // let the packing settle a little

  // the links canvas covers exactly the viewport, whatever its ancestors do
  const box = await page.evaluate(() => {
    const r = document.getElementById('battleLinks').getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, vw: document.documentElement.clientWidth, vh: document.documentElement.clientHeight };
  });
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.y)).toBe(0);
  expect(Math.round(box.w)).toBe(box.vw);
  expect(Math.round(box.h)).toBe(box.vh);

  // and a link line really runs between a bubble and its nearest sibling
  const attached = await page.evaluate(() => {
    const canvas = document.getElementById('battleLinks');
    const ctx = canvas.getContext('2d');
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const vh = document.documentElement.clientHeight;
    const centers = [...document.querySelectorAll('.bubble')]
      .map((b) => b.getBoundingClientRect())
      .map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))
      .filter((c) => c.y > 0 && c.y < vh);
    let hits = 0;
    for (const a of centers) {
      const b = centers.filter((c) => c !== a).sort((p, q) => Math.hypot(p.x - a.x, p.y - a.y) - Math.hypot(q.x - a.x, q.y - a.y))[0];
      if (!b) continue;
      const mx = Math.round(((a.x + b.x) / 2) * scale);
      const my = Math.round(((a.y + b.y) / 2) * scale);
      const px = ctx.getImageData(mx - 3, my - 3, 7, 7).data;
      let lit = false;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 20) lit = true;
      if (lit) hits += 1;
    }
    return { hits, total: centers.length };
  });
  expect(attached.total).toBeGreaterThanOrEqual(2);
  expect(attached.hits).toBeGreaterThanOrEqual(1);
});
