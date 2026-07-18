// Shared normalization helpers: HTML stripping, entity decoding,
// URL canonicalization and article id hashing.

import { createHash } from 'node:crypto';

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', rsquo: '’',
  lsquo: '‘', rdquo: '”', ldquo: '“', copy: '©',
  reg: '®', trade: '™', deg: '°', pound: '£',
  euro: '€', dollar: '$', middot: '·', laquo: '«',
  raquo: '»', times: '×', shy: '', amp_: '&',
};

export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => {
      const key = name.toLowerCase();
      return key in NAMED_ENTITIES ? NAMED_ENTITIES[key] : m;
    });
}

function safeCodePoint(cp) {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

export function stripHtml(html) {
  if (!html) return '';
  const noTags = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').trim();
}

// Clamp text at `max` chars on a word boundary, appending an ellipsis.
export function clampText(text, max) {
  if (!text || text.length <= max) return text || '';
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '') + '…';
}

const TRACKING_PARAM = /^(utm_\w+|fbclid|gclid|yclid|msclkid|mc_cid|mc_eid|_hs\w+|igshid|ref|cmpid|CMP)$/i;

// Canonicalize a URL for dedupe: lowercase host, drop tracking params,
// trailing slash and hash fragment. Returns null for unparsable input.
export function normalizeUrl(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';
  const kept = [];
  for (const [key, value] of u.searchParams) {
    if (!TRACKING_PARAM.test(key)) kept.push([key, value]);
  }
  u.search = '';
  for (const [key, value] of kept) u.searchParams.append(key, value);
  let s = u.toString();
  if (s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

export function articleId(normalizedUrl) {
  return createHash('sha1').update(normalizedUrl).digest('hex').slice(0, 12);
}

// First <img src="..."> found in an HTML fragment, or null.
export function firstImgSrc(html) {
  if (!html) return null;
  const m = String(html).match(/<img[^>]+src\s*=\s*["']([^"']+)["']/i);
  if (!m) return null;
  const src = decodeEntities(m[1]).trim();
  return /^https?:\/\//i.test(src) ? src : null;
}
