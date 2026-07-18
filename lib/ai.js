// AI providers: translation fallback chain and (future premium) summarize.
// Also hosts the tiny in-memory per-IP rate limiter shared by the AI-ish
// routes (/api/article, /api/translate, /api/summarize).

export class PremiumOnlyError extends Error {
  constructor() {
    super('Server-side AI summarization is a planned premium feature');
    this.status = 501;
    this.code = 'premium-only';
  }
}

export class NoProviderError extends Error {
  constructor() {
    super('No server translation provider is available');
    this.status = 501;
    this.code = 'no-provider';
  }
}

// ── summarize ────────────────────────────────────────────────────────────────
// Provider chain is intentionally structured so premium providers (Anthropic /
// OpenAI-compatible endpoints) can be pushed here later without route changes.
const SUMMARIZE_PROVIDERS = [];

export async function summarize(payload) {
  for (const provider of SUMMARIZE_PROVIDERS) {
    try {
      return await provider(payload);
    } catch (err) {
      console.warn(`[ai] summarize provider failed, falling back: ${err.message}`);
    }
  }
  throw new PremiumOnlyError();
}

// ── translate ────────────────────────────────────────────────────────────────

async function libreTranslate(texts, target, source) {
  const base = process.env.LIBRETRANSLATE_URL;
  if (!base) return null;
  const endpoint = base.replace(/\/+$/, '') + '/translate';
  const translations = [];
  for (const text of texts) {
    const body = { q: text, source: source || 'en', target, format: 'text' };
    if (process.env.LIBRETRANSLATE_API_KEY) body.api_key = process.env.LIBRETRANSLATE_API_KEY;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`LibreTranslate HTTP ${res.status}`);
    const data = await res.json();
    if (typeof data.translatedText !== 'string') throw new Error('LibreTranslate: bad response');
    translations.push(data.translatedText);
  }
  return translations;
}

// Split into chunks of <= maxLen chars, preferring sentence boundaries.
function chunkText(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+\s*|[^.!?]+$/g) || [text];
  // Hard-split any pathologically long sentence on word boundaries first.
  const pieces = [];
  for (const sentence of sentences) {
    let rest = sentence;
    while (rest.length > maxLen) {
      const cut = rest.lastIndexOf(' ', maxLen);
      const at = cut > 0 ? cut : maxLen;
      pieces.push(rest.slice(0, at));
      rest = rest.slice(at).trimStart();
    }
    if (rest) pieces.push(rest);
  }
  // Greedy pack pieces into chunks.
  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > maxLen) {
      chunks.push(current.trim());
      current = '';
    }
    current += piece;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

async function myMemoryTranslate(texts, target, source) {
  const langpair = `${source || 'en'}|${target}`;
  const translations = [];
  for (const text of texts) {
    const parts = [];
    // Sequential on purpose: be gentle with the free endpoint.
    for (const chunk of chunkText(text, 450)) {
      const url =
        'https://api.mymemory.translated.net/get?q=' +
        encodeURIComponent(chunk) +
        '&langpair=' +
        encodeURIComponent(langpair);
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
      const data = await res.json();
      const translated = data.responseData && data.responseData.translatedText;
      // responseStatus arrives as a number OR a string ("403"); quota/error
      // text is returned inside translatedText — never pass that through.
      if (typeof translated !== 'string' || Number(data.responseStatus) !== 200 ||
          /^MYMEMORY WARNING/i.test(translated)) {
        throw new Error(`MyMemory: bad response (status ${data.responseStatus})`);
      }
      parts.push(translated);
    }
    translations.push(parts.join(' '));
  }
  return translations;
}

export async function translateTexts(texts, target, source = 'en') {
  try {
    const viaLibre = await libreTranslate(texts, target, source);
    if (viaLibre) return { translations: viaLibre, provider: 'libretranslate' };
  } catch (err) {
    console.warn(`[ai] LibreTranslate failed, falling back: ${err.message}`);
  }
  try {
    const viaMyMemory = await myMemoryTranslate(texts, target, source);
    return { translations: viaMyMemory, provider: 'mymemory' };
  } catch (err) {
    console.warn(`[ai] MyMemory failed: ${err.message}`);
  }
  throw new NoProviderError();
}

// ── rate limiter ─────────────────────────────────────────────────────────────

const RATE_LIMIT = 30;
const WINDOW_MS = 60_000;
const hits = new Map(); // ip → { count, windowStart }

export function rateLimitOk(ip) {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return true;
  }
  entry.count += 1;
  return entry.count <= RATE_LIMIT;
}

// Periodic sweep so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now - entry.windowStart >= WINDOW_MS) hits.delete(ip);
  }
}, WINDOW_MS).unref();
