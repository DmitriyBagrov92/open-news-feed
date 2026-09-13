// Fixture mode (FEED_FIXTURE): the server must never reach the network.
// This swaps the global fetch — the only outbound path every module uses —
// for a stub that serves fixture pages to article extraction, answers the
// free translation fallback deterministically and refuses everything else.
// Imported by server.js only when FEED_FIXTURE is set.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function installFetchStub({ pagesDir }) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
    // the test process talks to its own in-process server over loopback
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]') {
      return realFetch(input, init);
    }
    // article pages: https://<allowlisted host>/fixture/<slug> → pages/<slug>.html
    const page = url.pathname.match(/^\/fixture\/([a-z0-9-]+)$/);
    if (page) {
      try {
        const html = await readFile(path.join(pagesDir, page[1] + '.html'), 'utf8');
        return new Response(html, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
      } catch {
        return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
    }
    // translation fallback: echo the text tagged with the target language
    if (url.hostname === 'api.mymemory.translated.net') {
      const q = url.searchParams.get('q') || '';
      const target = (url.searchParams.get('langpair') || 'en|xx').split('|')[1];
      return Response.json({ responseStatus: 200, responseData: { translatedText: `[${target}] ${q}` } });
    }
    throw new Error(`network disabled in fixture mode: ${url.host}`);
  };
}
