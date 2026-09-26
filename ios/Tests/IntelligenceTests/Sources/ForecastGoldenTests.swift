import CoreModels
import Foundation
import Intelligence
import Testing

/// The forecast helpers of ai.js, replayed against vectors exported from the real web module.
@Suite("ai.js forecast — golden parity")
struct ForecastGoldenTests {
    struct Vectors: Decodable {
        struct Cue: Decodable { let title: String; let description: String; let score: Int }
        struct Entities: Decodable { let text: String; let entities: [String] }
        struct PoolItem: Decodable {
            let id: String
            let title: String
            let description: String
            let source: String
            let publishedAt: String
        }
        struct Out: Decodable {
            let headline: String
            let why: String
            let timeframe: String
            let hours: Int
            let dueAt: String
            let confidence: String
            let basis: [String]
        }
        struct Sanitize: Decodable {
            let name: String
            let raw: String
            let strict: Bool
            let result: [Out]?
            let error: String?
        }
        struct Mock: Decodable { let headline: String; let timeframe: String; let confidence: String }
        struct Forecast: Decodable {
            let now: String
            let pool: [PoolItem]
            let count: Int
            let candidates: Int
            let timeframes: [String: Int]
            let maxHeadline: Int
            let maxWhy: Int
            let minArticles: Int
            let outputLangs: [String]
            let languageNames: [String: String]
            let systemPrompt: [String: String]
            let exampleUser: String
            let exampleAssistant: String
            let exampleEntities: [String]
            let userPrompt: String
            let mock: [Mock]
            let sanitize: [Sanitize]
        }

        let forecastability: [Cue]
        let forecastEntities: [Entities]
        let forecast: Forecast
    }

    private let vectors: Vectors

    init() throws {
        vectors = try Fixtures.golden(Vectors.self, "ai")
    }

    private var pool: [ForecastArticle] {
        vectors.forecast.pool.map {
            ForecastArticle(id: $0.id, title: $0.title, description: $0.description, source: $0.source,
                            publishedAt: Timestamp(iso: $0.publishedAt) ?? Timestamp(milliseconds: 0))
        }
    }

    private var now: Int64 { Timestamp(iso: vectors.forecast.now)?.milliseconds ?? 0 }

    @Test("constants match the web")
    func constants() {
        let web = vectors.forecast
        #expect(ForecastKit.count == web.count && ForecastKit.candidates == web.candidates)
        #expect(Dictionary(uniqueKeysWithValues: ForecastKit.timeframes.map { ($0.key, $0.value) }) == web.timeframes)
        #expect(ForecastKit.timeframes.keys.elementsEqual(["24h", "48h", "3d", "7d"]))
        #expect(ForecastKit.maxHeadline == web.maxHeadline && ForecastKit.maxWhy == web.maxWhy)
        #expect(ForecastKit.minArticles == web.minArticles)
        #expect(ForecastKit.outputLanguages == Set(web.outputLangs))
        #expect(ForecastKit.languageNames == web.languageNames)
        #expect(ForecastKit.exampleEntities == web.exampleEntities)
    }

    @Test("the prompts and the worked example, verbatim")
    func prompts() {
        let web = vectors.forecast
        for (lang, prompt) in web.systemPrompt {
            #expect(ForecastKit.systemPrompt(lang) == prompt, "system prompt \(lang)")
        }
        #expect(ForecastKit.exampleUser == web.exampleUser)
        #expect(ForecastKit.exampleAssistant == web.exampleAssistant)
        #expect(ForecastKit.userPrompt(pool, now: now) == web.userPrompt)
    }

    @Test("forecastability counts the upcoming-event cues")
    func forecastability() {
        for vector in vectors.forecastability {
            #expect(ForecastKit.forecastability(title: vector.title, description: vector.description) == vector.score, "\(vector.title)")
        }
    }

    @Test("forecastEntities: names and figures, in order")
    func entities() {
        for vector in vectors.forecastEntities {
            #expect(Array(ForecastKit.entities(vector.text)) == vector.entities, "\(vector.text)")
        }
    }

    @Test("sanitizeForecast: echoes, the example, clichés, bad JSON, the most concrete four soonest first")
    func sanitize() {
        for vector in vectors.forecast.sanitize {
            do {
                let result = try ForecastKit.sanitize(vector.raw, articles: pool, generatedAt: now, strict: vector.strict)
                #expect(vector.error == nil, "\(vector.name): expected \(vector.error ?? "")")
                let expected = vector.result ?? []
                #expect(result.map(\.headline) == expected.map(\.headline), "\(vector.name)")
                #expect(result.map(\.why) == expected.map(\.why), "\(vector.name)")
                #expect(result.map(\.timeframe) == expected.map(\.timeframe), "\(vector.name)")
                #expect(result.map(\.hours) == expected.map(\.hours), "\(vector.name)")
                #expect(result.map { Timestamp.format($0.dueAt) } == expected.map(\.dueAt), "\(vector.name)")
                #expect(result.map(\.confidence) == expected.map(\.confidence), "\(vector.name)")
                #expect(result.map(\.basis) == expected.map(\.basis), "\(vector.name)")
            } catch let error as ForecastError {
                #expect(error.rawValue == vector.error, "\(vector.name)")
            } catch {
                Issue.record("\(vector.name): \(error)")
            }
        }
    }

    @Test("the mock forecasts (the fake model in UI tests) match the web's")
    func mock() {
        #expect(ForecastKit.mock.map(\.headline) == vectors.forecast.mock.map(\.headline))
        #expect(ForecastKit.mock.map(\.timeframe) == vectors.forecast.mock.map(\.timeframe))
        #expect(ForecastKit.mock.map(\.confidence) == vectors.forecast.mock.map(\.confidence))
    }
}
