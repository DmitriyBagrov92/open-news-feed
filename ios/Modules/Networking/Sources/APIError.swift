import Foundation

/// Every way a Meridian request can fail, with the server's machine-readable `code` preserved —
/// the UI maps codes to copy exactly like the web (e.g. `too-fast`, `unknown-article`).
public enum APIError: Error, Sendable, Equatable {
    /// A non-2xx response. `code` comes from `{ "error": { "code", "message" } }` when present.
    case server(status: Int, code: String, message: String, retryAfter: TimeInterval?)
    /// No connection, timeout, DNS… (`URLError.Code`).
    case network(URLError.Code)
    /// A 2xx body that does not match the contract.
    case decoding(String)

    public var status: Int? {
        if case .server(let status, _, _, _) = self { return status }
        return nil
    }

    public var code: String? {
        if case .server(_, let code, _, _) = self { return code }
        return nil
    }

    /// Worth retrying later (connectivity, 429, 5xx) rather than a permanent answer.
    public var isTransient: Bool {
        switch self {
        case .network: return true
        case .server(let status, _, _, _): return status == 429 || status >= 500 && status != 501
        case .decoding: return false
        }
    }

    public var isOffline: Bool {
        guard case .network(let code) = self else { return false }
        return [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff].contains(code)
    }
}
