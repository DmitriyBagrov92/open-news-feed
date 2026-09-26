import Foundation

/// A story as `/api/news` (and `/api/battles`) send it — docs/ARCHITECTURE.md "Article".
/// Live counters are optional: absent means unknown (saved and battle stories), which the
/// story view resolves with `GET /api/reactions`.
public struct Article: Sendable, Hashable, Identifiable, Codable {
    public let id: String
    public let title: String
    public let description: String
    public let url: URL
    public let image: URL?
    public let source: ArticleSource
    /// Raw category id; battle-only stories carry `"battle"`. See `newsCategory`.
    public let category: String
    public let publishedAt: Timestamp
    public let language: String
    public var reactions: Reactions?
    /// Only on `/api/battles` articles.
    public let lean: Lean?

    public init(
        id: String, title: String, description: String = "", url: URL, image: URL? = nil,
        source: ArticleSource, category: String, publishedAt: Timestamp, language: String = "en",
        reactions: Reactions? = nil, lean: Lean? = nil
    ) {
        self.id = id
        self.title = title
        self.description = description
        self.url = url
        self.image = image
        self.source = source
        self.category = category
        self.publishedAt = publishedAt
        self.language = language
        self.reactions = reactions
        self.lean = lean
    }

    public var newsCategory: NewsCategory? { NewsCategory(rawValue: category) }

    private enum CodingKeys: String, CodingKey {
        case id, title, description, url, image, source, category, publishedAt, language
        case commentCount, up, down, myVote, lean
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        description = try c.decodeIfPresent(String.self, forKey: .description) ?? ""
        guard let link = WebURL.http(try c.decode(String.self, forKey: .url)) else {
            throw DecodingError.dataCorruptedError(forKey: .url, in: c, debugDescription: "Article url must be http(s)")
        }
        url = link
        image = WebURL.image(try? c.decodeIfPresent(String.self, forKey: .image))
        source = try c.decode(ArticleSource.self, forKey: .source)
        category = try c.decodeIfPresent(String.self, forKey: .category) ?? NewsCategory.world.rawValue
        publishedAt = try c.decode(Timestamp.self, forKey: .publishedAt)
        language = try c.decodeIfPresent(String.self, forKey: .language) ?? "en"
        lean = try? c.decodeIfPresent(Lean.self, forKey: .lean)
        if let up = try? c.decodeIfPresent(Int.self, forKey: .up) {
            reactions = Reactions(
                comments: (try? c.decodeIfPresent(Int.self, forKey: .commentCount)) ?? 0,
                up: up,
                down: (try? c.decodeIfPresent(Int.self, forKey: .down)) ?? 0,
                myVote: (try? c.decodeIfPresent(Vote.self, forKey: .myVote)) ?? nil
            )
        } else {
            reactions = nil
        }
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(description, forKey: .description)
        try c.encode(url.absoluteString, forKey: .url)
        try c.encode(image?.absoluteString, forKey: .image)
        try c.encode(source, forKey: .source)
        try c.encode(category, forKey: .category)
        try c.encode(publishedAt, forKey: .publishedAt)
        try c.encode(language, forKey: .language)
        try c.encodeIfPresent(lean, forKey: .lean)
        if let reactions {
            try c.encode(reactions.comments, forKey: .commentCount)
            try c.encode(reactions.up, forKey: .up)
            try c.encode(reactions.down, forKey: .down)
            try c.encode(reactions.myVote, forKey: .myVote)
        }
    }
}

/// `article.source`.
public struct ArticleSource: Sendable, Hashable, Codable {
    public let id: String
    public let name: String
    public let homepage: URL?
    /// Tri-state like the web: a missing field is `.unknown` (resolve through the registry).
    public let provenance: Provenance

    public init(id: String, name: String, homepage: URL? = nil, provenance: Provenance) {
        self.id = id
        self.name = name
        self.homepage = homepage
        self.provenance = provenance
    }

    private enum CodingKeys: String, CodingKey { case id, name, homepage, country }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        homepage = WebURL.http(try? c.decodeIfPresent(String.self, forKey: .homepage))
        provenance = Provenance.decode(from: c, forKey: .country)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(name, forKey: .name)
        try c.encodeIfPresent(homepage?.absoluteString, forKey: .homepage)
        try provenance.encode(into: &c, forKey: .country)
    }
}

/// Comment count + like/dislike tallies. `/api/reactions` names the count `comments`;
/// articles carry it flat as `commentCount`.
public struct Reactions: Sendable, Hashable, Codable {
    public var comments: Int
    public var up: Int
    public var down: Int
    public var myVote: Vote?

    public init(comments: Int = 0, up: Int = 0, down: Int = 0, myVote: Vote? = nil) {
        self.comments = comments
        self.up = up
        self.down = down
        self.myVote = myVote
    }

    public static let zero = Reactions()
}

/// A like (1) or dislike (-1); `nil` = no vote. `0` retracts on the wire.
public enum Vote: Int, Sendable, Hashable, Codable {
    case up = 1
    case down = -1
}

/// AllSides-style consensus lean of a battle source.
public enum Lean: String, Sendable, Hashable, Codable, CaseIterable {
    case left, center, right
}

/// URL gatekeeping shared by every decoder: feed content is untrusted.
public enum WebURL {
    /// Only absolute http(s) URLs become links (a `javascript:` URL must never be tappable).
    public static func http(_ string: String?) -> URL? {
        guard let string, let url = URL(string: string), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host?.isEmpty == false
        else { return nil }
        return url
    }

    /// Article images: https only, plain http upgraded (the web's CSP allows https images only;
    /// Chrome auto-upgrades mixed content the same way). No App Transport Security exception.
    public static func image(_ string: String??) -> URL? {
        guard let string = string ?? nil, var url = http(string) else { return nil }
        if url.scheme?.lowercased() == "http", var parts = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            parts.scheme = "https"
            guard let upgraded = parts.url else { return nil }
            url = upgraded
        }
        return url
    }
}
