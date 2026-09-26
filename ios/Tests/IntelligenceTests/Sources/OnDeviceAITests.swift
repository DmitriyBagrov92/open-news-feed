import CoreModels
import Dependencies
import Foundation
import Intelligence
import Networking
import Testing

/// The on-device rungs (P7): Apple Intelligence first in the summarize ladder, and the forecast
/// runner (web ai.js `generateForecast` + forecast.js `run`) — over a scripted model, never the
/// real one.
@Suite("On-device AI ladders")
struct OnDeviceAITests {
    // MARK: Fixtures

    private let storm = """
        Forecasters expect Storm Idris to make landfall late on Thursday. Ferry operators have cancelled \
        every crossing along the coast. Schools in three counties will stay closed until Monday.
        """

    /// A scripted model: `availability` and `languages` as given, every call recorded.
    private func model(
        availability: LanguageModelClient.Availability = .available,
        languages: Set<String> = ["en", "de", "fr", "es", "ja"],
        respond: @escaping @Sendable (String, String) async throws -> String = { _, _ in
            Issue.record("the model was not expected to summarize")
            throw LanguageModelError.unavailable
        },
        forecast: @escaping @Sendable (String, String, String, String) async throws -> [ForecastDraft] = { _, _, _, _ in
            Issue.record("the model was not expected to forecast")
            throw LanguageModelError.unavailable
        }
    ) -> LanguageModelClient {
        LanguageModelClient(availability: { availability }, languages: { languages }, respond: respond, forecast: forecast)
    }

    /// The API with only these endpoints (anything else is an unimplemented call — a failure).
    private func api(
        summarize: (@Sendable (SummarizeRequest) async throws -> SummarizeResponse)? = nil,
        translate: (@Sendable ([String], String, String) async throws -> TranslateResponse)? = nil
    ) -> MeridianAPIClient {
        var client = MeridianAPIClient()
        if let summarize { client.summarize = summarize }
        if let translate { client.translate = translate }
        return client
    }

    private let echoTranslate: @Sendable ([String], String, String) async throws -> TranslateResponse = { texts, target, _ in
        TranslateResponse(translations: texts.map { "[\(target)] \($0)" }, provider: "mymemory")
    }

    // MARK: Summaries

    @Test("the model summarizes first, in the reader's language, over at most 6000 characters")
    func summaryOnDevice() async {
        let calls = LockedValue<[(instructions: String, prompt: String)]>([])
        let model = model(respond: { instructions, prompt in
            calls.update { $0.append((instructions, prompt)) }
            return "- Landfall late on Thursday\n- Schools closed until Monday"
        })
        let long = String(repeating: storm + " ", count: 40)
        let result = await withDependencies {
            $0.languageModel = model
            $0.meridianAPI = api()
        } operation: {
            await Summarizer.ladder().article("Storm Idris", long, "de")
        }
        #expect(result == SummaryResult(summary: "- Landfall late on Thursday\n- Schools closed until Monday", provider: "on-device"))
        #expect(result.bullets == ["Landfall late on Thursday", "Schools closed until Monday"])
        let call = calls.value.first
        #expect(calls.value.count == 1)
        #expect(call?.instructions.contains("titled \"Storm Idris\"") == true)
        #expect(call?.instructions.contains("in German, one per line") == true)
        #expect(call?.prompt.utf16.count == 6000)
    }

    @Test("a refusal or a failure falls through to the server, then the local rung")
    func summaryFallsThrough() async {
        let refusing = model(respond: { _, _ in "I'm sorry, but I can't help with summarizing this article." })
        let failing = model(respond: { _, _ in throw LanguageModelError.refused })
        let gemini = api(summarize: { _ in SummarizeResponse(summary: "- From the server", provider: "gemini") })
        let refused = await withDependencies {
            $0.languageModel = refusing
            $0.meridianAPI = gemini
        } operation: {
            await Summarizer.ladder().article("Storm Idris", storm, "en")
        }
        #expect(refused.provider == "gemini")
        let unavailable = api(summarize: { _ in throw APIError.server(status: 501, code: "premium", message: "", retryAfter: nil) })
        let failed = await withDependencies {
            $0.languageModel = failing
            $0.meridianAPI = unavailable
        } operation: {
            await Summarizer.ladder().article("Storm Idris", storm, "en")
        }
        #expect(failed.provider == "local")
    }

