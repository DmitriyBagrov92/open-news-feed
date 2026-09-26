import CoreModels
import Foundation
import OrderedCollections

/// Text helpers of the web's `public/js/ai.js`, ported with JavaScript semantics (golden-tested
/// against the real module): JS whitespace for `\s`/`trim()`, UTF-16 lengths, stable sorts and
/// insertion-ordered maps wherever the web's output depends on them.
public enum TextKit {
    /// `STOPWORDS` (ai.js).
    public static let stopwords: Set<String> = Set(
        ("a an the and or but nor of in on at to for from by with about as into over after before between " +
         "is are was were be been being has have had do does did will would can could may might must shall should " +
         "it its this that these those he she they them him his her their our we you your i me my not no yes " +
         "than then so if when while what which who whom how where why all any both each more most other some such only")
            .split(separator: " ").map(String.init)
    )

    // MARK: JavaScript character classes

    /// JS `\s` and `String.prototype.trim` (WhiteSpace + LineTerminator).
    static func isJSWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: true
        default: false
        }
    }

    /// `\p{L}` or `\p{N}`.
    static func isLetterOrNumber(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter,
             .decimalNumber, .letterNumber, .otherNumber: true
        default: false
        }
    }

    /// `/^\p{Lu}/u`.
    static func startsUppercase(_ word: String) -> Bool {
        word.unicodeScalars.first?.properties.generalCategory == .uppercaseLetter
    }

    public static func jsTrim(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        var start = 0
        var end = scalars.count
        while start < end, isJSWhitespace(scalars[start]) { start += 1 }
        while end > start, isJSWhitespace(scalars[end - 1]) { end -= 1 }
        return String(String.UnicodeScalarView(scalars[start..<end]))
    }

    /// `text.slice(0, n)` in UTF-16 units, backing off rather than splitting a surrogate pair.
    public static func jsPrefix(_ text: String, _ length: Int) -> String {
        text.jsPrefix(length)
    }

    /// Runs of scalars where `isWordScalar` holds (a JS `split` on the complement, empties dropped).
    static func runs(_ text: String, where isWordScalar: (Unicode.Scalar) -> Bool) -> [String] {
        var out: [String] = []
        var current = String.UnicodeScalarView()
        for scalar in text.unicodeScalars {
            if isWordScalar(scalar) {
                current.append(scalar)
            } else if !current.isEmpty {
                out.append(String(current))
                current = String.UnicodeScalarView()
            }
        }
        if !current.isEmpty { out.append(String(current)) }
        return out
    }

    // MARK: ai.js ports

    /// `words(text)`: `text.toLowerCase().match(/[\p{L}\p{N}']+/gu)`.
    public static func words(_ text: String) -> [String] {
        runs(text.lowercased()) { isLetterOrNumber($0) || $0 == "'" }
    }

    /// `splitSentences(text)`: whitespace collapsed, then
    /// `/[^.!?]+[.!?]+[”"')\]]*\s*|[^.!?]+$/g`, trimmed, empties dropped.
    public static func splitSentences(_ text: String) -> [String] {
        var normalized = String.UnicodeScalarView()
        var inSpace = false
        for scalar in text.unicodeScalars {
            if isJSWhitespace(scalar) {
                if !inSpace { normalized.append(" ") }
                inSpace = true
            } else {
                normalized.append(scalar)
                inSpace = false
            }
        }
        let scalars = Array(normalized)
        func isTerminal(_ s: Unicode.Scalar) -> Bool { s == "." || s == "!" || s == "?" }
        func isCloser(_ s: Unicode.Scalar) -> Bool { s == "\u{201D}" || s == "\"" || s == "'" || s == ")" || s == "]" }

        var out: [String] = []
        var index = 0
        while index < scalars.count {
            var end = index
            while end < scalars.count, !isTerminal(scalars[end]) { end += 1 }
            if end == index { // `[^.!?]+` needs one character: the engine retries one position later
                index += 1
                continue
            }
            if end < scalars.count {
                while end < scalars.count, isTerminal(scalars[end]) { end += 1 }
                while end < scalars.count, isCloser(scalars[end]) { end += 1 }
                while end < scalars.count, isJSWhitespace(scalars[end]) { end += 1 }
            }
            out.append(String(String.UnicodeScalarView(scalars[index..<end])))
            index = end
        }
        return out.map(jsTrim).filter { !$0.isEmpty }
    }

    /// `extractive(sentences, max)`: frequency-scored sentences (content words, length-normalized),
    /// the top `max` kept in their original order.
    public static func extractive(_ sentences: [String], max: Int = 5) -> [String] {
        let list = sentences.filter { !jsTrim($0).isEmpty }
        guard list.count > max else { return list }
        var frequency: [String: Int] = [:]
        for sentence in list {
            for word in words(sentence) where word.utf16.count > 2 && !stopwords.contains(word) {
                frequency[word, default: 0] += 1
            }
        }
        let scored = list.enumerated().map { index, sentence -> (index: Int, sentence: String, score: Double) in
            let ws = words(sentence)
            let total = ws.reduce(0) { $0 + (frequency[$1] ?? 0) }
            return (index, sentence, Double(total) / Double(ws.isEmpty ? 1 : ws.count).squareRoot())
        }
        return scored.stableSorted { $0.score > $1.score }
            .prefix(max)
            .sorted { $0.index < $1.index }
            .map(\.sentence)
    }

    /// `toBullets(summary, max)`: lines with a leading `- * • ·` marker stripped; a single
    /// paragraph is split into sentences.
    public static func toBullets(_ summary: String, max: Int = 7) -> [String] {
        var lines = summary.split(separator: "\n", omittingEmptySubsequences: true).map { line -> String in
            let scalars = Array(line.unicodeScalars)
            var index = 0
            while index < scalars.count, isJSWhitespace(scalars[index]) { index += 1 }
            if index < scalars.count, "-*•·".unicodeScalars.contains(scalars[index]) {
                index += 1
                while index < scalars.count, isJSWhitespace(scalars[index]) { index += 1 }
                return jsTrim(String(String.UnicodeScalarView(scalars[index...])))
            }
            return jsTrim(String(line))
        }.filter { !$0.isEmpty }
        if lines.count == 1 { lines = splitSentences(lines[0]) }
        return Array(lines.prefix(max))
    }

    /// `chunkParagraph(text, maxLen)`: ≤ maxLen UTF-16 chunks on sentence boundaries (the server's
    /// translate limit is 20 texts × 1000 characters).
    public static func chunkParagraph(_ text: String, maxLength: Int = 1000) -> [String] {
        guard text.utf16.count > maxLength else { return [text] }
        var chunks: [String] = []
        var current = ""
        for sentence in splitSentences(text) {
            let piece = sentence.utf16.count > maxLength ? jsPrefix(sentence, maxLength) : sentence
            if !current.isEmpty, (current + " " + piece).utf16.count > maxLength {
                chunks.append(current)
                current = piece
            } else {
                current = current.isEmpty ? piece : current + " " + piece
            }
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks.isEmpty ? [jsPrefix(text, maxLength)] : chunks
    }

    /// `entityTokens(title)`: capitalised words and adjacent-capital bigrams, lower → display, in
    /// insertion order (a bigram before its first word; re-setting a key keeps its position).
    public static func entityTokens(_ title: String) -> OrderedDictionary<String, String> {
        let words = runs(title) { isLetterOrNumber($0) || $0 == "'" }
        var out: OrderedDictionary<String, String> = [:]
        for (index, word) in words.enumerated() {
            let lower = strippingPossessive(word.lowercased())
            if lower.utf16.count < 3 || stopwords.contains(lower) { continue }
            guard startsUppercase(word) else { continue }
            let display = strippingPossessive(word)
            if index + 1 < words.count {
                let next = words[index + 1]
                if startsUppercase(next) {
                    let nextLower = next.lowercased()
                    if !stopwords.contains(nextLower), nextLower.utf16.count >= 3 {
                        out[lower + " " + nextLower] = display + " " + strippingPossessive(next)
                    }
                }
            }
            out[lower] = display
        }
        return out
    }

    /// `.replace(/['']s$/, '')` — the web's possessive strip (ASCII apostrophe, lowercase s).
    static func strippingPossessive(_ word: String) -> String {
        let scalars = Array(word.unicodeScalars)
        guard scalars.count >= 2, scalars[scalars.count - 2] == "'", scalars[scalars.count - 1] == "s" else { return word }
        return String(String.UnicodeScalarView(scalars.dropLast(2)))
    }

    /// `providerLabel(provider)`: ON-DEVICE AI · LOCAL DIGEST · the provider uppercased.
    public static func providerLabel(_ provider: String?) -> String {
        switch provider {
        case "on-device": L10n.t("ai.onDevice")
        case "local": L10n.t("ai.local")
        default: (provider ?? "").uppercased()
        }
    }
}

