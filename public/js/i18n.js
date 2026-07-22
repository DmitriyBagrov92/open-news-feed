// UI strings. To add a locale:
//   1. copy the `en` table into a new key ("de", "fr", …),
//   2. translate the values — keep keys and {placeholders} intact,
//   3. add the locale to the interface-language <select> in index.html.
// Missing keys fall back to `en`, then to the key itself.

const TABLES = {
  en: {
    // categories / tabs
    'cat.all': 'ALL',
    'cat.world': 'WORLD',
    'cat.business': 'BUSINESS',
    'cat.technology': 'TECH',
    'cat.science': 'SCIENCE',
    'cat.sports': 'SPORTS',
    'cat.culture': 'CULTURE',
    'cat.health': 'HEALTH',
    'cat.saved': 'SAVED',

    // search
    'search.placeholder': 'Search stories',
    'search.open': 'Search',
    'search.close': 'Close search',

    // translation control
    'lang.title': 'Translation',
    'lang.target': 'TRANSLATE TO',
    'lang.auto': 'Auto-translate the feed',
    'lang.hint': 'Runs on your device when the browser supports it; otherwise a free server fallback.',
    'lang.pick': 'Choose a target language other than English first.',
    'lang.unavailable': 'Translation unavailable in this browser.',

    // card sizing
    'grid.size': 'Card size',
    'grid.smaller': 'Smaller cards',
    'grid.bigger': 'Bigger cards',

    // theme / settings
    'theme.toggle': 'Toggle light or dark theme',
    'settings.open': 'Settings',
    'settings.title': 'Settings',
    'settings.close': 'Close settings',
    'settings.uiLang': 'INTERFACE LANGUAGE',
    'settings.sources': 'SOURCES',
    'settings.sourcesHint': 'Uncheck a source to hide its stories from the feed.',
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
    'card.preview': 'Preview: {title}',

    // preview modal
    'modal.close': 'Close preview',
    'modal.readAtSource': 'Read at source ↗',
    'modal.translate': 'Translate',
    'modal.translating': 'Translating…',
    'modal.summarize': 'Summarize',
    'modal.summarizing': 'Summarizing…',
    'modal.unavailable': 'Full text unavailable — read at source.',
    'modal.summaryTitle': 'KEY POINTS',
    'comments.title': 'COMMENTS',
    'comments.as': 'Commenting as {name}',
    'comments.placeholder': 'Share your take — you stay anonymous',
    'comments.post': 'POST',
    'comments.posting': 'POSTING…',
    'comments.loadMore': 'LOAD MORE',
    'comments.sortNew': 'NEW',
    'comments.sortTop': 'TOP',
    'comments.empty': 'No comments yet — start the conversation.',
    'comments.error': 'Comments could not be loaded.',
    'comments.retry': 'RETRY',
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

    // footer
    'foot.tagline': 'MERIDIAN — OPEN SOURCE',
    'foot.sources': '{n} SOURCES',
    'foot.github': 'GITHUB',
  },
};

let locale = 'en';

export function setLocale(next) {
  if (TABLES[next]) locale = next;
}

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
