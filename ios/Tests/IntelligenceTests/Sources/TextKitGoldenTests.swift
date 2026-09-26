import CoreModels
import Foundation
import Intelligence
import Testing

/// The ai.js text helpers, replayed against vectors exported from the real web module.
@Suite("ai.js text helpers — golden parity")
struct TextKitGoldenTests {
    struct Vectors: Decodable {
        struct Split: Decodable { let text: String; let sentences: [String] }
        struct Extract: Decodable { let max: Int; let sentences: [String]; let result: [String] }
        struct Bullets: Decodable { let summary: String; let max: Int; let bullets: [String] }
        struct Tokens: Decodable { let title: String; let tokens: [[String]] }
        struct Brief: Decodable {
            struct Item: Decodable { let title: String; let description: String; let source: String; let publishedAt: String? }
            let articles: [Item]
            let lines: [String]
        }
        struct Chunk: Decodable { let text: String; let maxLen: Int; let chunks: [String] }
        struct Label: Decodable { let provider: String; let label: String }

        let stopwords: [String]
        let splitSentences: [Split]
        let extractive: [Extract]
        let toBullets: [Bullets]
        let entityTokens: [Tokens]
        let briefDigest: [Brief]
        let chunkParagraph: [Chunk]
        let providerLabels: [Label]
    }

    private let vectors: Vectors

    init() throws {
        vectors = try Fixtures.golden(Vectors.self, "ai")
    }

    @Test("STOPWORDS match the web list")
    func stopwords() {
        #expect(TextKit.stopwords == Set(vectors.stopwords))
    }

    @Test("splitSentences")
    func sentences() {
        for vector in vectors.splitSentences {
            #expect(TextKit.splitSentences(vector.text) == vector.sentences, "\(vector.text)")
        }
    }

    @Test("extractive keeps the highest-scoring sentences in order (stable ties)")
    func extractive() {
        for vector in vectors.extractive {
            #expect(TextKit.extractive(vector.sentences, max: vector.max) == vector.result)
        }
    }

    @Test("toBullets")
    func bullets() {
        for vector in vectors.toBullets {
            #expect(TextKit.toBullets(vector.summary, max: vector.max) == vector.bullets, "\(vector.summary)")
        }
    }

    @Test("entityTokens: unicode-aware, ordered, bigrams first")
    func entityTokens() {
        for vector in vectors.entityTokens {
            let tokens = TextKit.entityTokens(vector.title).map { [$0.key, $0.value] }
            #expect(tokens == vector.tokens, "\(vector.title)")
        }
    }

    @Test("briefDigest: grouped lines, freshest lede, Also: singletons")
    func briefDigest() {
        for vector in vectors.briefDigest {
            let items = vector.articles.map {
                DigestItem(title: $0.title, description: $0.description, source: $0.source,
                           publishedAt: $0.publishedAt.flatMap(Timestamp.init(iso:)))
            }
            #expect(LocalDigest.brief(items) == vector.lines)
        }
    }

    @Test("chunkParagraph respects the translate limit on sentence boundaries")
    func chunks() {
        for vector in vectors.chunkParagraph {
            #expect(TextKit.chunkParagraph(vector.text, maxLength: vector.maxLen) == vector.chunks, "max \(vector.maxLen)")
        }
    }

    @Test("provider labels")
    func labels() {
        for vector in vectors.providerLabels {
            #expect(TextKit.providerLabel(vector.provider) == vector.label)
        }
    }
}
