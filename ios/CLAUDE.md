# Meridian for iOS — engineering notes

Native SwiftUI client of the Meridian API (docs/ARCHITECTURE.md is the contract; the Node server in
this repo is the single source of truth). iOS 26.0+, iPhone + iPad, real Liquid Glass. The plan and
phase status live in `~/.claude/plans/swirling-forging-tower.md`.

## Build & test

```bash
cd ios
xcodegen generate                 # Meridian.xcodeproj is generated, git-ignored, never hand-edited
scripts/test.sh unit              # Swift Testing, iPhone 17 / iOS 26.4
scripts/test.sh integration
scripts/test.sh contract          # boots server.js (FEED_FIXTURE) on :4174, live client against it
scripts/test.sh acceptance        # XCUITest on iPhone 17 + iPad Pro 13" (M5)
scripts/test.sh                   # all of the above (the gate)
```

Toolchain: the default **Xcode 26.2** (Swift 6.2) building for the iOS 26.4 simulator runtime.
Xcode 26.4.1 is installed but its iOS platform component is not ("iOS 26.4 is not installed" — fix in
Xcode › Settings › Components, then `export DEVELOPER_DIR=/Applications/Xcode_26_4_1.app/Contents/Developer`).
`SystemLanguageModel.tokenCount` exists only in the 26.4 SDK: guard it with `#if compiler(>=6.3)` +
`#available(iOS 26.4, *)` (with 26.2 the estimate path compiles). Any web/server change also needs
`npm test` green.

Generated data (commit the outputs; the gate fails on drift):
- `node ios/scripts/export-golden.mjs` — input→output vectors from the pure web modules
  (`Tests/Fixtures/golden/`). Swift ports must reproduce them.
- `node ios/scripts/capture-fixtures.mjs` — every endpoint captured from the real server in fixture
  mode, frozen clock `2026-09-26T12:00:00.000Z` (`Tests/Fixtures/api/`).
- `node ios/scripts/sync-strings.mjs` — `CoreModels/Resources/Localizable.xcstrings` from the web's
  English table (`public/js/i18n.js`) + `CoreModels/Strings/strings-ios.json` (iOS-only keys).
- `swift ios/scripts/app-icon.swift <appiconset>` — App Icon from the brand mark (no alpha).

## Modules (dependencies point downward)

| Module | Owns |
|---|---|
| CoreModels | Codable wire types (tolerant decoding), `Timestamp` (epoch ms like `Date.parse`), `RelativeTime`, `SourceHue`, `Provenance` + `CountryNames`, `L10n.t(key, vars)`, `Preferences`, `TasteProfile`, JS-compat helpers (`stableSorted`) |
| Networking | API client, `APIError`, request budget, Keychain author id, reachability |
| Persistence | `PreferencesStore`, SwiftData `LibraryStore` (saved/liked, offline bodies) |
| Intelligence | `Translator` / `Summarizer` ladders (dependencies; on-device rungs join in P6/P7), forecast, local ports (brief digest, extractive, sanitizer, taste engine) — no Apple AI imports |
| AppleAI | the only importer of FoundationModels + Translation |
| DesignSystem | tokens, glass components, image pipeline, flags, avatars, ambient background |
| ArticleKit | `ArticleStateStore`, cards, `FeedLayout`, swipe, `StoryRoute` / `openStory` / `storyList` |
| Feed / Story / YourFeed / Battle / Settings features | screens; features never import each other |
| AppFeature | root tab view ⇄ sidebar, `AppRouter` (per-tab story paths / panes), `StoryStack` |
| TestSupport | fakes + `LaunchContract` (Tests/Shared) — test targets and the app's `#if DEBUG` UI-test root only |

## Rules

- **Parity first.** Behaviour comes from `public/js/*` (file:line refs in the plan). Pure logic is a
  port checked by golden vectors; deliberate deviations are listed in the plan and pinned by tests.
- **JS semantics in ports:** insertion-ordered maps → `OrderedDictionary`; `Array.sort` is stable →
  `stableSorted`; string lengths/limits are UTF-16 (`utf16.count`); JS regexes are not Swift regexes
  (ASCII `\d`, `\w`, `\b` unless the web uses the `u` flag); time math in integer milliseconds.
- **Untrusted content:** links only from `WebURL.http` (http(s)), images via `WebURL.image` (https,
  http upgraded), country codes via `Provenance(code:)`. Never render feed HTML.
- **Liquid Glass on chrome only** (tab bar, toolbars, chips, pills, brief/forecast cards, toasts,
  time chip/rail). Rows and posters are content — the photos are the material (HIG).
- Every user-facing string goes through `L10n.t` with a web key or an `ios.*` key in
  `strings-ios.json`; never a literal in a view.
- Features open stories through the `openStory` environment action with a `StoryRoute`; AppFeature
  owns navigation (push on compact, `.inspector` pane on regular). The surface puts its list in
  `storyList` (a `StoryListRef` to a source read only on tap — never the array itself).
- **Environment values must be `Equatable`, compared by identity where they hold a reference or a
  closure** (`OpenStoryAction(id:)`, `StoryListRef`, `CardActions(id:)`). SwiftUI counts a value it
  cannot compare as changed on every write and updates every reader: with each card reading one,
  iPad scrolling went from 28 s to 160 s+ and froze for 30 s in the UI tests (found in P3).
- No test ever calls the real on-device model or translator (unavailable/unreliable in the
  simulator); fakes are selected via `LaunchContract`.
- Commits, pushes and deploys only when the user asks.

## UI tests (XCUITest) and the launch contract

