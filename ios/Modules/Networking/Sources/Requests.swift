import CoreModels
import Foundation

/// `GET /api/news` parameters (docs/ARCHITECTURE.md; web `buildParams`, app.js:122-135).
public struct NewsQuery: Sendable, Hashable {
    public var category: NewsCategory
    public var search: String?
    /// Hidden sources (`exclude=` CSV).
    public var exclude: [String]
    /// `"<target>,en"` when the target language has native feeds (`Language.feedQuery`).
    public var lang: String?
    public var page: Int
    public var pageSize: Int
    public var since: Timestamp?

    public init(category: NewsCategory = .all, search: String? = nil, exclude: [String] = [], lang: String? = nil,
                page: Int = 1, pageSize: Int = 30, since: Timestamp? = nil) {
        self.category = category
        self.search = search
        self.exclude = exclude
        self.lang = lang
        self.page = page
        self.pageSize = pageSize
        self.since = since
    }

    public var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if category != .all { items.append(URLQueryItem(name: "category", value: category.rawValue)) }
        if let search = search?.trimmingCharacters(in: .whitespacesAndNewlines), !search.isEmpty {
            items.append(URLQueryItem(name: "q", value: search))
        }
        if !exclude.isEmpty { items.append(URLQueryItem(name: "exclude", value: exclude.joined(separator: ","))) }
        if let lang { items.append(URLQueryItem(name: "lang", value: lang)) }
        if let since { items.append(URLQueryItem(name: "since", value: since.iso)) }
        items.append(URLQueryItem(name: "page", value: String(page)))
        items.append(URLQueryItem(name: "pageSize", value: String(pageSize)))
        return items
    }
}

/// `GET /api/comments` parameters.
public struct CommentsQuery: Sendable, Hashable {
    public enum Sort: String, Sendable, Hashable, CaseIterable {
        case new, top
    }

    public var articleID: String
    public var page: Int
    public var pageSize: Int
    public var sort: Sort

    public init(articleID: String, page: Int = 1, pageSize: Int = 20, sort: Sort = .new) {
        self.articleID = articleID
        self.page = page
        self.pageSize = pageSize
        self.sort = sort
    }

    public var queryItems: [URLQueryItem] {
        [
            URLQueryItem(name: "article", value: articleID),
            URLQueryItem(name: "page", value: String(page)),
            URLQueryItem(name: "pageSize", value: String(pageSize)),
            URLQueryItem(name: "sort", value: sort.rawValue),
        ]
    }
}

/// `POST /api/summarize` body — reserved for the premium tier; the free server answers 501.
public struct SummarizeRequest: Sendable, Hashable, Encodable {
    public struct Headline: Sendable, Hashable, Encodable {
        public let title: String
        public let description: String
        public let source: String

        public init(title: String, description: String, source: String) {
            self.title = title
            self.description = description
            self.source = source
        }
    }

    public let mode: String
    public let articles: [Headline]?
    public let title: String?
    public let text: String?
    public let targetLang: String

    public static func brief(_ articles: [Headline], targetLang: String) -> SummarizeRequest {
        SummarizeRequest(mode: "brief", articles: Array(articles.prefix(30)), title: nil, text: nil, targetLang: targetLang)
    }

    public static func article(title: String, text: String, targetLang: String) -> SummarizeRequest {
        SummarizeRequest(mode: "article", articles: nil, title: title, text: text, targetLang: targetLang)
    }
}
