#!/usr/bin/env node
// Golden parity vectors for the iOS port.
//
// The iOS app re-implements the web client's pure logic in Swift (relative
// time, source hues, country names, the local brief, the extractive summary,
// the forecast sanitizer, the taste engine, prefs sanitizing). This script
// runs the REAL web modules under the same Node shims the web unit tests use
// (test/helpers/client-shims.js) and writes input → output vectors to
// ios/Tests/Fixtures/golden/*.json. The Swift tests replay every vector, so
// a behaviour change on either side fails a test instead of drifting.
//
//   node ios/scripts/export-golden.mjs           write the vectors
//   node ios/scripts/export-golden.mjs --check   regenerate in memory, exit 1 on drift
//
// Everything is deterministic: a fixed clock, fixed inputs, no network.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const OUT_DIR = path.join(ROOT, 'ios', 'Tests', 'Fixtures', 'golden');
const CHECK = process.argv.includes('--check');

const { installClientShims } = await import(pathToFileURL(path.join(ROOT, 'test/helpers/client-shims.js')).href);
installClientShims();

const web = (file, query = '') => import(pathToFileURL(path.join(ROOT, 'public/js', file)).href + query);
const { freshness, relTime, relFuture } = await web('time.js');
const { hashHue } = await web('cards.js');
const { registerSources, countryOf, countryName } = await web('country.js');
const ai = await web('ai.js');
const { applyRating, pickOnboardingCandidates, rankForYou } = await web('recommend.js');
const { stanceOf, contrastRows } = await web('battle-brief.js');
const { STRINGS_EN, LANGUAGES } = await web('i18n.js');
const { RSS_SOURCES, API_SOURCES, CATEGORIES } = await import(pathToFileURL(path.join(ROOT, 'config/sources.js')).href);

// ── shared inputs ────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const iso = (ms) => new Date(ms).toISOString();

// The registry, flattened: id → { name, country, category, language }.
const registry = new Map();
for (const [language, list] of Object.entries(RSS_SOURCES)) {
  for (const s of list) registry.set(s.id, { name: s.name, country: s.country, category: s.category, language });
}
for (const s of API_SOURCES) registry.set(s.id, { name: s.name, country: s.country, category: 'world', language: 'en' });

// Articles built from the web fixture newsroom (test/fixtures/feed.json), the
// same stories the Playwright suite and the iOS fixture server use. Ids follow
// the server's rule shape (12 hex of sha1) so they pass id validation.
const seed = JSON.parse(await readFile(path.join(ROOT, 'test/fixtures/feed.json'), 'utf8'));
const ARTICLES = seed.map((item) => {
  const src = registry.get(item.source) || { name: item.source, country: null, category: 'world', language: 'en' };
  return {
    id: createHash('sha1').update(item.url).digest('hex').slice(0, 12),
    title: item.title,
    description: item.description || '',
    url: item.url,
    image: item.image ?? null,
    source: { id: item.source, name: src.name, country: src.country },
    category: item.category || src.category,
    publishedAt: iso(NOW - item.ageMin * MIN),
    language: src.language,
  };
});
const byAge = [...ARTICLES].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
const english = byAge.filter((a) => a.language === 'en' && a.category !== 'battle');

// Taste profiles are JS objects whose key ORDER matters (caps and ties keep
// the first-inserted entries): serialize them as ordered [key, value] pairs.
const tasteOut = (t) => ({
  count: t.count,
  sources: Object.entries(t.sources),
  cats: Object.entries(t.cats),
  tokens: Object.entries(t.tokens),
  rated: [...t.rated],
});
const freshTaste = () => ({ count: 0, sources: {}, cats: {}, tokens: {}, rated: [] });

// ── time.js ──────────────────────────────────────────────────────────────────

