// Meridian app shell: feed, tabs, search, settings, polling, auto-translate.

import { el, clear } from './dom.js';
import { t, catLabel, setLocale, applyI18n } from './i18n.js';
import { prefs, setPref, isSaved, toggleSaved, ensureAuthorId } from './prefs.js';
import { api } from './api.js';
import { initWireClocks, refreshTimes } from './time.js';
import { initPlasma } from './plasma.js';
import { initTimescale } from './timescale.js';
import { animateIn, animatePop, animateRelayout } from './motion.js';
import { toast } from './toast.js';
import { buildCard, skeletonCard, applyCardText, setCardCommentCount, applyCardReactions } from './cards.js';
import { initCardTooltip } from './tooltip.js';
import { openPreview } from './modal.js';
import { summarize, translateTexts, warmTranslator, providerLabel, toBullets } from './ai.js';

const PAGE_SIZE = 30;
const POLL_MS = 30000; // conditional requests are ~200 bytes when quiet
const TIME_REFRESH_MS = 30000;
const CATEGORIES = ['all', 'world', 'business', 'technology', 'science', 'sports', 'culture', 'health', 'saved', 'battle'];

const $ = (sel) => document.querySelector(sel);

const grid = $('#grid');
const emptyBox = $('#empty');
const emptyTitle = $('#emptyTitle');
const emptyHint = $('#emptyHint');
const emptyRetry = $('#emptyRetry');
const sentinel = $('#sentinel');
const newPill = $('#newPill');

const state = {
  category: CATEGORIES.includes(prefs.category) ? prefs.category : 'all',
  q: '',
  page: 1,
  hasMore: false,
  loading: false,
  ids: new Set(),
  articles: [],
  newestAt: null,     // publishedAt of the newest article shown in the feed
  pending: [],        // new stories waiting behind the pill
};

const articleById = new Map();
const translationCache = new Map(); // "id:lang" → { title, description }
// Auto-translate backs off after a failure instead of latching dead: the
// dominant failure is the server rung's 60s rate window, so retry after it.
let translateBroken = false;
let translateRetryTimer = null;

function markTranslateBroken() {
  if (translateBroken) return;
  translateBroken = true;
  toast(t('lang.unavailable'));
  clearTimeout(translateRetryTimer);
  translateRetryTimer = setTimeout(() => {
    translateBroken = false;
    if (prefs.autoTranslate && (prefs.targetLang || 'en') !== 'en') reobserveCards();
  }, 75_000);
}
let plasma = { setHistogram() {}, pulse() {} };  // replaced in boot()
let timescale = { refresh() {}, hide() {} };     // replaced in boot()

/* ── Theme ──────────────────────────────────────────────────────────────── */

function applyTheme() {
  const rootEl = document.documentElement;
  if (prefs.theme === 'light' || prefs.theme === 'dark') {
    rootEl.setAttribute('data-theme', prefs.theme);
  } else {
    rootEl.removeAttribute('data-theme');
  }
}

function effectiveTheme() {
  // solar cosmic is the design default; daylight is an explicit choice
  return prefs.theme === 'light' ? 'light' : 'dark';
}

/* ── Feed query ─────────────────────────────────────────────────────────── */

// Translation targets that have native-language feeds on the server —
// filled from /api/sources; empty until it loads (English-only until then).
let nativeLangs = new Set();

// The hybrid feed: when the chosen translation target has native sources,
// ask for them alongside the English backbone — real articles beat machine
// translation, and English keeps every category populated.
function feedLangs() {
  const target = prefs.targetLang || 'en';
  return target !== 'en' && nativeLangs.has(target) ? target + ',en' : null;
}

function buildParams(extra = {}) {
  const params = { ...extra };
  if (state.category !== 'all' && state.category !== 'saved') params.category = state.category;
  if (state.q) params.q = state.q;
  if (prefs.hiddenSources.length) params.exclude = prefs.hiddenSources.join(',');
  const lang = feedLangs();
  if (lang) params.lang = lang;
  return params;
}

function visibleArticles(list) {
  return list.filter((a) => !prefs.hiddenSources.includes(a.source?.id));
}

/* ── Grid rendering ─────────────────────────────────────────────────────── */