    @Test("a model that is not ready is not asked")
    func summaryNotReady() async {
        let result = await withDependencies {
            $0.languageModel = model(availability: .notReady)
            $0.meridianAPI = api(summarize: { _ in SummarizeResponse(summary: "- Server", provider: "gemini") })
        } operation: {
            await Summarizer.ladder().article("Storm Idris", storm, "en")
        }
        #expect(result.provider == "gemini")
    }

    @Test("a language the model does not write: English, then the translate ladder")
    func summaryTranslated() async {
        let instructions = LockedValue("")
        let model = model(languages: ["en"], respond: { text, _ in
            instructions.update { $0 = text }
            return "- Landfall on Thursday\n- Ferries cancelled"
        })
        let result = await withDependencies {
            $0.languageModel = model
            $0.meridianAPI = api(translate: echoTranslate)
        } operation: {
            await Summarizer.ladder().article("Storm Idris", storm, "de")
        }
        #expect(instructions.value.contains("in English, one per line"))
        #expect(result == SummaryResult(summary: "[de] Landfall on Thursday\n[de] Ferries cancelled", provider: "on-device"))
    }

    @Test("the brief: the model reads the headlines of the view with its topic")
    func briefOnDevice() async {
        let calls = LockedValue<[(instructions: String, prompt: String)]>([])
        let model = model(respond: { instructions, prompt in
            calls.update { $0.append((instructions, prompt)) }
            return "- Storm Idris nears the coast\n- Shelton reaches the final"
        })
        let items = [
            DigestItem(title: "Storm Idris nears the coast", description: "Landfall on Thursday.", source: "BBC World"),
            DigestItem(title: "Shelton reaches the final", description: "A five-set thriller.", source: "ESPN"),
        ]
        let result = await withDependencies {
            $0.languageModel = model
            $0.meridianAPI = api()
        } operation: {
            await Summarizer.ladder().brief(items, "World", "en")
        }
        #expect(result.provider == "on-device")
        #expect(result.bullets == ["Storm Idris nears the coast", "Shelton reaches the final"])
        #expect(calls.value.first?.instructions.hasPrefix("You write a news brief from independent World news headlines") == true)
        #expect(calls.value.first?.prompt == "Storm Idris nears the coast \u{2014} Landfall on Thursday. (BBC World)\nShelton reaches the final \u{2014} A five-set thriller. (ESPN)")
    }

    @Test("refusals in prose are recognised; answers are not")
    func refusals() {
        #expect(Refusal.isRefusal("I'm sorry, but I can't assist with that."))
        #expect(Refusal.isRefusal("  I cannot help with this request."))
        #expect(Refusal.isRefusal("As an AI language model, I…"))
        #expect(Refusal.isRefusal("I’m unable to summarize this."))
        #expect(!Refusal.isRefusal("- Storm Idris makes landfall"))
        #expect(!Refusal.isRefusal("Sorry state of the roads after the storm"))
    }

