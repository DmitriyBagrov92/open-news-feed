import CoreModels
import Foundation

/// The deterministic "HOW COVERAGE DIFFERS" analysis of a Bubble Battle cluster (web
/// battle-brief.js), the last rung under the on-device contrast summary: each lean's stance —
/// hostile or approving headline language — with its most polarized headline as the receipt.
/// Golden-tested against the web module.
public enum BattleBrief {
    public enum Stance: String, Sendable, Hashable {
        case critical, supportive, neutral
    }

    /// One lean's line: its first two outlets, its stance, the receipt.
    public struct Row: Sendable, Hashable {
        public let lean: Lean
        public let source: String
        public let stance: Stance
        public let evidence: String?

        public init(lean: Lean, source: String, stance: Stance, evidence: String?) {
            self.lean = lean
            self.source = source
            self.stance = stance
            self.evidence = evidence
        }
    }

    // JS regexes without the `u` flag: ASCII word boundaries and `\w` (JSRegex).
    static let negative = JSRegex(ascii: #"\b(slams?|blasts?|rips?|attacks?|fail(?:s|ure|ures)?|dangerous|scandal|crisis|chaos|threats?|disaster|corrupt(?:ion)?|lies?|expos\w+|betray\w*|collaps\w+|worst|warns?|accus\w+|destroy\w*|fears?|blames?|mocks?|fraud|revisionism|problem|debacle|meltdown|dodge\w*|desperate|refus\w+|denies|deny)\b"#)
    static let positive = JSRegex(ascii: #"\b(wins?|won|supports?|backs?|defends?|prais\w+|boosts?|leads?|victory|success|celebrat\w+|flex\w*|triumph\w*|vows?|cheers?|surg\w+|stronger?|record|welcomes?|endors\w+|rall\w+)\b"#)

    /// web `stanceOf`: +1 per approving headline, −1 per hostile one (a headline with both is
    /// neither); the evidence is the last headline of the strongest polarity.
    public static func stance(of titles: [String]) -> (score: Int, evidence: String?) {
        var score = 0
        var evidence: String?
        var best = 0
        for title in titles {
            var value = 0
            if negative.matches(title) { value -= 1 }
            if positive.matches(title) { value += 1 }
            score += value
            if value != 0, abs(value) >= abs(best) {
                best = value
                evidence = title
            }
        }
        return (score, evidence)
    }

    /// web `contrastRows`: one row per lean present, left → center → right.
    public static func contrastRows(_ battle: Battle) -> [Row] {
        var titles: [Lean: [String]] = [:]
        var sources: [Lean: [String]] = [:]
        for article in battle.articles {
            guard let lean = article.lean else { continue }
            titles[lean, default: []].append(article.title)
            if !(sources[lean]?.contains(article.source.name) ?? false) {
                sources[lean, default: []].append(article.source.name)
            }
        }
        return [Lean.left, .center, .right].compactMap { lean in
            guard let leanTitles = titles[lean] else { return nil }
            let (score, evidence) = stance(of: leanTitles)
            return Row(
                lean: lean,
                source: (sources[lean] ?? []).prefix(2).joined(separator: ", "),
                stance: score < 0 ? .critical : score > 0 ? .supportive : .neutral,
                evidence: evidence
            )
        }
    }
}
