// Minimal browser globals so the pure client modules load under node:test.
// linkedom (already a production dependency) provides a real DOM for the
// element builders; everything else is the smallest stub the modules touch
// at import time: ai.js registers a `pagehide` listener on window, motion.js
// asks matchMedia, prefs.js reads localStorage.
import { parseHTML } from 'linkedom';

export function installClientShims({ prefs, search = '' } = {}) {
  const { window: w, document } = parseHTML('<!doctype html><html><head></head><body></body></html>');
  globalThis.document = document;
  globalThis.HTMLElement = w.HTMLElement;
  globalThis.CustomEvent = w.CustomEvent;
  globalThis.self = globalThis;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  globalThis.location = { search, href: 'http://localhost/' + search };
  const store = new Map();
  if (prefs !== undefined) store.set('meridian:prefs', JSON.stringify(prefs));
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return { document, storage: store };
}
