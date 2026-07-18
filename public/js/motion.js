// Thin facade over the vendored Motion framework (public/vendor/motion.js,
// UMD build → window.Motion). Every helper is a no-op when the library is
// missing or the user prefers reduced motion, so callers never branch.

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

function lib() {
  return !reduced.matches && typeof window !== 'undefined' ? window.Motion : null;
}

export const EASE_OUT = [0.22, 1, 0.36, 1];

// Staggered entrance for a batch of cards. Only the first screenful gets
// the stagger — a 30-card tail of delays reads as lag, not polish.
export function animateIn(elements) {
  const m = lib();
  const list = [...elements];
  if (!m || !list.length) return;
  const staggered = list.slice(0, 12);
  m.animate(
    staggered,
    { opacity: [0, 1], transform: ['translateY(12px)', 'translateY(0)'] },
    { duration: 0.45, delay: m.stagger(0.04, { startDelay: 0.02 }), ease: EASE_OUT }
  );
  if (list.length > 12) {
    m.animate(list.slice(12), { opacity: [0, 1] }, { duration: 0.3, ease: 'easeOut' });
  }
}

// Dialog / drawer entrance.
export function animateDialog(element) {
  const m = lib();
  if (!m || !element) return;
  m.animate(
    element,
    { opacity: [0, 1], transform: ['translateY(12px) scale(0.985)', 'translateY(0) scale(1)'] },
    { duration: 0.32, ease: EASE_OUT }
  );
}

// Springy pop for the new-stories pill.
export function animatePop(element) {
  const m = lib();
  if (!m || !element) return;
  m.animate(
    element,
    { opacity: [0, 1], transform: ['translate(-50%, -10px) scale(0.9)', 'translate(-50%, 0) scale(1)'] },
    { type: 'spring', stiffness: 500, damping: 28 }
  );
}

// Soft reveal for expanding panels (daily brief, summaries).
export function animateReveal(element) {
  const m = lib();
  if (!m || !element) return;
  m.animate(element, { opacity: [0, 1], transform: ['translateY(-6px)', 'translateY(0)'] }, {
    duration: 0.3,
    ease: EASE_OUT,
  });
}
