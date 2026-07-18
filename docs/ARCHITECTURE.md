# Meridian — Architecture & API Contract

Meridian is a single Node.js service: an Express backend that aggregates news
from many open sources and serves a static, build-free frontend. This document
is the contract between the backend (`server.js`, `lib/**`, `config/**`) and
the frontend (`public/**`). Both sides must conform to it exactly.

```
┌────────────────────────────────────────────────────────┐
│  Node.js (Express)                                     │
│                                                        │
│  config/sources.js   verified source registry (per     │
│                      language; "en" only for now)      │
│  lib/fetchers/rss.js keyless RSS/Atom adapters         │
│  lib/fetchers/apis.js keyed API adapters (enabled only │
│                      when the env key is present)      │
│  lib/store.js        in-memory article store: refresh  │
│                      loop, dedupe, sort, query         │
│  lib/extract.js      readability extraction (preview)  │
│  lib/ai.js           summarize / translate providers   │
│  server.js           routes + static /public + limits  │
└──────────────┬─────────────────────────────────────────┘
               │ same-origin JSON API (no CORS needed)
┌──────────────▼─────────────────────────────────────────┐
│  public/ (vanilla ES modules, no build step)           │
│  index.html · css/styles.css · js/{app, api, prefs,    │
│  ai, i18n, cards, modal, time, plasma, timescale,      │
│  motion, toast, dom, boot}.js · vendor/motion.js       │
└────────────────────────────────────────────────────────┘
```

Principles:

- **Works with zero configuration.** RSS sources need no keys. Every env var
  is optional and only unlocks extras.
- **Secrets never reach the client.** All keyed calls happen server-side; keys
  live in `.env` (gitignored) / Railway variables.
- **User preferences never reach the server.** Theme, language, saved articles
  etc. are stored in `localStorage` only. No auth, no cookies, no tracking.
- **English now, any language later.** Sources are registered per language;
  UI strings live in an i18n table; the API takes `lang`.

---

## Data shapes

### Article

```jsonc
{
  "id": "a1b2c3d4e5f6",          // stable hash of normalized URL
  "title": "…",                   // plain text, HTML-stripped
  "description": "…",             // plain text, HTML-stripped, ≤ 500 chars
  "url": "https://…",             // canonical link to the source article
  "image": "https://…" | null,    // best available image URL
  "source": { "id": "bbc-world", "name": "BBC World", "homepage": "https://bbc.com" },
  "category": "world",            // one of CATEGORIES below
  "publishedAt": "2026-07-18T09:30:00.000Z",  // ISO 8601 UTC
  "language": "en"
}
```

### Categories

`world`, `business`, `technology`, `science`, `sports`, `culture`, `health`.
The client additionally uses the pseudo-category `all`.

---

## HTTP API

All endpoints are same-origin JSON. Errors use
`{ "error": { "code": "string", "message": "string" } }` with an appropriate
HTTP status.

### `GET /api/news`

Query params (all optional):

| param      | type   | default | notes                                        |
|------------|--------|---------|----------------------------------------------|
| `category` | string | `all`   | one of the categories above or `all`         |
| `q`        | string | —       | case-insensitive substring match on title+description |
| `sources`  | string | —       | CSV of source ids to include (allowlist)     |
| `exclude`  | string | —       | CSV of source ids to exclude                 |
| `page`     | int    | `1`     | 1-based                                      |
| `pageSize` | int    | `30`    | max 100                                      |
| `lang`     | string | `en`    | article language                             |
| `since`    | string | —       | ISO date; only articles newer than this      |
| `histogram`| `1`    | —       | include per-hour counts for the last 24h     |

Response `200`:

```jsonc
{
  "articles": [ Article, … ],   // ALWAYS sorted by publishedAt DESC
  "total": 812,                  // total matching articles
  "page": 1,
  "pageSize": 30,
  "updatedAt": "2026-07-18T09:35:12.000Z",  // last successful refresh
  "latestId": "a1b2c3…",         // id of the newest article (for new-items polling)
  "timeline": [0, 3, …]          // only with histogram=1: 24 hourly counts,
                                 // oldest hour first (index 23 = now) —
                                 // drives the plasma-timeline visualization
}
```

### `GET /api/sources`

```jsonc
{
  "sources": [
    { "id": "bbc-world", "name": "BBC World", "category": "world",
      "type": "rss" | "api", "homepage": "https://bbc.com",
      "enabled": true,           // false for keyed sources with no key set
      "requiresKey": false }
  ],
  "categories": ["world", "business", …]
}
```

### `GET /api/article?url=<encoded url>`

Server-side readability extraction for the preview modal. **SSRF guard:** the
host of `url` (or of the final redirect target) must belong to a domain in the
allowlist derived from `config/sources.js` (registered homepages + feed
domains, subdomains included) — otherwise respond `403`. Timeout 10s, response
body capped at 2.5 MB, only `text/html` content types.

Response `200`:

```jsonc
{
  "title": "…",
  "byline": "…" | null,
  "text": "…",                 // plain text paragraphs joined by \n\n, ≤ 8000 chars
  "excerpt": "…" | null,
  "image": "https://…" | null,
  "siteName": "…" | null
}
```

`422` if extraction fails — the client then falls back to the RSS description.

### `POST /api/summarize`

**Reserved for the future premium tier (server-side LLM summarization).**
In the current free version this endpoint ALWAYS responds `501`
`{ "error": { "code": "premium-only", "message": "Server-side AI summarization is a planned premium feature" } }`.

