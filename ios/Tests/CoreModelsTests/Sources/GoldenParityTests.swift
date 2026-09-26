import Foundation
import OrderedCollections
import Testing
import CoreModels

/// Golden parity: the Swift ports reproduce the web modules' outputs for the vectors exported by
/// ios/scripts/export-golden.mjs (run with --check in the gate, so a change on either side fails).
@Suite("Golden parity with the web client")
struct GoldenParityTests {
    // MARK: time.js

    struct TimeVectors: Decodable {
        struct Past: Decodable { let publishedAt: String; let freshness: String; let relTime: String }
        struct Future: Decodable { let dueAt: String; let relFuture: String }
        struct Invalid: Decodable { let input: String; let freshness: String; let relTime: String; let relFuture: String }
        let now: String
        let past: [Past]
        let future: [Future]
        let invalid: [Invalid]
    }

    @Test("time.js: freshness, relTime, relFuture and ISO round-trips")
    func time() throws {
        let vectors = try Fixtures.golden(TimeVectors.self, "time")
        let now = try #require(Timestamp.parse(vectors.now))
        for vector in vectors.past {
            let published = Timestamp.parse(vector.publishedAt)
            #expect(RelativeTime.freshness(published, now: now).rawValue == vector.freshness, "\(vector.publishedAt)")
            #expect(RelativeTime.relTime(published, now: now) == vector.relTime, "\(vector.publishedAt)")
            #expect(published.map(Timestamp.format) == vector.publishedAt, "toISOString round-trip")
        }
        for vector in vectors.future {
            #expect(RelativeTime.relFuture(Timestamp.parse(vector.dueAt), now: now) == vector.relFuture, "\(vector.dueAt)")
        }
        for vector in vectors.invalid {
            let parsed = Timestamp.parse(vector.input)
            #expect(parsed == nil)
            #expect(RelativeTime.freshness(parsed, now: now).rawValue == vector.freshness)
            #expect(RelativeTime.relTime(parsed, now: now) == vector.relTime)
            #expect(RelativeTime.relFuture(parsed, now: now) == vector.relFuture)
        }
    }

    // MARK: cards.js hashHue

    struct HueVectors: Decodable {
        struct Case: Decodable { let input: String; let hue: Int }
        let cases: [Case]
    }

    @Test("cards.js hashHue over UTF-16 code units")
    func hue() throws {
        let vectors = try Fixtures.golden(HueVectors.self, "hue")
        #expect(vectors.cases.count > 100)
        for vector in vectors.cases {
            #expect(SourceHue.hue(for: vector.input) == vector.hue, "\(vector.input)")
        }
    }

    // MARK: country.js

    struct CountryVectors: Decodable {
        struct Name: Decodable { let code: String?; let name: String }
        struct Of: Decodable {
            struct Result: Decodable { let kind: String; let code: String? }
            let source: ArticleSource
            let result: Result
        }
        let names: [Name]
        let countryOf: [Of]
    }

    /// Where Apple's region names intentionally differ from the web's ICU (see CountryNames).
    static let appleNames = ["HK": "Hong Kong"]

    @Test("country.js: names for every registry code and region; countryOf resolution")
    func country() throws {
        let vectors = try Fixtures.golden(CountryVectors.self, "country")
        for vector in vectors.names {
            let expected = vector.code.flatMap { Self.appleNames[$0] } ?? vector.name
            #expect(CountryNames.name(for: Provenance(code: vector.code)) == expected, "\(vector.code ?? "null")")
        }
        let registry = try Fixtures.decodeAPI(SourcesResponse.self, "sources").provenanceRegistry
        for vector in vectors.countryOf {
            let resolved = vector.source.provenance.resolved(sourceID: vector.source.id, registry: registry)
            switch vector.result.kind {
            case "unknown": #expect(resolved == .unknown, "\(vector.source)")
            case "none": #expect(resolved == .international, "\(vector.source)")
            default: #expect(resolved.code == vector.result.code, "\(vector.source)")
            }
        }
    }

    // MARK: prefs.js sanitizeTaste

    struct PrefsVectors: Decodable {
        struct Taste: Decodable {
            let count: JSValue?
            let sources: [Pair]
            let cats: [Pair]
            let tokens: [Pair]
            let rated: [JSValue]
        }
        struct Case: Decodable {
            struct Out: Decodable { let taste: Taste }
            let inputTaste: Taste?
            let prefs: Out
        }
        let cases: [Case]
    }

    /// Builds the profile the way the web's sanitizer sees its input: `Number(v)` per weight
    /// (non-finite values dropped), `Math.trunc(Number(count))`, string ids only.
    private func profile(_ taste: PrefsVectors.Taste) -> TasteProfile {
        func map(_ pairs: [Pair]) -> OrderedDictionary<String, Double> {
            var out: OrderedDictionary<String, Double> = [:]
            for pair in pairs where pair.value.number.isFinite { out[pair.key] = pair.value.number }
            return out
        }
        let count = taste.count.map { value -> Int in
            let number = value.number
            return number.isFinite ? Int(number.rounded(.towardZero)) : 0
        } ?? 0
        return TasteProfile(
            count: count,
            sources: map(taste.sources), cats: map(taste.cats), tokens: map(taste.tokens),
            rated: taste.rated.compactMap(\.string)
        )
    }

    @Test("prefs.js sanitizeTaste: clamps, caps by |weight| with stable ties, 12-hex rated ids")
    func taste() throws {
        let vectors = try Fixtures.golden(PrefsVectors.self, "prefs")
        for (index, vector) in vectors.cases.enumerated() {
            let expected = profile(vector.prefs.taste)
            let actual = vector.inputTaste.map { profile($0).sanitized() } ?? TasteProfile()
            // OrderedDictionary equality is order-sensitive: the caps must keep the same keys in the same order
            #expect(actual == expected, "case \(index)")
        }
    }

    // MARK: i18n.js

    struct StringVectors: Decodable {
        let en: [String: String]
        let languages: [Language]
        let categories: [String]
    }

    @Test("the String Catalog speaks the web's English table, key for key")
    func strings() throws {
        let vectors = try Fixtures.golden(StringVectors.self, "strings")
        #expect(vectors.en.count == 203)
        for (key, value) in vectors.en {
            #expect(L10n.t(key) == value, "\(key)")
        }
        #expect(Language.all == vectors.languages)
        #expect(NewsCategory.feed.map(\.rawValue) == vectors.categories)
        #expect(L10n.t("time.min", ["n": "5"]) == "5 MIN AGO")
        #expect(L10n.t("no.such.key") == "no.such.key")
        #expect(NewsCategory.technology.label == "Tech")
        #expect(NewsCategory.label(for: "saved") == "Your Feed")
        #expect(NewsCategory.label(for: "mystery") == "MYSTERY")
    }
}
