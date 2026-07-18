// User preferences — localStorage only, single key, never sent to the server.
// Corrupt or missing data always degrades to defaults, never crashes.

const KEY = 'meridian:prefs';

const DEFAULTS = Object.freeze({
  theme: 'auto',            // 'auto' | 'light' | 'dark'
  uiLocale: 'en',
  targetLang: 'en',
  autoTranslate: false,
  hiddenSources: [],        // source ids excluded from the feed
  category: 'all',
  density: 'comfortable',   // reserved by the contract
  saved: [],                // full Article objects — the Saved tab works offline
});

function sanitize(raw) {
  const p = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['auto', 'light', 'dark'].includes(p.theme)) p.theme = 'auto';
  if (typeof p.uiLocale !== 'string') p.uiLocale = 'en';
  if (typeof p.targetLang !== 'string') p.targetLang = 'en';
  if (typeof p.category !== 'string') p.category = 'all';
  if (typeof p.density !== 'string') p.density = 'comfortable';
  p.autoTranslate = Boolean(p.autoTranslate);
  p.hiddenSources = Array.isArray(p.hiddenSources)
    ? p.hiddenSources.filter((id) => typeof id === 'string')
    : [];
  p.saved = Array.isArray(p.saved)
    ? p.saved.filter(
        (a) =>
          a && typeof a === 'object' &&
          typeof a.id === 'string' &&
          typeof a.title === 'string' &&
          typeof a.url === 'string'
      )
    : [];
  return p;
}

function load() {
  try {
    return sanitize(JSON.parse(localStorage.getItem(KEY) || 'null'));
  } catch {
    return sanitize(null);
  }
}

export const prefs = load();

export function savePrefs() {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* storage full / unavailable — preferences just don't persist */
  }
}

export function setPref(key, value) {
  prefs[key] = value;
  savePrefs();
}

export function isSaved(id) {
  return prefs.saved.some((a) => a.id === id);
}

// Returns true when the article ends up saved.
export function toggleSaved(article) {
  const index = prefs.saved.findIndex((a) => a.id === article.id);
  if (index >= 0) prefs.saved.splice(index, 1);
  else prefs.saved.unshift(article);
  savePrefs();
  return index < 0;
}
