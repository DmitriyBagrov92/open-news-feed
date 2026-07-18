// Anonymous comments panel: header with live total and sort toggle,
// composer ("Commenting as <persona>"), paginated list with like/dislike.
// Every user-generated string is rendered via textContent — comment bodies
// are as untrusted as feed content.

import { el, clear, icon } from './dom.js';
import { t } from './i18n.js';
import { api, ApiError } from './api.js';
import { prefs, ensureAuthorId } from './prefs.js';
import { relTime } from './time.js';
import { toast } from './toast.js';
import { animateReveal } from './motion.js';

const PAGE_SIZE = 20;
// fixed client-side glyph set; the server picks an index (avatar.glyph)
const GLYPHS = [...'◆●▲■★✦☀☾⚡❄✳✺◐◭⬟⬢✹❋✷✵♆♓⌘✜'];

function avatarEl(avatar, name) {
  const a = el('span', { class: 'cmt-avatar', 'aria-hidden': 'true' });
  a.style.setProperty('--av-hue', String(Math.max(0, Math.min(359, Number(avatar?.hue) || 0))));
  a.textContent = GLYPHS[(Number(avatar?.glyph) || 0) % GLYPHS.length] || '●';
  a.title = name || '';
  return a;
}

function errorCodeToast(err) {
  const map = {
    'too-fast': 'comments.tooFast',
    duplicate: 'comments.duplicate',
    'article-limit': 'comments.limit',
    'comments-full': 'comments.limit',
    'unknown-article': 'comments.closed',
  };
  toast(t(map[err?.code] || 'comments.failed'));
}

