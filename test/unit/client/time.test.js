import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshness, relTime, relFuture, absTime } from '../../../public/js/time.js';

const now = Date.parse('2026-09-13T12:00:00Z');
const ago = (min) => new Date(now - min * 60_000).toISOString();

test('freshness buckets', () => {
  assert.equal(freshness(ago(5), now), 'live');
  assert.equal(freshness(ago(120), now), 'recent');
  assert.equal(freshness(ago(600), now), 'stale');
});

test('relTime voice', () => {
  assert.equal(relTime(ago(0), now), 'JUST NOW');
  assert.equal(relTime(ago(7), now), '7 MIN AGO');
  assert.equal(relTime(ago(60), now), '1 HR AGO');
  assert.equal(relTime(ago(180), now), '3 HRS AGO');
  assert.equal(relTime(ago(1440), now), '1 DAY AGO');
  assert.equal(relTime(ago(-30), now), 'JUST NOW', 'the future is clamped');
  assert.equal(relTime('garbage', now), '');
});

test('relFuture counts down for forecasts', () => {
  assert.equal(relFuture(ago(-30), now), 'ANY MOMENT');
  assert.equal(relFuture(ago(-300), now), 'WITHIN 5 HRS');
  assert.equal(relFuture(ago(-72 * 60), now), 'WITHIN 3 DAYS');
  assert.equal(relFuture(ago(-168 * 60), now), 'THIS WEEK');
});

test('absTime formats or returns empty', () => {
  assert.match(absTime('2026-09-13T12:00:00Z'), /2026/);
  assert.equal(absTime('nope'), '');
});