const cardHandlers = {
  onOpen: (article) =>
    openPreview(article, {
      cardFor: (a) => grid.querySelector(`.card[data-id="${CSS.escape(a.id)}"]`),
      // neighbors follow DOM order — it reflects the mosaic, prepends,
      // filters and the saved view, unlike any of the article maps
      getAdjacent: (a, dir) => {
        const cards = [...grid.querySelectorAll('.card[data-id]')];
        const i = cards.findIndex((c) => c.dataset.id === a.id);
        if (i === -1) return null;
        const neighbor = cards[i + dir];
        return neighbor ? articleById.get(neighbor.dataset.id) ?? null : null;
      },
      onCountChange: (a, n) => {
        const known = articleById.get(a.id);
        if (known) known.commentCount = n;
        const card = grid.querySelector(`.card[data-id="${a.id}"]`);
        if (card) setCardCommentCount(card, n);
      },
    }),
  onVote: async (article, value, card) => {
    // one request per article at a time: a double-tap must read the state
    // the FIRST tap produced, or "second tap retracts" inverts
    if (votesInFlight.has(article.id)) return;
    votesInFlight.add(article.id);
    voteEpoch += 1; // any reactions batch now in flight is stale
    const next = article.myVote === value ? 0 : value; // second tap retracts
    const prev = { up: article.up || 0, down: article.down || 0, myVote: article.myVote ?? null };
    // optimistic paint — the press must not wait out a slow round-trip
    const opt = { ...prev, myVote: next === 0 ? null : next };
    if (prev.myVote === 1) opt.up -= 1;
    if (prev.myVote === -1) opt.down -= 1;
    if (next === 1) opt.up += 1;
    if (next === -1) opt.down += 1;
    Object.assign(article, opt);
    applyCardReactions(card, { comments: article.commentCount || 0, ...opt });
    try {
      const res = await api.voteNews(article.id, next, ensureAuthorId());
      Object.assign(article, res); // reconcile with server truth
      applyCardReactions(card, { comments: article.commentCount || 0, ...res });
    } catch (err) {
      Object.assign(article, prev);
      applyCardReactions(card, { comments: article.commentCount || 0, ...prev });
      toast(t(err?.code === 'unknown-article' ? 'card.voteClosed' : 'card.voteFailed'));
    } finally {
      votesInFlight.delete(article.id);
      voteEpoch += 1;
    }
  },
  onToggleSave: (article, btn) => {
    const saved = toggleSaved(article);
    btn.classList.toggle('is-saved', saved);
    const label = saved ? t('card.unsave') : t('card.save');
    btn.setAttribute('aria-label', label);
    btn.title = label;
    if (!saved && state.category === 'saved') {
      const card = btn.closest('.card');
      if (card) {
        viewportObserver.unobserve(card);
        card.remove();
      }
      if (!grid.querySelector('.card:not(.card--skeleton)')) showEmpty('saved');
    }
  },
  onTranslate: (article, card) => {
    if (card.dataset.translated) {
      revertCard(card);
      return;
    }
    const sourceLang = article.language || 'en';
    if ((prefs.targetLang || 'en') === sourceLang) {
      toast(t('lang.pick'));
      return;
    }
    translateBroken = false; // a fresh user gesture may succeed where auto-translate failed
    translateCard(card, prefs.targetLang);
  },
};

function makeCard(article, variant) {
  const card = buildCard(article, { variant, saved: isSaved(article.id), ...cardHandlers });
  viewportObserver.observe(card);
  return card;
}

// Mosaic variant assignment: the card's shape follows its content.
// No image → compact text card (packs tight); every ~7th image card goes
// wide for rhythm; index 0 of a fresh page is the hero.
function variantFor(article, index, withHero) {
  if (withHero && index === 0 && article.image) return 'hero';
  if (!article.image) return 'text';
  if (index % 7 === 3) return 'wide';
  return 'std';
}

function clearGrid() {
  for (const card of grid.querySelectorAll('.card:not(.card--skeleton)')) {
    viewportObserver.unobserve(card);
    card.remove();
  }
  state.ids = new Set();
  state.articles = [];
}

// Pending "new stories" AND the daily brief belong to the view they were
// produced for — drop the buffer and re-summarize whenever the view
// changes (tab, search, source toggle, saved).
function clearPending() {
  state.pending = [];
  newPill.hidden = true;
  scheduleBrief(300); // thinking state shows instantly; the run is debounced
}

function addSkeletons(count) {
  const existing = grid.querySelectorAll('.card--skeleton').length;
  for (let i = existing; i < count; i += 1) grid.append(skeletonCard());
}

function removeSkeletons() {
  for (const skel of grid.querySelectorAll('.card--skeleton')) skel.remove();
}

// Appends articles; when `withHero`, the freshest article that has an image
// is hoisted to the top and rendered as the hero card.
function appendArticles(list, withHero = false) {
  let ordered = list;
  if (withHero) {
    const heroIndex = ordered.findIndex((a) => a.image);
    if (heroIndex > 0) {
      ordered = [...ordered];
      ordered.unshift(ordered.splice(heroIndex, 1)[0]);
    }
  }
  const frag = document.createDocumentFragment();
  const added = [];
  ordered.forEach((article, i) => {
    if (state.ids.has(article.id)) return;
    state.ids.add(article.id);
    state.articles.push(article);
    articleById.set(article.id, article);
    const card = makeCard(article, variantFor(article, i, withHero));
    added.push(card);
    frag.append(card);
  });
  grid.append(frag);
  animateIn(added);
  timescale.refresh();
}

function prependArticles(list) {
  const fresh = list.filter((a) => !state.ids.has(a.id));
  if (!fresh.length) return;
  const frag = document.createDocumentFragment();
  for (const article of fresh) {
    state.ids.add(article.id);
    articleById.set(article.id, article);
    const card = makeCard(article, article.image ? 'std' : 'text');
    card.classList.add('card--fresh');
    card.addEventListener('animationend', () => card.classList.remove('card--fresh'), { once: true });
    frag.append(card);
  }
  state.articles = [...fresh, ...state.articles];
  const cards = [...frag.children];

  // Scroll anchoring: inserting above must not move what the reader is
  // looking at. Anchor on the current first card and compensate exactly.
  const anchor = grid.querySelector('.card:not(.card--skeleton)');
  const anchorTop = anchor ? anchor.getBoundingClientRect().top : null;
  grid.prepend(frag);
  if (anchor && anchorTop !== null && window.scrollY > 80) {
    const delta = anchor.getBoundingClientRect().top - anchorTop;
    if (delta) window.scrollBy({ top: delta, left: 0, behavior: 'instant' });
  }

  animateIn(cards);
  timescale.refresh();
  state.newestAt = fresh[0].publishedAt;
  hideEmpty();
}

