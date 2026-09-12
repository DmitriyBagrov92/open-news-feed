// AI forecast: pull past the top of the feed and the browser's built-in
// model (Chrome Prompt API, on-device) drafts four clearly-labelled
// POSSIBLE events for the next 7 days from the stories in view. Speculative
// by design and it says so on every card; nothing leaves the device.
//
// Deliberately outside #grid: none of the feed's machinery (clear, prepend
// anchoring, reactions poll, tooltip, prev/next, empty state) may mistake a
// forecast for a story. Forecast cards are `.fcard`, never `.card`; due
// times use time[data-due], never time[data-published] (refreshTimes would
// rewrite them as "JUST NOW" with a breaking-news dot).
//
// Capability is probed once at boot. Where LanguageModel is missing or
// unavailable this module binds nothing and renders nothing.

import { el, clear } from './dom.js';
import { t } from './i18n.js';
import { prefs } from './prefs.js';
import { relFuture, relTime } from './time.js';
import { animateIn, animateReveal } from './motion.js';
import {
  forecastAvailability,
  warmForecastSession,
  releaseForecastSession,
  generateForecast,
  translateTexts,
  providerLabel,
  FORECAST_OUTPUT_LANGS,
  FORECAST_COUNT,
} from './ai.js';

// Gesture feel — tune by hand per device class.
const THRESHOLD = 140;        // px of accumulated pull that fires
const MAX_PULL = 196;
const WHEEL_GAIN = 0.6;
const WHEEL_CAP = 60;         // per wheel event, tames inertial bursts
const TOUCH_GAIN = 0.5;
const DECAY = 0.85;           // per frame once the wheel goes quiet
const WHEEL_QUIET_MS = 90;
const COOLDOWN_MS = 400;      // after fire/close: the same burst must not re-fire
const NUDGE_MS = 700;
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_MAX = 8;
const SESSION_GRACE_MS = 30_000; // keep a warmed session after an abandoned pull
const MIN_ARTICLES = 5;
const MAX_ARTICLES = 30;

const NOOP = Object.freeze({
  supported: false,
  availability: 'unavailable',
  setEnabled() {},
  invalidate() {},
  isEnabled: () => false,
});

