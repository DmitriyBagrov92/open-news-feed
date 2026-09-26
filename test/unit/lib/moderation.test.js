import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenComment, normalizeForScreen } from '../../../lib/moderation.js';
import { describeReport, notifyModeration } from '../../../lib/notify.js';

const refused = (text) => screenComment(text);

test('screen: slurs are refused, disguised or not', () => {
  for (const text of ['you faggot', 'F4GG0T', 'faggggot', 'k . i . k . e', 'n-i-g-g-e-r scum', 'niggaz', 'Spics out']) {
    assert.deepEqual(refused(text), { ok: false, reason: 'slur' }, text);
  }
});

test('screen: explicit threats and incitement to self-harm are refused', () => {
  for (const text of ["I'll kill you", 'kys', 'Kill   yourself now', 'I am going to kill you', 'heil hitler']) {
    assert.deepEqual(refused(text), { ok: false, reason: 'threat' }, text);
  }
});

test('screen: link floods and character floods are refused', () => {
  assert.deepEqual(refused('buy https://a.example https://b.example www.c.example'), { ok: false, reason: 'links' });
  assert.deepEqual(refused('a'.repeat(40)), { ok: false, reason: 'flood' });
});

test('screen: news talk, place names and heated language pass', () => {
  for (const text of [
    'Tariffs will hit Niger and Nigeria hardest',
    'A chink in the armour of the coalition',
    'Pakistan and India resume border talks',
    'This debt is gonna kill you slowly',
    'What a stupid, damn decision',
    'Spices and spicy food, spiced wine',
    'The Scunthorpe problem, again',
    'Read https://a.example and https://b.example',
    'Kyiv skyline at dawn',
  ]) {
    assert.deepEqual(refused(text), { ok: true }, text);
  }
});

test('normalizeForScreen reads digits and symbols as letters, drops marks and apostrophes', () => {
  assert.equal(normalizeForScreen("Ça $3ra l'@ffaire"), 'ca sera laffaire');
});

test('the moderation webhook: Slack/Discord text plus the event, only when configured', async () => {
  const event = {
    commentId: 'c'.repeat(16), articleId: 'a'.repeat(12), authorKey: 'f'.repeat(16),
    body: 'spam spam', reason: 'spam', reports: 3, hidden: true, newlyHidden: true,
  };
  assert.match(describeReport(event), /reported as spam \(3 reports\) — now hidden/);
  delete process.env.MODERATION_WEBHOOK_URL;
  assert.equal(notifyModeration(event, { fetchImpl: () => assert.fail('no webhook configured') }), null);
  process.env.MODERATION_WEBHOOK_URL = 'https://hooks.example/moderation';
  let sent = null;
  await notifyModeration(event, {
    fetchImpl: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return { ok: true };
    },
  });
  delete process.env.MODERATION_WEBHOOK_URL;
  assert.equal(sent.url, 'https://hooks.example/moderation');
  assert.equal(sent.body.text, sent.body.content);
  assert.equal(sent.body.event.type, 'comment.reported');
  assert.equal(sent.body.event.reports, 3);
});
