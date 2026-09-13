import { test } from 'node:test';
import assert from 'node:assert/strict';
import { t, setLocale, catLabel, hasLocale, LANGUAGES, isLanguage, applyI18n } from '../../../public/js/i18n.js';

test('t resolves keys, interpolates and falls back to the key', () => {
  assert.equal(t('feed.newStories', { n: 3 }), '3 NEW STORIES');
  assert.equal(t('nope.key'), 'nope.key');
});

test('setLocale speaks a language only when a table exists', () => {
  setLocale('ru');
  assert.equal(hasLocale('ru'), false);
  assert.equal(t('cat.all'), 'All');
  setLocale('en');
});

test('LANGUAGES is the single language list', () => {
  assert.ok(LANGUAGES.length >= 12);
  assert.ok(isLanguage('de') && !isLanguage('xx'));
  assert.equal(LANGUAGES[0].code, 'en');
});

test('applyI18n fills data-i18n, -label and -placeholder', () => {
  const nodes = [];
  const mk = (data) => ({ dataset: data, textContent: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } });
  const a = mk({ i18n: 'cat.world' }); const b = mk({ i18nLabel: 'search.open' }); const c = mk({ i18nPlaceholder: 'search.placeholder' });
  const root = { querySelectorAll: (sel) => (sel === '[data-i18n]' ? [a] : sel === '[data-i18n-label]' ? [b] : [c]) };
  applyI18n(root);
  assert.equal(a.textContent, 'World');
  assert.equal(b.attrs['aria-label'], 'Search');
  assert.equal(c.attrs.placeholder, 'Search stories');
  assert.equal(catLabel('unknowncat'), 'UNKNOWNCAT');
  nodes.length = 0;
});
