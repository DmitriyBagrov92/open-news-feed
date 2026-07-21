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

  const sentences = isBrief
    ? input.articles.map((a) => (a.source ? `${a.title} (${a.source})` : a.title))
    : splitSentences(input.text || '');
  return { summary: extractive(sentences, isBrief ? 7 : 5).join('\n'), provider: 'local' };
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
  try { summarizer?.destroy(); } catch { /* noop */ }
  summarizer = null;
  summarizerKey = '';
  for (const instance of translators.values()) {
    try { instance.destroy(); } catch { /* noop */ }
  }
  translators.clear();
});
