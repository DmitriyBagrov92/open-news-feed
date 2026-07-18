// Source registry for Meridian.
//
// Sources are grouped by article language so more languages can be added
// later: add a new key to RSS_SOURCES ("de", "fr", …) with its own feed list
// and the backend picks it up via the `lang` query param.
//
// Every RSS source is keyless and works out of the box. API sources are
// enabled only when their env key is present (see .env.example).

export const CATEGORIES = [
  'world',
  'business',
  'technology',
  'science',
  'sports',
  'culture',
  'health',
];

export const RSS_SOURCES = {
  en: [
    // ── world ────────────────────────────────────────────────────────────
    { id: 'bbc-world', name: 'BBC World', category: 'world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'guardian-world', name: 'The Guardian', category: 'world', url: 'https://www.theguardian.com/world/rss', homepage: 'https://www.theguardian.com' },
    { id: 'aljazeera', name: 'Al Jazeera', category: 'world', url: 'https://www.aljazeera.com/xml/rss/all.xml', homepage: 'https://www.aljazeera.com' },
    { id: 'npr-world', name: 'NPR World', category: 'world', url: 'https://feeds.npr.org/1004/rss.xml', homepage: 'https://www.npr.org' },
    { id: 'sky-world', name: 'Sky News', category: 'world', url: 'https://feeds.skynews.com/feeds/rss/world.xml', homepage: 'https://news.sky.com' },
    { id: 'dw-world', name: 'Deutsche Welle', category: 'world', url: 'https://rss.dw.com/rdf/rss-en-world', homepage: 'https://www.dw.com' },
    { id: 'france24', name: 'France 24', category: 'world', url: 'https://www.france24.com/en/rss', homepage: 'https://www.france24.com' },
    { id: 'abc-au', name: 'ABC News (AU)', category: 'world', url: 'https://www.abc.net.au/news/feed/51120/rss.xml', homepage: 'https://www.abc.net.au' },
    { id: 'euronews', name: 'Euronews', category: 'world', url: 'https://www.euronews.com/rss', homepage: 'https://www.euronews.com' },
    // Removed after verification (2026-07-18): CNN edition_world.rss is
    // abandoned (last item Sep 2023), CBC webfeed times out consistently.

    // ── business ─────────────────────────────────────────────────────────
    { id: 'bbc-business', name: 'BBC Business', category: 'business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'guardian-business', name: 'Guardian Business', category: 'business', url: 'https://www.theguardian.com/uk/business/rss', homepage: 'https://www.theguardian.com' },
    { id: 'cnbc', name: 'CNBC', category: 'business', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html', homepage: 'https://www.cnbc.com' },
    { id: 'yahoo-finance', name: 'Yahoo Finance', category: 'business', url: 'https://finance.yahoo.com/news/rssindex', homepage: 'https://finance.yahoo.com' },
    { id: 'fortune', name: 'Fortune', category: 'business', url: 'https://fortune.com/feed/', homepage: 'https://fortune.com' },
    { id: 'ft', name: 'Financial Times', category: 'business', url: 'https://www.ft.com/rss/home', homepage: 'https://www.ft.com' },

    // ── technology ───────────────────────────────────────────────────────
    { id: 'verge', name: 'The Verge', category: 'technology', url: 'https://www.theverge.com/rss/index.xml', homepage: 'https://www.theverge.com' },
    { id: 'techcrunch', name: 'TechCrunch', category: 'technology', url: 'https://techcrunch.com/feed/', homepage: 'https://techcrunch.com' },
    { id: 'ars', name: 'Ars Technica', category: 'technology', url: 'https://feeds.arstechnica.com/arstechnica/index', homepage: 'https://arstechnica.com' },
    { id: 'wired', name: 'Wired', category: 'technology', url: 'https://www.wired.com/feed/rss', homepage: 'https://www.wired.com' },
    { id: 'engadget', name: 'Engadget', category: 'technology', url: 'https://www.engadget.com/rss.xml', homepage: 'https://www.engadget.com' },
    { id: 'bbc-tech', name: 'BBC Tech', category: 'technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'hackernews', name: 'Hacker News', category: 'technology', url: 'https://hnrss.org/frontpage', homepage: 'https://news.ycombinator.com' },

    // ── science ──────────────────────────────────────────────────────────
    { id: 'sciencedaily', name: 'ScienceDaily', category: 'science', url: 'https://www.sciencedaily.com/rss/all.xml', homepage: 'https://www.sciencedaily.com' },
    { id: 'nature', name: 'Nature', category: 'science', url: 'https://www.nature.com/nature.rss', homepage: 'https://www.nature.com' },
    { id: 'nasa', name: 'NASA', category: 'science', url: 'https://www.nasa.gov/feed/', homepage: 'https://www.nasa.gov' },
    { id: 'phys-org', name: 'Phys.org', category: 'science', url: 'https://phys.org/rss-feed/', homepage: 'https://phys.org' },
    { id: 'bbc-science', name: 'BBC Science', category: 'science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'newscientist', name: 'New Scientist', category: 'science', url: 'https://www.newscientist.com/feed/home/', homepage: 'https://www.newscientist.com' },

    // ── sports ───────────────────────────────────────────────────────────
    { id: 'espn', name: 'ESPN', category: 'sports', url: 'https://www.espn.com/espn/rss/news', homepage: 'https://www.espn.com' },
    { id: 'bbc-sport', name: 'BBC Sport', category: 'sports', url: 'https://feeds.bbci.co.uk/sport/rss.xml', homepage: 'https://www.bbc.com/sport' },
    { id: 'guardian-sport', name: 'Guardian Sport', category: 'sports', url: 'https://www.theguardian.com/sport/rss', homepage: 'https://www.theguardian.com' },
    // Removed after verification (2026-07-18): Sky Sports feed has no
    // publication dates, so items can't be sorted by freshness.

    // ── culture ──────────────────────────────────────────────────────────
    { id: 'variety', name: 'Variety', category: 'culture', url: 'https://variety.com/feed/', homepage: 'https://variety.com' },
    { id: 'thr', name: 'The Hollywood Reporter', category: 'culture', url: 'https://www.hollywoodreporter.com/feed/', homepage: 'https://www.hollywoodreporter.com' },
    { id: 'rollingstone', name: 'Rolling Stone', category: 'culture', url: 'https://www.rollingstone.com/feed/', homepage: 'https://www.rollingstone.com' },
    { id: 'bbc-culture', name: 'BBC Culture', category: 'culture', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'guardian-culture', name: 'Guardian Culture', category: 'culture', url: 'https://www.theguardian.com/culture/rss', homepage: 'https://www.theguardian.com' },

    // ── health ───────────────────────────────────────────────────────────
    { id: 'bbc-health', name: 'BBC Health', category: 'health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'statnews', name: 'STAT News', category: 'health', url: 'https://www.statnews.com/feed/', homepage: 'https://www.statnews.com' },
    { id: 'who', name: 'WHO', category: 'health', url: 'https://www.who.int/rss-feeds/news-english.xml', homepage: 'https://www.who.int' },
  ],
};

// Keyed API sources — each becomes an enabled source only when its env key is
// set. The adapter implementations live in lib/fetchers/apis.js.
export const API_SOURCES = [
  { id: 'gnews', name: 'GNews', envKey: 'GNEWS_API_KEY', homepage: 'https://gnews.io' },
  { id: 'guardian-api', name: 'The Guardian (API)', envKey: 'GUARDIAN_API_KEY', homepage: 'https://www.theguardian.com' },
  { id: 'nyt', name: 'The New York Times', envKey: 'NYT_API_KEY', homepage: 'https://www.nytimes.com' },
  { id: 'newsdata', name: 'NewsData.io', envKey: 'NEWSDATA_API_KEY', homepage: 'https://newsdata.io' },
  { id: 'currents', name: 'Currents', envKey: 'CURRENTS_API_KEY', homepage: 'https://currentsapi.services' },
];

// Additional hosts allowed for /api/article extraction beyond the hosts of
// the sources above (common redirect / CDN targets of keyed API articles).
export const EXTRA_ALLOWED_HOSTS = [
  'www.nytimes.com',
  'apnews.com',
  'www.reuters.com',
  // BBC feeds link articles to bbc.co.uk while the registry only yields
  // bbc.com — allow the whole .bbc.co.uk zone for article extraction.
  'bbc.co.uk',
];
