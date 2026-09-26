import Foundation

/// Feed categories (`config/sources.js` CATEGORIES) plus the client's pseudo-category `all`.
public enum NewsCategory: String, Sendable, Hashable, Codable, CaseIterable, Identifiable {
    case all, world, business, technology, science, sports, culture, health

    public var id: String { rawValue }

    /// The real categories, in the web's chip order.
    public static let feed: [NewsCategory] = [.world, .business, .technology, .science, .sports, .culture, .health]

    /// Chip label — the web's `catLabel` ("Tech" for technology).
    public var label: String { NewsCategory.label(for: rawValue) }

    /// `catLabel(id)`: the `cat.<id>` string, or the id uppercased when there is none.
    public static func label(for id: String) -> String {
        let key = "cat.\(id)"
        let value = L10n.t(key)
        return value == key ? id.uppercased() : value
    }

    public var symbol: String {
        switch self {
        case .all: "square.grid.2x2"
        case .world: "globe.europe.africa"
        case .business: "chart.line.uptrend.xyaxis"
        case .technology: "cpu"
        case .science: "atom"
        case .sports: "sportscourt"
        case .culture: "theatermasks"
        case .health: "heart.text.square"
        }
    }
}

/// THE language (web `prefs.targetLang`): translation target and AI output language.
public struct Language: Sendable, Hashable, Identifiable, Codable {
    public let code: String
    public let name: String
    public var id: String { code }

    public init(code: String, name: String) {
        self.code = code
        self.name = name
    }

    /// The web's `LANGUAGES` (public/js/i18n.js), in its order.
    public static let all: [Language] = [
        Language(code: "en", name: "English"),
        Language(code: "es", name: "Español"),
        Language(code: "de", name: "Deutsch"),
        Language(code: "fr", name: "Français"),
        Language(code: "pt", name: "Português"),
        Language(code: "it", name: "Italiano"),
        Language(code: "nl", name: "Nederlands"),
        Language(code: "pl", name: "Polski"),
        Language(code: "uk", name: "Українська"),
        Language(code: "ru", name: "Русский"),
        Language(code: "ja", name: "日本語"),
        Language(code: "zh", name: "中文"),
    ]

    public static func isSupported(_ code: String) -> Bool { all.contains { $0.code == code } }

    /// The `lang` query value (web `feedLangs`, app.js:117): when the target language has native
    /// feeds the feed mixes them with English (`"ru,en"`); otherwise the parameter is omitted.
    public static func feedQuery(target: String, nativeLanguages: Set<String>) -> String? {
        target != "en" && nativeLanguages.contains(target) ? "\(target),en" : nil
    }
}
