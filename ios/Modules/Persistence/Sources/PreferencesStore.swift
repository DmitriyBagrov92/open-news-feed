import CoreModels
import Dependencies
import Foundation
import Observation

/// Where preferences live: one JSON object under one key (the web's `localStorage['meridian:prefs']`).
public struct PreferencesClient: Sendable {
    public var load: @Sendable () -> Preferences
    public var save: @Sendable (Preferences) -> Void

    public init(load: @escaping @Sendable () -> Preferences, save: @escaping @Sendable (Preferences) -> Void) {
        self.load = load
        self.save = save
    }
}

extension PreferencesClient: DependencyKey {
    public static let storageKey = "meridian.prefs"

    public static let liveValue = PreferencesClient.userDefaults(.standard)

    public static var testValue: PreferencesClient { .inMemory() }

    /// Corrupt or missing data degrades to the defaults — the app never fails to launch on it.
    public static func userDefaults(_ defaults: UserDefaults) -> PreferencesClient {
        nonisolated(unsafe) let store = defaults
        return PreferencesClient(
            load: {
                guard let data = store.data(forKey: storageKey),
                      let prefs = try? JSONDecoder().decode(Preferences.self, from: data)
                else { return Preferences() }
                return prefs
            },
            save: { prefs in
                if let data = try? JSONEncoder().encode(prefs) { store.set(data, forKey: storageKey) }
            }
        )
    }

    public static func inMemory(_ initial: Preferences = Preferences()) -> PreferencesClient {
        let box = LockedBox(initial)
        return PreferencesClient(load: { box.value }, save: { box.value = $0 })
    }
}

public extension DependencyValues {
    var preferences: PreferencesClient {
        get { self[PreferencesClient.self] }
        set { self[PreferencesClient.self] = newValue }
    }
}

/// The app's preferences, observable; every change is written through.
@MainActor
@Observable
public final class PreferencesStore {
    public var value: Preferences {
        didSet { if value != oldValue { client.save(value) } }
    }

    @ObservationIgnored private let client: PreferencesClient

    public init(client: PreferencesClient? = nil) {
        @Dependency(\.preferences) var injected
        self.client = client ?? injected
        value = self.client.load()
    }
}

final class LockedBox<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var stored: Value

    init(_ value: Value) {
        stored = value
    }

    var value: Value {
        get { lock.withLock { stored } }
        set { lock.withLock { stored = newValue } }
    }
}