/* ── Empty / error states ───────────────────────────────────────────────── */

function showEmpty(kind) {
  const copy = {
    feed: ['feed.empty', 'feed.emptyHint'],
    search: ['feed.emptySearch', 'feed.emptySearchHint'],
    saved: ['feed.emptySaved', 'feed.emptySavedHint'],
    error: ['feed.error', 'feed.errorHint'],
  }[kind] || ['feed.empty', 'feed.emptyHint'];
  emptyTitle.textContent = t(copy[0], { q: state.q });
  emptyHint.textContent = t(copy[1]);
  emptyRetry.hidden = kind !== 'error';
  emptyBox.hidden = false;
}

function hideEmpty() {
  emptyBox.hidden = true;
}

/* ── Feed loading ───────────────────────────────────────────────────────── */

let feedSeq = 0; // stale responses (superseded by a newer reset) are dropped

async function loadFeed({ reset = false } = {}) {
  if (state.category === 'battle') return; // battle view owns the screen
  if (state.category === 'saved') {
    renderSaved();
    return;
  }
  if (!reset && state.loading) return;
  const seq = ++feedSeq;
  state.loading = true;
  hideEmpty();
  if (reset) {
    state.page = 1;
    state.hasMore = false;
    clearGrid();
    addSkeletons(6);
  } else {
    addSkeletons(grid.querySelectorAll('.card--skeleton').length + 3);
  }
  try {
    const res = await api.news(
      buildParams({ page: state.page, pageSize: PAGE_SIZE }),
      prefs.authorId || undefined // lights up my like/dislike state on cards
    );
    if (seq !== feedSeq) return;
    removeSkeletons();
    appendArticles(visibleArticles(res.articles), reset);
    state.hasMore = state.page * (res.pageSize || PAGE_SIZE) < res.total;
    state.page += 1;
    if (reset) {
      // articles are sorted publishedAt DESC by contract
      state.newestAt = res.articles[0]?.publishedAt || null;
    }
    if (!grid.querySelector('.card:not(.card--skeleton)')) {
      showEmpty(state.q ? 'search' : 'feed');
    }
  } catch {
    if (seq !== feedSeq) return;
    removeSkeletons();
    if (reset || !grid.querySelector('.card:not(.card--skeleton)')) showEmpty('error');
    else toast(t('feed.loadMoreError'));
  } finally {
    if (seq === feedSeq) state.loading = false;
  }
  maybeLoadMore();
}

// IntersectionObserver only fires on state CHANGES — if the sentinel is
// still inside the 600px margin after a page lands (short pages, heavy
// dedupe), no event comes and the feed stalls. Re-check explicitly.
function maybeLoadMore() {
  if (!state.hasMore || state.loading) return;
  if (state.category === 'saved' || state.category === 'battle') return;
  if (sentinel.getBoundingClientRect().top < innerHeight + 600) loadFeed();
}

function renderSaved() {
  // Supersede any in-flight feed request so its late response cannot
  // contaminate the Saved view.
  feedSeq += 1;
  state.loading = false;
  clearPending();
  clearGrid();
  removeSkeletons();
  state.hasMore = false;
  const q = state.q.toLowerCase();
  const items = prefs.saved.filter(
    (a) => !q || (a.title + ' ' + (a.description || '')).toLowerCase().includes(q)
  );
  if (!items.length) {
    showEmpty(state.q ? 'search' : 'saved');
    return;
  }
  hideEmpty();
  appendArticles(items, true);
}

/* ── Infinite scroll ────────────────────────────────────────────────────── */

const sentinelObserver = new IntersectionObserver(
  (entries) => {
    if (entries.some((entry) => entry.isIntersecting) && state.hasMore && !state.loading) {
      loadFeed();
    }
  },
  { rootMargin: '600px 0px' }
);
sentinelObserver.observe(sentinel);

/* ── New-stories polling ────────────────────────────────────────────────── */

// Optimized client-side polling: ONE conditional request against the current
// view — `since=<newest visible>` with the active filters. Nothing new means
// a ~200-byte empty response. Runs on a timeout chain (not setInterval),
// sleeps while the tab is hidden and fires immediately on return.
let pollTimer = null;

async function pollNew() {
  if (document.hidden || !navigator.onLine) return;
  if (state.category === 'saved' || state.category === 'battle') return;
  if (!state.newestAt || state.loading) return;
  try {
    const res = await api.news(
      buildParams({ since: state.newestAt, pageSize: 100 }),
      prefs.authorId || undefined
    );
    const known = new Set(state.pending.map((a) => a.id));
    const fresh = visibleArticles(res.articles).filter(
      (a) => !state.ids.has(a.id) && !known.has(a.id)
    );
    if (!fresh.length) return;
    // newest first; merge ahead of anything already buffered
    state.pending = [...fresh, ...state.pending];
    plasma.pulse(); // flare the NOW edge of the timescale
    const n = state.pending.length;
    const label = n === 1 ? t('feed.newStory') : t('feed.newStories', { n });
    newPill.textContent = label + ' — ' + t('feed.load');
    const wasHidden = newPill.hidden;
    newPill.hidden = false;
    if (wasHidden) animatePop(newPill);
  } catch {
    /* polling is best-effort */
  }
}

