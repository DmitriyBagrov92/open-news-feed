// DOM builders. Feed-derived strings only ever pass through textContent /
// setAttribute — no innerHTML anywhere. Icons come from the inline sprite
// in index.html (<symbol id="i-…">) via <use>, so the same stroked glyph
// serves static markup and everything built here.

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child != null) node.append(child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

// sprite ids for the names the app has always used
const ICONS = {
  search: 'i-search',
  globe: 'i-globe',
  bookmark: 'i-bookmark',
  external: 'i-external',
  close: 'i-close',
  sparkle: 'i-sparkle',
  comment: 'i-comment',
  up: 'i-up',
  down: 'i-down',
  prev: 'i-prev',
  next: 'i-next',
  share: 'i-share',
  gear: 'i-gear',
  refresh: 'i-refresh',
  heart: 'i-heart',
};

export function icon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  const href = '#' + (ICONS[name] || 'i-' + name);
  use.setAttribute('href', href);
  use.setAttributeNS(XLINK_NS, 'xlink:href', href); // older WebKit
  svg.append(use);
  return svg;
}

export function iconButton(name, label, className = 'icon-btn') {
  const btn = el('button', { class: className, type: 'button', 'aria-label': label, title: label });
  btn.append(icon(name));
  return btn;
}

// Page scroll lock for overlays. body.style.overflow stays the app-wide
// "something modal is open" signal (forecast.js reads it); html.is-locked
// stops rubber-banding behind sheets on iOS.
export function lockScroll() {
  document.body.style.overflow = 'hidden';
  document.documentElement.classList.add('is-locked');
}

export function unlockScroll() {
  document.body.style.overflow = '';
  document.documentElement.classList.remove('is-locked');
}
