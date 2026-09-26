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
| Intelligence | translate / summarize / forecast ladders, local ports (brief digest, extractive, sanitizer, taste engine) — no Apple AI imports |
| AppleAI | the only importer of FoundationModels + Translation |
| DesignSystem | tokens, glass components, image pipeline, flags, avatars, ambient background |
| ArticleKit | `ArticleStateStore`, cards, `FeedLayout`, swipe, `StoryRoute` / `openStory` |
| Feed / Story / YourFeed / Battle / Settings features | screens; features never import each other |
| AppFeature | root tab view ⇄ sidebar, router, destinations |
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
  owns navigation (push on compact, `.inspector` pane on regular).
- No test ever calls the real on-device model or translator (unavailable/unreliable in the
  simulator); fakes are selected via `LaunchContract`.
- Commits, pushes and deploys only when the user asks.

## Verified API notes (iOS 26.4 SDK)

- `Guardrails.permissiveContentTransformations` suppresses `guardrailViolation` **only for String
  generation**; `@Generable` output behaves like `.default`. Brief/summary/battle brief → String +
  `toBullets`; only the forecast is `@Generable`.
- `tabViewBottomAccessory(isEnabled:content:)` is iOS 26.1 (plain variant 26.0 shows on every tab).
- `OpenURLAction.Result.systemAction(_:prefersInApp:)` (26.0) opens links in the in-app browser.
- `TranslationSession(installedSource:target:)` (26.0) works outside SwiftUI for installed pairs only;
  downloads need `.translationTask` + `prepareTranslation()`. `TranslationSession` and
  `LanguageAvailability` are non-Sendable: create and use them inside one nonisolated async function.
- Foundation region names differ from the web's ICU: CN "China mainland" (overridden to "China"),
  HK "Hong Kong" (kept). Pinned in `GoldenParityTests.country`.
