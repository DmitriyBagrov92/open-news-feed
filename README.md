# Meridian — The world, as it happens

Meridian is an open-source world news feed. A single Node.js service aggregates
dozens of verified open sources into one freshest-first grid, with live
on-device translation and AI daily briefs. There are no accounts and no
tracking — your preferences never leave your browser.

<!-- screenshot placeholder: add a screenshot of the feed here -->

## Features

- **39 keyless RSS sources across 7 categories** (world, business, technology,
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
- **i18n-ready.** English now; add a language by adding a feed list and a
  locale table.

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
