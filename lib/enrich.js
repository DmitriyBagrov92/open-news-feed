// og:image enrichment for articles whose feeds carry no images: fetch the
// article page (allowlisted hosts only, https only, capped body) and pull
// og:image / twitter:image out of the HTML prefix via regex. Results —
// including "nothing found" — are cached per article id so a URL is fetched
// at most once across refresh cycles.

import { isAllowedHost } from './extract.js';
import { USER_AGENT } from './fetchers/rss.js';

const TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;
const MAX_BODY_BYTES = 1024 * 1024; // og tags live in <head>; the prefix is enough
const CACHE_MAX = 6000;

// article id → image url | null (null = tried, nothing found; failures are
// cached too so they are not retried every cycle). FIFO-capped.
const cache = new Map();

function cacheSet(id, value) {
  if (cache.size >= CACHE_MAX && !cache.has(id)) {
    cache.delete(cache.keys().next().value); // Map iterates in insertion order
  }
  cache.set(id, value);
}

// <meta property="og:image" content="…"> in either attribute order.
function metaContent(html, keyPattern) {
  const tagRe = new RegExp(`<meta\\s[^>]*(?:property|name)\\s*=\\s*["']${keyPattern}["'][^>]*>`, 'i');
  const tag = tagRe.exec(html);
  if (!tag) return null;
  const content = /content\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag[0]);
  return content ? (content[1] ?? content[2]) : null;
}

function extractImageUrl(html) {
  let url = metaContent(html, 'og:image(?::secure_url|:url)?') || metaContent(html, 'twitter:image(?::src)?');
  if (!url) return null;
  url = url.trim().replace(/&#38;|&#x26;|&amp;/gi, '&');
  if (url.startsWith('//')) url = 'https:' + url;
  if (!/^https?:\/\//i.test(url)) return null;
  return url;
}

// Fetch one article page and return its og/twitter image URL, or null.
// All failures are silent (the caller caches null).
async function fetchOgImage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), TIMEOUT_MS);
  try {
    // Redirects are followed manually so every hop is re-checked against the
    // allowlist — an open redirect must not turn enrichment into SSRF.
    let current = new URL(url);
    let res;
    for (let hop = 0; ; hop += 1) {
      res = await fetch(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
      });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) return null;
      await res.body?.cancel().catch(() => {});
      const next = new URL(location, current);
      if (next.protocol !== 'https:' || !isAllowedHost(next.hostname)) return null;
      current = next;
    }
    if (!res.ok || !res.body) return null;

    // Read incrementally with a byte cap; abort past it and use the prefix.
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (total < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
    if (total >= MAX_BODY_BYTES) controller.abort(new Error('body cap'));
    return extractImageUrl(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Enrich `articles` (in the given order) in place: for each article without an
// image, resolve its og:image — from cache when possible, otherwise with at
// most `budget` network fetches per call, `concurrency` in parallel.
export async function enrichImages(articles, { budget = 30, concurrency = 4 } = {}) {
  let enriched = 0;
  let fetched = 0;
  try {
    let index = 0;
    const worker = async () => {
      while (index < articles.length) {
        const article = articles[index];
        index += 1;
        if (!article || article.image != null) continue;
        if (cache.has(article.id)) {
          const cached = cache.get(article.id);
          if (cached) {
            article.image = cached;
            enriched += 1;
          }
          continue; // cache hits are free
        }
        let target;
        try {
          target = new URL(article.url);
        } catch {
          continue;
        }
        if (target.protocol === 'http:') target.protocol = 'https:'; // fetch over https only
        if (target.protocol !== 'https:' || !isAllowedHost(target.hostname)) continue;
        if (fetched >= budget) return;
        fetched += 1; // reserved synchronously — the budget is never exceeded
        const image = await fetchOgImage(target.toString());
        cacheSet(article.id, image);
        if (image) {
          article.image = image;
          enriched += 1;
        }
      }
    };
    const workers = [];
    for (let i = 0; i < Math.max(1, concurrency); i += 1) workers.push(worker());
    await Promise.all(workers);
  } catch (err) {
    console.warn(`[enrich] unexpected error: ${err.message || err}`);
  }
  return { enriched, fetched };
}
