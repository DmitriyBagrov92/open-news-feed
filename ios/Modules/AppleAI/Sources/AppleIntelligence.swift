import Foundation
import FoundationModels
import Intelligence
import UIKit

public extension LanguageModelClient {
    /// Apple Intelligence on this device. Summaries and the brief generate free text with the
    /// permissive content-transformation guardrails (news retold may describe violence or crime —
    /// the SDK lifts guardrail errors only for String generation); the forecast is structured
    /// output with the default guardrails, sanitized like the web's.
    static func apple() -> LanguageModelClient {
        let gate = ModelGate()
        return LanguageModelClient(
            availability: {
                switch SystemLanguageModel.default.availability {
                case .available: .available
                case .unavailable(.modelNotReady): .notReady
                case .unavailable: .unavailable
                }
            },
            languages: {
                Set(SystemLanguageModel.default.supportedLanguages.compactMap { $0.languageCode?.identifier })
            },
            respond: { instructions, prompt in
                try await gate.run {
                    let model = SystemLanguageModel(guardrails: .permissiveContentTransformations)
                    let session = LanguageModelSession(model: model, instructions: instructions)
                    let options = GenerationOptions(temperature: 0.3, maximumResponseTokens: 700)
                    return try await session.respond(to: prompt, options: options).content
                }
            },
            forecast: { instructions, exampleUser, exampleAssistant, prompt in
                try await gate.run {
                    // the worked example rides in the instructions: a small model copies the shape
                    // it is shown (web: the example as a user / assistant turn pair)
                    let session = LanguageModelSession(
                        model: .default,
                        instructions: instructions + "\n\nExample request:\n" + exampleUser + "\n\nExample answer:\n" + exampleAssistant
                    )
                    let response = try await session.respond(
                        to: prompt, generating: ForecastCandidates.self,
                        options: GenerationOptions(temperature: 0.5, maximumResponseTokens: 1400)
                    )
                    return response.content.forecasts.map {
                        ForecastDraft(headline: $0.headline, why: $0.why, timeframe: $0.timeframe,
                                      confidence: $0.confidence, basis: $0.basis)
                    }
                }
            }
        )
    }
}

@Generable
struct ForecastCandidates {
    @Guide(description: "Six forecasts on six different stories", .count(6))
    var forecasts: [ForecastCandidate]
}

@Generable
struct ForecastCandidate {
    @Guide(description: "The future headline: the story's names plus one checkable next event, under 100 characters")
    var headline: String
    @Guide(description: "One or two sentences citing the specific fact in the story that points there")
    var why: String
    @Guide(description: "When it is expected", .anyOf(["24h", "48h", "3d", "7d"]))
    var timeframe: String
    @Guide(description: "low, unless several stories point the same way", .anyOf(["low", "medium"]))
    var confidence: String
    @Guide(description: "The index numbers of the stories it builds on", .count(1...3))
    var basis: [Int]
}

/// One generation at a time — a session refuses concurrent requests and parallel sessions only
/// slow each other down — and only while the app is in the foreground: summarizing in the
/// background costs the reader battery for nothing.
actor ModelGate {
    private var busy = false
    private var waiting: [CheckedContinuation<Void, Never>] = []

    func run<T: Sendable>(_ work: @Sendable () async throws -> T) async throws -> T {
        while busy {
            await withCheckedContinuation { waiting.append($0) }
        }
        busy = true
        defer {
            busy = false
            if !waiting.isEmpty { waiting.removeFirst().resume() }
        }
        // a caller that gave up while it waited (its deadline passed, the view moved on) is not served
        try Task.checkCancellation()
        let active = await MainActor.run { UIApplication.shared.applicationState != .background }
        guard active else { throw LanguageModelError.unavailable }
        return try await work()
    }
}
