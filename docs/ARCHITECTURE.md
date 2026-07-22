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
  ONE exception: the anonymous comment identity — a client-generated opaque
  UUID sent as `X-Author-Id` on comment endpoints only. It is a capability
  token: the server derives the public pseudonym/avatar from it and NEVER
  returns or logs the raw value.
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
  "blocks": [                  // structured body, or null when unavailable
    { "type": "p" | "h2" | "h3" | "h4" | "quote", "runs": [
        { "text": "…", "href": "https://…"?, "b": true?, "i": true? } ] },
    { "type": "ul" | "ol", "items": [ [ /* runs */ ] ] }
  ] | null,
  "excerpt": "…" | null,
  "image": "https://…" | null,
  "siteName": "…" | null
}
```

`blocks` preserves what plain text loses — links, headings (live-blog
timeline stamps), lists, quotes, bold/italic — as text runs only: **no HTML
crosses the wire**. `href` is always an absolute `http(s)` URL (≤ 2048
chars) resolved server-side; clients must render runs via `textContent` and
build anchors themselves, never via `innerHTML`. ≤ 150 blocks, sharing the
8000-char budget with `text`. `text` remains the canonical corpus for
summarize/translate.

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

### Bubble Battle (viewpoint clusters)

Registry fields on RSS sources: `lean: 'left' | 'center' | 'right'`
(AllSides-style consensus label; only lean-tagged sources enter the
clustering pool) and `battleOnly: true` (high-volume partisan feeds:
ingested with a 72h horizon, queryable by id — comments, votes and
`/api/article` extraction all work — but **never returned by `/api/news`**).
`GET /api/sources` exposes both fields (`lean`, `battle`).

**`GET /api/battles`** — clusters of the same story covered from different
leans. Recomputed lazily, cached per store refresh;
`Cache-Control: public, max-age=60`. Response `200`:

```jsonc
{ "battles": [ { "id": "12hex",
    "topic": ["Tariffs", "China"],           // top strong tokens
    "leans": { "left": 2, "center": 1, "right": 3 },
    "articles": [ { /* Article */, "lean": "right" } ] } ],
  "updatedAt": "ISO" }
```

Every battle has ≥ 2 distinct leans and ≥ 2 distinct sources, ≤ 9 articles
(lean-balanced, ≤ 2 per source), battles ranked by lean diversity → size →
freshness, at most 20 returned. Battle `id` is stable for a given member
set only — treat it as a rendering key, not an identity.

### Comments (anonymous)

Identity: the client generates `crypto.randomUUID()` once (localStorage) and
sends it as `X-Author-Id`. The server derives the display persona
deterministically — `sha1(authorId)` → adjective+noun name ("Amber Falcon")
and avatar `{hue: 0..359, glyph: 0..23}` (glyph indexes a fixed client-side
glyph set). Spoofable by design; abuse is bounded per-IP. Articles in
`/api/news` responses carry `commentCount` (int ≥ 0; absent = unknown) plus
article-reaction fields `up`, `down` (int ≥ 0) and `myVote`
(`1 | -1 | null`; only non-null when the request carried `X-Author-Id` —
`/api/news` sends `Vary: X-Author-Id`).

**`GET /api/comments`** — query `article` (required, 12-hex), `page` (1-based),
`pageSize` (default 20, max 50), `sort` (`new` default | `top` = up−down).
Optional `X-Author-Id`. Always `Cache-Control: no-store`. Response `200`:

```jsonc
{ "comments": [ { "id": "16hex", "name": "Amber Falcon",
    "avatar": { "hue": 213, "glyph": 4 },
    "body": "…", "createdAt": "ISO", "up": 3, "down": 1,
    "myVote": 1 | -1 | null } ],
  "total": 37, "page": 1, "pageSize": 20,
  "me": { "name": "…", "avatar": { … } } | null }
```

**`POST /api/comments`** — header `X-Author-Id` required; body
`{ "articleId": "12hex", "body": "…" }` (2–1000 chars after normalization;
article must currently exist in the store). `201` → created comment object.
Errors: `404 unknown-article`, `429 rate-limited` (5/min/IP, its own bucket)
`| too-fast` (≥10s per author) `| article-limit` (30/author/article),
`409 comments-full` (500/article) `| duplicate`.

**`POST /api/comments/:id/vote`** — header required; body
`{ "value": 1 | -1 | 0 }` (0 retracts) → `200 { "up", "down", "myVote" }`;
`404 unknown-comment`. One vote per author per comment (server-upserted).

**`POST /api/news/:id/vote`** — like/dislike a story. Header required; body
`{ "value": 1 | -1 | 0 }` (0 retracts) → `200 { "up", "down", "myVote" }`;
`404 unknown-article` for stories no longer in the store. One vote per
author per article (server-upserted, same `article_votes` storage horizon).

**`GET /api/reactions`** — batch counters for live-updating the visible
grid. Query `articles` = comma-separated 12-hex ids (max 150). Optional
`X-Author-Id`; `Cache-Control: no-store`, `Vary: X-Author-Id`. `200`:

```jsonc
{ "reactions": { "<articleId>": {
    "comments": 4, "up": 2, "down": 0, "myVote": 1 | -1 | null } } }
```

Every requested id gets an entry. Counters live in their own storage and
survive an article's exit from the 7-day store window until their rows hit
the same 7-day prune — so recently archived ids may return real non-zero
counts; ids with no rows return zeros. Do not use this endpoint to test
whether a story is still live.

Storage: SQLite via Node's built-in `node:sqlite` at `COMMENTS_DB` (default
`./data/comments.db`; on Railway mount a volume at `/data`). Requires
Node ≥ 22.13; older runtimes degrade to a non-persistent in-memory backend.
Comments are pruned on the same 7-day horizon as articles.

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
