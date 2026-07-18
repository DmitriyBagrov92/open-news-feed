// Time is the protagonist: wire-strip clocks, relative timestamps and the
// freshness state that drives the card dots.

import { t } from './i18n.js';

const MIN = 60000;
const HOUR = 60 * MIN;

// 'live' <1h (pulsing red) · 'recent' <6h (meridian blue) · 'stale' otherwise.
export function freshness(iso, now = Date.now()) {
  const age = now - Date.parse(iso);
  if (age < HOUR) return 'live';
  if (age < 6 * HOUR) return 'recent';
  return 'stale';
}

export function relTime(iso, now = Date.now()) {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const minutes = Math.floor(Math.max(0, now - ts) / MIN);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.min', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return t('time.hr');
  if (hours < 24) return t('time.hrs', { n: hours });
  const days = Math.floor(hours / 24);
  return days === 1 ? t('time.day') : t('time.days', { n: days });
}

const absFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export function absTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : absFmt.format(date);
}

// Live clocks in the wire strip; [data-tz] marks a clock, [data-seconds]
// adds a seconds field (UTC only).
export function initWireClocks(root) {
  const clocks = [...root.querySelectorAll('[data-tz]')].map((node) => ({
    node,
    fmt: new Intl.DateTimeFormat('en-GB', {
      timeZone: node.dataset.tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(node.hasAttribute('data-seconds') ? { second: '2-digit' } : {}),
    }),
  }));
  const tick = () => {
    const now = new Date();
    for (const { node, fmt } of clocks) node.textContent = fmt.format(now);
  };
  tick();
  setInterval(tick, 1000);
}

// Re-renders every visible relative timestamp and its freshness dot.
// Called every 30s so the page feels alive.
export function refreshTimes(root = document) {
  const now = Date.now();
  for (const timeEl of root.querySelectorAll('time[data-published]')) {
    const iso = timeEl.dataset.published;
    timeEl.textContent = relTime(iso, now);
    const dot = timeEl.closest('.card-meta')?.querySelector('.dot');
    if (dot) dot.className = 'dot dot--' + freshness(iso, now);
  }
}
