import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as store from '../../../lib/store.js';

const FIXTURE = new URL('../../fixtures/feed.json', import.meta.url).pathname;

before(async () => { await store.seedFixture(FIXTURE); });

test('seedFixture applies the real ingestion rules', async () => {
  const raw = JSON.parse(await readFile(FIXTURE, 'utf8'));
  const s = store.stats();
  assert.ok(s.updatedAt);
  assert.ok(s.articles < raw.length, 'duplicate title and 9-day-old item were dropped');
  assert.equal(store.query({ pageSize: 100, q: 'Ancient history' }).total, 0);
  assert.equal(store.query({ pageSize: 100, q: 'Storm Idris nears' }).total, 1);
});

test('query filters, pages, clamps and reports latestId', () => {
  const all = store.query({ pageSize: 100 });
  assert.ok(all.total >= 60);
  for (let i = 1; i < all.articles.length; i += 1) {
    assert.ok(all.articles[i - 1].publishedAt >= all.articles[i].publishedAt, 'newest first');
  }
  assert.equal(all.latestId, all.articles[0].id);
  assert.ok(all.articles.every((a) => a.language === 'en'));
  assert.equal(store.query({ pageSize: 1000 }).pageSize, 100);
  const p2 = store.query({ page: 2, pageSize: 30 });
  assert.equal(p2.articles[0].id, all.articles[30].id);
  assert.equal(store.query({ category: 'sports' }).articles.every((a) => a.category === 'sports'), true);
  assert.ok(store.query({ q: 'ceasefire' }).total >= 2);
  const sources = store.query({ sources: 'espn' });
  assert.ok(sources.total > 0 && sources.articles.every((a) => a.source.id === 'espn'));
  assert.equal(store.query({ exclude: 'espn', pageSize: 100 }).articles.some((a) => a.source.id === 'espn'), false);
});

test('query mixes native-language feeds and honours since + histogram', () => {
  const mixed = store.query({ lang: 'de,en', pageSize: 100 });
  assert.equal(mixed.articles.filter((a) => a.language === 'de').length, 3);
  const all = store.query({ pageSize: 100 });
  const since = store.query({ since: all.articles[5].publishedAt, pageSize: 100 });
  assert.equal(since.total, 5);
  const h = store.query({ histogram: true });
  assert.equal(h.timeline.length, 24);
  assert.ok(h.timeline.reduce((a, b) => a + b, 0) > 0);
});

test('every story says where its publisher is based', () => {
  const all = store.query({ pageSize: 100 }).articles;
  const byId = new Map(all.map((a) => [a.source.id, a.source.country]));
  assert.equal(byId.get('bbc-world'), 'GB');
  assert.equal(byId.get('espn'), 'US');
  assert.equal(byId.get('aljazeera'), 'QA');
  assert.ok(all.every((a) => a.source.country === null || /^[A-Z]{2}$/.test(a.source.country)));
  const listed = store.listSources().sources;
  assert.ok(listed.every((s) => 'country' in s));
  assert.equal(listed.find((s) => s.id === 'gnews').country, null);
  // the partisan outlets are English-language media, not the zh list they once sat in
  assert.ok(store.battlePool().every((a) => a.language === 'en'));
});

test('battle-only sources never surface in the feed but do in the pool', () => {
  assert.equal(store.query({ pageSize: 100, q: 'Trump Tariffs' }).articles.some((a) => a.source.id === 'fox-news'), false);
  const pool = store.battlePool();
  assert.ok(pool.some((a) => a.source.id === 'fox-news' && a.lean === 'right'));
  assert.ok(pool.every((a) => a.lean));
  assert.ok(store.getArticle(pool[0].id));
});

test('append seeding puts newer stories first and keeps the old ones', async () => {
  const count = store.stats().articles;
  const added = await store.seedFixture(new URL('../../fixtures/feed.fresh.json', import.meta.url).pathname, { append: true });
  assert.equal(added, 3);
  assert.equal(store.stats().articles, count + 3);
  assert.match(store.query({ pageSize: 1 }).articles[0].title, /^Breaking/);
  await store.seedFixture(FIXTURE);
  assert.equal(store.stats().articles, count);
});
