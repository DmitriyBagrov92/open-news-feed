// Server-side readability extraction for the preview modal, with an SSRF
// allowlist derived from config/sources.js.

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { RSS_SOURCES, API_SOURCES, EXTRA_ALLOWED_HOSTS } from '../config/sources.js';
import { USER_AGENT } from './fetchers/rss.js';

const TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2.5 * 1024 * 1024;
const MAX_TEXT_CHARS = 8000;

export class ExtractError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function buildAllowlist() {
  const hosts = new Set();
  const add = (url) => {
    try {
      const host = new URL(url).hostname.toLowerCase();
      hosts.add(host);
      if (host.startsWith('www.')) hosts.add(host.slice(4));
    } catch {
      /* skip malformed */
    }
  };
  for (const list of Object.values(RSS_SOURCES)) {
    for (const s of list) {
      add(s.url);
      add(s.homepage);
    }
  }
  for (const s of API_SOURCES) add(s.homepage);
  for (const host of EXTRA_ALLOWED_HOSTS) {
    const h = String(host).toLowerCase();
    hosts.add(h);
    if (h.startsWith('www.')) hosts.add(h.slice(4));
  }
  return hosts;
}

const ALLOWED_HOSTS = buildAllowlist();

export function isAllowedHost(hostname) {
  const host = String(hostname).toLowerCase();
  for (const allowed of ALLOWED_HOSTS) {
    if (host === allowed || host.endsWith('.' + allowed)) return true;
  }
  return false;
}

function assertAllowedUrl(rawUrl, phase) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new ExtractError('Invalid URL', 400, 'bad-url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ExtractError('Only http/https URLs are allowed', 400, 'bad-url');
  }
  if (!isAllowedHost(u.hostname)) {
    throw new ExtractError(`Host not allowed${phase ? ` (${phase})` : ''}`, 403, 'host-not-allowed');
  }
  return u;
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xhtml+xml' },
    });
    // Validate the post-redirect host too.
    assertAllowedUrl(res.url || url, 'after redirect');
    if (!res.ok) throw new ExtractError(`Upstream returned ${res.status}`, 422, 'fetch-failed');
    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (!contentType.includes('text/html')) {
      throw new ExtractError(`Unsupported content type: ${contentType || 'unknown'}`, 422, 'not-html');
    }

    // Read incrementally, abort past the cap; the truncated prefix still parses.
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_BODY_BYTES) {
        controller.abort(new Error('body cap'));
        break;
      }
    }
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: res.url || url };
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(`Fetch failed: ${err.message}`, 422, 'fetch-failed');
  } finally {
    clearTimeout(timer);
  }
}

function paragraphsOf(contentHtml, fallbackText) {
  if (contentHtml) {
    try {
      const { document } = parseHTML(`<html><body>${contentHtml}</body></html>`);
      const paragraphs = [...document.querySelectorAll('p, li, h2, h3, blockquote')]
        .map((el) => el.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      if (paragraphs.length) return paragraphs.join('\n\n');
    } catch {
      /* fall through */
    }
  }
  return (fallbackText || '').replace(/\s+/g, ' ').trim();
}

export async function extractArticle(rawUrl) {
  assertAllowedUrl(rawUrl, 'requested url');
  const { html, finalUrl } = await fetchHtml(rawUrl);

  let parsed;
  let ogImage = null;
  try {
    const { document } = parseHTML(html);
    const og =
      document.querySelector('meta[property="og:image"]') ||
      document.querySelector('meta[name="twitter:image"]');
    const ogContent = og && og.getAttribute('content');
    if (ogContent && /^https?:\/\//i.test(ogContent)) ogImage = ogContent;
    parsed = new Readability(document, { charThreshold: 200 }).parse();
  } catch {
    parsed = null;
  }
  if (!parsed || !parsed.title || !(parsed.content || parsed.textContent)) {
    throw new ExtractError('Could not extract readable content', 422, 'extract-failed');
  }

  let text = paragraphsOf(parsed.content, parsed.textContent);
  if (!text) throw new ExtractError('Could not extract readable content', 422, 'extract-failed');
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);

  return {
    title: parsed.title,
    byline: parsed.byline || null,
    text,
    excerpt: parsed.excerpt || null,
    image: ogImage,
    siteName: parsed.siteName || safeHost(finalUrl),
  };
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