function timeVectors() {
  const pastMinutes = [-120, -30, -1, 0, 0.5, 0.999, 1, 1.5, 59, 59.99, 60, 61, 119, 120, 121, 359, 360, 361,
    719, 1439, 1440, 1441, 2879, 2880, 4320, 10080, 20000];
  const past = pastMinutes.map((m) => {
    const at = iso(NOW - m * MIN);
    return { publishedAt: at, freshness: freshness(at, NOW), relTime: relTime(at, NOW) };
  });
  const futureHours = [-5, 0, 0.5, 1, 1.01, 2, 23.5, 24, 24.01, 47.9, 48, 72, 143.9, 144, 168, 500];
  const future = futureHours.map((h) => {
    const at = iso(NOW + h * HOUR);
    return { dueAt: at, relFuture: relFuture(at, NOW) };
  });
  // Unparseable dates. (V8's lenient legacy parser also reads strings like 'not-a-date-2026' as a
  // date — out of scope: the server only ever sends toISOString() output.)
  const invalid = ['garbage', ''].map((s) => ({
    input: s, freshness: freshness(s, NOW), relTime: relTime(s, NOW), relFuture: relFuture(s, NOW),
  }));
  return { now: iso(NOW), past, future, invalid };
}

// ── cards.js hashHue ─────────────────────────────────────────────────────────

function hueVectors() {
  const ids = [...registry.keys(), ...registry.values()].map((v) => (typeof v === 'string' ? v : v.name));
  const extra = ['', '?', 'a', 'Ромашка', '日本語ニュース', 'émoji 🎉 test', 'x'.repeat(300), 'Zürich Daily'];
  return { cases: [...new Set([...ids, ...extra])].map((input) => ({ input, hue: hashHue(input) })) };
}

// ── country.js ───────────────────────────────────────────────────────────────

function countryVectors() {
  registerSources([...registry].map(([id, s]) => ({ id, country: s.country })));
  const codes = [...new Set([...registry.values()].map((s) => s.country))];
  const names = [...codes, 'XK', '999', '002', '019', '142', '150', '009'].map((code) => ({
    code, name: countryName(code),
  }));
  const of = [
    { source: { id: 'x', country: 'QA' } },
    { source: { id: 'x', country: null } },
    { source: { id: 'bbc-world' } },
    { source: { id: 'gnews' } },
    { source: { id: 'allafrica', country: '002' } },
    { source: { id: 'gone' } },
    { source: { id: 'x', country: 'gb' } },
    { source: { id: 'x', country: 'GBR' } },
    { source: { id: 'x', country: '../x' } },
    { source: { id: 'x', country: 7 } },
  ].map(({ source }) => {
    const out = countryOf(source);
    return { source, result: out === undefined ? { kind: 'unknown' } : out === null ? { kind: 'none' } : { kind: 'code', code: out } };
  });
  return { names, countryOf: of };
}

// ── ai.js ────────────────────────────────────────────────────────────────────

const LONG_TEXT = [
  'The central bank held interest rates on Wednesday, citing cooling inflation and a softer labour market.',
  'Markets had priced in a pause for weeks. Analysts at three large banks now expect a cut in December!',
  'The statement dropped a line about "further tightening", which traders read as a signal.',
  'Mortgage lenders reacted within hours; two cut their fixed rates by a quarter point.',
  'Is the housing market turning? Sales rose for a second month (the first back-to-back rise this year).',
  'The governor will testify before parliament next Tuesday about the decision.',
  'Opposition lawmakers called the pause overdue.',
].join(' ');

