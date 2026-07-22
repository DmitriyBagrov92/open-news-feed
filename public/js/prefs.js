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
  gridSize: 0,              // card sizing level: -2 (dense) … 2 (large)
  saved: [],                // full Article objects — the Saved tab works offline
  authorId: null,           // anonymous comment identity (lazy UUID)
  feedSub: 'recommended',   // Your Feed sub-tab: 'recommended' | 'saved'
  // Taste profile from onboarding likes/dislikes — device-only, never sent
  // to the server. Weights per source / category / title entity.
  taste: { count: 0, sources: {}, cats: {}, tokens: {}, rated: [] },
});

function sanitize(raw) {
  const p = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };
  if (!['auto', 'light', 'dark'].includes(p.theme)) p.theme = 'auto';
  if (typeof p.uiLocale !== 'string') p.uiLocale = 'en';
  if (typeof p.targetLang !== 'string') p.targetLang = 'en';
  if (typeof p.category !== 'string') p.category = 'all';
  if (typeof p.density !== 'string') p.density = 'comfortable';
  p.gridSize = Math.max(-2, Math.min(2, Math.trunc(Number(p.gridSize)) || 0));
  p.autoTranslate = Boolean(p.autoTranslate);
  p.feedSub = p.feedSub === 'saved' ? 'saved' : 'recommended';
  p.taste = sanitizeTaste(p.taste);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof p.authorId !== 'string' || !UUID_RE.test(p.authorId)) p.authorId = null;
  p.hiddenSources = Array.isArray(p.hiddenSources)
    ? p.hiddenSources.filter((id) => typeof id === 'string')
    : [];
  p.saved = Array.isArray(p.saved)
    ? p.saved.filter(
        (a) =>
          a && typeof a === 'object' &&
          typeof a.id === 'string' &&
          typeof a.title === 'string' &&
          // localStorage is user-writable — a corrupted javascript: URL must
          // never become a clickable href
          typeof a.url === 'string' && /^https?:\/\//i.test(a.url) &&
          (a.image == null || (typeof a.image === 'string' && /^https?:\/\//i.test(a.image)))
      )
    : [];
  return p;
}

// Weights are finite numbers clamped to [-50, 50]; tokens capped at 400
// (highest |weight| kept); rated ids 12-hex, newest 300. Corrupt data
// degrades to the default profile, never crashes.
function sanitizeTaste(raw) {
  const def = { count: 0, sources: {}, cats: {}, tokens: {}, rated: [] };
  if (!raw || typeof raw !== 'object') return def;
  const weights = (obj, cap = Infinity) => {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    const entries = Object.entries(obj)
      .filter(([k, v]) => typeof k === 'string' && Number.isFinite(Number(v)))
      .map(([k, v]) => [k, Math.max(-50, Math.min(50, Number(v)))])
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, cap);
    for (const [k, v] of entries) out[k] = v;
    return out;
  };
  return {
    count: Math.max(0, Math.trunc(Number(raw.count)) || 0),
    sources: weights(raw.sources, 100),
    cats: weights(raw.cats, 20),
    tokens: weights(raw.tokens, 400),
    rated: Array.isArray(raw.rated)
      ? raw.rated.filter((id) => typeof id === 'string' && /^[0-9a-f]{12}$/.test(id)).slice(0, 300)
      : [],
  };
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

// Anonymous comment identity: created lazily on first use, stable per
// device, rotates only when the user clears their storage.
export function ensureAuthorId() {
  if (!prefs.authorId) {
    prefs.authorId = crypto.randomUUID();
    savePrefs();
  }
  return prefs.authorId;
}
