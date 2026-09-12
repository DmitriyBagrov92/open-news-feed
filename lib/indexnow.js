// IndexNow: tell the search engines that share the protocol (Bing, Yandex,
// Seznam, Naver, Yep …) that the front page carries fresh headlines instead
// of waiting for their crawl schedule. One POST to the shared endpoint fans
// out to every participating engine. The site is one page, so this is a
// heartbeat, not a firehose: it fires only when the newest story changed
// since the last submission, and at most once per interval.

import * as log from './log.js';

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const KEY_RE = /^[a-zA-Z0-9-]{8,128}$/; // the protocol's key alphabet

export function indexNowKey(raw = process.env.INDEXNOW_KEY) {
  const key = String(raw || '').trim();
  return KEY_RE.test(key) ? key : null;
}

export function createIndexNow({
  key,
  origin,
  minIntervalMs = 60 * 60_000,
  endpoint = INDEXNOW_ENDPOINT,
  fetchImpl = globalThis.fetch,
}) {
  const host = new URL(origin).host;
  const url = `${origin}/`;
  const keyLocation = `${origin}/${key}.txt`;
  let lastLatestId = null;
  let lastSubmitAt = 0;
  let inFlight = false;
  let submissions = 0;

  async function submit(latestId) {
    inFlight = true;
    try {
      const res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host, key, keyLocation, urlList: [url] }),
        signal: AbortSignal.timeout(10_000),
      });
      await res.body?.cancel?.().catch?.(() => {});
      // 200 accepted · 202 accepted, key file still to be verified
      if (res.status === 200 || res.status === 202) {
        lastLatestId = latestId;
        lastSubmitAt = Date.now();
        submissions += 1;
        log.info('indexnow submitted', { status: res.status, url, latest_id: latestId });
        return true;
      }
      // 403 key not found in the key file · 422 url/host mismatch · 429 rate
      // limited — none of these fix themselves within a minute: wait a full
      // interval before trying again instead of hammering the endpoint.
      lastSubmitAt = Date.now();
      log.warn('indexnow rejected', { status: res.status, url, key_location: keyLocation });
      return false;
    } catch (err) {
      lastSubmitAt = Date.now(); // network trouble: next interval
      log.warn('indexnow failed', log.errorFields(err));
      return false;
    } finally {
      inFlight = false;
    }
  }

  return {
    // Call after every store refresh with the newest article id; resolves
    // true only when a submission was actually made.
    async notify(latestId) {
      if (!latestId || inFlight) return false;
      if (latestId === lastLatestId) return false; // nothing new on the page
      if (Date.now() - lastSubmitAt < minIntervalMs) return false;
      return submit(latestId);
    },
    stats: () => ({
      submissions,
      lastSubmitAt: lastSubmitAt ? new Date(lastSubmitAt).toISOString() : null,
    }),
  };
}
