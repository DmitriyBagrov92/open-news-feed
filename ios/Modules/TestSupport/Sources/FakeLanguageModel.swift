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
