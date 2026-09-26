#!/usr/bin/env node
// API fixtures for the iOS app, captured from the REAL server.
//
// Boots server.js in-process in fixture mode (test/fixtures/feed.json, the
// same offline newsroom the Playwright suite uses), exercises every endpoint
// the app calls and writes each exchange to ios/Tests/Fixtures/api/<name>.json
// as { request, status, body }. Swift decoding tests, the fake API client and
// UI tests all read these files, so the iOS models are checked against what
// the server really sends — not against a hand-written guess.
//
//   node ios/scripts/capture-fixtures.mjs
//
// Deterministic: the clock is frozen (fixture ages are relative to "now"),
// comment ids — random on the server — are renumbered in capture order, and
// the three comment authors have fixed UUIDs.

import { execSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'ios', 'Tests', 'Fixtures', 'api');

// ── frozen clock (must precede every server import) ─────────────────────────
export const CAPTURED_AT = '2026-09-26T12:00:00.000Z';
let clock = Date.parse(CAPTURED_AT);
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [clock]));
  }
  static now() {
    return clock;
  }
}
globalThis.Date = FrozenDate;
const advance = (ms) => {
  clock += ms;
};

process.env.RATE_LIMIT_DISABLED = '1';
process.env.PUBLIC_URL = 'https://fixtures.meridi.info';
// the admin API is not part of the app: only used to set up the banned-author exchange
process.env.ADMIN_TOKEN = 'fixture-admin-token';
const ADMIN = { Authorization: 'Bearer fixture-admin-token' };
const { startServer } = await import(pathToFileURL(path.join(ROOT, 'test/helpers/server.js')).href);
const { base, close } = await startServer();

// ── helpers ──────────────────────────────────────────────────────────────────
const AUTHORS = {
  amber: '1f0e5a2c-6b7d-4e8f-9a0b-1c2d3e4f5a6b',
  quiet: '2a1b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
  solar: '3b2c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e',
};
const files = new Map();

