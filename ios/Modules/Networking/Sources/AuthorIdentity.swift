import Dependencies
import Foundation
import Security

/// The anonymous comment identity (web `prefs.authorId`): a random UUID minted on the first
/// write (comment, vote, onboarding rating) and sent as `X-Author-Id`. It is a capability token —
/// the server derives the public pseudonym from it and never returns it — so it lives in the
/// Keychain, this device only. Reads never mint one.
public struct AuthorIdentity: Sendable {
    public var current: @Sendable () -> String?
    public var ensure: @Sendable () -> String
    public var reset: @Sendable () -> Void

    public init(current: @escaping @Sendable () -> String?, ensure: @escaping @Sendable () -> String,
                reset: @escaping @Sendable () -> Void) {
        self.current = current
        self.ensure = ensure
        self.reset = reset
    }
}

extension AuthorIdentity: DependencyKey {
    public static let liveValue = AuthorIdentity.keychain(service: "info.meridi.app.author")

    public static var testValue: AuthorIdentity { .inMemory() }

    /// A process-local identity (tests, UI-test mode).
    public static func inMemory(_ initial: String? = nil) -> AuthorIdentity {
        let box = LockedValue<String?>(initial)
        return AuthorIdentity(
            current: { box.value },
            ensure: {
                box.update { id in
                    if id == nil { id = UUID().uuidString.lowercased() }
                    return id!
                }
            },
            reset: { box.update { $0 = nil } }
        )
    }

    public static func keychain(service: String) -> AuthorIdentity {
        let store = KeychainItem(service: service, account: "author-id")
        let lock = NSLock()
        return AuthorIdentity(
            current: { lock.withLock { store.read() } },
            ensure: {
                lock.withLock {
                    if let id = store.read() { return id }
                    let id = UUID().uuidString.lowercased()
                    store.write(id)
                    return id
                }
            },
            reset: { lock.withLock { store.delete() } }
        )
    }
}

/// One generic-password Keychain item, readable after first unlock, never synced off the device.
struct KeychainItem: Sendable {
    let service: String
    let account: String

    private var base: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    func read() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let value = String(data: data, encoding: .utf8)
        else { return nil }
        return value
    }

    func write(_ value: String) {
        delete()
        var attributes = base
        attributes[kSecValueData as String] = Data(value.utf8)
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(attributes as CFDictionary, nil)
    }

    func delete() {
        SecItemDelete(base as CFDictionary)
    }
}

public extension DependencyValues {
    var authorIdentity: AuthorIdentity {
        get { self[AuthorIdentity.self] }
        set { self[AuthorIdentity.self] = newValue }
    }
}

/// A value behind a lock, for closure-based clients that must be `Sendable`.
public final class LockedValue<Value>: @unchecked Sendable {
    private var stored: Value
    private let lock = NSLock()

    public init(_ value: Value) {
        stored = value
    }

    public var value: Value {
        lock.withLock { stored }
    }

    @discardableResult
    public func update<Result>(_ body: (inout Value) throws -> Result) rethrows -> Result {
        try lock.withLock { try body(&stored) }
    }
}
