import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter } from '../../../lib/ratelimit.js';

test('fixed window: limit hits per key, keys are independent', () => {
  const allow = createLimiter({ limit: 3, windowMs: 60_000 });
  assert.deepEqual([allow('a'), allow('a'), allow('a'), allow('a')], [true, true, true, false]);
  assert.equal(allow('b'), true);
});

test('RATE_LIMIT_DISABLED=1 turns every limiter into a pass', () => {
  process.env.RATE_LIMIT_DISABLED = '1';
  const allow = createLimiter({ limit: 1 });
  delete process.env.RATE_LIMIT_DISABLED;
  assert.deepEqual([allow('a'), allow('a'), allow('a')], [true, true, true]);
});
