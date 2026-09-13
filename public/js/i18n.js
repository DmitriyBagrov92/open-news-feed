// UI strings. To add a locale:
//   1. copy the `en` table into a new key ("de", "fr", …),
//   2. translate the values — keep keys and {placeholders} intact,
//   3. add the locale to the interface-language <select> in index.html.
// Missing keys fall back to `en`, then to the key itself.

// The one language list. Every language control (masthead popover, settings
// drawer) is built from it, and `prefs.targetLang` is the single language
// preference: stories are translated into it, the AI brief and forecast
// answer in it, and the interface follows wherever a table below exists.
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'pl', name: 'Polski' },
  { code: 'uk', name: 'Українська' },
  { code: 'ru', name: 'Русский' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '中文' },
];
export const isLanguage = (code) => LANGUAGES.some((l) => l.code === code);

const TABLES = {
  en: {
    // categories / tabs
    'cat.all': 'All',
    'cat.world': 'World',
    'cat.business': 'Business',
    'cat.technology': 'Tech',
    'cat.science': 'Science',
    'cat.sports': 'Sports',
    'cat.culture': 'Culture',
    'cat.health': 'Health',
    'cat.saved': 'Your Feed',
    'nav.today': 'Today',
    'nav.top': 'Back to top',
    'nav.battle': 'Battle',
    'nav.saved': 'Saved',

    // your feed / onboarding
    'feed.subRecommended': 'Recommended',
    'feed.subSaved': 'Saved',
    'feed.tune': 'Tune more',
    'feed.recoFallback': 'Rate a few more stories and this feed gets sharper — showing the freshest for now.',
    'onboard.title': 'Teach Meridian your taste',
    'onboard.hint': 'Like or skip a few stories. Your preferences stay on this device.',
    'onboard.like': 'Like',
    'onboard.skip': 'Skip',
    'onboard.progress': '{done} / {total}',
    'onboard.done': 'Your feed is ready',
    'onboard.empty': 'Stories are still loading — try again in a moment.',
    'cat.battle': 'Bubble Battle',

    // bubble battle view
    'battle.left': 'LEFT',
    'battle.center': 'CENTER',
    'battle.right': 'RIGHT',
    'battle.hint': 'One story, every angle — drag the bubbles',
    'battle.diffHead': 'HOW COVERAGE DIFFERS',
    'battle.critical': 'critical of {who}',
    'battle.supportive': 'supportive of {who}',
    'battle.neutral': 'neutral, fact-focused',
    'battle.empty': 'Not enough overlapping coverage right now — check back after the next refresh.',
    'battle.error': 'The battle view could not be loaded.',

    // search
    'search.placeholder': 'Search stories',
    'search.open': 'Search',
    'search.close': 'Close search',

    // translation control
    'lang.title': 'Translation',
    'lang.target': 'LANGUAGE',
    'lang.auto': 'Auto-translate the feed',
    'lang.hint': 'Runs on your device when the browser supports it; otherwise a free server fallback.',
    'lang.pick': 'Choose a target language other than English first.',
    'lang.unavailable': 'Translation unavailable in this browser.',

    // card sizing
    'grid.size': 'Card size',

    // theme / settings
    'theme.toggle': 'Toggle light or dark theme',
    'theme.auto': 'Auto',
    'theme.light': 'Light',
    'theme.dark': 'Dark',
    'settings.appearance': 'APPEARANCE',
    'settings.glass': 'Glass',
    'settings.glassClear': 'Clear',
    'settings.glassTinted': 'Tinted',
    'settings.open': 'Settings',
    'settings.title': 'Settings',
    'settings.close': 'Close settings',
    'settings.language': 'LANGUAGE',
    'settings.languageHint': 'One setting for everything: stories are translated into it (on your device when the browser can, otherwise a free server fallback), the AI brief and forecast answer in it, and the interface follows wherever a translation of the interface exists — English only so far.',
    'settings.sources': 'SOURCES',
    'settings.sourcesHint': 'Switch a source off to hide its stories from the feed.',
    'settings.sourcesLoading': 'Loading sources…',
    'settings.sourcesError': 'Sources could not be loaded. Close and reopen settings to retry.',
    'settings.requiresKey': 'NEEDS KEY',
    'settings.about': 'ABOUT',
    'settings.aboutText': 'Meridian is an open-source news reader that aggregates dozens of verified feeds and sorts the world by freshness. The world, as it happens.',

    // daily brief
    'brief.label': 'BRIEF',
    'brief.working': 'Summarizing…',
    'brief.rerun': 'Refresh the brief',
    'brief.error': 'The brief could not be built — it will retry with the next batch of stories.',
    'brief.empty': 'Nothing to summarize yet — the feed is still loading.',

    // AI forecast (pull past the top of the feed; Chrome built-in model only)
    'forecast.aria': 'AI forecast',
    'forecast.label': 'AHEAD · AI FORECAST · 7 DAYS',
    'forecast.hint': 'Pull for Ahead · AI forecast',
    'forecast.hintArmed': 'Release for Ahead',
    'forecast.enable': 'Enable Ahead · one-time model download',
    'forecast.specTag': 'SPECULATIVE',
    'forecast.disclaimer': 'Possible events an AI model on this device extrapolated from the stories in view — not news, not reporting, not verified. Read them as things to watch, nothing more.',
    'forecast.thinking': 'THINKING…',
    'forecast.translating': 'TRANSLATING…',
    'forecast.generated': 'GENERATED',
    'forecast.regenerate': 'Regenerate the forecast',
    'forecast.close': 'Close the forecast',
    'forecast.tag': 'FORECAST',
    'forecast.badge': 'AI-GENERATED · NOT NEWS',
    'forecast.confLow': 'LOW CONFIDENCE',
    'forecast.confMedium': 'MEDIUM CONFIDENCE',
    'forecast.basedOn': 'BASED ON',
    'forecast.expand': 'Show why the model expects this',
    'forecast.openBasis': 'Open the real story: {title}',
    'forecast.tooFew': 'Not enough English stories in this view to forecast from — try the All tab.',
    'forecast.error': 'The forecast could not be generated. Try again.',
    'forecast.abstract': 'The model only restated the news this time — try again for a sharper set.',
    'forecast.needsGesture': 'The model still needs a one-time download — press Enable to start it.',
    'forecast.railLabel': 'FORECAST',
    'forecast.railFuture': '+7D',
    'settings.forecast': 'AHEAD · AI FORECAST',
    'settings.forecastToggle': 'Pull down at the top of the feed for an AI forecast',
    'settings.forecastHint': 'Runs entirely on this device with Chrome’s built-in model. Shown only where the browser supports it.',

    // feed
    'feed.newStories': '{n} NEW STORIES',
    'feed.newStory': '1 NEW STORY',
    'feed.load': 'LOAD',
    'feed.empty': 'Nothing here right now.',
    'feed.emptyHint': 'Sources refresh every few minutes — check back shortly.',
    'feed.emptySearch': 'No stories match “{q}”.',
    'feed.emptySearchHint': 'Try a different word, or clear the search.',
    'feed.emptySaved': 'Nothing saved yet.',
    'feed.emptySavedHint': 'Tap the bookmark on any story to keep it here — saved stories work offline.',
    'feed.error': 'The feed could not be loaded.',
    'feed.errorHint': 'Check your connection and try again.',
    'feed.retry': 'Retry',
    'feed.loadMoreError': 'More stories could not be loaded.',
    'feed.offline': 'You’re offline — showing stories already loaded.',

    // card
    'card.translate': 'Translate this story',
    'card.showOriginal': 'Show the original text',
    'card.save': 'Save story',
    'card.unsave': 'Remove from saved',
    'card.open': 'Open the original article',
    'card.share': 'Share',
    'card.preview': 'Preview: {title}',

    // preview modal
    'modal.close': 'Close preview',
    'modal.readAtSource': 'Source ↗',
    'modal.translate': 'Translate',
    'modal.translating': 'Translating…',
    'modal.summarize': 'Summarize',
    'modal.summarizing': 'Summarizing…',
    'modal.unavailable': 'Full text unavailable — read at source.',
    'modal.summaryTitle': 'KEY POINTS',
    'comments.title': 'COMMENTS',
    'comments.as': 'Commenting as {name}',
    'comments.placeholder': 'Share your take — you stay anonymous',
    'comments.post': 'Post',
    'comments.posting': 'Posting…',
    'comments.loadMore': 'Load more',
    'comments.sortNew': 'New',
    'comments.sortTop': 'Top',
    'comments.empty': 'No comments yet — start the conversation.',
    'comments.error': 'Comments could not be loaded.',
    'comments.retry': 'Retry',
    'comments.closed': 'Comments are closed for archived stories.',
    'comments.tooFast': 'Easy there — wait a few seconds between comments.',
    'comments.duplicate': 'You already posted exactly this.',
    'comments.limit': 'Comment limit reached for this story.',
    'comments.failed': 'Could not post your comment. Try again.',
    'comments.like': 'Like',
    'comments.dislike': 'Dislike',
    'card.comments': '{n} comments',
    'card.like': 'Like this story',
    'card.dislike': 'Dislike this story',
    'card.voteFailed': 'Could not register your vote. Try again.',
    'card.voteClosed': 'Voting is closed for archived stories.',
    'modal.prev': 'Previous story',
    'modal.next': 'Next story',
    'modal.chipTranslated': 'TRANSLATED · SHOW ORIGINAL',
    'modal.chipOriginal': 'ORIGINAL · SHOW TRANSLATION',

    // AI providers
    'ai.onDevice': 'ON-DEVICE AI',
    'ai.local': 'LOCAL DIGEST',
    'ai.downloading': 'DOWNLOADING… {pct}%',

    // relative time (data voice)
    'time.justNow': 'JUST NOW',
    'time.min': '{n} MIN AGO',
    'time.hr': '1 HR AGO',
    'time.hrs': '{n} HRS AGO',
    'time.day': '1 DAY AGO',
    'time.days': '{n} DAYS AGO',
    'time.anyMoment': 'ANY MOMENT',
    'time.withinHrs': 'WITHIN {n} HRS',
    'time.withinDays': 'WITHIN {n} DAYS',
    'time.thisWeek': 'THIS WEEK',

    // footer
    'about.blurb': 'Meridian is a free, open-source world news feed: 83 sources in 8 languages, one stream sorted by freshness, translated and summarized by AI on your own device. No ads, no accounts, no tracking — ever.',
    'foot.tagline': 'MERIDIAN — OPEN SOURCE · NO ADS · NO TRACKING',
    'foot.sources': '{n} SOURCES',
    'foot.github': 'GITHUB',
  },
};

let locale = 'en';

// The interface speaks the chosen language when a table for it exists,
// English otherwise — no separate "interface language" to keep in sync.
export function setLocale(next) {
  locale = TABLES[next] ? next : 'en';
}
export const hasLocale = (code) => Boolean(TABLES[code]);

export function t(key, vars) {
  let str = TABLES[locale]?.[key] ?? TABLES.en[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      str = str.replaceAll('{' + name + '}', String(value));
    }
  }
  return str;
}

// Label for a category id; unknown ids (future backend additions) degrade to
// their uppercased id instead of a raw "cat.x" key.
export function catLabel(category) {
  const key = 'cat.' + category;
  const label = t(key);
  return label === key ? String(category || '').toUpperCase() : label;
}

// Applies the table to static markup: data-i18n → textContent,
// data-i18n-label → aria-label, data-i18n-placeholder → placeholder.
export function applyI18n(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-label]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nLabel));
  }
  for (const node of root.querySelectorAll('[data-i18n-placeholder]')) {
    node.setAttribute('placeholder', t(node.dataset.i18nPlaceholder));
  }
}
