// AI facade. Ladder for both capabilities:
//   1. browser built-in AI (Chrome/Edge Summarizer & Translator, on-device)
//   2. server endpoints (POST /api/summarize | /api/translate; 501 → continue)
//   3. local fallback (extractive summary; translation returns null and the
//      caller shows a toast)
// Instances are created only from a user gesture (model download consent),
// reused afterwards, and destroyed on page hide.

import { api } from './api.js';
import { t } from './i18n.js';

let summarizer = null;
let serverSummarizeUnavailable = false; // 501 once → skip the rung for good
let summarizerKey = '';
const translators = new Map(); // "en>de" → Translator instance

// Reject when a promise neither settles nor shows life within `ms`.
function withTimeout(promise, ms, tag) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(tag + ' timed out')), ms)
    ),
  ]);
}

// create() with a stall watchdog: model downloads may legitimately take
// minutes, so we only abort when PROGRESS stops (no downloadprogress event
// and no resolution for stallMs). A hung create() can otherwise freeze the
// UI at "100%" forever.
async function createGuarded(createFn, onProgress, stallMs = 25000) {
  const ctrl = new AbortController();
  let lastLife = Date.now();
  const monitor = (m) => {
    m.addEventListener('downloadprogress', (e) => {
      lastLife = Date.now();
      const ratio = e.total ? e.loaded / e.total : e.loaded;
      if (typeof onProgress === 'function') {
        onProgress(Math.max(0, Math.min(100, Math.round(ratio * 100))));
      }
    });
  };
  const watchdog = setInterval(() => {
    if (Date.now() - lastLife > stallMs) {
      clearInterval(watchdog);
      ctrl.abort(new Error('model download stalled'));
    }
  }, 5000);
  try {
    return await createFn(monitor, ctrl.signal);
  } finally {
    clearInterval(watchdog);
  }
}

/* ── Browser Summarizer ─────────────────────────────────────────────────── */

async function getSummarizer(targetLang, onProgress) {
  if (!('Summarizer' in self)) return null;
  const options = { type: 'key-points', format: 'plain-text', length: 'medium' };
  if (targetLang && targetLang !== 'en') options.outputLanguage = targetLang;
  const key = JSON.stringify(options);
  if (summarizer && summarizerKey === key) return summarizer;
  const availability = await Summarizer.availability(options);
  if (availability === 'unavailable') return null;
  // 'downloadable' / 'downloading' / 'available': create() (from the user's
  // click) attaches to the download; monitor reports progress to the UI.
  if (summarizer) {
    try { summarizer.destroy(); } catch { /* already gone */ }
    summarizer = null;
    summarizerKey = '';
  }
  const instance = await createGuarded(
    (monitor, signal) => Summarizer.create({ ...options, monitor, signal }),
    onProgress
  );
  summarizer = instance;
  summarizerKey = key;
  return instance;
}

/* ── Browser Translator ─────────────────────────────────────────────────── */

async function getTranslator(sourceLang, targetLang, onProgress) {
  if (!('Translator' in self)) return null;
  const key = sourceLang + '>' + targetLang;
  if (translators.has(key)) return translators.get(key);
  const availability = await Translator.availability({
    sourceLanguage: sourceLang,
    targetLanguage: targetLang,
  });
  if (availability === 'unavailable') return null;
  const instance = await createGuarded(
    (monitor, signal) =>
      Translator.create({
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        monitor,
        signal,
      }),
    onProgress
  );
  translators.set(key, instance);
  return instance;
}

// Eagerly create (and, if needed, download) the on-device translator while a
// user gesture is active. Auto-translate later runs inside IntersectionObserver
// callbacks where create() has no user activation and would be denied.
export async function warmTranslator(sourceLang, targetLang, onProgress) {
  try {
    await getTranslator(sourceLang, targetLang, onProgress);
  } catch {
    /* best-effort: the ladder still has the server rung */
  }
}

/* ── Summarize ladder ───────────────────────────────────────────────────── */

