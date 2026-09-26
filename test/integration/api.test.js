import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, store } from '../helpers/server.js';

let base, close;
before(async () => ({ base, close } = await startServer()));
after(() => close());

const AUTH = { 'X-Author-Id': '123e4567-e89b-12d3-a456-426614174000' };
const get = (p, headers = {}) => fetch(base + p, { headers });
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const del = (p, headers = {}) => fetch(base + p, { method: 'DELETE', headers });
// a fresh anonymous author (and its own address, so per-IP buckets never collide between tests)
let authorSeq = 0;
const author = () => {
  authorSeq += 1;
  return {
    'X-Author-Id': `${String(authorSeq).padStart(8, '0')}-aaaa-4bbb-8ccc-${String(authorSeq).padStart(12, '0')}`,
    'X-Forwarded-For': `198.51.100.${authorSeq}`,
  };
};

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
  const responses = [];
  for (let i = 0; i < 6; i += 1) {
    responses.push(await post('/api/comments', { articleId: articles[0].id, body: 'burst ' + i }, headers));
  }
  assert.equal(responses[5].status, 429);
  const wait = Number(responses[5].headers.get('retry-after'));
  assert.ok(wait >= 1 && wait <= 60, `Retry-After ${wait}`);
});

test('fixture routes raise and rewind the feed', async () => {
  const before_ = store.stats().articles;
  const adv = await (await post('/__fixture/advance', {})).json();
  assert.equal(adv.added, 3);
  assert.equal(adv.articles, before_ + 3);
  const reset = await (await post('/__fixture/reset', {})).json();
  assert.equal(reset.articles, before_);
});

test('moderation: authors see their own comments, readers report, three reports hide, authors delete', async () => {
  const { articles } = await (await get('/api/news?pageSize=3')).json();
  const id = articles[2].id;
  const writer = author();
  const created = await (await post('/api/comments', { articleId: id, body: 'A take worth arguing about' }, writer)).json();
  assert.match(created.authorKey, /^[0-9a-f]{16}$/);
  assert.equal(created.mine, true);
  const seen = await (await get('/api/comments?article=' + id, author())).json();
  assert.equal(seen.comments[0].mine, false);
  assert.equal(seen.comments[0].authorKey, created.authorKey);

  const own = await post(`/api/comments/${created.id}/report`, { reason: 'spam' }, writer);
  assert.equal(own.status, 400);
  assert.equal((await own.json()).error.code, 'own-comment');
  assert.equal((await post(`/api/comments/${created.id}/report`, { reason: 'boring' }, author())).status, 400);
  assert.equal((await post('/api/comments/0000000000000000/report', {}, author())).status, 404);
  assert.equal((await post('/api/comments/nope/report', {}, author())).status, 400);
  assert.equal((await post(`/api/comments/${created.id}/report`, {})).status, 400, 'author header required');

  const answers = [];
  for (const reason of ['spam', 'abuse', undefined]) {
    answers.push(await (await post(`/api/comments/${created.id}/report`, { reason }, author())).json());
  }
  assert.deepEqual(answers, [
    { reported: true, hidden: false },
    { reported: true, hidden: false },
    { reported: true, hidden: true },
  ]);
  assert.equal((await (await get('/api/comments?article=' + id)).json()).total, 0);

  const mine = await (await post('/api/comments', { articleId: id, body: 'Second thoughts' }, author())).json();
  const stranger = await del('/api/comments/' + mine.id, author());
  assert.equal(stranger.status, 403);
  assert.equal((await stranger.json()).error.code, 'not-owner');
});

test('moderation: delete your own, the objectionable filter, Retry-After on too-fast', async () => {
  const { articles } = await (await get('/api/news?pageSize=4')).json();
  const id = articles[3].id;
  const writer = author();
  const created = await (await post('/api/comments', { articleId: id, body: 'Posted in haste' }, writer)).json();
  const fast = await post('/api/comments', { articleId: id, body: 'And again at once' }, writer);
  assert.equal(fast.status, 429);
  assert.equal((await fast.json()).error.code, 'too-fast');
  const wait = Number(fast.headers.get('retry-after'));
  assert.ok(wait >= 1 && wait <= 10, `Retry-After ${wait}`);
  const gone = await del('/api/comments/' + created.id, writer);
  assert.equal(gone.status, 200);
  assert.deepEqual(await gone.json(), { deleted: true });
  assert.equal((await del('/api/comments/' + created.id, writer)).status, 404);
  const refused = await post('/api/comments', { articleId: id, body: 'kys' }, author());
  assert.equal(refused.status, 422);
  assert.equal((await refused.json()).error.code, 'objectionable');
});

