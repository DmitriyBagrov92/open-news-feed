import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeedDate, itemImage, imageUrl } from '../../../lib/fetchers/rss.js';
import { mapCategory } from '../../../lib/fetchers/apis.js';

test('parseFeedDate treats a bare ISO datetime as UTC', () => {
  assert.equal(parseFeedDate('2026-07-18T09:30:00').toISOString(), '2026-07-18T09:30:00.000Z');
  assert.equal(parseFeedDate('Sat, 18 Jul 2026 09:30:00 GMT').toISOString(), '2026-07-18T09:30:00.000Z');
  assert.equal(parseFeedDate(''), null);
});

test('itemImage prefers media:content by width, then thumbnail, enclosure, inline img', () => {
  assert.equal(itemImage({ mediaContent: [{ $: { url: 'https://a/small.jpg', width: '100' } }, { $: { url: 'https://a/big.jpg', width: '800' } }] }), 'https://a/big.jpg');
  assert.equal(itemImage({ mediaContent: [{ $: { url: 'https://a/v.mp4', medium: 'video' } }], mediaThumbnail: [{ $: { url: '//a/t.jpg' } }] }), 'https://a/t.jpg');
  assert.equal(itemImage({ enclosure: { url: 'https://a/e.png', type: 'image/png' } }), 'https://a/e.png');
  assert.equal(itemImage({ enclosure: { url: 'https://a/e.mp3', type: 'audio/mpeg' }, content: '<img src="https://a/c.jpg">' }), 'https://a/c.jpg');
  assert.equal(itemImage({}), null);
  assert.equal(imageUrl('javascript:alert(1)'), null);
});

test('mapCategory folds provider sections into the seven categories', () => {
  assert.equal(mapCategory('Technology'), 'technology');
  assert.equal(mapCategory('Middle East'), 'world');
  assert.equal(mapCategory('realestate'), 'business');
  assert.equal(mapCategory('anything-else'), 'world');
  assert.equal(mapCategory(''), 'world');
});