// deps: { section, hint, fetchPool(), fallbackPool(), articleById,
//         openArticle(article), timescale, viewKey(), isFeedView(), targetLang() }
export async function initForecast(deps) {
  const {
    section, hint, fetchPool, fallbackPool, articleById, openArticle,
    timescale, viewKey, isFeedView, targetLang,
  } = deps;
  if (!section || !hint) return NOOP;
  const availability = await forecastAvailability();
  if (availability === 'unavailable') return NOOP;

  const gridEl = section.querySelector('#forecastGrid');
  const statusEl = section.querySelector('#forecastStatus');
  const badgeEl = section.querySelector('#forecastBadge');
  const regenBtn = section.querySelector('#forecastRegen');
  const closeBtn = section.querySelector('#forecastClose');
  const hintText = hint.querySelector('.forecast-hint-text');

  let enabled = prefs.forecast !== false;
  let needsDownload = availability !== 'available';
  let phase = 'idle'; // idle | pulling | thinking | shown | error
  let pull = 0;
  let seq = 0;
  let ctrl = null;
  let cooldownUntil = 0;
  let nudgeUntil = 0;
  let lastWheel = 0;
  let raf = 0;
  let touchStartY = null;
  let bound = false;
  const cache = new Map();    // viewKey → { generatedAt, forecasts, lang, provider }
  const poolById = new Map(); // real articles seen in a pool but not in the grid

  const outLangFor = (target) => (FORECAST_OUTPUT_LANGS.has(target) ? target : 'en');

  /* ── hint ─────────────────────────────────────────────────────────────── */

  function syncHint() {
    const show = enabled && isFeedView() && (phase === 'idle' || phase === 'pulling');
    hint.hidden = !show;
    hint.classList.toggle('forecast-hint--download', needsDownload);
    if (!show) return;
    hintText.textContent = needsDownload
      ? t('forecast.enable')
      : pull >= THRESHOLD
        ? t('forecast.hintArmed')
        : t('forecast.hint');
  }

  function renderPull() {
    hint.style.setProperty('--pull', Math.min(1, pull / THRESHOLD).toFixed(3));
    hint.classList.toggle('is-pulling', pull > 4);
    hint.classList.toggle('is-armed', pull >= THRESHOLD);
    syncHint();
  }

  // the model still needs a download (a user gesture): the pull only nods
  function nudge() {
    const now = Date.now();
    if (now < nudgeUntil) return;
    nudgeUntil = now + NUDGE_MS;
    hint.classList.add('is-nudge');
    setTimeout(() => hint.classList.remove('is-nudge'), 600);
  }

  function settlePull() {
    pull = 0;
    phase = 'idle';
    renderPull();
    releaseForecastSession(SESSION_GRACE_MS);
  }

  /* ── gesture ──────────────────────────────────────────────────────────── */

  function canPull() {
    return (
      enabled &&
      isFeedView() &&
      (phase === 'idle' || phase === 'pulling') &&
      window.scrollY < 2 &&
      document.body.style.overflow !== 'hidden' && // modal / drawer open
      Date.now() > cooldownUntil
    );
  }

  // Session creation takes seconds even with the model on disk: start it
  // the moment a pull begins so the reveal is mostly inference.
  function warm() {
    if (needsDownload) return;
    warmForecastSession({ outLang: outLangFor(targetLang()) }).catch((err) => {
      if (err?.name === 'NotAllowedError') {
        needsDownload = true; // a download is pending after all
        syncHint();
      }
    });
  }

  function onWheel(e) {
    if (e.ctrlKey || e.deltaY >= 0 || !canPull()) return;
    if (needsDownload) {
      nudge();
      return;
    }
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const delta = Math.min(WHEEL_CAP, -e.deltaY * unit * WHEEL_GAIN);
    if (phase === 'idle') {
      phase = 'pulling';
      warm();
    }
    pull = Math.min(MAX_PULL, pull + delta);
    lastWheel = performance.now();
    renderPull();
    if (pull >= THRESHOLD) {
      trigger({ activation: false });
      return;
    }
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick(now) {
    raf = 0;
    if (phase !== 'pulling') return;
    if (now - lastWheel > WHEEL_QUIET_MS) pull *= DECAY;
    if (pull < 1) {
      settlePull();
      return;
    }
    renderPull();
    raf = requestAnimationFrame(tick);
  }

  function onTouchStart(e) {
    touchStartY = canPull() && e.touches.length === 1 ? e.touches[0].clientY : null;
  }

  function onTouchMove(e) {
    if (touchStartY == null || e.touches.length !== 1) return;
    const dy = e.touches[0].clientY - touchStartY;
    if (dy <= 0 || window.scrollY > 1) {
      if (phase === 'pulling') settlePull();
      return;
    }
    if (needsDownload) {
      nudge();
      return;
    }
    if (phase === 'idle') {
      phase = 'pulling';
      warm();
    }
    pull = Math.min(MAX_PULL, dy * TOUCH_GAIN);
    renderPull();
  }

  function onTouchEnd() {
    if (touchStartY == null) return;
    touchStartY = null;
    if (phase !== 'pulling') return;
    if (pull >= THRESHOLD) trigger({ activation: true }); // touchend is a user activation
    else settlePull();
  }

  const listeners = [
    ['wheel', onWheel],
    ['touchstart', onTouchStart],
    ['touchmove', onTouchMove],
    ['touchend', onTouchEnd],
    ['touchcancel', onTouchEnd],
  ];

  function bindGesture() {
    if (bound) return;
    bound = true;
    for (const [type, fn] of listeners) window.addEventListener(type, fn, { passive: true });
  }

  function unbindGesture() {
    if (!bound) return;
    bound = false;
    for (const [type, fn] of listeners) window.removeEventListener(type, fn);
    cancelAnimationFrame(raf);
    raf = 0;
  }

  /* ── reveal / run ─────────────────────────────────────────────────────── */

  function validCache() {
    const entry = cache.get(viewKey());
    return entry && Date.now() - entry.generatedAt < CACHE_TTL_MS ? entry : null;
  }

  function remember(key, entry) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  function trigger({ activation = false } = {}) {
    if (!enabled || !isFeedView()) return;
    if (needsDownload && !activation) {
      nudge();
      return;
    }
    const fromKeyboard = activation && document.activeElement === hint;
    pull = 0;
    renderPull();
    cooldownUntil = Date.now() + COOLDOWN_MS;
    const cached = validCache();
    if (cached) {
      const wasHidden = section.hidden;
      renderForecasts(cached, { instant: true });
      if (wasHidden) animateReveal(section);
    } else {
      reveal();
      run({ activation });
    }
    if (fromKeyboard) {
      requestAnimationFrame(() => section.querySelector('.fcard[tabindex]')?.focus());
    }
  }

  // skeletons first — the reader sees the space being made before the
  // model has said a word
  function reveal() {
    const wasHidden = section.hidden;
    section.hidden = false;
    phase = 'thinking';
    section.classList.add('is-thinking');
    gridEl.setAttribute('aria-busy', 'true');
    badgeEl.hidden = true;
    statusEl.textContent = t('forecast.thinking');
    renderSkeletons();
    timescale.setFuture(section);
    if (wasHidden) animateReveal(section);
    syncHint();
  }

  async function run({ force = false, activation = false, retried = false } = {}) {
    const mySeq = ++seq; // supersedes any in-flight run (brief-style guard)
    ctrl?.abort();
    ctrl = new AbortController();
    const { signal } = ctrl;
    const key = viewKey();
    const target = targetLang();
    try {
      let pool;
      try {
        pool = await fetchPool();
      } catch {
        pool = fallbackPool();
      }
      if (mySeq !== seq) return;
      const seen = new Set();
      const articles = [];
      for (const a of pool || []) {
        if (!a || seen.has(a.id) || (a.language || 'en') !== 'en') continue;
        seen.add(a.id);
        if (!articleById.has(a.id)) poolById.set(a.id, a);
        articles.push({
          id: a.id,
          title: a.title,
          description: a.description || '',
          source: a.source?.name || '',
          publishedAt: a.publishedAt,
        });
        if (articles.length === MAX_ARTICLES) break;
      }
      if (articles.length < MIN_ARTICLES) {
        renderNote('forecast.tooFew');
        return;
      }
      const result = await generateForecast({
        articles,
        outLang: outLangFor(target),
        signal,
        onProgress: (pct) => {
          if (mySeq !== seq) return;
          // Chrome reports a 0→100% "download" even for a model already on
          // disk; only a pending download is worth showing as one
          statusEl.textContent =
            pct == null || !needsDownload ? t('forecast.thinking') : t('ai.downloading', { pct });
        },
      });
      if (mySeq !== seq) return;
      needsDownload = false;
      let { forecasts, lang } = result;
      // the model spoke a language the reader did not ask for: translate
      // headline + reasoning through the same ladder the cards use
      if (lang !== target) {
        statusEl.textContent = t('forecast.translating');
        const flat = forecasts.flatMap((f) => [f.headline, f.why]);
        const tr = await translateTexts(flat, target, { sourceLang: lang }).catch(() => null);
        if (mySeq !== seq) return;
        if (tr && Array.isArray(tr.texts) && tr.texts.length === flat.length) {
          forecasts = forecasts.map((f, i) => ({
            ...f,
            headline: tr.texts[i * 2] || f.headline,
            why: tr.texts[i * 2 + 1] || f.why,
          }));
          lang = target;
        }
      }
      const entry = { generatedAt: Date.now(), forecasts, lang, provider: result.provider };
      remember(key, entry);
      renderForecasts(entry);
    } catch (err) {
      if (mySeq !== seq || signal.aborted) return;
      if (err?.name === 'NotAllowedError') {
        needsDownload = true; // create() wanted a user gesture for the download
        renderNote('forecast.needsGesture', { enable: true });
        return;
      }
      if (err?.message === 'forecast.tooFew' && !retried) {
        // the model echoed the news instead of extrapolating — one more try
        run({ force: true, activation, retried: true });
        return;
      }
      renderNote(err?.message === 'forecast.tooFew' ? 'forecast.tooFew' : 'forecast.error', { retry: true });
    }
  }

  /* ── rendering ────────────────────────────────────────────────────────── */

  function settleSection() {
    section.classList.remove('is-thinking');
    gridEl.removeAttribute('aria-busy');
  }

  function renderSkeletons() {
    clear(gridEl);
    for (let i = 0; i < FORECAST_COUNT; i += 1) {
      const card = el('div', { class: 'fcard fcard--skeleton', 'aria-hidden': 'true' });
      const meta = el('div', { class: 'fcard-meta mono' });
      meta.append(el('span', { class: 'fdot' }), el('span', { class: 'skel skel-line skel-line--meta' }));
      const think = el('div', { class: 'fcard-think' });
      for (let j = 0; j < 3; j += 1) think.append(el('div', { class: 'fcard-think-bar' }));
      card.append(meta, think, el('span', { class: 'fcard-thinking mono', text: t('forecast.thinking') }));
      gridEl.append(card);
    }
  }

  function renderForecasts(entry, { instant = false } = {}) {
    phase = 'shown';
    section.hidden = false;
    settleSection();
    clear(gridEl);
    const cards = entry.forecasts.map(buildCard);
    for (const card of cards) {
      if (!instant) card.classList.add('is-new');
      gridEl.append(card);
    }
    const iso = new Date(entry.generatedAt).toISOString();
    clear(statusEl);
    statusEl.append(
      document.createTextNode(t('forecast.generated') + ' · '),
      el('time', { datetime: iso, 'data-published': iso, text: relTime(iso) })
    );
    const target = targetLang();
    badgeEl.textContent =
      providerLabel(entry.provider) + (entry.lang !== target ? ' · ' + String(entry.lang).toUpperCase() : '');
    badgeEl.hidden = false;
    animateIn(cards);
    timescale.setFuture(section);
    syncHint();
  }

  function renderNote(key, { retry = false, enable = false } = {}) {
    phase = 'error';
    section.hidden = false;
    settleSection();
    statusEl.textContent = '';
    badgeEl.hidden = true;
    clear(gridEl);
    const note = el('div', { class: 'forecast-note' });
    note.append(el('p', { text: t(key) }));
    if (enable || retry) {
      const btn = el('button', {
        class: 'btn mono',
        type: 'button',
        text: enable ? t('forecast.enable') : t('feed.retry'),
      });
      btn.addEventListener('click', () => {
        reveal();
        run({ force: true, activation: enable });
      });
      note.append(btn);
    }
    gridEl.append(note);
    timescale.setFuture(section);
    syncHint();
  }

  function buildCard(f) {
    const card = el('article', {
      class: 'fcard',
      tabindex: '0',
      role: 'button',
      'aria-expanded': 'false',
      'aria-label': t('forecast.expand'),
    });
    const meta = el('div', { class: 'fcard-meta mono' });
    meta.append(
      el('span', { class: 'fdot', 'aria-hidden': 'true' }),
      el('span', { class: 'fcard-tag', text: t('forecast.tag') + ' ·' }),
      el('time', { class: 'fcard-when', datetime: f.dueAt, 'data-due': f.dueAt, text: relFuture(f.dueAt) }),
      el('span', {
        class: 'fcard-conf is-' + f.confidence,
        text: f.confidence === 'medium' ? t('forecast.confMedium') : t('forecast.confLow'),
      })
    );
    const foot = el('div', { class: 'fcard-foot' });
    foot.append(el('span', { class: 'badge fcard-badge mono', text: t('forecast.badge') }));
    const basis = el('div', { class: 'fcard-basis' });
    basis.append(el('span', { class: 'fcard-basis-label mono', text: t('forecast.basedOn') }));
    const usedSources = new Set();
    for (const id of f.basis) {
      const article = articleById.get(id) || poolById.get(id);
      if (!article) continue;
      // chips name the outlet; a second story from the same outlet shows
      // its headline instead of a duplicate name
      const source = article.source?.name || '';
      const label = source && !usedSources.has(source) ? source : article.title;
      usedSources.add(source);
      const chip = el('button', {
        class: 'fcard-chip mono',
        type: 'button',
        title: article.title,
        'aria-label': t('forecast.openBasis', { title: article.title }),
        text: label,
      });
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        openArticle(article); // the REAL story, in the regular preview
      });
      basis.append(chip);
    }
    if (basis.children.length > 1) foot.append(basis);
    card.append(
      meta,
      el('h3', { class: 'fcard-title', text: f.headline }),
      el('p', { class: 'fcard-why', text: f.why }),
      foot
    );
    const toggle = () => {
      const open = card.classList.toggle('is-open');
      card.setAttribute('aria-expanded', String(open));
    };
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a')) return;
      toggle();
    });
    card.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
        e.preventDefault();
        toggle();
      }
    });
    return card;
  }

  /* ── lifecycle ────────────────────────────────────────────────────────── */

  function invalidate() {
    ctrl?.abort();
    ctrl = null;
    seq += 1;
    section.hidden = true;
    settleSection();
    pull = 0;
    phase = 'idle';
    renderPull();
    timescale.setFuture(null);
    syncHint();
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    if (enabled) bindGesture();
    else {
      invalidate();
      unbindGesture();
      releaseForecastSession();
    }
    syncHint();
  }

  hint.addEventListener('click', () => trigger({ activation: true }));
  regenBtn?.addEventListener('click', () => {
    reveal();
    run({ force: true, activation: true });
  });
  closeBtn?.addEventListener('click', () => {
    invalidate();
    cooldownUntil = Date.now() + COOLDOWN_MS;
  });
  // a new target language invalidates every cached forecast (and any warmed
  // session, which was created for the old output language)
  document.addEventListener('meridian:langchange', () => {
    cache.clear();
    releaseForecastSession();
    invalidate();
  });

  if (enabled) bindGesture();
  syncHint();

  return {
    supported: true,
    availability,
    setEnabled,
    invalidate,
    isEnabled: () => enabled,
  };
}
