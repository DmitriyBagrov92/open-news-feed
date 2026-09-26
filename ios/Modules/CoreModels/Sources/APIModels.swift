import Foundation

// Wire shapes of docs/ARCHITECTURE.md. Decoding is tolerant where the web client is: one
// malformed element never sinks a whole response (the element is skipped), optional fields
// default like the web does.

/// `GET /api/news`.
public struct FeedPage: Sendable, Hashable, Codable {
    public var articles: [Article]
    public let total: Int
    public let page: Int
    public let pageSize: Int
    /// Last successful refresh; `null` before the first one.
    public let updatedAt: Timestamp?
    public let latestId: String?
    /// 24 hourly counts, oldest first — only with `histogram=1` (the app computes its own).
    public let timeline: [Int]?

    public init(articles: [Article], total: Int, page: Int = 1, pageSize: Int = 30,
                updatedAt: Timestamp? = nil, latestId: String? = nil, timeline: [Int]? = nil) {
        self.articles = articles
        self.total = total
        self.page = page
        self.pageSize = pageSize
        self.updatedAt = updatedAt
        self.latestId = latestId
        self.timeline = timeline
    }

    private enum CodingKeys: String, CodingKey { case articles, total, page, pageSize, updatedAt, latestId, timeline }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        articles = try c.decode(Lossy<Article>.self, forKey: .articles).elements
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? articles.count
        page = try c.decodeIfPresent(Int.self, forKey: .page) ?? 1
        pageSize = try c.decodeIfPresent(Int.self, forKey: .pageSize) ?? 30
        updatedAt = try? c.decodeIfPresent(Timestamp.self, forKey: .updatedAt)
        latestId = try? c.decodeIfPresent(String.self, forKey: .latestId)
        timeline = try? c.decodeIfPresent([Int].self, forKey: .timeline)
    }
}

/// `GET /api/sources`.
public struct SourcesResponse: Sendable, Hashable, Codable {
    public let sources: [SourceInfo]
    public let categories: [String]
    /// Languages with native feeds (the `lang=<target>,en` rule).
    public let languages: [String]

    private enum CodingKeys: String, CodingKey { case sources, categories, languages }

    public init(sources: [SourceInfo], categories: [String], languages: [String]) {
        self.sources = sources
        self.categories = categories
        self.languages = languages
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sources = try c.decode(Lossy<SourceInfo>.self, forKey: .sources).elements
        categories = try c.decodeIfPresent([String].self, forKey: .categories) ?? NewsCategory.feed.map(\.rawValue)
        languages = try c.decodeIfPresent([String].self, forKey: .languages) ?? ["en"]
    }

    /// Source id → home, the fallback `country.js` `registerSources` provides.
    public var provenanceRegistry: [String: Provenance] {
        Dictionary(sources.map { ($0.id, $0.provenance) }, uniquingKeysWith: { first, _ in first })
    }
}

public struct SourceInfo: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let category: String
    /// `rss` or `api`.
    public let type: String
    public let homepage: URL?
    public let provenance: Provenance
    /// `false` for keyed sources without a key ("NEEDS KEY").
    public let enabled: Bool
    public let requiresKey: Bool
    public let lean: Lean?
    /// Battle-only feeds: queryable by id, never in `/api/news`.
    public let battle: Bool

    private enum CodingKeys: String, CodingKey {
        case id, name, category, type, homepage, country, enabled, requiresKey, lean, battle
    }

    public init(id: String, name: String, category: String, type: String = "rss", homepage: URL? = nil,
                provenance: Provenance, enabled: Bool = true, requiresKey: Bool = false,
                lean: Lean? = nil, battle: Bool = false) {
        self.id = id
        self.name = name
        self.category = category
        self.type = type
        self.homepage = homepage
        self.provenance = provenance
        self.enabled = enabled
        self.requiresKey = requiresKey
        self.lean = lean
        self.battle = battle
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? id
        category = try c.decodeIfPresent(String.self, forKey: .category) ?? NewsCategory.world.rawValue
        type = try c.decodeIfPresent(String.self, forKey: .type) ?? "rss"
        homepage = WebURL.http(try? c.decodeIfPresent(String.self, forKey: .homepage))
        provenance = Provenance.decode(from: c, forKey: .country)
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        requiresKey = try c.decodeIfPresent(Bool.self, forKey: .requiresKey) ?? false
        lean = try? c.decodeIfPresent(Lean.self, forKey: .lean)
        battle = (try? c.decodeIfPresent(Bool.self, forKey: .battle)) ?? false
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encode(category, forKey: .category)
        try c.encode(type, forKey: .type)
        try c.encodeIfPresent(homepage?.absoluteString, forKey: .homepage)
        try provenance.encode(into: &c, forKey: .country)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(requiresKey, forKey: .requiresKey)
        try c.encodeIfPresent(lean, forKey: .lean)
        if battle { try c.encode(true, forKey: .battle) }
    }
}