// input: { mode:'article', title, text, targetLang }
//      | { mode:'brief', articles:[{title, description, source}], targetLang }
// Returns { summary, provider } — provider: 'on-device' | 'local' | server's.
export async function summarize(input, { onProgress } = {}) {
  const isBrief = input.mode === 'brief';
  const corpus = isBrief
    ? input.articles
        .map((a) => `${a.title} — ${a.description || ''} (${a.source})`)
        .join('\n')
    : input.text || '';
  const topic = isBrief && input.topic ? input.topic + ' ' : '';
  const context = isBrief
    ? `Independent ${topic}news headlines from many sources. Extract the most important stories as 5-7 key points.`
    : `A news article titled: ${input.title || ''}`;

  try {
    const s = await getSummarizer(input.targetLang, onProgress);
    if (s) {
      // model is ready: tell the UI we moved from downloading to working
      if (typeof onProgress === 'function') onProgress(null);
      // cap the corpus — on-device inference over huge inputs takes ages —
      // and never let a hung inference freeze the button: time out and
      // fall down the ladder to the local digest
      const summary = await withTimeout(
        s.summarize(corpus.slice(0, 6000), { context }),
        35000,
        'on-device summarize'
      );
      if (summary && summary.trim()) {
        return { summary: summary.trim(), provider: 'on-device' };
      }
    }
  } catch {
    /* blocked / download stalled / inference timed out — next rung */
  }

  if (!serverSummarizeUnavailable) {
    try {
      const body = isBrief
        ? { mode: 'brief', articles: input.articles.slice(0, 30), targetLang: input.targetLang || 'en' }
        : { mode: 'article', title: input.title || '', text: input.text || '', targetLang: input.targetLang || 'en' };
      const res = await api.summarize(body);
      if (res?.summary) return { summary: res.summary, provider: res.provider || 'server' };
    } catch (err) {
      // 501 premium-only in the free version — expected; remember it so the
      // auto-brief doesn't re-probe (and re-log) on every run
      if (err?.status === 501) serverSummarizeUnavailable = true;
    }
  }

  if (isBrief) {
    return { summary: briefDigest(input.articles).join('\n'), provider: 'local' };
  }
  return { summary: extractive(splitSentences(input.text || ''), 5).join('\n'), provider: 'local' };
}

/* ── Local structured brief ─────────────────────────────────────────────── */

// A narrative digest, not a headline dump: stories are grouped by their
// shared entities (capitalized words/bigrams), each developing story
// becomes one line — the entity, the freshest headline as the lede, and
// how broad the coverage is. Singletons close the brief as "also" items.
export function entityTokens(title) {
  // unicode-aware: Cyrillic, CJK etc. are letters, not separators
  const words = String(title).split(/[^\p{L}\p{N}'']+/u).filter(Boolean);
  const out = new Map(); // lower → display
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    const lower = w.toLowerCase().replace(/['']s$/, '');
    if (lower.length < 3 || STOPWORDS.has(lower)) continue;
    if (!/^\p{Lu}/u.test(w)) continue; // bare numbers don't name a story
    const display = w.replace(/['']s$/, '');
    const next = words[i + 1];
    if (next && /^\p{Lu}/u.test(next)) {
      const nl = next.toLowerCase();
      if (!STOPWORDS.has(nl) && nl.length >= 3) {
        out.set(lower + ' ' + nl, display + ' ' + next.replace(/['']s$/, ''));
      }
    }
    out.set(lower, display);
  }
  return out;
}

