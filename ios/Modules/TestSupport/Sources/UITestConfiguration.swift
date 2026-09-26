import CoreModels
import DesignSystem
import Dependencies
import Foundation
import Networking
import Persistence

/// The app's UI-test / demo composition, read from the launch contract (Tests/Shared/LaunchContract).
/// Built only by the app's `#if DEBUG` composition root.
public struct UITestConfiguration: Sendable {
    public let fixtures: URL
    public let now: Date?
    public let initialRoute: String?
    public let pollInterval: Duration?
    public let newStories: Bool
    public let offline: Bool
    public let keepState: Bool
    public let seedPreferences: Preferences?

    /// `nil` unless the process was launched with `-UITestMode`.
    public static func fromProcess(_ info: ProcessInfo = .processInfo) -> UITestConfiguration? {
        guard info.arguments.contains(LaunchContract.uiTestMode) else { return nil }
        let env = info.environment
        let fixtures = env[LaunchContract.Env.fixturesDir].map { URL(fileURLWithPath: $0) }
            ?? URL(fileURLWithPath: LaunchContract.fixturesDirectory())
        return UITestConfiguration(
            fixtures: fixtures,
            now: env[LaunchContract.Env.fixedNow].flatMap(Timestamp.init(iso:)).map(\.date),
            initialRoute: env[LaunchContract.Env.initialRoute],
            pollInterval: env[LaunchContract.Env.pollSeconds].flatMap(Double.init).map { .milliseconds(Int($0 * 1000)) },
            newStories: env[LaunchContract.Env.newStories] == "1",
            offline: env[LaunchContract.Env.offline] == "1",
            keepState: env[LaunchContract.Env.keepState] == "1",
            seedPreferences: env[LaunchContract.Env.seedPrefs].flatMap { try? JSONDecoder().decode(Preferences.self, from: Data($0.utf8)) }
        )
    }

    /// Swaps every live dependency for its offline fake.
    public func apply(to values: inout DependencyValues) {
        let server: FixtureServer
        do {
            server = try FixtureServer(directory: fixtures, newStories: newStories)
        } catch {
            // never fall back to the live API silently: a UI test on live data passes for the wrong reason
            fatalError("-UITestMode: the fixture newsroom at \(fixtures.path) could not be loaded: \(error)")
        }
        values.meridianAPI = server.client
        values.date = .constant(now ?? server.capturedAt.date)
        values.authorIdentity = .inMemory()
        values.imageLoader = .testValue
        values.library = .swiftData(inMemory: true)
        values.connectivity = .constant(!offline)
        if let pollInterval { values.polling = PollingConfiguration(interval: pollInterval, resumeDelay: .milliseconds(300)) }

        // Preferences persist in their own suite so a test can relaunch and find them; every other
        // launch starts clean (or from SEED_PREFS).
        let defaults = UserDefaults(suiteName: "info.meridi.app.uitests") ?? .standard
        if !keepState { defaults.removeObject(forKey: PreferencesClient.storageKey) }
        let client = PreferencesClient.userDefaults(defaults)
        if let seedPreferences { client.save(seedPreferences) }
        values.preferences = client
    }
}