// MARK: - Article extraction

/// `GET /api/article?url=` — readability extraction. `blocks` keeps structure as text runs only
/// (no HTML crosses the wire); `text` stays the canonical corpus for summarize/translate.
public struct ArticleBody: Sendable, Hashable, Codable {
    public let title: String
    public let byline: String?
    public let text: String
    public let blocks: [ArticleBlock]?
    public let excerpt: String?
    public let image: URL?
    public let siteName: String?

    private enum CodingKeys: String, CodingKey { case title, byline, text, blocks, excerpt, image, siteName }

    public init(title: String, byline: String? = nil, text: String, blocks: [ArticleBlock]? = nil,
                excerpt: String? = nil, image: URL? = nil, siteName: String? = nil) {
        self.title = title
        self.byline = byline
        self.text = text
        self.blocks = blocks
        self.excerpt = excerpt
        self.image = image
        self.siteName = siteName
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
        byline = try? c.decodeIfPresent(String.self, forKey: .byline)
        text = try c.decodeIfPresent(String.self, forKey: .text) ?? ""
        let decoded = (try? c.decodeIfPresent(Lossy<ArticleBlock>.self, forKey: .blocks))??.elements
        blocks = decoded?.isEmpty == false ? decoded : nil
        excerpt = try? c.decodeIfPresent(String.self, forKey: .excerpt)
        image = WebURL.image(try? c.decodeIfPresent(String.self, forKey: .image))
        siteName = try? c.decodeIfPresent(String.self, forKey: .siteName)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(title, forKey: .title)
        try c.encode(byline, forKey: .byline)
        try c.encode(text, forKey: .text)
        try c.encode(blocks, forKey: .blocks)
        try c.encode(excerpt, forKey: .excerpt)
        try c.encode(image?.absoluteString, forKey: .image)
        try c.encode(siteName, forKey: .siteName)
    }

    /// Plain paragraphs of `text` (the web splits on blank lines).
    public var paragraphs: [String] {
        text.components(separatedBy: "\n\n")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

public enum ArticleBlock: Sendable, Hashable, Codable {
    case paragraph([TextRun])
    /// Server levels 2…4 (the story title is the page's h1 on iOS).
    case heading(level: Int, [TextRun])
    case quote([TextRun])
    case list(ordered: Bool, items: [[TextRun]])

    private enum CodingKeys: String, CodingKey { case type, runs, items }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let type = try c.decode(String.self, forKey: .type)
        func runs() throws -> [TextRun] {
            try c.decode(Lossy<TextRun>.self, forKey: .runs).elements.filter { !$0.text.isEmpty }
        }
        switch type {
        case "p": self = .paragraph(try runs())
        case "h2": self = .heading(level: 2, try runs())
        case "h3": self = .heading(level: 3, try runs())
        case "h4": self = .heading(level: 4, try runs())
        case "quote": self = .quote(try runs())
        case "ul", "ol":
            let items = try c.decode([Lossy<TextRun>].self, forKey: .items)
                .map { $0.elements.filter { !$0.text.isEmpty } }
                .filter { !$0.isEmpty }
            self = .list(ordered: type == "ol", items: items)
        default:
            throw DecodingError.dataCorruptedError(forKey: .type, in: c, debugDescription: "Unknown block type \(type)")
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .paragraph(let runs):
            try c.encode("p", forKey: .type)
            try c.encode(runs, forKey: .runs)
        case .heading(let level, let runs):
            try c.encode("h\(level)", forKey: .type)
            try c.encode(runs, forKey: .runs)
        case .quote(let runs):
            try c.encode("quote", forKey: .type)
            try c.encode(runs, forKey: .runs)
        case .list(let ordered, let items):
            try c.encode(ordered ? "ol" : "ul", forKey: .type)
            try c.encode(items, forKey: .items)
        }
    }

    /// The block's plain text (runs joined), used for translation and search.
    public var plainText: String {
        switch self {
        case .paragraph(let runs), .heading(_, let runs), .quote(let runs):
            return runs.map(\.text).joined()
        case .list(_, let items):
            return items.map { $0.map(\.text).joined() }.joined(separator: "\n")
        }
    }

    public var isEmpty: Bool {
        switch self {
        case .paragraph(let runs), .heading(_, let runs), .quote(let runs): return runs.isEmpty
        case .list(_, let items): return items.isEmpty
        }
    }
}

/// One formatted run of text. `href` is an absolute http(s) URL resolved server-side.
public struct TextRun: Sendable, Hashable, Codable {
    public let text: String
    public let href: URL?
    public let bold: Bool
    public let italic: Bool

