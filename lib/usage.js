// Usage metering → one `usage` info log line per window, answering "who is
// here and what do they use": unique visitors and comment authors, page
// loads, requests per feature, error rates, latency, plus process/store
// health so the same line explains a memory or refresh problem.
//
// Privacy: identities are COUNTED, never logged or stored. Client IPs and
// X-Author-Id tokens are hashed with a per-boot random salt before they
// enter a Set, and only the Set sizes leave the process. Sets are bounded.

import { createHash, randomBytes } from 'node:crypto';
import { info } from './log.js';

const SALT = randomBytes(16);
const DAILY_CAP = 20_000; // hashed ids per daily set; beyond this we stop counting
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hashId = (value) =>
  createHash('sha1').update(SALT).update(String(value).toLowerCase()).digest('base64url').slice(0, 16);

// Route → feature counter. Health checks (Railway polls them) and static
// assets are not usage; the index page is (a visit).
function featureOf(req) {
  const path = req.path;
  if (!path.startsWith('/api/')) {
    return path === '/' || path === '/index.html' ? 'page_loads' : null;
  }
  if (path === '/api/health') return null;
  if (path === '/api/news') return 'news';
  if (path === '/api/reactions') return 'reactions';
  if (path === '/api/comments') return req.method === 'POST' ? 'comments_posted' : 'comments_read';
  if (path.startsWith('/api/comments/')) return 'comment_votes';
  if (path.startsWith('/api/news/')) return 'story_votes';
  if (path === '/api/article') return 'article_reads';
  if (path === '/api/translate') return 'translations';
  if (path === '/api/summarize') return 'summaries';
  if (path === '/api/battles') return 'battles';
  return 'other_api';
}

function emptyWindow() {
  return {
    startedAt: Date.now(),
    visitors: new Set(),
    authors: new Set(),
    features: {},
    status: { ok: 0, client_error: 0, rate_limited: 0, server_error: 0 },
    latency: { count: 0, totalMs: 0, maxMs: 0 },
  };
}

class BoundedSet {
  constructor(cap) {
    this.cap = cap;
    this.set = new Set();
    this.capped = false;
  }
  add(value) {
    if (this.set.size >= this.cap) {
      if (!this.set.has(value)) this.capped = true;
      return;
    }
    this.set.add(value);
  }
  get size() {
    return this.set.size;
  }
}

let window = emptyWindow();
let day = { key: null, visitors: new BoundedSet(DAILY_CAP), authors: new BoundedSet(DAILY_CAP) };

function dayOf(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function rollDay(now) {
  const key = dayOf(now);
  if (day.key !== key) {
    day = { key, visitors: new BoundedSet(DAILY_CAP), authors: new BoundedSet(DAILY_CAP) };
  }
}

// Express middleware: classifies each finished response into the window.
export function usageMiddleware() {
  return (req, res, next) => {
    const feature = featureOf(req);
    if (!feature) return next();
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const now = Date.now();
      rollDay(now);
      const visitor = hashId(req.ip || req.socket?.remoteAddress || 'unknown');
      window.visitors.add(visitor);
      day.visitors.add(visitor);
      const authorId = req.get('x-author-id');
      if (authorId && UUID_RE.test(authorId)) {
        const author = hashId(authorId);
        window.authors.add(author);
        day.authors.add(author);
      }
      window.features[feature] = (window.features[feature] || 0) + 1;
      const s = res.statusCode;
      if (s === 429) window.status.rate_limited += 1;
      else if (s >= 500) window.status.server_error += 1;
      else if (s >= 400) window.status.client_error += 1;
      else window.status.ok += 1;
      if (feature !== 'page_loads') {
        const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
        window.latency.count += 1;
        window.latency.totalMs += ms;
        if (ms > window.latency.maxMs) window.latency.maxMs = ms;
      }
    });
    next();
  };
}

// The window's figures as log attributes; resets the window. `extra()` lets
// the caller attach store health (articles, failing sources).
export function snapshot(extra = () => ({})) {
  const now = Date.now();
  rollDay(now);
  const w = window;
  window = emptyWindow();
  const requests = Object.values(w.features).reduce((a, b) => a + b, 0);
  const mem = process.memoryUsage();
  return {
    window_min: Math.round((now - w.startedAt) / 60_000),
    visitors: w.visitors.size,
    authors: w.authors.size,
    visitors_today: day.visitors.size,
    authors_today: day.authors.size,
    ...(day.visitors.capped || day.authors.capped ? { today_capped: true } : {}),
    requests,
    ...w.features,
    ...w.status,
    avg_ms: w.latency.count ? Math.round(w.latency.totalMs / w.latency.count) : 0,
    max_ms: Math.round(w.latency.maxMs),
    rss_mb: Math.round(mem.rss / 1048576),
    heap_mb: Math.round(mem.heapUsed / 1048576),
    uptime_h: Math.round(process.uptime() / 360) / 10,
    ...extra(),
  };
}

// Emit a `usage` line every `intervalMs`. Always emits, even at zero — a
// quiet window is a heartbeat that says the service is up and unused.
export function startUsageLog({ intervalMs, extra } = {}) {
  const timer = setInterval(() => info('usage', snapshot(extra)), intervalMs);
  timer.unref();
  return timer;
}
