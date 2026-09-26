// Fixed-window in-memory rate limiter factory. Each caller gets its own
// bucket space, so e.g. comment posting cannot exhaust the AI routes'
// budget and vice versa.

// allow(key) → boolean; allow.retryAfter(key) → whole seconds until the key's
// window resets (the Retry-After of a 429).
export function createLimiter({ limit, windowMs = 60_000 }) {
  // RATE_LIMIT_DISABLED=1: the end-to-end suite opens dozens of previews
  // a minute from one address; production never sets it.
  if (process.env.RATE_LIMIT_DISABLED === '1') return Object.assign(() => true, { retryAfter: () => 0 });
  const hits = new Map(); // key → { count, windowStart }

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now - entry.windowStart >= windowMs) hits.delete(key);
    }
  }, windowMs);
  sweep.unref();

  function allow(key) {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  }
  allow.retryAfter = (key) => {
    const entry = hits.get(key);
    if (!entry) return 0;
    return Math.max(1, Math.ceil((entry.windowStart + windowMs - Date.now()) / 1000));
  };
  return allow;
}
