// Meridian backend: routes + static /public + limits. See docs/ARCHITECTURE.md.

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getHeapStatistics } from 'node:v8';
import express from 'express';
import compression from 'compression';
import * as store from './lib/store.js';
import { extractArticle, ExtractError } from './lib/extract.js';
import { summarize, translateTexts, rateLimitOk } from './lib/ai.js';
import { createLimiter } from './lib/ratelimit.js';
import {
  initComments, listComments, addComment, setVote, setArticleVote,
  reactionCounts, CommentError,
} from './lib/comments.js';
import { getBattles } from './lib/battles.js';
import * as log from './lib/log.js';
import { usageMiddleware, startUsageLog } from './lib/usage.js';
import { renderIndex, publicOrigin, configuredOrigin, robotsTxt, sitemapXml } from './lib/page.js';
import { indexNowKey, createIndexNow } from './lib/indexnow.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
// Behind exactly one proxy (Railway's edge) X-Forwarded-For is trustworthy
// and req.ip is the real client. Directly exposed (local, bare VPS), a
// spoofed XFF would mint a fresh rate-limit bucket per request — so trust
// is opt-out via TRUST_PROXY=0 for proxyless deployments.
if (process.env.TRUST_PROXY !== '0') app.set('trust proxy', 1);

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' https: data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

app.use(compression());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
  next();
});
// Before static: page loads of index.html count as visits.
app.use(usageMiddleware());
app.use(express.json({ limit: '256kb' }));

// ── entry page + crawler files (before static, which would serve the raw
//    template): the HTML carries the latest headlines and absolute URLs ──
app.get(['/', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.type('html').send(renderIndex(publicOrigin(req)));
});
app.get('/robots.txt', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(robotsTxt(publicOrigin(req)));
});
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.type('application/xml').send(sitemapXml(publicOrigin(req)));
});
// IndexNow ownership proof: /{key}.txt must answer with the key. Served from
// the variable itself — nothing to write to disk, nothing to keep in sync.
const INDEXNOW_KEY = indexNowKey();
if (INDEXNOW_KEY) {
  app.get(`/${INDEXNOW_KEY}.txt`, (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.type('text/plain').send(INDEXNOW_KEY);
  });
}

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function httpError(status, code, message) {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function rateLimit(req) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!rateLimitOk(ip)) throw httpError(429, 'rate-limited', 'Too many requests, slow down');
}

// ── API routes ───────────────────────────────────────────────────────────────

app.get('/api/news', wrap((req, res) => {
  const { category, q, sources, exclude, page, pageSize, lang, since, histogram } = req.query;
  const result = store.query({
    category, q, sources, exclude, page, pageSize, lang, since,
    histogram: histogram === '1',
  });
  // Attach comment counts and article like/dislike tallies. Copy the
  // articles — store.query returns live references into the store; mutating
  // them would poison later responses. A comments-backend failure must
  // never break the feed.
  try {
    const me = optionalAuthor(req);
    const counts = reactionCounts(result.articles.map((a) => a.id), me);
    result.articles = result.articles.map((a) => {
      const r = counts.get(a.id);
      return {
        ...a,
        commentCount: r?.comments || 0,
        up: r?.up || 0,
        down: r?.down || 0,
        myVote: r?.myVote ?? null,
      };
    });
  } catch {
    /* feed stays count-less */
  }
  res.setHeader('Vary', 'X-Author-Id');
  res.json(result);
}));

// ── comments ────────────────────────────────────────────────────────────────

const commentPostLimiter = createLimiter({ limit: 5 });
const ARTICLE_ID_RE = /^[0-9a-f]{12}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMENT_ID_RE = /^[0-9a-f]{16}$/;

function optionalAuthor(req) {
  const id = req.get('x-author-id');
  return id && UUID_RE.test(id) ? id.toLowerCase() : null;
}

function requireAuthor(req) {
  const id = optionalAuthor(req);
  if (!id) throw httpError(400, 'bad-author', 'X-Author-Id header (UUID) is required');
  return id;
}

app.get('/api/comments', wrap((req, res) => {
  rateLimit(req);
  const { article, page, pageSize, sort } = req.query;
  if (!article || !ARTICLE_ID_RE.test(article)) {
    throw httpError(400, 'bad-article', 'Query parameter "article" must be a 12-hex article id');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'X-Author-Id');
  res.json(listComments({
    articleId: article, page, pageSize, sort, authorId: optionalAuthor(req),
  }));
}));

app.post('/api/comments', wrap((req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!commentPostLimiter(ip)) {
    throw httpError(429, 'rate-limited', 'Too many comments, slow down');
  }
  const authorId = requireAuthor(req);
  const { articleId, body } = req.body || {};
  if (!articleId || !ARTICLE_ID_RE.test(articleId)) {
    throw httpError(400, 'bad-article', '"articleId" must be a 12-hex article id');
  }
  if (!store.getArticle(articleId)) {
    throw httpError(404, 'unknown-article', 'Comments are closed for archived stories');
  }
  res.status(201).json(addComment({ articleId, authorId, body }));
}));

