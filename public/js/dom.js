// DOM builders. Feed-derived strings only ever pass through textContent /
// setAttribute — innerHTML is reserved for the static icon markup below.

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

const SVG_OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

// Static, trusted markup only.
const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.8-3.8"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/>',
  bookmark: '<path d="M19 21l-7-4.6L5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
  external: '<path d="M7 17 17 7"/><path d="M9 7h8v8"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/>',
  comment: '<path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"/>',
  up: '<path d="M12 19V6"/><path d="m5 12 7-7 7 7"/>',
  down: '<path d="M12 5v13"/><path d="m19 12-7 7-7-7"/>',
};

export function icon(name) {
  const tpl = document.createElement('template');
  tpl.innerHTML = SVG_OPEN + (ICONS[name] || '') + '</svg>';
  return tpl.content.firstElementChild;
}

export function iconButton(name, label, className = 'icon-btn') {
  const btn = el('button', { class: className, type: 'button', 'aria-label': label, title: label });
  btn.append(icon(name));
  return btn;
}
