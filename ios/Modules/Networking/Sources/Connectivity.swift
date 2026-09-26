import Dependencies
import Foundation
import Network
import Observation

/// Online / offline, for the offline banner and for pausing polls (web `navigator.onLine`).
public struct ConnectivityClient: Sendable {
    /// Emits the current state first, then every change.
    public var updates: @Sendable () -> AsyncStream<Bool>

    public init(updates: @escaping @Sendable () -> AsyncStream<Bool>) {
        self.updates = updates
    }

    public static func constant(_ online: Bool) -> ConnectivityClient {
        ConnectivityClient {
            AsyncStream { continuation in
                continuation.yield(online)
            }
        }
    }
}

extension ConnectivityClient: DependencyKey {
    public static let liveValue = ConnectivityClient {
        AsyncStream { continuation in
            let monitor = NWPathMonitor()
            monitor.pathUpdateHandler = { path in continuation.yield(path.status == .satisfied) }
            continuation.onTermination = { _ in monitor.cancel() }
            monitor.start(queue: DispatchQueue(label: "info.meridi.app.connectivity"))
        }
    }

    public static let testValue = ConnectivityClient.constant(true)
}

public extension DependencyValues {
    var connectivity: ConnectivityClient {
        get { self[ConnectivityClient.self] }
        set { self[ConnectivityClient.self] = newValue }
    }
}

/// The observed connectivity state.
@MainActor
@Observable
public final class ConnectivityModel {
    public private(set) var isOnline = true
    @ObservationIgnored private let client: ConnectivityClient

    public init(client: ConnectivityClient? = nil) {
        @Dependency(\.connectivity) var injected
        self.client = client ?? injected
    }

    public func run() async {
        for await online in client.updates() {
            if online != isOnline { isOnline = online }
        }
    }
}
