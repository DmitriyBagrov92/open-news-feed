import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as store from '../../../lib/store.js';
import { tokenize, compute, getBattles } from '../../../lib/battles.js';

before(async () => { await store.seedFixture(new URL('../../fixtures/feed.json', import.meta.url).pathname); });

test('tokenize separates strong entities (with bigrams) from weak words', () => {
  const { all, strong, display } = tokenize("Supreme Court weighs Trump's tariffs on 2026 imports");
  assert.ok(strong.has('supreme_court') && strong.has('trump') && strong.has('2026'));
  assert.ok(!strong.has('tariffs') && all.has('tariffs'));
  assert.ok(!all.has('the'));
  assert.equal(display.get('supreme_court'), 'Supreme Court');
});

test('compute clusters the same story across leans', () => {
  const { battles } = compute();
  assert.ok(battles.length >= 3, `got ${battles.length}`);
  for (const b of battles) {
    assert.ok(Object.values(b.leans).filter(Boolean).length >= 2, 'two leans');
    assert.ok(new Set(b.articles.map((a) => a.source.id)).size >= 2, 'two sources');
    assert.ok(b.articles.length <= 9);
    assert.match(b.id, /^[0-9a-f]{12}$/);
  }
  const tariffs = battles.find((b) => b.topic.join(' ').includes('Supreme Court'));
  assert.ok(tariffs, 'tariffs cluster present');
  assert.ok(tariffs.leans.left && tariffs.leans.right);
});

test('getBattles caches per store refresh', () => {
  assert.equal(getBattles(), getBattles());
});
