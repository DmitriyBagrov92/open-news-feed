import CoreModels
import Dependencies
import Foundation
import Intelligence
import Networking
import Testing

/// The translate and summarize ladders (web ai.js:123-178, 264-297) over a stubbed API.
@Suite("Translate and summarize ladders")
struct LaddersTests {
    private let storm = """
        Forecasters expect Storm Idris to make landfall late on Thursday. Ferry operators have cancelled \
        every crossing along the coast. Schools in three counties will stay closed until Monday. The Met \
        Office raised its warning to amber on Wednesday morning. Residents were told to move vehicles to \
        higher ground before the surge. Volunteers will run a phone line through the night.
        """

    /// An API client with only these endpoints (the rest report an unimplemented call).
    private func client(
        translate: (@Sendable ([String], String, String) async throws -> TranslateResponse)? = nil,
        summarize: (@Sendable (SummarizeRequest) async throws -> SummarizeResponse)? = nil
    ) -> MeridianAPIClient {
        var client = MeridianAPIClient()
        if let translate { client.translate = translate }
        if let summarize { client.summarize = summarize }
        return client
    }

    @Test("translate: batches of 20, every text cut to 1000 UTF-16 units, the server's provider named")
    func translateBatches() async {
        let calls = LockedValue<[[String]]>([])
        let api = client(translate: { texts, target, _ in
            calls.update { $0.append(texts) }
            return TranslateResponse(translations: texts.map { "[\(target)] \($0)" }, provider: "mymemory")
        })
        let texts = (0..<45).map { "sentence \($0)" } + [String(repeating: "é", count: 1500)]
        let result = await withDependencies { $0.meridianAPI = api } operation: {
            await Translator.ladder().translate(texts, "de", "en")
        }
        #expect(calls.value.map(\.count) == [20, 20, 6])
        #expect(calls.value.last?.last?.utf16.count == 1000)
        #expect(result?.texts.count == 46)
        #expect(result?.texts.first == "[de] sentence 0")
        #expect(result?.provider == "mymemory")
    }

    @Test("translate: the same language passes through; no provider or a short answer is nil")
    func translateEdges() async {
        let unavailable = client(translate: { _, _, _ in
            throw APIError.server(status: 501, code: "no-provider", message: "", retryAfter: nil)
        })
        let short = client(translate: { texts, _, _ in
            TranslateResponse(translations: Array(texts.dropLast()), provider: nil)
        })
        let same = await Translator.ladder().translate(["a", "b"], "en", "en")
        #expect(same == TranslationResult(texts: ["a", "b"], provider: "none"))
        let none = await withDependencies { $0.meridianAPI = unavailable } operation: {
            await Translator.ladder().translate(["a"], "de", "en")
        }
        #expect(none == nil)
        let mismatched = await withDependencies { $0.meridianAPI = short } operation: {
            await Translator.ladder().translate(["a", "b"], "de", "en")
        }
        #expect(mismatched == nil)
    }

    @Test("summarize: a 501 is remembered — the server is asked once, the local rung answers")
    func summarizeRemembers501() async {
        let calls = LockedValue(0)
        let api = client(summarize: { _ in
            calls.update { $0 += 1 }
            throw APIError.server(status: 501, code: "premium", message: "", retryAfter: nil)
        })
        let summarizer = Summarizer.ladder()
        let first = await withDependencies { $0.meridianAPI = api } operation: {
            await summarizer.article("Storm Idris", storm, "en")
        }
        let second = await withDependencies { $0.meridianAPI = api } operation: {
            await summarizer.article("Storm Idris", storm, "en")
        }
        #expect(calls.value == 1)
        #expect(first == second)
        #expect(first.provider == "local")
        #expect(first.summary == TextKit.extractive(TextKit.splitSentences(storm), max: 5).joined(separator: "\n"))
        #expect(first.bullets.count == 5)
    }

    @Test("summarize: a transient failure is not remembered; a server summary wins")
    func summarizeServer() async {
        let calls = LockedValue(0)
        let flaky = client(summarize: { request in
            calls.update { $0 += 1 }
            if calls.value == 1 { throw APIError.network(.timedOut) }
            #expect(request.mode == "article" && request.title == "Storm Idris" && request.targetLang == "de")
            return SummarizeResponse(summary: "- Landfall on Thursday\n- Schools closed", provider: "gemini")
        })
        let summarizer = Summarizer.ladder()
        let first = await withDependencies { $0.meridianAPI = flaky } operation: {
            await summarizer.article("Storm Idris", storm, "de")
        }
        let second = await withDependencies { $0.meridianAPI = flaky } operation: {
            await summarizer.article("Storm Idris", storm, "de")
        }
        #expect(first.provider == "local")
        #expect(second.provider == "gemini")
        #expect(second.bullets == ["Landfall on Thursday", "Schools closed"])
    }
}
