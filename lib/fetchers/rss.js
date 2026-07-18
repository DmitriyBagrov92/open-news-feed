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
    if (!url || (attrs.medium && attrs.medium !== 'image')) continue;
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
    (item.enclosure && item.enclosure.url &&
      (!item.enclosure.type || /^image\//i.test(item.enclosure.type))
      ? item.enclosure.url
      : null) ||
    firstImgSrc(item.contentEncoded) ||
    firstImgSrc(item.content) ||
    firstImgSrc(item.summary) ||
    null
  );
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
  const xml = await res.text();
  const feed = await parser.parseString(xml);

  const items = [];
  for (const item of feed.items || []) {
    const dateStr = item.isoDate || item.pubDate || item.dcDate;
    const publishedAt = dateStr ? new Date(dateStr) : null;
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
