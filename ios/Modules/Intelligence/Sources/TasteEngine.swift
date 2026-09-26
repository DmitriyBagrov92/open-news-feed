import CoreModels
import Foundation
import OrderedCollections

/// The Your Feed taste engine (web recommend.js): pure logic over the device-only profile —
/// weights per source, category and title entity, accumulated from onboarding likes (+) and
/// skips (−). Golden-tested against the web module.
public enum TasteEngine {
    /// Stories per onboarding round (web `ONBOARD_BATCH`); Your Feed ranks once this many are rated.
    public static let batch = 5
    /// The onboarding deck: diverse and unseen.
    public static let deckSize = 40

    /// web `applyRating`: `dir` 1 = like, −1 = skip. The source counts double, the category once,
    /// the headline's first six entities once each; the story joins `rated`, newest first.
    public static func apply(_ taste: inout TasteProfile, _ article: Article, dir: Int) {
        bump(&taste.sources, article.source.id, 2 * dir)
        bump(&taste.cats, article.category, dir)
        for token in TextKit.entityTokens(article.title).keys.prefix(6) {
            bump(&taste.tokens, token, dir)
        }
        taste.rated.insert(article.id, at: 0)
        if taste.rated.count > TasteProfile.caps.rated { taste.rated.removeLast(taste.rated.count - TasteProfile.caps.rated) }
        taste.count += 1
    }

    /// web `pickOnboardingCandidates`: round-robin across categories (in order of first
    /// appearance), at most one story per source, rated and saved stories left out.
    public static func onboardingCandidates(_ articles: [Article], taste: TasteProfile, saved: Set<String>,
                                            max: Int = deckSize) -> [Article] {
        let rated = Set(taste.rated)
        var lanes: OrderedDictionary<String, [Article]> = [:]
        for article in articles where !rated.contains(article.id) && !saved.contains(article.id) {
            lanes[article.category, default: []].append(article)
        }
        var queues = Array(lanes.values).map { ArraySlice($0) }
        var usedSources = Set<String>()
        var out: [Article] = []
        while out.count < max {
            var took = false
            for index in queues.indices {
                while let article = queues[index].popFirst() {
                    guard usedSources.insert(article.source.id).inserted else { continue }
                    out.append(article)
                    took = true
                    break
                }
                if out.count >= max { break }
            }
            if !took { break }
        }
        return out
    }

    /// A ranked Your Feed and whether the profile actually shaped it.
    public struct Ranking: Sendable, Equatable {
        public let articles: [Article]
        /// Some story scored above bare freshness (web: `score > 2.05`); otherwise the reader
        /// is told the feed shows the freshest for now.
        public let personalized: Bool
    }

    /// web `rankForYou`: source affinity + category affinity + entity overlap + freshness, each
    /// clamped so one favourite cannot drown the rest; newest first on ties; at most 4 stories
    /// per source; 30 stories.
    public static func rank(_ articles: [Article], taste: TasteProfile, saved: Set<String>, now: Int64) -> Ranking {
        let rated = Set(taste.rated)
        var scored: [(article: Article, score: Double)] = []
        for article in articles where !rated.contains(article.id) && !saved.contains(article.id) {
            let source = taste.sources[article.source.id] ?? 0
            let category = taste.cats[article.category] ?? 0
            var tokens = 0.0
            for token in TextKit.entityTokens(article.title).keys { tokens += taste.tokens[token] ?? 0 }
            let ageHours = Swift.max(0, Double(now - article.publishedAt.milliseconds) / 3_600_000)
            let score = 2 * clamp(source, 6) + 1.5 * clamp(category, 6) + clamp(tokens, 4) + Swift.max(0, 2 * (1 - ageHours / 24))
            scored.append((article, score))
        }
        let ordered = scored.stableSorted { lhs, rhs in
            if lhs.score != rhs.score { return lhs.score > rhs.score }
            return lhs.article.publishedAt > rhs.article.publishedAt
        }
        let personalized = scored.contains { $0.score > 2.05 }
        var perSource: [String: Int] = [:]
        var top: [Article] = []
        for (article, _) in ordered {
            let count = perSource[article.source.id, default: 0]
            guard count < 4 else { continue }
            perSource[article.source.id] = count + 1
            top.append(article)
            if top.count >= 30 { break }
        }
        return Ranking(articles: top, personalized: personalized)
    }

    private static func bump(_ map: inout OrderedDictionary<String, Double>, _ key: String, _ delta: Int) {
        guard !key.isEmpty else { return } // web: `if (!key) return`
        map[key] = Swift.min(TasteProfile.weightBound, Swift.max(-TasteProfile.weightBound, (map[key] ?? 0) + Double(delta)))
    }

    private static func clamp(_ value: Double, _ bound: Double) -> Double {
        Swift.min(bound, Swift.max(-bound, value))
    }
}
