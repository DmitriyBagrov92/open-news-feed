// Article card construction. All feed strings go through textContent.

import { el, icon, iconButton } from './dom.js';
import { t, catLabel } from './i18n.js';
import { relTime, freshness } from './time.js';

// Stable hue (0–359) from a source id, for the image-fallback duotone.
export function hashHue(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) % 360;
  return h;
}

export function fallbackTile(source) {
  const tile = el('div', { class: 'tile', 'aria-hidden': 'true' });
  tile.style.setProperty('--tile-hue', String(hashHue(source?.id || source?.name || '?')));
  tile.append(el('span', { class: 'tile-letter', text: (source?.name || '?').charAt(0) }));
  return tile;
}

export function buildMedia(article, className) {
  const media = el('div', { class: className });
  if (article.image) {
    const img = el('img', {
      src: article.image,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
    });
    img.addEventListener('error', () => img.replaceWith(fallbackTile(article.source)), { once: true });
    media.append(img);
  } else {
    media.append(fallbackTile(article.source));
  }
  return media;
}

// handlers: { onOpen(article), onToggleSave(article, btn), onTranslate(article, card) }
export function buildCard(article, { hero = false, saved = false, onOpen, onToggleSave, onTranslate } = {}) {
  const card = el('article', {
    class: 'card' + (hero ? ' card--hero' : ''),
    tabindex: '0',
    'data-id': article.id,
    'aria-label': t('card.preview', { title: article.title }),
  });

  card.append(buildMedia(article, 'card-media'));

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

  const foot = el('div', { class: 'card-foot' });
  foot.append(el('span', { class: 'card-cat mono', text: catLabel(article.category) }), actions);

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
