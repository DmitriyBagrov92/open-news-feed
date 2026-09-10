// In-memory article store: refresh loop, per-source last-good caching,
// dedupe, sorting and querying.

import { CATEGORIES, RSS_SOURCES, API_SOURCES } from '../config/sources.js';
import { fetchRss } from './fetchers/rss.js';
import { fetchApi, MIN_API_INTERVAL_MS } from './fetchers/apis.js';
import { normalizeUrl, articleId, detach } from './normalize.js';
import { enrichImages } from './enrich.js';
import * as log from './log.js';

const HARD_TIMEOUT_MS = 12_000;
// Sources fetched + parsed at once. Each feed costs up to MAX_FEED_BYTES of
// XML plus a parse tree several times that size while in flight, so the peak
// memory of a refresh is this many feeds — not all ~80 of them at once.
const REFRESH_CONCURRENCY = 8;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const MAX_AGE_MS = 7 * DAY_MS;
// battle-only sources are high-volume partisan feeds: shorter horizon so
// they don't evict the mainstream tail (battles cluster 48h anyway)
const BATTLE_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const MAX_ARTICLES = 6000; // headroom for the native-language feed lists
const BATTLE_POOL_AGE_MS = 48 * 60 * 60 * 1000;
const REFRESH_MS = Math.max(1, Number(process.env.REFRESH_MINUTES) || 5) * 60_000;

// ── source registry ──────────────────────────────────────────────────────────

function buildSources() {
  const list = [];
  for (const [lang, sources] of Object.entries(RSS_SOURCES)) {
    for (const s of sources) {
      list.push({ ...s, lang, type: 'rss', enabled: true, requiresKey: false });
    }
  }
  for (const s of API_SOURCES) {
    list.push({
      ...s,
      lang: 'en',
      category: 'world',
      type: 'api',
      enabled: Boolean(process.env[s.envKey]),
      requiresKey: true,
    });
  }
  return list;
}

const sources = buildSources();
// battleOnly articles stay in `combined` (comments/votes/extract gate on
// getArticle) but never surface in query() → /api/news.
const BATTLE_ONLY_IDS = new Set(sources.filter((s) => s.battleOnly).map((s) => s.id));
const LEAN_BY_SOURCE = new Map(sources.filter((s) => s.lean).map((s) => [s.id, s.lean]));

// sourceId → { articles, ok, lastError, lastFetchAt }
const state = new Map(
  sources.map((s) => [s.id, { articles: [], ok: null, lastError: null, lastFetchAt: 0 }])
);

let combined = []; // merged, deduped, sorted DESC
let updatedAt = null;
let refreshing = false;

// ── fetching ─────────────────────────────────────────────────────────────────

function withHardTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), HARD_TIMEOUT_MS);
  // Promise.race guards against fetchers that ignore the abort signal.
  let raceTimer;
  const timeout = new Promise((_, reject) => {
    raceTimer = setTimeout(() => reject(new Error(`timed out after ${HARD_TIMEOUT_MS}ms`)), HARD_TIMEOUT_MS + 500);
  });
  return Promise.race([fn(controller.signal), timeout]).finally(() => {
    clearTimeout(timer);
    clearTimeout(raceTimer);
  });
}

