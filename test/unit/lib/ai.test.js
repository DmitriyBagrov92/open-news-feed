import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText, summarize, translateTexts, PremiumOnlyError, NoProviderError } from '../../../lib/ai.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

test('chunkText packs sentences under the limit and hard-splits monsters', () => {
  const text = 'One sentence here. Another one follows! A third? ' + 'word '.repeat(120).trim();
  const chunks = chunkText(text, 60);
  assert.ok(chunks.every((c) => c.length <= 60), chunks.map((c) => c.length));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '));
  assert.deepEqual(chunkText('tiny', 60), ['tiny']);
});

test('summarize is premium-only in the free version', async () => {
  await assert.rejects(summarize({ mode: 'brief' }), PremiumOnlyError);
});

test('translateTexts falls through to MyMemory and validates its answer', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const q = new URL(url).searchParams.get('q');
    return { ok: true, json: async () => ({ responseStatus: '200', responseData: { translatedText: '[de] ' + q } }) };
  };
  const out = await translateTexts(['Hello', 'World'], 'de', 'en');
  assert.deepEqual(out, { translations: ['[de] Hello', '[de] World'], provider: 'mymemory' });
  assert.equal(calls.length, 2);

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ responseStatus: 403, responseData: { translatedText: 'MYMEMORY WARNING: quota' } }) });
  await assert.rejects(translateTexts(['x'], 'de'), NoProviderError);
});
