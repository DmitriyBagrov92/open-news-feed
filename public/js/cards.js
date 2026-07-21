// Article card construction. All feed strings go through textContent.

import { el, icon, iconButton } from './dom.js';
import { t, catLabel } from './i18n.js';
import { relTime, freshness } from './time.js';

// Stable hue from a source id, constrained to the solar ember→gold range
// (12°–48°) so every fallback tile belongs to the cosmic palette.
export function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) % 360;
  return 12 + (h % 37);
}

export function fallbackTile(source) {
  const tile = el('div', { class: 'tile', 'aria-hidden': 'true' });
  tile.style.setProperty('--tile-hue', String(hashHue(source?.id || source?.name || '?')));
  tile.append(el('span', { class: 'tile-letter', text: (source?.name || '?').charAt(0) }));
  return tile;
}

// minWidth: demote images too small for their slot to the duotone tile
// instead of upscaling them into blur (heroes need real resolution).
export function buildMedia(article, className, { minWidth = 0 } = {}) {
  const media = el('div', { class: className });
  if (article.image) {
    const img = el('img', {
      src: article.image,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
    });
    img.addEventListener('error', () => img.replaceWith(fallbackTile(article.source)), { once: true });
    // fade in once decoded (cached images may be complete before append)
    const reveal = () => img.classList.add('is-loaded');
    if (img.complete && img.naturalWidth) reveal();
    else img.addEventListener('load', reveal, { once: true });
    if (minWidth > 0) {
      img.addEventListener(
        'load',
        () => {
          if (img.naturalWidth && img.naturalWidth < minWidth) {
            img.replaceWith(fallbackTile(article.source));
          }
        },
        { once: true }
      );
    }
    media.append(img);
  } else {
    media.append(fallbackTile(article.source));
  }
  return media;
}

// handlers: { onOpen(article), onToggleSave(article, btn), onTranslate(article, card) }
// variant: 'hero' (2x2 lead) | 'wide' (2-col, image beside text) |
//          'std' (image on top) | 'text' (no image — compact, mediaLESS)
export function buildCard(article, { variant = 'std', saved = false, onOpen, onToggleSave, onTranslate, onVote } = {}) {
  const hero = variant === 'hero';
  const card = el('article', {
    class: 'card card--' + variant,
    tabindex: '0',
    // Conveys to AT that Enter/Space opens the preview (wired below).
    role: 'button',
    'data-id': article.id,
    'aria-label': t('card.preview', { title: article.title }),
  });

  // text cards skip media entirely — the mosaic packs more of them per
  // screen; their solar top-rule (CSS) keeps them on-theme
  if (variant !== 'text') {
    card.append(buildMedia(article, 'card-media', { minWidth: hero ? 620 : 0 }));
  }

  const meta = el('div', { class: 'card-meta mono' });
  meta.append(
    el('span', { class: 'dot dot--' + freshness(article.publishedAt), 'aria-hidden': 'true' }),
    el('time', {
      class: 'card-time',
      datetime: article.publishedAt,
      'data-published': article.publishedAt,
      text: relTime(article.publishedAt),
    }),
    el('span', { class: 'card-src', text: article.source?.name || '' })
  );

  const title = el('h3', { class: 'card-title', text: article.title });
  const desc = el('p', { class: 'card-desc', text: article.description || '' });

  const actions = el('div', { class: 'card-actions' });

  const translateBtn = iconButton('globe', t('card.translate'));
  translateBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onTranslate?.(article, card);
  });

  const saveBtn = iconButton('bookmark', saved ? t('card.unsave') : t('card.save'));
  if (saved) saveBtn.classList.add('is-saved');
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleSave?.(article, saveBtn);
  });

  const openLink = el('a', {
    class: 'icon-btn',
    href: article.url,
    target: '_blank',
    rel: 'noopener',
    'aria-label': t('card.open'),
    title: t('card.open'),
  });
  openLink.append(icon('external'));
  openLink.addEventListener('click', (e) => e.stopPropagation());

  actions.append(translateBtn, saveBtn, openLink);

  // comment-count chip: its own click target opening the preview;
  // hidden until the article actually has comments
  const cmtChip = el('button', {
    class: 'card-cmt mono',
    type: 'button',
    'aria-label': t('card.comments', { n: article.commentCount || 0 }),
    hidden: !(article.commentCount > 0),
  });
  cmtChip.append(icon('comment'), el('span', { text: String(article.commentCount || 0) }));
  cmtChip.addEventListener('click', (e) => {
    e.stopPropagation();
    onOpen?.(article);
  });

  // like/dislike the story right from the grid; counts are always visible
  // and live-refreshed by the reactions poll
  const react = el('div', { class: 'card-react' });
  for (const kind of ['up', 'down']) {
    const val = kind === 'up' ? 1 : -1;
    // mono on the button (like .card-cmt), not the span — a .mono span
    // would take .mono's own font-size and outgrow the comment chip
    const btn = el('button', {
      class: 'card-vote mono card-vote--' + kind,
      type: 'button',
      'aria-label': t(kind === 'up' ? 'card.like' : 'card.dislike'),
      'aria-pressed': String(article.myVote === val),
    });
    btn.append(icon(kind), el('span', { text: String(article[kind] || 0) }));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onVote?.(article, val, card);
    });
    react.append(btn);
  }

  const footL = el('div', { class: 'card-foot-l' });
  footL.append(
    el('span', { class: 'card-cat mono', text: catLabel(article.category) }),
    react,
    cmtChip
  );
  const foot = el('div', { class: 'card-foot' });
  foot.append(footL, actions);

  const body = el('div', { class: 'card-body' });
  body.append(meta, title, desc, foot);
  card.append(body);

  card.addEventListener('click', (e) => {
    if (e.target.closest('button, a, input, select')) return;
    onOpen?.(article);
  });
  card.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === card) {
      e.preventDefault();
      onOpen?.(article);
    }
  });

  return card;
}

// Live update of a card's comment-count chip (after posting in the preview).
export function setCardCommentCount(card, n) {
  const chip = card?.querySelector('.card-cmt');
  if (!chip) return;
  chip.hidden = !(n > 0);
  chip.querySelector('span').textContent = String(n);
  chip.setAttribute('aria-label', t('card.comments', { n }));
}

// Live update of a card's counters from a reactions payload
// { comments, up, down, myVote }.
export function applyCardReactions(card, r) {
  if (!card || !r) return;
  setCardCommentCount(card, r.comments || 0);
  for (const kind of ['up', 'down']) {
    const btn = card.querySelector('.card-vote--' + kind);
    if (!btn) continue;
    btn.querySelector('span').textContent = String(r[kind] || 0);
    btn.setAttribute('aria-pressed', String(r.myVote === (kind === 'up' ? 1 : -1)));
  }
}

export function applyCardText(card, title, description) {
  const titleEl = card.querySelector('.card-title');
  const descEl = card.querySelector('.card-desc');
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = description || '';
}

export function skeletonCard() {
  const card = el('div', { class: 'card card--skeleton', 'aria-hidden': 'true' });
  card.append(el('div', { class: 'skel skel-media' }));
  const body = el('div', { class: 'card-body' });
  body.append(
    el('div', { class: 'skel skel-line skel-line--meta' }),
    el('div', { class: 'skel skel-line' }),
    el('div', { class: 'skel skel-line' }),
    el('div', { class: 'skel skel-line skel-line--short' })
  );
  card.append(body);
  return card;
}
