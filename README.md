# Meridian — The world, as it happens

Meridian is an open-source world news feed. A single Node.js service aggregates
dozens of verified open sources into one freshest-first grid, with live
on-device translation and AI daily briefs. There are no accounts and no
tracking — your preferences never leave your browser.

<!-- screenshot placeholder: add a screenshot of the feed here -->

## Features

- **64 keyless RSS sources across 8 categories and 15+ countries** — from BBC, NPR and Al Jazeera to TASS, CGTN, SCMP, Middle East Eye, The Jerusalem Post, Times of India and AllAfrica: one story, many national and political angles (world, business, technology,
  science, sports, culture, health) — works with zero configuration. Plus 5
  optional keyed APIs (GNews, The Guardian, NYT, NewsData.io, Currents) that
  light up when you add a key.
- **Sorted by freshness.** Articles are deduplicated and always ordered by
  publish time, newest first.
- **Live preview** with server-side full-text extraction (Mozilla Readability),
  guarded by a strict source-domain allowlist.
- **Translation** via the browser's built-in Translator API (on-device, free),
  with a free server fallback (LibreTranslate → MyMemory).
- **AI daily brief** via the browser's built-in Summarizer API (on-device),
  with a local extractive fallback for every other browser. No keys, no server
  cost.
- **AI forecast (experimental)** — pull past the top of the feed and
  Chrome's built-in Prompt API (Gemini Nano, on-device) drafts four clearly
  labelled *possible* events for the next 7 days from the stories in view,
  each with a timeframe, a low/medium confidence tag and the real stories it
  builds on. Nothing leaves the device, no keys, no server cost. The feature
  simply does not exist on browsers without the API (currently Chrome 138+
  on desktop with the model installed); `?forecast=mock` previews the UI
  anywhere.
- **Cosmic design.** Deep-space dark theme by default with the timeline
  rendered as a living WebGL plasma band behind live world clocks (30fps,
  GPU, zero dependencies; static under reduced motion), plus a clean
  light "dawn" variant.
- **Anonymous comments.** Comment on any story, like/dislike others — no
  signup. Names ("Amber Falcon") and avatars are derived server-side from an
  opaque random id your browser generates once; the id itself is never shown
  or logged. Stored in SQLite via Node's built-in `node:sqlite` — zero extra
  dependencies.
- **No auth, no tracking.** Preferences (theme, language, hidden sources,
  saved articles) live in `localStorage` only.
- **One language setting.** The globe in the masthead and the Language row
  in Settings are the same preference: stories are translated into it, the
  AI brief and forecast answer in it, and the interface follows wherever a
  translation of the interface exists (English only so far — add a locale
  table to `public/js/i18n.js` and the interface switches with it).

## Quickstart

```bash
git clone https://github.com/DmitriyBagrov92/open-news-feed.git
cd open-news-feed
npm install
npm start
```

Open http://localhost:3000. Optionally:

```bash
cp .env.example .env   # then fill in any keys you have
```

Requires Node.js >= 22.13 (comments use the built-in `node:sqlite`; on older
Node the app still runs, comments just fall back to in-memory storage). No
build step.

## Configuration

