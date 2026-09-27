import Foundation
import Intelligence

public extension LanguageModelClient {
    /// A stand-in for Apple Intelligence (FAKE_MODEL): `points` answers every summary with key
    /// points drawn from the prompt's first lines ("On-device: …"); `slow` does the same after
    /// 1.5 s; `refusal` answers in prose that refuses; `error` throws. The forecast uses the web's
    /// mock drafts (provider "mock").
    static func fake(_ mode: String) -> LanguageModelClient {
        LanguageModelClient(
            provider: "mock",
            availability: { .available },
            languages: { ["en", "de", "fr", "es", "ja"] },
            respond: { _, prompt in
                switch mode {
                case "refusal":
                    return "I'm sorry, but I can't help with that request."
                case "error":
                    throw LanguageModelError.refused
                case "slow":
                    try await Task.sleep(for: .milliseconds(1500))
                    fallthrough
                default:
                    let lines = prompt.split(separator: "\n").map(String.init).filter { !$0.isEmpty }.prefix(3)
                    return lines.map { "- On-device: " + $0.jsPrefix(90) }.joined(separator: "\n")
                }
            },
            forecast: { _, _, _, _ in throw LanguageModelError.unavailable }
        )
    }
}

public extension LanguageModelClient {
    /// The App Store newsroom's Apple Intelligence (FAKE_MODEL=showcase): answers scripted in
    /// Tests/Newsroom/ai.json (scripts/newsroom.mjs) so the brief, the key points and Ahead read
    /// like the real model's in the marketing screenshots. The first `respond` entry whose `match`
    /// occurs in the instructions or the prompt answers; anything unscripted is refused, and the
    /// ladders fall back as they would. A forecast's `basis` names text of the prompt's numbered
    /// story lines.
    static func showcase(script url: URL) -> LanguageModelClient {
        struct Script: Decodable, Sendable {
            struct Answer: Decodable, Sendable {
                let match: String
                let answer: String
            }

            struct Draft: Decodable, Sendable {
                let headline: String
                let why: String
                let timeframe: String
                let confidence: String
                let basis: [String]
            }

            let respond: [Answer]
            let forecast: [Draft]
        }
        guard let data = try? Data(contentsOf: url), let script = try? JSONDecoder().decode(Script.self, from: data) else {
            fatalError("FAKE_MODEL=showcase: no script at \(url.path) — run ios/scripts/newsroom.mjs")
        }
        return LanguageModelClient(
            availability: { .available },
            languages: { ["en", "de", "es", "fr", "it", "ja", "pt", "zh"] },
            respond: { instructions, prompt in
                try await Task.sleep(for: .milliseconds(500))
                let text = instructions + "\n" + prompt
                guard let entry = script.respond.first(where: { text.contains($0.match) }) else { throw LanguageModelError.refused }
                return entry.answer
            },
            forecast: { _, _, _, prompt in
                try await Task.sleep(for: .milliseconds(900))
                let lines = prompt.split(separator: "\n").map(String.init)
                return script.forecast.map { draft in
                    let basis = draft.basis.compactMap { needle in
                        lines.first { $0.localizedCaseInsensitiveContains(needle) }.flatMap { Int($0.prefix { $0.isNumber }) }
                    }
                    return ForecastDraft(headline: draft.headline, why: draft.why, timeframe: draft.timeframe,
                                         confidence: draft.confidence, basis: basis)
                }
            }
        )
    }
}