function briefDigest(articles) {
  const docs = articles.map((a) => ({ a, toks: entityTokens(a.title) }));
  const byTok = new Map(); // lower → { display, idxs: [] }
  docs.forEach((d, i) => {
    for (const [lower, display] of d.toks) {
      if (!byTok.has(lower)) byTok.set(lower, { display, idxs: [] });
      byTok.get(lower).idxs.push(i);
    }
  });

  const used = new Set();
  const lines = [];
  // greedy: each round takes the entity that explains the most uncovered
  // stories — the brief reads as "what is developing", biggest first
  while (lines.length < 5) {
    let bestTok = null;
    let bestCov = [];
    for (const [lower, { idxs }] of byTok) {
      const cov = idxs.filter((i) => !used.has(i));
      if (
        cov.length > bestCov.length ||
        (cov.length === bestCov.length && bestTok && lower.includes(' ') && !bestTok.includes(' '))
      ) {
        bestTok = lower;
        bestCov = cov;
      }
    }
    if (!bestTok || bestCov.length < 2) break;
    bestCov.forEach((i) => used.add(i));
    const group = bestCov
      .map((i) => docs[i].a)
      .sort((x, y) => (x.publishedAt < y.publishedAt ? 1 : -1));
    const lead = group[0];
    const sources = [...new Set(group.map((x) => x.source).filter(Boolean))];
    const breadth =
      group.length > 1
        ? ` — ${group.length} stories from ${sources.slice(0, 3).join(', ')}`
        : lead.source
          ? ` (${lead.source})`
          : '';
    // skip the entity prefix when the lede already opens with it
    const display = byTok.get(bestTok).display;
    const prefix = lead.title.toLowerCase().startsWith(bestTok.split(' ')[0]) ? '' : display + ': ';
    lines.push(`${prefix}${lead.title}${breadth}`);
  }
  // singletons: the freshest of what's left, briefly
  const rest = docs
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => !used.has(i))
    .slice(0, Math.max(0, 7 - lines.length));
  for (const { d } of rest) {
    lines.push(`Also: ${d.a.title}${d.a.source ? ` (${d.a.source})` : ''}`);
  }
  return lines.length ? lines : articles.slice(0, 5).map((a) => a.title);
}

/* ── Translate ladder ───────────────────────────────────────────────────── */

// Returns { texts, provider } or null when no translator is available —
// the caller then keeps the original text and shows a toast.
export async function translateTexts(texts, targetLang, { sourceLang = 'en', onProgress } = {}) {
  if (!texts.length) return { texts: [], provider: 'none' };
  if (targetLang === sourceLang) return { texts: texts.slice(), provider: 'none' };

  try {
    const tr = await getTranslator(sourceLang, targetLang, onProgress);
    if (tr) {
      if (typeof onProgress === 'function') onProgress(null);
      const out = [];
      for (const text of texts) {
        out.push(text.trim() ? await withTimeout(tr.translate(text), 20000, 'on-device translate') : text);
      }
      return { texts: out, provider: 'on-device' };
    }
  } catch {
    /* next rung */
  }

  try {
    const out = [];
    let provider = 'server';
    for (let i = 0; i < texts.length; i += 20) {
      const batch = texts.slice(i, i + 20).map((s) => s.slice(0, 1000));
      const res = await api.translate(batch, targetLang, sourceLang);
      out.push(...res.translations);
      if (res.provider) provider = res.provider;
    }
    return { texts: out, provider };
  } catch {
    /* 501 no-provider or failure */
  }

  return null;
}

/* ── Local extractive summarizer ────────────────────────────────────────── */

const STOPWORDS = new Set(
  ('a an the and or but nor of in on at to for from by with about as into over after before between ' +
   'is are was were be been being has have had do does did will would can could may might must shall should ' +
   'it its this that these those he she they them him his her their our we you your i me my not no yes ' +
   'than then so if when while what which who whom how where why all any both each more most other some such only').split(' ')
);

