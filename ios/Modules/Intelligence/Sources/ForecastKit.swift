import CoreModels
import Foundation
import OrderedCollections

/// A story the forecast may build on (web: the pool items `{ id, title, description, source,
/// publishedAt }`).
public struct ForecastArticle: Sendable, Hashable {
    public let id: String
    public let title: String
    public let description: String
    public let source: String
    public let publishedAt: Timestamp

    public init(id: String, title: String, description: String, source: String, publishedAt: Timestamp) {
        self.id = id
        self.title = title
        self.description = description
        self.source = source
        self.publishedAt = publishedAt
    }

    public init(_ article: Article) {
        self.init(id: article.id, title: article.title, description: article.description,
                  source: article.source.name, publishedAt: article.publishedAt)
    }
}

/// One speculative next event (web `sanitizeForecast` output).
public struct Forecast: Sendable, Hashable, Identifiable {
    public let headline: String
    public let why: String
    /// "24h" | "48h" | "3d" | "7d".
    public let timeframe: String
    public let hours: Int
    /// generatedAt + hours, epoch ms.
    public let dueAt: Int64
    /// "low" | "medium".
    public let confidence: String
    /// The ids of the stories it builds on (1–3).
    public let basis: [String]

    public var id: String { headline }

    public init(headline: String, why: String, timeframe: String, hours: Int, dueAt: Int64, confidence: String, basis: [String]) {
        self.headline = headline
        self.why = why
        self.timeframe = timeframe
        self.hours = hours
        self.dueAt = dueAt
        self.confidence = confidence
        self.basis = basis
    }

    public func translated(headline: String, why: String) -> Forecast {
        Forecast(headline: headline, why: why, timeframe: timeframe, hours: hours, dueAt: dueAt, confidence: confidence, basis: basis)
    }
}

/// A forecast run that produced nothing usable (the web's error keys).
public enum ForecastError: String, Error, Sendable {
    case error = "forecast.error"
    /// The model restated or waffled: the runner tries once more.
    case abstract = "forecast.abstract"
    case tooFew = "forecast.tooFew"
}

/// A raw candidate as the model drafts it (the structured output's fields, untrusted).
public struct ForecastDraft: Sendable, Hashable, Codable {
    public let headline: String
    public let why: String
    public let timeframe: String
    public let confidence: String
    public let basis: [Int]

    public init(headline: String, why: String, timeframe: String, confidence: String, basis: [Int]) {
        self.headline = headline
        self.why = why
        self.timeframe = timeframe
        self.confidence = confidence
        self.basis = basis
    }
}

/// Ports of the web's forecast helpers (public/js/ai.js "Forecast"): the prompts verbatim, the
/// worked example, the pool order, and the sanitizer that never trusts the model. Golden-tested.
public enum ForecastKit {
    public static let count = 4
    /// The model drafts spares so the least concrete candidates can be dropped.
    public static let candidates = count + 2
    public static let timeframes: OrderedDictionary<String, Int> = ["24h": 24, "48h": 48, "3d": 72, "7d": 168]
    public static let maxHeadline = 110
    public static let maxWhy = 320
    public static let minArticles = 5
    public static let maxArticles = 30
    /// The web's model writes these natively; others ask for English and translate.
    public static let outputLanguages: Set<String> = ["en", "es", "ja", "de", "fr"]
    public static let languageNames = ["en": "English", "es": "Spanish", "ja": "Japanese", "de": "German", "fr": "French"]

