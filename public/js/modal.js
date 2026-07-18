// Preview modal: readability extract, on-demand summary and translation.

import { el, iconButton } from './dom.js';
import { t, catLabel } from './i18n.js';
import { api } from './api.js';
import { prefs } from './prefs.js';
import { toast } from './toast.js';
import { absTime } from './time.js';
import { buildMedia } from './cards.js';
import { summarize, translateTexts, splitSentences, providerLabel, toBullets } from './ai.js';

let active = null; // { root, prevFocus, onKeydown }

function focusables(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'
  )].filter((node) => node.offsetParent !== null || node === document.activeElement);
}

function close() {
  if (!active) return;
  document.removeEventListener('keydown', active.onKeydown, true);
  active.root.remove();
  document.body.style.overflow = '';
  active.prevFocus?.focus?.();
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

export function openPreview(article) {
  close();

  const root = el('div', { class: 'modal' });
  const dialog = el('div', {
    class: 'modal-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': article.title,
  });

  const closeBtn = iconButton('close', t('modal.close'), 'modal-close');
  closeBtn.addEventListener('click', close);

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

  dialog.append(closeBtn, buildMedia(article, 'modal-media'), body);
  root.append(dialog);

  root.addEventListener('mousedown', (e) => {
    if (e.target === root) close();
  });

  const onKeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation(); // the modal owns Escape while open
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(dialog);
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

  active = { root, prevFocus: document.activeElement, onKeydown };
  document.body.append(root);
  document.body.style.overflow = 'hidden';
  closeBtn.focus();

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
      if (!active || active.root !== root) return;
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
      if (!active || active.root !== root) return;
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
        { onProgress: (pct) => { summarizeBtn.textContent = t('ai.downloading', { pct }); } }
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
        onProgress: (pct) => { translateBtn.textContent = t('ai.downloading', { pct }); },
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
}

export { close as closePreview };
