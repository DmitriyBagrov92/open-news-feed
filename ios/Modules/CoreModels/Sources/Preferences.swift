import Foundation
import OrderedCollections

/// Device-only preferences (web `prefs.js`; never sent to the server). Decoding is tolerant:
/// a missing or corrupt field falls back to its default, the app never fails to launch on it.
/// Saved stories live in SwiftData and the anonymous author id in the Keychain, not here.
public struct Preferences: Sendable, Hashable, Codable {
    public enum Theme: String, Sendable, Hashable, Codable, CaseIterable {
        case auto, light, dark
    }

    public var theme: Theme = .auto
    /// THE language: translation target and AI output language (web `targetLang`).
    public var targetLang: String = "en"
    public var autoTranslate = false
    public var hiddenSources: [String] = []
    /// Today's category (web `category`); `all` for the unfiltered feed.
    public var category: String = NewsCategory.all.rawValue
    /// Card size ladder −2…2 (web `gridSize`).
    public var gridSize = 0
    /// The ✦ Ahead forecast (web `forecast`, default on).
    public var forecast = true
    /// The tab the app reopens on.
    public var lastTab: String?
    /// Onboarding like/dislike profile for Your Feed.
    public var taste = TasteProfile()

    public init() {}

    public static let gridSizes = -2...2

    private enum CodingKeys: String, CodingKey {
        case theme, targetLang, autoTranslate, hiddenSources, category, gridSize, forecast, lastTab, taste
    }

    public init(from decoder: Decoder) throws {
        let defaults = Preferences()
        let c = try decoder.container(keyedBy: CodingKeys.self)
        theme = (try? c.decodeIfPresent(Theme.self, forKey: .theme)) ?? defaults.theme
        let lang = ((try? c.decodeIfPresent(String.self, forKey: .targetLang)) ?? nil) ?? defaults.targetLang
        targetLang = Language.isSupported(lang) ? lang : defaults.targetLang
        autoTranslate = (try? c.decodeIfPresent(Bool.self, forKey: .autoTranslate)) ?? defaults.autoTranslate
        hiddenSources = (try? c.decodeIfPresent([String].self, forKey: .hiddenSources)) ?? defaults.hiddenSources
        category = (try? c.decodeIfPresent(String.self, forKey: .category)) ?? defaults.category
        let size = (try? c.decodeIfPresent(Int.self, forKey: .gridSize)) ?? defaults.gridSize
        gridSize = min(Preferences.gridSizes.upperBound, max(Preferences.gridSizes.lowerBound, size))
        forecast = (try? c.decodeIfPresent(Bool.self, forKey: .forecast)) ?? defaults.forecast
        lastTab = (try? c.decodeIfPresent(String.self, forKey: .lastTab)) ?? nil
        taste = ((try? c.decodeIfPresent(TasteProfile.self, forKey: .taste)) ?? nil)?.sanitized() ?? defaults.taste
    }
}

/// The Your Feed taste profile (web `prefs.taste`): weights per source, category and title
/// entity. Key order is observable in the web (caps keep the first-inserted of equal weights),
/// so the maps are ordered and persist in order.
public struct TasteProfile: Sendable, Hashable, Codable {
    public var count = 0
    public var sources: OrderedDictionary<String, Double> = [:]
    public var cats: OrderedDictionary<String, Double> = [:]
    public var tokens: OrderedDictionary<String, Double> = [:]
    /// Rated article ids, newest first.
    public var rated: [String] = []

    public static let weightBound = 50.0
    public static let caps = (sources: 100, cats: 20, tokens: 400, rated: 300)

    public init(count: Int = 0,
                sources: OrderedDictionary<String, Double> = [:],
                cats: OrderedDictionary<String, Double> = [:],
                tokens: OrderedDictionary<String, Double> = [:],
                rated: [String] = []) {
        self.count = count
        self.sources = sources
        self.cats = cats
        self.tokens = tokens
        self.rated = rated
    }

    /// The web's `sanitizeTaste`: weights clamped to ±50; each map capped by |weight| (ties keep
    /// insertion order — a stable sort); rated ids must be 12-hex, newest 300.
    public func sanitized() -> TasteProfile {
        func weights(_ map: OrderedDictionary<String, Double>, cap: Int) -> OrderedDictionary<String, Double> {
            let clamped = map.compactMap { key, value -> (String, Double)? in
                guard value.isFinite else { return nil }
                return (key, min(TasteProfile.weightBound, max(-TasteProfile.weightBound, value)))
            }
            let kept = clamped.stableSorted { abs($0.1) > abs($1.1) }.prefix(cap)
            return OrderedDictionary(uniqueKeysWithValues: kept.map { ($0.0, $0.1) })
        }
        return TasteProfile(
            count: max(0, count),
            sources: weights(sources, cap: TasteProfile.caps.sources),
            cats: weights(cats, cap: TasteProfile.caps.cats),
            tokens: weights(tokens, cap: TasteProfile.caps.tokens),
            rated: Array(rated.filter(ArticleID.isValid).prefix(TasteProfile.caps.rated))
        )
    }
}

/// Article ids are the first 12 hex digits of sha1(normalized url).
public enum ArticleID {
    public static func isValid(_ id: String) -> Bool {
        id.utf8.count == 12 && id.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}

// MARK: - JavaScript compatibility

public extension Sequence {
    /// `Array.prototype.sort` is stable: elements the comparator calls equal keep their order.
    /// Ports sort with this (never plain `sorted`) wherever ties are observable.
    func stableSorted(by areInIncreasingOrder: (Element, Element) throws -> Bool) rethrows -> [Element] {
        try enumerated()
            .sorted { lhs, rhs in
                if try areInIncreasingOrder(lhs.element, rhs.element) { return true }
                if try areInIncreasingOrder(rhs.element, lhs.element) { return false }
                return lhs.offset < rhs.offset
            }
            .map(\.element)
    }
}
