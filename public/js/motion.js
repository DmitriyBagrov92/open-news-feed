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

// FLIP zoom: the element appears to grow out of fromRect (a grid card).
// The "from" state is set inline BEFORE animating so there is no one-frame
// flash of the full-size dialog. Resolves when done; undefined when no lib.
export function animateZoomFrom(element, fromRect) {
  const m = lib();
  if (!m || !element || !fromRect) return;
  const to = element.getBoundingClientRect();
  if (!to.width || !to.height) return;
  const dx = fromRect.left - to.left;
  const dy = fromRect.top - to.top;
  const sx = fromRect.width / to.width;
  const sy = fromRect.height / to.height;
  element.style.transformOrigin = '0 0';
  element.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
  element.style.opacity = '0';
  // transform and opacity run as two animations: the vendored build is
  // happier than with per-value options, and the fast opacity ramp masks
  // the aspect-ratio distortion of the non-uniform scale. The identity
  // target must be spelled out — the build parses 'none' as a zero matrix.
  const move = m.animate(
    element,
    { transform: 'translate(0px, 0px) scale(1, 1)' },
    { duration: 0.42, ease: EASE_OUT }
  );
  m.animate(element, { opacity: 1 }, { duration: 0.2, ease: 'linear' });
  // cleanup two frames after finish: Motion re-commits the final keyframe
  // styles on its own next frame, which would overwrite an immediate clear
  return move.finished.catch(() => {}).then(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            element.style.transform = '';
            element.style.transformOrigin = '';
            element.style.opacity = '';
            resolve();
          })
        );
      })
  );
}

// Inverse FLIP: identity → toRect. Opacity stays solid while shrinking and
// melts at the end. No style cleanup — the element is removed right after.
export function animateZoomTo(element, toRect) {
  const m = lib();
  if (!m || !element || !toRect) return;
  const from = element.getBoundingClientRect();
  if (!from.width || !from.height) return;
  const dx = toRect.left - from.left;
  const dy = toRect.top - from.top;
  const sx = toRect.width / from.width;
  const sy = toRect.height / from.height;
  element.style.transformOrigin = '0 0';
  const move = m.animate(
    element,
    { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
    { duration: 0.3, ease: [0.4, 0, 0.7, 0.4] }
  );
  m.animate(element, { opacity: 0 }, { duration: 0.18, delay: 0.12, ease: 'linear' });
  return move.finished.catch(() => {});
}

// Exit fallback when the origin card is gone or off-screen.
export function animateDialogOut(element) {
  const m = lib();
  if (!m || !element) return;
  return m
    .animate(element, { opacity: 0, transform: 'scale(0.97)' }, { duration: 0.2, ease: 'easeIn' })
    .finished.catch(() => {});
}

// Scrim fades (the backdrop is a separate element so the dialog's zoom
// reads as growing out of the card, not fading in with the background).
export function animateFadeIn(element) {
  const m = lib();
  if (!m || !element) return;
  m.animate(element, { opacity: [0, 1] }, { duration: 0.25, ease: 'linear' });
}

export function animateFadeOut(element) {
  const m = lib();
  if (!m || !element) return;
  return m.animate(element, { opacity: 0 }, { duration: 0.22, ease: 'linear' }).finished.catch(() => {});
}

// FLIP relayout: measure the elements, run mutate() (a layout-changing DOM
// write), then glide every moved element from its old position into the new
// one. With no lib / reduced motion the mutation applies instantly. Inline
// transforms are cleared two frames after finish (Motion re-commits final
// keyframes a frame late) so CSS hover transforms keep working.
export function animateRelayout(elements, mutate) {
  const m = lib();
  const list = [...elements];
  if (!m || !list.length) {
    mutate();
    return;
  }
  const before = list.map((el) => el.getBoundingClientRect());
  mutate();
  list.forEach((el, i) => {
    const b = before[i];
    const a = el.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    m.animate(
      el,
      { transform: [`translate(${dx}px, ${dy}px)`, 'translate(0px, 0px)'] },
      { duration: 0.34, ease: EASE_OUT }
    )
      .finished.catch(() => {})
      .then(() =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            el.style.transform = '';
          })
        )
      );
  });
}

// Crossfade a content swap: fade the elements out, run swap() while they
// are invisible, fade back in. With no lib / reduced motion the swap runs
// immediately — same end state, no dead frames.
export async function animateCrossfade(elements, swap) {
  const m = lib();
  const list = [...(elements.length != null ? elements : [elements])].filter(Boolean);
  if (!m || !list.length) {
    swap();
    return;
  }
  await m
    .animate(list, { opacity: 0, transform: 'translateY(4px)' }, { duration: 0.14, ease: 'easeIn' })
    .finished.catch(() => {});
  swap();
  m.animate(
    list,
    { opacity: [0, 1], transform: ['translateY(4px)', 'translateY(0px)'] },
    { duration: 0.24, ease: EASE_OUT }
  );
}

// Incoming columns on prev/next navigation slide in from the travel
// direction. The outgoing content is swapped instantly — rapid arrow
// mashing degrades to instant swaps instead of queueing choreography.
export function animateSwapIn(elements, dir) {
  const m = lib();
  const list = [...elements];
  if (!m || !list.length) return;
  m.animate(
    list,
    { opacity: [0, 1], transform: [`translateX(${16 * dir}px)`, 'translateX(0px)'] },
    { duration: 0.2, ease: EASE_OUT }
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
