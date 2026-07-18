// Maintenance script: checks every registered RSS feed with the same parser
// the app uses. Run with `npm run verify:feeds` when adding or auditing
// sources.
import Parser from 'rss-parser';
import { RSS_SOURCES } from '../config/sources.js';

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MeridianBot/1.0)' },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
    ],
  },
});

const now = Date.now();

function itemHasImage(item) {
  const media = (item.mediaContent || []).concat(item.mediaThumbnail || []);
  if (media.some((m) => m?.$?.url)) return true;
  if (item.enclosure?.url && /image|jpg|jpeg|png|webp/i.test(item.enclosure.type || item.enclosure.url)) return true;
  const html = item['content:encoded'] || item.content || '';
  return /<img[^>]+src=/i.test(html);
}

async function check(source) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = feed.items || [];
    const dates = items
      .map((i) => Date.parse(i.isoDate || i.pubDate || ''))
      .filter((t) => !Number.isNaN(t));
    const latest = dates.length ? Math.max(...dates) : null;
    const withImages = items.filter(itemHasImage).length;
    return {
      id: source.id,
      ok: items.length > 0 && latest !== null,
      channel: (feed.title || '').slice(0, 60),
      items: items.length,
      latest: latest ? new Date(latest).toISOString() : null,
      fresh48h: latest ? now - latest < 48 * 3600 * 1000 : false,
      images: `${withImages}/${items.length}`,
    };
  } catch (err) {
    return { id: source.id, ok: false, error: String(err.message || err).slice(0, 90) };
  }
}

const lang = process.argv[2] || 'en';
const results = await Promise.all((RSS_SOURCES[lang] || []).map(check));
for (const r of results) console.log(JSON.stringify(r));
const bad = results.filter((r) => !r.ok || !r.fresh48h);
console.log(`\nTOTAL: ${results.length}, OK+fresh: ${results.length - bad.length}, problematic: ${bad.length}`);
for (const b of bad) console.log('PROBLEM:', b.id, b.error || `latest=${b.latest}`);
