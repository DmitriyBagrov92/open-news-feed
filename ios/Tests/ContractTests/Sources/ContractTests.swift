import Foundation
import Testing
import CoreModels

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
}
