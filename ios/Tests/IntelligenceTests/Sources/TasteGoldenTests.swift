import CoreModels
import Foundation
import Intelligence
import OrderedCollections
import Testing

/// The Your Feed taste engine, replayed against vectors exported from the real recommend.js.
@Suite("recommend.js — golden parity")
struct TasteGoldenTests {
    struct Vectors: Decodable {
        struct Taste: Decodable {
            let count: Int
            let sources: [Pair]
            let cats: [Pair]
            let tokens: [Pair]
            let rated: [String]
        }
        struct Rating: Decodable {
            let articleId: String
            let dir: Int
            let taste: Taste
        }
        struct Onboarding: Decodable {
            let taste: Taste
            let savedIds: [String]
            let max: Int
            let ids: [String]
        }
        struct Ranking: Decodable {
            let taste: Taste
            let savedIds: [String]
            let ids: [String]
            let personalized: Bool
        }
        let now: String
        let pool: [Article]
        let ratings: [Rating]
        let onboarding: [Onboarding]
        let ranking: [Ranking]
    }

    private let vectors: Vectors

    init() throws {
        vectors = try Fixtures.golden(Vectors.self, "recommend")
    }

    /// The web's profile with its maps in insertion order (`Object.entries`).
    private func profile(_ taste: Vectors.Taste) -> TasteProfile {
        func map(_ pairs: [Pair]) -> OrderedDictionary<String, Double> {
            OrderedDictionary(uniqueKeysWithValues: pairs.map { ($0.key, $0.value.number) })
        }
        return TasteProfile(count: taste.count, sources: map(taste.sources), cats: map(taste.cats),
                            tokens: map(taste.tokens), rated: taste.rated)
    }

    @Test("applyRating: the source counts double, the category once, six entities; rated newest first")
    func ratings() throws {
        var taste = TasteProfile()
        for (step, rating) in vectors.ratings.enumerated() {
            let article = try #require(vectors.pool.first { $0.id == rating.articleId })
            TasteEngine.apply(&taste, article, dir: rating.dir)
            // OrderedDictionary equality is order-sensitive: new keys join at the end, like a JS object
            #expect(taste == profile(rating.taste), "step \(step)")
        }
    }

    @Test("pickOnboardingCandidates: round-robin across categories, one story per source, unseen only")
    func onboarding() {
        for (index, vector) in vectors.onboarding.enumerated() {
            let ids = TasteEngine.onboardingCandidates(vectors.pool, taste: profile(vector.taste),
                                                       saved: Set(vector.savedIds), max: vector.max).map(\.id)
            #expect(ids == vector.ids, "case \(index)")
        }
    }

    @Test("rankForYou: affinity + entities + freshness, newest first on ties, 4 per source, 30 stories")
    func ranking() throws {
        let now = try #require(Timestamp(iso: vectors.now)).milliseconds
        for (index, vector) in vectors.ranking.enumerated() {
            let ranking = TasteEngine.rank(vectors.pool, taste: profile(vector.taste), saved: Set(vector.savedIds), now: now)
            #expect(ranking.articles.map(\.id) == vector.ids, "case \(index)")
            #expect(ranking.personalized == vector.personalized, "case \(index)")
        }
    }
}