    @Test("a deadline ends a hung generation; a quick one returns")
    func deadline() async throws {
        let start = ContinuousClock.now
        await #expect(throws: LanguageModelError.timedOut) {
            try await withDeadline(0.1) {
                try await Task.sleep(for: .seconds(10))
                return 1
            }
        }
        #expect(ContinuousClock.now - start < .seconds(2))
        #expect(try await withDeadline(5) { 42 } == 42)
        // an operation that does not stop when cancelled (a generation queued behind another one):
        // the caller still moves on at the deadline
        let stubborn = ContinuousClock.now
        await #expect(throws: LanguageModelError.timedOut) {
            try await withDeadline(0.1) {
                await Task.detached { try? await Task.sleep(for: .seconds(1.5)) }.value
                return 1
            }
        }
        #expect(ContinuousClock.now - stubborn < .seconds(1))
    }

    @Test("the output language: the reader's when the model writes it, English otherwise")
    func outputLanguage() {
        let model = model(languages: ["en", "de"])
        #expect(model.outputLanguage(for: "de") == "de")
        #expect(model.outputLanguage(for: "uk") == "en")
    }

    // MARK: Forecast

    private struct Golden: Decodable {
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
            let result: [Out]?
        }
        struct Forecast: Decodable {
            let now: String
            let pool: [PoolItem]
            let sanitize: [Sanitize]
        }
        let forecast: Forecast
    }

    private struct Drafts: Decodable { let forecasts: [ForecastDraft] }

    private let golden: Golden

    init() throws {
        golden = try Fixtures.golden(Golden.self, "ai")
    }

    private var pool: [ForecastArticle] {
        golden.forecast.pool.map {
            ForecastArticle(id: $0.id, title: $0.title, description: $0.description, source: $0.source,
                            publishedAt: Timestamp(iso: $0.publishedAt) ?? Timestamp(milliseconds: 0))
        }
    }

    private var now: Date { Timestamp(iso: golden.forecast.now)?.date ?? Date(timeIntervalSince1970: 0) }

    /// The drafts of a golden sanitize vector, as the structured output would hand them over.
    private func drafts(_ name: String) throws -> [ForecastDraft] {
        let vector = try #require(golden.forecast.sanitize.first { $0.name == name })
        return try JSONDecoder().decode(Drafts.self, from: Data(vector.raw.utf8)).forecasts
    }

    private func expected(_ name: String) throws -> [Golden.Out] {
        try #require(golden.forecast.sanitize.first { $0.name == name }?.result)
    }

    private func forecast(_ model: LanguageModelClient, target: String = "en", pool: [ForecastArticle]? = nil,
                          api: MeridianAPIClient? = nil) async throws -> ForecastRun {
        let pool = pool ?? self.pool
        let now = now
        return try await withDependencies {
            $0.languageModel = model
            $0.date = .constant(now)
            $0.meridianAPI = api ?? self.api()
        } operation: {
            try await Forecaster.ladder().run(pool, target)
        }
    }

    @Test("the model's drafts come out sanitized exactly like the web's (golden `mixed`), with the web's prompts")
    func forecastGolden() async throws {
        let drafts = try drafts("mixed")
        let calls = LockedValue<[[String]]>([])
        let model = model(forecast: { instructions, user, assistant, prompt in
            calls.update { $0.append([instructions, user, assistant, prompt]) }
            return drafts
        })
        let run = try await forecast(model)
        let expected = try expected("mixed")
        #expect(run.forecasts.map(\.headline) == expected.map(\.headline))
        #expect(run.forecasts.map(\.why) == expected.map(\.why))
        #expect(run.forecasts.map(\.timeframe) == expected.map(\.timeframe))
        #expect(run.forecasts.map { Timestamp.format($0.dueAt) } == expected.map(\.dueAt))
        #expect(run.forecasts.map(\.confidence) == expected.map(\.confidence))
        #expect(run.forecasts.map(\.basis) == expected.map(\.basis))
        #expect(run.provider == "on-device" && run.language == "en")
        let call = try #require(calls.value.first)
        #expect(call == [ForecastKit.systemPrompt("en"), ForecastKit.exampleUser, ForecastKit.exampleAssistant,
                         ForecastKit.userPrompt(pool, now: Int64(now.timeIntervalSince1970 * 1000))])
    }

    @Test("a run that only restated the news is tried once more")
    func forecastRetry() async throws {
        let echoes = try drafts("all-echoes")
        let good = try drafts("mixed")
        let calls = LockedValue(0)
        let model = model(forecast: { _, _, _, _ in
            calls.update { $0 += 1 }
            return calls.value == 1 ? echoes : good
        })
        let run = try await forecast(model)
        #expect(calls.value == 2)
        #expect(run.forecasts.count == 3)
    }

    @Test("after one retry the soft failure stands; a model error is not retried")
    func forecastGivesUp() async throws {
        let thin = try drafts("one-good")
        let calls = LockedValue(0)
        let sparse = model(forecast: { _, _, _, _ in
            calls.update { $0 += 1 }
            return thin
        })
        await #expect(throws: ForecastError.tooFew) { try await forecast(sparse) }
        #expect(calls.value == 2)
        let failing = model(forecast: { _, _, _, _ in
            calls.update { $0 += 1 }
            throw LanguageModelError.refused
        })
        await #expect(throws: LanguageModelError.refused) { try await forecast(failing) }
        #expect(calls.value == 3)
    }

    @Test("no model, or fewer than five stories: no forecast")
    func forecastPreconditions() async throws {
        await #expect(throws: LanguageModelError.unavailable) {
            try await forecast(model(availability: .notReady))
        }
        await #expect(throws: ForecastError.tooFew) {
            try await forecast(model(), pool: Array(pool.prefix(4)))
        }
    }

    @Test("languages: German natively; another language in English, then translated; untranslated stays English")
    func forecastLanguages() async throws {
        let drafts = try drafts("mixed")
        let instructions = LockedValue<[String]>([])
        let model = model(forecast: { text, _, _, _ in
            instructions.update { $0.append(text) }
            return drafts
        })
        let german = try await forecast(model, target: "de")
        #expect(instructions.value.last == ForecastKit.systemPrompt("de"))
        #expect(german.language == "de")
        #expect(german.forecasts.first?.headline == "Coastal towns brace vote set for Friday after the ruling")

        let ukrainian = try await forecast(model, target: "uk", api: api(translate: echoTranslate))
        #expect(instructions.value.last == ForecastKit.systemPrompt("en"))
        #expect(ukrainian.language == "uk")
        #expect(ukrainian.forecasts.first?.headline == "[uk] Coastal towns brace vote set for Friday after the ruling")
        #expect(ukrainian.forecasts.first?.why == "[uk] The story says a decision is due.")

        let untranslated = try await forecast(model, target: "uk", api: api(translate: { _, _, _ in
            throw APIError.server(status: 501, code: "no-provider", message: "", retryAfter: nil)
        }))
        #expect(untranslated.language == "en")
        #expect(untranslated.forecasts.first?.headline == "Coastal towns brace vote set for Friday after the ruling")
    }

    @Test("a long pool is trimmed, the least forecastable stories first, until the prompt fits")
    func forecastBudget() async throws {
        let long = String(repeating: "Officials will vote on the measure next week after a hearing. ", count: 5)
        let many = (0..<30).map { index in
            ForecastArticle(id: String(format: "%012x", index), title: "Story number \(index) about the harbour authority",
                            description: long, source: "Wire \(index)",
                            publishedAt: Timestamp(milliseconds: Int64(now.timeIntervalSince1970 * 1000) - Int64(index) * 60_000))
        }
        let prompts = LockedValue<[String]>([])
        let model = model(forecast: { instructions, user, assistant, prompt in
            prompts.update { $0.append(instructions + user + assistant + prompt) }
            throw LanguageModelError.refused
        })
        _ = try? await forecast(model, pool: many)
        let prompt = try #require(prompts.value.first)
        #expect(prompt.count <= Forecaster.promptCharacterBudget)
        #expect(prompt.contains("Story number 0 about"), "the freshest, most forecastable stay")
        #expect(!prompt.contains("Story number 29 about"), "the tail is dropped")
    }

    @Test("the mock provider (UI tests) shows the web's mock drafts without asking a model")
    func forecastMock() async throws {
        var mock = model()
        mock.provider = "mock"
        let run = try await forecast(mock)
        #expect(run.provider == "mock")
        #expect(run.forecasts.count == ForecastKit.count)
        #expect(run.forecasts.map(\.headline) == Array(ForecastKit.mock.map(\.headline).prefix(ForecastKit.count)))
    }
}
