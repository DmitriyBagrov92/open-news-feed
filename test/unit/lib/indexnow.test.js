import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createIndexNow, indexNowKey } from '../../../lib/indexnow.js';

test('indexNowKey validates the protocol alphabet', () => {
  assert.equal(indexNowKey('abc'), null);
  assert.equal(indexNowKey(' 0123456789abcdef '), '0123456789abcdef');
  assert.equal(indexNowKey('bad key!'), null);
});

test('notify pings once per new top story per interval and backs off on rejection', async () => {
  const calls = [];
  let status = 202;
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (status === 'boom') throw new Error('ECONNRESET');
    return { status, body: { cancel: async () => {} } };
  };
  const now = createIndexNow({ key: 'k0123456789', origin: 'https://meridi.info', minIntervalMs: 50, fetchImpl });
  assert.equal(await now.notify(null), false);
  assert.equal(await now.notify('aaa'), true);
  assert.deepEqual(calls[0].body, {
    host: 'meridi.info', key: 'k0123456789', keyLocation: 'https://meridi.info/k0123456789.txt', urlList: ['https://meridi.info/'],
  });
  assert.equal(await now.notify('aaa'), false);
  assert.equal(await now.notify('bbb'), false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(await now.notify('bbb'), true);
  status = 403;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(await now.notify('ccc'), false);
  assert.equal(await now.notify('ccc'), false);
  status = 'boom';
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(await now.notify('ddd'), false);
  assert.equal(now.stats().submissions, 2);
});