    public static func systemPrompt(_ outLang: String) -> String {
        let language = languageNames[outLang] ?? "English"
        return "You are a cautious news analyst writing in \(language). For each story you are given you predict the NEXT event it points to within 7 days \u{2014} never the story itself.\n"
            + "Rules:\n"
            + "- A forecast is a future headline: it names the same people, teams, companies, places or figures as the story it builds on, and states one checkable event with who / what / where (a vote, ruling, hearing, deadline, match result, launch, earnings report, announcement, strike, deal, sentencing, price move, landfall).\n"
            + "- Never copy or paraphrase a headline. If a forecast could be read as a summary of the story, it is wrong.\n"
            + "- No clich\u{00e9}s: \"talks continue\", \"situation evolves\", \"tensions escalate\", \"focus shifts to\", \"reactions follow\", \"events planned\", \"prowess continues\", \"faces pressure\".\n"
            + "- \"why\": one or two sentences citing the specific fact in the story that points there.\n"
            + "- \(candidates) forecasts on \(candidates) different stories, spread across the timeframes \"24h\", \"48h\", \"3d\", \"7d\".\n"
            + "- \"confidence\" is \"low\" unless several stories point the same way; then \"medium\". Never higher.\n"
            + "- \"basis\" lists the index numbers of the stories each forecast builds on. Headlines under 100 characters. Output JSON only."
            + (outLang == "en" ? "" : " Write every headline and \"why\" in \(language), even though the example below is in English.")
    }

    /// The worked example (a small model copies the shape it is shown); the names are invented so
    /// nothing from it can pass as news — a forecast that mentions them is dropped.
    public static let exampleUser =
        "Today is Tue, 09 Sep 2026 10:00:00 GMT. Headlines, newest first (index \u{b7} source \u{b7} age \u{b7} title \u{2014} description):\n"
        + "0 \u{b7} Harbor Sports \u{b7} 3h ago \u{b7} Sources: Halden Wolves, Rask agree to $33.75M extension \u{2014} The Wolves and striker Teo Rask have reached an agreement on a three-year extension ahead of Sunday\u{2019}s opener against Vardo.\n"
        + "1 \u{b7} Meridian Wire \u{b7} 5h ago \u{b7} Sable Bank expected to hold rates this week as inflation cools \u{2014} Markets price a hold at Wednesday\u{2019}s policy meeting; the statement language is in focus.\n"
        + "2 \u{b7} Coast News \u{b7} 1h ago \u{b7} Storm Kestrel strengthens as it heads for Port Averly \u{2014} Forecasters expect landfall on the east coast late Thursday.\n\n"
        + "Return exactly 3 forecasts as JSON."

    public static let exampleAssistant =
        #"{"forecasts":[{"headline":"Rask starts for the Halden Wolves in Sunday’s opener against Vardo","why":"The three-year, $33.75M extension signed this week makes him the lead striker going into the opener.","timeframe":"48h","confidence":"medium","basis":[0]},{"headline":"Sable Bank holds rates on Wednesday and hints at a December cut","why":"Markets price a hold at this week’s policy meeting, so the statement’s wording is the next move.","timeframe":"3d","confidence":"medium","basis":[1]},{"headline":"Port Averly closes schools and offices on Thursday as Kestrel makes landfall","why":"Forecasters expect landfall on the east coast late Thursday; closures follow every storm warning.","timeframe":"7d","confidence":"low","basis":[2]}]}"#

    public static let exampleEntities = ["halden", "wolves", "rask", "vardo", "sable bank", "kestrel", "averly"]

    public struct MockForecast: Sendable {
        public let headline: String
        public let timeframe: String
        public let confidence: String
    }

    /// The web's mock provider (UI work, UI tests): four generic drafts, built on the pool's stories.
    public static let mock = [
        MockForecast(headline: "Follow-up talks announced after this week\u{2019}s breakthrough", timeframe: "24h", confidence: "medium"),
        MockForecast(headline: "Regulators schedule a hearing on the disputed decision", timeframe: "48h", confidence: "low"),
        MockForecast(headline: "Rival bid emerges as the deal heads for a shareholder vote", timeframe: "3d", confidence: "low"),
        MockForecast(headline: "Weekend deadline passes without a signed agreement", timeframe: "7d", confidence: "medium"),
    ]

