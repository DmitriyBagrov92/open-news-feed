import CoreModels
import Dependencies
import DependenciesMacros
import Foundation

/// The Meridian HTTP API (docs/ARCHITECTURE.md) as an injectable client. The live value talks to
/// `MeridianAPIBaseURL` (Info.plist); tests and the UI-test mode swap in fakes (TestSupport).
@DependencyClient
public struct MeridianAPIClient: Sendable {
    public var news: @Sendable (_ query: NewsQuery) async throws -> FeedPage
    public var sources: @Sendable () async throws -> SourcesResponse
    public var battles: @Sendable () async throws -> BattlesResponse
    public var article: @Sendable (_ url: URL) async throws -> ArticleBody
    public var comments: @Sendable (_ query: CommentsQuery) async throws -> CommentsPage
    public var postComment: @Sendable (_ articleID: String, _ body: String) async throws -> CoreModels.Comment
    /// `value`: 1, -1 or 0 (retract).
    public var voteComment: @Sendable (_ commentID: String, _ value: Int) async throws -> VoteResult
    /// A reader flags a comment (one report per reader). Returns whether it is now hidden for all.
    public var reportComment: @Sendable (_ commentID: String, _ reason: ReportReason) async throws -> Bool
    /// The author deletes their own comment.
    public var deleteComment: @Sendable (_ commentID: String) async throws -> Void
    public var voteArticle: @Sendable (_ articleID: String, _ value: Int) async throws -> VoteResult
    public var reactions: @Sendable (_ articleIDs: [String]) async throws -> [String: Reactions]
    public var translate: @Sendable (_ texts: [String], _ target: String, _ source: String) async throws -> TranslateResponse
    public var summarize: @Sendable (_ request: SummarizeRequest) async throws -> SummarizeResponse
}

extension MeridianAPIClient: DependencyKey {
    public static var liveValue: MeridianAPIClient {
        let base = (Bundle.main.object(forInfoDictionaryKey: "MeridianAPIBaseURL") as? String).flatMap(URL.init(string:))
        return .live(baseURL: base ?? NetworkingModule.defaultBaseURL, identity: .liveValue)
    }

    public static let testValue = MeridianAPIClient()
}

public extension DependencyValues {
    var meridianAPI: MeridianAPIClient {
        get { self[MeridianAPIClient.self] }
        set { self[MeridianAPIClient.self] = newValue }
    }
}

// MARK: - Live

public extension MeridianAPIClient {
    static func live(baseURL: URL, identity: AuthorIdentity, session: URLSession = .meridianAPI) -> MeridianAPIClient {
        let transport = Transport(baseURL: baseURL, session: session, identity: identity)
        return MeridianAPIClient(
            news: { query in
                try await transport.get("/api/news", query.queryItems, author: .ifExists)
            },
            sources: {
                try await transport.get("/api/sources", [], author: .none)
            },
            battles: {
                try await transport.get("/api/battles", [], author: .none)
            },
            article: { url in
                try await transport.get("/api/article", [URLQueryItem(name: "url", value: url.absoluteString)], author: .none)
            },
            comments: { query in
                try await transport.get("/api/comments", query.queryItems, author: .ifExists)
            },
            postComment: { articleID, body in
                try await transport.post("/api/comments", Body(["articleId": .string(articleID), "body": .string(body)]), author: .mint)
            },
            voteComment: { commentID, value in
                try await transport.post("/api/comments/\(commentID)/vote", Body(["value": .int(value)]), author: .mint)
            },
            reportComment: { commentID, reason in
                let result: ReportResult = try await transport.post(
                    "/api/comments/\(commentID)/report", Body(["reason": .string(reason.rawValue)]), author: .mint
                )
                return result.hidden
            },
            deleteComment: { commentID in
                let _: DeleteResult = try await transport.delete("/api/comments/\(commentID)", author: .mint)
            },
            voteArticle: { articleID, value in
                try await transport.post("/api/news/\(articleID)/vote", Body(["value": .int(value)]), author: .mint)
            },
            reactions: { ids in
                let response: ReactionsResponse = try await transport.get(
                    "/api/reactions", [URLQueryItem(name: "articles", value: ids.prefix(150).joined(separator: ","))], author: .ifExists
                )
                return response.reactions
            },
            translate: { texts, target, source in
                try await transport.post(
                    "/api/translate",
                    Body(["texts": .strings(texts), "target": .string(target), "source": .string(source)]),
                    author: .none
                )
            },
            summarize: { request in
                try await transport.post("/api/summarize", request, author: .none)
            }
        )
    }
}

