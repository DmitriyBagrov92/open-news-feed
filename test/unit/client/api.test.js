import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError } from '../../../public/js/api.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('news builds a query string and returns parsed JSON', async () => {
  let seen;
  globalThis.fetch = async (path, opts) => { seen = { path, opts }; return { ok: true, status: 200, json: async () => ({ articles: [] }) }; };
  const out = await api.news({ category: 'world', page: 2, q: '' }, '123e4567-e89b-12d3-a456-426614174000');
  assert.deepEqual(out, { articles: [] });
  assert.ok(seen.path.startsWith('/api/news?'));
  assert.ok(seen.path.includes('category=world') && seen.path.includes('page=2') && !seen.path.includes('q='));
});

test('errors carry the server code, or network/bad-json', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({ error: { code: 'unknown-article', message: 'gone' } }) });
  await assert.rejects(api.comments('abc'), (e) => e instanceof ApiError && e.status === 404 && e.code === 'unknown-article');
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(api.sources(), (e) => e instanceof ApiError && e.status === 0 && e.code === 'network');
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => { throw new Error('nope'); } });
  await assert.rejects(api.sources(), (e) => e.code === 'bad-json');
});
