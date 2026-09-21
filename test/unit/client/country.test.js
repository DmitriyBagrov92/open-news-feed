import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installClientShims } from '../../helpers/client-shims.js';

installClientShims();
const { registerSources, countryOf, countryName, flagUrl, buildFlag, buildByline, refreshBylines } = await import('../../../public/js/country.js');

test('countryOf: the article wins, the registry fills gaps, junk is never a code', () => {
  registerSources([{ id: 'bbc-world', country: 'GB' }, { id: 'gnews', country: null }]);
  assert.equal(countryOf({ id: 'x', country: 'QA' }), 'QA');
  assert.equal(countryOf({ id: 'x', country: null }), null, 'explicitly international');
  assert.equal(countryOf({ id: 'bbc-world' }), 'GB', 'a story saved before the field existed');
  assert.equal(countryOf({ id: 'gnews' }), null);
  assert.equal(countryOf({ id: 'gone' }), undefined, 'unknown for now');
  assert.equal(countryOf(null), undefined);
  // the code becomes part of a URL — localStorage is user-writable
  for (const bad of ['../x', 'gb', 'GBR', '<b>', 7]) assert.equal(countryOf({ id: 'x', country: bad }), null);
});

test('names and flag urls', () => {
  assert.equal(countryName('GB'), 'United Kingdom');
  assert.equal(countryName('EU'), 'European Union');
  assert.equal(countryName('UN'), 'United Nations');
  assert.equal(countryName(null), 'International');
  assert.equal(flagUrl('GB'), 'flags/gb.svg');
});

test('buildFlag: a lazy decorative image, or the globe where there is no country', () => {
  const img = buildFlag('JP');
  assert.equal(img.tagName.toLowerCase(), 'img');
  assert.equal(img.getAttribute('src'), 'flags/jp.svg');
  assert.equal(img.getAttribute('alt'), '');
  assert.equal(img.getAttribute('loading'), 'lazy');
  assert.ok(img.getAttribute('width') && img.getAttribute('height'), 'sized: no layout shift');
  const globe = buildFlag(null);
  assert.equal(globe.tagName.toLowerCase(), 'svg');
  assert.ok(globe.classList.contains('flag--intl'));
});

test('buildByline: flag · source · country, and the source class is kept', () => {
  const node = buildByline({ id: 'aljazeera', name: 'Al Jazeera', country: 'QA' }, { srcClass: 'card-src' });
  assert.equal(node.dataset.cc, 'QA');
  assert.equal(node.querySelector('.flag').getAttribute('src'), 'flags/qa.svg');
  assert.equal(node.querySelector('.card-src').textContent, 'Al Jazeera');
  assert.equal(node.querySelector('.byline-country').textContent, 'Qatar');
  assert.equal(node.querySelector('.byline-country').hasAttribute('hidden'), false);
  assert.equal(node.title, 'Al Jazeera · Qatar');
  const intl = buildByline({ id: 'gnews', name: 'GNews', country: null });
  assert.equal(intl.dataset.cc, 'intl');
  assert.equal(intl.querySelector('.byline-country').textContent, 'International');
});

test('a pending byline is completed once the registry arrives', () => {
  registerSources([]);
  const node = buildByline({ id: 'tass', name: 'TASS' }); // no country on a story saved long ago
  assert.ok('pending' in node.dataset);
  assert.equal(node.querySelector('.flag'), null);
  assert.ok(node.querySelector('.byline-country').hasAttribute('hidden'));
  const root = document.createElement('div');
  root.append(node);
  registerSources([{ id: 'tass', country: 'RU' }]);
  refreshBylines(root);
  assert.equal('pending' in node.dataset, false);
  assert.equal(node.dataset.cc, 'RU');
  assert.equal(node.querySelector('.byline-country').textContent, 'Russia');
  assert.equal(node.querySelector('.flag').getAttribute('src'), 'flags/ru.svg');
});
