import CoreModels
import Dependencies
import Foundation

/// A finished forecast run (web `generateForecast` + the translation step of forecast.js `run`).
public struct ForecastRun: Sendable, Equatable {
    public let forecasts: [Forecast]
    /// The language the headlines are in (the reader's, unless the translation failed).
    public let language: String
    /// "on-device" or "mock".
    public let provider: String
    public let generatedAt: Int64

    public init(forecasts: [Forecast], language: String, provider: String, generatedAt: Int64) {
        self.forecasts = forecasts
        self.language = language
        self.provider = provider
        self.generatedAt = generatedAt
    }
}

/// "What may happen next" (web ai.js `generateForecast`): four speculative events for the next
/// seven days, drafted by the on-device model from the stories in view — six candidates, the most
/// concrete four kept; a run that only restated the news is retried once; headlines in another
/// language than the reader's go through the translate ladder. On-device only: without the model
/// the feature does not exist.
public struct Forecaster: Sendable {
    public var run: @Sendable (_ pool: [ForecastArticle], _ targetLang: String) async throws -> ForecastRun

    public init(run: @escaping @Sendable (_ pool: [ForecastArticle], _ targetLang: String) async throws -> ForecastRun) {
        self.run = run
    }
}

public extension Forecaster {
    /// Prompt budget: the model's context is 4096 tokens, shared by the instructions, the worked
    /// example, the stories, the answer's schema and the answer (≤ 1400 tokens); the stories are
    /// trimmed (the least forecastable last) until the prompt fits (web measureContextUsage).
    static let promptCharacterBudget = 8_000

    static func ladder() -> Forecaster {
        Forecaster { input, target in
            @Dependency(\.languageModel) var model
            @Dependency(\.date) var date
            guard model.availability() == .available else { throw LanguageModelError.unavailable }
            guard input.count >= ForecastKit.minArticles else { throw ForecastError.tooFew }
            let now = Int64(date.now.timeIntervalSince1970 * 1000)
            let mock = model.provider == "mock"
            let lang = ForecastKit.outputLanguages.contains(target) ? model.outputLanguage(for: target) : "en"
            let instructions = ForecastKit.systemPrompt(lang)
            var pool = input
            while pool.count > ForecastKit.minArticles,
                  instructions.count + ForecastKit.exampleUser.count + ForecastKit.exampleAssistant.count
                  + ForecastKit.userPrompt(pool, now: now).count > promptCharacterBudget {
                pool = Array(pool.dropLast(3))
            }

            var forecasts: [Forecast] = []
            for attempt in 0..<2 {
                do {
                    if mock {
                        // the web's mock session: its own drafts, loosely sanitized
                        try await Task.sleep(for: .milliseconds(600))
                        forecasts = try ForecastKit.sanitize(ForecastKit.json(ForecastKit.mockDrafts(for: pool)),
                                                             articles: pool, generatedAt: now, strict: false)
                    } else {
                        let prompt = ForecastKit.userPrompt(pool, now: now)
                        let drafts = try await withDeadline(45) {
                            try await model.forecast(instructions, ForecastKit.exampleUser, ForecastKit.exampleAssistant, prompt)
                        }
                        forecasts = try ForecastKit.sanitize(ForecastKit.json(drafts), articles: pool, generatedAt: now)
                    }
                    break
                } catch let error as ForecastError where error != .error && attempt == 0 {
                    continue // the model echoed or waffled instead of extrapolating — one more try
                }
            }

            var language = lang
            if lang != target {
                // the model wrote a language the reader did not ask for: headline + reasoning
                // through the ladder the cards use
                @Dependency(\.translator) var translator
                let flat = forecasts.flatMap { [$0.headline, $0.why] }
                if let translated = await translator.translate(flat, target, lang, true), translated.texts.count == flat.count {
                    forecasts = forecasts.enumerated().map { index, forecast in
                        forecast.translated(
                            headline: translated.texts[2 * index].isEmpty ? forecast.headline : translated.texts[2 * index],
                            why: translated.texts[2 * index + 1].isEmpty ? forecast.why : translated.texts[2 * index + 1]
                        )
                    }
                    language = target
                }
            }
            return ForecastRun(forecasts: forecasts, language: language, provider: mock ? "mock" : "on-device", generatedAt: now)
        }
    }
}

extension Forecaster: DependencyKey {
    public static var liveValue: Forecaster { .ladder() }
    public static var testValue: Forecaster { .ladder() }
}

public extension DependencyValues {
    var forecaster: Forecaster {
        get { self[Forecaster.self] }
        set { self[Forecaster.self] = newValue }
    }
}
