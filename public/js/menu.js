// A glass context menu: long-press (or right-click) on a story row opens
// it near the pointer. One menu at a time; a tap outside, Escape or a
// scroll closes it. Items are plain buttons — keyboard reachable.

import { el, icon } from './dom.js';

let open = null; // { root, cleanup }

export function closeMenu() {
  if (!open) return;
  open.cleanup();
  open.root.remove();
  open = null;
}

// items: [{ icon, label, onSelect, danger? }]
export function showMenu({ x, y, items, label = 'Actions', returnFocus = null }) {
  closeMenu();
  const root = el('div', { class: 'ctxmenu glass', role: 'menu', 'aria-label': label, 'data-testid': 'ctxmenu' });
  for (const item of items) {
    const btn = el('button', {
      class: 'ctxmenu-item' + (item.danger ? ' is-danger' : ''),
      type: 'button',
      role: 'menuitem',
      'data-testid': 'ctxmenu-item',
    });
    btn.append(icon(item.icon), el('span', { text: item.label }));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenu();
      item.onSelect?.();
    });
    root.append(btn);
  }
  document.body.append(root);

  // place inside the viewport, near the pointer
  const pad = 12;
  const { width, height } = root.getBoundingClientRect();
  const left = Math.max(pad, Math.min(x - width / 2, innerWidth - width - pad));
  const top = y + height + pad > innerHeight ? Math.max(pad, y - height - 12) : y + 12;
  root.style.left = left + 'px';
  root.style.top = top + 'px';
  requestAnimationFrame(() => root.classList.add('is-on'));

  const onDown = (e) => {
    if (!root.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
      returnFocus?.focus?.();
    }
  };
  const onScroll = () => closeMenu();
  // the opening pointer is still down: listen from the next tick
  setTimeout(() => {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, { passive: true, once: true });
  }, 0);
  open = {
    root,
    cleanup() {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll);
    },
  };
  root.querySelector('button')?.focus({ preventScroll: true });
  return root;
}