function aiVectors() {
  const sentenceInputs = [
    LONG_TEXT,
    'One sentence without end',
    'Quoted end." Next one! And "another?" Last…',
    '  lots   of   space.   Then more.  ',
    'U.S. officials met Mr. Smith at 3 p.m. on Friday. It went well.',
    '',
  ];
  const splitSentences = sentenceInputs.map((text) => ({ text, sentences: ai.splitSentences(text) }));
  const extractive = [
    { max: 5, sentences: ai.splitSentences(LONG_TEXT) },
    { max: 3, sentences: ai.splitSentences(LONG_TEXT) },
    { max: 5, sentences: ['Only one.', 'Two.'] },
    { max: 2, sentences: english.slice(0, 12).map((a) => a.description) },
  ].map(({ max, sentences }) => ({ max, sentences, result: ai.extractive(sentences, max) }));
  const bulletInputs = [
    '- First point\n- Second point\n\n* Third point\n• Fourth',
    'A single paragraph. It has three sentences! Does it split?',
    '1. Numbered stays\n2. As is',
    '',
    Array.from({ length: 10 }, (_, i) => `- point ${i + 1}`).join('\n'),
  ];
  const toBullets = bulletInputs.map((summary) => ({ summary, max: 7, bullets: ai.toBullets(summary, 7) }));
  const titles = [
    ...english.slice(0, 40).map((a) => a.title),
    "Macron's government faces Senate vote on Tuesday",
    'Supreme Court hears Texas case as New York watches',
    'É Ãccented Names and Ümlaut Österreich Talks',
    '日本の首相が訪米',
    "O'Brien and D'Angelo sign with the Wolves",
    'the lowercase start Then Capitals Follow',
  ];
  const entityTokens = titles.map((title) => ({ title, tokens: [...ai.entityTokens(title)] }));
  const forecastability = english.slice(0, 40).map((a) => ({
    title: a.title, description: a.description, score: ai.forecastability(a),
  }));
  const forecastEntities = [
    ...english.slice(0, 20).map((a) => `${a.title} ${a.description}`),
    'Rates rise 2.5% to $33.75M on 12th; 7 of 10 agree — UK’s FTSE 100',
  ].map((text) => ({ text, entities: [...ai.forecastEntities(text)] }));

  // the local brief: grouped by shared entities, freshest story leads
  const briefPool = (list) => list.map((a) => ({ title: a.title, description: a.description, source: a.source.name, publishedAt: a.publishedAt }));
  const briefDigest = [
    english.slice(0, 20),
    english.filter((a) => a.category === 'world').slice(0, 20),
    english.filter((a) => a.category === 'technology'),
    english.slice(0, 3),
    [],
  ].map((list) => ({ articles: briefPool(list), lines: ai.briefDigest(briefPool(list)) }));

  const chunkInputs = [
    { text: LONG_TEXT, maxLen: 1000 },
    { text: LONG_TEXT, maxLen: 200 },
    { text: LONG_TEXT, maxLen: 50 },
    { text: 'x'.repeat(130), maxLen: 50 },
    { text: 'Short.', maxLen: 1000 },
  ];
  const chunkParagraph = chunkInputs.map(({ text, maxLen }) => ({ text, maxLen, chunks: ai.chunkParagraph(text, maxLen) }));

  const pool = english.slice(0, 12).map(({ id, title, description, source, publishedAt }) => ({
    id, title, description, source: source.name, publishedAt,
  }));
  const good = {
    forecasts: [
      { headline: `${pool[0].title.split(' ').slice(0, 3).join(' ')} vote set for Friday after the ruling`, why: 'The story says a decision is due.', timeframe: '48h', confidence: 'medium', basis: [0] },
      { headline: pool[1].title, why: 'An echo of the input must be dropped.', timeframe: '24h', confidence: 'low', basis: [1] },
      { headline: 'Halden Wolves sign a new striker before the opener', why: 'Example leak.', timeframe: '3d', confidence: 'low', basis: [2] },
      { headline: 'Tensions continue as the situation evolves amid pressure', why: 'Cliché.', timeframe: '7d', confidence: 'low', basis: [3] },
      { headline: `${pool[4].title.split(' ').slice(0, 2).join(' ')} announces 12% cut on Monday`, why: 'Figures in the story.', timeframe: '3d', confidence: 'high', basis: [4, 4, 99] },
      { headline: `${pool[5].title.split(' ').slice(0, 2).join(' ')} faces hearing next week`, why: 'Hearing mentioned.', timeframe: 'soon', confidence: 'low', basis: [5] },
    ],
  };
  const sanitizeCases = [
    { name: 'mixed', raw: JSON.stringify(good), strict: true },
    { name: 'fenced', raw: '```json\n' + JSON.stringify(good) + '\n```', strict: true },
    { name: 'bare-array', raw: JSON.stringify(good.forecasts), strict: true },
    { name: 'broken-json', raw: '{"forecasts": [', strict: true },
    { name: 'not-a-list', raw: '{"foo": 1}', strict: true },
    { name: 'all-echoes', raw: JSON.stringify({ forecasts: pool.slice(0, 6).map((a, i) => ({ headline: a.title, why: 'x', timeframe: '24h', confidence: 'low', basis: [i] })) }), strict: true },
    { name: 'one-good', raw: JSON.stringify({ forecasts: [good.forecasts[0]] }), strict: true },
    { name: 'mock-non-strict', raw: JSON.stringify({ forecasts: ai.MOCK_FORECASTS.map((f, i) => ({ ...f, why: 'Mock reasoning', basis: [i] })) }), strict: false },
  ];
  const generatedAt = NOW;
  const sanitizeForecast = sanitizeCases.map(({ name, raw, strict }) => {
    try {
      return { name, raw, strict, result: ai.sanitizeForecast(raw, pool, generatedAt, { strict }) };
    } catch (err) {
      return { name, raw, strict, error: err.code || err.message };
    }
  });

  return {
    stopwords: [...ai.STOPWORDS],
    entityStop: [...ai.ENTITY_STOP],
    regex: Object.fromEntries(
      ['VAGUE_RE', 'FUTURE_CUE_RE', 'EVENT_RE', 'WHEN_RE'].map((k) => [k, { source: ai[k].source, flags: ai[k].flags }])
    ),
    providerLabels: ['on-device', 'local', 'mock', 'libretranslate', 'server'].map((p) => ({ provider: p, label: ai.providerLabel(p) })),
    splitSentences, extractive, toBullets, entityTokens, forecastability, forecastEntities, briefDigest, chunkParagraph,
    forecast: {
      now: iso(NOW),
      pool,
      count: ai.FORECAST_COUNT,
      candidates: ai.FORECAST_CANDIDATES,
      timeframes: ai.FORECAST_TIMEFRAMES,
      maxHeadline: ai.FORECAST_MAX_HEADLINE,
      maxWhy: ai.FORECAST_MAX_WHY,
      minArticles: ai.FORECAST_MIN_ARTICLES,
      outputLangs: [...ai.FORECAST_OUTPUT_LANGS],
      languageNames: ai.LANGUAGE_NAMES,
      systemPrompt: { en: ai.forecastSystemPrompt('en'), de: ai.forecastSystemPrompt('de'), ja: ai.forecastSystemPrompt('ja') },
      exampleUser: ai.FORECAST_EXAMPLE_USER,
      exampleAssistant: ai.FORECAST_EXAMPLE_ASSISTANT,
      exampleEntities: ai.EXAMPLE_ENTITIES,
      schema12: ai.forecastSchema(12),
      userPrompt: ai.forecastUserPrompt(pool, NOW),
      mock: ai.MOCK_FORECASTS,
      sanitize: sanitizeForecast,
    },
  };
}

