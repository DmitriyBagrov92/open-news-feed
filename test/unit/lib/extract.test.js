import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAllowedHost, absHttp, contentDocument, paragraphsOf, blocksOf, extractArticle, ExtractError } from '../../../lib/extract.js';

const page = (slug) => readFile(new URL(`../../fixtures/pages/${slug}.html`, import.meta.url), 'utf8');
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('isAllowedHost accepts registry hosts and their subdomains only', () => {
  assert.equal(isAllowedHost('www.bbc.com'), true);
  assert.equal(isAllowedHost('feeds.bbci.co.uk'), true);
  assert.equal(isAllowedHost('evil.com'), false);
  assert.equal(isAllowedHost('bbc.com.evil.com'), false);
});

test('absHttp resolves relative links and rejects non-http schemes', () => {
  assert.equal(absHttp('/x', 'https://a.com/b/c'), 'https://a.com/x');
  assert.equal(absHttp('javascript:alert(1)', 'https://a.com'), null);
  assert.equal(absHttp('', 'https://a.com'), null);
});

test('blocksOf keeps headings, lists, quotes and links as text runs', async () => {
  const html = await page('story-a');
  const article = html.slice(html.indexOf('<article>'), html.indexOf('</article>') + 10);
  const doc = contentDocument(article);
  const blocks = blocksOf(doc, 'https://www.bbc.com/fixture/story-a');
  const types = blocks.map((b) => b.type);
  assert.ok(types.includes('h2') && types.includes('ul') && types.includes('quote'), types);
  const link = blocks.flatMap((b) => b.runs || []).find((r) => r.href);
  assert.equal(link.href, 'https://www.bbc.com/fixture/story-b');
  assert.ok(blocks.flatMap((b) => b.runs || []).some((r) => r.b), 'bold run kept');
  const text = paragraphsOf(doc, '');
  assert.ok(text.startsWith('Forecasters expect Storm Idris'), text.slice(0, 40));
});

test('extractArticle refuses hosts outside the allowlist before fetching', async () => {
  globalThis.fetch = async () => { throw new Error('must not be called'); };
  await assert.rejects(extractArticle('https://evil.com/x'), (err) => err instanceof ExtractError && err.status === 403);
});

test('extractArticle reads a fixture page through a stubbed fetch', async () => {
  const html = await page('story-a');
  globalThis.fetch = async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  const out = await extractArticle('https://www.bbc.com/fixture/story-a');
  assert.match(out.title, /Storm Idris/);
  assert.equal(out.image, 'https://images.example.net/fixture/story-a-og.jpg');
  assert.ok(out.blocks.length >= 5);
});
