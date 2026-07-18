// Runs synchronously in <head> so the saved theme applies before first paint.
(function () {
  try {
    var prefs = JSON.parse(localStorage.getItem('meridian:prefs') || '{}');
    if (prefs && (prefs.theme === 'dark' || prefs.theme === 'light')) {
      document.documentElement.setAttribute('data-theme', prefs.theme);
    }
  } catch (err) {
    /* corrupt prefs must never break the page */
  }
})();