async function call(name, method, pathAndQuery, { body, author, headers: extra = {} } = {}) {
  const headers = { ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (author) headers['X-Author-Id'] = author;
  const res = await fetch(base + pathAndQuery, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  const request = { method, path: pathAndQuery };
  if (author) request.author = Object.keys(AUTHORS).find((k) => AUTHORS[k] === author);
  if (body !== undefined) request.body = body;
  if (name) files.set(name, { request, status: res.status, body: parsed });
  return parsed;
}
const get = (name, p, opts) => call(name, 'GET', p, opts);
const post = (name, p, body, opts = {}) => call(name, 'POST', p, { ...opts, body });
const del = (name, p, opts) => call(name, 'DELETE', p, opts);

// ── feed ─────────────────────────────────────────────────────────────────────
const page1 = await get('news-page1', '/api/news?page=1&pageSize=30');
await get('news-page2', '/api/news?page=2&pageSize=30');
await get('news-page3', '/api/news?page=3&pageSize=30');
await get('news-all', '/api/news?pageSize=100');
await get('news-all-de', '/api/news?lang=de,en&pageSize=100');
await get('news-world', '/api/news?category=world&pageSize=30');
await get('news-technology', '/api/news?category=technology&pageSize=30');
await get('news-search', '/api/news?q=storm&pageSize=30');
await get('news-search-empty', '/api/news?q=zzzqqxx&pageSize=30');
await get('news-exclude', '/api/news?exclude=bbc-world,npr-world&pageSize=30');
await get('news-histogram', '/api/news?pageSize=1&histogram=1');
await get('news-since-none', `/api/news?since=${encodeURIComponent(page1.articles[0].publishedAt)}&pageSize=100`);
await get('sources', '/api/sources');
await get('battles', '/api/battles');
await get('health', '/api/health');

// ── article extraction ───────────────────────────────────────────────────────
const byUrl = (slug) => page1.articles.find((a) => a.url.endsWith(`/fixture/${slug}`)) ||
  (files.get('news-all').body.articles.find((a) => a.url.endsWith(`/fixture/${slug}`)));
const storyA = byUrl('story-a');
const storyB = byUrl('story-b');
const storyC = byUrl('story-c');
await get('article-story-a', `/api/article?url=${encodeURIComponent(storyA.url)}`);
await get('article-story-b', `/api/article?url=${encodeURIComponent(storyB.url)}`);
await get('article-story-c-paywall', `/api/article?url=${encodeURIComponent(storyC.url)}`);
await get('article-missing-page-422', `/api/article?url=${encodeURIComponent('https://www.bbc.com/fixture/no-such-page')}`);
await get('article-forbidden-403', `/api/article?url=${encodeURIComponent('https://evil.example.net/x')}`);
await get('article-missing-400', '/api/article');

// ── AI endpoints ─────────────────────────────────────────────────────────────
await post('translate-de', '/api/translate', { texts: [storyA.title, storyA.description], target: 'de', source: 'en' });
await post('translate-bad-400', '/api/translate', { texts: [], target: 'de' });
await post('summarize-501', '/api/summarize', { mode: 'brief', articles: [{ title: storyA.title, description: '', source: 'BBC World' }], targetLang: 'en' });

// ── comments, votes, reactions ───────────────────────────────────────────────
const aid = storyA.id;
await get('comments-empty', `/api/comments?article=${aid}`);
await post('comment-created', '/api/comments', { articleId: aid, body: 'The ferry closures came early this time — sensible.' }, { author: AUTHORS.amber });
advance(15_000);
await post(null, '/api/comments', { articleId: aid, body: 'Landfall forecasts have been drifting north all week.' }, { author: AUTHORS.quiet });
advance(15_000);
const third = await post(null, '/api/comments', { articleId: aid, body: 'Anyone on the coast: stay safe tonight.' }, { author: AUTHORS.solar });
await post('comment-too-fast-429', '/api/comments', { articleId: aid, body: 'Posting again straight away.' }, { author: AUTHORS.solar });
advance(15_000);
await post('comment-duplicate-409', '/api/comments', { articleId: aid, body: 'Anyone on the coast: stay safe tonight.' }, { author: AUTHORS.solar });
await post('comment-unknown-article-404', '/api/comments', { articleId: '000000000000', body: 'Hello there' }, { author: AUTHORS.amber });
await post('comment-bad-author-400', '/api/comments', { articleId: aid, body: 'No header' });
await post('comment-vote', `/api/comments/${third.id}/vote`, { value: 1 }, { author: AUTHORS.amber });
await post(null, `/api/comments/${third.id}/vote`, { value: 1 }, { author: AUTHORS.quiet });
await post('comment-vote-unknown-404', '/api/comments/0000000000000000/vote', { value: 1 }, { author: AUTHORS.amber });
await get('comments-new', `/api/comments?article=${aid}&sort=new`);
await get('comments-top', `/api/comments?article=${aid}&sort=top`);
await get('comments-me', `/api/comments?article=${aid}&sort=new`, { author: AUTHORS.amber });
await get('comments-page2', `/api/comments?article=${aid}&page=2&pageSize=2`);
await get('comments-bad-400', '/api/comments?article=nope');

// ── moderation: report, delete, the content screen, a banned author ─────────
await post('comment-report', `/api/comments/${third.id}/report`, { reason: 'spam' }, { author: AUTHORS.quiet });
await post('comment-report-own-400', `/api/comments/${third.id}/report`, { reason: 'spam' }, { author: AUTHORS.solar });
await post('comment-report-bad-reason-400', `/api/comments/${third.id}/report`, { reason: 'boring' }, { author: AUTHORS.amber });
await post('comment-report-unknown-404', '/api/comments/0000000000000000/report', { reason: 'spam' }, { author: AUTHORS.amber });
advance(15_000);
const doomed = await post(null, '/api/comments', { articleId: aid, body: 'On second thought, never mind.' }, { author: AUTHORS.amber });
await del('comment-delete-not-owner-403', `/api/comments/${doomed.id}`, { author: AUTHORS.quiet });
await del('comment-delete', `/api/comments/${doomed.id}`, { author: AUTHORS.amber });
await del('comment-delete-unknown-404', '/api/comments/0000000000000000', { author: AUTHORS.amber });
advance(15_000);
await post('comment-objectionable-422', '/api/comments', { articleId: aid, body: 'kys, all of you' }, { author: AUTHORS.quiet });
await post(null, '/api/admin/bans', { authorKey: third.authorKey, reason: 'fixture' }, { headers: ADMIN });
await post('comment-banned-403', '/api/comments', { articleId: aid, body: 'Let me back in, please.' }, { author: AUTHORS.solar });
await del(null, `/api/admin/bans/${third.authorKey}`, { headers: ADMIN });
await post('news-vote-up', `/api/news/${aid}/vote`, { value: 1 }, { author: AUTHORS.amber });
await post('news-vote-retract', `/api/news/${aid}/vote`, { value: 0 }, { author: AUTHORS.amber });
await post(null, `/api/news/${aid}/vote`, { value: -1 }, { author: AUTHORS.quiet });
await post('news-vote-unknown-404', '/api/news/000000000000/vote', { value: 1 }, { author: AUTHORS.amber });
const ids = page1.articles.slice(0, 12).map((a) => a.id).join(',');
await get('reactions', `/api/reactions?articles=${ids}`, { author: AUTHORS.quiet });
await get('news-page1-author', '/api/news?page=1&pageSize=30', { author: AUTHORS.quiet });
await get('unknown-endpoint-404', '/api/nope');

// ── new stories (mutates the feed: last) ─────────────────────────────────────
advance(60_000);
await post(null, '/__fixture/advance', {});
await get('news-new-stories', `/api/news?since=${encodeURIComponent(page1.articles[0].publishedAt)}&pageSize=100`);

await close();

// ── normalize random comment ids, write ──────────────────────────────────────
const commentIds = new Map();
const renumber = (value) => {
  if (Array.isArray(value)) return value.map(renumber);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = renumber(v);
    if (typeof out.id === 'string' && /^[0-9a-f]{16}$/.test(value.id)) {
      if (!commentIds.has(value.id)) commentIds.set(value.id, 'cc' + (commentIds.size + 1).toString(16).padStart(14, '0'));
      out.id = commentIds.get(value.id);
    }
    if (typeof out.path === 'string') {
      out.path = out.path.replace(/[0-9a-f]{16}/g, (id) => commentIds.get(id) || id);
    }
    return out;
  }
  return value;
};

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
// two passes so ids that first appear in a response are known when paths are rewritten
for (const entry of files.values()) {
  renumber(entry);
  if (entry.body && typeof entry.body.uptime === 'number') entry.body.uptime = 0; // process uptime is wall-clock
}
for (const [name, entry] of files) {
  await writeFile(path.join(OUT_DIR, `${name}.json`), JSON.stringify(renumber(entry), null, 1) + '\n');
}
let commit = 'unknown';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
} catch {
  /* not a git checkout */
}
await writeFile(
  path.join(OUT_DIR, '_manifest.json'),
  JSON.stringify({ capturedAt: CAPTURED_AT, commit, authors: AUTHORS, files: [...files.keys()].sort() }, null, 1) + '\n'
);
console.log(`captured ${files.size} exchanges into ${path.relative(ROOT, OUT_DIR)} (clock ${CAPTURED_AT})`);
process.exit(0);