    /// The mock provider's answer for a pool (web `generateForecast` with a mock session), as JSON
    /// for the non-strict sanitizer.
    public static func mockDrafts(for articles: [ForecastArticle]) -> [ForecastDraft] {
        mock.enumerated().map { index, item in
            let article = articles[index % max(1, articles.count)]
            return ForecastDraft(
                headline: item.headline,
                why: "Mock reasoning built on \"\(article.title.jsPrefix(60))\" \u{2014} the real model explains which signals in the headlines point this way.",
                timeframe: item.timeframe, confidence: item.confidence, basis: [index % max(1, articles.count)]
            )
        }
    }

    /// The run's prompt: the stories newest first with their age.
    public static func userPrompt(_ articles: [ForecastArticle], now: Int64) -> String {
        let lines = articles.enumerated().map { index, article -> String in
            let hours = (Double(now - article.publishedAt.milliseconds) / 3_600_000).rounded(.toNearestOrAwayFromZero)
            let age = max(0, Int(hours))
            let title = article.title.jsPrefix(120)
            let description = article.description.jsPrefix(160)
            let source = article.source.isEmpty ? "unknown" : article.source
            return "\(index) \u{b7} \(source) \u{b7} \(age)h ago \u{b7} \(title)" + (description.isEmpty ? "" : " \u{2014} " + description)
        }
        return "Today is \(utcString(now)). Headlines, newest first (index \u{b7} source \u{b7} age \u{b7} title \u{2014} description):\n"
            + lines.joined(separator: "\n")
            + "\n\nReturn exactly \(candidates) forecasts as JSON."
    }

