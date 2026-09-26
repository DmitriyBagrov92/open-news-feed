import Foundation

/// Whose voice a story is: the publisher's home, as `source.country` carries it
/// (web `public/js/country.js`). The field is tri-state on the wire:
/// missing → `.unknown` (a story saved before the field existed; resolve via `/api/sources`),
/// `null` → `.international` (aggregators), otherwise a code.
public enum Provenance: Sendable, Hashable {
    case unknown
    case international
    /// ISO 3166-1 alpha-2, plus the reserved EU and UN.
    case country(String)
    /// UN M.49 region for pan-regional services, e.g. `"002"` = Africa (shown with a globe).
    case region(String)

    /// The web's `valid()`: `^[A-Z]{2}$` or `^\d{3}$`; anything else is international —
    /// the code becomes part of an asset name, so junk never gets through.
    public init(code: String?) {
        guard let code else {
            self = .international
            return
        }
        let scalars = Array(code.unicodeScalars)
        if scalars.count == 2, scalars.allSatisfy({ ("A"..."Z").contains($0) }) {
            self = .country(code)
        } else if scalars.count == 3, scalars.allSatisfy({ ("0"..."9").contains($0) }) {
            self = .region(code)
        } else {
            self = .international
        }
    }

    public var code: String? {
        switch self {
        case .country(let code), .region(let code): return code
        case .unknown, .international: return nil
        }
    }

    /// `countryOf(source)`: the article's own field wins, the registry fills a missing one.
    public func resolved(sourceID: String, registry: [String: Provenance]) -> Provenance {
        guard self == .unknown else { return self }
        return registry[sourceID] ?? .unknown
    }

    static func decode<K: CodingKey>(from container: KeyedDecodingContainer<K>, forKey key: K) -> Provenance {
        guard container.contains(key) else { return .unknown }
        if (try? container.decodeNil(forKey: key)) == true { return .international }
        return Provenance(code: try? container.decode(String.self, forKey: key))
    }

    func encode<K: CodingKey>(into container: inout KeyedEncodingContainer<K>, forKey key: K) throws {
        switch self {
        case .unknown: break
        case .international: try container.encodeNil(forKey: key)
        case .country(let code), .region(let code): try container.encode(code, forKey: key)
        }
    }
}

/// Display names for bylines ("BBC World · United Kingdom").
public enum CountryNames {
    /// Apple's region names differ from the web's ICU (Chrome/Node) in two places:
    /// CN is "China mainland" (overridden to the web's "China") and HK is "Hong Kong"
    /// (kept: Apple's name, and shorter in a byline than the web's "Hong Kong SAR China").
    public static let englishOverrides: [String: String] = ["CN": "China"]

    public static func name(for provenance: Provenance, locale: Locale = Locale(identifier: "en")) -> String {
        switch provenance {
        case .unknown:
            return ""
        case .international:
            return L10n.t("country.international")
        case .region(let code):
            let key = "region.\(code)"
            let name = L10n.t(key)
            return name == key ? code : name
        case .country(let code):
            if locale.language.languageCode?.identifier == "en", let override = englishOverrides[code] {
                return override
            }
            return locale.localizedString(forRegionCode: code) ?? code
        }
    }
}