// ── recommend.js ─────────────────────────────────────────────────────────────

function recommendVectors() {
  const pool = english.slice(0, 60);
  const steps = [[0, 1], [3, -1], [5, 1], [8, 1], [13, -1], [21, 1], [0, 1], [34, -1], [2, 1], [7, 1]];
  const taste = freshTaste();
  const trace = [];
  for (const [i, dir] of steps) {
    applyRating(taste, pool[i], dir);
    trace.push({ articleId: pool[i].id, dir, taste: tasteOut(taste) });
  }
  const saved = new Set([pool[9].id, pool[11].id]);
  const onboarding = [
    { taste: freshTaste(), savedIds: [], max: 40 },
    { taste, savedIds: [...saved], max: 40 },
    { taste, savedIds: [...saved], max: 5 },
  ].map(({ taste: t, savedIds, max }) => ({
    taste: tasteOut(t), savedIds, max,
    ids: pickOnboardingCandidates(pool, t, new Set(savedIds), max).map((a) => a.id),
  }));
  const ranking = [
    { taste: freshTaste(), savedIds: [] },
    { taste, savedIds: [...saved] },
  ].map(({ taste: t, savedIds }) => {
    const { articles, personalized } = rankForYou(pool, t, new Set(savedIds), NOW);
    return { taste: tasteOut(t), savedIds, ids: articles.map((a) => a.id), personalized };
  });
  return { now: iso(NOW), pool, ratings: trace, onboarding, ranking };
}

// ── battle-brief.js ──────────────────────────────────────────────────────────

