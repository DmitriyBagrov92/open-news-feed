// Time as a control. On wide screens the rail is a glass scrubber at the
// right edge: it maps the loaded feed's time range (NOW at the top), shows
// where stories cluster (a density gradient), mirrors the scroll position
// with a cursor and seeks the feed when clicked or dragged. On phones the
// same model drives a floating time chip that appears while scrolling and
// can be dragged to seek.

import { relTime } from './time.js';
import { t } from './i18n.js';

// Band reserved ABOVE NOW while the AI forecast section is on screen: the
// feed range keeps the rest of the rail, the future gets a hatched ghost.
const FUTURE_H = 40;
const CHIP_IDLE_MS = 1400;

function fmtClock(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

// where "in view" starts: just under the floating cluster (chrome.js
// writes --sticky-top); 150 when nothing has measured yet
function headerOffset() {
  const raw = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sticky-top'));
  return Number.isFinite(raw) && raw > 0 ? raw + 12 : 150;
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function initTimescale({
  container, densityEl, ticksEl, cursorEl, labelEl, chipEl, chipTextEl, grid, articleById, onSeekBeyond,
}) {
  if (!container) return { refresh() {}, hide() {}, setSource() {}, setFuture() {}, pulse() {} };

  let newestT = 0;
  let oldestT = 0;
  let dragging = false;
  let futureFor = null; // the forecast section, while it is shown
  const futureEl = container.querySelector('.timescale-future');

  function articleTime(card) {
    const article = articleById.get(card?.dataset.id);
    return article ? Date.parse(article.publishedAt) : NaN;
  }

  // frac 0 (NOW) … 1 (oldest) → a `top` inside the feed part of the rail,
  // which starts below the future band when one is shown
  function railTop(frac) {
    const f = Math.max(0, Math.min(1, frac));
    return `calc(var(--future-h, 0px) * ${(1 - f).toFixed(4)} + ${(f * 100).toFixed(3)}%)`;
  }

  // The rail works off a source of { t, el } points in top-to-bottom page
  // order. The default source is the feed grid; other views (Bubble
  // Battle) plug their own via setSource(...).
  const gridSource = {
    items() {
      const out = [];
      for (const card of grid.querySelectorAll('.card:not(.card--skeleton)')) {
        const time = articleTime(card);
        if (!Number.isNaN(time)) out.push({ t: time, el: card });
      }
      return out;
    },
    monotonic: true, // DOM order == time order in the feed
  };
  let source = gridSource;

  function setSource(next) {
    source = next || gridSource;
    refresh();
  }

  // ── density: where the stories cluster along the range ──────────────────

  function setDensity(buckets) {
    if (!densityEl) return;
    const max = Math.max(1, ...buckets);
    const stops = [];
    const n = buckets.length;
    // bucket n-1 is NOW (top of the rail) — one stop per bucket centre, so
    // the browser blends them into a single band instead of hard blocks
    for (let i = n - 1; i >= 0; i -= 1) {
      const a = Math.round((0.05 + (buckets[i] / max) * 0.45) * 100);
      const pos = (((n - 1 - i + 0.5) / n) * 100).toFixed(1);
      stops.push(`color-mix(in srgb, var(--label) ${a}%, transparent) ${pos}%`);
    }
    densityEl.style.background = `linear-gradient(180deg, ${stops.join(', ')})`;
  }

  // ── range / ticks ────────────────────────────────────────────────────────

  function refresh() {
    const items = source.items();
    if (items.length < 3) {
      container.classList.add('is-empty');
      return;
    }
    container.classList.remove('is-empty');

    let newest = -Infinity;
    let oldest = Infinity;
    const times = [];
    for (const { t: time } of items) {
      times.push(time);
      if (time > newest) newest = time;
      if (time < oldest) oldest = time;
    }
    if (!times.length || newest === oldest) return;
    newestT = newest;
    oldestT = oldest;

    const buckets = new Array(24).fill(0);
    for (const time of times) {
      const pos = (time - oldest) / (newest - oldest);
      buckets[Math.min(23, Math.floor(pos * 24))] += 1;
    }
    setDensity(buckets);

    // ticks: quarter marks with the actual story time at that depth
    ticksEl.textContent = '';
    for (const frac of [0.25, 0.5, 0.75]) {
      const time = newest - (newest - oldest) * frac;
      const tick = document.createElement('span');
      tick.className = 'timescale-tick mono';
      tick.style.top = railTop(frac);
      tick.textContent = relTime(new Date(time).toISOString());
      ticksEl.append(tick);
    }
    syncCursor();
  }

  // ── scroll → cursor + chip ───────────────────────────────────────────────

  function topVisibleItem() {
    const offset = headerOffset();
    for (const item of source.items()) {
      if (item.el.getBoundingClientRect().bottom > offset) return item;
    }
    return null;
  }

  function labelFor(frac, iso) {
    return frac <= 0.005 ? 'NOW' : relTime(iso) + ' · ' + fmtClock(iso);
  }

  function placeCursor(frac, iso) {
    const f = Math.max(0, Math.min(1, frac));
    cursorEl.style.top = railTop(f);
    // near the rail's top the centered label would collide with the
    // cluster — hang it below the cursor line instead
    cursorEl.classList.toggle('is-top', f < 0.09);
    const label = labelFor(frac, iso);
    labelEl.textContent = label;
    if (chipTextEl) chipTextEl.textContent = label;
  }

  // the reader is looking at the forecast: park the cursor in the future band
  function parkFuture() {
    cursorEl.style.top = FUTURE_H / 2 + 'px';
    cursorEl.classList.add('is-top');
    labelEl.textContent = t('forecast.railLabel');
    if (chipTextEl) chipTextEl.textContent = t('forecast.railLabel');
  }

  function syncCursor() {
    if (dragging || newestT === oldestT) return;
    if (futureFor && !futureFor.hidden && futureFor.getBoundingClientRect().bottom > headerOffset()) {
      parkFuture();
      return;
    }
    const item = topVisibleItem();
    if (!item) return;
    placeCursor((newestT - item.t) / (newestT - oldestT), new Date(item.t).toISOString());
  }

  // the phone chip shows while the page moves and fades after a pause
  let chipTimer = null;
  function showChip() {
    if (!chipEl || container.classList.contains('is-empty')) return;
    chipEl.classList.add('is-on');
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => {
      if (!dragging) chipEl.classList.remove('is-on');
    }, CHIP_IDLE_MS);
  }

  let raf = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncCursor();
        if (window.scrollY > 200) showChip();
      });
    },
    { passive: true }
  );
  window.addEventListener('resize', () => refresh());

  // ── scrub → scroll ───────────────────────────────────────────────────────

  function fracFromEvent(e, box) {
    const rect = box.getBoundingClientRect();
    const fh = futureFor ? FUTURE_H : 0;
    return Math.max(0, Math.min(1, (e.clientY - rect.top - fh) / Math.max(1, rect.height - fh)));
  }

  function seek(frac) {
    if (newestT === oldestT) return;
    const target = newestT - frac * (newestT - oldestT);
    let dest = null;
    if (source.monotonic) {
      for (const item of source.items()) {
        if (item.t <= target) {
          dest = item.el;
          break;
        }
      }
    } else {
      // non-monotonic sources (battle clusters are ranked, not time-
      // sorted): jump to the story closest in time to the chosen moment
      let best = Infinity;
      for (const item of source.items()) {
        const d = Math.abs(item.t - target);
        if (d < best) {
          best = d;
          dest = item.el;
        }
      }
    }
    if (!dest) {
      // older than anything loaded: let the app fetch more, then retry
      onSeekBeyond?.(() => seek(frac));
      return;
    }
    const y = dest.getBoundingClientRect().top + window.scrollY - headerOffset() + 10;
    window.scrollTo({ top: y, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  function wireScrub(box, { onDrag } = {}) {
    box.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.timescale-future')) return; // the ghost is a plain button
      dragging = true;
      box.setPointerCapture(e.pointerId);
      const frac = fracFromEvent(e, box);
      const time = newestT - frac * (newestT - oldestT);
      placeCursor(frac, new Date(time).toISOString());
      onDrag?.();
    });
    box.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const frac = fracFromEvent(e, box);
      const time = newestT - frac * (newestT - oldestT);
      placeCursor(frac, new Date(time).toISOString());
      onDrag?.();
    });
    box.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      seek(fracFromEvent(e, box));
      onDrag?.();
    });
    box.addEventListener('pointercancel', () => {
      dragging = false;
      syncCursor();
    });
  }
  wireScrub(container);
  // the chip scrubs against the viewport: drag it up = newer, down = older
  if (chipEl) {
    const viewportBox = { getBoundingClientRect: () => ({ top: headerOffset(), height: innerHeight - headerOffset() - 60 }) };
    chipEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      chipEl.setPointerCapture(e.pointerId);
      showChip();
    });
    chipEl.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const frac = fracFromEvent(e, viewportBox);
      const time = newestT - frac * (newestT - oldestT);
      placeCursor(frac, new Date(time).toISOString());
      chipEl.style.top = Math.max(120, Math.min(innerHeight - 100, e.clientY)) + 'px';
      showChip();
    });
    const release = (e) => {
      if (!dragging) return;
      dragging = false;
      chipEl.style.top = '';
      seek(fracFromEvent(e, viewportBox));
      showChip();
    };
    chipEl.addEventListener('pointerup', release);
    chipEl.addEventListener('pointercancel', () => {
      dragging = false;
      chipEl.style.top = '';
      syncCursor();
    });
  }

  // The forecast section is on screen: reserve the future band above NOW.
  // Pass null when it goes away.
  function setFuture(node) {
    futureFor = node || null;
    container.classList.toggle('has-future', Boolean(futureFor));
    container.style.setProperty('--future-h', futureFor ? FUTURE_H + 'px' : '0px');
    if (futureEl) futureEl.hidden = !futureFor;
    refresh();
  }
  futureEl?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' });
  });

  // one ring from the NOW edge when fresh stories arrive
  function pulse() {
    container.classList.remove('is-pulse');
    void container.offsetWidth;
    container.classList.add('is-pulse');
    setTimeout(() => container.classList.remove('is-pulse'), 1000);
  }

  return {
    refresh,
    setSource,
    setFuture,
    pulse,
    hide() {
      container.classList.add('is-empty');
    },
  };
}