function words(text) {
  return text.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

export function splitSentences(text) {
  const matches = (text || '').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+[”"')\]]*\s*|[^.!?]+$/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [];
}

// Frequency-based extraction: score each sentence by the corpus frequency of
// its content words (normalized by length), keep the top N in original order.
export function extractive(sentences, max = 5) {
  const list = sentences.filter((s) => s && s.trim());
  if (list.length <= max) return list;
  const freq = new Map();
  for (const sentence of list) {
    for (const word of words(sentence)) {
      if (word.length > 2 && !STOPWORDS.has(word)) {
        freq.set(word, (freq.get(word) || 0) + 1);
      }
    }
  }
  const scored = list.map((sentence, index) => {
    const ws = words(sentence);
    let score = 0;
    for (const word of ws) score += freq.get(word) || 0;
    return { index, sentence, score: score / Math.sqrt(ws.length || 1) };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.sentence);
}

/* ── Forecast (Chrome Prompt API) ───────────────────────────────────────── */
// "What may happen next": four speculative near-future events extrapolated
// from the stories in view by the browser's built-in language model
// (LanguageModel / Gemini Nano). On-device only — no server rung, no
// third-party API; where the API is missing the feature does not exist.
// The model writes en/es/ja/de/fr natively; for any other target the caller
// asks for English and pushes the result through the translate ladder.

export const FORECAST_OUTPUT_LANGS = new Set(['en', 'es', 'ja', 'de', 'fr']);
export const FORECAST_COUNT = 4;
// the model drafts spares so the least concrete candidates can be dropped
const FORECAST_CANDIDATES = FORECAST_COUNT + 2;
export const FORECAST_TIMEFRAMES = { '24h': 24, '48h': 48, '3d': 72, '7d': 168 };
const FORECAST_MAX_HEADLINE = 110;
const FORECAST_MAX_WHY = 320;
const FORECAST_MIN_ARTICLES = 5;
const FORECAST_PROMPT_MS = 45000;
const LANGUAGE_NAMES = { en: 'English', es: 'Spanish', ja: 'Japanese', de: 'German', fr: 'French' };

// Mock provider for UI work and automated checks on machines without the
// model: ?forecast=mock | ?forecast=mock-download, or localStorage
// 'meridian:forecastMock' = '1' | 'download'. Never on by default.
export function forecastMockMode() {
  try {
    const q = new URLSearchParams(location.search).get('forecast');
    if (q === 'mock') return 'on';
    if (q === 'mock-download') return 'download';
    const ls = localStorage.getItem('meridian:forecastMock');
    if (ls === '1') return 'on';
    if (ls === 'download') return 'download';
  } catch {
    /* storage blocked */
  }
  return null;
}
let mockDownloaded = false;

function forecastSystemPrompt(outLang) {
  const language = LANGUAGE_NAMES[outLang] || 'English';
  return (
    `You are a cautious news analyst writing in ${language}. For each story you are given you predict the NEXT event it points to within 7 days \u2014 never the story itself.\n` +
    'Rules:\n' +
    '- A forecast is a future headline: it names the same people, teams, companies, places or figures as the story it builds on, and states one checkable event with who / what / where (a vote, ruling, hearing, deadline, match result, launch, earnings report, announcement, strike, deal, sentencing, price move, landfall).\n' +
    '- Never copy or paraphrase a headline. If a forecast could be read as a summary of the story, it is wrong.\n' +
    '- No clich\u00e9s: "talks continue", "situation evolves", "tensions escalate", "focus shifts to", "reactions follow", "events planned", "prowess continues", "faces pressure".\n' +
    '- "why": one or two sentences citing the specific fact in the story that points there.\n' +
    `- ${FORECAST_CANDIDATES} forecasts on ${FORECAST_CANDIDATES} different stories, spread across the timeframes "24h", "48h", "3d", "7d".\n` +
    '- "confidence" is "low" unless several stories point the same way; then "medium". Never higher.\n' +
    '- "basis" lists the index numbers of the stories each forecast builds on. Headlines under 100 characters. Output JSON only.' +
    (outLang === 'en' ? '' : ` Write every headline and "why" in ${language}, even though the example below is in English.`)
  );
}

// One worked example (a small model copies the shape it is shown): three
// stories, three NEXT-step forecasts that keep the names and add the event.
const FORECAST_EXAMPLE_USER =
  'Today is Tue, 09 Sep 2026 10:00:00 GMT. Headlines, newest first (index \u00b7 source \u00b7 age \u00b7 title \u2014 description):\n' +
  "0 \u00b7 ESPN \u00b7 3h ago \u00b7 Sources: Bears, Swift agree to $33.75M extension \u2014 The Chicago Bears and RB D'Andre Swift have reached an agreement on a three-year extension.\n" +
  "1 \u00b7 Reuters \u00b7 5h ago \u00b7 Fed expected to hold rates this week as inflation cools \u2014 Markets price a hold at Wednesday's FOMC meeting; the statement language is in focus.\n" +
  '2 \u00b7 BBC \u00b7 1h ago \u00b7 Typhoon Ragasa strengthens as it heads for Taiwan \u2014 Forecasters expect landfall on the east coast late Thursday.\n\n' +
  'Return exactly 3 forecasts as JSON.';
const FORECAST_EXAMPLE_ASSISTANT = JSON.stringify({
  forecasts: [
    { headline: "Swift starts at running back in the Bears' Sunday opener", why: 'The three-year, $33.75M extension signed this week makes him the lead back going into the opener.', timeframe: '48h', confidence: 'medium', basis: [0] },
    { headline: 'Fed holds rates on Wednesday and hints at a December cut', why: "Markets price a hold at this week's FOMC meeting, so the statement's wording is the next move.", timeframe: '3d', confidence: 'medium', basis: [1] },
    { headline: 'Taiwan closes schools and offices on Thursday as Ragasa makes landfall', why: 'Forecasters expect landfall on the east coast late Thursday; closures follow every typhoon warning.', timeframe: '7d', confidence: 'low', basis: [2] },
  ],
});

function forecastSchema(n) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['forecasts'],
    properties: {
      forecasts: {
        type: 'array',
        minItems: FORECAST_CANDIDATES,
        maxItems: FORECAST_CANDIDATES,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['headline', 'why', 'timeframe', 'confidence', 'basis'],
          properties: {
            headline: { type: 'string', maxLength: FORECAST_MAX_HEADLINE },
            why: { type: 'string', maxLength: FORECAST_MAX_WHY },
            timeframe: { type: 'string', enum: Object.keys(FORECAST_TIMEFRAMES) },
            confidence: { type: 'string', enum: ['low', 'medium'] },
            basis: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: { type: 'integer', minimum: 0, maximum: Math.max(0, n - 1) },
            },
          },
        },
      },
    },
  };
}

