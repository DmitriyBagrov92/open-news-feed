// Hover tooltip for grid cards: hold the cursor on a story to read its full
// title and details without opening it. One shared element, delegation on
// the grid, hover-capable pointers only — touch never sees it.

import { el, clear } from './dom.js';
import { catLabel } from './i18n.js';
import { relTime } from './time.js';

const SHOW_DELAY_MS = 550; // "holding", not just passing through
const EDGE_PAD = 14;

export function initCardTooltip({ grid, articleById }) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;

  const tip = el('div', { class: 'card-tip', role: 'tooltip', hidden: true });
  document.body.append(tip);

  let timer = null;
  let hideTimer = null;
  let currentCard = null;
  let lastX = 0;
  let lastY = 0;

  function position(x, y) {
    const r = tip.getBoundingClientRect();
    let left = Math.min(x + 16, innerWidth - r.width - EDGE_PAD);
    let top = y + 20;
    if (top + r.height > innerHeight - EDGE_PAD) top = y - r.height - 16;
    tip.style.left = Math.max(EDGE_PAD, left) + 'px';
    tip.style.top = Math.max(EDGE_PAD, top) + 'px';
  }

  function show(card) {
    const article = articleById.get(card.dataset.id);
    if (!article) return;
    clear(tip);
    tip.append(
      el('p', {
        class: 'card-tip-meta mono',
        text: [article.source?.name, relTime(article.publishedAt), catLabel(article.category)]
          .filter(Boolean)
          .join(' · '),
      }),
      el('p', { class: 'card-tip-title', text: article.title })
    );
    if (article.description) {
      tip.append(el('p', { class: 'card-tip-desc', text: article.description }));
    }
    clearTimeout(hideTimer);
    tip.hidden = false;
    tip.classList.remove('is-on');
    position(lastX, lastY);
    requestAnimationFrame(() => tip.classList.add('is-on'));
  }

  function hide() {
    clearTimeout(timer);
    timer = null;
    if (tip.hidden) return;
    tip.classList.remove('is-on');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { tip.hidden = true; }, 160);
  }

  grid.addEventListener('pointermove', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;
  }, { passive: true });

  grid.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    // buttons and links carry their own affordances — never cover them
    if (e.target.closest?.('button, a')) {
      currentCard = null;
      hide();
      return;
    }
    const card = e.target.closest?.('.card[data-id]');
    if (card === currentCard) return;
    currentCard = card;
    hide();
    if (card) timer = setTimeout(() => show(card), SHOW_DELAY_MS);
  });

  grid.addEventListener('pointerleave', () => {
    currentCard = null;
    hide();
  });

  // any real interaction outranks the tooltip
  grid.addEventListener('pointerdown', () => {
    currentCard = null;
    hide();
  });
  addEventListener('scroll', hide, { passive: true });
}