    /// `new Date(ms).toUTCString()`: "Sat, 26 Sep 2026 12:00:00 GMT".
    static func utcString(_ ms: Int64) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "GMT")
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss 'GMT'"
        return formatter.string(from: Date(timeIntervalSince1970: Double(ms) / 1000))
    }

    // MARK: Pool

    /// How many upcoming-event cues a story carries; the pool meets these first.
    public static func forecastability(title: String, description: String) -> Int {
        JSRegex.futureCue.count(in: "\(title) \(description)")
    }

    /// The stories the model reads (web forecast.js `run`): English only, once each, those naming
    /// an upcoming event first (stable, so recency — the input is newest first — breaks ties),
    /// at most 30.
    public static func pool(_ articles: [Article]) -> [ForecastArticle] {
        var seen = Set<String>()
        let candidates = articles.filter { $0.language == "en" && seen.insert($0.id).inserted }.map(ForecastArticle.init)
        return candidates
            .map { (article: $0, cues: forecastability(title: $0.title, description: $0.description)) }
            .stableSorted { $0.cues > $1.cues }
            .prefix(maxArticles)
            .map(\.article)
    }

    // MARK: Entities

    static let entityStop: Set<String> = Set(("the a an and of in on at to for with by from as is are was were be after before over "
        + "under into amid vs new his her their this that these those it its he she they we you why how what when").split(separator: " ").map(String.init))

    /// Capitalised words and numbers — the names, places and figures a concrete forecast has to
    /// carry over from its story (insertion-ordered like the web's Set).
    public static func entities(_ text: String) -> OrderedSet<String> {
        var out = OrderedSet<String>()
        for raw in JSRegex.entitySeparator.split(text) {
            var word = JSRegex.entityEdges.replace(in: raw, with: "")
            word = JSRegex.possessive.replace(in: word, with: "")
            guard !word.isEmpty else { continue }
            if JSRegex.figure.matches(word) {
                let digits = word.unicodeScalars.filter { ("0"..."9").contains($0) }.count
                if digits >= 2 || word.hasSuffix("%") { out.append(word.lowercased()) }
            } else if word.utf16.count >= 3, let first = word.unicodeScalars.first,
                      first.properties.generalCategory == .uppercaseLetter,
                      !entityStop.contains(word.lowercased()) {
                out.append(word.lowercased())
            }
        }
        return out
    }

    /// How firmly a forecast stands on its stories: names/figures shared with the basis headlines,
    /// a point for a concrete event and one for a date or figure, two off per cliché.
    static func concreteness(headline: String, why: String, basis: [ForecastArticle]) -> Int {
        let own = entities(headline + " " + why)
        var grounded = Set<String>()
        for article in basis { grounded.formUnion(entities(article.title + " " + article.description)) }
        let shared = own.filter { grounded.contains($0) }.count
        guard shared > 0 else { return 0 }
        let cliches = JSRegex.vague.count(in: headline)
        return shared + (JSRegex.event.matches(headline) ? 1 : 0) + (JSRegex.when.matches(headline) ? 1 : 0) - 2 * cliches
    }

    static func mentionsExample(_ text: String) -> Bool {
        let lower = text.lowercased()
        return exampleEntities.contains { lower.contains($0) }
    }

    static func contentWords(_ text: String) -> Set<String> {
        Set(JSRegex.nonWord.replace(in: text.lowercased(), with: " ").split(separator: " ", omittingEmptySubsequences: false)
            .map(String.init).filter { $0.utf16.count > 2 })
    }

    /// The story again, not its next step: ≥ 80 % of a basis headline's words reappear.
    static func echoes(_ headline: String, _ articles: [ForecastArticle]) -> Bool {
        let own = contentWords(headline)
        return articles.contains { article in
            let title = contentWords(article.title)
            guard !title.isEmpty else { return false }
            return Double(title.filter { own.contains($0) }.count) / Double(title.count) >= 0.8
        }
    }

    static func normalized(_ text: String) -> String {
        TextKit.jsTrim(JSRegex.nonWord.replace(in: text.lowercased(), with: " "))
    }

    // MARK: Sanitizer

    /// Never trusts the model's JSON (web `sanitizeForecast`): clamps and coerces, maps basis
    /// indices to real ids, drops echoes of the input and the worked example, and — strict — keeps
    /// the `count` most concrete candidates, shown soonest first.
    public static func sanitize(_ raw: String, articles: [ForecastArticle], generatedAt: Int64, strict: Bool = true) throws -> [Forecast] {
        let text = TextKit.jsTrim(JSRegex.fence.replace(in: raw, with: ""))
        guard let data = text.data(using: .utf8),
              let parsed = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            throw ForecastError.error
        }
        let list: [Any]
        if let object = parsed as? [String: Any], let items = object["forecasts"] as? [Any] {
            list = items
        } else if let items = parsed as? [Any] {
            list = items
        } else {
            throw ForecastError.error
        }
        let inputTitles = Set(articles.map { normalized($0.title) })
        var seen = Set<String>()
        var scored: [(forecast: Forecast, score: Int)] = []
        for item in list {
            guard let item = item as? [String: Any] else { continue }
            let headlineRaw = JS.string(item["headline"]).components(separatedBy: " \u{2014} ")[0]
            let headline = TextKit.jsTrim(JSRegex.whitespace.replace(in: headlineRaw, with: " ")).jsPrefix(maxHeadline)
            let why = TextKit.jsTrim(JSRegex.whitespace.replace(in: JS.string(item["why"]), with: " ")).jsPrefix(maxWhy)
            guard headline.utf16.count >= 8 else { continue }
            let key = normalized(headline)
            if inputTitles.contains(key) || seen.contains(key) { continue }
            if strict, echoes(headline, articles) { continue }
            if strict, mentionsExample(headline + " " + why) { continue }
            let frame = (item["timeframe"] as? String).flatMap { timeframes[$0] != nil ? $0 : nil } ?? "7d"
            let hours = timeframes[frame] ?? 168
            let confidence = (item["confidence"] as? String) == "medium" ? "medium" : "low"
            var basis: [String] = []
            var basisArticles: [ForecastArticle] = []
            for index in (item["basis"] as? [Any]) ?? [] {
                let number = JS.number(index).rounded(.towardZero)
                if number.isFinite, number >= 0, number < Double(articles.count) {
                    let article = articles[Int(number)]
                    if !basis.contains(article.id) {
                        basis.append(article.id)
                        basisArticles.append(article)
                    }
                }
                if basis.count == 3 { break }
            }
            guard !basis.isEmpty else { continue }
            let forecast = Forecast(headline: headline, why: why, timeframe: frame, hours: hours,
                                    dueAt: generatedAt + Int64(hours) * 3_600_000, confidence: confidence, basis: basis)
            let score = strict ? concreteness(headline: headline, why: why, basis: basisArticles) : 1
            guard score >= 1 else { continue }
            seen.insert(key)
            scored.append((forecast, score))
        }
        let kept = scored.stableSorted { $0.score > $1.score }.prefix(count).map(\.forecast)
            .stableSorted { $0.hours < $1.hours }
        guard kept.count >= 2 else { throw list.count >= 2 ? ForecastError.abstract : ForecastError.tooFew }
        return kept
    }

    /// The model's structured drafts as the sanitizer's JSON input.
    public static func json(_ drafts: [ForecastDraft]) -> String {
        let data = (try? JSONEncoder().encode(["forecasts": drafts])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }
}