function forecastUserPrompt(articles, now) {
  const lines = articles.map((a, i) => {
    const age = Math.max(0, Math.round((now - Date.parse(a.publishedAt)) / 3600000));
    const title = String(a.title || '').slice(0, 120);
    const desc = String(a.description || '').slice(0, 160);
    return `${i} · ${a.source || 'unknown'} · ${age}h ago · ${title}${desc ? ' — ' + desc : ''}`;
  });
  return (
    `Today is ${new Date(now).toUTCString()}. Headlines, newest first (index · source · age · title — description):\n` +
    lines.join('\n') +
    `\n\nReturn exactly ${FORECAST_CANDIDATES} forecasts as JSON.`
  );
}

function anySignal(signals) {
  const list = signals.filter(Boolean);
  if (list.length <= 1) return list[0];
  return typeof AbortSignal.any === 'function' ? AbortSignal.any(list) : list[0];
}

// 'unavailable' | 'downloadable' | 'downloading' | 'available' — any
// surprise (no global, API shape drift, probe hanging) counts as unavailable
// so the feature stays invisible rather than half-working.
export async function forecastAvailability() {
  const mock = forecastMockMode();
  if (mock === 'download') return mockDownloaded ? 'available' : 'downloadable';
  if (mock === 'on') return 'available';
  if (typeof LanguageModel === 'undefined') return 'unavailable';
  try {
    const state = await withTimeout(
      LanguageModel.availability({
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }],
      }),
      4000,
      'forecast availability'
    );
    return ['downloadable', 'downloading', 'available'].includes(state) ? state : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

// Session creation costs seconds even when the model is on disk, so the
// gesture warms one up as soon as the pull starts; a run consumes it, an
// abandoned pull releases it after a grace period.
let warmSession = null; // { session, outLang }
let releaseTimer = null;
let activeCtrl = null;  // the in-flight generateForecast, for pagehide

