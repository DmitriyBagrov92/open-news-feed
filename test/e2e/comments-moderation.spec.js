// Comment moderation in the web client (App Store Guideline 1.2 parity with
// the apps): report a comment with a reason, block a commenter (managed in
// Settings), delete your own, and the link to the community rules.
import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { gotoFeed, cardByTitle, openSettings } from './_helpers.js';

// the browser projects share one server: every attempt seeds its own authors and bodies
async function seed(request, articleId, body, n, project) {
  const hex = createHash('sha1').update(`${project}:${n}:${Date.now()}:${Math.random()}`).digest('hex').slice(0, 12);
  const res = await request.post('/api/comments', {
    data: { articleId, body },
    headers: { 'X-Author-Id': `5eed${String(n).padStart(4, '0')}-aaaa-4bbb-8ccc-${hex}` },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

test('report, block and delete from a comment’s menu; unblock in Settings', async ({ page, request }, testInfo) => {
  const project = testInfo.project.name;
  const { articles } = await (await request.get('/api/news?pageSize=100')).json();
  const story = articles.find((a) => /Supreme Court to hear/.test(a.title));
  const reported = await seed(request, story.id, `Report me please (${project})`, 1, project);
  const blocked = await seed(request, story.id, `Block me please (${project})`, 2, project);

  await gotoFeed(page);
  await cardByTitle(page, /Supreme Court to hear/).click();
  await expect(page.getByTestId('preview')).toBeVisible();
  const rules = page.getByTestId('comments-rules');
  await rules.scrollIntoViewIfNeeded();
  await expect(rules).toHaveAttribute('href', '/terms');

  const row = (text) => page.getByTestId('comment').filter({ hasText: text });
  const menu = page.getByTestId('ctxmenu');

  // report: the reasons, then the comment is gone for this reader
  await expect(row(reported.body)).toBeVisible();
  await row(reported.body).getByTestId('comment-menu').click();
  await menu.getByRole('menuitem', { name: 'Report' }).click();
  await menu.getByRole('menuitem', { name: 'Spam or advertising' }).click();
  await expect(row(reported.body)).toHaveCount(0);
  await expect(page.getByText('Thanks — the comment was reported')).toBeVisible();

  // block: every comment by that commenter leaves
  await row(blocked.body).getByTestId('comment-menu').click();
  await menu.getByRole('menuitem', { name: `Block ${blocked.name}` }).click();
  await expect(row(blocked.body)).toHaveCount(0);

  // your own comment offers Delete (and nothing else)
  const input = page.getByTestId('comments-input');
  await input.fill(`Mine to delete (${project})`);
  await page.getByTestId('comments-post').click();
  await expect(row(`Mine to delete (${project})`)).toBeVisible();
  await row(`Mine to delete (${project})`).getByTestId('comment-menu').click();
  await expect(menu.getByRole('menuitem')).toHaveCount(1);
  await menu.getByRole('menuitem', { name: 'Delete my comment' }).click();
  await expect(row(`Mine to delete (${project})`)).toHaveCount(0);

  // Settings lists the blocked commenter; unblocking empties the list
  await page.getByTestId('preview-close').click();
  await openSettings(page);
  const blockedRow = page.getByTestId('blocked-row').filter({ hasText: blocked.name });
  await blockedRow.scrollIntoViewIfNeeded();
  await expect(blockedRow).toBeVisible();
  await blockedRow.getByTestId('unblock').click();
  await expect(page.getByTestId('blocked-list')).toContainText('No one is blocked.');
  await expect(page.getByTestId('link-terms')).toHaveAttribute('href', '/terms');
});
