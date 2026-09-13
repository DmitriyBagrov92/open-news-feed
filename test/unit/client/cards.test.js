import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseHTML } from 'linkedom';
import { installClientShims } from '../../helpers/client-shims.js';

installClientShims();
const { buildCard, skeletonCard, applyCardReactions, setCardCommentCount, applyCardText, hashHue } = await import('../../../public/js/cards.js');
const { el, icon, iconButton } = await import('../../../public/js/dom.js');

const article = {
  id: '0123456789ab', title: 'Storm nears the coast', description: 'Ferries cancelled.', url: 'https://www.bbc.com/fixture/story-a',
  image: 'https://images.example.net/1.jpg', source: { id: 'bbc-world', name: 'BBC World' }, category: 'world',
  publishedAt: new Date().toISOString(), language: 'en', commentCount: 0, up: 0, down: 0, myVote: null,
};

test('dom helpers build elements, icons and icon buttons', () => {
  const node = el('div', { class: 'x', 'data-id': '1', hidden: false, text: 'hi' }, el('span', { text: 'in' }));
  assert.equal(node.className, 'x');
  assert.equal(node.getAttribute('data-id'), '1');
  assert.equal(node.hasAttribute('hidden'), false);
  assert.equal(icon('close').tagName.toLowerCase(), 'svg');
  const btn = iconButton('globe', 'Translate');
  assert.equal(btn.getAttribute('aria-label'), 'Translate');
  assert.equal(btn.getAttribute('type'), 'button');
});

test('buildCard keeps the DOM contract the feed machinery relies on', () => {
  const opened = [];
  const card = buildCard(article, { variant: 'std', onOpen: (a) => opened.push(a.id) });
  assert.equal(card.tagName.toLowerCase(), 'article');
  assert.ok(card.classList.contains('card') && card.classList.contains('card--std'));
  assert.equal(card.getAttribute('data-id'), article.id);
  assert.equal(card.getAttribute('role'), 'button');
  const meta = card.querySelector('.card-meta');
  assert.ok(meta.querySelector('.dot.dot--live'), 'freshness dot inside .card-meta');
  assert.equal(meta.querySelector('time[data-published]').getAttribute('data-published'), article.publishedAt);
  assert.equal(card.querySelector('.card-title').textContent, article.title);
  const actions = card.querySelectorAll('.card-actions .icon-btn');
  assert.equal(actions[0].getAttribute('data-testid'), 'card-translate', 'translate is the first action');
  assert.equal(actions[1].getAttribute('data-testid'), 'card-save');
  assert.equal(actions[2].getAttribute('rel'), 'noopener');
  assert.ok(card.querySelector('.card-cmt').hasAttribute('hidden'), 'no comments → chip hidden');
  assert.ok(card.querySelector('.card-vote--up span') && card.querySelector('.card-vote--down span'));
  assert.ok(card.querySelector('.card-media img'));
  const text = buildCard({ ...article, image: null }, { variant: 'text' });
  assert.equal(text.querySelector('.card-media'), null);
});

test('reaction, comment and text updates write into the right spans', () => {
  const card = buildCard(article, {});
  applyCardReactions(card, { comments: 4, up: 2, down: 1, myVote: 1 });
  assert.equal(card.querySelector('.card-vote--up span').textContent, '2');
  assert.equal(card.querySelector('.card-vote--up').getAttribute('aria-pressed'), 'true');
  assert.equal(card.querySelector('.card-cmt span').textContent, '4');
  assert.equal(card.querySelector('.card-cmt').hasAttribute('hidden'), false);
  setCardCommentCount(card, 0);
  assert.ok(card.querySelector('.card-cmt').hasAttribute('hidden'));
  applyCardText(card, 'T', 'D');
  assert.equal(card.querySelector('.card-desc').textContent, 'D');
  assert.ok(hashHue('bbc-world') >= 12 && hashHue('bbc-world') <= 48);
});

test('skeletonCard() matches the inline skeletons shipped in index.html', async () => {
  const html = await readFile(new URL('../../../public/index.html', import.meta.url), 'utf8');
  const { document } = parseHTML(html);
  const inline = document.querySelector('#grid .card--skeleton');
  const built = skeletonCard();
  // structure + attribute sets, independent of attribute order / whitespace
  const canon = (node) => {
    const attrs = [...node.attributes].map((a) => `${a.name}=${a.value}`).sort().join(' ');
    const kids = [...node.children].map(canon).join('');
    return `<${node.tagName.toLowerCase()} ${attrs}>${kids}</${node.tagName.toLowerCase()}>`;
  };
  assert.equal(canon(built), canon(inline));
  assert.equal(document.querySelectorAll('#grid .card--skeleton').length, 6);
});