// Builds the panel and starts loading page 1.
// onCountChange(total) fires whenever the known total changes.
export function buildCommentsPanel(article, { onCountChange } = {}) {
  const root = el('section', { class: 'cmt-panel', 'aria-label': t('comments.title') });

  const state = {
    sort: 'new',
    page: 1,
    total: 0,
    ids: new Set(),
    loading: false,
  };

  /* ── header ────────────────────────────────────────────────────────────── */
  const title = el('span', { class: 'mono cmt-title', text: t('comments.title') });
  const count = el('span', { class: 'mono cmt-count', text: '' });
  const sortNew = el('button', { class: 'cmt-sort mono is-active', type: 'button', text: t('comments.sortNew') });
  const sortTop = el('button', { class: 'cmt-sort mono', type: 'button', text: t('comments.sortTop') });
  const head = el('header', { class: 'cmt-head' });
  const sorts = el('div', { class: 'cmt-sorts' });
  sorts.append(sortNew, sortTop);
  head.append(title, count, sorts);

  /* ── composer ──────────────────────────────────────────────────────────── */
  const meLine = el('div', { class: 'cmt-me mono' });
  const input = el('textarea', {
    class: 'cmt-input',
    rows: '3',
    maxlength: '1000',
    placeholder: t('comments.placeholder'),
    'aria-label': t('comments.placeholder'),
  });
  const postBtn = el('button', { class: 'btn mono', type: 'button', text: t('comments.post') });
  const composer = el('div', { class: 'cmt-composer' });
  const composerFoot = el('div', { class: 'cmt-composer-foot' });
  composerFoot.append(meLine, postBtn);
  composer.append(input, composerFoot);

  /* ── list & footer ─────────────────────────────────────────────────────── */
  const list = el('ul', { class: 'cmt-list' });
  const status = el('p', { class: 'cmt-status', 'aria-live': 'polite', hidden: true });
  const moreBtn = el('button', { class: 'btn mono cmt-more', type: 'button', text: t('comments.loadMore'), hidden: true });

  root.append(head, composer, status, list, moreBtn);

  function setTotal(n) {
    state.total = n;
    count.textContent = String(n);
    onCountChange?.(n);
  }

  function voteButton(kind, comment, row) {
    const btn = el('button', {
      class: 'cmt-vote cmt-vote--' + kind,
      type: 'button',
      'aria-label': t(kind === 'up' ? 'comments.like' : 'comments.dislike'),
      'aria-pressed': String(comment.myVote === (kind === 'up' ? 1 : -1)),
    });
    const n = el('span', { class: 'mono', text: String(comment[kind]) });
    btn.append(icon(kind), n);
    btn.addEventListener('click', async () => {
      const target = kind === 'up' ? 1 : -1;
      const next = comment.myVote === target ? 0 : target;
      try {
        const res = await api.voteComment(comment.id, next, ensureAuthorId());
        comment.up = res.up;
        comment.down = res.down;
        comment.myVote = res.myVote;
        // reconcile both buttons from the server's answer
        for (const k of ['up', 'down']) {
          const b = row.querySelector('.cmt-vote--' + k);
          b.querySelector('span').textContent = String(comment[k]);
          b.setAttribute('aria-pressed', String(comment.myVote === (k === 'up' ? 1 : -1)));
        }
      } catch (err) {
        errorCodeToast(err instanceof ApiError ? err : null);
      }
    });
    return btn;
  }

  function commentRow(comment) {
    const row = el('li', { class: 'cmt-item', 'data-id': comment.id });
    const meta = el('div', { class: 'cmt-meta' });
    meta.append(
      avatarEl(comment.avatar, comment.name),
      el('span', { class: 'cmt-name', text: comment.name }),
      el('time', {
        class: 'mono cmt-time',
        datetime: comment.createdAt,
        text: relTime(comment.createdAt),
      })
    );
    const body = el('p', { class: 'cmt-body', text: comment.body });
    const votes = el('div', { class: 'cmt-votes' });
    votes.append(voteButton('up', comment, row), voteButton('down', comment, row));
    row.append(meta, body, votes);
    return row;
  }

  function showStatus(kind) {
    status.hidden = false;
    clear(status);
    status.textContent = t(kind === 'empty' ? 'comments.empty' : 'comments.error');
    if (kind === 'error') {
      const retry = el('button', { class: 'btn mono', type: 'button', text: t('comments.retry') });
      retry.addEventListener('click', () => load({ reset: true }));
      status.append(' ', retry);
    }
  }

  async function load({ reset = false } = {}) {
    if (state.loading) return;
    state.loading = true;
    moreBtn.disabled = true;
    if (reset) {
      state.page = 1;
      state.ids = new Set();
      clear(list);
      status.hidden = true;
    }
    try {
      const res = await api.comments(article.id, {
        page: state.page,
        pageSize: PAGE_SIZE,
        sort: state.sort,
        authorId: prefs.authorId || undefined, // don't mint an id just to read
      });
      setTotal(res.total);
      if (res.me) meLine.textContent = t('comments.as', { name: res.me.name });
      for (const comment of res.comments) {
        if (state.ids.has(comment.id)) continue;
        state.ids.add(comment.id);
        list.append(commentRow(comment));
      }
      state.page += 1;
      moreBtn.hidden = state.ids.size >= res.total;
      if (!res.total) showStatus('empty');
      else status.hidden = true;
    } catch {
      if (!state.ids.size) showStatus('error');
      else toast(t('comments.error'));
    } finally {
      state.loading = false;
      moreBtn.disabled = false;
    }
  }

  async function submit() {
    const body = input.value.trim();
    if (body.length < 2) return;
    postBtn.disabled = true;
    postBtn.textContent = t('comments.posting');
    try {
      const created = await api.postComment(article.id, body, ensureAuthorId());
      input.value = '';
      meLine.textContent = t('comments.as', { name: created.name });
      state.ids.add(created.id);
      const row = commentRow(created);
      list.prepend(row);
      animateReveal(row);
      setTotal(state.total + 1);
      status.hidden = true;
    } catch (err) {
      errorCodeToast(err instanceof ApiError ? err : null);
    } finally {
      postBtn.disabled = false;
      postBtn.textContent = t('comments.post');
    }
  }

  postBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
  });
  moreBtn.addEventListener('click', () => load());
  const setSort = (sort) => {
    if (state.sort === sort) return;
    state.sort = sort;
    sortNew.classList.toggle('is-active', sort === 'new');
    sortTop.classList.toggle('is-active', sort === 'top');
    load({ reset: true });
  };
  sortNew.addEventListener('click', () => setSort('new'));
  sortTop.addEventListener('click', () => setSort('top'));

  load({ reset: true });
  return root;
}
