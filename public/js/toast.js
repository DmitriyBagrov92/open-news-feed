// Tiny toast helper for transient status messages.

import { el } from './dom.js';

let region = null;

export function toast(message, duration = 3500) {
  if (!region) {
    region = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const item = el('div', { class: 'toast', text: message });
  region.append(item);
  requestAnimationFrame(() => item.classList.add('toast--in'));
  setTimeout(() => {
    item.classList.remove('toast--in');
    setTimeout(() => item.remove(), 300);
  }, duration);
}
