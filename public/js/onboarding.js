// Tinder-style taste onboarding: one story on stage, swipe right to like,
// left to skip — or use the buttons / arrow keys. Pure UI; rating effects
// (taste, saving, global votes) live in the onRate callback.

import { el, clear } from './dom.js';
import { t, catLabel } from './i18n.js';
import { relTime } from './time.js';
import { buildMedia } from './cards.js';
import { animateFlyOff, animateSpringBack, animateSwapIn } from './motion.js';

const SWIPE_PX = 80; // pointer travel that commits a rating

export function initOnboarding({ section, onRate, onDone }) {
  const stage = section.querySelector('#onboardCard');
  const progressEl = section.querySelector('#onboardProgress');
  const likeBtn = section.querySelector('#onboardLike');
  const skipBtn = section.querySelector('#onboardSkip');

  let deck = [];
  let batchDone = 0;
  let batchTotal = 5;
  let activeCard = null;
  let ratingInFlight = false;
  const abort = { keys: null };

  function renderProgress() {
    clear(progressEl);
    const dots = el('span', { class: 'onboard-dots', 'aria-hidden': 'true' });
    for (let i = 0; i < batchTotal; i += 1) {
      dots.append(el('i', { class: i < batchDone ? 'is-done' : '' }));
    }
    progressEl.append(
      dots,
      el('span', {
        class: 'mono onboard-count',
        text: t('onboard.progress', { done: batchDone, total: batchTotal }),
      })
    );
  }

  function buildStoryCard(article) {
    const card = el('article', { class: 'onboard-card' });
    card._article = article; // buttons/keys rate the story on stage
    card.append(buildMedia(article, 'onb-media'));
    const body = el('div', { class: 'onboard-body' });
    body.append(
      el('p', {
        class: 'mono onboard-meta',
        text: [article.source?.name, relTime(article.publishedAt), catLabel(article.category)]
          .filter(Boolean)
          .join(' · '),
      }),
      el('h3', { class: 'onboard-headline', text: article.title })
    );
    if (article.description) {
      body.append(el('p', { class: 'onboard-desc', text: article.description }));
    }
    card.append(
      body,
      el('span', { class: 'onboard-stamp onboard-stamp--like mono', text: t('onboard.like').toUpperCase() }),
      el('span', { class: 'onboard-stamp onboard-stamp--skip mono', text: t('onboard.skip').toUpperCase() })
    );
    wireDrag(card, article);
    return card;
  }

  /* ── drag: 1:1 tracking, stamps fade in with distance ──────────────────── */

  function wireDrag(card, article) {
    let drag = null;
    // the story image is a real <img>: without this the browser starts a
    // NATIVE drag of the picture mid-swipe and the input thread hangs
    card.addEventListener('dragstart', (e) => e.preventDefault());
    for (const img of card.querySelectorAll('img')) img.draggable = false;
    card.addEventListener('pointerdown', (e) => {
      if (ratingInFlight || e.target.closest('button, a')) return;
      card.setPointerCapture(e.pointerId);
      drag = { x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
      card.classList.add('is-dragging');
    });
    card.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.dx = e.clientX - drag.x0;
      drag.dy = e.clientY - drag.y0;
      card.style.transform = `translate(${drag.dx}px, ${drag.dy * 0.25}px) rotate(${drag.dx * 0.05}deg)`;
      const like = card.querySelector('.onboard-stamp--like');
      const skip = card.querySelector('.onboard-stamp--skip');
      like.style.opacity = String(Math.min(1, Math.max(0, drag.dx) / 100));
      skip.style.opacity = String(Math.min(1, Math.max(0, -drag.dx) / 100));
    });
    const release = () => {
      if (!drag) return;
      const { dx, dy } = drag;
      drag = null;
      card.classList.remove('is-dragging');
      if (Math.abs(dx) >= SWIPE_PX) {
        commit(article, dx > 0 ? 1 : -1, dy);
      } else {
        card.querySelectorAll('.onboard-stamp').forEach((s) => { s.style.opacity = '0'; });
        animateSpringBack(card);
      }
    };
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', release);
  }

  /* ── rating flow ───────────────────────────────────────────────────────── */

  async function commit(article, dir, dy = 0) {
    if (ratingInFlight || !activeCard) return;
    ratingInFlight = true;
    const card = activeCard;
    // show the winning stamp fully during the fly-off
    const stamp = card.querySelector(dir === 1 ? '.onboard-stamp--like' : '.onboard-stamp--skip');
    if (stamp) stamp.style.opacity = '1';
    onRate?.(article, dir);
    batchDone += 1;
    renderProgress();
    await animateFlyOff(card, dir, dy);
    card.remove();
    activeCard = null;
    ratingInFlight = false;
    if (batchDone >= batchTotal) {
      onDone?.();
      return;
    }
    next();
  }

  function next() {
    const article = deck.shift();
    if (!article) {
      onDone?.(); // deck ran dry before the batch — finish with what we have
      return;
    }
    clear(stage);
    activeCard = buildStoryCard(article);
    stage.append(activeCard);
    animateSwapIn([activeCard], 1);
  }

  function onKeys(e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    if (!activeCard || ratingInFlight) return;
    e.preventDefault();
    commit(activeCard._article, e.key === 'ArrowRight' ? 1 : -1);
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  function enter(candidates, total = 5) {
    deck = [...candidates];
    batchDone = 0;
    batchTotal = total;
    renderProgress();
    if (!deck.length) {
      clear(stage);
      stage.append(el('p', { class: 'onboard-empty', text: t('onboard.empty') }));
      return false;
    }
    abort.keys?.abort();
    abort.keys = new AbortController();
    document.addEventListener('keydown', onKeys, { signal: abort.keys.signal });
    next();
    return true;
  }

  function leave() {
    abort.keys?.abort();
    abort.keys = null;
    clear(stage);
    activeCard = null;
    ratingInFlight = false;
  }

  // buttons rate the story currently on stage
  likeBtn.addEventListener('click', () => activeCard?._article && commit(activeCard._article, 1));
  skipBtn.addEventListener('click', () => activeCard?._article && commit(activeCard._article, -1));

  return { enter, leave };
}