Summarization in the free version happens entirely on the client:
browser built-in `Summarizer` API (Chrome 138+/Edge, on-device, free) →
local frequency-based extractive summarizer (works everywhere). The request
body shape below is fixed now so the client and the future premium backend
agree:

```jsonc
// "brief" mode: daily-brief digest of many headlines
{ "mode": "brief",
  "articles": [ { "title": "…", "description": "…", "source": "BBC World" }, … ],  // ≤ 30
  "targetLang": "en" }

// "article" mode: summary of one article's extracted text
{ "mode": "article", "title": "…", "text": "…", "targetLang": "en" }
```

Future premium response `200`: `{ "summary": "…", "provider": "…" }` — the
client must already handle this shape. Client ladder order: browser
built-in Summarizer first (free, on-device, private), then the server
endpoint (501 continues in the free version), then the local extractive
summarizer — so enabling premium later requires zero client changes.

### `POST /api/translate`

```jsonc
{ "texts": ["…", "…"], "target": "de", "source": "en" }   // ≤ 20 texts, ≤ 1000 chars each
```

Response `200`: `{ "translations": ["…", "…"], "provider": "libretranslate" | "mymemory" }`
Response `501` `{ "error": { "code": "no-provider", … } }` when no server
translator is available (client relies on the browser Translator API first,
and only calls this as fallback).

### `GET /api/health`

`{ "ok": true, "uptime": 123.4, "articles": 812, "sources": { "ok": 27, "failing": 1 }, "updatedAt": "…" }`
Used as the Railway healthcheck path.

---

## Backend behavior

- **Refresh loop.** On boot, fetch all enabled sources concurrently (per-source
  timeout 12s), then re-fetch every `REFRESH_MINUTES` (default 5). Keyed API
  sources additionally respect a 15-minute minimum interval between
  *successful* fetches (free-quota protection); a failed attempt is retried on
  the next cycle. A failing source keeps its last good articles; log a single
  warning line per failure. Never let one bad source break the cycle.
  After each cycle, `lib/enrich.js` backfills `og:image` for the newest
  articles whose feeds carry no image (allowlist-guarded, 30 fetches per
  cycle, cached per article id).
- **Normalization.** Strip HTML from titles/descriptions, decode entities,
  clamp description at 500 chars on a word boundary. Discard items without a
  title+link, or with an unparsable/absent date, or older than 7 days.
  Image discovery order for RSS: `media:content` → `media:thumbnail` →
  `enclosure` (image/*) → first `<img src>` in content/description.
- **Dedupe.** `id = sha1(normalized url)` where normalization lowercases the
  host, drops `utm_*`/`fbclid`-style params, trailing slashes and hash.
  Additionally drop same-source items with identical normalized titles.
- **Store cap.** Keep at most 3000 articles; evict oldest beyond that.
- **AI providers** (`lib/ai.js`): summarize → always `501 premium-only` in the
  free version (structure the module so a premium provider chain — configurable
  OpenAI-compatible endpoint + Anthropic — can be added later without touching
  routes). Translate → LibreTranslate (if `LIBRETRANSLATE_URL` set; append
  `LIBRETRANSLATE_API_KEY` when present) → MyMemory
  (`api.mymemory.translated.net/get`, free, keyless, chunk texts ≤ 450 chars,
  best-effort) → `501`.
- **Rate limiting.** Simple in-memory limiter on `/api/summarize`,
  `/api/translate`, `/api/article`: 30 requests/min per IP → `429`.
- **Security headers.** `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, and a CSP that allows self + Google Fonts
  (`fonts.googleapis.com`, `fonts.gstatic.com`) + `img-src https: data:`
  (article images come from many hosts). No inline event handlers.
- **PORT** from `process.env.PORT` (Railway sets it).

## Frontend behavior

- Vanilla ES modules, no build step, no external JS dependencies.
- **Never insert feed-derived strings via `innerHTML`.** Build DOM nodes and
  set `textContent`, or escape rigorously. Feed content is untrusted.
- Preferences in `localStorage` under the single key `meridian:prefs` (one JSON
  object: `theme`, `uiLocale`, `targetLang`, `autoTranslate`, `hiddenSources`,
  `category`, `density`, `saved` [array of Article]). Corrupt/missing data must
  never crash the app — always fall back to defaults.
- Poll `GET /api/news?pageSize=1` every 90s; if `latestId` changed, show a
  "N new stories" pill that prepends fresh items on click.
- Browser AI (feature-detect, never assume): global `Translator` and
  `Summarizer` (Chrome built-in AI). Check `availability()`; trigger
  `create()` from a user gesture to allow model download; degrade to the
  server endpoints, then (for summarize) to a local frequency-based extractive
  summarizer. All wrapped in `public/js/ai.js`.
- i18n: `public/js/i18n.js` exports `t(key)` with an `en` table; UI locale is
  a preference. Adding a language = adding one table + (optionally) sources
  for that language in `config/sources.js`.

## Module ownership (for parallel work)

| Owner          | Files |
|----------------|-------|
| backend agent  | `server.js`, `lib/**` |
| frontend agent | `public/**` |
| docs agent     | `README.md`, `railway.json` |
| pre-written    | `package.json`, `.gitignore`, `.env.example`, `LICENSE`, `config/sources.js`, `docs/ARCHITECTURE.md` |

Do not edit files outside your ownership.
