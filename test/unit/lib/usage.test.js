import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { featureOf, usageMiddleware, snapshot } from '../../../lib/usage.js';

test('featureOf maps routes to features and ignores health/static', () => {
  const f = (path, method = 'GET') => featureOf({ path, method });
  assert.equal(f('/'), 'page_loads');
  assert.equal(f('/css/styles.css'), null);
  assert.equal(f('/api/health'), null);
  assert.equal(f('/api/news'), 'news');
  assert.equal(f('/api/comments', 'POST'), 'comments_posted');
  assert.equal(f('/api/comments'), 'comments_read');
  assert.equal(f('/api/comments/abc/vote', 'POST'), 'comment_votes');
  assert.equal(f('/api/news/abc/vote', 'POST'), 'story_votes');
  assert.equal(f('/api/whatever'), 'other_api');
});

test('middleware counts visitors, authors and status classes; snapshot resets', () => {
  const mw = usageMiddleware();
  const hit = (path, { ip = '1.1.1.1', author, status = 200, method = 'GET' } = {}) => {
    const res = new EventEmitter();
    res.statusCode = status;
    const req = { path, method, ip, get: (h) => (h.toLowerCase() === 'x-author-id' ? author : undefined) };
    mw(req, res, () => {});
    res.emit('finish');
  };
  snapshot();
  hit('/');
  hit('/api/news', { author: '123e4567-e89b-12d3-a456-426614174000' });
  hit('/api/news', { ip: '2.2.2.2', author: 'bogus' });
  hit('/api/summarize', { status: 501, method: 'POST' });
  hit('/api/reactions', { status: 429 });
  hit('/api/article', { status: 500 });
  const s = snapshot(() => ({ articles: 7 }));
  assert.equal(s.visitors, 2);
  assert.equal(s.authors, 1);
  assert.equal(s.page_loads, 1);
  assert.equal(s.news, 2);
  assert.equal(s.not_implemented, 1);
  assert.equal(s.rate_limited, 1);
  assert.equal(s.server_error, 1);
  assert.equal(s.articles, 7);
  assert.equal(snapshot().requests, 0);
});
