import CoreModels
import Dependencies
import Foundation
import Networking

/// Translated texts and the rung that produced them.
public struct TranslationResult: Sendable, Equatable {
    public let texts: [String]
    public let provider: String

    public init(texts: [String], provider: String) {
        self.texts = texts
        self.provider = provider
    }
}

/// A summary and where it came from — the badge under KEY POINTS (`TextKit.providerLabel`).
public struct SummaryResult: Sendable, Equatable {
    public let summary: String
    public let provider: String

    public init(summary: String, provider: String) {
        self.summary = summary
        self.provider = provider
    }

    /// Display bullets (web `toBullets`).
    public var bullets: [String] { TextKit.toBullets(summary) }
}

/// The translate ladder (web ai.js:264-297): [on-device Translation — P6] → `POST /api/translate`
/// in batches of 20 texts, each cut to 1000 UTF-16 units. `nil` when no rung could translate: the
/// caller keeps the original and says so (`lang.unavailable`).
public struct Translator: Sendable {
    public var translate: @Sendable (_ texts: [String], _ target: String, _ source: String) async -> TranslationResult?

    public init(translate: @escaping @Sendable (_ texts: [String], _ target: String, _ source: String) async -> TranslationResult?) {
        self.translate = translate
    }
}

public extension Translator {
    /// The ladder over whatever `meridianAPI` is current when it runs.
    static func ladder() -> Translator {
        Translator { texts, target, source in
            if texts.isEmpty { return TranslationResult(texts: [], provider: "none") }
            if target == source { return TranslationResult(texts: texts, provider: "none") }
            @Dependency(\.meridianAPI) var api
            do {
                var out: [String] = []
                var provider = "server"
                for start in stride(from: 0, to: texts.count, by: 20) {
                    let batch = texts[start..<min(texts.count, start + 20)].map { TextKit.jsPrefix($0, 1000) }
                    let response = try await api.translate(batch, target, source)
                    guard response.translations.count == batch.count else { return nil }
                    out += response.translations
                    if let name = response.provider, !name.isEmpty { provider = name }
                }
                return TranslationResult(texts: out, provider: provider)
            } catch {
                return nil // 501 no provider, 429, offline…
            }
        }
    }
}

extension Translator: DependencyKey {
    public static var liveValue: Translator { .ladder() }
    public static var testValue: Translator { .ladder() }
}

/// The summarize ladder (web ai.js:123-178): [on-device model — P7] → `POST /api/summarize` (a 501
/// means the free server has no model: remembered, never asked again this session) → the local
/// extractive port. Never fails.
public struct Summarizer: Sendable {
    public var article: @Sendable (_ title: String, _ text: String, _ targetLang: String) async -> SummaryResult

    public init(article: @escaping @Sendable (_ title: String, _ text: String, _ targetLang: String) async -> SummaryResult) {
        self.article = article
    }
}

public extension Summarizer {
    static func ladder() -> Summarizer {
        let serverUnavailable = LockedValue(false)
        return Summarizer { title, text, targetLang in
            @Dependency(\.meridianAPI) var api
            if !serverUnavailable.value {
                do {
                    let response = try await api.summarize(.article(title: title, text: text, targetLang: targetLang))
                    if !response.summary.isEmpty {
                        return SummaryResult(summary: response.summary, provider: response.provider ?? "server")
                    }
                } catch {
                    if (error as? APIError)?.status == 501 { serverUnavailable.update { $0 = true } }
                }
            }
            return local(text)
        }
    }

    /// The last rung: the article's own most representative sentences.
    static func local(_ text: String) -> SummaryResult {
        SummaryResult(summary: TextKit.extractive(TextKit.splitSentences(text), max: 5).joined(separator: "\n"), provider: "local")
    }
}

extension Summarizer: DependencyKey {
    public static var liveValue: Summarizer { .ladder() }
    public static var testValue: Summarizer { .ladder() }
}

public extension DependencyValues {
    var translator: Translator {
        get { self[Translator.self] }
        set { self[Translator.self] = newValue }
    }

    var summarizer: Summarizer {
        get { self[Summarizer.self] }
        set { self[Summarizer.self] = newValue }
    }
}
