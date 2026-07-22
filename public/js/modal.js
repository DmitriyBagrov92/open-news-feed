// Preview modal: readability extract, on-demand summary and translation,
// anonymous comments, prev/next story navigation with a zoom in/out of the
// grid card. The shell (root, scrim, arrows, key handling) lives for the
// whole preview session; everything article-specific is rebuilt per story.

import { el, icon, iconButton } from './dom.js';
import { t, catLabel } from './i18n.js';
import { api } from './api.js';
import { prefs, ensureAuthorId } from './prefs.js';
import { toast } from './toast.js';
import { absTime } from './time.js';
import { buildMedia, applyCardReactions } from './cards.js';
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
  animateCrossfade,
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

// Like/dislike for the opened story: optimistic pills mirroring the grid
// cards, reconciled with the server, and mirrored back onto the story's
// grid card the moment the vote lands.
let modalVoteInFlight = false;

function buildVotes(article) {
  const wrap = el('div', { class: 'modal-react' });
  const buttons = {};
  const paint = () => {
    for (const kind of ['up', 'down']) {
      buttons[kind].querySelector('span').textContent = String(article[kind] || 0);
      buttons[kind].setAttribute('aria-pressed', String(article.myVote === (kind === 'up' ? 1 : -1)));
    }
  };
  const syncGridCard = () => {
    const card = active?.cardFor?.();
    if (card) applyCardReactions(card, { comments: article.commentCount || 0, up: article.up || 0, down: article.down || 0, myVote: article.myVote ?? null });
  };
  for (const kind of ['up', 'down']) {
    const val = kind === 'up' ? 1 : -1;
    const btn = el('button', {
      class: 'modal-vote mono modal-vote--' + kind,
      type: 'button',
      'aria-label': t(kind === 'up' ? 'card.like' : 'card.dislike'),
      'aria-pressed': 'false',
    });
    btn.append(icon(kind), el('span', { text: '0' }));
    btn.addEventListener('click', async () => {
      if (modalVoteInFlight) return;
      modalVoteInFlight = true;
      const next = article.myVote === val ? 0 : val; // second tap retracts
      const prev = { up: article.up || 0, down: article.down || 0, myVote: article.myVote ?? null };
      const opt = { ...prev, myVote: next === 0 ? null : next };
      if (prev.myVote === 1) opt.up -= 1;
      if (prev.myVote === -1) opt.down -= 1;
      if (next === 1) opt.up += 1;
      if (next === -1) opt.down += 1;
      Object.assign(article, opt);
      paint();
      try {
        const res = await api.voteNews(article.id, next, ensureAuthorId());
        Object.assign(article, res);
      } catch (err) {
        Object.assign(article, prev);
        toast(t(err?.code === 'unknown-article' ? 'card.voteClosed' : 'card.voteFailed'));
      } finally {
        modalVoteInFlight = false;
        paint();
        syncGridCard();
      }
    });
    buttons[kind] = btn;
    wrap.append(btn);
  }
  paint();
  // battle/saved articles arrive without counters — fetch the truth
  if (article.up === undefined || article.myVote === undefined) {
    api
      .reactions([article.id], prefs.authorId || undefined)
      .then((res) => {
        const r = res.reactions?.[article.id];
        if (!r || !wrap.isConnected) return;
        article.up = r.up;
        article.down = r.down;
        article.myVote = r.myVote;
        article.commentCount = r.comments;
        paint();
      })
      .catch(() => {});
  }
  return wrap;
}