export async function warmForecastSession({ outLang = 'en', onProgress, signal } = {}) {
  clearTimeout(releaseTimer);
  if (warmSession && warmSession.outLang === outLang) return warmSession.session;
  releaseForecastSession();
  const mock = forecastMockMode();
  if (mock) {
    if (mock === 'download' && !mockDownloaded) {
      for (let pct = 0; pct <= 100; pct += 20) {
        if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
        onProgress?.(pct);
        await new Promise((r) => setTimeout(r, 500));
      }
      mockDownloaded = true;
    }
    warmSession = { session: { mock: true, destroy() {} }, outLang };
    return warmSession.session;
  }
  const create = (lang) =>
    createGuarded(
      (monitor, stallSignal) =>
        LanguageModel.create({
          initialPrompts: [
            { role: 'system', content: forecastSystemPrompt(lang) },
            { role: 'user', content: FORECAST_EXAMPLE_USER },
            { role: 'assistant', content: FORECAST_EXAMPLE_ASSISTANT },
          ],
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: [lang] }],
          monitor,
          signal: anySignal([stallSignal, signal]),
        }),
      onProgress
    );
  let session;
  let lang = outLang;
  try {
    session = await create(lang);
  } catch (err) {
    // the model may not speak this language after all: fall back to
    // English, the caller translates. Anything else (NotAllowedError when
    // a download needs a user gesture, aborts) propagates with its name.
    if (err?.name === 'NotSupportedError' && lang !== 'en') {
      lang = 'en';
      session = await create(lang);
    } else {
      throw err;
    }
  }
  warmSession = { session, outLang: lang };
  return session;
}

export function releaseForecastSession(delayMs = 0) {
  clearTimeout(releaseTimer);
  const drop = () => {
    try { warmSession?.session?.destroy(); } catch { /* already gone */ }
    warmSession = null;
  };
  if (delayMs > 0) releaseTimer = setTimeout(drop, delayMs);
  else drop();
}

const MOCK_FORECASTS = [
  { headline: 'Follow-up talks announced after this week’s breakthrough', timeframe: '24h', confidence: 'medium' },
  { headline: 'Regulators schedule a hearing on the disputed decision', timeframe: '48h', confidence: 'low' },
  { headline: 'Rival bid emerges as the deal heads for a shareholder vote', timeframe: '3d', confidence: 'low' },
  { headline: 'Weekend deadline passes without a signed agreement', timeframe: '7d', confidence: 'medium' },
];

// articles: [{ id, title, description, source, publishedAt }] — already
// filtered to what the model may see. Returns { forecasts, lang, provider }.
export async function generateForecast({ articles, outLang = 'en', onProgress, signal } = {}) {
  if (!Array.isArray(articles) || articles.length < FORECAST_MIN_ARTICLES) {
    throw new Error('forecast.tooFew');
  }
  const now = Date.now();
  const ctrl = new AbortController();
  const stop = () => ctrl.abort(signal?.reason);
  signal?.addEventListener('abort', stop, { once: true });
  activeCtrl = ctrl;
  try {
    const session = await warmForecastSession({ outLang, onProgress, signal: ctrl.signal });
    const lang = warmSession?.outLang || outLang;
    onProgress?.(null); // model ready → thinking
    let raw;
    if (session.mock) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 2000);
        ctrl.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      });
      raw = JSON.stringify({
        forecasts: MOCK_FORECASTS.map((f, i) => ({
          ...f,
          why: `Mock reasoning built on "${String(articles[i % articles.length].title).slice(0, 60)}" — the real model explains which signals in the headlines point this way.`,
          basis: [i % articles.length],
        })),
      });
      return { forecasts: sanitizeForecast(raw, articles, now, { strict: false }), lang, provider: 'mock' };
    }
    let pool = articles;
    const window_ = session.contextWindow ?? session.inputQuota;
    const measure = session.measureContextUsage || session.measureInputUsage;
    if (window_ && typeof measure === 'function') {
      // keep a margin for the response; drop the oldest headlines first
      while (pool.length > FORECAST_MIN_ARTICLES) {
        const used = await measure.call(session, forecastUserPrompt(pool, now)).catch(() => 0);
        if (!used || used <= window_ - 700) break;
        pool = pool.slice(0, -3);
      }
    }
    const prompt = forecastUserPrompt(pool, now);
    try {
      raw = await withTimeout(
        session.prompt(prompt, { responseConstraint: forecastSchema(pool.length), signal: ctrl.signal }),
        FORECAST_PROMPT_MS,
        'forecast'
      );
    } catch (err) {
      // a build without structured output: ask for JSON in plain text once
      if (ctrl.signal.aborted || err?.name === 'AbortError' || /timed out/.test(err?.message || '')) throw err;
      raw = await withTimeout(
        session.prompt(prompt + ' Output only the JSON object, no prose.', { signal: ctrl.signal }),
        FORECAST_PROMPT_MS,
        'forecast'
      );
    }
    return { forecasts: sanitizeForecast(raw, pool, now), lang, provider: 'on-device' };
  } finally {
    signal?.removeEventListener('abort', stop);
    if (activeCtrl === ctrl) activeCtrl = null;
    releaseForecastSession(); // one session per run: no context creep
  }
}

