// Whose voice is this? Every source carries the ISO 3166-1 alpha-2 code of
// the country its publisher is based in (config/sources.js → article.source
// .country). This module turns the code into a round flag and a country name
// in the interface language — the "byline" shown next to the source on
// cells, in the story header, the tooltip, the onboarding card and Settings.
//
//   country === 'GB'       a flag + "United Kingdom"
//   country === '002'      a UN M.49 region (pan-regional service): a globe + "Africa"
//   country === null       no home at all (aggregators): a globe + "International"
//   country === undefined  not known yet — a story saved before this field
//                          existed; filled in once /api/sources has loaded

import { el, icon } from './dom.js';
import { t, hasLocale } from './i18n.js';
import { prefs } from './prefs.js';

const CODE_RE = /^[A-Z]{2}$/; // the code becomes part of a URL: accept nothing else
const REGION_RE = /^\d{3}$/; // UN M.49 region: named, never fetched
const valid = (code) => (typeof code === 'string' && (CODE_RE.test(code) || REGION_RE.test(code)) ? code : null);
const byId = new Map(); // source id → code | null, from /api/sources
const displayNames = new Map(); // locale → Intl.DisplayNames | null

// The registry, once loaded: the fallback for articles that carry no code.
export function registerSources(list) {
  byId.clear();
  for (const source of list || []) {
    if (source?.id) byId.set(source.id, valid(source.country));
  }
}

// 'GB' | '002' | null (international) | undefined (unknown for now)
export function countryOf(source) {
  if (!source) return undefined;
  if ('country' in source) return valid(source.country);
  return byId.has(source.id) ? byId.get(source.id) : undefined;
}

// the interface speaks the chosen language only where a table for it exists
const locale = () => (hasLocale(prefs.targetLang) ? prefs.targetLang : 'en');

export function countryName(code) {
  if (!code) return t('country.international');
  if (REGION_RE.test(code)) {
    // engines disagree on naming UN regions (Chromium: '002' → '002'): own table
    const key = 'region.' + code;
    const name = t(key);
    return name === key ? code : name;
  }
  const loc = locale();
  if (!displayNames.has(loc)) {
    let names = null;
    try {
      names = new Intl.DisplayNames([loc], { type: 'region' });
    } catch {
      names = null; // very old engines: the code itself stands in
    }
    displayNames.set(loc, names);
  }
  try {
    return displayNames.get(loc)?.of(code) || code;
  } catch {
    return code;
  }
}

export const flagUrl = (code) => `flags/${code.toLowerCase()}.svg`;

// A round flag, or the globe glyph where there is no single country
// (a region or an aggregator).
export function buildFlag(code) {
  const globe = () => {
    const glyph = icon('globe');
    glyph.classList.add('flag', 'flag--intl');
    return glyph;
  };
  if (!code || !CODE_RE.test(code)) return globe();
  const img = el('img', {
    class: 'flag',
    src: flagUrl(code),
    alt: '', // the country name stands next to it as text
    width: '16',
    height: '16',
    loading: 'lazy',
    decoding: 'async',
    draggable: 'false',
  });
  img.addEventListener('error', () => img.replaceWith(globe()), { once: true });
  return img;
}

function fill(node, code) {
  const name = countryName(code);
  node.querySelector('.flag')?.remove();
  node.prepend(buildFlag(code));
  const country = node.querySelector('.byline-country');
  country.textContent = name;
  country.hidden = false;
  node.dataset.cc = code || 'intl';
  delete node.dataset.pending;
  const src = node.querySelector('.byline-src')?.textContent || '';
  node.title = [src, name].filter(Boolean).join(' · ');
}

// flag · source name · country. `srcClass` lets a surface keep its own
// class on the name (cards keep `.card-src`, whose text stays the bare name).
export function buildByline(source, { srcClass = '' } = {}) {
  const node = el('span', { class: 'byline', 'data-source': source?.id || '' });
  node.append(
    el('span', { class: ('byline-src ' + srcClass).trim(), text: source?.name || '' }),
    el('span', { class: 'byline-country', hidden: true })
  );
  const code = countryOf(source);
  if (code === undefined) node.dataset.pending = '';
  else fill(node, code);
  return node;
}

// Late data and language changes: resolve pending bylines through the
// registry and re-name the rest in the current interface language.
export function refreshBylines(root = document) {
  for (const node of root.querySelectorAll('.byline')) {
    if ('pending' in node.dataset) {
      const id = node.dataset.source;
      if (byId.has(id)) fill(node, byId.get(id));
      continue;
    }
    const code = node.dataset.cc === 'intl' ? null : node.dataset.cc;
    const name = countryName(code);
    const country = node.querySelector('.byline-country');
    if (country && country.textContent !== name) {
      country.textContent = name;
      const src = node.querySelector('.byline-src')?.textContent || '';
      node.title = [src, name].filter(Boolean).join(' · ');
    }
  }
}
