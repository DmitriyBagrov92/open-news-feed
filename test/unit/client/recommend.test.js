import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installClientShims } from '../../helpers/client-shims.js';

installClientShims();
const { applyRating, pickOnboardingCandidates, rankForYou } = await import('../../../public/js/recommend.js');

const taste = () => ({ count: 0, sources: {}, cats: {}, tokens: {}, rated: [] });
const art = (id, source, category, title, image = true) => ({ id, source: { id: source, name: source }, category, title, image, publishedAt: new Date().toISOString() });

test('applyRating moves weights within bounds and remembers the id', () => {
  const t = taste();
  const a = art('0123456789ab', 'espn', 'sports', 'Shelton wins US Open final');
  for (let i = 0; i < 40; i += 1) applyRating(t, a, 1);
  assert.equal(t.sources.espn, 50);
  assert.equal(t.cats.sports, 40);
  assert.ok(t.tokens.shelton > 0);
  assert.equal(t.count, 40);
  assert.equal(t.rated[0], a.id);
  applyRating(t, a, -1);
  assert.equal(t.sources.espn, 48);
});

test('pickOnboardingCandidates is diverse and skips rated/saved', () => {
  const t = taste();
  const list = [];
  for (let i = 0; i < 30; i += 1) list.push(art('id' + i, 'src' + (i % 10), ['world', 'sports', 'tech'][i % 3], 'Title ' + i));
  t.rated.push('id0');
  const out = pickOnboardingCandidates(list, t, new Set(['id1']), 12);
  assert.ok(out.length <= 12 && out.length > 5);
  assert.ok(!out.some((a) => a.id === 'id0' || a.id === 'id1'));
  assert.equal(new Set(out.map((a) => a.source.id)).size, out.length, 'one story per source');
});

test('rankForYou favours liked sources and categories', () => {
  const t = taste();
  const liked = art('l1', 'espn', 'sports', 'Shelton reaches US Open final');
  applyRating(t, liked, 1); applyRating(t, liked, 1); applyRating(t, liked, 1);
  const pool = [
    art('p1', 'bbc-world', 'world', 'Storm nears the coast'),
    art('p2', 'espn', 'sports', 'Shelton wins the US Open'),
    art('p3', 'nature', 'science', 'Fusion record'),
  ];
  const { articles, personalized } = rankForYou(pool, t, new Set());
  assert.equal(articles[0].id, 'p2');
  assert.equal(typeof personalized, 'boolean');
});
