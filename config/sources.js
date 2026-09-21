// Source registry for Meridian.
//
// Sources are grouped by article language so more languages can be added
// later: add a new key to RSS_SOURCES ("de", "fr", …) with its own feed list
// and the backend picks it up via the `lang` query param.
//
// Every RSS source is keyless and works out of the box. API sources are
// enabled only when their env key is present (see .env.example).
//
// `country` is where the outlet is headquartered (ISO 3166-1 alpha-2, plus
// the reserved codes EU and UN) — the feed shows it as a flag next to the
// source so a reader can tell whose voice a story is. `null` means there is
// no single home country (news aggregators, pan-regional services). Every
// code needs its flag in public/flags/: run `npm run vendor:flags` after
// adding one (test/unit/lib/sources.test.js fails until you do).

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
    { id: 'bbc-world', name: 'BBC World', country: 'GB', category: 'world', lean: 'center', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'guardian-world', name: 'The Guardian', country: 'GB', category: 'world', lean: 'left', url: 'https://www.theguardian.com/world/rss', homepage: 'https://www.theguardian.com' },
    { id: 'aljazeera', name: 'Al Jazeera', country: 'QA', category: 'world', lean: 'left', url: 'https://www.aljazeera.com/xml/rss/all.xml', homepage: 'https://www.aljazeera.com' },
    { id: 'npr-world', name: 'NPR World', country: 'US', category: 'world', lean: 'center', url: 'https://feeds.npr.org/1004/rss.xml', homepage: 'https://www.npr.org' },
    { id: 'sky-world', name: 'Sky News', country: 'GB', category: 'world', lean: 'center', url: 'https://feeds.skynews.com/feeds/rss/world.xml', homepage: 'https://news.sky.com' },
    { id: 'dw-world', name: 'Deutsche Welle', country: 'DE', category: 'world', lean: 'center', url: 'https://rss.dw.com/rdf/rss-en-world', homepage: 'https://www.dw.com' },
    { id: 'france24', name: 'France 24', country: 'FR', category: 'world', lean: 'center', url: 'https://www.france24.com/en/rss', homepage: 'https://www.france24.com' },
    { id: 'abc-au', name: 'ABC News (AU)', country: 'AU', category: 'world', url: 'https://www.abc.net.au/news/feed/51120/rss.xml', homepage: 'https://www.abc.net.au' },
    { id: 'euronews', name: 'Euronews', country: 'EU', category: 'world', lean: 'center', url: 'https://www.euronews.com/rss', homepage: 'https://www.euronews.com' },
    // ── world: international perspectives (verified 2026-07-22; RT itself is
    // network-blocked at the CDN level — TASS/Sputnik carry that viewpoint) ──
    { id: 'tass', name: 'TASS', country: 'RU', category: 'world', url: 'https://tass.com/rss/v2.xml', homepage: 'https://tass.com' },
    { id: 'sputnik', name: 'Sputnik Globe', country: 'RU', category: 'world', url: 'https://sputnikglobe.com/export/rss2/archive/index.xml', homepage: 'https://sputnikglobe.com' },
    { id: 'cgtn', name: 'CGTN', country: 'CN', category: 'world', url: 'https://www.cgtn.com/subscribe/rss/section/world.xml', homepage: 'https://www.cgtn.com' },
    { id: 'scmp', name: 'South China Morning Post', country: 'HK', category: 'world', url: 'https://www.scmp.com/rss/91/feed', homepage: 'https://www.scmp.com' },
    { id: 'japantimes', name: 'The Japan Times', country: 'JP', category: 'world', url: 'https://www.japantimes.co.jp/feed/', homepage: 'https://www.japantimes.co.jp' },
    { id: 'straitstimes', name: 'The Straits Times', country: 'SG', category: 'world', url: 'https://www.straitstimes.com/news/world/rss.xml', homepage: 'https://www.straitstimes.com' },
    { id: 'mee', name: 'Middle East Eye', country: 'GB', category: 'world', lean: 'left', url: 'https://www.middleeasteye.net/rss', homepage: 'https://www.middleeasteye.net' },
    { id: 'timesofisrael', name: 'The Times of Israel', country: 'IL', category: 'world', lean: 'center', url: 'https://www.timesofisrael.com/feed/', homepage: 'https://www.timesofisrael.com' },
    { id: 'jpost', name: 'The Jerusalem Post', country: 'IL', category: 'world', lean: 'right', url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx', homepage: 'https://www.jpost.com' },
    { id: 'toi-world', name: 'Times of India World', country: 'IN', category: 'world', url: 'https://timesofindia.indiatimes.com/rssfeeds/296589292.cms', homepage: 'https://timesofindia.indiatimes.com' },
    { id: 'allafrica', name: 'AllAfrica', country: null, category: 'world', url: 'https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf', homepage: 'https://allafrica.com' },
    { id: 'mercopress', name: 'MercoPress', country: 'UY', category: 'world', url: 'https://en.mercopress.com/rss/', homepage: 'https://en.mercopress.com' },
    // Removed after verification (2026-07-18): CNN edition_world.rss is
    // abandoned (last item Sep 2023), CBC webfeed times out consistently.

    // ── business ─────────────────────────────────────────────────────────
    { id: 'bbc-business', name: 'BBC Business', country: 'GB', category: 'business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'guardian-business', name: 'Guardian Business', country: 'GB', category: 'business', url: 'https://www.theguardian.com/uk/business/rss', homepage: 'https://www.theguardian.com' },
    { id: 'cnbc', name: 'CNBC', country: 'US', category: 'business', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html', homepage: 'https://www.cnbc.com' },
    { id: 'yahoo-finance', name: 'Yahoo Finance', country: 'US', category: 'business', url: 'https://finance.yahoo.com/news/rssindex', homepage: 'https://finance.yahoo.com' },
    { id: 'fortune', name: 'Fortune', country: 'US', category: 'business', url: 'https://fortune.com/feed/', homepage: 'https://fortune.com' },
    { id: 'ft', name: 'Financial Times', country: 'GB', category: 'business', url: 'https://www.ft.com/rss/home', homepage: 'https://www.ft.com' },

    // ── technology ───────────────────────────────────────────────────────
    { id: 'verge', name: 'The Verge', country: 'US', category: 'technology', url: 'https://www.theverge.com/rss/index.xml', homepage: 'https://www.theverge.com' },
    { id: 'techcrunch', name: 'TechCrunch', country: 'US', category: 'technology', url: 'https://techcrunch.com/feed/', homepage: 'https://techcrunch.com' },
    { id: 'ars', name: 'Ars Technica', country: 'US', category: 'technology', url: 'https://feeds.arstechnica.com/arstechnica/index', homepage: 'https://arstechnica.com' },
    { id: 'wired', name: 'Wired', country: 'US', category: 'technology', url: 'https://www.wired.com/feed/rss', homepage: 'https://www.wired.com' },
    { id: 'engadget', name: 'Engadget', country: 'US', category: 'technology', url: 'https://www.engadget.com/rss.xml', homepage: 'https://www.engadget.com' },
    { id: 'bbc-tech', name: 'BBC Tech', country: 'GB', category: 'technology', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'hackernews', name: 'Hacker News', country: 'US', category: 'technology', url: 'https://hnrss.org/frontpage', homepage: 'https://news.ycombinator.com' },

    // ── science ──────────────────────────────────────────────────────────
    { id: 'sciencedaily', name: 'ScienceDaily', country: 'US', category: 'science', url: 'https://www.sciencedaily.com/rss/all.xml', homepage: 'https://www.sciencedaily.com' },
    { id: 'nature', name: 'Nature', country: 'GB', category: 'science', url: 'https://www.nature.com/nature.rss', homepage: 'https://www.nature.com' },
    { id: 'nasa', name: 'NASA', country: 'US', category: 'science', url: 'https://www.nasa.gov/feed/', homepage: 'https://www.nasa.gov' },
    { id: 'phys-org', name: 'Phys.org', country: 'IM', category: 'science', url: 'https://phys.org/rss-feed/', homepage: 'https://phys.org' },
    { id: 'bbc-science', name: 'BBC Science', country: 'GB', category: 'science', url: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'newscientist', name: 'New Scientist', country: 'GB', category: 'science', url: 'https://www.newscientist.com/feed/home/', homepage: 'https://www.newscientist.com' },

    // ── sports ───────────────────────────────────────────────────────────
    { id: 'espn', name: 'ESPN', country: 'US', category: 'sports', url: 'https://www.espn.com/espn/rss/news', homepage: 'https://www.espn.com' },
    { id: 'bbc-sport', name: 'BBC Sport', country: 'GB', category: 'sports', url: 'https://feeds.bbci.co.uk/sport/rss.xml', homepage: 'https://www.bbc.com/sport' },
    { id: 'guardian-sport', name: 'Guardian Sport', country: 'GB', category: 'sports', url: 'https://www.theguardian.com/sport/rss', homepage: 'https://www.theguardian.com' },
    // Removed after verification (2026-07-18): Sky Sports feed has no
    // publication dates, so items can't be sorted by freshness.

    // ── culture ──────────────────────────────────────────────────────────
    { id: 'variety', name: 'Variety', country: 'US', category: 'culture', url: 'https://variety.com/feed/', homepage: 'https://variety.com' },
    { id: 'thr', name: 'The Hollywood Reporter', country: 'US', category: 'culture', url: 'https://www.hollywoodreporter.com/feed/', homepage: 'https://www.hollywoodreporter.com' },
    { id: 'rollingstone', name: 'Rolling Stone', country: 'US', category: 'culture', url: 'https://www.rollingstone.com/feed/', homepage: 'https://www.rollingstone.com' },
    { id: 'bbc-culture', name: 'BBC Culture', country: 'GB', category: 'culture', url: 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'guardian-culture', name: 'Guardian Culture', country: 'GB', category: 'culture', url: 'https://www.theguardian.com/culture/rss', homepage: 'https://www.theguardian.com' },

    // ── health ───────────────────────────────────────────────────────────
    { id: 'bbc-health', name: 'BBC Health', country: 'GB', category: 'health', url: 'https://feeds.bbci.co.uk/news/health/rss.xml', homepage: 'https://www.bbc.com' },
    { id: 'statnews', name: 'STAT News', country: 'US', category: 'health', url: 'https://www.statnews.com/feed/', homepage: 'https://www.statnews.com' },
    { id: 'who', name: 'WHO', country: 'UN', category: 'health', url: 'https://www.who.int/rss-feeds/news-english.xml', homepage: 'https://www.who.int' },

    // ── battle (viewpoint spectrum; battleOnly = never in /api/news) ─────
    // Openly partisan outlets feeding the Bubble Battle view. Lean labels
    // follow the AllSides-style consensus. Verified reachable 2026-07-22.
    { id: 'fox-news', name: 'Fox News', country: 'US', category: 'battle', lean: 'right', battleOnly: true, url: 'https://moxie.foxnews.com/google-publisher/latest.xml', homepage: 'https://www.foxnews.com' },
    { id: 'nypost', name: 'New York Post', country: 'US', category: 'battle', lean: 'right', battleOnly: true, url: 'https://nypost.com/feed/', homepage: 'https://nypost.com' },
    { id: 'washtimes', name: 'Washington Times', country: 'US', category: 'battle', lean: 'right', battleOnly: true, url: 'https://www.washingtontimes.com/rss/headlines/news/politics/', homepage: 'https://www.washingtontimes.com' },
    { id: 'dailywire', name: 'The Daily Wire', country: 'US', category: 'battle', lean: 'right', battleOnly: true, url: 'https://www.dailywire.com/feeds/rss.xml', homepage: 'https://www.dailywire.com' },
    { id: 'federalist', name: 'The Federalist', country: 'US', category: 'battle', lean: 'right', battleOnly: true, url: 'https://thefederalist.com/feed/', homepage: 'https://thefederalist.com' },
    { id: 'washexaminer', name: 'Washington Examiner', country: 'US', category: 'battle', lean: 'right', battleOnly: true, url: 'https://www.washingtonexaminer.com/feed', homepage: 'https://www.washingtonexaminer.com' },
    { id: 'thenation', name: 'The Nation', country: 'US', category: 'battle', lean: 'left', battleOnly: true, url: 'https://www.thenation.com/feed/?post_type=article', homepage: 'https://www.thenation.com' },
    { id: 'salon', name: 'Salon', country: 'US', category: 'battle', lean: 'left', battleOnly: true, url: 'https://www.salon.com/feed/', homepage: 'https://www.salon.com' },
    { id: 'motherjones', name: 'Mother Jones', country: 'US', category: 'battle', lean: 'left', battleOnly: true, url: 'https://www.motherjones.com/feed/', homepage: 'https://www.motherjones.com' },
    { id: 'dailykos', name: 'Daily Kos', country: 'US', category: 'battle', lean: 'left', battleOnly: true, url: 'https://www.dailykos.com/blogs/main.rss', homepage: 'https://www.dailykos.com' },
    { id: 'thehill', name: 'The Hill', country: 'US', category: 'battle', lean: 'center', battleOnly: true, url: 'https://thehill.com/feed/', homepage: 'https://thehill.com' },
    { id: 'npr-politics', name: 'NPR Politics', country: 'US', category: 'battle', lean: 'center', battleOnly: true, url: 'https://feeds.npr.org/1014/rss.xml', homepage: 'https://www.npr.org' },
    { id: 'csmonitor', name: 'CS Monitor', country: 'US', category: 'battle', lean: 'center', battleOnly: true, url: 'https://rss.csmonitor.com/feeds/all', homepage: 'https://www.csmonitor.com' },
  ],

  // ── native-language feeds: users who pick these translation targets get
  // the real thing instead of machine translation (verified 2026-07-22) ──
  ru: [
    { id: 'meduza', name: 'Meduza', country: 'LV', category: 'world', url: 'https://meduza.io/rss/all', homepage: 'https://meduza.io' },
    { id: 'bbc-russian', name: 'BBC News Русская служба', country: 'GB', category: 'world', url: 'https://feeds.bbci.co.uk/russian/rss.xml', homepage: 'https://www.bbc.com/russian' },
    { id: 'dw-russian', name: 'DW на русском', country: 'DE', category: 'world', url: 'https://rss.dw.com/xml/rss-ru-all', homepage: 'https://www.dw.com/ru' },
  ],
  uk: [
    { id: 'pravda-ua', name: 'Українська правда', country: 'UA', category: 'world', url: 'https://www.pravda.com.ua/rss/', homepage: 'https://www.pravda.com.ua' },
    { id: 'bbc-ukrainian', name: 'BBC News Україна', country: 'GB', category: 'world', url: 'https://feeds.bbci.co.uk/ukrainian/rss.xml', homepage: 'https://www.bbc.com/ukrainian' },
    { id: 'ukrinform', name: 'Укрінформ', country: 'UA', category: 'world', url: 'https://www.ukrinform.ua/rss/block-lastnews', homepage: 'https://www.ukrinform.ua' },
  ],
  de: [
    { id: 'tagesschau', name: 'Tagesschau', country: 'DE', category: 'world', url: 'https://www.tagesschau.de/xml/rss2/', homepage: 'https://www.tagesschau.de' },
    { id: 'spiegel', name: 'Der Spiegel', country: 'DE', category: 'world', url: 'https://www.spiegel.de/schlagzeilen/tops/index.rss', homepage: 'https://www.spiegel.de' },
    { id: 'zeit', name: 'Die Zeit', country: 'DE', category: 'world', url: 'https://newsfeed.zeit.de/index', homepage: 'https://www.zeit.de' },
  ],
  fr: [
    { id: 'lemonde', name: 'Le Monde', country: 'FR', category: 'world', url: 'https://www.lemonde.fr/rss/une.xml', homepage: 'https://www.lemonde.fr' },
    { id: 'franceinfo', name: 'France Info', country: 'FR', category: 'world', url: 'https://www.francetvinfo.fr/titres.rss', homepage: 'https://www.francetvinfo.fr' },
    { id: 'lefigaro', name: 'Le Figaro', country: 'FR', category: 'world', url: 'https://www.lefigaro.fr/rss/figaro_actualites.xml', homepage: 'https://www.lefigaro.fr' },
  ],
  es: [
    { id: 'elpais', name: 'El País', country: 'ES', category: 'world', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada', homepage: 'https://elpais.com' },
    { id: 'bbc-mundo', name: 'BBC Mundo', country: 'GB', category: 'world', url: 'https://feeds.bbci.co.uk/mundo/rss.xml', homepage: 'https://www.bbc.com/mundo' },
    { id: 'veinteminutos', name: '20minutos', country: 'ES', category: 'world', url: 'https://www.20minutos.es/rss/', homepage: 'https://www.20minutos.es' },
  ],
  ja: [
    { id: 'nhk', name: 'NHKニュース', country: 'JP', category: 'world', url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', homepage: 'https://www3.nhk.or.jp' },
    { id: 'asahi', name: '朝日新聞', country: 'JP', category: 'world', url: 'https://www.asahi.com/rss/asahi/newsheadlines.rdf', homepage: 'https://www.asahi.com' },
  ],
  zh: [
    { id: 'bbc-zhongwen', name: 'BBC中文', country: 'GB', category: 'world', url: 'https://feeds.bbci.co.uk/zhongwen/simp/rss.xml', homepage: 'https://www.bbc.com/zhongwen/simp' },
    { id: 'dw-chinese', name: 'DW中文', country: 'DE', category: 'world', url: 'https://rss.dw.com/xml/rss-chi-all', homepage: 'https://www.dw.com/zh' },
  ],
};

// Keyed API sources — each becomes an enabled source only when its env key is
// set. The adapter implementations live in lib/fetchers/apis.js.
export const API_SOURCES = [
  { id: 'gnews', name: 'GNews', country: null, envKey: 'GNEWS_API_KEY', homepage: 'https://gnews.io' },
  { id: 'guardian-api', name: 'The Guardian (API)', country: 'GB', envKey: 'GUARDIAN_API_KEY', homepage: 'https://www.theguardian.com' },
  { id: 'nyt', name: 'The New York Times', country: 'US', envKey: 'NYT_API_KEY', homepage: 'https://www.nytimes.com' },
  { id: 'newsdata', name: 'NewsData.io', country: null, envKey: 'NEWSDATA_API_KEY', homepage: 'https://newsdata.io' },
  { id: 'currents', name: 'Currents', country: null, envKey: 'CURRENTS_API_KEY', homepage: 'https://currentsapi.services' },
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
