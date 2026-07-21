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

const MAX_REDIRECTS = 5;

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), TIMEOUT_MS);
  try {
    // Follow redirects manually so EVERY hop is allowlist-checked BEFORE the
    // request fires — an open redirect on an allowlisted news site must not
    // become blind SSRF into internal hosts.
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
      if (!location || hop >= MAX_REDIRECTS) {
        throw new ExtractError('Too many redirects', 422, 'fetch-failed');
      }
      await res.body?.cancel().catch(() => {});
      current = assertAllowedUrl(new URL(location, current).toString(), 'redirect target');
    }
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
    return { html: Buffer.concat(chunks).toString('utf8'), finalUrl: current.toString() };
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError(`Fetch failed: ${err.message}`, 422, 'fetch-failed');
  } finally {
    clearTimeout(timer);
  }
}

// Header chrome Readability often retains inside its content: breadcrumb
// lists, datelines, share bars. Matched against class/id and text shape.
const CHROME_SELECTOR = 'nav, aside, button, figure figcaption ~ *, [class*="breadcrumb" i], [id*="breadcrumb" i], [class*="share" i], [class*="social" i], [class*="related" i], [class*="newsletter" i], [class*="advertis" i], [class*="author" i], [class*="byline" i], [class*="contributor" i], [class*="profile" i]';
const DATELINE_RE = /^(issued on|modified|published( on)?|updated|posted|by)\b[:\s]/i;
// Job-title author bios ("ESPN Senior Writer…") that survive class-based
// removal. Applied only before real prose starts, so no anchors needed.
const BIO_RE = /(staff|senior|contributing|opinion|chief|associate) (writer|editor|columnist|correspondent|reporter)/i;
// Real ledes end like sentences; header debris (breadcrumbs, bio fragments,
// "…Dynasty" ,") does not.
const SENTENCE_END_RE = /[.!?…"”'’)\]]\s*$/;

function paragraphsOf(contentHtml, fallbackText) {
  if (contentHtml) {
    try {
      const { document } = parseHTML(`<html><body>${contentHtml}</body></html>`);
      for (const el of document.querySelectorAll(CHROME_SELECTOR)) el.remove();
      const nodes = [...document.querySelectorAll('p, li, h2, h3, blockquote')];
      const texts = nodes.map((el) => {
        // Join child blocks with spaces so "07:02Modified:" style run-ons
        // from whitespace-less markup don't occur.
        const parts = [...el.childNodes].map((n) => n.textContent).join(' ');
        return parts.replace(/\s+/g, ' ').trim();
      });
      // Drop leading header debris (breadcrumbs, datelines, author bios)
      // before the first real paragraph; keep everything after prose starts.
      // Capped so a fully unpunctuated document still renders.
      let started = false;
      let skipped = 0;
      const paragraphs = [];
      for (const text of texts) {
        if (!text) continue;
        if (!started && skipped < 12) {
          if (DATELINE_RE.test(text) || BIO_RE.test(text) || !SENTENCE_END_RE.test(text)) {
            skipped += 1;
            continue;
          }
          started = true;
        }
        paragraphs.push(text);
      }
      if (paragraphs.length) return paragraphs.join('\n\n');
    } catch {
      /* fall through */
    }
  }
  return (fallbackText || '').replace(/\s+/g, ' ').trim();
}

/* ── structured blocks ───────────────────────────────────────────────────────
   A safe-by-construction representation of the article body that preserves
   what plain text loses: links, headings (live-blog timeline stamps), lists,
   quotes and bold/italic. No HTML ever crosses the wire — only text runs
   plus validated absolute http(s) hrefs, so the client can build DOM nodes
   without innerHTML and XSS is impossible by design. */

const MAX_BLOCKS = 150;
const MAX_HREF_CHARS = 2048;

function absHttp(href, baseUrl) {
  if (!href) return null;
  try {
    const u = new URL(href, baseUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const s = u.toString();
    return s.length <= MAX_HREF_CHARS ? s : null;
  } catch {
    return null;
  }
}

// Merge-append a run, collapsing whitespace; adjacent runs with identical
// style/href merge so markup noise doesn't fragment the payload.
function pushRun(runs, run) {
  const text = run.text.replace(/\s+/g, ' ');
  if (!text) return;
  const last = runs[runs.length - 1];
  if (last && last.href === run.href && last.b === run.b && last.i === run.i) {
    last.text += text;
  } else {
    runs.push({ ...run, text });
  }
}

function runsOf(el, baseUrl, style = {}, runs = []) {
  for (const node of el.childNodes) {
    if (node.nodeType === 3) {
      pushRun(runs, { text: node.textContent, ...style });
    } else if (node.nodeType === 1) {
      const tag = node.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME') continue;
      if (tag === 'BR') pushRun(runs, { text: ' ', ...style });
      else if (tag === 'A') {
        const href = absHttp(node.getAttribute('href'), baseUrl);
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (text) pushRun(runs, { text, ...style, ...(href ? { href } : {}) });
      } else if (tag === 'STRONG' || tag === 'B') runsOf(node, baseUrl, { ...style, b: true }, runs);
      else if (tag === 'EM' || tag === 'I') runsOf(node, baseUrl, { ...style, i: true }, runs);
      else runsOf(node, baseUrl, style, runs); // span/time/etc: descend
    }
  }
  return runs;
}

function trimRuns(runs) {
  if (runs.length) {
    runs[0].text = runs[0].text.replace(/^\s+/, '');
    runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/\s+$/, '');
  }
  return runs.filter((r) => r.text);
}

const runsText = (runs) => runs.map((r) => r.text).join('');

function blocksOf(contentHtml, baseUrl) {
  if (!contentHtml) return null;
  try {
    const { document } = parseHTML(`<html><body>${contentHtml}</body></html>`);
    for (const el of document.querySelectorAll(CHROME_SELECTOR)) el.remove();

    const found = [];
    const walk = (el) => {
      for (const node of el.children) {
        const tag = node.tagName;
        if (tag === 'P' || tag === 'H2' || tag === 'H3' || tag === 'H4' || tag === 'BLOCKQUOTE') {
          const type = tag === 'BLOCKQUOTE' ? 'quote' : tag.toLowerCase();
          const runs = trimRuns(runsOf(node, baseUrl));
          if (runs.length) found.push({ type, runs });
        } else if (tag === 'UL' || tag === 'OL') {
          const items = [...node.children]
            .filter((li) => li.tagName === 'LI')
            .map((li) => trimRuns(runsOf(li, baseUrl)))
            .filter((runs) => runs.length);
          if (items.length) found.push({ type: tag.toLowerCase(), items });
        } else if (
          tag !== 'FIGURE' && tag !== 'SCRIPT' && tag !== 'STYLE' &&
          tag !== 'IFRAME' && tag !== 'FORM' && tag !== 'TABLE'
        ) {
          walk(node); // div/section wrappers Readability leaves around content
        }
      }
    };
    walk(document.body);

    // Same header-debris filter as the plain-text path, so both views agree
    // on where the article actually starts.
    let started = false;
    let skipped = 0;
    let budget = MAX_TEXT_CHARS;
    const blocks = [];
    for (const block of found) {
      const text = block.items
        ? block.items.map(runsText).join(' ')
        : runsText(block.runs);
      if (!text.trim()) continue;
      if (!started && skipped < 12) {
        if (DATELINE_RE.test(text) || BIO_RE.test(text) || !SENTENCE_END_RE.test(text)) {
          skipped += 1;
          continue;
        }
        started = true;
      }
      blocks.push(block);
      budget -= text.length;
      if (blocks.length >= MAX_BLOCKS || budget <= 0) break;
    }
    return blocks.length ? blocks : null;
  } catch {
    return null;
  }
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
    // Remove chrome BEFORE Readability: it strips class attributes from its
    // output, so class-based selectors only work on the source document.
    for (const junk of document.querySelectorAll(CHROME_SELECTOR)) junk.remove();
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
    blocks: blocksOf(parsed.content, finalUrl),
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
