import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, store } from '../helpers/server.js';

let base, close;
before(async () => ({ base, close } = await startServer()));
after(() => close());

const AUTH = { 'X-Author-Id': '123e4567-e89b-12d3-a456-426614174000' };
const get = (p, headers = {}) => fetch(base + p, { headers });
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('security headers and CSP on every response', async () => {
  const res = await get('/api/health');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assert.match(res.headers.get('content-security-policy'), /connect-src 'self'/);
  assert.equal(res.headers.get('x-powered-by'), null);
});

test('GET / renders the app shell with headlines, canonical and verification placeholders resolved', async () => {
  const res = await get('/');
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('cache-control'), /max-age=60/);
  assert.ok(!/__PUBLIC_URL__|__SSR_HEADLINES__|__SITE_VERIFICATION__/.test(html));
  assert.ok(html.includes('<link rel="canonical" href="https://test.meridi.info/">'));
  assert.equal((html.match(/<li>/g) || []).length, 30);
  assert.equal((await get('/index.html')).status, 200);
});

test('crawler files: robots, sitemap, IndexNow key, llms.txt, manifest', async () => {
  const robots = await (await get('/robots.txt')).text();
  assert.ok(robots.includes('Sitemap: https://test.meridi.info/sitemap.xml'));
  const sitemap = await (await get('/sitemap.xml')).text();
  assert.ok(sitemap.includes('<loc>https://test.meridi.info/</loc>'));
  const key = await get('/testkey0123456789.txt');
  assert.equal(key.status, 200);
  assert.equal((await key.text()).trim(), 'testkey0123456789');
  assert.equal((await get('/llms.txt')).status, 200);
  const manifest = await (await get('/manifest.webmanifest')).json();
  assert.equal(manifest.short_name, 'Meridian');
});

test('health reports the fixture store', async () => {
  const h = await (await get('/api/health')).json();
  assert.equal(h.ok, true);
  assert.equal(h.articles, store.stats().articles);
});

test('news: params, decoration, Vary header', async () => {
  const res = await get('/api/news?category=sports&pageSize=5', AUTH);
  assert.match(res.headers.get('vary'), /X-Author-Id/); // compression appends Accept-Encoding
  const body = await res.json();
  assert.ok(body.articles.length > 0 && body.articles.every((a) => a.category === 'sports'));
  assert.ok('commentCount' in body.articles[0] && 'myVote' in body.articles[0]);
  const mixed = await (await get('/api/news?lang=de,en&pageSize=100')).json();
  assert.equal(mixed.articles.filter((a) => a.language === 'de').length, 3);
  const h = await (await get('/api/news?histogram=1')).json();
  assert.equal(h.timeline.length, 24);
});