public extension URLSession {
    /// API traffic: no shared URLCache (responses `Vary: X-Author-Id`), sane timeouts.
    static let meridianAPI: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 40
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration)
    }()
}

/// Whether a request carries the anonymous `X-Author-Id` (web rule: reads never mint an id).
enum AuthorHeader {
    case none, ifExists, mint
}

/// A tiny JSON body for the POST endpoints.
struct Body: Encodable, Sendable {
    enum Value: Encodable, Sendable {
        case string(String), int(Int), strings([String])

        func encode(to encoder: Encoder) throws {
            var container = encoder.singleValueContainer()
            switch self {
            case .string(let value): try container.encode(value)
            case .int(let value): try container.encode(value)
            case .strings(let value): try container.encode(value)
            }
        }
    }

    let fields: [String: Value]

    init(_ fields: [String: Value]) {
        self.fields = fields
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        for (key, value) in fields.sorted(by: { $0.key < $1.key }) {
            try container.encode(value, forKey: Key(key))
        }
    }

    struct Key: CodingKey {
        let stringValue: String
        let intValue: Int? = nil
        init(_ string: String) { stringValue = string }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }
}

struct Transport: Sendable {
    let baseURL: URL
    let session: URLSession
    let identity: AuthorIdentity

    static let clientHeader = "meridian-ios/" + ((Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? "dev")

    func get<T: Decodable>(_ path: String, _ query: [URLQueryItem], author: AuthorHeader) async throws -> T {
        var request = URLRequest(url: try url(path, query))
        request.httpMethod = "GET"
        return try await send(request, author: author)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, _ body: B, author: AuthorHeader) async throws -> T {
        var request = URLRequest(url: try url(path, []))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(body)
        return try await send(request, author: author)
    }

    func delete<T: Decodable>(_ path: String, author: AuthorHeader) async throws -> T {
        var request = URLRequest(url: try url(path, []))
        request.httpMethod = "DELETE"
        return try await send(request, author: author)
    }

    private func url(_ path: String, _ query: [URLQueryItem]) throws -> URL {
        guard var components = URLComponents(url: baseURL.appendingPathComponent(path), resolvingAgainstBaseURL: false) else {
            throw APIError.decoding("bad url \(path)")
        }
        if !query.isEmpty { components.queryItems = query }
        guard let url = components.url else { throw APIError.decoding("bad url \(path)") }
        return url
    }

    private func send<T: Decodable>(_ original: URLRequest, author: AuthorHeader) async throws -> T {
        var request = original
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(Transport.clientHeader, forHTTPHeaderField: "X-Client")
        switch author {
        case .none: break
        case .ifExists: if let id = identity.current() { request.setValue(id, forHTTPHeaderField: "X-Author-Id") }
        case .mint: request.setValue(identity.ensure(), forHTTPHeaderField: "X-Author-Id")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw APIError.network(error.code)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.decoding("not an HTTP response") }
        guard (200..<300).contains(http.statusCode) else {
            let envelope = try? JSONDecoder().decode(APIErrorEnvelope.self, from: data)
            let retryAfter = http.value(forHTTPHeaderField: "Retry-After").flatMap(TimeInterval.init)
            throw APIError.server(
                status: http.statusCode,
                code: envelope?.error.code ?? "http-\(http.statusCode)",
                message: envelope?.error.message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                retryAfter: retryAfter
            )
        }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(String(describing: error))
        }
    }
}