// Live counters: refresh comment counts and like/dislike tallies on the
// cards already rendered. One batched request per poll tick. Cards near the
// viewport go first so the 150-id cap trims the far tail, not what the
// reader is looking at. voteEpoch discards any batch that raced a vote —
// the response snapshot predates it and would visibly undo the press.
const ARTICLE_ID_CLIENT_RE = /^[0-9a-f]{12}$/; // saved ids come from localStorage
const votesInFlight = new Set();
let voteEpoch = 0;

async function refreshReactions() {
  if (document.hidden || !navigator.onLine) return;
  if (state.category === 'battle') return; // grid is hidden on this view
  const near = [];
  const far = [];
  const margin = innerHeight * 2;
  for (const c of grid.querySelectorAll('.card[data-id]')) {
    if (!ARTICLE_ID_CLIENT_RE.test(c.dataset.id)) continue;
    const r = c.getBoundingClientRect();
    (r.bottom > -margin && r.top < innerHeight + margin ? near : far).push(c);
  }
  const cards = [...near, ...far].slice(0, 150);
  if (!cards.length) return;
  const epoch = voteEpoch;
  try {
    const res = await api.reactions(
      cards.map((c) => c.dataset.id),
      prefs.authorId || undefined
    );
    if (epoch !== voteEpoch) return; // a vote raced this batch — next tick wins
    for (const card of cards) {
      const r = res.reactions[card.dataset.id];
      if (!r) continue;
      const article = articleById.get(card.dataset.id);
      if (article) {
        article.commentCount = r.comments;
        article.up = r.up;
        article.down = r.down;
        article.myVote = r.myVote;
      }
      applyCardReactions(card, r);
    }
  } catch {
    /* live counters are best-effort */
  }
}

function schedulePoll(delay = POLL_MS) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await pollNew();
    await refreshReactions();
    schedulePoll();
  }, delay);
}

// LOAD button: inserts the buffered stories with no scroll jump — anchored
// insertion keeps the viewport still; the fresh-glow marks where they landed.
newPill.addEventListener('click', () => {
  if (state.category !== 'saved') prependArticles(state.pending);
  state.pending = [];
  newPill.hidden = true;
  scheduleBrief(800); // fresh stories just landed — re-summarize them
});

/* ── Card translation (manual + auto) ───────────────────────────────────── */

function applyTranslated(card, lang, cached) {
  applyCardText(card, cached.title, cached.description);
  card.dataset.translated = lang;
  const btn = card.querySelector('.card-actions .icon-btn');
  if (btn) {
    btn.classList.add('is-translated');
    btn.setAttribute('aria-label', t('card.showOriginal'));
    btn.title = t('card.showOriginal');
  }
}

async function translateCard(card, lang) {
  const article = articleById.get(card.dataset.id);
  if (!article || card.dataset.translated === lang) return;
  const sourceLang = article.language || 'en';
  if (lang === sourceLang) return;
  const key = article.id + ':' + lang;
  let cached = translationCache.get(key);
  if (!cached) {
    if (translateBroken) return;
    const result = await translateTexts([article.title, article.description || ''], lang, {
      sourceLang,
    });
    if (!result) {
      markTranslateBroken();
      return;
    }
    cached = { title: result.texts[0], description: result.texts[1] };
    translationCache.set(key, cached);
  }
  applyTranslated(card, lang, cached);
}

// Auto-translate batching: the observer can surface dozens of cards at
// once, and one server request per card burns through the translate rate
// window in seconds (fresh LOAD-ed stories then silently stay English).
// Collect briefly, then translate up to 10 cards (20 texts) per request.
const pendingTranslate = new Map(); // article id → { card, article }
let translateFlushTimer = null;

function queueCardTranslation(card, lang) {
  const article = articleById.get(card.dataset.id);
  if (!article || card.dataset.translated === lang) return;
  if ((article.language || 'en') === lang) return;
  const cached = translationCache.get(article.id + ':' + lang);
  if (cached) {
    applyTranslated(card, lang, cached);
    return;
  }
  pendingTranslate.set(article.id, { card, article });
  clearTimeout(translateFlushTimer);
  translateFlushTimer = setTimeout(() => flushTranslations(lang), 250);
}

async function flushTranslations(lang) {
  if (translateBroken || !pendingTranslate.size) {
    pendingTranslate.clear();
    return;
  }
  const all = [...pendingTranslate.values()];
  const sourceLang = all[0].article.language || 'en';
  const batch = all.filter(({ article }) => (article.language || 'en') === sourceLang).slice(0, 10);
  for (const { article } of batch) pendingTranslate.delete(article.id);
  const texts = batch.flatMap(({ article }) => [article.title, article.description || '']);
  const result = await translateTexts(texts, lang, { sourceLang }).catch(() => null);
  if (!result) {
    pendingTranslate.clear();
    markTranslateBroken();
    return;
  }
  batch.forEach(({ card, article }, i) => {
    const cached = { title: result.texts[i * 2], description: result.texts[i * 2 + 1] };
    translationCache.set(article.id + ':' + lang, cached);
    // the user may have switched languages while the batch was in flight
    if ((prefs.targetLang || 'en') === lang && prefs.autoTranslate) applyTranslated(card, lang, cached);
  });
  if (pendingTranslate.size) flushTranslations(lang); // drain the rest
}