    private enum CodingKeys: String, CodingKey { case text, href, b, i }

    public init(text: String, href: URL? = nil, bold: Bool = false, italic: Bool = false) {
        self.text = text
        self.href = href
        self.bold = bold
        self.italic = italic
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        text = try c.decode(String.self, forKey: .text)
        href = WebURL.http(try? c.decodeIfPresent(String.self, forKey: .href))
        bold = (try? c.decodeIfPresent(Bool.self, forKey: .b)) == true
        italic = (try? c.decodeIfPresent(Bool.self, forKey: .i)) == true
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(text, forKey: .text)
        try c.encodeIfPresent(href?.absoluteString, forKey: .href)
        if bold { try c.encode(true, forKey: .b) }
        if italic { try c.encode(true, forKey: .i) }
    }
}

// MARK: - Bubble Battle

/// `GET /api/battles`.
public struct BattlesResponse: Sendable, Hashable, Codable {
    public let battles: [Battle]
    public let updatedAt: Timestamp?

    private enum CodingKeys: String, CodingKey { case battles, updatedAt }

    public init(battles: [Battle], updatedAt: Timestamp?) {
        self.battles = battles
        self.updatedAt = updatedAt
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        battles = try c.decode(Lossy<Battle>.self, forKey: .battles).elements
        updatedAt = try? c.decodeIfPresent(Timestamp.self, forKey: .updatedAt)
    }
}

/// One story covered from different leans. `id` is a rendering key, not an identity.
public struct Battle: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    /// Strong tokens; may repeat a bigram's words ("Supreme Court", "Supreme", "Court").
    public let topic: [String]
    public let leans: [Lean: Int]
    public let articles: [Article]

    private enum CodingKeys: String, CodingKey { case id, topic, leans, articles }

    public init(id: String, topic: [String], leans: [Lean: Int], articles: [Article]) {
        self.id = id
        self.topic = topic
        self.leans = leans
        self.articles = articles
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        topic = try c.decodeIfPresent([String].self, forKey: .topic) ?? []
        let raw = try c.decodeIfPresent([String: Int].self, forKey: .leans) ?? [:]
        leans = Dictionary(uniqueKeysWithValues: raw.compactMap { key, value in Lean(rawValue: key).map { ($0, value) } })
        articles = try c.decode(Lossy<Article>.self, forKey: .articles).elements
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(topic, forKey: .topic)
        try c.encode(Dictionary(uniqueKeysWithValues: leans.map { ($0.key.rawValue, $0.value) }), forKey: .leans)
        try c.encode(articles, forKey: .articles)
    }
}

// MARK: - Comments & reactions

/// `GET /api/comments`.
public struct CommentsPage: Sendable, Hashable, Codable {
    public let comments: [Comment]
    public let total: Int
    public let page: Int
    public let pageSize: Int
    /// The caller's persona — only when the request carried `X-Author-Id`.
    public let me: Persona?

    private enum CodingKeys: String, CodingKey { case comments, total, page, pageSize, me }

    public init(comments: [Comment], total: Int, page: Int = 1, pageSize: Int = 20, me: Persona? = nil) {
        self.comments = comments
        self.total = total
        self.page = page
        self.pageSize = pageSize
        self.me = me
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        comments = try c.decode(Lossy<Comment>.self, forKey: .comments).elements
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? comments.count
        page = try c.decodeIfPresent(Int.self, forKey: .page) ?? 1
        pageSize = try c.decodeIfPresent(Int.self, forKey: .pageSize) ?? 20
        me = try? c.decodeIfPresent(Persona.self, forKey: .me)
    }
}

public struct Comment: Sendable, Hashable, Codable, Identifiable {
    public let id: String
    public let name: String
    public let avatar: Avatar
    public let body: String
    public let createdAt: Timestamp
    public var up: Int
    public var down: Int
    public var myVote: Vote?

    private enum CodingKeys: String, CodingKey { case id, name, avatar, body, createdAt, up, down, myVote }