/// One headline fed to the local brief.
public struct DigestItem: Sendable, Hashable {
    public let title: String
    public let description: String
    public let source: String
    public let publishedAt: Timestamp?

    public init(title: String, description: String = "", source: String = "", publishedAt: Timestamp? = nil) {
        self.title = title
        self.description = description
        self.source = source
        self.publishedAt = publishedAt
    }

    public init(_ article: Article) {
        self.init(title: article.title, description: article.description, source: article.source.name, publishedAt: article.publishedAt)
    }
}

/// The LOCAL DIGEST brief (web `briefDigest`): stories grouped by their shared entities, each
/// developing story one line (the entity, the freshest headline, the breadth of coverage), then
/// "Also:" singletons — at most 7 lines. The fallback when no model can summarise.
public enum LocalDigest {
    public static func brief(_ items: [DigestItem]) -> [String] {
        let docs = items.map { (item: $0, tokens: TextKit.entityTokens($0.title)) }
        var byToken: OrderedDictionary<String, (display: String, indices: [Int])> = [:]
        for (index, doc) in docs.enumerated() {
            for (lower, display) in doc.tokens {
                if byToken[lower] == nil { byToken[lower] = (display, []) }
                byToken[lower]?.indices.append(index)
            }
        }

        var used = Set<Int>()
        var lines: [String] = []
        while lines.count < 5 {
            var bestToken: String?
            var bestCoverage: [Int] = []
            for (lower, entry) in byToken {
                let coverage = entry.indices.filter { !used.contains($0) }
                let better = coverage.count > bestCoverage.count
                let bigramTie = coverage.count == bestCoverage.count && bestToken != nil
                    && lower.contains(" ") && !(bestToken?.contains(" ") ?? false)
                if better || bigramTie {
                    bestToken = lower
                    bestCoverage = coverage
                }
            }
            guard let token = bestToken, bestCoverage.count >= 2 else { break }
            used.formUnion(bestCoverage)
            // freshest first; items without a date compare equal (the web's string comparison)
            let group = bestCoverage.map { docs[$0].item }.stableSorted { lhs, rhs in
                guard let l = lhs.publishedAt, let r = rhs.publishedAt else { return false }
                return l > r
            }
            let lead = group[0]
            var sources: OrderedSet<String> = []
            for item in group where !item.source.isEmpty { sources.append(item.source) }
            let breadth = group.count > 1
                ? " — \(group.count) stories from \(sources.prefix(3).joined(separator: ", "))"
                : lead.source.isEmpty ? "" : " (\(lead.source))"
            let firstWord = token.split(separator: " ").first.map(String.init) ?? token
            let prefix = lead.title.lowercased().hasPrefix(firstWord) ? "" : (byToken[token]?.display ?? token) + ": "
            lines.append(prefix + lead.title + breadth)
        }
        let rest = docs.indices.filter { !used.contains($0) }.prefix(max(0, 7 - lines.count))
        for index in rest {
            let item = docs[index].item
            lines.append("Also: \(item.title)" + (item.source.isEmpty ? "" : " (\(item.source))"))
        }
        return lines.isEmpty ? items.prefix(5).map(\.title) : lines
    }
}