// MARK: - JavaScript semantics

/// JS value coercions the sanitizer relies on (`String(x || '')`, `Number(x)`).
enum JS {
    static func string(_ value: Any?) -> String {
        switch value {
        case let string as String: return string
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? "true" : "" }
            let double = number.doubleValue
            if double == 0 || double.isNaN { return "" }
            if double == double.rounded(), abs(double) < 1e21 { return String(Int64(double)) }
            return String(double)
        case let array as [Any]: return array.map { string($0) }.joined(separator: ",")
        case is [String: Any]: return "[object Object]"
        default: return ""
        }
    }

    static func number(_ value: Any) -> Double {
        switch value {
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return number.boolValue ? 1 : 0 }
            return number.doubleValue
        case let string as String:
            let trimmed = TextKit.jsTrim(string)
            return trimmed.isEmpty ? 0 : Double(trimmed) ?? .nan
        case is NSNull: return 0
        default: return .nan
        }
    }
}

/// The web's regular expressions with JS semantics: without the `u` flag `\b`, `\w` and `\d` are
/// ASCII (ICU's are Unicode), so those patterns are rewritten; `u` patterns use Unicode classes.
struct JSRegex: @unchecked Sendable {
    let regex: NSRegularExpression

    private static let wordClass = "[A-Za-z0-9_]"