function revertCard(card) {
  const article = articleById.get(card.dataset.id);
  if (!article) return;
  applyCardText(card, article.title, article.description);
  delete card.dataset.translated;
  const btn = card.querySelector('.card-actions .icon-btn');
  if (btn) {
    btn.classList.remove('is-translated');
    btn.setAttribute('aria-label', t('card.translate'));
    btn.title = t('card.translate');
  }
}

// Lazily auto-translate cards as they enter the viewport.
const viewportObserver = new IntersectionObserver(
  (entries) => {
    if (!prefs.autoTranslate || translateBroken) return;
    const lang = prefs.targetLang || 'en';
    if (lang === 'en') return;
    for (const entry of entries) {
      if (entry.isIntersecting && !entry.target.dataset.translated) {
        queueCardTranslation(entry.target, lang);
      }
    }
  },
  { rootMargin: '150px 0px' }
);

// Re-delivers current intersection state so already-visible cards react to a
// settings change immediately.
function reobserveCards() {
  for (const card of grid.querySelectorAll('.card:not(.card--skeleton)')) {
    viewportObserver.unobserve(card);
    viewportObserver.observe(card);
  }
}

function revertAllCards() {
  for (const card of grid.querySelectorAll('.card[data-translated]')) revertCard(card);
}

/* ── Header controls ────────────────────────────────────────────────────── */

function initTheme() {
  applyTheme();
  $('#themeToggle').addEventListener('click', () => {
    setPref('theme', effectiveTheme() === 'dark' ? 'light' : 'dark');
    applyTheme();
  });
}

function initSearch() {
  const wrap = $('#search');
  const input = $('#searchInput');
  const toggle = $('#searchToggle');
  let timer = null;

  toggle.addEventListener('click', () => {
    const open = wrap.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', t(open ? 'search.close' : 'search.open'));
    if (open) input.focus();
    else if (input.value) {
      input.value = '';
      applySearch('');
    }
  });

  const applySearch = (raw) => {
    const q = raw.trim();
    if (q.length === 1) return; // min 2 chars
    const next = q.length >= 2 ? q : '';
    if (next === state.q) return;
    state.q = next;
    clearPending();
    if (state.category === 'saved') renderSaved();
    else loadFeed({ reset: true });
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => applySearch(input.value), 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') toggle.click();
  });
}

function initLangControl() {
  const toggle = $('#langToggle');
  const popover = $('#langPopover');
  const select = $('#langSelect');
  const auto = $('#autoTranslate');

  select.value = prefs.targetLang;
  if (select.value !== prefs.targetLang) {
    select.value = 'en'; // unknown stored value
    setPref('targetLang', 'en'); // and persist the correction
  }
  auto.checked = prefs.autoTranslate;

  const setOpen = (open) => {
    popover.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  };

  toggle.addEventListener('click', () => setOpen(popover.hidden));
  document.addEventListener('click', (e) => {
    if (!popover.hidden && !e.target.closest('#lang')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) {
      setOpen(false);
      toggle.focus();
    }
  });

  select.addEventListener('change', () => {
    setPref('targetLang', select.value);
    translateBroken = false;
    revertAllCards();
    // Picking a language IS asking for translation. Without this only the
    // brief followed the selection (it ignores the auto flag) while cards
    // and the details page stayed original wherever the checkbox was off.
    if (select.value !== 'en' && !prefs.autoTranslate) {
      setPref('autoTranslate', true);
      auto.checked = true;
    }
    translationBust();
    scheduleBrief(400); // the brief follows the target language
    document.dispatchEvent(new CustomEvent('meridian:langchange'));
    // native feeds exist for this target → refetch the hybrid stream
    if (nativeLangs.size && state.category !== 'saved' && state.category !== 'battle') {
      loadFeed({ reset: true });
    }
  });
  auto.addEventListener('change', () => {
    setPref('autoTranslate', auto.checked);
    translateBroken = false;
    if (auto.checked) translationBust();
    else revertAllCards();
    document.dispatchEvent(new CustomEvent('meridian:langchange'));
  });

  function translationBust() {
    if (prefs.autoTranslate && prefs.targetLang !== 'en') {
      // Create/download the on-device translator NOW, while the user's
      // gesture is active — observer callbacks have no user activation.
      warmTranslator('en', prefs.targetLang);
      reobserveCards();
    }
  }
}

/* ── Tabs ───────────────────────────────────────────────────────────────── */

