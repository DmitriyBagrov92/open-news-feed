import Foundation
import Testing
import CoreModels
import Networking

/// The live client against the REAL Node server in fixture mode. scripts/test.sh boots
/// `server.js` with FEED_FIXTURE and passes its origin as TEST_RUNNER_MERIDIAN_CONTRACT_URL
/// (the simulator strips the TEST_RUNNER_ prefix). Skipped when no server is running.
enum ContractServer {
    static let origin = ProcessInfo.processInfo.environment["MERIDIAN_CONTRACT_URL"].flatMap(URL.init(string:))
}

@Suite("Contract with the Node server", .enabled(if: ContractServer.origin != nil))
struct ContractTests {

    private func get<T: Decodable>(_ path: String, as type: T.Type) async throws -> T {
        let url = try #require(URL(string: path, relativeTo: ContractServer.origin))
        let (data, response) = try await URLSession.shared.data(from: url)
        #expect((response as? HTTPURLResponse)?.statusCode == 200, "\(path)")
        return try JSONDecoder().decode(T.self, from: data)
    }

    @Test("health, feed, sources and battles decode from the running server")
    func liveShapes() async throws {
        #expect(try await get("/api/health", as: Health.self).ok)
        let page = try await get("/api/news?pageSize=30", as: FeedPage.self)
        #expect(page.articles.count == 30 && page.total > 30)
        #expect(try await get("/api/sources", as: SourcesResponse.self).sources.count > 50)
        #expect(try await get("/api/battles", as: BattlesResponse.self).battles.count >= 1)
    }

    @Test("comments through the live client: post, mine, report, and only the author deletes")
    func commentsFlow() async throws {
        let origin = try #require(ContractServer.origin)
        let writer = MeridianAPIClient.live(baseURL: origin, identity: .inMemory(UUID().uuidString.lowercased()))
        let reader = MeridianAPIClient.live(baseURL: origin, identity: .inMemory(UUID().uuidString.lowercased()))
        let article = try #require(try await writer.news(NewsQuery(pageSize: 5)).articles.last)
        let created = try await writer.postComment(article.id, "Contract check \(UUID().uuidString.prefix(8))")
        #expect(created.mine && AuthorKey.isValid(created.authorKey))
        let asReader = try await reader.comments(CommentsQuery(articleID: article.id))
        let seen = try #require(asReader.comments.first { $0.id == created.id })
        #expect(!seen.mine && seen.authorKey == created.authorKey)
        #expect(try await reader.reportComment(created.id, .spam) == false, "one report hides nothing")
        do {
            try await reader.deleteComment(created.id)
            Issue.record("a stranger deleted the comment")
        } catch let error as APIError {
            #expect(error.code == "not-owner")
        }
        try await writer.deleteComment(created.id)
        let after = try await writer.comments(CommentsQuery(articleID: article.id))
        #expect(!after.comments.contains { $0.id == created.id })
    }
}
