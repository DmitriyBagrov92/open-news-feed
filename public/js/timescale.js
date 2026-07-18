// The right-rail plasma timescale. The vertical line maps the loaded feed's
// time range (NOW at the top). The cursor mirrors the scroll position and
// shows the time of the stories currently in view; clicking or dragging the
// rail seeks the feed to that moment.

import { relTime } from './time.js';

const HEADER_OFFSET = 150; // sticky band + masthead ≈ where "in view" starts

function fmtClock(iso) {
  const d = new Date(iso);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

export function initTimescale({ container, ticksEl, cursorEl, labelEl, grid, articleById, plasma, onSeekBeyond }) {
  if (!container) return { refresh() {}, hide() {} };

  let newestT = 0;
  let oldestT = 0;
  let dragging = false;

  const visibleCards = () => grid.querySelectorAll('.card:not(.card--skeleton)');

  function articleTime(card) {
    const article = articleById.get(card?.dataset.id);
    return article ? Date.parse(article.publishedAt) : NaN;
  }

  // ── range / ticks / density ───────────────────────────────────────────────

  function refresh() {
    const cards = visibleCards();
    if (cards.length < 3) {
      container.classList.add('is-empty');
      return;
    }
    container.classList.remove('is-empty');

    let newest = -Infinity;
    let oldest = Infinity;
    const times = [];
    for (const card of cards) {
      const t = articleTime(card);
      if (Number.isNaN(t)) continue;
      times.push(t);
      if (t > newest) newest = t;
      if (t < oldest) oldest = t;
    }
    if (!times.length || newest === oldest) return;
    newestT = newest;
    oldestT = oldest;

    // density over the range feeds the plasma (bucket 23 = NOW end = top)
    const buckets = new Array(24).fill(0);
    for (const t of times) {
      const pos = (t - oldest) / (newest - oldest);
      buckets[Math.min(23, Math.floor(pos * 24))] += 1;
    }
    plasma.setHistogram(buckets);

    // ticks: quarter marks with the actual story time at that depth
    ticksEl.textContent = '';
    for (const frac of [0.25, 0.5, 0.75]) {
      const t = newest - (newest - oldest) * frac;
      const tick = document.createElement('span');
      tick.className = 'timescale-tick mono';
      tick.style.top = frac * 100 + '%';
      tick.textContent = relTime(new Date(t).toISOString());
      ticksEl.append(tick);
    }
    syncCursor();
  }

  // ── scroll → cursor ───────────────────────────────────────────────────────

  function topVisibleCard() {
    for (const card of visibleCards()) {
      if (card.getBoundingClientRect().bottom > HEADER_OFFSET) return card;
    }
    return null;
  }

  function placeCursor(frac, iso) {
    cursorEl.style.top = Math.max(0, Math.min(1, frac)) * 100 + '%';
    labelEl.textContent = frac <= 0.005 ? 'NOW' : relTime(iso) + ' · ' + fmtClock(iso);
  }

  function syncCursor() {
    if (dragging || newestT === oldestT) return;
    const card = topVisibleCard();
    const t = articleTime(card);
    if (Number.isNaN(t)) return;
    placeCursor((newestT - t) / (newestT - oldestT), new Date(t).toISOString());
  }

  let raf = 0;
  window.addEventListener(
    'scroll',
    () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncCursor();
      });
    },
    { passive: true }
  );
  window.addEventListener('resize', () => refresh());

  // ── scrub → scroll ────────────────────────────────────────────────────────

  function fracFromEvent(e) {
    const rect = container.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
  }

  function seek(frac) {
    if (newestT === oldestT) return;
    const target = newestT - frac * (newestT - oldestT);
    let dest = null;
    for (const card of visibleCards()) {
      const t = articleTime(card);
      if (!Number.isNaN(t) && t <= target) {
        dest = card;
        break;
      }
    }
    if (!dest) {
      // older than anything loaded: let the app fetch more, then retry
      onSeekBeyond?.(() => seek(frac));
      return;
    }
    const y = dest.getBoundingClientRect().top + window.scrollY - HEADER_OFFSET + 10;
    window.scrollTo({
      top: y,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }

  container.addEventListener('pointerdown', (e) => {
    dragging = true;
    container.setPointerCapture(e.pointerId);
    const frac = fracFromEvent(e);
    const t = newestT - frac * (newestT - oldestT);
    placeCursor(frac, new Date(t).toISOString());
  });
  container.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const frac = fracFromEvent(e);
    const t = newestT - frac * (newestT - oldestT);
    placeCursor(frac, new Date(t).toISOString());
  });
  container.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    dragging = false;
    seek(fracFromEvent(e));
  });
  container.addEventListener('pointercancel', () => {
    dragging = false;
    syncCursor();
  });

  return {
    refresh,
    hide() {
      container.classList.add('is-empty');
    },
  };
}