// Everything specific to one story: close button, media, text, summary,
// translation, comments. Stale async work is guarded by articleCol.isConnected
// — false both after navigation (column replaced) and after close.
function buildArticleView(article, { onCountChange } = {}) {
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
  actions.append(translateBtn, summarizeBtn, sourceLink, buildVotes(article));

  const chip = el('button', { class: 'chip', type: 'button', hidden: true });
  const summaryBox = el('div', { class: 'modal-summary', hidden: true });
  const note = el('p', { class: 'modal-note', hidden: true, text: t('modal.unavailable') });

  const textBox = el('div', { class: 'modal-text' });
  for (let i = 0; i < 5; i += 1) textBox.append(el('div', { class: 'skel skel-text' }));

  const body = el('div', { class: 'modal-body' });
  body.append(meta, title, actions, chip, summaryBox, note, textBox);

  const articleCol = el('div', { class: 'modal-article' });
  articleCol.append(buildMedia(article, 'modal-media'), body);
  const commentsCol = el('aside', { class: 'modal-comments' });
  commentsCol.append(
    buildCommentsPanel(article, {
      onCountChange: (n) => onCountChange?.(article, n),
    })
  );

  /* ── article text ─────────────────────────────────────────────────────── */

  let paragraphs = [article.description || ''];
  let richBlocks = null; // structured runs from the server — see renderBlocks

  const renderParagraphs = (list) => {
    while (textBox.firstChild) textBox.firstChild.remove();
    for (const para of list) {
      if (para.trim()) textBox.append(el('p', { text: para }));
    }
  };

  // Rich rendering from the server's structured blocks: links, headings
  // (live-blog timeline stamps), lists, quotes, bold/italic. Built entirely
  // via createElement/textContent — no markup string ever touches the DOM.
  const renderRuns = (parent, runs) => {
    for (const run of runs) {
      if (typeof run?.text !== 'string' || !run.text) continue;
      let node = document.createTextNode(run.text);
      if (run.i) {
        const em = el('em');
        em.append(node);
        node = em;
      }
      if (run.b) {
        const strong = el('strong');
        strong.append(node);
        node = strong;
      }
      if (typeof run.href === 'string' && /^https?:\/\//i.test(run.href)) {
        const a = el('a', {
          class: 'modal-link',
          href: run.href,
          target: '_blank',
          rel: 'noopener nofollow',
        });
        a.append(node);
        node = a;
      }
      parent.append(node);
    }
  };

  const BLOCK_TAGS = { p: 'p', h2: 'h3', h3: 'h4', h4: 'h4', quote: 'blockquote' };

  const renderBlocks = (blocks) => {
    while (textBox.firstChild) textBox.firstChild.remove();
    for (const block of blocks) {
      if (block?.type === 'ul' || block?.type === 'ol') {
        if (!Array.isArray(block.items)) continue;
        const list = el(block.type);
        for (const item of block.items) {
          if (!Array.isArray(item)) continue;
          const li = el('li');
          renderRuns(li, item);
          if (li.textContent.trim()) list.append(li);
        }
        if (list.childElementCount) textBox.append(list);
      } else if (BLOCK_TAGS[block?.type] && Array.isArray(block.runs)) {
        // article headings render one level down: the modal h2 is the title
        const node = el(BLOCK_TAGS[block.type]);
        renderRuns(node, block.runs);
        if (node.textContent.trim()) textBox.append(node);
      }
    }
  };

  const renderOriginal = () => {
    if (richBlocks) renderBlocks(richBlocks);
    else renderParagraphs(paragraphs);
  };

  api
    .article(article.url)
    .then((res) => {
      if (!articleCol.isConnected) return;
      const text = (res.text || '').trim();
      if (!text) throw new Error('empty');
      paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
      richBlocks = Array.isArray(res.blocks) && res.blocks.length ? res.blocks : null;
      // a translation made from the RSS description is now stale
      translated = null;
      showingTranslation = false;
      chip.hidden = true;
      title.textContent = article.title;
      renderOriginal();
      maybeAutoTranslate();
    })
    .catch(() => {
      // 422 (extraction failed), 403, network… → RSS description + note
      if (!articleCol.isConnected) return;
      paragraphs = [article.description || ''];
      renderParagraphs(paragraphs);
      note.hidden = false;
      maybeAutoTranslate();
    });

  // The details view follows the feed's translation setting: with
  // auto-translate on, the story opens already translated (quietly — no
  // toasts for a failure the user didn't ask about).
  function maybeAutoTranslate() {
    if (prefs.autoTranslate) doTranslate({ manual: false });
  }

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
      let lines = toBullets(result.summary);
      // the on-device model already answers in targetLang; the local
      // extractive fallback quotes the article's own language — run those
      // bullets through the translate ladder (whole sentences only)
      const target = prefs.targetLang || 'en';
      if (result.provider === 'local' && target !== (article.language || 'en')) {
        const tr = await translateTexts(lines, target, {
          sourceLang: article.language || 'en',
        }).catch(() => null);
        if (tr && Array.isArray(tr.texts) && tr.texts.length === lines.length) lines = tr.texts;
      }
      if (!articleCol.isConnected) return; // navigated away mid-summarize
      while (summaryBox.firstChild) summaryBox.firstChild.remove();
      const head = el('div', { class: 'modal-summary-head' });
      head.append(
        el('span', { class: 'mono', text: t('modal.summaryTitle') }),
        el('span', { class: 'badge mono', text: providerLabel(result.provider) })
      );
      const list = el('ul', { class: 'bullets' });
      for (const line of lines) list.append(el('li', { text: line }));
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

  // Crossfaded swap: the text dips out, changes language while invisible
  // and settles back — no flick from one language to the other.
  const applyVersion = () => {
    animateCrossfade([title, textBox], () => {
      if (showingTranslation && translated) {
        title.textContent = translated.title;
        renderParagraphs(translated.paragraphs);
        chip.textContent = t('modal.chipTranslated');
      } else {
        title.textContent = article.title;
        renderOriginal(); // translation is plain text; the original stays rich
        chip.textContent = t('modal.chipOriginal');
      }
      chip.hidden = !translated;
    });
  };

  chip.addEventListener('click', () => {
    showingTranslation = !showingTranslation;
    applyVersion();
  });

  async function doTranslate({ manual = true } = {}) {
    const target = prefs.targetLang || 'en';
    const sourceLang = article.language || 'en';
    if (target === sourceLang) {
      if (manual) toast(t('lang.pick'));
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
      if (!articleCol.isConnected) return; // navigated away mid-translate
      if (!result) {
        if (manual) toast(t('lang.unavailable'));
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
  }

  translateBtn.addEventListener('click', () => doTranslate());

  return { articleCol, commentsCol };
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

  // shell-owned close button: pinned to the top-right corner of the whole
  // story block, surviving prev/next column swaps
  const closeBtn = iconButton('close', t('modal.close'), 'modal-close');
  closeBtn.addEventListener('click', () => close());

  let view = buildArticleView(article, { onCountChange: options.onCountChange });
  dialog.append(closeBtn, view.articleCol, view.commentsCol);
  root.append(scrim, prevBtn, dialog, nextBtn);

  function updateArrows() {
    const canPrev = !!options.getAdjacent?.(current, -1);
    const canNext = !!options.getAdjacent?.(current, 1);
    // focus rescue BEFORE hiding — a hidden activeElement drops focus to
    // body and breaks the trap
    if (!canPrev && document.activeElement === prevBtn) (canNext ? nextBtn : closeBtn).focus();
    if (!canNext && document.activeElement === nextBtn) (canPrev ? prevBtn : closeBtn).focus();
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
  closeBtn.focus();
}

export { close as closePreview };
