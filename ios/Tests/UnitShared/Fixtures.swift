import Foundation

/// Reads ios/Tests/Fixtures, copied into the test bundle as a folder reference:
/// `api/*.json` are exchanges captured from the real server (scripts/capture-fixtures.mjs),
/// `golden/*.json` are input→output vectors from the web modules (scripts/export-golden.mjs).
enum Fixtures {
    static let root: URL = {
        guard let url = Bundle(for: TestBundleToken.self).url(forResource: "Fixtures", withExtension: nil) else {
            fatalError("Fixtures folder missing from the test bundle — check project.yml UnitTests template")
        }
        return url
    }()

    static func data(_ relativePath: String) throws -> Data {
        try Data(contentsOf: root.appendingPathComponent(relativePath))
    }

    /// A captured exchange: `{ request, status, body }`.
    struct Exchange {
        let status: Int
        let body: Data
        let json: Any
    }

    static func api(_ name: String) throws -> Exchange {
        let object = try JSONSerialization.jsonObject(with: data("api/\(name).json"), options: [.fragmentsAllowed])
        guard let wrapper = object as? [String: Any], let status = wrapper["status"] as? Int else {
            throw CocoaError(.coderReadCorrupt)
        }
        let bodyObject = wrapper["body"] ?? NSNull()
        let body = try JSONSerialization.data(withJSONObject: bodyObject, options: [.fragmentsAllowed])
        return Exchange(status: status, body: body, json: bodyObject)
    }

    static func decodeAPI<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONDecoder().decode(T.self, from: api(name).body)
    }

    static func golden<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONDecoder().decode(T.self, from: data("golden/\(name).json"))
    }

    /// Every captured exchange name (from the manifest).
    static func apiNames() throws -> [String] {
        let manifest = try JSONSerialization.jsonObject(with: data("api/_manifest.json")) as? [String: Any]
        return manifest?["files"] as? [String] ?? []
    }
}

private final class TestBundleToken {}

/// A JSON value as JavaScript sees it, for vectors whose inputs are deliberately untyped.
enum JSValue: Decodable, Equatable {
    case number(Double)
    case string(String)
    case bool(Bool)
    case null
    case other

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else {
            self = .other
        }
    }

    /// `Number(v)` for the value kinds the vectors use.
    var number: Double {
        switch self {
        case .number(let value): return value
        case .string(let value):
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? 0 : Double(trimmed) ?? .nan
        case .bool(let value): return value ? 1 : 0
        case .null: return 0
        case .other: return .nan
        }
    }

    var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }
}

/// `[key, value]` — how the exporter writes insertion-ordered JS objects.
struct Pair: Decodable, Equatable {
    let key: String
    let value: JSValue

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        key = try container.decode(String.self)
        value = try container.decode(JSValue.self)
    }
}
