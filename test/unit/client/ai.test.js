import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installClientShims } from '../../helpers/client-shims.js';

installClientShims();
const ai = await import('../../../public/js/ai.js');

const A = (id, title, description, source = 'ESPN') => ({ id, title, description, source, publishedAt: new Date().toISOString() });
const F = (headline, basis, timeframe = '7d', why = '') => ({ headline, why, timeframe, confidence: 'low', basis });

test('extractive summary keeps the highest-scoring sentences in order', () => {
  const s = ['Cats sleep a lot.', 'Dogs run in the park every day.', 'Dogs and cats both love the park.', 'Nothing here.'];
  const out = ai.extractive(s, 2);
  assert.equal(out.length, 2);
  assert.equal(s.indexOf(out[0]) < s.indexOf(out[1]), true);
  assert.deepEqual(ai.splitSentences('One. Two! Three?'), ['One.', 'Two!', 'Three?']);
  assert.deepEqual(ai.toBullets('- a\n• b\nc'), ['a', 'b', 'c']);
});

test('entityTokens is unicode-aware and skips stopwords/lowercase', () => {
  const toks = ai.entityTokens('Верховный суд и Supreme Court ruling on the tariffs');
  assert.ok(toks.has('верховный') && toks.has('supreme court') && toks.has('supreme'), [...toks.keys()].join(','));
  assert.ok(!toks.has('tariffs') && !toks.has('the'));
});

test('forecastability counts upcoming-event cues', () => {
  assert.ok(ai.forecastability({ title: 'Shelton sets up US Open final against Alcaraz on Sunday', description: '' }) >= 2);
  assert.equal(ai.forecastability({ title: 'Wrexham suffer heaviest loss', description: 'A 6-0 rout.' }), 0);
});

test('sanitizeForecast grounds, dedupes, drops echoes, clichés and example leaks', () => {
  const articles = [
    A('a0', 'Trump says Iran probably responsible for attack on Saudi pipeline', 'Trump told reporters that Iran was likely behind the strike.', 'BBC'),
    A('a1', 'Ben Shelton’s shot at history comes Sunday in the US Open final', 'Can Shelton become the first American man to win since 2003?'),
    A('a2', 'Fed expected to hold rates at 4.25% this week', 'Markets price a hold at Wednesday’s FOMC meeting.', 'CNBC'),
    A('a3', 'Man United eye Bournemouth defender Truffert', 'Manchester United are interested in Adrien Truffert to replace Luke Shaw.'),
    A('a4', 'Europe builds 7-5 lead at Solheim Cup', 'Team Europe took down the US pairs.'),
    A('a5', 'Sources: Bears, Swift agree to $33.75M extension', 'The Chicago Bears and RB Swift agreed a deal.'),
  ];
  const raw = JSON.stringify({ forecasts: [
    F('Port Averly officials assess storm damage Sunday', [0], '3d', 'Storm Kestrel is forecast to make landfall.'),
    F('Taiwanese officials to assess typhoon damage Sunday', [0], '3d', 'A Sunday assessment follows.'),
    F('Sources: Bears, Swift agree to $33.75M extension — The Chicago Bears and RB', [5], '24h', 'copied'),
    F('Shelton beats Sinner in Sunday’s US Open final', [1], '48h', 'Shelton plays the final on Sunday.'),
    F('Fed holds rates at 4.25% at Wednesday’s FOMC meeting', [2], '3d', 'Markets price a hold.'),
    F('Truffert signs for Man United before the window closes', [3], '7d', 'United want him to replace Shaw.'),
    F('Europe wins the Solheim Cup on Sunday', [4], '48h', 'Europe leads 7-5.'),
  ] });
  const out = ai.sanitizeForecast('```json\n' + raw + '\n```', articles, Date.parse('2026-09-12T00:00:00Z'));
  const titles = out.map((f) => f.headline);
  assert.ok(!titles.some((t) => /Averly|Taiwanese|Sources: Bears/.test(t)), titles.join(' | '));
  assert.equal(out.length, 4);
  assert.deepEqual(out.map((f) => f.timeframe), ['48h', '48h', '3d', '7d']);
  assert.deepEqual(out[0].basis, ['a1']);
  assert.equal(out[0].dueAt, new Date(Date.parse('2026-09-12T00:00:00Z') + 48 * 3600000).toISOString());
  assert.throws(() => ai.sanitizeForecast('not json', articles), /forecast.error/);
  assert.throws(() => ai.sanitizeForecast(JSON.stringify({ forecasts: [F('Situation evolves as talks continue', [0]), F('Trump says Iran probably responsible for attack on Saudi pipeline', [0])] }), articles), /forecast.abstract/);
  assert.throws(() => ai.sanitizeForecast(JSON.stringify({ forecasts: [F('Fed holds rates on Wednesday', [2])] }), articles), /forecast.tooFew/);
});

test('mock provider yields four grounded forecasts without a model', async () => {
  installClientShims({ search: '?forecast=mock' });
  const fresh = await import('../../../public/js/ai.js?mock');
  assert.equal(await fresh.forecastAvailability(), 'available');
  const articles = Array.from({ length: 6 }, (_, i) => A('m' + i, 'Headline number ' + i + ' about things', ''));
  const gen = await fresh.generateForecast({ articles, outLang: 'en' });
  assert.equal(gen.provider, 'mock');
  assert.equal(gen.forecasts.length, 4);
  assert.ok(gen.forecasts.every((f) => f.basis.length === 1 && f.dueAt));
  installClientShims();
  assert.equal(await (await import('../../../public/js/ai.js?nomodel')).forecastAvailability(), 'unavailable');
});
