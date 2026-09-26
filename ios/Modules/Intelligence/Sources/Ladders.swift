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

/// On-device translation (Apple's Translation framework, implemented in AppleAI). Language packs
/// are downloaded only when the reader asks — `prepare` shows the system sheet — so background
/// work uses installed pairs only.
public struct OnDeviceTranslation: Sendable {
    public enum Availability: Sendable, Equatable {
        /// The pair works now, offline.
        case installed
        /// The system can download it (after the reader agrees).
        case downloadable
        case unsupported
    }

    public var availability: @Sendable (_ source: String, _ target: String) async -> Availability
    /// Translates with an installed pair (throws otherwise). One output per input, in order.
    public var translate: @Sendable (_ texts: [String], _ source: String, _ target: String) async throws -> [String]
    /// Asks the system to download the pair; true once it is installed.
    public var prepare: @Sendable (_ source: String, _ target: String) async -> Bool

    public init(
        availability: @escaping @Sendable (_ source: String, _ target: String) async -> Availability,
        translate: @escaping @Sendable (_ texts: [String], _ source: String, _ target: String) async throws -> [String],
        prepare: @escaping @Sendable (_ source: String, _ target: String) async -> Bool
    ) {
        self.availability = availability
        self.translate = translate
        self.prepare = prepare
    }

    /// No on-device translation (older devices, tests): the ladder starts at the server.
    public static let unavailable = OnDeviceTranslation(
        availability: { _, _ in .unsupported },
        translate: { _, _, _ in throw CancellationError() },
        prepare: { _, _ in false }
    )
}

extension OnDeviceTranslation: DependencyKey {
    /// The app installs Apple's implementation at launch (AppleAI); nothing until then.
    public static var liveValue: OnDeviceTranslation { .unavailable }
    public static var testValue: OnDeviceTranslation { .unavailable }
}

/// The translate ladder (web ai.js:264-297): the on-device translator when the pair is installed —
/// or, for something the reader asked for (`interactive`), once they let the system download it —
/// then `POST /api/translate` in batches of 20 texts, each cut to 1000 UTF-16 units. `nil` when no
/// rung could translate: the caller keeps the original and says so (`ios.lang.unavailable`).
public struct Translator: Sendable {
    public var translate: @Sendable (_ texts: [String], _ target: String, _ source: String, _ interactive: Bool) async -> TranslationResult?

    public init(translate: @escaping @Sendable (_ texts: [String], _ target: String, _ source: String, _ interactive: Bool) async -> TranslationResult?) {
        self.translate = translate
    }
}

