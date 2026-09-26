import CoreModels
import DesignSystem
import Dependencies
import Foundation
import Networking

/// The app's UI-test / demo composition, read from the launch contract (Tests/Shared/LaunchContract).
/// Built only by the app's `#if DEBUG` composition root.
public struct UITestConfiguration: Sendable {
    public let fixtures: URL
    public let now: Date?
    public let initialRoute: String?
    public let appearance: String?

    /// `nil` unless the process was launched with `-UITestMode`.
    public static func fromProcess(_ info: ProcessInfo = .processInfo) -> UITestConfiguration? {
        guard info.arguments.contains(LaunchContract.uiTestMode) else { return nil }
        let env = info.environment
        let fixtures = env[LaunchContract.Env.fixturesDir].map { URL(fileURLWithPath: $0) }
            ?? URL(fileURLWithPath: #filePath).deletingLastPathComponent() // Modules/TestSupport/Sources
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("Tests/Fixtures")
        let now = env[LaunchContract.Env.fixedNow].flatMap(Timestamp.init(iso:)).map(\.date)
        return UITestConfiguration(fixtures: fixtures, now: now, initialRoute: env[LaunchContract.Env.initialRoute],
                                   appearance: env[LaunchContract.Env.appearance])
    }

    /// Swaps every live dependency for its offline fake.
    public func apply(to values: inout DependencyValues) {
        let server: FixtureServer
        do {
            server = try FixtureServer(directory: fixtures)
        } catch {
            // never fall back to the live API silently: a UI test on live data passes for the wrong reason
            fatalError("-UITestMode: the fixture newsroom at \(fixtures.path) could not be loaded: \(error)")
        }
        values.meridianAPI = server.client
        values.date = .constant(now ?? server.capturedAt.date)
        values.authorIdentity = .inMemory()
        values.imageLoader = .testValue
    }
}