app.post('/api/comments/:id/vote', wrap((req, res) => {
  rateLimit(req);
  const authorId = requireAuthor(req);
  const { id } = req.params;
  if (!COMMENT_ID_RE.test(id)) throw httpError(400, 'bad-comment', 'Malformed comment id');
  const { value } = req.body || {};
  if (value !== 1 && value !== -1 && value !== 0) {
    throw httpError(400, 'bad-vote', '"value" must be 1, -1 or 0');
  }
  const result = setVote({ commentId: id, authorId, value });
  if (!result) throw httpError(404, 'unknown-comment', 'No such comment');
  res.json(result);
}));

// ── article reactions (like/dislike on stories) ────────────────────────────

app.post('/api/news/:id/vote', wrap((req, res) => {
  rateLimit(req);
  const authorId = requireAuthor(req);
  const { id } = req.params;
  if (!ARTICLE_ID_RE.test(id)) throw httpError(400, 'bad-article', 'Malformed article id');
  if (!store.getArticle(id)) {
    throw httpError(404, 'unknown-article', 'Voting is closed for archived stories');
  }
  const { value } = req.body || {};
  if (value !== 1 && value !== -1 && value !== 0) {
    throw httpError(400, 'bad-vote', '"value" must be 1, -1 or 0');
  }
  res.json(setArticleVote({ articleId: id, authorId, value }));
}));

// Batch counters for live-updating the visible grid: comment count and
// like/dislike tallies per article. Read-only, cheap (two grouped queries).
// Its own bucket: this is polled unattended every 30s per tab — sharing the
// interactive 30/min bucket would starve votes/translate behind one NAT IP.
const reactionsLimiter = createLimiter({ limit: 30 });
app.get('/api/reactions', wrap((req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  if (!reactionsLimiter(ip)) {
    throw httpError(429, 'rate-limited', 'Too many requests, slow down');
  }
  const ids = String(req.query.articles || '')
    .split(',')
    .filter(Boolean)
    .slice(0, 150);
  if (!ids.length || !ids.every((id) => ARTICLE_ID_RE.test(id))) {
    throw httpError(400, 'bad-articles', '"articles" must be a comma-separated list of 12-hex ids (max 150)');
  }
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'X-Author-Id');
  const counts = reactionCounts(ids, optionalAuthor(req));
  res.json({ reactions: Object.fromEntries(counts) });
}));

app.get('/api/sources', wrap((req, res) => {
  res.json(store.listSources());
}));

// Bubble Battle: clusters of one story covered from different leans.
// Cached per store refresh — cheap, no rate limiter needed.
app.get('/api/battles', wrap((req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json(getBattles());
}));

app.get('/api/article', wrap(async (req, res) => {
  rateLimit(req);
  const { url } = req.query;
  if (!url) throw httpError(400, 'missing-url', 'Query parameter "url" is required');
  res.json(await extractArticle(url));
}));

app.post('/api/summarize', wrap(async (req, res) => {
  rateLimit(req);
  const result = await summarize(req.body || {});
  res.json(result);
}));

app.post('/api/translate', wrap(async (req, res) => {
  rateLimit(req);
  const { texts, target, source } = req.body || {};
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > 20) {
    throw httpError(400, 'bad-request', '"texts" must be an array of 1–20 strings');
  }
  if (!texts.every((t) => typeof t === 'string' && t.length <= 1000)) {
    throw httpError(400, 'bad-request', 'each text must be a string of at most 1000 chars');
  }
  if (typeof target !== 'string' || !/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(target)) {
    throw httpError(400, 'bad-request', '"target" must be a language code like "de"');
  }
  res.json(await translateTexts(texts, target, typeof source === 'string' ? source : 'en'));
}));

app.get('/api/health', wrap((req, res) => {
  const s = store.stats();
  // ok once at least one refresh has succeeded; 503 until then so the
  // Railway healthcheck (status-code based) is meaningful, not always-green.
  res.status(s.updatedAt !== null ? 200 : 503).json({
    ok: s.updatedAt !== null,
    uptime: process.uptime(),
    articles: s.articles,
    sources: s.sources,
    updatedAt: s.updatedAt,
  });
}));

app.use('/api', (req, res, next) => next(httpError(404, 'not-found', 'Unknown API endpoint')));