function initTabs() {
  const track = $('#tabs');
  const activate = (cat, { load = true } = {}) => {
    const wasBattle = state.category === 'battle';
    state.category = cat;
    setPref('category', cat);
    if (cat !== 'battle') clearPending();
    for (const tab of track.querySelectorAll('.tab')) {
      const current = tab.dataset.cat === cat;
      if (current) tab.setAttribute('aria-current', 'true');
      else tab.removeAttribute('aria-current');
    }
    if (cat === 'battle') {
      enterBattle();
      return;
    }
    if (wasBattle) leaveBattle();
    if (!load) return;
    if (cat === 'saved') renderSaved();
    else loadFeed({ reset: true });
  };
  track.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab && tab.dataset.cat !== state.category) activate(tab.dataset.cat);
  });
  activate(state.category, { load: false });
}

/* ── Bubble Battle view ─────────────────────────────────────────────────── */

// Lazy like sun3d: a missing vendor or import failure never breaks the app.
let battleView = null;

async function enterBattle() {
  document.body.classList.add('battle-mode');
  $('#battle').hidden = false;
  try {
    if (!battleView) {
      const mod = await import('./battle.js');
      battleView = mod.initBattle({
        section: $('#battle'),
        // once bubbles exist, the SAME right-rail timescale drives off
        // them: ticks, plasma density, scroll cursor and seek — like the
        // main page, just fed by the battle's stories
        onBuilt: () => {
          if (state.category !== 'battle') return;
          timescale.setSource({ items: () => battleView.timelineItems(), monotonic: false });
        },
      });
    }
    if (state.category === 'battle') battleView.enter(); // user may have left already
  } catch {
    const spaceEl = $('#battleSpace');
    if (spaceEl) spaceEl.textContent = t('battle.error');
  }
}

function leaveBattle() {
  battleView?.leave();
  $('#battle').hidden = true;
  document.body.classList.remove('battle-mode');
  timescale.setSource(null); // back to the feed grid
}

/* ── Daily brief (automatic) ────────────────────────────────────────────── */

// The brief runs by itself: on page open, whenever the view changes and
// whenever fresh stories land in the grid. The panel is always visible with
// a fixed height, so summaries stream in without moving the grid below.
let briefSeq = 0;
let briefTimer = null;
let briefDeferred = false; // a run was requested while the tab was hidden

// The "model is thinking" state: sweeping light bars + the orb's orbit
// ring (CSS drives both off .is-thinking). Idempotent.
function briefThinking() {
  const body = $('#briefBody');
  if (!body) return;
  body.closest('.brief-card')?.classList.add('is-thinking');
  const badge = $('#briefBadge');
  if (badge) badge.hidden = true; // the old provider tag has nothing to vouch for
  if (body.querySelector('.brief-think')) return;
  clear(body);
  const think = el('div', { class: 'brief-think', 'aria-hidden': 'true' });
  for (let i = 0; i < 3; i += 1) think.append(el('div', { class: 'brief-think-bar' }));
  body.append(think);
}

function briefSettled() {
  $('#briefBody')?.closest('.brief-card')?.classList.remove('is-thinking');
}

// Thinking appears the moment a run is requested — a category switch must
// respond instantly even though the actual run is debounced.
function scheduleBrief(delay = 800) {
  briefThinking();
  clearTimeout(briefTimer);
  briefTimer = setTimeout(runBrief, delay);
}

async function runBrief() {
  if (state.category === 'battle') return; // brief is hidden on this view
  const body = $('#briefBody');
  const status = $('#briefStatus');
  const badge = $('#briefBadge');
  if (!body) return;
  if (document.hidden) {
    briefDeferred = true; // summarizing costs CPU — wait for the reader
    return;
  }
  briefDeferred = false;
  const seq = ++briefSeq; // supersedes any in-flight run
  status.textContent = t('brief.working');
  badge.hidden = true;
  briefThinking();
  try {
    // summarize exactly what the reader is looking at: the freshest
    // stories of the ACTIVE view (category + search + hidden sources),
    // fetched explicitly rather than trusted to scroll-dependent state
    let pool;
    if (state.category === 'saved') {
      pool = prefs.saved.slice(0, 20);
    } else {
      const res = await api.news(buildParams({ pageSize: 20 }));
      pool = visibleArticles(res.articles);
    }
    if (seq !== briefSeq) return;
    if (!pool.length) {
      briefSettled();
      clear(body);
      status.textContent = '';
      body.append(el('p', { class: 'brief-note', text: t('brief.empty') }));
      return;
    }
    const result = await summarize(
      {
        mode: 'brief',
        topic: state.category === 'all' ? '' : catLabel(state.category),
        articles: pool.slice(0, 20).map((a) => ({
          title: a.title,
          description: a.description || '',
          source: a.source?.name || '',
        })),
        targetLang: prefs.targetLang || 'en',
      },
      {
        // pct === null: download done, model is thinking
        onProgress: (pct) => {
          if (seq !== briefSeq) return;
          status.textContent = pct == null ? t('brief.working') : t('ai.downloading', { pct });
        },
      }
    );
    if (seq !== briefSeq) return;
    let lines = toBullets(result.summary, 7);
    // the on-device summarizer honors targetLang itself; the extractive
    // fallback is English-only, so its bullets go through the translate
    // ladder to actually respect the selected language
    const target = prefs.targetLang || 'en';
    if (target !== 'en' && result.provider === 'local') {
      const tr = await translateTexts(lines, target, { sourceLang: 'en' }).catch(() => null);
      if (seq !== briefSeq) return;
      if (tr && Array.isArray(tr.texts) && tr.texts.length === lines.length) lines = tr.texts;
    }
    briefSettled();
    clear(body);
    status.textContent = '';
    badge.textContent = providerLabel(result.provider);
    badge.hidden = false;
    const list = el('ul', { class: 'bullets' });
    for (const line of lines) list.append(el('li', { text: line }));
    body.append(list);
    animateIn(list.children); // staggered bullet reveal
  } catch {
    if (seq !== briefSeq) return;
    briefSettled();
    clear(body);
    status.textContent = '';
    body.append(el('p', { class: 'brief-note', text: t('brief.error') }));
  }
}