    /// A JS pattern without the `u` flag, made ASCII in ICU.
    init(ascii pattern: String, caseInsensitive: Bool = true) {
        let boundary = "(?:(?<=\(Self.wordClass))(?!\(Self.wordClass))|(?<!\(Self.wordClass))(?=\(Self.wordClass)))"
        let rewritten = pattern
            .replacingOccurrences(of: #"\b"#, with: boundary)
            .replacingOccurrences(of: #"\w"#, with: Self.wordClass)
            .replacingOccurrences(of: #"\d"#, with: "[0-9]")
        regex = try! NSRegularExpression(pattern: rewritten, options: caseInsensitive ? [.caseInsensitive] : [])
    }

    init(unicode pattern: String) {
        regex = try! NSRegularExpression(pattern: pattern)
    }

    func count(in text: String) -> Int {
        regex.numberOfMatches(in: text, range: NSRange(text.startIndex..., in: text))
    }

    func matches(_ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    func replace(in text: String, with template: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(text.startIndex..., in: text), withTemplate: template)
    }

    /// `text.split(regex)`: the pieces between matches, empty ones included.
    func split(_ text: String) -> [String] {
        let ns = text as NSString
        var pieces: [String] = []
        var cursor = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            pieces.append(ns.substring(with: NSRange(location: cursor, length: match.range.location - cursor)))
            cursor = match.range.location + match.range.length
        }
        pieces.append(ns.substring(from: cursor))
        return pieces
    }

    static let vague = JSRegex(ascii: #"\b(evolv\w*|continu\w*|develop\w*|shap\w*|remain\w*|focus\w*|shift\w*|attention|momentum|reaction\w*|discussion\w*|speculation|scrutiny|tension\w*|uncertaint\w*|pressure|ongoing|planned|prowess|amaze\w*|showcase\w*|compelling|emerging|impact\w*|prompt\w*|prepare\w*|heighten\w*|increas\w*|strategy|condemnation|escalat\w*|faces|face|sparks|fuels|raises questions|spotlight|boost\w*|outlook|seen as|potential\w*|narrative|complexit\w*|signal\w*|significant\w*|commit\w*|priorit\w*|amid)\b"#)
    static let futureCue = JSRegex(ascii: #"\b(will|set to|due|scheduled|expected|to (face|meet|vote|decide|announce|hold|open|close|release|play|host|begin|start|resume|testify|appear|unveil)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|this (week|weekend|month)|next (week|month|year)|tomorrow|tonight|deadline|final\w*|semi-?final\w*|opener|vote\w*|hearing|trial|verdict|sentencing|summit|talks|meeting|election\w*|launch\w*|earnings|deal|strike|ceasefire|ruling|referendum|debate|inauguration|kickoff|matchday|playoff\w*)\b"#)
    static let event = JSRegex(ascii: #"\b(vote\w*|hearing|ruling|verdict|sentenc\w*|deadline|launch\w*|report\w*|earnings|deal|agreement|strike\w*|landfall|final\w*|semi-?final\w*|match|game|opener|derby|election\w*|summit|meeting|announce\w*|sign\w*|release\w*|ship\w*|cut\w*|hike\w*|hold\w* rates|ban\w*|approv\w*|reject\w*|fine\w*|indict\w*|charge\w*|arrest\w*|resign\w*|appoint\w*|acquir\w*|buy\w*|sell\w*|ipo|evacuat\w*|close\w*|open\w*|start\w*|play\w*|beat\w*|win\w*|lose\w*|return\w*|test\w*|unveil\w*|publish\w*|ceasefire|sanction\w*|tariff\w*)\b"#)
    static let when = JSRegex(ascii: #"\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tonight|tomorrow|weekend|\d{1,2}(st|nd|rd|th)?|\d+(\.\d+)?%|\$\d)"#)

    /// `/[^\p{L}\p{N}'’.%-]+/u`
    static let entitySeparator = JSRegex(unicode: #"[^\p{L}\p{N}'\x{2019}.%-]+"#)
    /// `/^[’'.-]+|[’'.-]+$/g`
    static let entityEdges = JSRegex(unicode: #"^[\x{2019}'.-]+|[\x{2019}'.-]+$"#)
    /// `/['’]s$/`
    static let possessive = JSRegex(unicode: #"['\x{2019}]s$"#)
    /// `/^\d+([.,]\d+)?%?$/` (ASCII digits)
    static let figure = JSRegex(unicode: #"^[0-9]+([.,][0-9]+)?%?$"#)
    /// `/[^\p{L}\p{N}]+/gu`
    static let nonWord = JSRegex(unicode: #"[^\p{L}\p{N}]+"#)
    /// `/\s+/g` — JS whitespace (Unicode spaces, line terminators, BOM)
    static let whitespace = JSRegex(unicode: #"[\t\n\x{0B}\f\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}]+"#)
    /// `/^\s*```(?:json)?\s*|\s*```\s*$/g`
    static let fence = JSRegex(unicode: #"^[\s\x{FEFF}]*```(?:json)?[\s\x{FEFF}]*|[\s\x{FEFF}]*```[\s\x{FEFF}]*$"#)
}
