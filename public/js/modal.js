// Preview modal: readability extract, on-demand summary and translation,
// anonymous comments, prev/next story navigation with a zoom in/out of the
// grid card. The shell (root, scrim, arrows, key handling) lives for the
// whole preview session; everything article-specific is rebuilt per story.

import { el, iconButton } from './dom.js';
import { t, catLabel } from './i18n.js';
import { api } from './api.js';
import { prefs } from './prefs.js';
import { toast } from './toast.js';
import { absTime } from './time.js';
import { buildMedia } from './cards.js';
import { summarize, translateTexts, splitSentences, providerLabel, toBullets } from './ai.js';
import {
  animateDialog,
  animateReveal,
  animateZoomFrom,
  animateZoomTo,
  animateDialogOut,
  animateFadeIn,
  animateFadeOut,
  animateSwapIn,
} from './motion.js';
import { buildCommentsPanel } from './comments.js';

let active = null; // { root, dialog, scrim, prevFocus, onKeydown, cardFor, closing }

function focusables(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function inViewport(rect) {
  return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
}

// Exit: the dialog zooms back into its grid card (or fades if the card is
// gone/off-screen), then the modal is torn down. `instant` skips the
// animation — used when a new preview opens over a closing one.
async function close({ instant = false } = {}) {
  if (!active || active.closing) return;
  active.closing = true;
  const { root, dialog, scrim, prevFocus, onKeydown, cardFor } = active;
  // removing the listener now self-guards a second Escape mid-animation
  document.removeEventListener('keydown', onKeydown, true);
  if (!instant) {
    // measure while body scroll is still locked — restoring it first could
    // bring the scrollbar back and shift the grid under the animation
    const card = cardFor?.();
    const rect = card ? card.getBoundingClientRect() : null;
    const out = rect && inViewport(rect) ? animateZoomTo(dialog, rect) : animateDialogOut(dialog);
    await Promise.race([Promise.all([out, animateFadeOut(scrim)]), wait(500)]);
    if (active?.root !== root) return; // a newer preview already took over
  }
  root.remove();
  document.body.style.overflow = '';
  (cardFor?.() ?? prevFocus)?.focus?.();
  active = null;
}

// Instant teardown of whatever preview exists — open OR mid-exit-animation
// (close() refuses re-entry via the closing flag, so this is separate).
function teardown() {
  if (!active) return;
  document.removeEventListener('keydown', active.onKeydown, true);
  active.root.remove();
  document.body.style.overflow = '';
  active = null;
}

// Splits a paragraph into ≤ maxLen chunks on sentence boundaries so server
// translation limits (20 texts × 1000 chars) are respected losslessly.
function chunkParagraph(text, maxLen = 1000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    const piece = sentence.length > maxLen ? sentence.slice(0, maxLen) : sentence;
    if (current && (current + ' ' + piece).length > maxLen) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? current + ' ' + piece : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [text.slice(0, maxLen)];
}

// Everything specific to one story: close button, media, text, summary,
// translation, comments. Stale async work is guarded by articleCol.isConnected
// — false both after navigation (column replaced) and after close.
function buildArticleView(article, { onCountChange } = {}) {
  const closeBtn = iconButton('close', t('modal.close'), 'modal-close');
  closeBtn.addEventListener('click', () => close());

  const meta = el('p', {
    class: 'modal-meta mono',
    text: [article.source?.name, absTime(article.publishedAt), catLabel(article.category)]
      .filter(Boolean)
      .join(' · '),
  });

  const title = el('h2', { class: 'modal-title', text: article.title });

  const translateBtn = el('button', { class: 'btn', type: 'button', text: t('modal.translate') });
  const summarizeBtn = el('button', { class: 'btn', type: 'button', text: t('modal.summarize') });
  const sourceLink = el('a', {
    class: 'btn',
    href: article.url,
    target: '_blank',
    rel: 'noopener',
    text: t('modal.readAtSource'),
  });
  const actions = el('div', { class: 'modal-actions' });
  actions.append(translateBtn, summarizeBtn, sourceLink);

  const chip = el('button', { class: 'chip', type: 'button', hidden: true });
  const summaryBox = el('div', { class: 'modal-summary', hidden: true });
  const note = el('p', { class: 'modal-note', hidden: true, text: t('modal.unavailable') });

  const textBox = el('div', { class: 'modal-text' });
  for (let i = 0; i < 5; i += 1) textBox.append(el('div', { class: 'skel skel-text' }));

  const body = el('div', { class: 'modal-body' });
  body.append(meta, title, actions, chip, summaryBox, note, textBox);

  const articleCol = el('div', { class: 'modal-article' });
  articleCol.append(closeBtn, buildMedia(article, 'modal-media'), body);
  const commentsCol = el('aside', { class: 'modal-comments' });
  commentsCol.append(
    buildCommentsPanel(article, {
      onCountChange: (n) => onCountChange?.(article, n),
    })
  );

  /* ── article text ─────────────────────────────────────────────────────── */

  let paragraphs = [article.description || ''];

  const renderParagraphs = (list) => {
    while (textBox.firstChild) textBox.firstChild.remove();
    for (const para of list) {
      if (para.trim()) textBox.append(el('p', { text: para }));
    }
  };

  api
    .article(article.url)
    .then((res) => {
      if (!articleCol.isConnected) return;
      const text = (res.text || '').trim();
      if (!text) throw new Error('empty');
      paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      // a translation made from the RSS description is now stale
      translated = null;
      showingTranslation = false;
      chip.hidden = true;
      title.textContent = article.title;
      renderParagraphs(paragraphs);
    })
    .catch(() => {
      // 422 (extraction failed), 403, network… → RSS description + note
      if (!articleCol.isConnected) return;
      paragraphs = [article.description || ''];
      renderParagraphs(paragraphs);
      note.hidden = false;
    });

  /* ── summarize ────────────────────────────────────────────────────────── */

  summarizeBtn.addEventListener('click', async () => {
    summarizeBtn.disabled = true;
    summarizeBtn.textContent = t('modal.summarizing');
    try {
      const result = await summarize(
        {
          mode: 'article',
          title: article.title,
          text: paragraphs.join('\n\n'),
          targetLang: prefs.targetLang || 'en',
        },
        {
          onProgress: (pct) => {
            summarizeBtn.textContent = pct == null ? t('modal.summarizing') : t('ai.downloading', { pct });
          },
        }
      );
      while (summaryBox.firstChild) summaryBox.firstChild.remove();
      const head = el('div', { class: 'modal-summary-head' });
      head.append(
        el('span', { class: 'mono', text: t('modal.summaryTitle') }),
        el('span', { class: 'badge mono', text: providerLabel(result.provider) })
      );
      const list = el('ul', { class: 'bullets' });
      for (const line of toBullets(result.summary)) list.append(el('li', { text: line }));
      summaryBox.append(head, list);
      summaryBox.hidden = false;
      animateReveal(summaryBox);
    } catch {
      toast(t('brief.error'));
    } finally {
      summarizeBtn.disabled = false;
      summarizeBtn.textContent = t('modal.summarize');
    }
  });

  /* ── translate ────────────────────────────────────────────────────────── */

  let translated = null; // { title, paragraphs }
  let showingTranslation = false;

  const applyVersion = () => {
    if (showingTranslation && translated) {
      title.textContent = translated.title;
      renderParagraphs(translated.paragraphs);
      chip.textContent = t('modal.chipTranslated');
    } else {
      title.textContent = article.title;
      renderParagraphs(paragraphs);
      chip.textContent = t('modal.chipOriginal');
    }
    chip.hidden = !translated;
  };

  chip.addEventListener('click', () => {
    showingTranslation = !showingTranslation;
    applyVersion();
  });

  translateBtn.addEventListener('click', async () => {
    const target = prefs.targetLang || 'en';
    const sourceLang = article.language || 'en';
    if (target === sourceLang) {
      toast(t('lang.pick'));
      return;
    }
    if (translated) {
      showingTranslation = true;
      applyVersion();
      return;
    }
    translateBtn.disabled = true;
    translateBtn.textContent = t('modal.translating');
    try {
      // Flatten title + chunked paragraphs, translate, then reassemble.
      const units = [article.title];
      const spans = [];
      for (const para of paragraphs) {
        const chunks = chunkParagraph(para);
        spans.push({ start: units.length, count: chunks.length });
        units.push(...chunks);
      }
      const result = await translateTexts(units, target, {
        sourceLang,
        onProgress: (pct) => {
          if (pct != null) translateBtn.textContent = t('ai.downloading', { pct });
        },
      });
      if (!result) {
        toast(t('lang.unavailable'));
        return;
      }
      translated = {
        title: result.texts[0],
        paragraphs: spans.map((s) => result.texts.slice(s.start, s.start + s.count).join(' ')),
      };
      showingTranslation = true;
      applyVersion();
    } finally {
      translateBtn.disabled = false;
      translateBtn.textContent = t('modal.translate');
    }
  });

  return { articleCol, commentsCol, closeBtn };
}

export function openPreview(article, options = {}) {
  teardown();

  let current = article;
  const drafts = new Map(); // comment drafts survive prev/next, die with the modal

  // role/aria live on the root: the nav arrows are siblings of the dialog
  // and must sit inside the dialog for AT and inside the focus trap
  const root = el('div', {
    class: 'modal',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': article.title,
  });
  const scrim = el('div', { class: 'modal-scrim' });
  const dialog = el('div', { class: 'modal-dialog has-comments' });

  const prevBtn = iconButton('prev', t('modal.prev'), 'modal-nav modal-nav--prev');
  const nextBtn = iconButton('next', t('modal.next'), 'modal-nav modal-nav--next');

  let view = buildArticleView(article, { onCountChange: options.onCountChange });
  dialog.append(view.articleCol, view.commentsCol);
  root.append(scrim, prevBtn, dialog, nextBtn);

  function updateArrows() {
    const canPrev = !!options.getAdjacent?.(current, -1);
    const canNext = !!options.getAdjacent?.(current, 1);
    // focus rescue BEFORE hiding — a hidden activeElement drops focus to
    // body and breaks the trap
    if (!canPrev && document.activeElement === prevBtn) (canNext ? nextBtn : view.closeBtn).focus();
    if (!canNext && document.activeElement === nextBtn) (canPrev ? prevBtn : view.closeBtn).focus();
    prevBtn.hidden = !canPrev;
    nextBtn.hidden = !canNext;
  }

  function navigate(dir) {
    if (!active || active.closing) return;
    const next = options.getAdjacent?.(current, dir);
    if (!next) return;
    const input = dialog.querySelector('.cmt-input');
    if (input) drafts.set(current.id, input.value);
    const nextView = buildArticleView(next, { onCountChange: options.onCountChange });
    const draft = drafts.get(next.id);
    if (draft) nextView.commentsCol.querySelector('.cmt-input').value = draft;
    view.articleCol.replaceWith(nextView.articleCol);
    view.commentsCol.replaceWith(nextView.commentsCol);
    view = nextView;
    current = next;
    root.setAttribute('aria-label', current.title);
    dialog.scrollTop = 0; // <1000px the dialog itself is the scroll container
    updateArrows();
    animateSwapIn([view.articleCol, view.commentsCol], dir);
  }

  prevBtn.addEventListener('click', () => navigate(-1));
  nextBtn.addEventListener('click', () => navigate(1));

  root.addEventListener('mousedown', (e) => {
    if (e.target === root) close();
  });

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the modal owns Escape while open
      // a comment draft must survive a reflexive Escape: blur, don't close
      if (e.target?.classList?.contains('cmt-input') && e.target.value.trim()) {
        e.target.blur();
        return;
      }
      close();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (e.altKey || e.metaKey || e.ctrlKey) return; // browser/word navigation
      if (e.target.closest?.('input, textarea, select') || e.target.isContentEditable) return;
      e.preventDefault();
      navigate(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(root);
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
  };
  document.addEventListener('keydown', onKeydown, true);

  active = {
    root,
    dialog,
    scrim,
    prevFocus: document.activeElement,
    onKeydown,
    cardFor: () => options.cardFor?.(current) ?? null,
    closing: false,
  };
  document.body.append(root);
  updateArrows();
  const origin = options.cardFor?.(article);
  animateFadeIn(scrim);
  if (origin) animateZoomFrom(dialog, origin.getBoundingClientRect());
  else animateDialog(dialog);
  document.body.style.overflow = 'hidden';
  view.closeBtn.focus();
}

export { close as closePreview };