function initBrief() {
  $('#briefRefresh').addEventListener('click', () => scheduleBrief(0));
}

/* ── Card sizing ────────────────────────────────────────────────────────── */

// Five density levels around the standard mosaic; the CSS variable ladder
// keyed off html[data-grid-size] does the actual re-layout (auto-fill).
// The control is an animated slider: the thumb glides between the five
// stops, and every level change FLIPs the visible cards into their new
// spots instead of snapping the mosaic.
const GRID_SIZE_MIN = -2;
const GRID_SIZE_MAX = 2;

function initGridSize() {
  const slider = $('#sizeSlider');
  const clampLevel = (n) => Math.max(GRID_SIZE_MIN, Math.min(GRID_SIZE_MAX, Math.round(n)));
  const pctOf = (level) => ((level - GRID_SIZE_MIN) / (GRID_SIZE_MAX - GRID_SIZE_MIN)) * 100;

  const paint = (level, exactPct = null) => {
    const pct = exactPct ?? pctOf(level);
    slider.style.setProperty('--pos', pct + '%');
    slider.setAttribute('aria-valuenow', String(level - GRID_SIZE_MIN + 1));
    slider.setAttribute('aria-valuetext', `${level - GRID_SIZE_MIN + 1} / 5`);
  };

  const applyLevel = (level) => {
    if (level) document.documentElement.dataset.gridSize = String(level);
    else delete document.documentElement.dataset.gridSize;
  };

  const setLevel = (next, { exactPct = null } = {}) => {
    paint(next, exactPct);
    if (next === prefs.gridSize) return;
    setPref('gridSize', next);
    // FLIP only the cards near the viewport — the far tail just snaps
    const margin = innerHeight * 1.5;
    const cards = [...grid.querySelectorAll('.card')].filter((c) => {
      const r = c.getBoundingClientRect();
      return r.bottom > -margin && r.top < innerHeight + margin;
    });
    animateRelayout(cards, () => applyLevel(next));
    // other views (battle bubbles) scale themselves off this signal
    document.dispatchEvent(new CustomEvent('meridian:gridsize', { detail: { level: next } }));
  };

  const levelFromEvent = (e) => {
    const rect = slider.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return { level: clampLevel(GRID_SIZE_MIN + ratio * (GRID_SIZE_MAX - GRID_SIZE_MIN)), pct: ratio * 100 };
  };

  // drag: the thumb tracks the pointer 1:1 (transition off), the grid
  // re-FLIPs whenever the nearest stop changes, and on release the thumb
  // springs onto its stop
  slider.addEventListener('pointerdown', (e) => {
    slider.setPointerCapture(e.pointerId);
    slider.classList.add('is-dragging');
    const { level, pct } = levelFromEvent(e);
    setLevel(level, { exactPct: pct });
  });
  slider.addEventListener('pointermove', (e) => {
    if (!slider.classList.contains('is-dragging')) return;
    const { level, pct } = levelFromEvent(e);
    setLevel(level, { exactPct: pct });
  });
  const release = () => {
    if (!slider.classList.contains('is-dragging')) return;
    slider.classList.remove('is-dragging');
    paint(prefs.gridSize || 0); // spring onto the snapped stop
  };
  slider.addEventListener('pointerup', release);
  slider.addEventListener('pointercancel', release);

  slider.addEventListener('keydown', (e) => {
    const level = prefs.gridSize || 0;
    let next = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clampLevel(level - 1);
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clampLevel(level + 1);
    else if (e.key === 'Home') next = GRID_SIZE_MIN;
    else if (e.key === 'End') next = GRID_SIZE_MAX;
    if (next === null) return;
    e.preventDefault();
    setLevel(next);
  });

  applyLevel(prefs.gridSize || 0);
  paint(prefs.gridSize || 0);
}

/* ── Settings drawer ────────────────────────────────────────────────────── */

let sourcesData = null;

function initDrawer() {
  const drawer = $('#drawer');
  const scrim = $('#drawerScrim');
  const toggle = $('#settingsToggle');
  const closeBtn = $('#drawerClose');
  let closeTimer = null;

  const open = () => {
    clearTimeout(closeTimer);
    if (!sourcesData) loadSources(); // retry a failed boot-time load
    drawer.hidden = false;
    scrim.hidden = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        drawer.classList.add('open');
        scrim.classList.add('open');
      })
    );
    toggle.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
  };
  const close = () => {
    drawer.classList.remove('open');
    scrim.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    closeTimer = setTimeout(() => {
      drawer.hidden = true;
      scrim.hidden = true;
    }, 300);
    toggle.focus();
  };

  toggle.addEventListener('click', () => (drawer.hidden ? open() : close()));
  closeBtn.addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) close();
  });

  // aria-modal promises a trap: keep Tab inside and the page still behind.
  drawer.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = drawer.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  const uiLocale = $('#uiLocale');
  uiLocale.value = prefs.uiLocale;
  if (uiLocale.value !== prefs.uiLocale) uiLocale.value = 'en';
  uiLocale.addEventListener('change', () => {
    setPref('uiLocale', uiLocale.value);
    setLocale(uiLocale.value);
    applyI18n();
  });
}