Every variable is optional — the app works out of the box.

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default `3000`; Railway sets this automatically) |
| `REFRESH_MINUTES` | How often sources are re-fetched, in minutes (default `5`) |
| `GNEWS_API_KEY` | Enables the [GNews](https://gnews.io) source |
| `GUARDIAN_API_KEY` | Enables [The Guardian Open Platform](https://open-platform.theguardian.com/access/) source |
| `NYT_API_KEY` | Enables [The New York Times](https://developer.nytimes.com) source |
| `NEWSDATA_API_KEY` | Enables the [NewsData.io](https://newsdata.io) source |
| `CURRENTS_API_KEY` | Enables the [Currents API](https://currentsapi.services) source |
| `LIBRETRANSLATE_URL` | Server-side translation fallback: a LibreTranslate instance URL |
| `LIBRETRANSLATE_API_KEY` | API key for that LibreTranslate instance, if it needs one |
| `COMMENTS_DB` | SQLite file for anonymous comments (default `./data/comments.db`; point it at a mounted volume in production) |
| `USAGE_LOG_MINUTES` | Minutes between `usage` log lines (default `5`; `0` disables) — see Logs below |
| `PUBLIC_URL` | Public origin (e.g. `https://meridi.info`) for canonical, Open Graph and sitemap URLs; defaults to Railway's domain, else the request host |
| `GOOGLE_SITE_VERIFICATION` | Google Search Console ownership token — rendered as the `google-site-verification` meta tag (see Getting indexed) |
| `BING_SITE_VERIFICATION` | Bing Webmaster Tools ownership token — rendered as the `msvalidate.01` meta tag |
| `INDEXNOW_KEY` | Enables IndexNow pings (Bing, Yandex, Seznam, Naver) when the front page has a new top story; any 8–128 chars of `[A-Za-z0-9-]` — see Getting indexed |
| `INDEXNOW_MINUTES` | Minimum minutes between IndexNow pings (default `60`) |

## Deploy on Railway

1. Create a new Railway project from your GitHub repo — Railway auto-detects
   Node via Nixpacks; `railway.json` in this repo sets the start command and
   healthcheck.
2. Optionally add any of the variables above under **Variables**.
3. The healthcheck path is `/api/health`. `PORT` is provided automatically by
   Railway — do not set it.
4. **Comments persistence** — without a volume, comments survive restarts but
   not redeploys (each deploy gets a fresh container disk). To keep them:

   ```bash
   railway volume add --mount-path /data
   railway variables --set COMMENTS_DB=/data/comments.db
   ```

   The boot log tells you which mode you're in (`persistent volume`,
   `container disk`, or `memory fallback`).
5. Nixpacks picks a Node ≥ 22.13 automatically from `engines`; if your build
   pins an older Node, set `NIXPACKS_NODE_VERSION=22`.
6. **Memory** — Railway bills by resident memory, and an uncapped Node heap
   drifts to 250–300 MB regardless of how little data is live. `npm start`
   therefore runs Node with `--max-old-space-size=160 --max-semi-space-size=8`,
   which keeps the service around 150 MB with ~5× headroom over the measured
   worst case (a refresh cycle, six article extractions and a query burst at
   once peak at ~32 MB of heap). Edit the `start` script in `package.json` if
   you add many sources or raise the store cap.
7. **Start command** — `railway.json` runs `exec node … server.js` directly
   (same flags as `npm start`) rather than `npm start`: Railway retires a
   deployment with SIGTERM, and through npm the signal stops at npm's
   `sh -c` wrapper, so Node never shuts down cleanly and Railway reports the
   old deployment as crashed. Keep the two commands' flags in sync.

### Logs

Every log line is a single JSON object with `level` (`info` / `warn` /
`error`), `message` and searchable attributes — the format Railway's log
explorer parses, so you can filter with `@level:warn`, `@message:usage`,
`@source:bbc-world` or `@visitors:>0`.

Every `USAGE_LOG_MINUTES` (default 5) the service emits one `usage` line
answering *who is here and what do they use*:

```jsonc
{ "level": "info", "message": "usage", "window_min": 5,
  "visitors": 14, "authors": 3,            // unique clients / comment identities this window
  "visitors_today": 212, "authors_today": 19,
  "requests": 380, "page_loads": 17, "news": 120, "reactions": 190,
  "comments_read": 8, "comments_posted": 1, "comment_votes": 0, "story_votes": 4,
  "article_reads": 22, "translations": 9, "battles": 6,
  "ok": 372, "client_error": 6, "rate_limited": 2, "not_implemented": 3, "server_error": 0,
  "avg_ms": 4, "max_ms": 812,
  "rss_mb": 148, "heap_mb": 21, "uptime_h": 36.5,
  "articles": 2610, "sources_ok": 82, "sources_failing": 1 }
```

Identities are counted, never logged: IPs and comment ids are hashed with a
per-boot random salt before they enter a bounded set, and only the set
sizes leave the process. A zero-visitor line is still emitted as a heartbeat.
Boot (`listening`), each refresh (`refreshed`, `enriched images`), storage
mode (`comments storage ready`) and every failing feed (`source failed`) are
logged the same way.

## Discoverability & sharing

Meridian is built to be found and recommended — by search engines, by AI
assistants and by people sharing a link — at zero cost:

- **Server-rendered headlines.** `GET /` is rendered by the server
  (`lib/page.js`): the HTML already contains the 30 latest headlines with
  source, time and description, so crawlers and answer engines that do not
  run JavaScript (GPTBot, ClaudeBot, PerplexityBot, Googlebot's first pass)
  see real, fresh content. The app hides the list and takes over.
- **`/llms.txt`** — a plain-language description of the service, how to
  refer to it and the read-only API, for AI assistants ([llmstxt.org](https://llmstxt.org)).
- **`/robots.txt`** welcomes every crawler and AI agent explicitly and points
  to **`/sitemap.xml`** (lastmod = last refresh).
- **Social cards.** Open Graph + Twitter tags with `/og.png` (1200×630), so a
  shared link unfurls with the wordmark and the pitch on X, Telegram,
  Slack, LinkedIn, WhatsApp.
- **Structured data.** JSON-LD `WebSite` / `Organization` / `WebApplication`
  (free, MIT, feature list) for rich results.
- **Installable.** `/manifest.webmanifest` + icons: "Add to Home Screen" on
  phones, install on desktop Chrome/Edge.
- **The pitch is on the page.** The footer states what Meridian is: open
  source, AI on your device, no ads, no accounts, no tracking.

Absolute URLs come from `PUBLIC_URL` (or Railway's domain). If you rebrand
or change the domain, edit the inline SVGs in `scripts/brand-assets.sh` and
run it (macOS, no dependencies) to regenerate `og.png` and the icons.

### Getting indexed (free, ~15 minutes, once)

Search engines find a site on their own eventually; registering it makes
that days instead of months and gives you crawl/impression stats. Both
consoles are free with no paid tier.

**Google Search Console** — <https://search.google.com/search-console>

1. Sign in with any Google account → **Add property** → choose
   **URL prefix** and enter `https://meridi.info` (your `PUBLIC_URL`).
2. Under verification methods pick **HTML tag**. Google shows
   `<meta name="google-site-verification" content="TOKEN">`. Copy only the
   `TOKEN`.
3. On Railway set the variable `GOOGLE_SITE_VERIFICATION=TOKEN`
   (`railway variables --set GOOGLE_SITE_VERIFICATION=TOKEN`) and redeploy.
   Check `curl -s https://meridi.info/ | grep google-site-verification`.
4. Back in Search Console press **Verify**. Then **Sitemaps** → enter
   `sitemap.xml` → **Submit**. Optionally **URL inspection** →
   `https://meridi.info/` → **Request indexing**.

**Bing Webmaster Tools** — <https://www.bing.com/webmasters> (also feeds
DuckDuckGo, Yahoo, Ecosia and Microsoft Copilot)

- Easiest: sign in (Microsoft, Google or Facebook account) → **Import from
  Google Search Console** → pick the site. Ownership and the sitemap are
  imported; nothing to configure.
- Manual alternative: **Add a site** → `https://meridi.info` → **HTML Meta
  Tag** → copy the `content` of `<meta name="msvalidate.01" content="…">`
  into the Railway variable `BING_SITE_VERIFICATION`, redeploy, **Verify**,
  then **Sitemaps** → submit `https://meridi.info/sitemap.xml`.

Keep the variables set: both services re-check the tag periodically.
**IndexNow — fresh headlines within minutes** (Bing, Yandex, Seznam, Naver
and every other engine on the protocol). Crawlers otherwise decide when to
come back; IndexNow lets the server say "the front page changed" itself.

1. Make up a key: `openssl rand -hex 16`.
2. Set it on Railway: `railway variables --set INDEXNOW_KEY=<key>` and
   redeploy. The server now answers `https://meridi.info/<key>.txt` with the
   key (the protocol's ownership proof) and, after each feed refresh that
   brings a new top story — at most once per `INDEXNOW_MINUTES` — POSTs
   `https://meridi.info/` to `api.indexnow.org`, which fans the ping out to
   all participating engines.
3. Watch the logs: `indexnow submitted` with `status` 200 (or 202 while the
   key file is being verified the first time); `indexnow rejected` names the
   HTTP status (403 = key file not reachable, 422 = URL/host mismatch,
   429 = too many). Bing Webmaster Tools → **IndexNow** lists the pings.

Yandex Webmaster (<https://webmaster.yandex.com>) works the same way with
`<meta name="yandex-verification">`; add it to `VERIFICATION_TAGS` in
`lib/page.js` if you want it.

## Architecture

One Express server (`server.js` + `lib/**`) aggregates sources from
`config/sources.js` into an in-memory store and serves a build-free vanilla-JS
frontend from `public/`. The full API contract and data shapes are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Adding a source

1. Add an entry to the relevant language list in `config/sources.js`
   (`id`, `name`, `category`, `url`, `homepage`).
2. Verify it actually works and has parsable dates:

   ```bash
   npm run verify:feeds
   ```

3. Open a PR. Feeds that are abandoned, keyed, or lack publication dates are
   not accepted.

## Adding a language

1. Add a UI string table for the locale in `public/js/i18n.js`.
2. Optionally add a feed list for that language under a new key in
   `RSS_SOURCES` in `config/sources.js` (e.g. `de`, `fr`) — the backend picks
   it up via the API's `lang` parameter.

## Roadmap

**PREMIUM (planned)** — not part of the free version:

- Server-side LLM summarization (configurable OpenAI-compatible provider +
  Anthropic Claude). The `/api/summarize` endpoint is already reserved for
  this and currently always returns `501`.
- Cross-device sync of saved articles and preferences.
- Email digests.

The free version will always work without keys, accounts, or server-side AI.

## Contributing

Issues and PRs welcome. Keep it dependency-light: modern ESM JavaScript, no
TypeScript, no build step. Run `npm run verify:feeds` before submitting
source changes.

## License

[MIT](LICENSE)
