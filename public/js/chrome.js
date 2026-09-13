// The glass chrome: the floating top cluster, the frost band and the tab
// bar all react to scrolling. One rAF-throttled scroll listener writes the
// state onto <html> and CSS does the rest:
//   html[data-scrolled]      content has moved under the cluster (frost band,
//                            category pill morphs in)
//   html[data-scroll=down]   the reader is scrolling down (tab bar minimises)
//   --sticky-top             measured bottom edge of the cluster, in px —
//                            the "in view" line for the rail and sticky rows

const TABLET = '(min-width: 700px)';
const REGULAR = '(min-width: 860px)';
const RAIL = '(min-width: 1000px)';

export const isTablet = () => matchMedia(TABLET).matches;
export const isRegular = () => matchMedia(REGULAR).matches;
export const hasRail = () => matchMedia(RAIL).matches;

export function initChrome({ cluster } = {}) {
  const root = document.documentElement;

  if (cluster) {
    const measure = () => {
      const rect = cluster.getBoundingClientRect();
      root.style.setProperty('--sticky-top', Math.round(rect.bottom) + 'px');
    };
    new ResizeObserver(measure).observe(cluster);
    measure();
  }

  let lastY = window.scrollY;
  let raf = 0;
  let idle = null;
  const onScroll = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const y = window.scrollY;
      root.toggleAttribute('data-scrolled', y > 24);
      const dy = y - lastY;
      if (Math.abs(dy) > 6) {
        if (dy > 0 && y > 140) root.dataset.scroll = 'down';
        else if (dy < 0) delete root.dataset.scroll;
        lastY = y;
        clearTimeout(idle);
        idle = setTimeout(() => delete root.dataset.scroll, 700);
      }
      if (y <= 140) delete root.dataset.scroll;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  return { isTablet, isRegular, hasRail };
}