`Tests/Shared/LaunchContract.swift` is compiled into TestSupport and the UI-test bundles. The app
builds the faked graph (`TestSupport.UITestConfiguration`) only in DEBUG with `-UITestMode`, and
**crashes** if the fixtures cannot load (a silent fallback once ran a "passing" test on live data).
Env keys: `FIXTURES_DIR` (use `LaunchContract.fixturesDirectory()`), `POLL_SECONDS`, `NEW_STORIES=1`
(polls find the three "Breaking:" stories), `OFFLINE=1`, `KEEP_STATE=1` (prefs survive a relaunch;
otherwise every launch starts clean), `SEED_PREFS` (JSON `Preferences`), `APPEARANCE`, `FIXED_NOW`,
`INITIAL_ROUTE` (`today` | `saved` | `search` | `story/<articleID>` — a Today story, opened once it loads),
`FAKE_TRANSLATION` (`installed`: the fake device translates every pair as "[on-device de] …";
`downloadable`: installed once the reader asks — the system sheet is simulated; unset: no on-device
translator, the fixture server answers "[de] …").
Fixture stories: the hero `825452304de0` is story-a (rich blocks), `b52427f78777` story-b (paragraphs),
`15eeca76f28c` story-c (paywall stub); every other extraction fails with 422 (the note). Story-a carries
the three captured comments (`cc…01` is the reader's own — the reader is the fixtures' "amber" author,
persona Solar Jetty; `cc…02` Lunar Tundra, liked; `cc…03` Mellow Kestrel). The fake server refuses a body
containing "kys" with 422 `objectionable`, only the author may delete, one report hides nothing.
Stable selectors: `card-<articleID>` (the headline block, a button), `card-<id>-{up,down,save,
translate,open}`, `chip-<category>`, `new-stories-pill`, `offline-banner`, `time-chip-label`,
`time-rail`, `brief`, `empty-{feed,search,saved}`, `language-menu`; the story: `story`, `story-<id>`
(a page), `story-<id>-{title,text}`, `story-{save,share,summarize,translate,source,up,down}`,
`story-{prev,next,close}` (the iPad pane), `story-{chip,note,summary,skeleton,comments}`; comments:
`comments`, `comments-{compose,sort,total,empty,more,rules}`, `comment-<id>` (+ `-menu`, `-up`,
`-down`, `-body`), the composer sheet `comments-{input,post,cancel}`, the rules `rules`, `rules-agree`;
toasts `toast` (match the text on the label — `toast(app, text)`). Pages of the pager coexist: scope
queries to `story-<id>`.
Suites derive from `AcceptanceTestCase` (`@MainActor`: XCUI APIs are main-actor isolated).
Gotchas: after scrolling the iPhone tab bar is minimised — swipe down before tapping a tab; chips
off-screen are not hittable; wait with `XCTWaiter` + `XCTNSPredicateExpectation` (Swift 6 rejects
`waitForExpectations` in a non-isolated test); `#filePath` as a default argument names the caller; on a
phone the hero's headline sits under the tab bar at launch (`isHittable` still says true) — tap its photo;
selectable story text is not always a `staticText` — query by label predicate; new test files need
`xcodegen generate` before `build-for-testing`; a toast lives 3.5 s — assert it before any slow
`eventually`; an element with an identifier is not found by its label through `query["text"]`. A UI test failing with "main thread busy for 30 s" is a
real hang: profile the simulator app while the test runs — `sample <pid> 2` (the pid from `ps -axo
pid,command | grep <device UDID> | grep Meridian.app/Meridian`) — and compare with the previous commit
built in a `git worktree` under the same two-simulator load.

## Verified API notes (iOS 26.4 SDK)

- `Guardrails.permissiveContentTransformations` suppresses `guardrailViolation` **only for String
  generation**; `@Generable` output behaves like `.default`. Brief/summary/battle brief → String +
  `toBullets`; only the forecast is `@Generable`.
- `tabViewBottomAccessory(isEnabled:content:)` is iOS 26.1 (plain variant 26.0 shows on every tab).
- `OpenURLAction.Result.systemAction(_:prefersInApp:)` (26.0) opens links in the in-app browser.
- `TranslationSession(installedSource:target:)` (26.0) works outside SwiftUI for installed pairs only;
  downloads need `.translationTask` + `prepareTranslation()`. `TranslationSession` and
  `LanguageAvailability` are non-Sendable: create and use them inside one nonisolated async function.
  The `.translationTask` action formed in a view body is main-actor isolated and may not send the
  session anywhere: pass a nonisolated method of a Sendable struct instead (`TranslationHost`).
  Downloads only for what the reader asked (`Translator.translate(…, interactive: true)`, picking a
  language); auto-translation uses installed pairs or the server.
- Foundation region names differ from the web's ICU: CN "China mainland" (overridden to "China"),
  HK "Hong Kong" (kept). Pinned in `GoldenParityTests.country`.
- `.tabViewBottomAccessory` stays on screen over a pushed view even with `.toolbar(.hidden, for: .tabBar)`
  — switch it off while a story is pushed.
- An `.inspector` column draws `.bottomBar` toolbar items flat (no glass) and clips them; the story pane
  uses its own `safeAreaBar(edge: .bottom)` dock instead. Its top bar items render without glass too.
- A `@DependencyClient`'s memberwise init is not public: stub a client with `var c = MeridianAPIClient()`
  and assign endpoints (unset ones report an unimplemented call).
- A dependency whose live value uses another one (the ladders read `meridianAPI`) resolves it inside the
  endpoint closure, at call time — `withDependencies` then reaches it.