function renderSourcesList() {
  const wrap = $('#sourcesList');
  clear(wrap);
  if (!sourcesData) {
    wrap.append(el('p', { class: 'drawer-hint', text: t('settings.sourcesError') }));
    return;
  }
  const groups = [...(sourcesData.categories || [])];
  for (const source of sourcesData.sources) {
    if (source.category && !groups.includes(source.category)) groups.push(source.category);
  }
  for (const category of groups) {
    const members = sourcesData.sources.filter((s) => s.category === category);
    if (!members.length) continue;
    wrap.append(el('h4', { class: 'drawer-cat mono', text: catLabel(category) }));
    for (const source of members) {
      const row = el('label', { class: 'source-row' + (source.enabled ? '' : ' off') });
      const checkbox = el('input', { type: 'checkbox' });
      checkbox.checked = source.enabled && !prefs.hiddenSources.includes(source.id);
      checkbox.disabled = !source.enabled;
      checkbox.addEventListener('change', () => {
        const hidden = new Set(prefs.hiddenSources);
        if (checkbox.checked) hidden.delete(source.id);
        else hidden.add(source.id);
        setPref('hiddenSources', [...hidden]);
        clearPending();
        if (state.category === 'saved') renderSaved();
        else loadFeed({ reset: true });
      });
      row.append(
        checkbox,
        el('span', { class: 'source-name', text: source.name }),
        el('span', {
          class: 'source-tag',
          text: source.enabled ? source.type : t('settings.requiresKey'),
        })
      );
      wrap.append(row);
    }
  }
}

async function loadSources() {
  try {
    sourcesData = await api.sources();
  } catch {
    sourcesData = null;
  }
  nativeLangs = new Set(sourcesData?.languages || []);
  // the saved target may have native feeds — switch the feed to the mix
  if (feedLangs() && state.category !== 'saved' && state.category !== 'battle') {
    loadFeed({ reset: true });
  }
  renderSourcesList();
  const enabled = sourcesData ? sourcesData.sources.filter((s) => s.enabled).length : 0;
  if (enabled) $('#sourceCount').textContent = t('foot.sources', { n: enabled });
}

/* ── Offline banner ─────────────────────────────────────────────────────── */

function initOffline() {
  const banner = $('#offlineBanner');
  const sync = () => {
    banner.hidden = navigator.onLine;
  };
  window.addEventListener('online', () => {
    sync();
    if (state.category !== 'saved' && !state.articles.length) loadFeed({ reset: true });
  });
  window.addEventListener('offline', sync);
  sync();
}

/* ── Boot ───────────────────────────────────────────────────────────────── */

function boot() {
  setLocale(prefs.uiLocale);
  applyI18n();
  initTheme();
  initWireClocks(document.querySelector('.wire'));
  const rail = initPlasma(document.getElementById('plasma'), { vertical: true });
  // the living sun is heavy machinery (three.js) — load it dynamically so
  // a missing vendor file or WebGL failure never breaks the app
  let sun = null;
  if (matchMedia('(min-width: 900px)').matches) {
    import('./sun3d.js')
      .then((m) => {
        sun = m.initSun(document.getElementById('sunScene'));
      })
      .catch(() => {});
  }
  plasma = {
    setHistogram: (h) => rail.setHistogram(h),
    pulse: () => {
      rail.pulse();
      sun?.pulse();
    },
  };
  timescale = initTimescale({
    container: $('#timescale'),
    ticksEl: $('#timescaleTicks'),
    cursorEl: $('#timescaleCursor'),
    labelEl: $('#timescaleLabel'),
    grid,
    articleById,
    plasma,
    // seeking past the loaded range: pull more pages, then retry once
    onSeekBeyond: async (retry) => {
      if (!state.hasMore || state.loading) return;
      await loadFeed();
      retry();
    },
  });
  initGridSize(); // before the first render so the saved size paints first
  initCardTooltip({
    grid,
    articleById,
    // the tooltip mirrors what the card shows: translated when translated
    textFor: (article, card) => {
      const lang = card.dataset.translated;
      return (lang && translationCache.get(article.id + ':' + lang)) || article;
    },
  });
  initSearch();
  initLangControl();
  initTabs();
  initBrief();
  initDrawer();
  initOffline();

  emptyRetry.addEventListener('click', () => loadFeed({ reset: true }));

  if (state.category === 'saved') renderSaved();
  else if (state.category !== 'battle') loadFeed({ reset: true }); // battle boots via activate()

  loadSources();
  schedulePoll();
  // returning to the tab: check for news immediately instead of waiting
  // out the interval (polls are skipped entirely while hidden)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      schedulePoll(1500);
      if (briefDeferred) scheduleBrief(2000); // run the brief we skipped
    }
  });
  setInterval(() => refreshTimes(), TIME_REFRESH_MS);
}

boot();
