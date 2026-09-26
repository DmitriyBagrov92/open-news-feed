import CoreModels
import Foundation
import Networking
import Testing

/// The live client's wire behaviour against a stubbed URL loading system: request shapes,
/// the anonymous-identity rule (reads never mint an id), and error mapping.
@Suite("Live API client", .serialized)
struct LiveClientTests {
    private func client(identity: AuthorIdentity = .inMemory()) -> MeridianAPIClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubProtocol.self]
        return .live(baseURL: URL(string: "https://api.test")!, identity: identity, session: URLSession(configuration: configuration))
    }

    @Test("news: query parameters, headers, no identity minted by a read")
    func newsRequest() async throws {
        let body = try Fixtures.api("news-page1").body
        StubProtocol.respond(status: 200, body: body)
        let identity = AuthorIdentity.inMemory()
        let page = try await client(identity: identity).news(
            NewsQuery(category: .world, search: " storm ", exclude: ["bbc-world", "npr-world"], lang: "ru,en", page: 2)
        )
        #expect(page.articles.count == 30)

        let request = try #require(StubProtocol.lastRequest)
        let url = try #require(request.url)
        let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
        #expect(components.path == "/api/news")
        let items = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(items == ["category": "world", "q": "storm", "exclude": "bbc-world,npr-world", "lang": "ru,en", "page": "2", "pageSize": "30"])
        #expect(request.value(forHTTPHeaderField: "X-Author-Id") == nil)
        #expect(request.value(forHTTPHeaderField: "X-Client")?.hasPrefix("meridian-ios/") == true)
        #expect(identity.current() == nil, "a read never mints an identity")
    }

    @Test("reads send an existing identity; the default category sends no category")
    func existingIdentity() async throws {
        StubProtocol.respond(status: 200, body: try Fixtures.api("news-page1").body)
        let identity = AuthorIdentity.inMemory("123e4567-e89b-12d3-a456-426614174000")
        _ = try await client(identity: identity).news(NewsQuery())
        let request = try #require(StubProtocol.lastRequest)
        #expect(request.value(forHTTPHeaderField: "X-Author-Id") == "123e4567-e89b-12d3-a456-426614174000")
        #expect(request.url?.query?.contains("category") == false)
    }

    @Test("a write mints the identity and posts JSON")
    func writeMints() async throws {
        StubProtocol.respond(status: 201, body: try Fixtures.api("comment-created").body)
        let identity = AuthorIdentity.inMemory()
        let comment = try await client(identity: identity).postComment("825452304de0", "Hello there")
        #expect(comment.body.isEmpty == false)
        let request = try #require(StubProtocol.lastRequest)
        let minted = try #require(identity.current())
        #expect(request.value(forHTTPHeaderField: "X-Author-Id") == minted)
        #expect(request.httpMethod == "POST")
        let sent = try JSONSerialization.jsonObject(with: try #require(StubProtocol.lastBody)) as? [String: String]
        #expect(sent == ["articleId": "825452304de0", "body": "Hello there"])
    }

    @Test("server errors keep the envelope code and Retry-After")
    func serverError() async throws {
        StubProtocol.respond(status: 429, body: try Fixtures.api("comment-too-fast-429").body, headers: ["Retry-After": "12"])
        await #expect(throws: APIError.server(status: 429, code: "too-fast", message: "Please wait a few seconds between comments", retryAfter: 12)) {
            _ = try await client().postComment("825452304de0", "again")
        }
    }

    @Test("a non-JSON error body still maps to an http-<status> code")
    func htmlError() async throws {
        StubProtocol.respond(status: 502, body: Data("<html>bad gateway</html>".utf8))
        do {
            _ = try await client().sources()
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error.code == "http-502")
            #expect(error.isTransient)
        }
    }

    @Test("connectivity failures are network errors")
    func offline() async throws {
        StubProtocol.fail(with: URLError(.notConnectedToInternet))
        do {
            _ = try await client().battles()
            Issue.record("expected an error")
        } catch let error as APIError {
            #expect(error == .network(.notConnectedToInternet))
            #expect(error.isOffline)
        }
    }

    @Test("reactions ask for at most 150 ids")
    func reactionsCap() async throws {
        StubProtocol.respond(status: 200, body: Data(#"{"reactions":{}}"#.utf8))
        let ids = (0..<200).map { String(format: "%012x", $0) }
        _ = try await client().reactions(ids)
        let query = try #require(StubProtocol.lastRequest?.url?.query)
        #expect(query.components(separatedBy: "%2C").count == 150 || query.components(separatedBy: ",").count == 150)
    }
}

/// URL loading stub: one canned response (or error) at a time; the suite is serialized.
final class StubProtocol: URLProtocol, @unchecked Sendable {
    private struct Canned: Sendable {
        var status = 200
        var body = Data()
        var headers: [String: String] = [:]
        var error: URLError?
    }

    private static let state = LockedValue<(canned: Canned, request: URLRequest?, body: Data?)>((Canned(), nil, nil))

    static func respond(status: Int, body: Data, headers: [String: String] = [:]) {
        state.update { $0 = (Canned(status: status, body: body, headers: headers), nil, nil) }
    }

    static func fail(with error: URLError) {
        state.update { $0 = (Canned(error: error), nil, nil) }
    }

    static var lastRequest: URLRequest? { state.value.request }
    static var lastBody: Data? { state.value.body }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let body = request.httpBody ?? request.httpBodyStream.map(Self.read)
        let canned = Self.state.update { current -> Canned in
            current.request = request
            current.body = body
            return current.canned
        }
        if let error = canned.error {
            client?.urlProtocol(self, didFailWithError: error)
            return
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: canned.status, httpVersion: "HTTP/1.1", headerFields: canned.headers)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: canned.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func read(_ stream: InputStream) -> Data {
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}