test('country: on every story and source, and the flags are served with a long cache', async () => {
  const news = await (await get('/api/news?pageSize=100')).json();
  assert.ok(news.articles.every((a) => a.source.country === null || /^([A-Z]{2}|\d{3})$/.test(a.source.country)));
  assert.equal(news.articles.find((a) => a.source.id === 'bbc-world').source.country, 'GB');
  const { sources } = await (await get('/api/sources')).json();
  assert.equal(sources.find((s) => s.id === 'tass').country, 'RU');
  assert.equal(sources.find((s) => s.id === 'newsdata').country, null);
  const flag = await get('/flags/gb.svg');
  assert.equal(flag.status, 200);
  assert.match(flag.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(flag.headers.get('cache-control'), /max-age=2592000/);
  assert.match(flag.headers.get('cache-control'), /immutable/);
  assert.equal((await get('/flags/zz.svg')).status, 404);
});

test('sources and battles', async () => {
  const s = await (await get('/api/sources')).json();
  assert.ok(s.sources.length > 60 && s.categories.length === 7 && s.languages.includes('de'));
  const b = await get('/api/battles');
  assert.match(b.headers.get('cache-control'), /max-age=60/);
  assert.ok((await b.json()).battles.length >= 3);
});

test('article extraction: fixture page, unreadable page, 404 upstream, SSRF guard', async () => {
  const ok = await (await get('/api/article?url=' + encodeURIComponent('https://www.bbc.com/fixture/story-a'))).json();
  assert.match(ok.title, /Storm Idris/);
  assert.ok(ok.blocks.length >= 5);
  const gone = await get('/api/article?url=' + encodeURIComponent('https://www.cnbc.com/fixture/story-22'));
  assert.equal(gone.status, 422);
  assert.equal((await gone.json()).error.code, 'fetch-failed');
  const ssrf = await get('/api/article?url=' + encodeURIComponent('https://169.254.169.254/latest'));
  assert.equal(ssrf.status, 403);
  assert.equal((await ssrf.json()).error.code, 'host-not-allowed');
  assert.equal((await get('/api/article')).status, 400);
});

test('summarize is 501 premium-only; translate validates and uses the stubbed fallback', async () => {
  const s = await post('/api/summarize', { mode: 'brief' });
  assert.equal(s.status, 501);
  assert.equal((await s.json()).error.code, 'premium-only');
  const t = await (await post('/api/translate', { texts: ['Hello'], target: 'de' })).json();
  assert.deepEqual(t, { translations: ['[de] Hello'], provider: 'mymemory' });
  assert.equal((await post('/api/translate', { texts: [], target: 'de' })).status, 400);
  assert.equal((await post('/api/translate', { texts: ['x'], target: 'German' })).status, 400);
});

test('comments and votes end to end', async () => {
  const { articles } = await (await get('/api/news?pageSize=1')).json();
  const id = articles[0].id;
  assert.equal((await post('/api/comments', { articleId: id, body: 'hello' })).status, 400, 'author header required');
  const created = await post('/api/comments', { articleId: id, body: 'hello from the suite' }, AUTH);
  assert.equal(created.status, 201);
  const comment = await created.json();
  assert.equal((await post('/api/comments', { articleId: '000000000000', body: 'x' }, AUTH)).status, 404);
  const list = await (await get('/api/comments?article=' + id, AUTH)).json();
  assert.equal(list.total, 1);
  assert.equal(list.comments[0].body, 'hello from the suite');
  const v = await (await post(`/api/comments/${comment.id}/vote`, { value: 1 }, { 'X-Author-Id': '223e4567-e89b-12d3-a456-426614174000' })).json();
  assert.deepEqual(v, { up: 1, down: 0, myVote: 1 });
  const av = await (await post(`/api/news/${id}/vote`, { value: -1 }, AUTH)).json();
  assert.deepEqual(av, { up: 0, down: 1, myVote: -1 });
  const r = await (await get('/api/reactions?articles=' + id + ',000000000000', AUTH)).json();
  assert.deepEqual(r.reactions[id], { comments: 1, up: 0, down: 1, myVote: -1 });
  assert.equal((await get('/api/reactions?articles=zzz')).status, 400);
});

test('unknown api routes are 404 in the error shape', async () => {
  const res = await get('/api/nope');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: { code: 'not-found', message: 'Unknown API endpoint' } });
});

test('rate limit: the comment-post bucket trips at 5/min per address', async () => {
  const headers = { ...AUTH, 'X-Forwarded-For': '203.0.113.9' };
  const { articles } = await (await get('/api/news?pageSize=1')).json();
  const statuses = [];
  for (let i = 0; i < 6; i += 1) {
    statuses.push((await post('/api/comments', { articleId: articles[0].id, body: 'burst ' + i }, headers)).status);
  }
  assert.equal(statuses[5], 429);
});

test('fixture routes raise and rewind the feed', async () => {
  const before_ = store.stats().articles;
  const adv = await (await post('/__fixture/advance', {})).json();
  assert.equal(adv.added, 3);
  assert.equal(adv.articles, before_ + 3);
  const reset = await (await post('/__fixture/reset', {})).json();
  assert.equal(reset.articles, before_);
});