// Inputs: the battles the fixture server serves (captured by capture-fixtures.mjs) and
// headlines that hit every lexicon form, plus the edges of a non-`u` regex: ASCII word
// boundaries (an accented letter is not a word character), case, apostrophes, suffixes.
const STANCE_TITLES = [
  'Senate slams plan', 'Critic slam', 'Mayor blasts council', 'Blast from rivals', 'Union rips deal', 'Rip into it',
  'Rebels attack convoy', 'Troll attacks', 'Banks fail tests', 'Reform fails', 'Grid failure', 'Many failures',
  'A dangerous game', 'Budget scandal', 'Housing crisis', 'Airport chaos', 'New threat', 'Threats mount',
  'Flood disaster', 'Corrupt officials', 'Corruption trial', 'Big lie', 'Lies and more', 'Report exposes ring',
  'Exposé lands', 'Allies betray', 'Betrayal claims', 'Talks collapse', 'Bridge collapsed', 'Worst week',
  'Experts warn', 'Agency warns', 'Minister accused', 'She accuses him', 'Storm destroyed homes', 'Fear grows',
  'Fears rise', 'Blame game', 'Rival blames aide', 'Late shows mock', 'Crowd mocks', 'Tax fraud',
  'Historical revisionism', 'A problem', 'Launch debacle', 'Market meltdown', 'Senator dodges', 'Desperate move',
  'Court refuses', 'Firm refused', 'Kremlin denies', 'Deny everything',
  'Team wins', 'Big win', 'Party won', 'Crowd supports', 'Support grows', 'Union backs bill', 'Back the plan',
  'Coach defends pick', 'Defend it', 'Critics praise film', 'Praised widely', 'Rate cut boosts shares', 'A boost',
  'Poll leads', 'She leads race', 'Victory lap', 'Success story', 'Fans celebrate', 'Celebrated author',
  'Flexes muscles', 'Flex on rivals', 'Triumphant return', 'Triumph for all', 'Leader vows reform', 'A vow',
  'Crowd cheers', 'Cheer squad', 'Shares surge', 'Sales surged', 'Strong jobs data', 'Stronger dollar',
  'Record high', 'City welcomes team', 'Welcome back', 'Paper endorses', 'Endorsed by union', 'Rally in capital',
  'Stocks rallied',
  'SENATE SLAMS PLAN', 'Slamdance opens', 'A winsome debut', 'Backstage pass', 'Leadership race', 'Problematic',
  'Records tumble', 'He won\'t go', 'Clichéwins the day', 'Naïve backs', 'Senate slams plan as team wins',
  'slams, wins, backs', 'Ex-rival slams—and wins', '', 'Nothing to see here',
];

function battleVectors(captured) {
  const titles = [...captured.flatMap((b) => b.articles.map((a) => a.title)), ...STANCE_TITLES];
  const stance = [
    ...titles.map((title) => ({ titles: [title], ...stanceOf([{ title }]) })),
    ...captured.map((b) => ({ titles: b.articles.map((a) => a.title), ...stanceOf(b.articles) })),
    ...[[0, 6], [6, 12], [52, 58], [40, 60]].map(([from, to]) => {
      const list = STANCE_TITLES.slice(from, to);
      return { titles: list, ...stanceOf(list.map((title) => ({ title }))) };
    }),
  ];
  const rows = captured.map((b) => ({ id: b.id, rows: contrastRows(b) }));
  return { stance, rows };
}

// ── prefs.js sanitize (the module reads storage at import: cache-bust per case)

