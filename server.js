// Meridian backend: routes + static /public + limits. See docs/ARCHITECTURE.md.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import compression from 'compression';
import * as store from './lib/store.js';
import { extractArticle, ExtractError } from './lib/extract.js';
import { summarize, translateTexts, rateLimitOk } from './lib/ai.js';

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
app.use(express.json({ limit: '256kb' }));
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
  res.json(store.query({
    category, q, sources, exclude, page, pageSize, lang, since,
    histogram: histogram === '1',
  }));
}));

app.get('/api/sources', wrap((req, res) => {
  res.json(store.listSources());
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

// ── error handler ────────────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err instanceof ExtractError ? err.status : err.status || err.statusCode || 500;
  const hasCode = typeof err.code === 'string' && /^[a-z][a-z-]*$/.test(err.code);
  const code = hasCode ? err.code : status >= 500 ? 'internal' : 'bad-request';
  if (status >= 500 && !hasCode) console.error(`[server] ${err.stack || err}`);
  // Uncontrolled 5xx messages may carry internals (paths, library errors) —
  // log them above, mask them to the client.
  const message = hasCode || status < 500 ? err.message || 'Request failed' : 'Internal error';
  res.status(status).json({ error: { code, message } });
});

// ── boot ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, () => {
  console.log(`[server] Meridian listening on :${PORT}`);
});
store.startRefreshLoop();
