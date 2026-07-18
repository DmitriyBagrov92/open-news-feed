// In-memory article store: refresh loop, per-source last-good caching,
// dedupe, sorting and querying.

import { CATEGORIES, RSS_SOURCES, API_SOURCES } from '../config/sources.js';
import { fetchRss } from './fetchers/rss.js';
import { fetchApi, MIN_API_INTERVAL_MS } from './fetchers/apis.js';
import { normalizeUrl, articleId } from './normalize.js';

const HARD_TIMEOUT_MS = 12_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ARTICLES = 3000;
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

// Normalize raw fetcher items into Article shape for one source; drops
// invalid/old items and same-source duplicate titles.
function toArticles(source, rawItems) {
  const now = Date.now();
  const seenIds = new Set();
  const seenTitles = new Set();
  const articles = [];
  for (const raw of rawItems) {
    if (!raw.title || !raw.url) continue;
    if (!raw.publishedAt || Number.isNaN(raw.publishedAt.getTime())) continue;
    const age = now - raw.publishedAt.getTime();
    if (age > MAX_AGE_MS || age < -60 * 60_000) continue; // stale or bogus future date
    const normUrl = normalizeUrl(raw.url);
    if (!normUrl) continue;
    const id = articleId(normUrl);
    const titleKey = raw.title.toLowerCase();
    if (seenIds.has(id) || seenTitles.has(titleKey)) continue;
    seenIds.add(id);
    seenTitles.add(titleKey);
    articles.push({
      id,
      title: raw.title,
      description: raw.description || '',
      url: raw.url,
      image: raw.image || null,
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
    console.warn(`[store] source "${source.id}" failed: ${st.lastError}`);
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
  try {
    await Promise.allSettled(sources.filter((s) => s.enabled).map(refreshSource));
    rebuild();
    // "Last successful refresh": don't advance when every source failed.
    if (sources.some((s) => s.enabled && state.get(s.id).ok)) updatedAt = new Date().toISOString();
    console.log(`[store] refreshed: ${combined.length} articles from ${sources.filter((s) => s.enabled).length} sources`);
  } finally {
    refreshing = false;
  }
}

export function startRefreshLoop() {
  refreshAll().catch((err) => console.warn(`[store] refresh failed: ${err.message}`));
  const timer = setInterval(
    () => refreshAll().catch((err) => console.warn(`[store] refresh failed: ${err.message}`)),
    REFRESH_MS
  );
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
  const language = lang || 'en';
  const sinceTs = since ? Date.parse(since) : NaN;

  const matched = combined.filter((a) => {
    if (a.language !== language) return false;
    if (cat && a.category !== cat) return false;
    if (includeSet && !includeSet.has(a.source.id)) return false;
    if (excludeSet && excludeSet.has(a.source.id)) return false;
    if (!Number.isNaN(sinceTs) && Date.parse(a.publishedAt) <= sinceTs) return false;
    if (needle && !(a.title.toLowerCase().includes(needle) || a.description.toLowerCase().includes(needle))) return false;
    return true;
  });

  const size = Math.min(Math.max(1, Math.trunc(Number(pageSize)) || 30), 100);
  const p = Math.max(1, Math.trunc(Number(page)) || 1);
  const result = {
    articles: matched.slice((p - 1) * size, p * size),
    total: matched.length,
    page: p,
    pageSize: size,
    updatedAt,
    // Newest id within THIS query's filters — the contract's new-items
    // polling anchor (matched inherits combined's DESC order).
    latestId: matched.length ? matched[0].id : null,
  };
  if (histogram) result.timeline = hourHistogram(matched);
  return result;
}

// 24 hourly buckets over the last 24h for the matched set, oldest first
// (index 23 = the current hour). Feeds the plasma-timeline visualization.
function hourHistogram(matched) {
  const buckets = new Array(24).fill(0);
  const now = Date.now();
  for (const article of matched) {
    const age = now - Date.parse(article.publishedAt);
    if (age < 0 || age >= 24 * 3600_000) continue;
    buckets[23 - Math.floor(age / 3600_000)] += 1;
  }
  return buckets;
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
    })),
    categories: [...CATEGORIES],
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