test('admin: off without ADMIN_TOKEN, a bearer token lists reports, restores, bans and unbans', async () => {
  const adminGet = (p, token) => get(p, { Authorization: `Bearer ${token}`, 'X-Forwarded-For': '192.0.2.10' });
  delete process.env.ADMIN_TOKEN;
  assert.equal((await adminGet('/api/admin/reports', 'anything')).status, 404);
  process.env.ADMIN_TOKEN = 'test-admin-token-0123456789';
  try {
    assert.equal((await adminGet('/api/admin/reports', 'wrong-token')).status, 401);
    const auth = { Authorization: 'Bearer test-admin-token-0123456789', 'X-Forwarded-For': '192.0.2.11' };

    const { articles } = await (await get('/api/news?pageSize=5')).json();
    const id = articles[4].id;
    const troll = author();
    const c = await (await post('/api/comments', { articleId: id, body: 'Contrarian as ever' }, troll)).json();
    await post(`/api/comments/${c.id}/report`, { reason: 'abuse' }, author());
    const queue = await (await get('/api/admin/reports', auth)).json();
    const entry = queue.reports.find((r) => r.id === c.id);
    assert.deepEqual([entry.reports, entry.reasons, entry.hidden, entry.authorKey], [1, ['abuse'], false, c.authorKey]);

    assert.deepEqual(await (await post(`/api/admin/comments/${c.id}/hide`, { reason: 'abuse' }, auth)).json(), { id: c.id, hidden: true });
    assert.equal((await (await get('/api/comments?article=' + id)).json()).total, 0);
    assert.deepEqual(await (await post(`/api/admin/comments/${c.id}/restore`, {}, auth)).json(), { id: c.id, hidden: false });
    assert.equal((await (await get('/api/comments?article=' + id)).json()).total, 1);

    const ban = await post('/api/admin/bans', { authorKey: c.authorKey, reason: 'repeat abuse' }, auth);
    assert.equal(ban.status, 201);
    assert.equal((await ban.json()).authorKey, c.authorKey);
    assert.equal((await (await get('/api/comments?article=' + id)).json()).total, 0, 'a banned author’s comments leave the lists');
    await new Promise((resolve) => setTimeout(resolve, 10));
    const blocked = await post('/api/comments', { articleId: id, body: 'Let me back in' }, troll);
    assert.equal(blocked.status, 403);
    assert.equal((await blocked.json()).error.code, 'banned');
    assert.ok((await (await get('/api/admin/bans', auth)).json()).bans.some((b) => b.authorKey === c.authorKey));
    assert.equal((await del('/api/admin/bans/' + c.authorKey, auth)).status, 200);
    assert.equal((await del('/api/admin/bans/' + c.authorKey, auth)).status, 404);
    assert.equal((await post('/api/admin/bans', { authorKey: 'nope' }, auth)).status, 400);
    assert.deepEqual(await (await del(`/api/admin/comments/${c.id}`, auth)).json(), { id: c.id, deleted: true });
    assert.equal((await del(`/api/admin/comments/${c.id}`, auth)).status, 404);
  } finally {
    delete process.env.ADMIN_TOKEN;
  }
});

test('privacy, terms and support pages carry the support address', async () => {
  delete process.env.SUPPORT_EMAIL;
  const bare = await (await get('/support')).text();
  assert.match(bare, /not configured yet/);
  process.env.SUPPORT_EMAIL = 'help@example.com';
  try {
    for (const [page, title] of [['privacy', 'Privacy Policy'], ['terms', 'Terms of Use'], ['support', 'Support']]) {
      const res = await get('/' + page);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
      const html = await res.text();
      assert.ok(html.includes(`<title>${title}`), page);
      assert.ok(html.includes('mailto:help@example.com'), page);
      assert.ok(html.includes(`<link rel="canonical" href="https://test.meridi.info/${page}">`), page);
    }
    assert.match(await (await get('/terms')).text(), /zero tolerance for objectionable content and abusive users/);
    assert.match(await (await get('/privacy/')).text(), /<title>Privacy Policy/, 'a trailing slash is the same page');
  } finally {
    delete process.env.SUPPORT_EMAIL;
  }
});