// Run `task` over `items` with at most `limit` in flight. Resolves once every
// task has settled; tasks are expected to handle their own failures.
async function forEachLimited(items, limit, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// Normalize raw fetcher items into Article shape for one source; drops
// invalid/old items and same-source duplicate titles. Strings are detached
// from the feed they were cut out of — see normalize.detach — so the store
// holds the 500-char description, not the 50 KB article body behind it.
function toArticles(source, rawItems) {
  const now = Date.now();
  const seenIds = new Set();
  const seenTitles = new Set();
  const articles = [];
  for (const raw of rawItems) {
    if (!raw.title || !raw.url) continue;
    if (!raw.publishedAt || Number.isNaN(raw.publishedAt.getTime())) continue;
    const age = now - raw.publishedAt.getTime();
    const maxAge = source.battleOnly ? BATTLE_MAX_AGE_MS : MAX_AGE_MS;
    if (age > maxAge || age < -60 * 60_000) continue; // stale or bogus future date
    const normUrl = normalizeUrl(raw.url);
    if (!normUrl) continue;
    const id = articleId(normUrl);
    const titleKey = raw.title.toLowerCase();
    if (seenIds.has(id) || seenTitles.has(titleKey)) continue;
    seenIds.add(id);
    seenTitles.add(titleKey);
    articles.push({
      id,
      title: detach(raw.title),
      description: detach(raw.description || ''),
      url: detach(raw.url),
      image: raw.image ? detach(raw.image) : null,
      source: { id: source.id, name: source.name, homepage: source.homepage },
      category: raw.category || source.category,
      publishedAt: raw.publishedAt.toISOString(),
      language: source.lang,
    });
  }
  return articles;
}

async function refreshSource(source) {
  const st = state.get(source.id);
  if (source.type === 'api' && Date.now() - st.lastFetchAt < MIN_API_INTERVAL_MS) return;
  try {
    const raw = await withHardTimeout((signal) =>
      source.type === 'api' ? fetchApi(source, signal) : fetchRss(source, signal)
    );
    // Only successful fetches consume the keyed-API interval budget, so a
    // transient failure is retried on the very next cycle per the contract.
    st.lastFetchAt = Date.now();
    st.articles = toArticles(source, raw);
    st.ok = true;
    st.lastError = null;
  } catch (err) {
    // Keep last-good articles; one warning line per failure.
    st.ok = false;
    st.lastError = err.message || String(err);
    log.warn('source failed', { source: source.id, error: st.lastError });
  }
}

function rebuild() {
  const now = Date.now();
  const byId = new Map();
  for (const source of sources) {
    for (const article of state.get(source.id).articles) {
      if (now - Date.parse(article.publishedAt) > MAX_AGE_MS) continue;
      const existing = byId.get(article.id);
      if (!existing || existing.publishedAt < article.publishedAt) byId.set(article.id, article);
    }
  }
  combined = [...byId.values()]
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0))
    .slice(0, MAX_ARTICLES);
}

export async function refreshAll() {
  if (refreshing) return;
  refreshing = true;
  const startedAt = Date.now();
  try {
    await forEachLimited(sources.filter((s) => s.enabled), REFRESH_CONCURRENCY, refreshSource);
    rebuild();
    // "Last successful refresh": don't advance when every source failed.
    if (sources.some((s) => s.enabled && state.get(s.id).ok)) updatedAt = new Date().toISOString();
    log.info('refreshed', {
      articles: combined.length,
      sources_ok: stats().sources.ok,
      sources_failing: stats().sources.failing,
      ms: Date.now() - startedAt,
    });
    // Fill in og:image for the newest articles whose feeds carry none.
    // `combined` holds shared references, so in-place mutation is enough —
    // no re-sort needed. Enrichment must never break the refresh loop.
    try {
      const candidates = combined.filter((a) => a.image == null).slice(0, 150);
      const { enriched, fetched } = await enrichImages(candidates);
      log.info('enriched images', { enriched, fetched });
    } catch (err) {
      log.warn('image enrichment failed', log.errorFields(err));
    }
  } finally {
    refreshing = false;
  }
}

export function startRefreshLoop() {
  const run = () => refreshAll().catch((err) => log.warn('refresh failed', log.errorFields(err)));
  run();
  const timer = setInterval(run, REFRESH_MS);
  timer.unref();
}

// ── querying ─────────────────────────────────────────────────────────────────

function csvSet(value) {
  if (!value) return null;
  const parts = String(value).split(',').map((s) => s.trim()).filter(Boolean);
  return parts.length ? new Set(parts) : null;
}