async function prefsVectors() {
  const inputs = [
    null,
    'not an object',
    {},
    { theme: 'dark', targetLang: 'de', autoTranslate: 1, hiddenSources: ['bbc-world', 7, 'tass'], category: 'world', gridSize: '1.9', forecast: 0, glass: '0.8' },
    { theme: 'neon', gridSize: '9', autoTranslate: 'yes', feedSub: 'weird', hiddenSources: 'nope', uiLocale: 'ru', glass: 'x' },
    { gridSize: -7, glass: -3, forecast: false, feedSub: 'saved', authorId: '0F8FAD5B-D9CB-469F-A165-70867728950E' },
    { authorId: 'not-a-uuid', category: 42, targetLang: null, density: 5 },
    {
      saved: [
        { id: 'a', title: 'ok', url: 'https://x.test/a', image: null },
        { id: 'b', title: 'img', url: 'http://x.test/b', image: 'https://img.test/b.jpg' },
        { id: 'c', title: 'bad url', url: 'javascript:alert(1)' },
        { id: 'd', title: 'bad image', url: 'https://x.test/d', image: 'data:x' },
        { id: 5, title: 'bad id', url: 'https://x.test/e' },
        'string',
        null,
      ],
    },
    {
      taste: {
        count: '4.7',
        sources: { a: 999, b: -3, c: 'x', d: 2, e: -60 },
        cats: { world: 1, sports: -1 },
        tokens: Object.fromEntries(Array.from({ length: 450 }, (_, i) => [`tok${i}`, (i % 7) - 3])),
        rated: ['zzz', '0123456789ab', 'ABCDEF012345', ...Array.from({ length: 310 }, (_, i) => i.toString(16).padStart(12, '0'))],
      },
    },
    { taste: 'corrupt' },
    {
      // oldest first: the newest 500 survive; names are cut at 60 UTF-16 units (an emoji is two)
      blockedAuthors: [
        ...Array.from({ length: 510 }, (_, i) => ({ key: (0x1000 + i).toString(16).padStart(16, 'e'), name: `Commenter ${i}` })),
        { key: 'aaaaaaaaaaaaaaaa', name: 'Amber Falcon' },
        { key: 'aaaaaaaaaaaaaaaa', name: 'Duplicate' },
        { key: 'AAAAAAAAAAAAAAAA', name: 'Upper-case key' },
        { key: 'not-a-key', name: 'x' },
        { key: 'bbbbbbbbbbbbbbbb', name: 'N'.repeat(58) + '😀tail' },
        { key: 'cccccccccccccccc' },
        { key: 'dddddddddddddddd', name: 42 },
        'junk',
        null,
      ],
    },
    { blockedAuthors: 'corrupt' },
  ];
  const cases = [];
  for (const [i, raw] of inputs.entries()) {
    installClientShims({ prefs: raw === null ? undefined : raw });
    const { prefs } = await web('prefs.js', `?golden${i}`);
    const out = JSON.parse(JSON.stringify(prefs));
    out.taste = tasteOut(prefs.taste);
    // key order decides which equal weights survive the caps: give Swift the input in order too
    const t = raw && typeof raw === 'object' ? raw.taste : undefined;
    const pairs = (obj) => (obj && typeof obj === 'object' ? Object.entries(obj) : []);
    const inputTaste = t && typeof t === 'object'
      ? { count: t.count, sources: pairs(t.sources), cats: pairs(t.cats), tokens: pairs(t.tokens), rated: Array.isArray(t.rated) ? t.rated : [] }
      : null;
    cases.push({ input: raw, inputTaste, prefs: out });
  }
  installClientShims();
  return { cases };
}

// ── i18n.js ──────────────────────────────────────────────────────────────────

function stringVectors() {
  return { en: STRINGS_EN, languages: LANGUAGES, categories: CATEGORIES };
}

// ── write / check ────────────────────────────────────────────────────────────

const files = {
  'time.json': timeVectors(),
  'hue.json': hueVectors(),
  'country.json': countryVectors(),
  'ai.json': aiVectors(),
  'recommend.json': recommendVectors(),
  'prefs.json': await prefsVectors(),
  'battle.json': battleVectors(
    JSON.parse(await readFile(path.join(ROOT, 'ios/Tests/Fixtures/api/battles.json'), 'utf8')).body.battles
  ),
  'strings.json': stringVectors(),
};

const serialize = (value) => JSON.stringify(value, null, 1) + '\n';
let drift = 0;
if (!CHECK) await mkdir(OUT_DIR, { recursive: true });
for (const [name, value] of Object.entries(files)) {
  const target = path.join(OUT_DIR, name);
  const next = serialize(value);
  if (CHECK) {
    const current = await readFile(target, 'utf8').catch(() => null);
    if (current !== next) {
      drift += 1;
      console.error(`golden drift: ${path.relative(ROOT, target)} — run node ios/scripts/export-golden.mjs`);
    }
  } else {
    await writeFile(target, next);
    console.log(`wrote ${path.relative(ROOT, target)} (${(next.length / 1024).toFixed(1)} KB)`);
  }
}
if (CHECK && drift) process.exit(1);
if (CHECK) console.log('golden vectors up to date');
