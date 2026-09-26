import Foundation

/// The launch contract between the app and its UI tests. This one file is compiled into
/// TestSupport (read by the app's #if DEBUG composition root) and into the UI test bundles
/// (which set it), so the two sides cannot drift.
public enum LaunchContract {
    /// Launch argument: build the fully faked dependency graph (fixture newsroom, fake AI).
    public static let uiTestMode = "-UITestMode"

    public enum Env {
        /// Absolute host path of ios/Tests/Fixtures (the simulator reads the Mac's filesystem).
        public static let fixturesDir = "FIXTURES_DIR"
        /// Where the app starts, e.g. `today`, `today/world`, `story/<articleID>`, `settings`.
        public static let initialRoute = "INITIAL_ROUTE"
        /// ISO 8601 instant the fake clock is pinned to (defaults to the fixtures' capture time).
        public static let fixedNow = "FIXED_NOW"
        /// `light` | `dark` — overrides the appearance preference.
        public static let appearance = "APPEARANCE"
        /// JSON `Preferences` seeded before launch.
        public static let seedPrefs = "SEED_PREFS"
        /// Behaviour of the fake on-device model: `points`, `refusal`, `error`, `slow`.
        public static let fakeModel = "FAKE_MODEL"
        /// `1` — behave like a device without Apple Intelligence.
        public static let forceNoAI = "FORCE_NO_AI"
        /// The on-device translator: `installed` (every pair, "[on-device de] …"), `downloadable`
        /// (installed once the reader agrees), anything else — none (the server rung only).
        public static let fakeTranslation = "FAKE_TRANSLATION"
        /// Seconds between feed polls (live: 30).
        public static let pollSeconds = "POLL_SECONDS"
        /// `1` — polls find the three "Breaking:" fixture stories (web `/__fixture/advance`).
        public static let newStories = "NEW_STORIES"
        /// `1` — the device is offline.
        public static let offline = "OFFLINE"
        /// `1` — keep preferences from the previous UI-test launch (tests of persistence).
        public static let keepState = "KEEP_STATE"
    }

    /// ios/Tests/Fixtures on the host, located from THIS file (Tests/Shared/LaunchContract.swift).
    /// `#filePath` sits in the body on purpose: as a default argument it would name the caller's file.
    public static func fixturesDirectory() -> String {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Fixtures").path
    }
}
