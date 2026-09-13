import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installClientShims } from '../../helpers/client-shims.js';

// prefs.js reads storage once at import: seed BEFORE the (cache-busted) import
const load = async (raw, tag) => {
  const { storage } = installClientShims({ prefs: raw });
  const mod = await import(`../../../public/js/prefs.js?${tag}`);
  return { mod, storage };
};

test('defaults when storage is empty or corrupt', async () => {
  const { mod } = await load(undefined, 'a');
  assert.equal(mod.prefs.theme, 'auto');
  assert.equal(mod.prefs.targetLang, 'en');
  assert.equal(mod.prefs.forecast, true);
  assert.deepEqual(mod.prefs.saved, []);
  installClientShims();
  globalThis.localStorage.setItem('meridian:prefs', '{not json');
  const again = await import('../../../public/js/prefs.js?b');
  assert.equal(again.prefs.category, 'all');
});

test('sanitize coerces every field and drops unsafe saved urls', async () => {
  const { mod } = await load({
    theme: 'neon', gridSize: '9', autoTranslate: 'yes', feedSub: 'weird', hiddenSources: ['a', 3],
    saved: [{ id: 'x', title: 'ok', url: 'javascript:alert(1)' }, { id: 'y', title: 'fine', url: 'https://a/b', image: 'data:x' }],
    authorId: 'not-a-uuid', uiLocale: 'en', taste: { count: '4', sources: { a: 999 }, rated: ['zzz', '0123456789ab'] },
  }, 'c');
  const p = mod.prefs;
  assert.equal(p.theme, 'auto');
  assert.equal(p.gridSize, 2);
  assert.equal(p.autoTranslate, true);
  assert.equal(p.feedSub, 'recommended');
  assert.deepEqual(p.hiddenSources, ['a']);
  assert.deepEqual(p.saved, []);
  assert.equal(p.authorId, null);
  assert.ok(!('uiLocale' in p), 'legacy interface-language pref removed');
  assert.equal(p.taste.count, 4);
  assert.equal(p.taste.sources.a, 50);
  assert.deepEqual(p.taste.rated, ['0123456789ab']);
});

test('setPref, toggleSaved and ensureAuthorId persist', async () => {
  const { mod, storage } = await load(undefined, 'd');
  mod.setPref('targetLang', 'de');
  assert.equal(JSON.parse(storage.get('meridian:prefs')).targetLang, 'de');
  const article = { id: '0123456789ab', title: 't', url: 'https://a/b' };
  assert.equal(mod.toggleSaved(article), true);
  assert.equal(mod.isSaved(article.id), true);
  assert.equal(mod.toggleSaved(article), false);
  const id = mod.ensureAuthorId();
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(mod.ensureAuthorId(), id);
});
