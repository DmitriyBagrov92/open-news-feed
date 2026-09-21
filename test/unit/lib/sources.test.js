import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { RSS_SOURCES, API_SOURCES } from '../../../config/sources.js';

const all = [
  ...Object.entries(RSS_SOURCES).flatMap(([lang, list]) => list.map((s) => ({ ...s, lang }))),
  ...API_SOURCES,
];
// Aggregators have no home. Anything else must name a country, or a UN M.49
// region for a pan-regional service — a new source can never ship without
// telling the reader whose voice it is.
const INTERNATIONAL = new Set(['gnews', 'newsdata', 'currents']);
const ALPHA2 = /^[A-Z]{2}$/;

test('every source declares where its publisher is based', () => {
  for (const s of all) {
    assert.ok('country' in s, `${s.id}: missing the country field`);
    if (INTERNATIONAL.has(s.id)) assert.equal(s.country, null, `${s.id} is listed as international`);
    else assert.match(String(s.country), /^([A-Z]{2}|\d{3})$/, `${s.id}: country must be ISO 3166-1 alpha-2 or a UN M.49 region`);
  }
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  for (const code of new Set(all.map((s) => s.country).filter(Boolean))) {
    assert.notEqual(names.of(code), code, `${code} is not a region the platform can name`);
  }
});

test('every country in the registry has its flag vendored (npm run vendor:flags)', async () => {
  const codes = [...new Set(all.map((s) => s.country).filter((c) => ALPHA2.test(c || '')))];
  assert.ok(codes.length >= 15);
  for (const code of codes) {
    const file = new URL(`../../../public/flags/${code.toLowerCase()}.svg`, import.meta.url);
    await assert.doesNotReject(access(file), `public/flags/${code.toLowerCase()}.svg is missing`);
  }
});

test('the partisan battle outlets are English-language sources', () => {
  const battle = all.filter((s) => s.battleOnly);
  assert.ok(battle.length >= 10);
  assert.deepEqual([...new Set(battle.map((s) => s.lang))], ['en']);
  assert.deepEqual(RSS_SOURCES.zh.map((s) => s.id), ['bbc-zhongwen', 'dw-chinese']);
});

test('a few well-known homes, so a bulk edit cannot silently scramble them', () => {
  const byId = new Map(all.map((s) => [s.id, s.country]));
  const expected = { allafrica: '002', 'bbc-world': 'GB', aljazeera: 'QA', tass: 'RU', cgtn: 'CN', scmp: 'HK', 'npr-world': 'US', 'dw-world': 'DE', meduza: 'LV', euronews: 'EU', who: 'UN', 'fox-news': 'US' };
  for (const [id, code] of Object.entries(expected)) assert.equal(byId.get(id), code, id);
});
