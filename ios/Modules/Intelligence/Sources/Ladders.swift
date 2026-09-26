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