// Capitalised words and numbers — the names, places and figures a concrete
// forecast has to carry over from the story it builds on.
const ENTITY_STOP = new Set(('the a an and of in on at to for with by from as is are was were be after before over ' +
  'under into amid vs new his her their this that these those it its he she they we you why how what when').split(' '));
export function forecastEntities(text) {
  const out = new Set();
  for (const raw of String(text).split(/[^\p{L}\p{N}'\u2019.%-]+/u)) {
    const w = raw.replace(/^[\u2019'.-]+|[\u2019'.-]+$/g, '').replace(/['\u2019]s$/, '');
    if (!w) continue;
    // figures: 2+ digits, a decimal, or a percentage ("4.25%", "2026", "33.75M" → "33.75")
    if (/^\d+([.,]\d+)?%?$/.test(w) && (w.replace(/\D/g, '').length >= 2 || w.endsWith('%'))) out.add(w.toLowerCase());
    else if (w.length >= 3 && /^\p{Lu}/u.test(w) && !ENTITY_STOP.has(w.toLowerCase())) out.add(w.toLowerCase());
  }
  return out;
}
// headline clichés a small model reaches for when it has nothing concrete
const VAGUE_RE = /\b(evolv\w*|continu\w*|develop\w*|shap\w* up|remain\w*|focus\w*|attention|momentum|reaction\w*|discussion\w*|speculation|scrutiny|tension\w*|uncertaint\w*|pressure|ongoing|planned|prowess|amaze\w*|showcase\w*|compelling|emerging|impact\w*|prompt\w*|prepare\w*|heighten\w*|increas\w*|strategy|condemnation|escalat\w*|faces|face|sparks|fuels|raises questions|spotlight)\b/gi;
// the concrete nouns of a checkable event, and dates / figures
const EVENT_RE = /\b(vote\w*|hearing|ruling|verdict|sentenc\w*|deadline|launch\w*|report\w*|earnings|deal|agreement|strike\w*|landfall|final\w*|semi-?final\w*|match|game|opener|derby|election\w*|summit|meeting|announce\w*|sign\w*|release\w*|ship\w*|cut\w*|hike\w*|hold\w* rates|ban\w*|approv\w*|reject\w*|fine\w*|indict\w*|charge\w*|arrest\w*|resign\w*|appoint\w*|acquir\w*|buy\w*|sell\w*|ipo|evacuat\w*|close\w*|open\w*|start\w*|play\w*|beat\w*|win\w*|lose\w*|return\w*|test\w*|unveil\w*|publish\w*|ceasefire|sanction\w*|tariff\w*)\b/i;
const WHEN_RE = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow|weekend|\d{1,2}(st|nd|rd|th)?|\d+(\.\d+)?%|\$\d)/i;

// How firmly a forecast stands on its stories: names/figures shared with
// the basis headlines, a point for naming a concrete event and one for a
// date or figure, two off per cliché.
function concreteness(f, basisArticles) {
  const own = forecastEntities(f.headline + ' ' + f.why);
  const basis = new Set();
  for (const a of basisArticles) for (const t of forecastEntities(a.title + ' ' + (a.description || ''))) basis.add(t);
  let shared = 0;
  for (const t of own) if (basis.has(t)) shared += 1;
  const cliches = (f.headline.match(VAGUE_RE) || []).length;
  return shared + (EVENT_RE.test(f.headline) ? 1 : 0) + (WHEN_RE.test(f.headline) ? 1 : 0) - 2 * cliches;
}

// A forecast that is really the story again: most of a basis headline's
// words reappear in it (the model copied the line, dash-description and all).
const contentWords = (s) => new Set(String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2));
function echoes(headline, articles) {
  const h = contentWords(headline);
  return articles.some((a) => {
    const t = contentWords(a.title);
    if (!t.size) return false;
    let n = 0;
    for (const w of t) if (h.has(w)) n += 1;
    return n / t.size >= 0.6;
  });
}

// Never trust the model's JSON: clamp, coerce, map basis indices to real
// article ids, drop echoes of the input headlines and — strict mode — keep
// only the FORECAST_COUNT candidates that actually name what they build on.
export function sanitizeForecast(raw, articles, generatedAt = Date.now(), { strict = true } = {}) {
  let data;
  try {
    const text = String(raw).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim();
    data = JSON.parse(text);
  } catch {
    throw new Error('forecast.error');
  }
  const list = Array.isArray(data?.forecasts) ? data.forecasts : Array.isArray(data) ? data : null;
  if (!list) throw new Error('forecast.error');
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const inputTitles = new Set(articles.map((a) => norm(a.title)));
  const seen = new Set();
  const out = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    // a copied feed line carries " — description": keep the headline part
    const headline = String(item.headline || '').split(' \u2014 ')[0].replace(/\s+/g, ' ').trim().slice(0, FORECAST_MAX_HEADLINE);
    const why = String(item.why || '').replace(/\s+/g, ' ').trim().slice(0, FORECAST_MAX_WHY);
    if (headline.length < 8) continue;
    const key = norm(headline);
    if (inputTitles.has(key) || seen.has(key)) continue;
    if (strict && echoes(headline, articles)) continue; // the story again, not its next step
    const timeframe = FORECAST_TIMEFRAMES[item.timeframe] ? item.timeframe : '7d';
    const hours = FORECAST_TIMEFRAMES[timeframe];
    const confidence = item.confidence === 'medium' ? 'medium' : 'low';
    const basis = [];
    const basisArticles = [];
    for (const idx of Array.isArray(item.basis) ? item.basis : []) {
      const i = Math.trunc(Number(idx));
      const a = Number.isInteger(i) && i >= 0 && i < articles.length ? articles[i] : null;
      if (a && !basis.includes(a.id)) {
        basis.push(a.id);
        basisArticles.push(a);
      }
      if (basis.length === 3) break;
    }
    if (!basis.length) continue;
    const forecast = {
      headline,
      why,
      timeframe,
      hours,
      dueAt: new Date(generatedAt + hours * 3600000).toISOString(),
      confidence,
      basis,
    };
    const score = strict ? concreteness(forecast, basisArticles) : 1;
    if (score < 1) continue; // names nothing from its own story: abstract, out
    seen.add(key);
    out.push({ forecast, score });
  }
  // the most concrete first, then the spare is dropped; shown soonest-first
  out.sort((a, b) => b.score - a.score);
  const kept = out.slice(0, FORECAST_COUNT).map((x) => x.forecast);
  kept.sort((a, b) => a.hours - b.hours);
  // too little left: the model restated or waffled (abstract) — the runner
  // retries once; a genuinely short list is tooFew
  if (kept.length < 2) throw new Error(list.length >= 2 ? 'forecast.abstract' : 'forecast.tooFew');
  return kept;
}

/* ── UI helpers ─────────────────────────────────────────────────────────── */

export function providerLabel(provider) {
  if (provider === 'on-device') return t('ai.onDevice');
  if (provider === 'local') return t('ai.local');
  return String(provider || '').toUpperCase();
}

// Split a summary into display bullets (≤ max), tolerating both key-point
// lists and single-paragraph output.
export function toBullets(summary, max = 7) {
  let lines = summary
    .split(/\n+/)
    .map((line) => line.replace(/^\s*[-*•·]\s*/, '').trim())
    .filter(Boolean);
  if (lines.length === 1) lines = splitSentences(lines[0]);
  return lines.slice(0, max);
}

// Free on-device models when the page is going away.
window.addEventListener('pagehide', () => {
  try { activeCtrl?.abort(new Error('pagehide')); } catch { /* noop */ }
  releaseForecastSession();
  try { summarizer?.destroy(); } catch { /* noop */ }
  summarizer = null;
  summarizerKey = '';
  for (const instance of translators.values()) {
    try { instance.destroy(); } catch { /* noop */ }
  }
  translators.clear();
});
