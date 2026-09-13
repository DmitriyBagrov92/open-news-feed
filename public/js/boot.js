// Runs synchronously in <head> so the saved appearance applies before the
// first paint: theme (an explicit light/dark choice; "auto" follows the
// system through prefers-color-scheme) and the Liquid Glass tint level.
(function () {
  // JavaScript is on: hide the server-rendered headline list (crawlers and
  // no-JS readers keep it) before the body is even parsed — no flash.
  document.documentElement.classList.add('js');
  try {
    var prefs = JSON.parse(localStorage.getItem('meridian:prefs') || '{}') || {};
    if (prefs.theme === 'dark' || prefs.theme === 'light') {
      document.documentElement.setAttribute('data-theme', prefs.theme);
    }
    var glass = Number(prefs.glass);
    if (isFinite(glass)) {
      document.documentElement.style.setProperty('--glass', String(Math.max(0, Math.min(1, glass))));
    }
  } catch (err) {
    /* corrupt prefs must never break the page */
  }
})();
