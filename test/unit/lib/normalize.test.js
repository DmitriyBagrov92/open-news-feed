import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeEntities, stripHtml, clampText, normalizeUrl, articleId, detach, firstImgSrc } from '../../../lib/normalize.js';

test('decodeEntities handles named, numeric and double-encoded entities', () => {
  assert.equal(decodeEntities('Tom &amp; Jerry &#39;live&#39; &#x2014; &ndash;'), "Tom & Jerry 'live' — –");
  assert.equal(decodeEntities('&amp;#39;'), "'"); // numerics get a second pass
  assert.equal(decodeEntities('&amp;amp;'), '&amp;'); // named do not
  assert.equal(decodeEntities('&unknown;'), '&unknown;');
});

test('stripHtml drops tags, scripts, CDATA and "null" placeholders', () => {
  assert.equal(stripHtml('<p>Hi <b>there</b><script>x()</script></p>'), 'Hi there');
  assert.equal(stripHtml('<![CDATA[wrapped]]>'), 'wrapped');
  assert.equal(stripHtml('null'), '');
  assert.equal(stripHtml(null), '');
});

test('clampText cuts on a word boundary with an ellipsis inside the budget', () => {
  const out = clampText('one two three four five six', 15);
  assert.ok(out.length <= 15, out);
  assert.ok(out.endsWith('…'));
  assert.equal(clampText('short', 15), 'short');
});

test('normalizeUrl canonicalises for dedupe', () => {
  assert.equal(normalizeUrl('HTTPS://WWW.Example.com/Path/?utm_source=x&b=2&a=1#frag'), 'https://www.example.com/Path?b=2&a=1');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com');
  assert.equal(normalizeUrl('ftp://example.com/x'), null);
  assert.equal(normalizeUrl('nope'), null);
});

test('articleId is a stable 12-hex sha1 of the normalized url', () => {
  const id = articleId('https://example.com/a');
  assert.match(id, /^[0-9a-f]{12}$/);
  assert.equal(id, articleId('https://example.com/a'));
});

test('detach returns an equal string that owns its bytes', () => {
  const big = 'x'.repeat(1000) + 'tail';
  const slice = big.slice(990);
  assert.equal(detach(slice), slice);
  assert.equal(detach('short'), 'short');
  assert.equal(detach(42), 42);
});

test('firstImgSrc accepts absolute and protocol-relative sources only', () => {
  assert.equal(firstImgSrc('<p><img src="https://a/b.jpg"></p>'), 'https://a/b.jpg');
  assert.equal(firstImgSrc('<img src="//cdn/x.png">'), 'https://cdn/x.png');
  assert.equal(firstImgSrc('<img src="/rel.png">'), null);
  assert.equal(firstImgSrc(''), null);
});
