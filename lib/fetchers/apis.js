// Keyed API adapters. Each is enabled only when its env key is present and
// respects a minimum fetch interval of 15 minutes (free-quota friendly),
// enforced by the store via MIN_API_INTERVAL_MS.

import { CATEGORIES } from '../../config/sources.js';
import { stripHtml, clampText } from '../normalize.js';
import { USER_AGENT } from './rss.js';

export const MIN_API_INTERVAL_MS = 15 * 60 * 1000;

// Provider section/category strings → our CATEGORIES.
const CATEGORY_MAP = {
  world: 'world', nation: 'world', national: 'world', politics: 'world',
  'general': 'world', news: 'world', 'us news': 'world', 'world news': 'world',
  international: 'world', europe: 'world', asia: 'world', africa: 'world',
  americas: 'world', 'middle east': 'world', 'u.s.': 'world', us: 'world',
  upshot: 'world', 'new york': 'world', opinion: 'world', 'top': 'world',

  business: 'business', money: 'business', economy: 'business',
  finance: 'business', markets: 'business', realestate: 'business',
  'real estate': 'business', 'your money': 'business', sundayreview: 'business',

  technology: 'technology', tech: 'technology', science: 'science',
  environment: 'science', climate: 'science', space: 'science',

  sports: 'sports', sport: 'sports', football: 'sports', soccer: 'sports',

  culture: 'culture', entertainment: 'culture', arts: 'culture', art: 'culture',
  music: 'culture', movies: 'culture', film: 'culture', books: 'culture',
  theater: 'culture', television: 'culture', style: 'culture',
  fashion: 'culture', 'pop culture': 'culture', celebrity: 'culture',
  lifestyle: 'culture', travel: 'culture', food: 'culture',

  health: 'health', wellness: 'health', well: 'health', medicine: 'health',
  covid: 'health', 'mental health': 'health',
};

function mapCategory(raw) {
  if (!raw) return 'world';
  const key = String(raw).toLowerCase().trim();
  if (CATEGORIES.includes(key)) return key;
  return CATEGORY_MAP[key] || 'world';
}

function cleanImage(value) {
  if (!value || typeof value !== 'string') return null;
  const v = value.trim();
  // Currents often returns the literal string "None".
  if (!v || v === 'None' || v === 'null') return null;
  return /^https?:\/\//i.test(v) ? v : null;
}

function item(title, description, url, image, category, publishedAt) {
  return {
    title: stripHtml(title),
    description: clampText(stripHtml(description || ''), 500),
    url: url || null,
    image: cleanImage(image),
    category: mapCategory(category),
    publishedAt: publishedAt ? new Date(publishedAt) : null,
  };
}

async function getJson(url, signal) {
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const ADAPTERS = {
  async gnews(key, signal) {
    const data = await getJson(
      `https://gnews.io/api/v4/top-headlines?lang=en&max=10&apikey=${encodeURIComponent(key)}`,
      signal
    );
    return (data.articles || []).map((a) =>
      item(a.title, a.description, a.url, a.image, 'world', a.publishedAt)
    );
  },

  async 'guardian-api'(key, signal) {
    const data = await getJson(
      `https://content.guardianapis.com/search?show-fields=thumbnail,trailText&page-size=30&api-key=${encodeURIComponent(key)}`,
      signal
    );
    return ((data.response && data.response.results) || []).map((r) =>
      item(
        r.webTitle,
        r.fields && r.fields.trailText,
        r.webUrl,
        r.fields && r.fields.thumbnail,
        r.sectionId || r.sectionName,
        r.webPublicationDate
      )
    );
  },

  async nyt(key, signal) {
    const data = await getJson(
      `https://api.nytimes.com/svc/topstories/v2/home.json?api-key=${encodeURIComponent(key)}`,
      signal
    );
    return (data.results || []).map((r) => {
      const media = Array.isArray(r.multimedia)
        ? r.multimedia.find((m) => m && m.url)
        : null;
      return item(r.title, r.abstract, r.url, media && media.url, r.section, r.published_date);
    });
  },

  async newsdata(key, signal) {
    const data = await getJson(
      `https://newsdata.io/api/1/latest?language=en&apikey=${encodeURIComponent(key)}`,
      signal
    );
    return (data.results || []).map((r) =>
      item(
        r.title,
        r.description,
        r.link,
        r.image_url,
        Array.isArray(r.category) ? r.category[0] : r.category,
        r.pubDate
      )
    );
  },

  async currents(key, signal) {
    const data = await getJson(
      `https://api.currentsapi.services/v1/latest-news?language=en&apiKey=${encodeURIComponent(key)}`,
      signal
    );
    return (data.news || []).map((n) =>
      item(
        n.title,
        n.description,
        n.url,
        n.image,
        Array.isArray(n.category) ? n.category[0] : n.category,
        n.published
      )
    );
  },
};

// Fetch one keyed API source. Same raw-item shape as fetchRss, plus a
// per-item `category` that overrides the source default.
export async function fetchApi(source, signal) {
  const adapter = ADAPTERS[source.id];
  if (!adapter) throw new Error(`no adapter for API source "${source.id}"`);
  const key = process.env[source.envKey];
  if (!key) throw new Error(`missing ${source.envKey}`);
  return adapter(key, signal);
}