export function query({ category, q, sources: include, exclude, page, pageSize, lang, since, histogram } = {}) {
  const cat = category && category !== 'all' ? category : null;
  const needle = q ? String(q).toLowerCase() : null;
  const includeSet = csvSet(include);
  const excludeSet = csvSet(exclude);
  // lang accepts a CSV ("ru,en"): the hybrid feed mixes native-language
  // stories with the English backbone in one freshest-first stream
  const languages = new Set(
    String(lang || 'en').split(',').map((s) => s.trim()).filter(Boolean)
  );
  if (!languages.size) languages.add('en');
  const sinceTs = since ? Date.parse(since) : NaN;
  const size = Math.min(Math.max(1, Math.trunc(Number(pageSize)) || 30), 100);
  const p = Math.max(1, Math.trunc(Number(page)) || 1);
  const first = (p - 1) * size;
  const last = first + size;

  // One pass over the store: count matches, keep only the requested page and
  // fold the histogram in as we go. Materializing every match just to take
  // a page (or a single item, for the 90s new-items poll) allocated a
  // store-sized array per request.
  const now = Date.now();
  const articles = [];
  // 24 hourly buckets over the last 24h for the matched set, oldest first
  // (index 23 = the current hour). Feeds the plasma-timeline visualization.
  const timeline = histogram ? new Array(24).fill(0) : null;
  let total = 0;
  let latestId = null;
  for (const a of combined) {
    if (BATTLE_ONLY_IDS.has(a.source.id)) continue; // battle view only
    if (!languages.has(a.language)) continue;
    if (cat && a.category !== cat) continue;
    if (includeSet && !includeSet.has(a.source.id)) continue;
    if (excludeSet && excludeSet.has(a.source.id)) continue;
    // combined is newest-first: past `since`, nothing further can match
    if (!Number.isNaN(sinceTs) && Date.parse(a.publishedAt) <= sinceTs) break;
    if (needle && !(a.title.toLowerCase().includes(needle) || a.description.toLowerCase().includes(needle))) continue;
    // Newest id within THIS query's filters — the contract's new-items
    // polling anchor.
    if (total === 0) latestId = a.id;
    if (total >= first && total < last) articles.push(a);
    if (timeline) {
      const age = now - Date.parse(a.publishedAt);
      if (age >= 0 && age < DAY_MS) timeline[23 - Math.floor(age / HOUR_MS)] += 1;
    }
    total += 1;
  }

  const result = { articles, total, page: p, pageSize: size, updatedAt, latestId };
  if (timeline) result.timeline = timeline;
  return result;
}

export function getArticle(id) {
  return combined.find((a) => a.id === id) || null;
}

// Clustering pool for the Bubble Battle view: articles from lean-tagged
// sources (battle-only + tagged mainstream), ≤48h, newest first, with the
// source's lean attached. Returns copies — callers may decorate freely.
export function battlePool() {
  const cutoff = Date.now() - BATTLE_POOL_AGE_MS;
  const pool = [];
  for (const a of combined) {
    const lean = LEAN_BY_SOURCE.get(a.source.id);
    if (!lean) continue;
    if (Date.parse(a.publishedAt) < cutoff) continue;
    pool.push({ ...a, lean });
  }
  return pool;
}

export function listSources() {
  return {
    sources: sources.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      type: s.type,
      homepage: s.homepage,
      enabled: s.enabled,
      requiresKey: s.requiresKey,
      ...(s.lean ? { lean: s.lean } : {}),
      ...(s.battleOnly ? { battle: true } : {}),
    })),
    categories: [...CATEGORIES],
    // translation targets that have native-language feeds available
    languages: Object.keys(RSS_SOURCES),
  };
}

export function stats() {
  let ok = 0;
  let failing = 0;
  for (const s of sources) {
    if (!s.enabled) continue;
    const st = state.get(s.id);
    if (st.ok === false) failing += 1;
    else if (st.ok === true) ok += 1;
  }
  return {
    articles: combined.length,
    sources: { ok, failing },
    updatedAt,
    latestId: combined.length ? combined[0].id : null,
  };
}