public extension Translator {
    /// The ladder over whatever `onDeviceTranslation` and `meridianAPI` are current when it runs.
    static func ladder() -> Translator {
        Translator { texts, target, source, interactive in
            if texts.isEmpty { return TranslationResult(texts: [], provider: "none") }
            if target == source { return TranslationResult(texts: texts, provider: "none") }
            @Dependency(\.onDeviceTranslation) var onDevice
            var availability = await onDevice.availability(source, target)
            if availability == .downloadable, interactive, await onDevice.prepare(source, target) {
                availability = .installed
            }
            if availability == .installed,
               let out = try? await onDevice.translate(texts, source, target), out.count == texts.count {
                return TranslationResult(texts: out, provider: "on-device")
            }
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

/// The summarize ladder (web ai.js:123-178): the on-device model (Apple Intelligence) → `POST
/// /api/summarize` (a 501 means the free server has no model: remembered, never asked again this
/// session) → the local port (extractive key points, the entity-grouped brief). Never fails.
public struct Summarizer: Sendable {
    /// KEY POINTS of one story.
    public var article: @Sendable (_ title: String, _ text: String, _ targetLang: String) async -> SummaryResult
    /// The BRIEF of the stories in view (`topic`: the category's name, "" for all).
    public var brief: @Sendable (_ items: [DigestItem], _ topic: String, _ targetLang: String) async -> SummaryResult

    public init(
        article: @escaping @Sendable (_ title: String, _ text: String, _ targetLang: String) async -> SummaryResult,
        brief: @escaping @Sendable (_ items: [DigestItem], _ topic: String, _ targetLang: String) async -> SummaryResult
    ) {
        self.article = article
        self.brief = brief
    }
}

public extension Summarizer {
    static func ladder() -> Summarizer {
        let serverUnavailable = LockedValue(false)
        @Sendable func server(_ request: SummarizeRequest) async -> SummaryResult? {
            guard !serverUnavailable.value else { return nil }
            @Dependency(\.meridianAPI) var api
            do {
                let response = try await api.summarize(request)
                return response.summary.isEmpty ? nil : SummaryResult(summary: response.summary, provider: response.provider ?? "server")
            } catch {
                if (error as? APIError)?.status == 501 { serverUnavailable.update { $0 = true } }
                return nil
            }
        }
        return Summarizer(
            article: { title, text, targetLang in
                let task = "You summarize a news article titled \"\(title.jsPrefix(160))\" for a busy reader. Write 3 to 5 key points"
                if let result = await model(task, corpus: text, targetLang: targetLang) { return result }
                if let result = await server(.article(title: title, text: text, targetLang: targetLang)) { return result }
                return local(text)
            },
            brief: { items, topic, targetLang in
                let corpus = items.map { "\($0.title) \u{2014} \($0.description) (\($0.source))" }.joined(separator: "\n")
                let task = "You write a news brief from independent \(topic.isEmpty ? "" : topic + " ")news headlines from many sources. "
                    + "Extract the most important stories as 5 to 7 key points"
                if let result = await model(task, corpus: corpus, targetLang: targetLang) { return result }
                let headlines = items.prefix(30).map { SummarizeRequest.Headline(title: $0.title, description: $0.description, source: $0.source) }
                if let result = await server(.brief(Array(headlines), targetLang: targetLang)) { return result }
                return SummaryResult(summary: LocalDigest.brief(items).joined(separator: "\n"), provider: "local")
            }
        )
    }

    /// The last rung: the article's own most representative sentences.
    static func local(_ text: String) -> SummaryResult {
        SummaryResult(summary: TextKit.extractive(TextKit.splitSentences(text), max: 5).joined(separator: "\n"), provider: "local")
    }

    /// The on-device rung: the model writes in the reader's language when it can, otherwise in
    /// English and the bullets go through the translate ladder. Nil on anything short of a clean
    /// answer (no model, refusal, timeout) — the next rung takes over.
    private static func model(_ task: String, corpus: String, targetLang: String) async -> SummaryResult? {
        @Dependency(\.languageModel) var model
        guard model.availability() == .available else { return nil }
        let language = model.outputLanguage(for: targetLang)
        let name = Locale(identifier: "en").localizedString(forLanguageCode: language) ?? "English"
        let instructions = task + " in \(name), one per line, each starting with \"- \". "
            + "Use only facts stated in the text. No introduction and no conclusion."
        let prompt = corpus.jsPrefix(6000) // on-device inference over huge inputs takes ages (web)
        guard let answer = try? await withDeadline(35, { try await model.respond(instructions, prompt) }) else { return nil }
        let text = TextKit.jsTrim(answer)
        guard !text.isEmpty, !Refusal.isRefusal(text) else { return nil }
        guard language != targetLang else { return SummaryResult(summary: text, provider: "on-device") }
        @Dependency(\.translator) var translator
        let bullets = TextKit.toBullets(text)
        guard let translated = await translator.translate(bullets, targetLang, language, false),
              translated.texts.count == bullets.count else { return SummaryResult(summary: text, provider: "on-device") }
        return SummaryResult(summary: translated.texts.joined(separator: "\n"), provider: "on-device")
    }
}

extension Summarizer: DependencyKey {
    public static var liveValue: Summarizer { .ladder() }
    public static var testValue: Summarizer { .ladder() }
}

public extension DependencyValues {
    var onDeviceTranslation: OnDeviceTranslation {
        get { self[OnDeviceTranslation.self] }
        set { self[OnDeviceTranslation.self] = newValue }
    }

    var translator: Translator {
        get { self[Translator.self] }
        set { self[Translator.self] = newValue }
    }

    var summarizer: Summarizer {
        get { self[Summarizer.self] }
        set { self[Summarizer.self] = newValue }
    }
}
