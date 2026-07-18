// RSS/Atom/RDF adapter. Handles verified feed quirks:
//  - DW + Euronews are RSS 1.0 (RDF) with dc:date
//  - The Verge is Atom (isoDate covers it)
//  - many feeds carry no media tags → fall back to first <img> in
//    content:encoded / content / description, else null.

import Parser from 'rss-parser';
import { stripHtml, clampText, firstImgSrc } from '../normalize.js';

export const USER_AGENT = 'Mozilla/5.0 (compatible; MeridianBot/1.0)';

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'contentEncoded'],
      ['dc:date', 'dcDate'],
    ],
  },
});

function mediaUrl(entries) {
  if (!Array.isArray(entries)) return null;
  let best = null;
  let bestWidth = -1;
  for (const entry of entries) {
    const attrs = entry && entry.$ ? entry.$ : entry;
    const url = attrs && attrs.url;
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (attrs.medium && attrs.medium !== 'image') continue;
    if (attrs.type && !/^image\//i.test(attrs.type)) continue;
    const width = Number(attrs.width) || 0;
    if (width > bestWidth) {
      bestWidth = width;
      best = url;
    }
  }
  return best;
}

function itemImage(item) {
  return (
    mediaUrl(item.mediaContent) ||
    mediaUrl(item.mediaThumbnail) ||
    (item.enclosure && item.enclosure.url && /^https?:\/\//i.test(item.enclosure.url) &&
      (!item.enclosure.type || /^image\//i.test(item.enclosure.type))
      ? item.enclosure.url
      : null) ||
    firstImgSrc(item.contentEncoded) ||
    firstImgSrc(item.content) ||
    firstImgSrc(item.summary) ||
    null
  );
}

const MAX_FEED_BYTES = 5 * 1024 * 1024;

// ISO 8601 datetime with no timezone designator: treat as UTC, not
// server-local (some RDF feeds emit bare dc:date like 2026-07-18T09:30:00).
function parseFeedDate(dateStr) {
  if (!dateStr) return null;
  const s = String(dateStr).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(s)) return new Date(s + 'Z');
  return new Date(s);
}

// Fetch and parse one RSS source. `signal` aborts the network request; the
// store additionally enforces a hard overall timeout. Returns raw items:
// { title, description, url, image, publishedAt: Date }.
export async function fetchRss(source, signal) {
  const res = await fetch(source.url, {
    signal,
    redirect: 'follow',
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Feed bodies are untrusted — cap the bytes we buffer.
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
    if (total > MAX_FEED_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error(`feed exceeds ${MAX_FEED_BYTES} bytes`);
    }
  }
  const xml = Buffer.concat(chunks).toString('utf8');
  const feed = await parser.parseString(xml);

  const items = [];
  for (const item of feed.items || []) {
    const publishedAt = parseFeedDate(item.isoDate || item.pubDate || item.dcDate);
    items.push({
      title: stripHtml(item.title),
      description: clampText(
        stripHtml(item.contentSnippet || item.summary || item.content || item.contentEncoded || ''),
        500
      ),
      url: item.link || item.guid || null,
      image: itemImage(item),
      publishedAt,
    });
  }
  return items;
}
