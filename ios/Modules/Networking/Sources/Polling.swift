import Dependencies
import Foundation

/// How often the open feed asks for new stories and fresh counters (web `POLL_MS` = 30 s).
/// UI tests shorten it through the launch contract.
public struct PollingConfiguration: Sendable {
    public var interval: Duration
    /// The quick tick after coming back to the foreground (web: 1.5 s).
    public var resumeDelay: Duration

    public init(interval: Duration = .seconds(30), resumeDelay: Duration = .milliseconds(1500)) {
        self.interval = interval
        self.resumeDelay = resumeDelay
    }
}

extension PollingConfiguration: DependencyKey {
    public static let liveValue = PollingConfiguration()
    public static let testValue = PollingConfiguration(interval: .milliseconds(50), resumeDelay: .milliseconds(10))
}

public extension DependencyValues {
    var polling: PollingConfiguration {
        get { self[PollingConfiguration.self] }
        set { self[PollingConfiguration.self] = newValue }
    }
}