// ── fixture mode (tests only) ────────────────────────────────────────────────
// FEED_FIXTURE=<json> makes the store deterministic and offline (lib/store.js
// seedFixture, lib/testmode.js fetch stub). These two routes let the
// end-to-end suite raise "new stories" and rewind; they do not exist in
// production because the variable is never set there.
const FIXTURE = process.env.FEED_FIXTURE || '';
if (FIXTURE) {
  const { installFetchStub } = await import('./lib/testmode.js');
  installFetchStub({ pagesDir: path.join(path.dirname(path.resolve(FIXTURE)), 'pages') });
  app.post('/__fixture/advance', wrap(async (req, res) => {
    const fresh = path.join(path.dirname(path.resolve(FIXTURE)), 'feed.fresh.json');
    const added = await store.seedFixture(fresh, { append: true });
    res.json({ added, ...store.stats() });
  }));
  app.post('/__fixture/reset', wrap(async (req, res) => {
    const seeded = await store.seedFixture(FIXTURE);
    res.json({ seeded, ...store.stats() });
  }));
}

// ── error handler ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status =
    err instanceof ExtractError || err instanceof CommentError
      ? err.status
      : err.status || err.statusCode || 500;
  const hasCode = typeof err.code === 'string' && /^[a-z][a-z-]*$/.test(err.code);
  const code = hasCode ? err.code : status >= 500 ? 'internal' : 'bad-request';
  if (status >= 500 && !hasCode) {
    log.error('request failed', {
      method: req.method, path: req.path, status, ...log.errorFields(err, { stack: true }),
    });
  }
  // Uncontrolled 5xx messages may carry internals (paths, library errors) —
  // log them above, mask them to the client.
  const message = hasCode || status < 500 ? err.message || 'Request failed' : 'Internal error';
  res.status(status).json({ error: { code, message } });
});

// ── boot ─────────────────────────────────────────────────────────────────────
// The app is exported for tests (in-process, no port); boot() wires the
// long-lived pieces and runs by itself only when this file is the entry
// point (`node server.js`), never on import.

export { app };

const PORT = Number(process.env.PORT) || 3000;
// Minutes between `usage` log lines (default 5; 0 disables).
const usageRaw = process.env.USAGE_LOG_MINUTES;
const USAGE_LOG_MINUTES = usageRaw === undefined || usageRaw === '' ? 5 : Number(usageRaw);
// Minimum minutes between IndexNow pings for the front page (default 60).
const INDEXNOW_MINUTES = Math.max(5, Number(process.env.INDEXNOW_MINUTES) || 60);
const INDEXNOW_ORIGIN = INDEXNOW_KEY ? configuredOrigin() : null;

// Railway retires a deployment with SIGTERM. Without a handler Node exits
// 143, which Railway reports as a crash of the old deployment on every
// redeploy. Finish in-flight responses, then exit 0; cap the wait so a
// lingering keep-alive connection cannot hold the container open.
function shutdownWith(server) {
  return (signal) => {
    log.info('shutting down', { signal, uptime_s: Math.round(process.uptime()) });
    server.close(() => process.exit(0));
    setTimeout(() => {
      server.closeAllConnections();
      process.exit(0);
    }, 5000).unref();
  };
}

export async function boot({ listen = true } = {}) {
  let server = null;
  if (listen) {
    server = app.listen(PORT, () => {
      log.info('listening', {
        port: PORT,
        node: process.version,
        refresh_minutes: Math.max(1, Number(process.env.REFRESH_MINUTES) || 5),
        usage_log_minutes: USAGE_LOG_MINUTES,
        heap_limit_mb: Math.round(v8HeapLimit() / 1048576),
        indexnow: Boolean(INDEXNOW_KEY && INDEXNOW_ORIGIN),
        fixture: Boolean(FIXTURE),
      });
    });
    const shutdown = shutdownWith(server);
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }
  await initComments({ dbPath: process.env.COMMENTS_DB || './data/comments.db' }).catch((err) =>
    log.warn('comments init failed', log.errorFields(err))
  );
  store.startRefreshLoop();
  if (INDEXNOW_KEY && INDEXNOW_ORIGIN) {
    const indexNow = createIndexNow({
      key: INDEXNOW_KEY,
      origin: INDEXNOW_ORIGIN,
      minIntervalMs: INDEXNOW_MINUTES * 60_000,
    });
    store.onRefresh(({ latestId }) => indexNow.notify(latestId));
  } else if (INDEXNOW_KEY) {
    log.warn('indexnow disabled: no public origin — set PUBLIC_URL');
  }
  if (USAGE_LOG_MINUTES > 0) {
    startUsageLog({
      intervalMs: USAGE_LOG_MINUTES * 60_000,
      extra: () => {
        const s = store.stats();
        return { articles: s.articles, sources_ok: s.sources.ok, sources_failing: s.sources.failing };
      },
    });
  }
  return server;
}

function v8HeapLimit() {
  return getHeapStatistics().heap_size_limit;
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) boot();