    public init(id: String, name: String, avatar: Avatar, body: String, createdAt: Timestamp,
                up: Int = 0, down: Int = 0, myVote: Vote? = nil) {
        self.id = id
        self.name = name
        self.avatar = avatar
        self.body = body
        self.createdAt = createdAt
        self.up = up
        self.down = down
        self.myVote = myVote
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        avatar = (try? c.decodeIfPresent(Avatar.self, forKey: .avatar)) ?? Avatar(hue: 0, glyph: 0)
        body = try c.decode(String.self, forKey: .body)
        createdAt = try c.decode(Timestamp.self, forKey: .createdAt)
        up = try c.decodeIfPresent(Int.self, forKey: .up) ?? 0
        down = try c.decodeIfPresent(Int.self, forKey: .down) ?? 0
        myVote = (try? c.decodeIfPresent(Vote.self, forKey: .myVote)) ?? nil
    }
}

/// The server-derived pseudonym ("Amber Falcon") of an anonymous author id.
public struct Persona: Sendable, Hashable, Codable {
    public let name: String
    public let avatar: Avatar

    public init(name: String, avatar: Avatar) {
        self.name = name
        self.avatar = avatar
    }
}

/// `hue` 0…359 and `glyph` 0…23 — an index into the fixed client glyph set.
public struct Avatar: Sendable, Hashable, Codable {
    public let hue: Int
    public let glyph: Int

    public init(hue: Int, glyph: Int) {
        self.hue = min(359, max(0, hue))
        self.glyph = glyph
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        self.init(hue: (try? c.decode(Int.self, forKey: .hue)) ?? 0, glyph: (try? c.decode(Int.self, forKey: .glyph)) ?? 0)
    }

    private enum CodingKeys: String, CodingKey { case hue, glyph }
}

/// `POST /api/comments/:id/vote` and `POST /api/news/:id/vote`.
public struct VoteResult: Sendable, Hashable, Codable {
    public let up: Int
    public let down: Int
    public let myVote: Vote?

    private enum CodingKeys: String, CodingKey { case up, down, myVote }

    public init(up: Int, down: Int, myVote: Vote?) {
        self.up = up
        self.down = down
        self.myVote = myVote
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        up = try c.decodeIfPresent(Int.self, forKey: .up) ?? 0
        down = try c.decodeIfPresent(Int.self, forKey: .down) ?? 0
        myVote = (try? c.decodeIfPresent(Vote.self, forKey: .myVote)) ?? nil
    }
}

/// `GET /api/reactions`.
public struct ReactionsResponse: Sendable, Hashable, Codable {
    public let reactions: [String: Reactions]

    public init(reactions: [String: Reactions]) {
        self.reactions = reactions
    }
}

// MARK: - AI endpoints

/// `POST /api/translate`.
public struct TranslateResponse: Sendable, Hashable, Codable {
    public let translations: [String]
    public let provider: String?

    public init(translations: [String], provider: String?) {
        self.translations = translations
        self.provider = provider
    }
}

/// `POST /api/summarize` — always 501 in the free version; the premium shape is fixed already.
public struct SummarizeResponse: Sendable, Hashable, Codable {
    public let summary: String
    public let provider: String?

    public init(summary: String, provider: String?) {
        self.summary = summary
        self.provider = provider
    }
}

// MARK: - Errors & health

/// `{ "error": { "code", "message" } }`.
public struct APIErrorEnvelope: Sendable, Hashable, Codable {
    public struct Body: Sendable, Hashable, Codable {
        public let code: String
        public let message: String
    }

    public let error: Body
}

/// `GET /api/health`.
public struct Health: Sendable, Hashable, Codable {
    public struct SourceCounts: Sendable, Hashable, Codable {
        public let ok: Int
        public let failing: Int
    }

    public let ok: Bool
    public let articles: Int
    public let sources: SourceCounts
    public let updatedAt: Timestamp?
}

// MARK: - Lossy arrays

/// Decodes an array, skipping elements that fail to decode (one bad story never sinks a page).
public struct Lossy<Element: Decodable>: Decodable {
    public let elements: [Element]

    /// Consumes any JSON value without looking at it, so the container always advances.
    private struct Skip: Decodable {
        init(from decoder: Decoder) throws {}
    }

    public init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var out: [Element] = []
        if let count = container.count { out.reserveCapacity(count) }
        while !container.isAtEnd {
            if let element = try? container.decode(Element.self) {
                out.append(element)
            } else if (try? container.decode(Skip.self)) == nil {
                break // cannot happen (Skip never throws) — but never spin
            }
        }
        elements = out
    }
}
